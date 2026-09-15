use foltra_core::execute;
use serde_json::{json, Value};
use tempfile::TempDir;

fn call(v: &TempDir, command: &str, args: Value) -> Value {
    execute(v.path().to_str().unwrap(), command, args).unwrap()
}
fn vault() -> TempDir {
    let v = tempfile::tempdir().unwrap();
    call(&v, "vault.init", json!({"name":"Topics"}));
    v
}
fn note(v: &TempDir, title: &str, body: &str) -> Value {
    call(v, "note.create", json!({"title":title,"body":body}))
}
fn blocks(v: &TempDir, topic: &str) -> Value {
    call(v, "topics.blocks", json!({"topic":topic}))
}

#[test]
fn collects_exact_subtrees_from_multiple_notes_without_requiring_topic_notes() {
    let v = vault();
    let first = note(&v, "2026-09-14", "# Daily\n\n- First [[Foo]]\n  - Child\n    - Deeper\n- Excluded sibling\n  - Nested [[Foo]]\n    - Nested child\n- Last\n\nOutside paragraph");
    note(&v, "2026-09-15", "- Second day [[Foo]]\n  - Detail");
    let topics = call(&v, "topics.list", json!({}));
    assert_eq!(
        topics,
        json!([{"id":"name:Foo","title":"Foo","noteId":null,"blockCount":3,"noteCount":2}])
    );
    let result = blocks(&v, "name:Foo");
    let same_note: Vec<_> = result["blocks"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|b| b["noteId"] == first["id"])
        .collect();
    assert_eq!(same_note.len(), 2);
    assert_eq!(same_note[0]["line"], 3);
    assert_eq!(same_note[0]["endLine"], 5);
    assert_eq!(
        same_note[0]["body"],
        "- First [[Foo]]\n  - Child\n    - Deeper"
    );
    assert_eq!(same_note[1]["line"], 7);
    assert_eq!(same_note[1]["body"], "- Nested [[Foo]]\n  - Nested child");
    assert_eq!(
        call(&v, "note.list", json!({})).as_array().unwrap().len(),
        2
    );
}

#[test]
fn parses_markdown_boundaries_and_excludes_code_comments_escaped_and_non_bullet_links() {
    let v = vault();
    note(&v, "Examples", "[[Paragraph]]\n\n```md\n- [[Fenced]]\n```\n\n    - [[IndentedCode]]\n\n<!--\n- [[Comment]]\n-->\n\n- `[[InlineCode]]`\n- \\[[Escaped]]\n- continuation\n  [[Continuation]]\n- [label](https://example.com/[[Destination]])\n- Real [[Foo]]\n  ```md\n  - [[InnerCode]]\n  ```\n  - Child\n- Next");
    let topics = call(&v, "topics.list", json!({}));
    assert_eq!(topics.as_array().unwrap().len(), 1, "{topics}");
    assert_eq!(topics[0]["title"], "Foo");
    let result = blocks(&v, "name:Foo");
    assert_eq!(
        result["blocks"][0]["body"],
        "- Real [[Foo]]\n  ```md\n  - [[InnerCode]]\n  ```\n  - Child"
    );
}

#[test]
fn groups_by_target_and_deduplicates_repeated_links_without_inheriting_child_topics() {
    let v = vault();
    note(&v, "Multi", "- Parent [[Foo]] [[Foo|Again]] [[Bar]]\n  - Child [[Baz]]\n  - Nested [[Foo]]\n    - Detail");
    let foo = blocks(&v, "name:Foo");
    assert_eq!(foo["total"], 2);
    assert_eq!(foo["blocks"][0]["line"], 1);
    assert_eq!(foo["blocks"][1]["line"], 3);
    let baz = blocks(&v, "name:Baz");
    assert_eq!(baz["total"], 1);
    assert_eq!(baz["blocks"][0]["body"], "- Child [[Baz]]");
    assert_eq!(blocks(&v, "name:Bar")["total"], 1);
}

#[test]
fn topic_rename_keeps_identity_and_reads_are_pure_and_follow_source_changes_and_trash() {
    let v = vault();
    let foo = note(&v, "Foo", "");
    let source = note(&v, "Journal", "- Work [[Foo|Display name]]\n  - Original");
    let key = format!("note:{}", foo["id"].as_str().unwrap());
    let before = call(&v, "vault.export", json!({}));
    assert_eq!(blocks(&v, &key)["total"], 1);
    call(&v, "topics.list", json!({}));
    assert_eq!(
        call(&v, "vault.export", json!({}))["files"],
        before["files"]
    );
    call(
        &v,
        "note.update",
        json!({"id":foo["id"],"expectedRevision":foo["revision"],"title":"New topic name"}),
    );
    assert_eq!(blocks(&v, &key)["topic"]["title"], "New topic name");
    let source = call(&v, "note.read", json!({"id":source["id"]}));
    let changed = call(
        &v,
        "note.update",
        json!({"id":source["id"],"expectedRevision":source["revision"],"body":format!("- Work [[{}|Foo]]\n  - Changed", foo["id"].as_str().unwrap())}),
    );
    assert!(blocks(&v, &key)["blocks"][0]["body"]
        .as_str()
        .unwrap()
        .ends_with("Changed"));
    call(
        &v,
        "note.delete",
        json!({"id":changed["id"],"expectedRevision":changed["revision"]}),
    );
    assert_eq!(blocks(&v, &key)["total"], 0);
    let trash = call(&v, "trash.list", json!({}));
    call(&v, "trash.restore", json!({"id":trash[0]["id"]}));
    assert_eq!(blocks(&v, &key)["total"], 1);
}

#[test]
fn supports_tasks_ordered_lists_crlf_and_loose_list_content() {
    let v = vault();
    note(&v, "Lists", "- [ ] Task [[Foo]]\r\n  - Child\r\n\r\n  Continued paragraph\r\n\r\n- [x] Done [[Foo]]\r\n\r\n1. Numbered [[Foo]]\r\n   1. Child\r\n2. Other\r\n");
    let result = blocks(&v, "name:Foo");
    assert_eq!(result["total"], 3);
    assert_eq!(
        result["blocks"][0]["body"],
        "- [ ] Task [[Foo]]\n  - Child\n\n  Continued paragraph"
    );
    assert_eq!(result["blocks"][1]["body"], "- [x] Done [[Foo]]");
    assert_eq!(
        result["blocks"][2]["body"],
        "1. Numbered [[Foo]]\n   1. Child"
    );
}

#[test]
fn paginates_without_losing_source_order_and_validates_arguments() {
    let v = vault();
    let body = (0..105)
        .map(|i| format!("- Item {i} [[Foo]]\n"))
        .collect::<String>();
    note(&v, "Many", &body);
    let first = blocks(&v, "name:Foo");
    assert_eq!(first["total"], 105);
    assert_eq!(first["blocks"].as_array().unwrap().len(), 50);
    let last = call(
        &v,
        "topics.blocks",
        json!({"topic":"name:Foo","offset":100,"limit":100,"descending":false}),
    );
    assert_eq!(last["blocks"].as_array().unwrap().len(), 5);
    assert_eq!(last["blocks"][0]["line"], 101);
    for limit in [0, 101] {
        assert_eq!(
            execute(
                v.path().to_str().unwrap(),
                "topics.blocks",
                json!({"topic":"name:Foo","limit":limit})
            )
            .unwrap_err()
            .code,
            "query_limit"
        );
    }
    let specs = call(&v, "commands.list", json!({}));
    assert!(specs
        .as_array()
        .unwrap()
        .iter()
        .any(|s| s["id"] == "topics.blocks" && s["headless"] == true && s["readOnly"] == true));
    assert_eq!(blocks(&v, "name:Missing")["blocks"], json!([]));
}

#[test]
fn nested_tabs_are_renderable_and_deleted_topic_targets_keep_their_group_identity() {
    let v = vault();
    let foo = note(&v, "Foo", "");
    note(
        &v,
        "Tabs",
        "- Parent\n\t- Nested [[Foo]]\n\t\t- Detail\n\t- Excluded",
    );
    let key = format!("note:{}", foo["id"].as_str().unwrap());
    let result = blocks(&v, &key);
    assert_eq!(result["total"], 1);
    assert_eq!(result["blocks"][0]["line"], 2);
    let body = result["blocks"][0]["body"].as_str().unwrap().to_string();
    assert!(body.starts_with("- Nested [["));
    assert!(body.ends_with("\n    - Detail"));
    assert!(!body.contains("Excluded"));
    call(
        &v,
        "note.delete",
        json!({"id":foo["id"],"expectedRevision":foo["revision"]}),
    );
    let result = blocks(&v, &key);
    assert_eq!(result["topic"]["title"], "Foo");
    assert!(result["topic"]["noteId"].is_null());
    assert_eq!(result["total"], 1);
    assert_eq!(
        result["blocks"][0]["body"],
        body.replace(
            "[[Foo]]",
            &format!("[[{}|Foo]]", foo["id"].as_str().unwrap())
        )
    );
}
