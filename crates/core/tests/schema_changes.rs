use foltra_core::execute;
use serde_json::{json, Value};
use tempfile::TempDir;

fn call(v: &TempDir, command: &str, args: Value) -> Value {
    execute(v.path().to_str().unwrap(), command, args).unwrap()
}
fn fixture(kind: &str) -> (TempDir, Value) {
    let v = tempfile::tempdir().unwrap();
    call(&v, "vault.init", json!({"name":"Schema tests"}));
    let db = call(
        &v,
        "database.create",
        json!({"name":"Data","properties":[
            {"id":"title","name":"Name","type":"text"},
            {"id":"value","name":"Value","type":kind}
        ]}),
    );
    (v, db)
}
fn row(v: &TempDir, db: &Value, value: Value) -> Value {
    call(
        v,
        "record.create",
        json!({"databaseId":db["id"],"values":{"title":"Record","value":value}}),
    )
}
fn proposal(db: &Value, kind: &str) -> Value {
    json!({"databaseId":db["id"],"property":{"id":"value","name":"Value","type":kind}})
}
fn apply(v: &TempDir, mut args: Value, preview: &Value) -> Value {
    args["expectedRevision"] = preview["revision"].clone();
    call(v, "database.property.update", args)
}
fn snapshot(v: &TempDir) -> Value {
    call(v, "vault.export", json!({}))["files"].clone()
}

#[test]
fn preview_is_read_only_and_conversion_covers_rows_beyond_first_page() {
    let (v, db) = fixture("text");
    let first = row(&v, &db, json!("42"));
    let body = call(
        &v,
        "record.body",
        json!({"id":first["id"],"expectedRevision":first["revision"],"body":"Preserve this body"}),
    );
    for i in 0..104 {
        row(&v, &db, json!(i.to_string()));
    }
    let before = snapshot(&v);
    let args = proposal(&db, "number");
    let preview = call(&v, "database.property.preview", args.clone());
    assert_eq!(preview["rowCount"], 105);
    assert_eq!(preview["changedRows"], 105);
    assert_eq!(snapshot(&v), before);
    apply(&v, args, &preview);
    let workspace = call(&v, "workspace.get", json!({}));
    let records = workspace["records"].as_array().unwrap();
    assert!(records.iter().all(|r| r["values"]["value"].is_number()));
    assert_eq!(
        records.iter().find(|r| r["id"] == first["id"]).unwrap()["bodyNoteId"],
        body["id"]
    );
    assert_eq!(call(&v, "note.read", json!({"id":body["id"]})), body);
    assert_eq!(workspace["notes"].as_array().unwrap().len(), 1);
    let result = call(
        &v,
        "query.run",
        json!({"databaseId":db["id"],"filters":[{"property":"value","op":"gt","value":100}]}),
    );
    assert_eq!(result["total"], 3);
}

#[test]
fn a_single_invalid_value_prevents_all_schema_and_row_writes() {
    let (v, db) = fixture("text");
    row(&v, &db, json!("12"));
    let bad = row(&v, &db, json!("unknown"));
    row(&v, &db, json!("18446744073709551616"));
    row(&v, &db, Value::Null);
    let before = snapshot(&v);
    let mut args = proposal(&db, "number");
    let preview = call(&v, "database.property.preview", args.clone());
    assert_eq!(preview["canApply"], false);
    assert_eq!(preview["errorCount"], 2);
    assert!(preview["errors"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["rowId"] == bad["id"]));
    args["expectedRevision"] = preview["revision"].clone();
    assert_eq!(
        execute(v.path().to_str().unwrap(), "database.property.update", args)
            .unwrap_err()
            .code,
        "conversion_failed"
    );
    assert_eq!(snapshot(&v), before);
}

#[test]
fn row_edits_additions_deletions_and_schema_changes_invalidate_the_preview() {
    for change in ["edit", "add", "delete", "schema"] {
        let (v, db) = fixture("text");
        let original = row(&v, &db, json!("12"));
        let mut args = proposal(&db, "number");
        let preview = call(&v, "database.property.preview", args.clone());
        match change {
            "edit" => {
                call(
                    &v,
                    "record.update",
                    json!({"id":original["id"],"expectedRevision":original["revision"],"values":{"title":"Changed elsewhere"}}),
                );
            }
            "add" => {
                row(&v, &db, json!("13"));
            }
            "delete" => {
                call(
                    &v,
                    "record.delete",
                    json!({"id":original["id"],"expectedRevision":original["revision"]}),
                );
            }
            _ => {
                call(
                    &v,
                    "database.property.add",
                    json!({"databaseId":db["id"],"property":{"id":"extra","name":"Extra","type":"text"}}),
                );
            }
        }
        let before = snapshot(&v);
        args["expectedRevision"] = preview["revision"].clone();
        assert_eq!(
            execute(v.path().to_str().unwrap(), "database.property.update", args)
                .unwrap_err()
                .code,
            "conflict",
            "{change}"
        );
        assert_eq!(snapshot(&v), before);
    }
}

#[test]
fn selection_options_are_inferred_and_cannot_remove_existing_values() {
    let (v, db) = fixture("text");
    row(&v, &db, json!("Beta"));
    row(&v, &db, json!("Alpha"));
    row(&v, &db, json!(""));
    let args = proposal(&db, "select");
    let preview = call(&v, "database.property.preview", args.clone());
    assert_eq!(preview["property"]["options"], json!(["Alpha", "Beta"]));
    assert_eq!(preview["changedRows"], 0);
    apply(&v, args.clone(), &preview);
    let mut removed = args;
    removed["property"]["options"] = json!(["Alpha"]);
    let preview = call(&v, "database.property.preview", removed);
    assert_eq!(preview["errorCount"], 1);
    let args = proposal(&db, "text");
    let preview = call(&v, "database.property.preview", args.clone());
    apply(&v, args, &preview);
    assert_eq!(
        call(&v, "database.list", json!({}))[0]["properties"][1]["type"],
        "text"
    );
}

#[test]
fn checkbox_conversion_is_explicit_and_blanks_remain_empty() {
    let (v, db) = fixture("number");
    row(&v, &db, json!(0));
    row(&v, &db, json!(1));
    row(&v, &db, Value::Null);
    let args = proposal(&db, "checkbox");
    let preview = call(&v, "database.property.preview", args.clone());
    apply(&v, args, &preview);
    let args = proposal(&db, "text");
    let preview = call(&v, "database.property.preview", args.clone());
    apply(&v, args, &preview);
    let records = call(&v, "workspace.get", json!({}))["records"]
        .as_array()
        .unwrap()
        .clone();
    assert!(records.iter().any(|r| r["values"]["value"] == "false"));
    assert!(records.iter().any(|r| r["values"]["value"] == "true"));
    assert!(records.iter().any(|r| r["values"]["value"].is_null()));
    row(&v, &db, json!("yes"));
    let preview = call(&v, "database.property.preview", proposal(&db, "checkbox"));
    assert_eq!(preview["errorCount"], 1);
}

#[test]
fn name_column_is_text_and_invalid_dates_never_change_the_schema() {
    let (v, db) = fixture("text");
    let args =
        json!({"databaseId":db["id"],"property":{"id":"title","name":"Name","type":"number"}});
    assert_eq!(
        execute(
            v.path().to_str().unwrap(),
            "database.property.preview",
            args
        )
        .unwrap_err()
        .code,
        "invalid_schema"
    );
    row(&v, &db, json!("2026-02-31"));
    let before = snapshot(&v);
    let preview = call(&v, "database.property.preview", proposal(&db, "date"));
    assert_eq!(preview["canApply"], false);
    assert_eq!(snapshot(&v), before);
    let specs = call(&v, "commands.list", json!({}));
    assert!(specs
        .as_array()
        .unwrap()
        .iter()
        .any(|s| s["id"] == "database.property.update" && s["headless"] == true));
}
