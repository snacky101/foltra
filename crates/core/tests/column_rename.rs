use foltra_core::execute;
use serde_json::{json, Value};
use tempfile::TempDir;
fn call(v: &TempDir, command: &str, args: Value) -> Value {
    execute(v.path().to_str().unwrap(), command, args).unwrap()
}
fn fixture() -> (TempDir, Value) {
    let v = tempfile::tempdir().unwrap();
    call(&v, "vault.init", json!({"name":"Rename"}));
    let db = call(
        &v,
        "database.create",
        json!({"name":"Data","properties":[{"id":"title","name":"Name","type":"text"},{"id":"value","name":"Value","type":"number"}]}),
    );
    call(
        &v,
        "record.create",
        json!({"databaseId":db["id"],"values":{"title":"Alpha","value":12}}),
    );
    (v, db)
}
fn proposal(db: &Value, name: &str) -> Value {
    json!({"databaseId":db["id"],"property":{"id":"title","name":name,"type":"text"}})
}
fn rename(v: &TempDir, db: &Value, name: &str) -> Value {
    let mut args = proposal(db, name);
    let p = call(v, "database.property.preview", args.clone());
    assert_eq!(p["canApply"], true, "{p}");
    args["expectedRevision"] = p["revision"].clone();
    call(v, "database.property.update", args)
}
fn create(v: &TempDir, body: &str) -> Value {
    call(v, "note.create", json!({"title":"Query","body":body}))
}
fn body(v: &TempDir, note: &Value) -> String {
    call(v, "note.read", json!({"id":note["id"]}))["body"]
        .as_str()
        .unwrap()
        .into()
}
#[test]
fn rename_rewrites_bound_columns_only_and_keeps_formatting_and_record_identity() {
    let (v, db) = fixture();
    let other = call(
        &v,
        "database.create",
        json!({"name":"Other","properties":[{"id":"title","name":"Name","type":"text"}]}),
    );
    call(
        &v,
        "record.create",
        json!({"databaseId":other["id"],"values":{"title":"Other"}}),
    );
    let sql="SELECT d.\"Name\", o.\"Name\", 'Name' AS literal -- Name\nFROM \"Data\" d CROSS JOIN \"Other\" o\nWHERE d.\"Name\" = 'Alpha' ORDER BY d.\"Name\";";
    let note = create(
        &v,
        &format!(
            "Normal Name text\n\n```foltra-sql\n{sql}\n```\n\n```sql\nSELECT Name FROM Data\n```\n"
        ),
    );
    let before = call(&v, "workspace.get", json!({}))["records"].clone();
    let p = call(&v, "database.property.preview", proposal(&db, "제목"));
    assert_eq!(p["changedNotes"], 1);
    assert_eq!(p["changedQueries"], 1);
    assert!(body(&v, &note).contains(sql));
    rename(&v, &db, "제목");
    let expected = sql.replace("d.\"Name\"", "d.\"제목\"");
    assert!(body(&v, &note).contains(&expected));
    assert!(body(&v, &note).contains("```sql\nSELECT Name FROM Data"));
    assert_eq!(call(&v, "workspace.get", json!({}))["records"], before);
    let result = call(&v, "query.sql", json!({"sql":expected}));
    assert_eq!(result["rows"].as_array().unwrap().len(), 1);
}
#[test]
fn rename_tracks_ctes_derived_tables_aliases_and_correlated_scopes() {
    let (v, db) = fixture();
    let queries=[
  "WITH c AS (SELECT \"Name\", \"Value\" FROM \"Data\") SELECT c.\"Name\" FROM c ORDER BY \"Name\"",
  "WITH c AS (SELECT \"Name\" AS fixed FROM \"Data\") SELECT fixed FROM c",
  "SELECT d.\"Name\" FROM (SELECT \"Name\" FROM \"Data\") d",
  "SELECT \"Name\" AS \"Name\" FROM \"Data\" ORDER BY \"Name\"",
  "SELECT d.\"Name\" FROM \"Data\" d WHERE EXISTS (SELECT 1 WHERE d.\"Name\" = 'Alpha')",
 ];
    let notes: Vec<_> = queries
        .iter()
        .map(|q| create(&v, &format!("```foltra-query\n{q}\n```")))
        .collect();
    rename(&v, &db, "제목");
    for note in &notes {
        let b = body(&v, note);
        let sql = b
            .strip_prefix("```foltra-query\n")
            .unwrap()
            .strip_suffix("\n```")
            .unwrap();
        let r = call(&v, "query.sql", json!({"sql":sql}));
        assert_eq!(r["rows"].as_array().unwrap().len(), 1, "{sql}");
    }
    assert!(body(&v, &notes[1]).contains("AS fixed"));
    assert!(body(&v, &notes[3]).contains("AS \"Name\" FROM \"Data\" ORDER BY \"Name\""));
}
#[test]
fn collisions_rewrite_both_changed_catalog_aliases_and_leave_json_queries_stable() {
    let (v, db) = fixture();
    let note=create(&v,"```foltra-sql\nSELECT \"Name\", \"Value\" FROM \"Data\"\n```\n\n```foltra-query\n{\"databaseId\":\"id\",\"sort\":[{\"property\":\"title\"}]}\n```");
    rename(&v, &db, "Value");
    let b = body(&v, &note);
    assert!(b.contains("SELECT \"Value [title]\", \"Value [value]\""));
    assert!(b.contains("\"property\":\"title\""));
    let sql = b.lines().nth(1).unwrap();
    call(&v, "query.sql", json!({"sql":sql}));
    rename(&v, &db, "Display");
    assert!(body(&v, &note).contains("SELECT \"Display\", \"Value\""));
}
#[test]
fn note_edit_or_new_reference_after_preview_conflicts_without_any_writes() {
    for add in [false, true] {
        let (v, db) = fixture();
        let note = create(&v, "```foltra-sql\nSELECT Name FROM Data\n```");
        let mut args = proposal(&db, "Display");
        let p = call(&v, "database.property.preview", args.clone());
        args["expectedRevision"] = p["revision"].clone();
        if add {
            create(&v, "```foltra-sql\nSELECT Name FROM Data\n```");
        } else {
            call(
                &v,
                "note.update",
                json!({"id":note["id"],"expectedRevision":note["revision"],"body":"User edit"}),
            );
        }
        let before = call(&v, "vault.export", json!({}))["files"].clone();
        assert_eq!(
            execute(v.path().to_str().unwrap(), "database.property.update", args)
                .unwrap_err()
                .code,
            "conflict"
        );
        assert_eq!(call(&v, "vault.export", json!({}))["files"], before);
    }
}
#[test]
fn unsafe_joins_block_rename_but_unrelated_invalid_sql_does_not() {
    let (v, db) = fixture();
    create(&v, "```foltra-sql\nSELECT FROM Unrelated\n```");
    let note = create(
        &v,
        "```foltra-sql\nSELECT * FROM Data a NATURAL JOIN Data b\n```",
    );
    let mut args = proposal(&db, "Display");
    let p = call(&v, "database.property.preview", args.clone());
    assert_eq!(p["canApply"], false);
    assert_eq!(p["queryErrors"].as_array().unwrap().len(), 1);
    assert_eq!(p["queryErrors"][0]["noteId"], note["id"]);
    args["expectedRevision"] = p["revision"].clone();
    let before = call(&v, "vault.export", json!({}))["files"].clone();
    assert_eq!(
        execute(v.path().to_str().unwrap(), "database.property.update", args)
            .unwrap_err()
            .code,
        "query_rename_blocked"
    );
    assert_eq!(call(&v, "vault.export", json!({}))["files"], before);
}
#[test]
fn quoted_names_korean_and_schema_qualifiers_keep_valid_sql() {
    let (v, db) = fixture();
    let inspected = call(&v, "database.inspect", json!({"id":db["id"]}));
    call(
        &v,
        "database.rename",
        json!({"id":db["id"],"name":"A\"B","expectedRevision":inspected["revision"]}),
    );
    let note = create(
        &v,
        "```foltra-sql\nSELECT vault.\"A\"\"B\".\"Name\" FROM vault.\"A\"\"B\"\n```",
    );
    rename(&v, &db, "한글 \"제목\"");
    let b = body(&v, &note);
    assert!(b.contains(".\"한글 \"\"제목\"\"\""));
    call(&v, "query.sql", json!({"sql":b.lines().nth(1).unwrap()}));
}
#[test]
fn output_aliases_in_having_and_limit_subqueries_keep_their_meaning() {
    let (v, db) = fixture();
    let queries = [
        "SELECT sum(\"Value\") AS \"Name\" FROM \"Data\" HAVING \"Name\" > 0",
        "SELECT \"Name\" FROM \"Data\" LIMIT (SELECT count(\"Name\") FROM \"Data\")",
    ];
    let saved: Vec<_> = queries
        .iter()
        .map(|q| {
            let expected = call(&v, "query.sql", json!({"sql":q}))["rows"].clone();
            (create(&v, &format!("```foltra-sql\n{q}\n```")), expected)
        })
        .collect();
    rename(&v, &db, "Display");
    for (note, expected) in saved {
        let b = body(&v, &note);
        assert_eq!(
            call(&v, "query.sql", json!({"sql":b.lines().nth(1).unwrap()}))["rows"],
            expected
        );
    }
}
#[test]
fn computed_cte_output_requires_alias_and_preserves_every_file_when_blocked() {
    let (v, db) = fixture();
    let sql =
        "WITH c AS (SELECT lower(\"Name\") FROM \"Data\") SELECT \"lower(\"\"Name\"\")\" FROM c";
    call(&v, "query.sql", json!({"sql":sql}));
    let note = create(&v, &format!("```foltra-sql\n{sql}\n```"));
    let before = call(&v, "vault.export", json!({}))["files"].clone();
    let p = call(&v, "database.property.preview", proposal(&db, "Display"));
    assert_eq!(p["canApply"], false);
    assert_eq!(p["queryErrors"][0]["noteId"], note["id"]);
    assert!(p["queryErrors"][0]["message"]
        .as_str()
        .unwrap()
        .contains("AS"));
    assert_eq!(call(&v, "vault.export", json!({}))["files"], before);
}
#[test]
fn unrelated_unfinished_sql_and_frontmatter_remain_untouched() {
    let (v, db) = fixture();
    let body_text="---\nquery: |\n  ```foltra-sql\n  SELECT Name FROM Data\n  ```\n---\n\n```foltra-sql\nSELECT 'unfinished FROM Other\n```\n";
    let untouched = create(&v, body_text);
    let changed = create(&v, "> ```foltra-sql\n> SELECT Name\n> FROM Data\n> ```\n");
    rename(&v, &db, "Display");
    assert_eq!(body(&v, &untouched), body_text);
    assert_eq!(
        body(&v, &changed),
        "> ```foltra-sql\n> SELECT \"Display\"\n> FROM Data\n> ```\n"
    );
}
#[test]
fn name_only_change_preserves_raw_records_database_and_note_metadata() {
    let (v, db) = fixture();
    let note = create(
        &v,
        "[[An unresolved link]]\n\n```foltra-sql\nSELECT Name FROM Data\n```",
    );
    let path = v
        .path()
        .join(format!("databases/{}.json", db["id"].as_str().unwrap()));
    let mut raw: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    raw["custom"] = json!({"future":42});
    std::fs::write(&path, serde_json::to_string_pretty(&raw).unwrap()).unwrap();
    let note_path = v
        .path()
        .join(format!("notes/{}.md", note["id"].as_str().unwrap()));
    let raw_note = std::fs::read_to_string(&note_path).unwrap();
    let (head, tail) = raw_note
        .strip_prefix("---\n")
        .unwrap()
        .split_once("\n---\n")
        .unwrap();
    let mut head: Value = serde_json::from_str(head).unwrap();
    head["custom"] = json!({"future":"keep"});
    std::fs::write(&note_path, format!("---\n{}\n---\n{}", head, tail)).unwrap();
    let record_files: Vec<_> = std::fs::read_dir(v.path().join("records"))
        .unwrap()
        .map(|entry| {
            let path = entry.unwrap().path();
            let raw = std::fs::read(&path).unwrap();
            (path, raw)
        })
        .collect();
    rename(&v, &db, "Display");
    assert_eq!(
        serde_json::from_str::<Value>(&std::fs::read_to_string(path).unwrap()).unwrap()["custom"],
        raw["custom"]
    );
    let final_note = std::fs::read_to_string(note_path).unwrap();
    let header = final_note
        .strip_prefix("---\n")
        .unwrap()
        .split_once("\n---\n")
        .unwrap()
        .0;
    assert_eq!(
        serde_json::from_str::<Value>(header).unwrap()["custom"],
        head["custom"]
    );
    assert!(body(&v, &note).starts_with("[[An unresolved link]]\n"));
    for (path, raw) in record_files {
        assert_eq!(std::fs::read(path).unwrap(), raw);
    }
}
#[test]
fn rename_choice_column_preserves_unused_options() {
    let (v, db) = fixture();
    let mut args = json!({"databaseId":db["id"],"property":{"id":"value","name":"Value","type":"select","options":["12","Unused"]}});
    let p = call(&v, "database.property.preview", args.clone());
    args["expectedRevision"] = p["revision"].clone();
    call(&v, "database.property.update", args);
    let mut args = json!({"databaseId":db["id"],"property":{"id":"value","name":"Choice","type":"select","options":["12","Unused"]}});
    let p = call(&v, "database.property.preview", args.clone());
    args["expectedRevision"] = p["revision"].clone();
    let result = call(&v, "database.property.update", args);
    assert_eq!(
        result["database"]["properties"][1]["options"],
        json!(["12", "Unused"])
    );
    call(
        &v,
        "record.create",
        json!({"databaseId":db["id"],"values":{"title":"Beta","value":"Unused"}}),
    );
}
#[test]
fn qualify_uses_input_columns_and_from_subqueries_see_preceding_relations() {
    let (v, db) = fixture();
    let queries=["SELECT \"Value\", ROW_NUMBER() OVER (ORDER BY \"Value\") AS \"Name\" FROM \"Data\" QUALIFY \"Name\" = 'Alpha'", "SELECT d.\"Name\", s.val FROM \"Data\" d, (SELECT d.\"Name\" AS val) s"];
    let saved: Vec<_> = queries
        .iter()
        .map(|q| {
            let rows = call(&v, "query.sql", json!({"sql":q}))["rows"].clone();
            (create(&v, &format!("```foltra-sql\n{q}\n```")), rows)
        })
        .collect();
    rename(&v, &db, "Display");
    for (note, rows) in saved {
        let b = body(&v, &note);
        assert_eq!(
            call(&v, "query.sql", json!({"sql":b.lines().nth(1).unwrap()}))["rows"],
            rows
        );
    }
}
#[test]
fn newly_captured_alias_and_duplicate_derived_outputs_block_instead_of_changing_results() {
    for sql in [
        "SELECT lower(Name) AS display FROM Data WHERE display = 'alpha'",
        "WITH c AS (SELECT Name, Name FROM Data) SELECT Name_1 FROM c",
    ] {
        let (v, db) = fixture();
        call(&v, "query.sql", json!({"sql":sql}));
        create(&v, &format!("```foltra-sql\n{sql}\n```"));
        let p = call(&v, "database.property.preview", proposal(&db, "display"));
        assert_eq!(p["canApply"], false, "{sql}: {p}");
        assert!(!p["queryErrors"].as_array().unwrap().is_empty());
    }
}
#[test]
fn failed_conversion_does_not_write_planned_query_rename() {
    let (v, db) = fixture();
    create(&v, "```foltra-sql\nSELECT Value FROM Data\n```");
    let mut args =
        json!({"databaseId":db["id"],"property":{"id":"value","name":"New","type":"date"}});
    let p = call(&v, "database.property.preview", args.clone());
    assert_eq!(p["changedQueries"], 1);
    assert_eq!(p["canApply"], false);
    args["expectedRevision"] = p["revision"].clone();
    let before = call(&v, "vault.export", json!({}))["files"].clone();
    assert_eq!(
        execute(v.path().to_str().unwrap(), "database.property.update", args)
            .unwrap_err()
            .code,
        "conversion_failed"
    );
    assert_eq!(call(&v, "vault.export", json!({}))["files"], before);
}
#[test]
fn reserved_metadata_name_does_not_change_record_id_reference() {
    let (v, db) = fixture();
    let note = create(&v, "```foltra-sql\nSELECT Name, __id FROM Data\n```");
    rename(&v, &db, "__id");
    let b = body(&v, &note);
    assert!(b.contains("SELECT \"__id [title]\", __id"));
    call(&v, "query.sql", json!({"sql":b.lines().nth(1).unwrap()}));
}

#[test]
fn affected_oversized_sql_blocks_rename_before_parsing() {
    let (v, db) = fixture();
    create(
        &v,
        &format!(
            "```foltra-sql\nSELECT Name FROM Data /* {} */\n```",
            "x".repeat(33 * 1024)
        ),
    );
    let preview = call(&v, "database.property.preview", proposal(&db, "Display"));
    assert_eq!(preview["canApply"], false);
    assert!(preview["queryErrors"][0]["message"]
        .as_str()
        .unwrap()
        .contains("32 KiB"));
}
