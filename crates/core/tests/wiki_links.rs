use foltra_core::execute;
use serde_json::{json, Value};
use tempfile::TempDir;

fn vault() -> TempDir {
    let v = tempfile::tempdir().unwrap();
    call(&v, "vault.init", json!({"name":"Links"}));
    v
}
fn call(v: &TempDir, command: &str, args: Value) -> Value {
    execute(v.path().to_str().unwrap(), command, args).unwrap()
}
fn note(v: &TempDir, title: &str, body: &str) -> Value {
    call(v, "note.create", json!({"title":title,"body":body}))
}
fn read(v: &TempDir, n: &Value) -> Value {
    call(v, "note.read", json!({"id":n["id"]}))
}

#[test]
fn readable_targets_and_explicit_aliases_survive_save_rename_and_topic_grouping() {
    let v = vault();
    let target = note(&v, "노트이름", "");
    note(&v, "foo", "Different note");
    let source = note(
        &v,
        "Journal",
        "- [[노트이름]]\n- [[노트이름|foo]]\n  - detail\n- [[노트이름#^anchor|근거]]",
    );
    assert_eq!(
        source["body"],
        "- [[노트이름]]\n- [[노트이름|foo]]\n  - detail\n- [[노트이름#^anchor|근거]]"
    );
    assert_eq!(
        call(&v, "note.link", json!({"id":target["id"]})),
        "[[노트이름]]"
    );
    let renamed = call(
        &v,
        "note.update",
        json!({"id":target["id"],"expectedRevision":target["revision"],"title":"새이름"}),
    );
    assert_eq!(renamed["id"], target["id"]);
    let saved = read(&v, &source);
    assert_eq!(
        saved["body"],
        "- [[새이름]]\n- [[새이름|foo]]\n  - detail\n- [[새이름#^anchor|근거]]"
    );
    let links = call(&v, "backlinks.list", json!({"target":target["id"]}));
    assert_eq!(links.as_array().unwrap().len(), 3);
    assert_eq!(links[1]["label"], "foo");
    assert_eq!(links[2]["block"], "anchor");
    let topics = call(&v, "topics.list", json!({}));
    assert_eq!(topics.as_array().unwrap().len(), 1);
    assert_eq!(topics[0]["noteId"], target["id"]);
    assert_eq!(topics[0]["blockCount"], 3);
    assert_eq!(
        execute(
            v.path().to_str().unwrap(),
            "note.update",
            json!({"id":source["id"],"expectedRevision":source["revision"],"body":"Stale draft"})
        )
        .unwrap_err()
        .code,
        "conflict"
    );
    assert_eq!(read(&v, &source), saved);
}

#[test]
fn legacy_ids_shorten_on_save_without_losing_alias_or_modifying_literal_examples() {
    let v = vault();
    let target = note(&v, "Target", "");
    let source = note(&v, "Source", "");
    let id = target["id"].as_str().unwrap();
    let body = format!("[[{id}]] [[{id}|Target]] [[{id}#^block|custom]]\n\n`[[{id}|code]]`\n\n```md\n[[{id}]]\n```\n\n    [[{id}]]\n\n<!-- [[{id}]] -->\n\\[[{id}]]\n[web](https://example.com/[[{id}]])\n");
    // Model an existing file from an earlier version, not a create command that already normalizes it.
    let path = v
        .path()
        .join(format!("notes/{}.md", source["id"].as_str().unwrap()));
    let raw = std::fs::read_to_string(&path).unwrap();
    std::fs::write(&path, format!("{raw}{body}")).unwrap();
    let old = read(&v, &source);
    assert_eq!(old["body"], body);
    assert_eq!(
        call(&v, "backlinks.list", json!({"target":target["id"]}))
            .as_array()
            .unwrap()
            .len(),
        3
    );
    let updated = call(
        &v,
        "note.update",
        json!({"id":source["id"],"expectedRevision":old["revision"],"body":body}),
    );
    let expected = body.replacen(
        &format!("[[{id}]] [[{id}|Target]] [[{id}#^block|custom]]"),
        "[[Target]] [[Target|Target]] [[Target#^block|custom]]",
        1,
    );
    assert_eq!(updated["body"], expected);
    assert!(std::fs::read_to_string(path).unwrap().ends_with(&expected));
}

#[test]
fn creating_and_renaming_duplicate_titles_preserves_existing_targets() {
    let v = vault();
    let first = note(&v, "Same", "");
    let source = note(&v, "Source", "[[Same|first]]");
    let second = note(&v, "Same", "");
    let first_id = first["id"].as_str().unwrap();
    assert_eq!(read(&v, &source)["body"], format!("[[{first_id}|first]]"));
    assert_eq!(
        call(&v, "note.link", json!({"id":second["id"]})),
        format!("[[{}|Same]]", second["id"].as_str().unwrap())
    );
    let ambiguous = note(&v, "Ambiguous", "[[Same]]");
    assert_eq!(read(&v, &ambiguous)["body"], "[[Same]]");
    let links = call(&v, "links.list", json!({}));
    assert!(links
        .as_array()
        .unwrap()
        .iter()
        .any(|l| l["source"] == ambiguous["id"] && l["target"].is_null()));
    call(
        &v,
        "note.update",
        json!({"id":second["id"],"expectedRevision":second["revision"],"title":"Other"}),
    );
    assert_eq!(read(&v, &source)["body"], "[[Same|first]]");
    assert_eq!(
        call(&v, "backlinks.list", json!({"target":first["id"]}))
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn delete_recreate_and_restore_do_not_redirect_links_and_restore_aliases() {
    let v = vault();
    let target = note(&v, "Target", "");
    let source = note(&v, "Source", "- [[Target|foo]]");
    call(
        &v,
        "note.delete",
        json!({"id":target["id"],"expectedRevision":target["revision"]}),
    );
    assert_eq!(
        read(&v, &source)["body"],
        format!("- [[{}|foo]]", target["id"].as_str().unwrap())
    );
    let replacement = note(&v, "Target", "");
    assert_eq!(
        call(&v, "backlinks.list", json!({"target":replacement["id"]})),
        json!([])
    );
    let replacement_source = note(&v, "Replacement source", "[[Target]]");
    let trash = call(&v, "trash.list", json!({}));
    call(&v, "trash.restore", json!({"id":trash[0]["id"]}));
    assert_eq!(
        call(&v, "backlinks.list", json!({"target":target["id"]}))[0]["source"],
        source["id"]
    );
    assert_eq!(
        call(&v, "backlinks.list", json!({"target":replacement["id"]}))[0]["source"],
        replacement_source["id"]
    );
}

#[test]
fn trashed_source_keeps_outgoing_targets_when_the_target_is_renamed() {
    let v = vault();
    let target = note(&v, "Target", "");
    let source = note(&v, "Source", "[[Target|foo]]");
    call(
        &v,
        "note.delete",
        json!({"id":source["id"],"expectedRevision":source["revision"]}),
    );
    call(
        &v,
        "note.update",
        json!({"id":target["id"],"expectedRevision":target["revision"],"title":"New title"}),
    );
    let trash = call(&v, "trash.list", json!({}));
    call(&v, "trash.restore", json!({"id":trash[0]["id"]}));
    assert_eq!(read(&v, &source)["body"], "[[New title|foo]]");
}

#[test]
fn same_write_self_links_and_stale_rename_preserve_atomicity() {
    let v = vault();
    let source = note(&v, "Self", "[[Self|me]]");
    let updated = call(
        &v,
        "note.update",
        json!({"id":source["id"],"expectedRevision":source["revision"],"title":"Changed","body":"[[Self]] [[Self|me]] [[Changed|new]]"}),
    );
    assert_eq!(
        updated["body"],
        "[[Changed]] [[Changed|me]] [[Changed|new]]"
    );
    let snapshot = call(&v, "vault.export", json!({}));
    assert_eq!(
        execute(
            v.path().to_str().unwrap(),
            "note.update",
            json!({"id":source["id"],"expectedRevision":source["revision"],"title":"Bad"})
        )
        .unwrap_err()
        .code,
        "conflict"
    );
    assert_eq!(
        call(&v, "vault.export", json!({}))["files"],
        snapshot["files"]
    );
}

#[test]
fn duplicate_record_body_creation_uses_the_same_link_preservation_rules() {
    let v = vault();
    let target = note(&v, "Task", "");
    let source = note(&v, "Source", "[[Task|original]]");
    let db = call(&v, "database.create", json!({"name":"Tasks"}));
    let row = call(
        &v,
        "record.create",
        json!({"databaseId":db["id"],"values":{"title":"Task"}}),
    );
    let body = call(
        &v,
        "record.body",
        json!({"id":row["id"],"expectedRevision":row["revision"],"body":"[[Task]]"}),
    );
    assert_eq!(body["body"], "[[Task]]"); // Ambiguous input never picks the older note arbitrarily.
    assert_eq!(
        read(&v, &source)["body"],
        format!("[[{}|original]]", target["id"].as_str().unwrap())
    );
    assert_eq!(
        call(&v, "backlinks.list", json!({"target":target["id"]}))[0]["source"],
        source["id"]
    );
}

#[test]
fn unsafe_titles_and_id_shadows_generate_unambiguous_links_and_keep_full_alias_text() {
    let v = vault();
    let target = note(&v, "Target", "");
    for title in [
        "A|B",
        "A#B",
        "A[B]",
        "record:example",
        target["id"].as_str().unwrap(),
    ] {
        let n = note(&v, title, "");
        let link = call(&v, "note.link", json!({"id":n["id"]}));
        assert!(link
            .as_str()
            .unwrap()
            .starts_with(&format!("[[{}|", n["id"].as_str().unwrap())));
        let source = note(&v, "Citation", link.as_str().unwrap());
        assert_eq!(
            call(&v, "backlinks.list", json!({"target":n["id"]}))[0]["source"],
            source["id"]
        );
    }
    let source = note(&v, "Alias", "[[Target|foo | bar]]");
    assert_eq!(source["body"], "[[Target|foo | bar]]");
    let links = call(&v, "backlinks.list", json!({"target":target["id"]}));
    assert_eq!(links[0]["label"], "foo | bar");
}
