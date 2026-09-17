use foltra_core::execute;
use serde_json::{json, Value};
use tempfile::TempDir;

fn call(v: &TempDir, command: &str, args: Value) -> Value {
    execute(v.path().to_str().unwrap(), command, args).unwrap()
}
fn fixture() -> (TempDir, Value) {
    let v = tempfile::tempdir().unwrap();
    call(&v, "vault.init", json!({"name":"Column deletion"}));
    let db = call(
        &v,
        "database.create",
        json!({"name":"Data","properties":[
            {"id":"title","name":"Name","type":"text"},
            {"id":"drop","name":"Delete","type":"number"},
            {"id":"keep","name":"Keep","type":"text"}
        ]}),
    );
    (v, db)
}
fn row(v: &TempDir, db: &Value) -> Value {
    call(
        v,
        "record.create",
        json!({"databaseId":db["id"],"values":{"title":"Row","drop":42,"keep":"보존"}}),
    )
}
fn args(v: &TempDir, db: &Value, property: &str) -> Value {
    let snapshot = call(v, "database.inspect", json!({"id":db["id"]}));
    json!({"databaseId":db["id"],"propertyId":property,"expectedRevision":snapshot["revision"]})
}
fn files(v: &TempDir) -> Value {
    call(v, "vault.export", json!({}))["files"].clone()
}

#[test]
fn deleting_a_column_updates_all_pages_and_preserves_other_data_and_unknown_fields() {
    let (v, db) = fixture();
    let mut first = Value::Null;
    for index in 0..105 {
        let mut values = json!({"title":format!("Row {index}"),"keep":"보존"});
        if index < 104 {
            values["drop"] = if index == 103 {
                Value::Null
            } else {
                json!(index)
            };
        }
        let record = call(
            &v,
            "record.create",
            json!({"databaseId":db["id"],"values":values}),
        );
        if index == 0 {
            first = record;
        }
    }
    let note = call(
        &v,
        "record.body",
        json!({"id":first["id"],"expectedRevision":first["revision"],"body":"본문 [[연결]]\n\n- [ ] 보존"}),
    );
    let other = call(&v, "database.create", json!({"name":"Other"}));
    call(
        &v,
        "record.create",
        json!({"databaseId":other["id"],"values":{"title":"Untouched"}}),
    );
    let schema_path = format!("databases/{}.json", db["id"].as_str().unwrap());
    let mut schema = db.clone();
    schema["custom"] = json!({"preserve":"schema metadata"});
    std::fs::write(v.path().join(&schema_path), schema.to_string()).unwrap();
    for (path, content) in files(&v).as_object().unwrap() {
        if !path.starts_with("records/") {
            continue;
        }
        let mut record: Value = serde_json::from_str(content.as_str().unwrap()).unwrap();
        if record["databaseId"] != db["id"] {
            continue;
        }
        record["updatedAt"] = json!("2000-01-01T00:00:00Z");
        record["custom"] = json!({"preserve":[1,"row metadata"]});
        std::fs::write(v.path().join(path), record.to_string()).unwrap();
    }
    let before = files(&v);
    let deleted = call(&v, "database.property.delete", args(&v, &db, "drop"));
    assert_eq!(deleted["changedRows"], 104);
    assert_eq!(deleted["database"]["id"], db["id"]);
    assert_eq!(
        deleted["database"]["properties"].as_array().unwrap().len(),
        2
    );
    let after = files(&v);
    assert_eq!(
        before.as_object().unwrap().len(),
        after.as_object().unwrap().len()
    );
    for (path, raw) in before.as_object().unwrap() {
        if path == &schema_path {
            let mut expected: Value = serde_json::from_str(raw.as_str().unwrap()).unwrap();
            expected["properties"]
                .as_array_mut()
                .unwrap()
                .retain(|property| property["id"] != "drop");
            assert_eq!(
                serde_json::from_str::<Value>(after[path].as_str().unwrap()).unwrap(),
                expected
            );
        } else if path.starts_with("records/") {
            let mut expected: Value = serde_json::from_str(raw.as_str().unwrap()).unwrap();
            if expected["databaseId"] == db["id"] && expected["values"].get("drop").is_some() {
                let actual: Value = serde_json::from_str(after[path].as_str().unwrap()).unwrap();
                expected["values"].as_object_mut().unwrap().remove("drop");
                assert_ne!(actual["updatedAt"], expected["updatedAt"]);
                expected["updatedAt"] = actual["updatedAt"].clone();
                assert_eq!(actual, expected);
            } else {
                assert_eq!(&after[path], raw);
            }
        } else {
            assert_eq!(&after[path], raw);
        }
    }
    let queried = call(&v, "query.run", json!({"databaseId":db["id"],"limit":500}));
    assert_eq!(queried["total"], 105);
    assert!(queried["rows"]
        .as_array()
        .unwrap()
        .iter()
        .all(|row| row["values"].get("drop").is_none()));
    assert_eq!(call(&v, "note.read", json!({"id":note["id"]})), note);
}

#[test]
fn column_deletion_rejects_stale_schema_and_record_snapshots_without_writing() {
    for change in ["schema", "edit", "add", "remove"] {
        let (v, db) = fixture();
        let record = row(&v, &db);
        let deletion = args(&v, &db, "drop");
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
                    json!({"id":record["id"],"expectedRevision":record["revision"],"values":{"keep":"Changed"}}),
                );
            }
            "add" => {
                row(&v, &db);
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
        assert_eq!(
            execute(
                v.path().to_str().unwrap(),
                "database.property.delete",
                deletion
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
fn title_last_missing_and_invalid_columns_are_protected() {
    let (v, db) = fixture();
    row(&v, &db);
    for (property, code) in [
        ("title", "invalid_schema"),
        ("missing", "invalid_property"),
        ("../outside", "invalid_property"),
    ] {
        let before = files(&v);
        assert_eq!(
            execute(
                v.path().to_str().unwrap(),
                "database.property.delete",
                args(&v, &db, property)
            )
            .unwrap_err()
            .code,
            code
        );
        assert_eq!(files(&v), before);
    }
    let single = call(
        &v,
        "database.create",
        json!({"name":"One column","properties":[{"id":"only","name":"Only","type":"text"}]}),
    );
    let before = files(&v);
    assert_eq!(
        execute(
            v.path().to_str().unwrap(),
            "database.property.delete",
            args(&v, &single, "only")
        )
        .unwrap_err()
        .code,
        "invalid_schema"
    );
    assert_eq!(files(&v), before);
    let mut invalid = args(&v, &db, "drop");
    invalid["propertyId"] = json!(null);
    assert_eq!(
        execute(
            v.path().to_str().unwrap(),
            "database.property.delete",
            invalid
        )
        .unwrap_err()
        .code,
        "invalid_arguments"
    );
    assert_eq!(files(&v), before);
}

#[test]
fn empty_columns_can_be_deleted_and_invalid_row_data_is_not_partially_rewritten() {
    let (v, db) = fixture();
    let missing = call(
        &v,
        "record.create",
        json!({"databaseId":db["id"],"values":{"title":"No value"}}),
    );
    let result = call(&v, "database.property.delete", args(&v, &db, "drop"));
    assert_eq!(result["changedRows"], 0);
    assert_eq!(
        call(&v, "query.run", json!({"databaseId":db["id"]}))["rows"][0],
        missing
    );
    let record = call(
        &v,
        "record.create",
        json!({"databaseId":db["id"],"values":{"title":"Invalid","keep":"Text"}}),
    );
    let deletion = args(&v, &db, "keep");
    let path = v
        .path()
        .join(format!("records/{}.json", record["id"].as_str().unwrap()));
    let mut raw: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    raw["values"]["keep"] = json!(42);
    std::fs::write(path, raw.to_string()).unwrap();
    let before = files(&v);
    assert_eq!(
        execute(
            v.path().to_str().unwrap(),
            "database.property.delete",
            deletion
        )
        .unwrap_err()
        .code,
        "invalid_value"
    );
    assert_eq!(files(&v), before);
}
