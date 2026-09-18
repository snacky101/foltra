use foltra_core::execute;
use serde_json::{json, Value};
use tempfile::TempDir;

fn call(v: &TempDir, command: &str, args: Value) -> Value {
    execute(v.path().to_str().unwrap(), command, args).unwrap()
}
fn files(v: &TempDir) -> Value {
    call(v, "vault.export", json!({}))["files"].clone()
}
fn trash_path(item: &Value) -> String {
    format!("trash/{}.json", item["id"].as_str().unwrap())
}
fn fixture(kind: &str) -> (TempDir, Value) {
    let v = tempfile::tempdir().unwrap();
    call(&v, "vault.init", json!({"name":"Disposable trash"}));
    call(
        &v,
        "note.create",
        json!({"title":"Untouched", "body":"# Original\n\nPreserve me."}),
    );
    let removed = match kind {
        "folder" => {
            let parent = call(&v, "folder.create", json!({"name":"Research"}));
            let child = call(
                &v,
                "folder.create",
                json!({"name":"Nested", "parentId":parent["id"]}),
            );
            call(
                &v,
                "note.create",
                json!({"title":"Nested note", "body":"Nested content", "folderId":child["id"]}),
            );
            let inspected = call(&v, "folder.inspect", json!({"id":parent["id"]}));
            call(
                &v,
                "folder.delete",
                json!({"id":parent["id"],"expectedRevision":inspected["revision"]}),
            )
        }
        "database" | "record" => {
            let db = call(&v, "database.create", json!({"name":"Cards"}));
            let row = call(
                &v,
                "record.create",
                json!({"databaseId":db["id"], "values":{"title":"Front"}}),
            );
            call(
                &v,
                "record.body",
                json!({"id":row["id"],"expectedRevision":row["revision"],"body":"Linked note stays"}),
            );
            if kind == "database" {
                let inspected = call(&v, "database.inspect", json!({"id":db["id"]}));
                call(
                    &v,
                    "database.delete",
                    json!({"id":db["id"],"expectedRevision":inspected["revision"]}),
                )
            } else {
                let rows = call(&v, "query.run", json!({"databaseId":db["id"]}));
                let row = &rows["rows"][0];
                call(
                    &v,
                    "record.delete",
                    json!({"id":row["id"],"expectedRevision":row["revision"]}),
                )
            }
        }
        _ => {
            let note = call(
                &v,
                "note.create",
                json!({"title":"Deleted note", "body":"Deleted content"}),
            );
            call(
                &v,
                "note.delete",
                json!({"id":note["id"],"expectedRevision":note["revision"]}),
            )
        }
    };
    let item = call(&v, "trash.list", json!({}))[0].clone();
    assert_eq!(item["kind"], kind);
    if matches!(kind, "database" | "folder") {
        assert_eq!(item["id"], removed["trashId"]);
    } else {
        let directory = if kind == "note" { "notes" } else { "records" };
        let extension = if kind == "note" { "md" } else { "json" };
        assert_eq!(
            item["originalPath"],
            format!(
                "{directory}/{}.{extension}",
                removed["deleted"].as_str().unwrap()
            )
        );
    }
    (v, item)
}

#[test]
fn list_and_workspace_expose_revision_without_saved_payload_or_metadata_mutation() {
    for kind in ["note", "record", "database", "folder"] {
        let (v, item) = fixture(kind);
        let before = files(&v);
        let revision = item["revision"].as_str().unwrap();
        assert_eq!(revision.len(), 64);
        assert!(revision.bytes().all(|byte| byte.is_ascii_hexdigit()));
        for field in ["content", "records", "folders", "notes", "linkTargets"] {
            assert!(item.get(field).is_none());
        }
        assert_eq!(call(&v, "workspace.get", json!({}))["trash"], json!([item]));
        assert_eq!(files(&v), before);
        let saved: Value =
            serde_json::from_str(before[trash_path(&item)].as_str().unwrap()).unwrap();
        assert!(saved.get("revision").is_none());
    }
}

#[test]
fn permanent_delete_only_removes_selected_trash_file_for_all_four_kinds() {
    for kind in ["note", "record", "database", "folder"] {
        let (v, item) = fixture(kind);
        let other = call(
            &v,
            "note.create",
            json!({"title":"Another deleted note","body":"Keep in trash"}),
        );
        call(
            &v,
            "note.delete",
            json!({"id":other["id"],"expectedRevision":other["revision"]}),
        );
        let mut expected = files(&v);
        let path = trash_path(&item);
        expected.as_object_mut().unwrap().remove(&path).unwrap();
        let result = call(
            &v,
            "trash.delete",
            json!({"id":item["id"],"expectedRevision":item["revision"]}),
        );
        assert_eq!(result["deleted"], item["id"]);
        assert_eq!(
            files(&v),
            expected,
            "all unrelated files and linked notes must stay byte-identical for {kind}"
        );
        assert_eq!(
            call(&v, "trash.list", json!({})).as_array().unwrap().len(),
            1
        );
        assert!(!v.path().join(path).exists());
        assert!(!v.path().join(".foltra/local/pending.json").exists());
    }
}

#[test]
fn changed_original_rejects_delete_and_revision_aware_restore_without_writes() {
    for kind in ["note", "record", "database", "folder"] {
        let (v, item) = fixture(kind);
        let path = v.path().join(trash_path(&item));
        let mut original: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        original["title"] = json!("Changed after list");
        std::fs::write(path, original.to_string()).unwrap();
        let before = files(&v);
        for command in ["trash.delete", "trash.restore"] {
            let error = execute(
                v.path().to_str().unwrap(),
                command,
                json!({"id":item["id"],"expectedRevision":item["revision"]}),
            )
            .unwrap_err();
            assert_eq!(error.code, "conflict");
            assert_eq!(files(&v), before);
        }
        assert_ne!(
            call(&v, "trash.list", json!({}))[0]["revision"],
            item["revision"]
        );
    }
}

#[test]
fn restore_with_current_revision_preserves_originals_and_stale_delete_cannot_remove_restored_files()
{
    for kind in ["note", "record", "database", "folder"] {
        let (v, item) = fixture(kind);
        call(
            &v,
            "trash.restore",
            json!({"id":item["id"],"expectedRevision":item["revision"]}),
        );
        let before = files(&v);
        assert!(execute(
            v.path().to_str().unwrap(),
            "trash.delete",
            json!({"id":item["id"],"expectedRevision":item["revision"]})
        )
        .is_err());
        assert_eq!(files(&v), before);
        assert_eq!(call(&v, "trash.list", json!({})), json!([]));
    }
}

#[test]
fn permanent_delete_requires_revision_and_rejects_path_traversal() {
    let (v, item) = fixture("note");
    let before = files(&v);
    for args in [
        json!({"id":item["id"]}),
        json!({"id":item["id"],"expectedRevision":null}),
        json!({"id":"../notes/anything", "expectedRevision":item["revision"]}),
    ] {
        assert!(execute(v.path().to_str().unwrap(), "trash.delete", args).is_err());
        assert_eq!(files(&v), before);
    }
}

#[test]
fn mismatched_id_and_unknown_kind_are_not_deleted_and_original_path_is_never_followed() {
    for corrupt in ["id", "kind"] {
        let (v, item) = fixture("note");
        let path = v.path().join(trash_path(&item));
        let mut original: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        original[corrupt] = json!("unexpected");
        std::fs::write(&path, original.to_string()).unwrap();
        let revised = call(&v, "trash.list", json!({}))[0].clone();
        let before = files(&v);
        let error = execute(
            v.path().to_str().unwrap(),
            "trash.delete",
            json!({"id":item["id"],"expectedRevision":revised["revision"]}),
        )
        .unwrap_err();
        assert_eq!(error.code, "invalid_data");
        assert_eq!(files(&v), before);
    }
    let (v, item) = fixture("note");
    let path = v.path().join(trash_path(&item));
    let mut original: Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    original["originalPath"] = json!(".foltra/vault.json");
    std::fs::write(path, original.to_string()).unwrap();
    let item = call(&v, "trash.list", json!({}))[0].clone();
    let mut expected = files(&v);
    expected.as_object_mut().unwrap().remove(&trash_path(&item));
    call(
        &v,
        "trash.delete",
        json!({"id":item["id"],"expectedRevision":item["revision"]}),
    );
    assert_eq!(files(&v), expected);
}
