use foltra_core::execute;
use serde_json::{json, Value};
use tempfile::TempDir;

fn call(v: &TempDir, command: &str, args: Value) -> Value {
    execute(v.path().to_str().unwrap(), command, args).unwrap()
}
fn fixture() -> (TempDir, Value) {
    let v = tempfile::tempdir().unwrap();
    call(&v, "vault.init", json!({"name":"Database lifecycle"}));
    let db = call(&v, "database.create", json!({"name":"Tasks"}));
    (v, db)
}
fn row(v: &TempDir, db: &Value, title: &str) -> Value {
    call(
        v,
        "record.create",
        json!({"databaseId":db["id"],"values":{"title":title}}),
    )
}
fn inspect(v: &TempDir, db: &Value) -> Value {
    call(v, "database.inspect", json!({"id":db["id"]}))
}
fn delete(v: &TempDir, db: &Value) -> Value {
    call(
        v,
        "database.delete",
        json!({"id":db["id"],"expectedRevision":inspect(v, db)["revision"]}),
    )
}
fn files(v: &TempDir) -> Value {
    call(v, "vault.export", json!({}))["files"].clone()
}
fn path(kind: &str, item: &Value) -> String {
    format!("{kind}/{}.json", item["id"].as_str().unwrap())
}

#[test]
fn inspect_is_pure_and_rename_keeps_identity_rows_and_unknown_schema_fields() {
    let (v, db) = fixture();
    let record = row(&v, &db, "Own row");
    let mut schema = db.clone();
    schema["custom"] = json!({"preserve":true});
    std::fs::write(v.path().join(path("databases", &db)), schema.to_string()).unwrap();
    let before = files(&v);
    let inspected = inspect(&v, &db);
    assert_eq!(inspected["database"], db);
    assert_eq!(inspected["recordCount"], 1);
    assert_eq!(files(&v), before);
    let renamed = call(
        &v,
        "database.rename",
        json!({"id":db["id"],"name":"  새 이름  ","expectedRevision":inspected["revision"]}),
    );
    assert_eq!(renamed["id"], db["id"]);
    assert_eq!(renamed["name"], "새 이름");
    assert_eq!(renamed["properties"], db["properties"]);
    assert_eq!(renamed["createdAt"], db["createdAt"]);
    let after = files(&v);
    assert_eq!(
        after[path("records", &record)],
        before[path("records", &record)]
    );
    assert_eq!(
        serde_json::from_str::<Value>(after[path("databases", &db)].as_str().unwrap()).unwrap()
            ["custom"],
        schema["custom"]
    );
    assert_ne!(inspect(&v, &db)["revision"], inspected["revision"]);
    assert_eq!(call(&v, "note.list", json!({})), json!([]));
}

#[test]
fn delete_and_restore_all_rows_as_one_item_preserving_linked_notes_and_other_database() {
    let (v, db) = fixture();
    let record = row(&v, &db, "Linked row");
    let note = call(
        &v,
        "record.body",
        json!({"id":record["id"],"expectedRevision":record["revision"],"body":"Keep this body [[Other]]"}),
    );
    row(&v, &db, "Independent row");
    let other = call(&v, "database.create", json!({"name":"Other"}));
    let other_record = row(&v, &other, "Untouched");
    let before = files(&v);
    let removed = delete(&v, &db);
    let workspace = call(&v, "workspace.get", json!({}));
    assert_eq!(workspace["databases"], json!([other]));
    assert_eq!(workspace["records"], json!([other_record]));
    assert_eq!(workspace["notes"].as_array().unwrap().len(), 1);
    assert_eq!(call(&v, "note.read", json!({"id":note["id"]})), note);
    let trash = &workspace["trash"];
    assert_eq!(trash.as_array().unwrap().len(), 1);
    assert_eq!(trash[0]["id"], removed["trashId"]);
    assert_eq!(trash[0]["kind"], "database");
    assert_eq!(trash[0]["recordCount"], 2);
    assert!(trash[0].get("content").is_none());
    assert!(trash[0].get("records").is_none());
    let restored = call(&v, "trash.restore", json!({"id":removed["trashId"]}));
    assert_eq!(restored["restored"], path("databases", &db));
    assert_eq!(files(&v), before);
    assert_eq!(call(&v, "trash.list", json!({})), json!([]));
}

#[test]
fn rename_and_delete_refuse_schema_record_edit_addition_and_removal_since_inspection() {
    for change in ["schema", "edit", "add", "remove"] {
        for command in ["database.rename", "database.delete"] {
            let (v, db) = fixture();
            let record = row(&v, &db, "Before");
            let inspected = inspect(&v, &db);
            match change {
                "schema" => {
                    call(
                        &v,
                        "database.property.add",
                        json!({"databaseId":db["id"],"property":{"id":"extra","name":"Extra","type":"text"}}),
                    );
                }
                "edit" => {
                    call(
                        &v,
                        "record.update",
                        json!({"id":record["id"],"expectedRevision":record["revision"],"values":{"title":"After"}}),
                    );
                }
                "add" => {
                    row(&v, &db, "New row");
                }
                _ => {
                    call(
                        &v,
                        "record.delete",
                        json!({"id":record["id"],"expectedRevision":record["revision"]}),
                    );
                }
            }
            let before = files(&v);
            let mut args = json!({"id":db["id"],"expectedRevision":inspected["revision"]});
            if command == "database.rename" {
                args["name"] = json!("Stale name");
            }
            assert_eq!(
                execute(v.path().to_str().unwrap(), command, args)
                    .unwrap_err()
                    .code,
                "conflict",
                "{command} {change}"
            );
            assert_eq!(files(&v), before);
        }
    }
}

#[test]
fn unrelated_records_do_not_invalidate_inspection() {
    let (v, db) = fixture();
    let inspected = inspect(&v, &db);
    let other = call(&v, "database.create", json!({"name":"Other"}));
    row(&v, &other, "Separate");
    assert_eq!(inspect(&v, &db)["revision"], inspected["revision"]);
    call(
        &v,
        "database.delete",
        json!({"id":db["id"],"expectedRevision":inspected["revision"]}),
    );
    assert_eq!(
        call(&v, "query.run", json!({"databaseId":other["id"]}))["total"],
        1
    );
}

#[test]
fn database_trash_roundtrips_through_backup_before_restore() {
    let (v, db) = fixture();
    row(&v, &db, "Original");
    let before = files(&v);
    let removed = delete(&v, &db);
    let snapshot = call(&v, "vault.export", json!({}));
    let destination = tempfile::tempdir().unwrap();
    call(&destination, "vault.import", json!({"snapshot":snapshot}));
    call(
        &destination,
        "trash.restore",
        json!({"id":removed["trashId"]}),
    );
    assert_eq!(files(&destination), before);
}

#[test]
fn restoring_a_deleted_row_requires_its_database_then_works_after_database_restore() {
    let (v, db) = fixture();
    let record = row(&v, &db, "Deleted first");
    call(
        &v,
        "record.delete",
        json!({"id":record["id"],"expectedRevision":record["revision"]}),
    );
    let row_trash = call(&v, "trash.list", json!({}))[0].clone();
    let removed = delete(&v, &db);
    let before = files(&v);
    assert_eq!(
        execute(
            v.path().to_str().unwrap(),
            "trash.restore",
            json!({"id":row_trash["id"]})
        )
        .unwrap_err()
        .code,
        "not_found"
    );
    assert_eq!(files(&v), before);
    call(&v, "trash.restore", json!({"id":removed["trashId"]}));
    call(&v, "trash.restore", json!({"id":row_trash["id"]}));
    assert_eq!(
        call(&v, "query.run", json!({"databaseId":db["id"]}))["rows"][0],
        record
    );
}

#[test]
fn restoring_refuses_schema_or_any_row_collision_without_partial_writes() {
    for collision in ["databases", "records"] {
        let (v, db) = fixture();
        let record = row(&v, &db, "Before");
        let originals = files(&v);
        let removed = delete(&v, &db);
        let destination = path(
            collision,
            if collision == "databases" {
                &db
            } else {
                &record
            },
        );
        std::fs::write(
            v.path().join(&destination),
            originals[&destination].as_str().unwrap(),
        )
        .unwrap();
        let before = files(&v);
        assert_eq!(
            execute(
                v.path().to_str().unwrap(),
                "trash.restore",
                json!({"id":removed["trashId"]})
            )
            .unwrap_err()
            .code,
            "conflict"
        );
        assert_eq!(files(&v), before);
    }
}

#[test]
fn malformed_bundles_cannot_restore_or_enter_a_backup() {
    for problem in [
        "schema_path",
        "row_path",
        "owner",
        "duplicate",
        "count",
        "type",
        "invalid_schema",
    ] {
        let (v, db) = fixture();
        row(&v, &db, "Before");
        let removed = delete(&v, &db);
        let trash_path = format!("trash/{}.json", removed["trashId"].as_str().unwrap());
        let raw = std::fs::read_to_string(v.path().join(&trash_path)).unwrap();
        let mut item: Value = serde_json::from_str(&raw).unwrap();
        match problem {
            "schema_path" => item["originalPath"] = json!(".foltra/settings.json"),
            "row_path" => item["records"][0]["originalPath"] = json!("../outside.json"),
            "owner" => {
                let mut record: Value =
                    serde_json::from_str(item["records"][0]["content"].as_str().unwrap()).unwrap();
                record["databaseId"] = json!("00000000-0000-0000-0000-000000000000");
                item["records"][0]["content"] = json!(record.to_string());
            }
            "duplicate" => {
                let entry = item["records"][0].clone();
                item["records"].as_array_mut().unwrap().push(entry);
                item["recordCount"] = json!(2);
            }
            "count" => item["recordCount"] = json!(2),
            "type" => {
                let mut record: Value =
                    serde_json::from_str(item["records"][0]["content"].as_str().unwrap()).unwrap();
                record["values"]["title"] = json!(42);
                item["records"][0]["content"] = json!(record.to_string());
            }
            _ => {
                let mut schema: Value =
                    serde_json::from_str(item["content"].as_str().unwrap()).unwrap();
                schema["properties"] = json!([]);
                item["content"] = json!(schema.to_string());
            }
        }
        std::fs::write(v.path().join(&trash_path), item.to_string()).unwrap();
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
fn missing_revisions_and_blank_names_are_rejected_without_writes() {
    let (v, db) = fixture();
    let revision = inspect(&v, &db)["revision"].clone();
    let before = files(&v);
    for (command, args) in [
        ("database.delete", json!({"id":db["id"]})),
        ("database.rename", json!({"id":db["id"],"name":"New"})),
        (
            "database.rename",
            json!({"id":db["id"],"name":"  ","expectedRevision":revision}),
        ),
    ] {
        assert!(execute(v.path().to_str().unwrap(), command, args).is_err());
    }
    assert_eq!(files(&v), before);
}

#[test]
fn oversized_trash_bundle_is_rejected_before_any_database_or_record_is_removed() {
    let (v, db) = fixture();
    let record = row(&v, &db, "Large original");
    // Each source is readable, but together they exceed the managed trash-file limit.
    for (kind, original, megabytes) in [("databases", &db, 10), ("records", &record, 7)] {
        let mut content = original.clone();
        content["custom"] = json!("x".repeat(megabytes * 1024 * 1024));
        std::fs::write(v.path().join(path(kind, original)), content.to_string()).unwrap();
    }
    let before = inspect(&v, &db);
    assert_eq!(
        execute(
            v.path().to_str().unwrap(),
            "database.delete",
            json!({"id":db["id"],"expectedRevision":before["revision"]})
        )
        .unwrap_err()
        .code,
        "file_too_large"
    );
    assert_eq!(inspect(&v, &db), before);
    assert_eq!(call(&v, "trash.list", json!({})), json!([]));
}
