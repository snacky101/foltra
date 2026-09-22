use foltra_core::execute;
use serde_json::{json, Value};
use tempfile::TempDir;

fn call(v: &TempDir, command: &str, args: Value) -> Value {
    execute(v.path().to_str().unwrap(), command, args).unwrap()
}
fn vault() -> TempDir {
    let v = tempfile::tempdir().unwrap();
    call(&v, "vault.init", json!({"name":"Folders"}));
    v
}
fn reject(v: &TempDir, command: &str, args: Value, code: &str) {
    assert_eq!(
        execute(v.path().to_str().unwrap(), command, args)
            .unwrap_err()
            .code,
        code
    );
}

#[test]
fn moving_and_renaming_preserve_note_identity_body_and_links() {
    let v = vault();
    let parent = call(&v, "folder.create", json!({"name":"Projects"}));
    let child = call(
        &v,
        "folder.create",
        json!({"name":"Foltra", "parentId":parent["id"]}),
    );
    let note = call(
        &v,
        "note.create",
        json!({"title":"Design", "body":"Exact body\n\n"}),
    );
    call(
        &v,
        "note.create",
        json!({"title":"Link", "body":format!("[[{}|Design]]", note["id"].as_str().unwrap())}),
    );
    let moved = call(
        &v,
        "note.update",
        json!({"id":note["id"],"expectedRevision":note["revision"],"folderId":child["id"]}),
    );
    let renamed = call(
        &v,
        "folder.update",
        json!({"id":child["id"],"expectedRevision":child["revision"],"name":"Product"}),
    );
    assert_eq!(moved["id"], note["id"]);
    assert_eq!(moved["body"], note["body"]);
    assert_eq!(moved["folderId"], renamed["id"]);
    assert_eq!(call(&v, "links.list", json!({}))[0]["target"], note["id"]);
    reject(
        &v,
        "folder.update",
        json!({"id":child["id"],"expectedRevision":child["revision"],"name":"Stale"}),
        "conflict",
    );
    reject(
        &v,
        "folder.delete",
        json!({"id":parent["id"],"expectedRevision":parent["revision"]}),
        "conflict",
    );
    reject(
        &v,
        "folder.delete",
        json!({"id":renamed["id"],"expectedRevision":renamed["revision"]}),
        "conflict",
    );
    let root = call(
        &v,
        "note.update",
        json!({"id":moved["id"],"expectedRevision":moved["revision"],"folderId":""}),
    );
    assert!(root["folderId"].is_null());
    assert_eq!(root["body"], note["body"]);
    call(
        &v,
        "folder.delete",
        json!({"id":renamed["id"],"expectedRevision":renamed["revision"]}),
    );
    call(
        &v,
        "folder.delete",
        json!({"id":parent["id"],"expectedRevision":parent["revision"]}),
    );
    assert_eq!(call(&v, "folder.list", json!({})), json!([]));
}

#[test]
fn workspace_trash_updates_for_notes_records_and_restores_without_missing_folder() {
    let v = vault();
    let folder = call(&v, "folder.create", json!({"name":"Archive"}));
    let note = call(
        &v,
        "note.create",
        json!({"title":"Keep", "body":"preserved", "folderId":folder["id"]}),
    );
    let db = call(&v, "database.create", json!({"name":"Tasks"}));
    let row = call(
        &v,
        "record.create",
        json!({"databaseId":db["id"],"values":{"title":"Task"}}),
    );
    call(
        &v,
        "note.delete",
        json!({"id":note["id"],"expectedRevision":note["revision"]}),
    );
    call(
        &v,
        "record.delete",
        json!({"id":row["id"],"expectedRevision":row["revision"]}),
    );
    let ws = call(&v, "workspace.get", json!({}));
    assert_eq!(ws["notes"], json!([]));
    assert_eq!(ws["records"], json!([]));
    assert_eq!(ws["trash"].as_array().unwrap().len(), 2);
    assert!(ws["trash"]
        .as_array()
        .unwrap()
        .iter()
        .all(|i| i.get("content").is_none()));
    call(
        &v,
        "folder.delete",
        json!({"id":folder["id"],"expectedRevision":folder["revision"]}),
    );
    for item in ws["trash"].as_array().unwrap() {
        call(&v, "trash.restore", json!({"id":item["id"]}));
    }
    let ws = call(&v, "workspace.get", json!({}));
    assert_eq!(ws["trash"].as_array().unwrap().len(), 1);
    assert_eq!(ws["trash"][0]["kind"], "folder");
    assert_eq!(ws["notes"][0]["id"], note["id"]);
    assert!(ws["notes"][0]["folderId"].is_null());
    assert_eq!(
        call(&v, "note.read", json!({"id":note["id"]}))["body"],
        note["body"]
    );
    assert_eq!(ws["records"][0]["id"], row["id"]);
}

#[test]
fn folder_backup_roundtrip_and_invalid_hierarchy_are_atomic() {
    let v = vault();
    let folder = call(&v, "folder.create", json!({"name":"Work"}));
    let child = call(
        &v,
        "folder.create",
        json!({"name":"Drafts","parentId":folder["id"]}),
    );
    let note = call(
        &v,
        "note.create",
        json!({"title":"Draft","folderId":child["id"]}),
    );
    reject(&v, "folder.create", json!({"name":"Work"}), "folder_exists");
    reject(
        &v,
        "note.update",
        json!({"id":note["id"],"expectedRevision":note["revision"],"folderId":"missing"}),
        "not_found",
    );
    let snapshot = call(&v, "vault.export", json!({}));
    let restored = tempfile::tempdir().unwrap();
    call(&restored, "vault.import", json!({"snapshot":snapshot}));
    assert_eq!(
        call(&restored, "folder.list", json!({})),
        call(&v, "folder.list", json!({}))
    );
    assert_eq!(call(&restored, "note.read", json!({"id":note["id"]})), note);
    let mut cyclic = snapshot.clone();
    let key = format!("folders/{}.json", folder["id"].as_str().unwrap());
    let mut value: Value = serde_json::from_str(cyclic["files"][&key].as_str().unwrap()).unwrap();
    value["parentId"] = child["id"].clone();
    cyclic["files"][&key] = json!(value.to_string());
    let dest = tempfile::tempdir().unwrap();
    reject(
        &dest,
        "vault.import",
        json!({"snapshot":cyclic}),
        "invalid_folder",
    );
    assert!(!dest.path().join(".foltra/vault.json").exists());
    let mut missing = snapshot;
    missing["files"]
        .as_object_mut()
        .unwrap()
        .remove(&format!("folders/{}.json", child["id"].as_str().unwrap()));
    reject(
        &dest,
        "vault.import",
        json!({"snapshot":missing}),
        "invalid_backup",
    );
    assert!(!dest.path().join("notes").exists());
}

#[test]
fn moving_a_folder_only_changes_its_parent_and_preserves_the_entire_subtree() {
    let v = vault();
    let parent = call(&v, "folder.create", json!({"name":"Projects"}));
    let target = call(&v, "folder.create", json!({"name":"Archive"}));
    let child = call(
        &v,
        "folder.create",
        json!({"name":"Nested","parentId":parent["id"]}),
    );
    let note = call(
        &v,
        "note.create",
        json!({"title":"Draft","body":"Exact content\n", "folderId":child["id"]}),
    );
    call(
        &v,
        "note.create",
        json!({"title":"Reference","body":"[[Draft]]"}),
    );
    let original = call(&v, "vault.export", json!({}))["files"].clone();
    let links = call(&v, "links.list", json!({}));
    let file = format!("folders/{}.json", parent["id"].as_str().unwrap());
    let mut current = parent.clone();
    for destination in [target["id"].clone(), json!("")] {
        current = call(
            &v,
            "folder.update",
            json!({"id":current["id"],"name":current["name"],"expectedRevision":current["revision"],"parentId":destination}),
        );
        assert_eq!(current["id"], parent["id"]);
        assert_eq!(current["name"], parent["name"]);
        assert_eq!(
            current["parentId"],
            if destination == "" {
                Value::Null
            } else {
                destination
            }
        );
        let after = call(&v, "vault.export", json!({}))["files"].clone();
        assert_eq!(
            after.as_object().unwrap().len(),
            original.as_object().unwrap().len()
        );
        for (path, content) in original.as_object().unwrap() {
            if path != &file {
                assert_eq!(&after[path], content, "unexpected write: {path}");
            }
        }
        assert_eq!(call(&v, "note.read", json!({"id":note["id"]})), note);
        assert_eq!(call(&v, "links.list", json!({})), links);
        let snapshot = call(&v, "vault.export", json!({}));
        let restored = tempfile::tempdir().unwrap();
        call(&restored, "vault.import", json!({"snapshot":snapshot}));
        assert_eq!(
            call(&restored, "folder.list", json!({})),
            call(&v, "folder.list", json!({}))
        );
    }
}

#[test]
fn folder_moves_reject_cycles_duplicates_missing_parents_and_stale_revisions_without_writes() {
    let v = vault();
    let parent = call(&v, "folder.create", json!({"name":"Projects"}));
    let child = call(
        &v,
        "folder.create",
        json!({"name":"Child","parentId":parent["id"]}),
    );
    let grandchild = call(
        &v,
        "folder.create",
        json!({"name":"Grandchild","parentId":child["id"]}),
    );
    let target = call(&v, "folder.create", json!({"name":"Archive"}));
    call(
        &v,
        "folder.create",
        json!({"name":"Projects","parentId":target["id"]}),
    );
    let before = call(&v, "vault.export", json!({}))["files"].clone();
    for (destination, code) in [
        (parent["id"].clone(), "invalid_folder"),
        (child["id"].clone(), "invalid_folder"),
        (grandchild["id"].clone(), "invalid_folder"),
        (target["id"].clone(), "folder_exists"),
        (json!("missing"), "not_found"),
    ] {
        reject(
            &v,
            "folder.update",
            json!({"id":parent["id"],"name":parent["name"],"expectedRevision":parent["revision"],"parentId":destination}),
            code,
        );
        assert_eq!(call(&v, "vault.export", json!({}))["files"], before);
    }
    call(
        &v,
        "folder.update",
        json!({"id":child["id"],"name":"Changed","expectedRevision":child["revision"]}),
    );
    let before = call(&v, "vault.export", json!({}))["files"].clone();
    reject(
        &v,
        "folder.update",
        json!({"id":child["id"],"name":child["name"],"expectedRevision":child["revision"],"parentId":""}),
        "conflict",
    );
    assert_eq!(call(&v, "vault.export", json!({}))["files"], before);
}
