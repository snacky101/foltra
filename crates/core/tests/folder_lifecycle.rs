use foltra_core::execute;
use serde_json::{json, Value};
use tempfile::TempDir;

fn call(v: &TempDir, command: &str, args: Value) -> Value {
    execute(v.path().to_str().unwrap(), command, args).unwrap()
}
fn fixture() -> (TempDir, Value) {
    let v = tempfile::tempdir().unwrap();
    call(&v, "vault.init", json!({"name":"Folder lifecycle"}));
    let folder = call(&v, "folder.create", json!({"name":"Projects"}));
    (v, folder)
}
fn child(v: &TempDir, parent: &Value, name: &str) -> Value {
    call(
        v,
        "folder.create",
        json!({"name":name,"parentId":parent["id"]}),
    )
}
fn note(v: &TempDir, folder: &Value, title: &str, body: &str) -> Value {
    call(
        v,
        "note.create",
        json!({"folderId":folder["id"],"title":title,"body":body}),
    )
}
fn inspect(v: &TempDir, folder: &Value) -> Value {
    call(v, "folder.inspect", json!({"id":folder["id"]}))
}
fn delete(v: &TempDir, folder: &Value) -> Value {
    call(
        v,
        "folder.delete",
        json!({"id":folder["id"],"expectedRevision":inspect(v,folder)["revision"]}),
    )
}
fn files(v: &TempDir) -> Value {
    call(v, "vault.export", json!({}))["files"].clone()
}
fn folder_path(folder: &Value) -> String {
    format!("folders/{}.json", folder["id"].as_str().unwrap())
}
fn note_path(note: &Value) -> String {
    format!("notes/{}.md", note["id"].as_str().unwrap())
}

#[test]
fn inspect_is_pure_and_empty_folder_raw_revision_remains_compatible() {
    let (v, root) = fixture();
    let before = files(&v);
    let inspected = inspect(&v, &root);
    assert_eq!(inspected["folder"], root);
    assert_eq!(inspected["revision"], root["revision"]);
    assert_eq!(inspected["folderCount"], 0);
    assert_eq!(inspected["noteCount"], 0);
    assert_eq!(files(&v), before);
    let removed = call(
        &v,
        "folder.delete",
        json!({"id":root["id"],"expectedRevision":root["revision"]}),
    );
    assert_eq!(call(&v, "folder.list", json!({})), json!([]));
    call(&v, "trash.restore", json!({"id":removed["trashId"]}));
    assert_eq!(files(&v), before);
}

#[test]
fn subtree_delete_restore_and_backup_preserve_raw_originals_and_unrelated_data() {
    let (v, root) = fixture();
    let branch = child(&v, &root, "Child");
    let leaf = child(&v, &branch, "Leaf");
    let direct = note(&v, &root, "Direct", "Raw body\n\n");
    note(&v, &leaf, "Leaf note", "Nested body");
    let other = call(&v, "folder.create", json!({"name":"Untouched"}));
    let other_note = note(&v, &other, "Other", "No relation");
    let db = call(&v, "database.create", json!({"name":"Tasks"}));
    let row = call(
        &v,
        "record.create",
        json!({"databaseId":db["id"],"values":{"title":"Linked"}}),
    );
    call(
        &v,
        "record.body",
        json!({"id":row["id"],"expectedRevision":row["revision"],"noteId":direct["id"]}),
    );
    // Noncanonical metadata bytes must survive the trash and backup roundtrip too.
    let raw = std::fs::read_to_string(v.path().join(note_path(&direct))).unwrap();
    std::fs::write(
        v.path().join(note_path(&direct)),
        raw.replacen("{", "{ ", 1),
    )
    .unwrap();
    let before = files(&v);
    let inspected = inspect(&v, &root);
    assert_eq!(inspected["folderCount"], 2);
    assert_eq!(inspected["noteCount"], 2);
    assert_eq!(files(&v), before);
    let removed = delete(&v, &root);
    let workspace = call(&v, "workspace.get", json!({}));
    assert_eq!(workspace["folders"], json!([other]));
    assert_eq!(workspace["notes"][0]["id"], other_note["id"]);
    assert_eq!(workspace["databases"], json!([db]));
    assert_eq!(workspace["records"][0]["bodyNoteId"], direct["id"]);
    let trash = &workspace["trash"];
    assert_eq!(trash.as_array().unwrap().len(), 1);
    assert_eq!(trash[0]["kind"], "folder");
    assert_eq!(trash[0]["folderCount"], 2);
    assert_eq!(trash[0]["noteCount"], 2);
    for key in ["content", "folders", "notes", "linkTargets"] {
        assert!(trash[0].get(key).is_none());
    }
    let after = files(&v);
    for key in [
        folder_path(&other),
        note_path(&other_note),
        format!("databases/{}.json", db["id"].as_str().unwrap()),
        format!("records/{}.json", row["id"].as_str().unwrap()),
    ] {
        assert_eq!(after[&key], before[&key]);
    }
    let backup = call(&v, "vault.export", json!({}));
    let destination = tempfile::tempdir().unwrap();
    call(&destination, "vault.import", json!({"snapshot":backup}));
    call(
        &destination,
        "trash.restore",
        json!({"id":removed["trashId"]}),
    );
    assert_eq!(files(&destination), before);
    call(&v, "trash.restore", json!({"id":removed["trashId"]}));
    assert_eq!(files(&v), before);
}

#[test]
fn subtree_revision_rejects_changes_to_contents_names_membership_and_new_children() {
    for change in [
        "note_edit",
        "note_add",
        "note_move_out",
        "note_delete",
        "folder_add",
        "folder_rename",
        "folder_move",
    ] {
        let (v, root) = fixture();
        let branch = child(&v, &root, "Child");
        let source = note(&v, &branch, "Source", "Before");
        let inspected = inspect(&v, &root);
        match change {
            "note_edit" => {
                call(
                    &v,
                    "note.update",
                    json!({"id":source["id"],"expectedRevision":source["revision"],"body":"After"}),
                );
            }
            "note_add" => {
                note(&v, &root, "Added", "");
            }
            "note_move_out" => {
                call(
                    &v,
                    "note.update",
                    json!({"id":source["id"],"expectedRevision":source["revision"],"folderId":""}),
                );
            }
            "note_delete" => {
                call(
                    &v,
                    "note.delete",
                    json!({"id":source["id"],"expectedRevision":source["revision"]}),
                );
            }
            "folder_add" => {
                child(&v, &branch, "New child");
            }
            "folder_rename" => {
                call(
                    &v,
                    "folder.update",
                    json!({"id":branch["id"],"expectedRevision":branch["revision"],"name":"Renamed"}),
                );
            }
            _ => {
                let mut content: Value = serde_json::from_str(
                    &std::fs::read_to_string(v.path().join(folder_path(&branch))).unwrap(),
                )
                .unwrap();
                content["parentId"] = Value::Null;
                std::fs::write(v.path().join(folder_path(&branch)), content.to_string()).unwrap();
            }
        }
        let before = files(&v);
        assert_eq!(
            execute(
                v.path().to_str().unwrap(),
                "folder.delete",
                json!({"id":root["id"],"expectedRevision":inspected["revision"]})
            )
            .unwrap_err()
            .code,
            "conflict",
            "{change}"
        );
        assert_eq!(files(&v), before);
    }
}

#[test]
fn batch_links_search_and_outgoing_destinations_survive_delete_and_later_renames() {
    let (v, root) = fixture();
    let external = call(
        &v,
        "note.create",
        json!({"title":"External","body":"Outside"}),
    );
    let a = note(&v, &root, "Alpha", "[[External|alias]] uniquealpha");
    let b = note(&v, &root, "Beta", "[[Alpha]] uniquebeta");
    let incoming = call(
        &v,
        "note.create",
        json!({"title":"Incoming","body":"[[Alpha]] and [[Beta|B]]"}),
    );
    assert_eq!(
        call(&v, "search", json!({"query":"uniquealpha"}))
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let removed = delete(&v, &root);
    let after = call(&v, "note.read", json!({"id":incoming["id"]}));
    assert!(after["body"]
        .as_str()
        .unwrap()
        .contains(a["id"].as_str().unwrap()));
    assert!(after["body"]
        .as_str()
        .unwrap()
        .contains(b["id"].as_str().unwrap()));
    assert_eq!(
        call(&v, "search", json!({"query":"uniquealpha"})),
        json!([])
    );
    call(
        &v,
        "note.update",
        json!({"id":external["id"],"expectedRevision":external["revision"],"title":"Renamed external"}),
    );
    // Reusing the old title must not hijack the trashed source's destination.
    call(
        &v,
        "note.create",
        json!({"title":"External","body":"Different note"}),
    );
    call(&v, "trash.restore", json!({"id":removed["trashId"]}));
    assert_eq!(
        call(&v, "note.read", json!({"id":a["id"]}))["body"],
        "[[Renamed external|alias]] uniquealpha"
    );
    let links = call(&v, "links.list", json!({}));
    for (source, target) in [(&incoming, &a), (&incoming, &b), (&b, &a), (&a, &external)] {
        assert!(links
            .as_array()
            .unwrap()
            .iter()
            .any(|link| link["source"] == source["id"] && link["target"] == target["id"]));
    }
    assert_eq!(
        call(&v, "search", json!({"query":"uniquealpha"}))
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn missing_parent_restores_at_root_and_same_name_collision_refuses_without_writes() {
    for conflict in [false, true] {
        let (v, parent) = fixture();
        let root = child(&v, &parent, "Child");
        let source = note(&v, &root, "Keep", "");
        let removed = delete(&v, &root);
        delete(&v, &parent);
        if conflict {
            call(&v, "folder.create", json!({"name":"Child"}));
        }
        let before = files(&v);
        let result = execute(
            v.path().to_str().unwrap(),
            "trash.restore",
            json!({"id":removed["trashId"]}),
        );
        if conflict {
            assert_eq!(result.unwrap_err().code, "folder_exists");
            assert_eq!(files(&v), before);
        } else {
            assert_eq!(result.unwrap()["restoredAtRoot"], true);
            let tree = call(&v, "folder.list", json!({}));
            assert_eq!(tree[0]["id"], root["id"]);
            assert!(tree[0]["parentId"].is_null());
            assert_eq!(call(&v, "note.read", json!({"id":source["id"]})), source);
        }
    }
}

#[test]
fn restore_refuses_root_child_note_and_sibling_name_collisions_atomically() {
    for collision in ["root", "child", "note", "name"] {
        let (v, root) = fixture();
        let branch = child(&v, &root, "Child");
        let source = note(&v, &branch, "Source", "");
        let originals = files(&v);
        let removed = delete(&v, &root);
        match collision {
            "name" => {
                call(&v, "folder.create", json!({"name":"Projects"}));
            }
            _ => {
                let path = match collision {
                    "root" => folder_path(&root),
                    "child" => folder_path(&branch),
                    _ => note_path(&source),
                };
                std::fs::write(v.path().join(&path), originals[&path].as_str().unwrap()).unwrap();
            }
        }
        let before = files(&v);
        let error = execute(
            v.path().to_str().unwrap(),
            "trash.restore",
            json!({"id":removed["trashId"]}),
        )
        .unwrap_err();
        assert_eq!(
            error.code,
            if collision == "name" {
                "folder_exists"
            } else {
                "conflict"
            }
        );
        assert_eq!(files(&v), before);
    }
}

#[test]
fn malformed_folder_bundles_never_restore_or_import_partial_files() {
    for problem in [
        "root_path",
        "child_path",
        "note_path",
        "note_owner",
        "child_owner",
        "cycle",
        "duplicate",
        "count",
        "target",
    ] {
        let (v, root) = fixture();
        let branch = child(&v, &root, "Child");
        note(&v, &branch, "Source", "");
        let removed = delete(&v, &root);
        let path = format!("trash/{}.json", removed["trashId"].as_str().unwrap());
        let mut item: Value =
            serde_json::from_str(&std::fs::read_to_string(v.path().join(&path)).unwrap()).unwrap();
        match problem {
            "root_path" => item["originalPath"] = json!(".foltra/settings.json"),
            "child_path" => item["folders"][0]["originalPath"] = json!("../outside.json"),
            "note_path" => item["notes"][0]["originalPath"] = json!("records/other.json"),
            "note_owner" => {
                item["notes"][0]["content"] =
                    json!(item["notes"][0]["content"].as_str().unwrap().replace(
                        branch["id"].as_str().unwrap(),
                        "00000000-0000-0000-0000-000000000000"
                    ))
            }
            "child_owner" | "cycle" => {
                let mut folder: Value =
                    serde_json::from_str(item["folders"][0]["content"].as_str().unwrap()).unwrap();
                folder["parentId"] = if problem == "cycle" {
                    folder["id"].clone()
                } else {
                    Value::Null
                };
                item["folders"][0]["content"] = json!(folder.to_string());
            }
            "duplicate" => {
                let entry = item["notes"][0].clone();
                item["notes"].as_array_mut().unwrap().push(entry);
                item["noteCount"] = json!(2);
            }
            "count" => item["folderCount"] = json!(42),
            _ => item["linkTargets"] = json!([]),
        }
        std::fs::write(v.path().join(&path), item.to_string()).unwrap();
        let before = files(&v);
        assert!(
            execute(
                v.path().to_str().unwrap(),
                "trash.restore",
                json!({"id":removed["trashId"]})
            )
            .is_err(),
            "{problem}"
        );
        assert_eq!(files(&v), before);
        let backup = call(&v, "vault.export", json!({}));
        let destination = tempfile::tempdir().unwrap();
        assert!(
            execute(
                destination.path().to_str().unwrap(),
                "vault.import",
                json!({"snapshot":backup})
            )
            .is_err(),
            "{problem}"
        );
        assert!(!destination.path().join(".foltra/vault.json").exists());
    }
}

#[test]
fn oversized_bundle_fails_before_deleting_any_folder_or_note() {
    let (v, root) = fixture();
    for index in 0..2 {
        let source = note(&v, &root, &format!("Large {index}"), "");
        let path = v.path().join(note_path(&source));
        let mut raw = std::fs::read_to_string(&path).unwrap();
        raw.push_str(&"x".repeat(9 * 1024 * 1024));
        std::fs::write(path, raw).unwrap();
    }
    let before = inspect(&v, &root);
    assert_eq!(
        execute(
            v.path().to_str().unwrap(),
            "folder.delete",
            json!({"id":root["id"],"expectedRevision":before["revision"]})
        )
        .unwrap_err()
        .code,
        "file_too_large"
    );
    assert_eq!(inspect(&v, &root), before);
    assert_eq!(call(&v, "trash.list", json!({})), json!([]));
}
