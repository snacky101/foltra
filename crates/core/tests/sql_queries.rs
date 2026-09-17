use foltra_core::execute;
use serde_json::{json, Value};
use tempfile::TempDir;

fn call(v: &TempDir, command: &str, args: Value) -> Value {
    execute(v.path().to_str().unwrap(), command, args).unwrap()
}
fn vault() -> TempDir {
    let v = tempfile::tempdir().unwrap();
    call(&v, "vault.init", json!({"name":"SQL QA"}));
    v
}
fn database(v: &TempDir, name: &str) -> Value {
    call(
        v,
        "database.create",
        json!({"name":name,"properties":[
            {"id":"title","name":"이름","type":"text"},
            {"id":"status","name":"상태","type":"status","options":["진행","완료"]},
            {"id":"score","name":"점수","type":"number"},
            {"id":"done","name":"확인","type":"checkbox"},
            {"id":"date","name":"날짜","type":"date"}
        ]}),
    )
}
fn query(v: &TempDir, sql: &str) -> Value {
    call(v, "query.sql", json!({"sql":sql}))
}

#[test]
fn named_sql_queries_support_postgres_expressions_and_preserve_originals() {
    let v = vault();
    let db = database(&v, "독서 기록");
    for (title, status, score, done, date) in [
        ("Alpha", "완료", 12, true, Some("2026-09-16")),
        ("Beta", "진행", 3, false, None),
        ("ALPHABET", "완료", 8, false, Some("2026-09-17")),
    ] {
        call(
            &v,
            "record.create",
            json!({"databaseId":db["id"],"values":{
                "title":title,"status":status,"score":score,"done":done,"date":date
            }}),
        );
    }
    let before = call(&v, "vault.export", json!({}));
    let result = query(&v, "SELECT \"이름\" AS title, \"점수\"::INTEGER AS score, \"확인\", \"날짜\" FROM \"독서 기록\" WHERE \"이름\" ILIKE 'alpha%' ORDER BY \"점수\" DESC;");
    assert_eq!(
        result["rows"],
        json!([
            ["Alpha", "12", "true", "2026-09-16"],
            ["ALPHABET", "8", "false", "2026-09-17"]
        ])
    );
    assert_eq!(result["columns"][0]["name"], "title");
    assert_eq!(
        query(
            &v,
            "SELECT \"날짜\" FROM \"독서 기록\" WHERE \"날짜\" IS NULL"
        )["rows"],
        json!([[null]])
    );
    assert_eq!(query(&v, "WITH completed AS (SELECT * FROM \"독서 기록\" WHERE \"상태\" = '완료') SELECT COUNT(*) AS n, SUM(\"점수\") AS score FROM completed")["rows"], json!([["2","20.0"]]));
    let grouped = query(
        &v,
        "SELECT \"상태\", COUNT(*) AS n FROM \"독서 기록\" GROUP BY \"상태\" HAVING COUNT(*) > 1",
    );
    assert_eq!(grouped["rows"], json!([["완료", "2"]]));
    assert_eq!(query(&v, "SELECT a.\"이름\", b.\"이름\" FROM \"독서 기록\" a JOIN \"독서 기록\" b ON a.__id = b.__id WHERE a.\"확인\" = true")["rows"], json!([["Alpha","Alpha"]]));
    assert_eq!(
        call(&v, "vault.export", json!({}))["files"],
        before["files"]
    );
    assert_eq!(
        call(&v, "query.run", json!({"databaseId":db["id"]}))["total"],
        3
    );
}

#[test]
fn catalog_and_generated_queries_escape_names_and_handle_empty_tables() {
    let v = vault();
    let db = database(&v, "읽는 \"책\"; --");
    let catalog = call(&v, "query.catalog", json!({}));
    let table = &catalog["tables"][0];
    assert_eq!(table["databaseId"], db["id"]);
    let result = query(&v, table["sql"].as_str().unwrap());
    assert_eq!(result["columns"][0]["name"], "이름");
    assert_eq!(result["rows"], json!([]));
    assert_eq!(result["truncated"], false);
}

#[test]
fn database_names_can_overlap_engine_system_views() {
    let v = vault();
    for name in ["sqlite_master", "sqlite_temp_schema", "duckdb_tables"] {
        let db = database(&v, name);
        call(
            &v,
            "record.create",
            json!({"databaseId":db["id"],"values":{"title":name}}),
        );
    }
    let catalog = call(&v, "query.catalog", json!({}));
    for table in catalog["tables"].as_array().unwrap() {
        let name = table["name"].as_str().unwrap();
        assert_eq!(
            query(&v, &format!("SELECT \"이름\" FROM \"{name}\""))["rows"],
            json!([[name]])
        );
        assert_eq!(
            query(&v, table["sql"].as_str().unwrap())["rows"][0][0],
            name
        );
    }
    assert_eq!(
        query(&v, "SELECT COUNT(*) FROM vault.duckdb_tables")["rows"],
        json!([["1"]])
    );
}

#[test]
fn scalar_casts_and_relative_date_queries_are_supported() {
    let v = vault();
    let times = query(
        &v,
        "SELECT CURRENT_DATE, CURRENT_TIMESTAMP, now(), LOCALTIME, LOCALTIMESTAMP",
    );
    assert!(times["rows"][0]
        .as_array()
        .unwrap()
        .iter()
        .all(|cell| cell.as_str().is_some_and(|value| !value.is_empty())));
    assert_eq!(
        query(
            &v,
            "SELECT CURRENT_DATE >= CURRENT_DATE - INTERVAL '7 days', \
             CURRENT_TIMESTAMP = now(), LOCALTIME IS NOT NULL, LOCALTIMESTAMP IS NOT NULL"
        )["rows"],
        json!([["true", "true", "true", "true"]])
    );
    assert_eq!(
        query(
            &v,
            "SELECT '12'::INTEGER, CAST(12.5 AS DECIMAL(5,1)), DATE '2026-09-17', CAST(true AS TEXT)"
        )["rows"],
        json!([["12", "12.5", "2026-09-17", "true"]])
    );
}

#[test]
fn expanding_expressions_and_structured_values_are_rejected() {
    let v = vault();
    database(&v, "Tasks");
    for sql in [
        "SELECT 'a' OPERATOR(||) 'b'",
        "SELECT 'a' OPERATOR(pg_catalog.||) 'b'",
        "SELECT ARRAY[1,2]",
        "SELECT (1,2)",
        "SELECT CAST(NULL AS INTEGER[2])",
        "SELECT NULL::INTEGER[2][2]",
        "SELECT JSON '[1,2]'",
        "SELECT OVERLAY('abc' PLACING 'd' FROM 1)",
    ] {
        let error =
            execute(v.path().to_str().unwrap(), "query.sql", json!({"sql":sql})).unwrap_err();
        assert_eq!(error.code, "invalid_sql", "{sql}");
        assert!(
            error.message.contains("supported in vault queries"),
            "{sql}: {}",
            error.message
        );
    }
    for sql in [
        "SELECT t FROM Tasks t",
        "WITH packed AS (SELECT t AS entry FROM Tasks t) SELECT entry FROM packed",
    ] {
        let error =
            execute(v.path().to_str().unwrap(), "query.sql", json!({"sql":sql})).unwrap_err();
        assert_eq!(error.code, "invalid_sql", "{sql}");
        assert_eq!(
            error.message, "SQL results must contain scalar columns",
            "{sql}"
        );
    }
    assert_eq!(
        query(&v, "SELECT COUNT(*) FROM Tasks")["rows"],
        json!([["0"]])
    );
}

#[test]
fn cleared_dates_are_null_in_sql_without_changing_the_stored_value() {
    let v = vault();
    let db = database(&v, "Tasks");
    call(
        &v,
        "record.create",
        json!({"databaseId":db["id"],"values":{"title":"Cleared","date":""}}),
    );
    let before = call(&v, "vault.export", json!({}));
    assert_eq!(
        query(&v, "SELECT \"이름\" FROM Tasks WHERE \"날짜\" IS NULL")["rows"],
        json!([["Cleared"]])
    );
    assert_eq!(query(&v, "SELECT 42")["rows"], json!([["42"]]));
    assert_eq!(
        call(&v, "vault.export", json!({}))["files"],
        before["files"]
    );
}

#[test]
fn duplicate_names_do_not_silently_redirect_a_query() {
    let v = vault();
    database(&v, "Tasks");
    database(&v, "tasks");
    let catalog = call(&v, "query.catalog", json!({}));
    let tables = catalog["tables"].as_array().unwrap();
    assert_eq!(tables.len(), 2);
    for table in tables {
        assert!(table["name"].as_str().unwrap().contains('['));
        query(&v, table["sql"].as_str().unwrap());
    }
    assert!(execute(
        v.path().to_str().unwrap(),
        "query.sql",
        json!({"sql":"SELECT * FROM Tasks"})
    )
    .is_err());
}

#[test]
fn sql_blocks_cannot_write_or_access_files_extensions_and_unbounded_functions() {
    let v = vault();
    database(&v, "Tasks");
    let before = call(&v, "vault.export", json!({}));
    for sql in [
        "DROP TABLE Tasks",
        "DELETE FROM Tasks RETURNING *",
        "UPDATE Tasks SET score = 0",
        "CREATE TABLE other AS SELECT 1",
        "SELECT 1; SELECT 2",
        "SELECT * INTO other FROM Tasks",
        "WITH deleted AS (DELETE FROM Tasks RETURNING *) SELECT * FROM deleted",
        "SELECT 1 UNION SELECT 2 INTO other",
        "COPY Tasks TO '/tmp/foltra-query-export.csv'",
        "INSTALL httpfs",
        "LOAD httpfs",
        "ATTACH '/tmp/test.db' AS disk",
        "PRAGMA database_list",
        "SET enable_external_access=true",
        "CALL checkpoint()",
        "SELECT * FROM read_csv('/etc/passwd')",
        "SELECT * FROM query('DROP TABLE Tasks')",
        "SELECT read_blob('/etc/passwd')",
        "SELECT replace('aaa','a','bbbb')",
        "SELECT concat('a','b')",
        "SELECT 'a' || 'b'",
        "SELECT repeat('x',1000000000)",
        "WITH RECURSIVE n AS (SELECT 1 UNION ALL SELECT * FROM n) SELECT * FROM n",
        "SELECT * FROM Tasks FOR UPDATE",
    ] {
        assert!(
            execute(v.path().to_str().unwrap(), "query.sql", json!({"sql":sql})).is_err(),
            "{sql}"
        );
    }
    assert_eq!(
        call(&v, "vault.export", json!({}))["files"],
        before["files"]
    );
    assert!(execute(
        v.path().to_str().unwrap(),
        "query.sql",
        json!({"sql":"x".repeat(32769)})
    )
    .is_err());
}

#[test]
fn query_results_are_bounded_and_large_computations_are_interrupted() {
    let v = vault();
    let values = (0..100)
        .map(|n| format!("({n})"))
        .collect::<Vec<_>>()
        .join(",");
    let table = format!("WITH t(n) AS (VALUES {values})");
    let result = query(
        &v,
        &format!("{table} SELECT a.n, b.n FROM t a CROSS JOIN t b"),
    );
    assert_eq!(result["rows"].as_array().unwrap().len(), 500);
    assert_eq!(result["truncated"], true);
    let heavy =
        format!("{table} SELECT SUM((a.n*b.n+c.n)*(d.n*e.n+f.n)) FROM t a,t b,t c,t d,t e,t f");
    let started = std::time::Instant::now();
    let err = execute(
        v.path().to_str().unwrap(),
        "query.sql",
        json!({"sql":heavy}),
    )
    .unwrap_err();
    assert_eq!(err.code, "query_timeout");
    assert!(started.elapsed().as_secs() < 10);
    assert_eq!(query(&v, "SELECT 42 AS answer")["rows"], json!([["42"]]));
}
