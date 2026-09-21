use foltra_core::execute;
use serde_json::{json, Value};
use tempfile::TempDir;

fn vault() -> TempDir {
    let dir = tempfile::tempdir().unwrap();
    call(&dir, "vault.init", json!({"name":"Test vault"}));
    dir
}
fn call(dir: &TempDir, command: &str, args: Value) -> Value {
    execute(dir.path().to_str().unwrap(), command, args).unwrap()
}
fn note(dir: &TempDir, title: &str, body: &str) -> Value {
    call(dir, "note.create", json!({"title":title,"body":body}))
}
fn db(dir: &TempDir) -> Value {
    call(dir, "database.create", json!({"name":"Tasks"}))
}

#[test]
fn database_records_exist_without_markdown_files() {
    let v = vault();
    let db = db(&v);
    let record = call(
        &v,
        "record.create",
        json!({"databaseId":db["id"],"values":{"title":"Independent row","status":"To do"}}),
    );
    assert!(record["bodyNoteId"].is_null());
    assert_eq!(call(&v, "note.list", json!({})), json!([]));
    assert!(!v.path().join("notes").exists());
    assert_eq!(
        call(&v, "query.run", json!({"databaseId":db["id"]}))["total"],
        1
    );
}

#[test]
fn vim_is_opt_in_and_editor_preferences_survive_reopening() {
    let v = vault();
    let defaults = call(&v, "settings.get", json!({}));
    assert_eq!(defaults["vim"], false);
    assert_eq!(defaults["editorMode"], "live");
    call(
        &v,
        "settings.update",
        json!({"vim":true,"editorMode":"source"}),
    );
    let saved = call(&v, "workspace.get", json!({}));
    assert_eq!(saved["settings"]["vim"], true);
    assert_eq!(saved["settings"]["editorMode"], "source");
    assert_eq!(
        execute(
            v.path().to_str().unwrap(),
            "settings.update",
            json!({"editorMode":"unknown"})
        )
        .unwrap_err()
        .code,
        "invalid_settings"
    );
}

#[test]
fn fenced_link_examples_are_preserved_and_not_indexed() {
    let v = vault();
    let target = note(&v, "Target", "Text");
    let body = "````md\n[[Target]]\n```\n[[Target]]\n````\n\n[[Target]]\n";
    let source = note(&v, "Example", body);
    assert!(source["body"]
        .as_str()
        .unwrap()
        .starts_with("````md\n[[Target]]\n```\n[[Target]]\n````\n"));
    let links = call(&v, "backlinks.list", json!({"target":target["id"]}));
    assert_eq!(links.as_array().unwrap().len(), 1);
    assert_eq!(links[0]["line"], 7);
}

#[test]
fn deleted_record_body_can_be_replaced_without_losing_the_row() {
    let v = vault();
    let database = db(&v);
    let row = call(
        &v,
        "record.create",
        json!({"databaseId":database["id"],"values":{"title":"Task"}}),
    );
    let body = call(
        &v,
        "record.body",
        json!({"id":row["id"],"expectedRevision":row["revision"],"body":"Old"}),
    );
    call(
        &v,
        "note.delete",
        json!({"id":body["id"],"expectedRevision":body["revision"]}),
    );
    let row = call(&v, "query.run", json!({"databaseId":database["id"]}))["rows"][0].clone();
    let replacement = call(
        &v,
        "record.body",
        json!({"id":row["id"],"expectedRevision":row["revision"],"body":"Replacement"}),
    );
    assert_ne!(body["id"], replacement["id"]);
    assert_eq!(replacement["body"], "Replacement");
    assert_eq!(
        call(&v, "query.run", json!({"databaseId":database["id"]}))["total"],
        1
    );
}

#[test]
fn malformed_settings_are_rejected_on_write_and_external_read() {
    let v = vault();
    let malformed = json!({"keybindings":{"note.create":{"leader":42}}});
    assert_eq!(
        execute(
            v.path().to_str().unwrap(),
            "settings.update",
            malformed.clone()
        )
        .unwrap_err()
        .code,
        "invalid_settings"
    );
    std::fs::write(
        v.path().join(".foltra/settings.json"),
        malformed.to_string(),
    )
    .unwrap();
    assert_eq!(
        execute(v.path().to_str().unwrap(), "settings.get", json!({}))
            .unwrap_err()
            .code,
        "invalid_settings"
    );
}

#[test]
fn query_rejects_wrong_types_and_does_not_match_missing_dates() {
    let v = vault();
    let database = db(&v);
    call(
        &v,
        "record.create",
        json!({"databaseId":database["id"],"values":{"title":"No date"}}),
    );
    let error = execute(v.path().to_str().unwrap(), "query.run", json!({"databaseId":database["id"],"filters":[{"property":"title","op":"contains","value":42}]})).unwrap_err();
    assert_eq!(error.code, "invalid_query");
    let result = call(
        &v,
        "query.run",
        json!({"databaseId":database["id"],"filters":[{"property":"date","op":"lt","value":"2026-09-15"}]}),
    );
    assert_eq!(result["total"], 0);
}
#[test]
fn record_body_creation_and_deletion_preserve_independent_note() {
    let v = vault();
    let db = db(&v);
    let row = call(
        &v,
        "record.create",
        json!({"databaseId":db["id"],"values":{"title":"Research"}}),
    );
    let body = call(
        &v,
        "record.body",
        json!({"id":row["id"],"expectedRevision":row["revision"],"body":"Details"}),
    );
    let row = call(&v, "query.run", json!({"databaseId":db["id"]}))["rows"][0].clone();
    assert_eq!(row["bodyNoteId"], body["id"]);
    call(
        &v,
        "record.delete",
        json!({"id":row["id"],"expectedRevision":row["revision"]}),
    );
    assert_eq!(
        call(&v, "note.read", json!({"id":body["id"]}))["body"],
        "Details"
    );
}
#[test]
fn stale_revision_cannot_overwrite_external_edit() {
    let v = vault();
    let n = note(&v, "안녕", "원본");
    let path = v
        .path()
        .join(format!("notes/{}.md", n["id"].as_str().unwrap()));
    let raw = std::fs::read_to_string(&path)
        .unwrap()
        .replace("원본", "외부 변경");
    std::fs::write(path, raw).unwrap();
    let error = execute(
        v.path().to_str().unwrap(),
        "note.update",
        json!({"id":n["id"],"expectedRevision":n["revision"],"body":"stale"}),
    )
    .unwrap_err();
    assert_eq!(error.code, "conflict");
    assert_eq!(
        call(&v, "note.read", json!({"id":n["id"]}))["body"],
        "외부 변경"
    );
}
#[test]
fn stable_links_survive_title_changes_and_include_block_target() {
    let v = vault();
    let a = note(&v, "원문", "내용 ^anchor");
    let b = note(&v, "인용", "참고: [[원문#^anchor|근거]]");
    assert_eq!(b["body"], "참고: [[원문#^anchor|근거]]");
    call(
        &v,
        "note.update",
        json!({"id":a["id"],"expectedRevision":a["revision"],"title":"새 제목"}),
    );
    let backlinks = call(&v, "backlinks.list", json!({"target":a["id"]}));
    assert_eq!(backlinks[0]["source"], b["id"]);
    assert_eq!(backlinks[0]["block"], "anchor");
}
#[test]
fn structured_queries_filter_sort_and_paginate_without_code_execution() {
    let v = vault();
    let db = db(&v);
    for (name, status) in [("C", "Done"), ("B", "To do"), ("A", "To do")] {
        call(
            &v,
            "record.create",
            json!({"databaseId":db["id"],"values":{"title":name,"status":status}}),
        );
    }
    let result = call(
        &v,
        "query.run",
        json!({"databaseId":db["id"],"filters":[{"property":"status","op":"eq","value":"To do"}],"sort":"title","limit":1}),
    );
    assert_eq!(result["total"], 2);
    assert_eq!(result["rows"][0]["values"]["title"], "A");
    assert!(execute(
        v.path().to_str().unwrap(),
        "query.run",
        json!({"databaseId":db["id"],"sort":"title; DROP TABLE records"})
    )
    .is_err());
}
#[test]
fn invalid_record_types_do_not_write_data() {
    let v = vault();
    let db = db(&v);
    let result = execute(
        v.path().to_str().unwrap(),
        "record.create",
        json!({"databaseId":db["id"],"values":{"status":"Not allowed","date":"2026-99-99"}}),
    );
    assert_eq!(result.unwrap_err().code, "invalid_value");
    assert_eq!(
        call(&v, "query.run", json!({"databaseId":db["id"]}))["total"],
        0
    );
}
#[test]
fn trash_restore_preserves_content_and_identity() {
    let v = vault();
    let n = note(&v, "Keep me", "🪴 한글");
    call(
        &v,
        "note.delete",
        json!({"id":n["id"],"expectedRevision":n["revision"]}),
    );
    assert_eq!(call(&v, "note.list", json!({})), json!([]));
    let trash = call(&v, "trash.list", json!({}));
    call(&v, "trash.restore", json!({"id":trash[0]["id"]}));
    assert_eq!(
        call(&v, "note.read", json!({"id":n["id"]}))["body"],
        "🪴 한글"
    );
}
#[test]
fn index_can_be_deleted_and_rebuilt_from_originals() {
    let v = vault();
    note(&v, "Knowledge", "찾을 내용");
    assert_eq!(
        call(&v, "search", json!({"query":"찾을"}))
            .as_array()
            .unwrap()
            .len(),
        1
    );
    std::fs::remove_dir_all(v.path().join(".foltra/cache")).unwrap();
    assert_eq!(
        call(&v, "search", json!({"query":"찾을"}))
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(call(&v, "search", json!({"query":"%"})), json!([]));
}
#[test]
fn recovery_replays_an_interrupted_multifile_transaction() {
    let v = vault();
    let a = note(&v, "One", "before");
    let b = note(&v, "Two", "before");
    let mut entries = vec![];
    for n in [&a, &b] {
        let relative = format!("notes/{}.md", n["id"].as_str().unwrap());
        let before = std::fs::read_to_string(v.path().join(&relative)).unwrap();
        entries.push(
            json!({"path":relative,"after":before.replace("before","after"),"before":before}),
        );
    }
    std::fs::write(
        v.path().join(".foltra/local/pending.json"),
        json!({"version":1,"entries":entries}).to_string(),
    )
    .unwrap();
    std::fs::write(
        v.path().join(entries[0]["path"].as_str().unwrap()),
        entries[0]["after"].as_str().unwrap(),
    )
    .unwrap();
    assert_eq!(
        call(&v, "note.read", json!({"id":b["id"]}))["body"],
        "after"
    );
    assert!(!v.path().join(".foltra/local/pending.json").exists());
}
#[test]
fn recovery_preserves_conflicting_external_content() {
    let v = vault();
    let n = note(&v, "Original", "before");
    let relative = format!("notes/{}.md", n["id"].as_str().unwrap());
    let path = v.path().join(&relative);
    let before = std::fs::read_to_string(&path).unwrap();
    std::fs::write(v.path().join(".foltra/local/pending.json"),json!({"version":1,"entries":[{"path":relative,"before":before,"after":before.replace("before","after")}]}).to_string()).unwrap();
    std::fs::write(&path, before.replace("before", "external")).unwrap();
    assert_eq!(
        execute(v.path().to_str().unwrap(), "workspace.get", json!({}))
            .unwrap_err()
            .code,
        "recovery_conflict"
    );
    assert!(std::fs::read_to_string(path).unwrap().contains("external"));
    assert!(v.path().join(".foltra/local/pending.json").exists());
}
#[test]
fn untrusted_theme_cannot_load_external_css_or_script() {
    let v = vault();
    for tokens in [
        json!({"paper":"url(https://example.com/leak)"}),
        json!({"position":"#ffffff"}),
        json!({"strong":"url(https://example.com/leak)"}),
    ] {
        assert!(execute(v.path().to_str().unwrap(),"extension.install",json!({"manifest":{"kind":"theme","id":"test","name":"Test","version":"1.0.0","tokens":tokens}})).is_err());
    }
    assert!(execute(v.path().to_str().unwrap(),"extension.install",json!({"manifest":{"kind":"plugin","id":"unsafe","name":"Bad","version":"1.0.0","script":"fetch('/secret')"}})).is_err());
    assert_eq!(call(&v, "extension.list", json!({})), json!([]));
}
#[test]
fn theme_can_persist_an_optional_bold_text_color() {
    let v = vault();
    let manifest = json!({"kind":"theme","id":"emphasis","name":"Emphasis","version":"1.0.0","tokens":{"strong":"#54765f"}});
    call(&v, "extension.install", json!({"manifest":manifest}));
    assert_eq!(
        call(&v, "extension.list", json!({}))[0]["tokens"]["strong"],
        "#54765f"
    );
}
#[test]
fn declarative_extension_installs_and_removes_without_removing_notes() {
    let v = vault();
    note(&v, "Keep", "Content");
    call(
        &v,
        "extension.install",
        json!({"manifest":{"kind":"plugin","id":"review","name":"Review","version":"1.0.0","commands":[{"id":"open","title":"Review timeline","action":{"type":"view","view":"timeline"}}]}}),
    );
    assert_eq!(
        call(&v, "extension.list", json!({}))
            .as_array()
            .unwrap()
            .len(),
        1
    );
    call(&v, "extension.remove", json!({"id":"review"}));
    assert_eq!(
        call(&v, "note.list", json!({})).as_array().unwrap().len(),
        1
    );
}
#[test]
fn initialization_never_overwrites_existing_files() {
    let v = tempfile::tempdir().unwrap();
    std::fs::write(v.path().join(".gitignore"), "important").unwrap();
    assert!(execute(
        v.path().to_str().unwrap(),
        "vault.init",
        json!({"name":"No"})
    )
    .is_err());
    assert_eq!(
        std::fs::read_to_string(v.path().join(".gitignore")).unwrap(),
        "important"
    );
}
#[test]
fn ids_and_command_arguments_are_validated() {
    let v = vault();
    assert!(execute(
        v.path().to_str().unwrap(),
        "note.read",
        json!({"id":"../../secret"})
    )
    .is_err());
    assert_eq!(
        execute(
            v.path().to_str().unwrap(),
            "note.create",
            json!({"title":"A","unknown":true})
        )
        .unwrap_err()
        .code,
        "invalid_arguments"
    );
}
#[test]
fn concurrent_writers_do_not_lose_created_records() {
    let v = vault();
    let db = db(&v);
    let root = v.path().to_str().unwrap().to_string();
    let database_id = db["id"].as_str().unwrap().to_string();
    std::thread::scope(|scope| {
        for i in 0..12 {
            let root = &root;
            let database_id = &database_id;
            scope.spawn(move || {
                execute(
                    root,
                    "record.create",
                    json!({"databaseId":database_id,"values":{"title":format!("Row {i}")}}),
                )
                .unwrap();
            });
        }
    });
    assert_eq!(
        call(&v, "query.run", json!({"databaseId":db["id"]}))["total"],
        12
    );
}
#[cfg(unix)]
#[test]
fn managed_symlinks_cannot_escape_the_vault() {
    let v = vault();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), v.path().join("notes")).unwrap();
    assert_eq!(
        execute(
            v.path().to_str().unwrap(),
            "note.create",
            json!({"title":"No"})
        )
        .unwrap_err()
        .code,
        "unsafe_path"
    );
    assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
}

#[test]
fn snapshot_roundtrip_restores_notes_rows_and_vault_identity() {
    let v = vault();
    let original = note(&v, "보존", "Backup content");
    let db = db(&v);
    call(
        &v,
        "record.create",
        json!({"databaseId":db["id"],"values":{"title":"Independent"}}),
    );
    let snapshot = call(&v, "vault.export", json!({}));
    let destination = tempfile::tempdir().unwrap();
    call(&destination, "vault.import", json!({"snapshot":snapshot}));
    assert_eq!(
        call(&destination, "note.read", json!({"id":original["id"]}))["body"],
        "Backup content"
    );
    assert_eq!(
        call(&destination, "query.run", json!({"databaseId":db["id"]}))["total"],
        1
    );
    assert_eq!(
        call(&destination, "workspace.get", json!({}))["vault"],
        call(&v, "workspace.get", json!({}))["vault"]
    );
}

#[test]
fn backup_rejects_path_escape_before_writing_any_originals() {
    let v = vault();
    let mut snapshot = call(&v, "vault.export", json!({}));
    snapshot["files"]["../outside.txt"] = json!("bad");
    let destination = tempfile::tempdir().unwrap();
    assert!(execute(
        destination.path().to_str().unwrap(),
        "vault.import",
        json!({"snapshot":snapshot})
    )
    .is_err());
    assert!(!destination.path().join(".foltra/vault.json").exists());
}

#[test]
fn plugin_commands_are_discoverable_and_headless_actions_use_the_core() {
    let v = vault();
    let manifest: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/plugins/daily-trail.json"
    ))
    .unwrap();
    call(&v, "extension.install", json!({"manifest":manifest}));
    let specs = call(&v, "commands.list", json!({}));
    assert!(specs
        .as_array()
        .unwrap()
        .iter()
        .any(|s| s["id"] == "plugin.daily-trail.new-reflection" && s["headless"] == true));
    let result = call(&v, "plugin.daily-trail.new-reflection", json!({}));
    assert_eq!(result["title"], "하루 돌아보기");
    assert_eq!(
        execute(
            v.path().to_str().unwrap(),
            "plugin.daily-trail.open-trail",
            json!({})
        )
        .unwrap_err()
        .code,
        "requires_ui"
    );
}
