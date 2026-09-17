use foltra_core::execute;
use serde_json::{json, Value};
use tempfile::TempDir;

fn call(vault: &TempDir, command: &str, args: Value) -> Value {
    execute(vault.path().to_str().unwrap(), command, args).unwrap()
}

fn row_ids(result: &Value) -> Vec<String> {
    result["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["id"].as_str().unwrap().to_string())
        .collect()
}

fn assert_sorting(kind: &str, values: [Value; 5], expected_order: [usize; 6]) {
    let vault = tempfile::tempdir().unwrap();
    call(&vault, "vault.init", json!({"name":"Sorting tests"}));
    let database = call(
        &vault,
        "database.create",
        json!({"name":"Data","properties":[{"id":"value","name":"Value","type":kind}]}),
    );
    let mut records: Vec<_> = (0..6)
        .map(|_| {
            call(
                &vault,
                "record.create",
                json!({"databaseId":database["id"]}),
            )
        })
        .collect();
    records.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    // Assign values after sorting IDs to reproduce value/null/ID comparison cycles.
    // The last record deliberately has no value property, distinct from explicit null.
    for (record, value) in records.iter().zip(values) {
        call(
            &vault,
            "record.update",
            json!({"id":record["id"],"expectedRevision":record["revision"],"values":{"value":value}}),
        );
    }
    let before = call(&vault, "vault.export", json!({}))["files"].clone();
    let ascending: Vec<_> = expected_order
        .iter()
        .map(|index| records[*index]["id"].as_str().unwrap().to_string())
        .collect();
    for descending in [false, true] {
        let mut expected = ascending.clone();
        if descending {
            expected.reverse();
        }
        let result = call(
            &vault,
            "query.run",
            json!({"databaseId":database["id"],"sort":"value","descending":descending}),
        );
        assert_eq!(
            row_ids(&result),
            expected,
            "{kind}, descending={descending}"
        );
        let mut paged = vec![];
        for offset in (0..=6).step_by(3) {
            let page = call(
                &vault,
                "query.run",
                json!({"databaseId":database["id"],"sort":"value","descending":descending,"offset":offset,"limit":3}),
            );
            assert_eq!(page["total"], 6);
            assert_eq!(page["offset"], offset);
            assert_eq!(page["limit"], 3);
            assert_eq!(row_ids(&page), expected[offset..(offset + 3).min(6)]);
            paged.extend(row_ids(&page));
        }
        assert_eq!(paged, expected);
    }
    assert_eq!(call(&vault, "vault.export", json!({}))["files"], before);
}

#[test]
fn number_sort_orders_null_missing_and_numeric_values_before_paging() {
    assert_sorting(
        "number",
        [json!(10), Value::Null, json!(2), json!(2), json!(10)],
        [1, 5, 2, 3, 0, 4],
    );
}

#[test]
fn checkbox_sort_orders_null_missing_false_and_true_before_paging() {
    assert_sorting(
        "checkbox",
        [
            json!(true),
            Value::Null,
            json!(false),
            json!(false),
            json!(true),
        ],
        [1, 5, 2, 3, 0, 4],
    );
}

#[test]
fn text_sort_keeps_empty_first_and_case_sensitive_string_order() {
    assert_sorting(
        "text",
        [json!("z"), Value::Null, json!(""), json!("A"), json!("a")],
        [1, 5, 2, 3, 4, 0],
    );
}
