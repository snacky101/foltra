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
fn parses_markdown_boundaries_and_excludes_code_comments_escaped_and_continuation_links() {
    let v = vault();
    note(&v, "Examples", "[[Paragraph]]\n\n```md\n- [[Fenced]]\n```\n\n    - [[IndentedCode]]\n\n<!--\n- [[Comment]]\n-->\n\n- `[[InlineCode]]`\n- \\[[Escaped]]\n- continuation\n  [[Continuation]]\n- [label](https://example.com/[[Destination]])\n- Real [[Foo]]\n  ```md\n  - [[InnerCode]]\n  ```\n  - Child\n- Next");
    let topics = call(&v, "topics.list", json!({}));
    assert_eq!(topics.as_array().unwrap().len(), 2, "{topics}");
    assert_eq!(topics[0]["title"], "Foo");
    assert_eq!(topics[1]["title"], "Paragraph");
    let result = blocks(&v, "name:Foo");
    assert_eq!(
        result["blocks"][0]["body"],
        "- Real [[Foo]]\n  ```md\n  - [[InnerCode]]\n  ```\n  - Child"
    );
}

#[test]
fn collects_paragraphs_with_links_on_any_line_without_adjacent_blocks() {
    let v = vault();
    note(&v, "문단", "앞 문단\n\n첫 줄\n주제 [[Foo|표시]]를 기록합니다.\n같은 문단 [[Foo]] [[Bar]]\n\n다음 문단\n\n또 다른 [[Foo]] 문단");
    note(&v, "목록", "- 기존 [[Foo]]\n  - 하위 항목");
    let foo = blocks(&v, "name:Foo");
    assert_eq!(foo["total"], 3);
    assert_eq!(foo["topic"]["noteCount"], 2);
    let paragraphs: Vec<_> = foo["blocks"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|b| b["noteTitle"] == "문단")
        .collect();
    assert_eq!(paragraphs[0]["line"], 3);
    assert_eq!(paragraphs[0]["endLine"], 5);
    assert_eq!(
        paragraphs[0]["body"],
        "첫 줄\n주제 [[Foo|표시]]를 기록합니다.\n같은 문단 [[Foo]] [[Bar]]"
    );
    assert_eq!(paragraphs[1]["line"], 9);
    assert_eq!(paragraphs[1]["body"], "또 다른 [[Foo]] 문단");
    assert_eq!(blocks(&v, "name:Bar")["total"], 1);
}

#[test]
fn collects_headings_and_quoted_paragraphs_preserving_markdown_and_crlf_positions() {
    let v = vault();
    note(&v, "블록", "# 제목 [[Foo]]\r\n\r\n본문\r\n\r\n> 인용 [[Foo]]\r\n> 이어지는 문장\r\n>\r\n> 다른 인용\r\n\r\n밑줄 제목 [[Foo]]\r\n---\r\n\r\n- 부모 [[Foo]]\r\n  - 자식 [[Foo]]\r\n");
    let result = blocks(&v, "name:Foo");
    let cards = result["blocks"].as_array().unwrap();
    assert_eq!(cards.len(), 5);
    assert_eq!(cards[0]["body"], "# 제목 [[Foo]]");
    assert_eq!(cards[0]["line"], 1);
    assert_eq!(cards[1]["body"], "> 인용 [[Foo]]\n> 이어지는 문장");
    assert_eq!(cards[1]["line"], 5);
    assert_eq!(cards[1]["endLine"], 6);
    assert_eq!(cards[2]["body"], "밑줄 제목 [[Foo]]\n---");
    assert_eq!(cards[2]["endLine"], 11);
    assert_eq!(cards[3]["body"], "- 부모 [[Foo]]\n  - 자식 [[Foo]]");
    assert_eq!(cards[4]["body"], "- 자식 [[Foo]]");
}

#[test]
fn paragraph_topics_share_note_identity_aliases_and_do_not_modify_sources() {
    let v = vault();
    let foo = note(&v, "Foo", "");
    let id = foo["id"].as_str().unwrap();
    let key = format!("note:{id}");
    note(&v, "문단", &format!("[[Foo|별칭]] [[{id}]] [[Foo#제목]]\n\n`[[Code]]` \\[[Escaped]]\n\n```md\n[[Fence]]\n```\n\n    [[Indented]]\n\n<!-- [[Comment]] -->\n\n[외부](https://example.com/[[Url]])"));
    let before = call(&v, "vault.export", json!({}));
    assert_eq!(
        call(&v, "topics.list", json!({})).as_array().unwrap().len(),
        1
    );
    assert_eq!(blocks(&v, &key)["total"], 1);
    assert_eq!(
        call(&v, "vault.export", json!({}))["files"],
        before["files"]
    );
    call(
        &v,
        "note.update",
        json!({"id":id,"expectedRevision":foo["revision"],"title":"새 주제"}),
    );
    assert_eq!(blocks(&v, &key)["topic"]["title"], "새 주제");
    assert_eq!(blocks(&v, &key)["total"], 1);
}

#[test]
fn unindented_text_after_a_list_matches_the_editors_paragraph_boundary() {
    let v = vault();
    note(
        &v,
        "목록 종료",
        "- 항목 [[Foo]]\n  - 하위 항목\n일반 문단\n[[Foo]] [[Bar]]\n- 다음 항목 [[Foo]]",
    );
    let cards = blocks(&v, "name:Foo")["blocks"].as_array().unwrap().clone();
    assert_eq!(cards.len(), 3);
    assert_eq!(cards[0]["body"], "- 항목 [[Foo]]\n  - 하위 항목");
    assert_eq!(cards[0]["endLine"], 2);
    assert_eq!(cards[1]["body"], "일반 문단\n[[Foo]] [[Bar]]");
    assert_eq!(cards[1]["line"], 3);
    assert_eq!(cards[1]["endLine"], 4);
    assert_eq!(cards[2]["body"], "- 다음 항목 [[Foo]]");
    assert_eq!(blocks(&v, "name:Bar")["total"], 1);
}

#[test]
fn paragraph_boundaries_preserve_quotes_tabs_hard_breaks_and_inline_markup() {
    for (body, expected) in [
        ("> - 항목\n> 일반 [[Foo]]", "> 일반 [[Foo]]"),
        ("1. 항목  \n일반 [[Foo]]", "일반 [[Foo]]"),
        ("- 항목\n\t이어지는 문장\n일반 [[Foo]]", "일반 [[Foo]]"),
        ("- **강조\n계속**\n일반 [[Foo]]", "일반 [[Foo]]"),
        ("- `코드\n계속`\n일반 [[Foo]]", "일반 [[Foo]]"),
    ] {
        let v = vault();
        note(&v, "경계", body);
        let result = blocks(&v, "name:Foo");
        assert_eq!(result["total"], 1, "{body}");
        assert_eq!(result["blocks"][0]["body"], expected, "{body}");
    }
    let v = vault();
    note(
        &v,
        "연속 내용",
        "- **강조\n[[Inline]]**\n\n- 항목\n  [[Indented]]\n\n- 항목\n\t[[Tabbed]]",
    );
    assert_eq!(call(&v, "topics.list", json!({})), json!([]));
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

#[test]
fn completed_filter_counts_real_tasks_in_the_entire_card_and_preserves_other_blocks() {
    let v = vault();
    let cases = [
        ("Done", "- [x] Done [[Foo]]\n  - [X] Child", false),
        ("Parent", "- Parent [[Foo]]\n  - [x] Child", false),
        ("Mixed", "- [x] Parent [[Foo]]\n  - [ ] Child", true),
        ("Doing", "- [x] Parent [[Foo]]\n  - [/] Child", true),
        ("Bookmark", "- [x] Parent [[Foo]]\n  - [b] Child", true),
        ("Other states", "- [x] Parent [[Foo]]\n  - [-] Child", true),
        ("No tasks", "- Plain [[Foo]]\n  - Child", true),
        ("Literal", "A literal `- [x] done` [[Foo]]", true),
        ("Malformed", "- [x]no separator [[Foo]]", true),
        (
            "Code only",
            "- Parent [[Foo]]\n  ```md\n  - [x] Code\n  ```",
            true,
        ),
        (
            "Ignore code",
            "- [x] Parent [[Foo]]\n  ```md\n  - [ ] Code\n  ```",
            false,
        ),
        ("Done-only topic", "- [x] [[DoneOnly]]", false),
    ];
    for (title, body, _) in cases {
        note(&v, title, body);
    }
    let before = call(&v, "vault.export", json!({}));
    let catalog = call(&v, "topics.list", json!({"hideCompleted":true}));
    let expected: Vec<_> = cases
        .iter()
        .filter(|(_, _, visible)| *visible)
        .map(|(title, _, _)| *title)
        .collect();
    assert_eq!(catalog.as_array().unwrap().len(), 1);
    assert_eq!(catalog[0]["blockCount"], expected.len());
    assert_eq!(catalog[0]["noteCount"], expected.len());
    let filtered = call(
        &v,
        "topics.blocks",
        json!({"topic":"name:Foo","hideCompleted":true}),
    );
    let actual: std::collections::BTreeSet<_> = filtered["blocks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["noteTitle"].as_str().unwrap())
        .collect();
    assert_eq!(actual, expected.iter().copied().collect());
    assert_eq!(filtered["total"], expected.len());
    assert_eq!(blocks(&v, "name:Foo")["total"], cases.len() - 1);
    assert_eq!(
        call(&v, "vault.export", json!({}))["files"],
        before["files"]
    );
}

#[test]
fn completed_filter_paginates_after_filtering_and_reorder_preserves_hidden_cards() {
    let v = vault();
    let body = (0..55)
        .map(|i| {
            format!(
                "- [{}] Card {i} [[Foo]]",
                if i % 2 == 0 { "x" } else { " " }
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let original = note(&v, "Checklist", &body);
    let all = blocks(&v, "name:Foo");
    let page = call(
        &v,
        "topics.blocks",
        json!({"topic":"name:Foo","hideCompleted":true,"limit":2,"offset":1}),
    );
    assert_eq!(page["total"], 27);
    assert_eq!(page["blocks"][0]["line"], 4);
    assert_eq!(page["blocks"][1]["line"], 6);
    let args = json!({"topic":"name:Foo","hideCompleted":true,"source":page["blocks"][1]["id"],"target":page["blocks"][0]["id"],"placement":"before","sort":"newest","expectedRevision":page["orderRevision"]});
    let mut stale_scope = args.clone();
    stale_scope["expectedRevision"] = all["orderRevision"].clone();
    assert_eq!(
        execute(v.path().to_str().unwrap(), "topics.reorder", stale_scope)
            .unwrap_err()
            .code,
        "conflict"
    );
    let mut hidden = args.clone();
    hidden["source"] = all["blocks"][0]["id"].clone();
    assert_eq!(
        execute(v.path().to_str().unwrap(), "topics.reorder", hidden)
            .unwrap_err()
            .code,
        "not_found"
    );
    call(&v, "topics.reorder", args);
    let reordered = blocks(&v, "name:Foo");
    assert_eq!(reordered["total"], 55);
    assert_eq!(
        reordered["blocks"]
            .as_array()
            .unwrap()
            .iter()
            .take(6)
            .map(|b| b["line"].as_u64().unwrap())
            .collect::<Vec<_>>(),
        vec![1, 2, 3, 6, 4, 5]
    );
    assert_eq!(
        call(&v, "note.read", json!({"id":original["id"]})),
        original
    );
    let again = call(
        &v,
        "topics.blocks",
        json!({"topic":"name:Foo","hideCompleted":true,"limit":3}),
    );
    assert_eq!(
        again["blocks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b["line"].as_u64().unwrap())
            .collect::<Vec<_>>(),
        vec![2, 6, 4]
    );
}
