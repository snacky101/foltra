use foltra_core::execute;
use serde_json::{json, Value};
use tempfile::TempDir;

fn call(v: &TempDir, command: &str, args: Value) -> Value {
    execute(v.path().to_str().unwrap(), command, args.clone())
        .unwrap_or_else(|error| panic!("{command} {args}: {error}"))
}
fn vault() -> TempDir {
    let v = tempfile::tempdir().unwrap();
    call(&v, "vault.init", json!({"name":"Automation"}));
    v
}
fn note(v: &TempDir, title: &str, body: &str) -> Value {
    call(v, "note.create", json!({"title":title,"body":body}))
}
fn read(v: &TempDir, note: &Value) -> Value {
    call(v, "note.read", json!({"id":note["id"]}))
}
fn failure(v: &TempDir, command: &str, args: Value, code: &str) {
    assert_eq!(
        execute(v.path().to_str().unwrap(), command, args)
            .unwrap_err()
            .code,
        code
    );
}

#[test]
fn resolving_is_read_only_and_ambiguous_names_never_choose_a_note() {
    let v = vault();
    let source = note(&v, "한글 이름", "Keep");
    assert_eq!(
        call(&v, "note.resolve", json!({"target":"한글 이름"})),
        source
    );
    failure(&v, "note.resolve", json!({"target":"Missing"}), "not_found");
    note(&v, "한글 이름", "Other");
    failure(
        &v,
        "note.resolve",
        json!({"target":"한글 이름"}),
        "ambiguous_note",
    );
    assert_eq!(
        call(&v, "note.resolve", json!({"target":source["id"]})),
        source
    );
    assert_eq!(
        call(&v, "note.list", json!({})).as_array().unwrap().len(),
        2
    );
}

#[test]
fn append_prepend_preserve_frontmatter_whitespace_and_reject_stale_revisions() {
    let v = vault();
    let source = note(
        &v,
        "Memo",
        "---\r\n# keep\r\nstatus: ready\r\n---\r\nBody  \n",
    );
    let prepended = call(
        &v,
        "note.prepend",
        json!({"id":source["id"],"content":"처음"}),
    );
    assert_eq!(
        prepended["body"],
        "---\r\n# keep\r\nstatus: ready\r\n---\r\n처음\nBody  \n"
    );
    let appended = call(
        &v,
        "note.append",
        json!({"id":source["id"],"content":"End"}),
    );
    assert!(appended["body"].as_str().unwrap().ends_with("Body  \nEnd"));
    let inline = call(
        &v,
        "note.append",
        json!({"id":source["id"],"content":"!","inline":true}),
    );
    assert!(inline["body"].as_str().unwrap().ends_with("End!"));
    failure(
        &v,
        "note.append",
        json!({"id":source["id"],"content":"lost","expectedRevision":source["revision"]}),
        "conflict",
    );
    assert_eq!(read(&v, &source), inline);
    assert_eq!(
        call(&v, "note.append", json!({"id":source["id"],"content":""})),
        inline
    );
}

#[test]
fn concurrent_appends_do_not_lose_content() {
    let v = vault();
    let source = note(&v, "Shared", "");
    let handles: Vec<_> = (0..8)
        .map(|i| {
            let path = v.path().to_str().unwrap().to_string();
            let id = source["id"].clone();
            std::thread::spawn(move || {
                execute(
                    &path,
                    "note.append",
                    json!({"id":id,"content":format!("line-{i}")}),
                )
                .unwrap()
            })
        })
        .collect();
    for handle in handles {
        handle.join().unwrap();
    }
    let result = read(&v, &source);
    let body = result["body"].as_str().unwrap();
    assert_eq!(body.lines().count(), 8);
    for i in 0..8 {
        assert!(body.lines().any(|line| line == format!("line-{i}")));
    }
}

#[test]
fn daily_read_does_not_create_and_create_never_overwrites() {
    let v = vault();
    failure(&v, "daily.read", json!({"date":"2026-09-21"}), "not_found");
    failure(
        &v,
        "daily.create",
        json!({"date":"2026-02-30"}),
        "invalid_arguments",
    );
    failure(
        &v,
        "daily.create",
        json!({"date":"2026-9-1"}),
        "invalid_arguments",
    );
    assert_eq!(call(&v, "note.list", json!({})), json!([]));
    let source = call(
        &v,
        "daily.append",
        json!({"date":"2026-09-21","content":"First"}),
    );
    assert_eq!(source["title"], "2026-09-21");
    assert_eq!(source["body"], "First");
    assert_eq!(
        call(
            &v,
            "daily.create",
            json!({"date":"2026-09-21","content":"Do not overwrite"})
        ),
        source
    );
    let updated = call(
        &v,
        "daily.prepend",
        json!({"date":"2026-09-21","content":"Top"}),
    );
    assert_eq!(updated["body"], "Top\nFirst");
    assert_eq!(
        call(&v, "daily.read", json!({"date":"2026-09-21"})),
        updated
    );
    let today = call(&v, "daily.create", json!({}));
    assert_eq!(
        today["title"],
        chrono::Local::now().format("%Y-%m-%d").to_string()
    );
}

#[test]
fn tasks_include_custom_states_and_body_lines_but_exclude_examples() {
    let v = vault();
    let body="---\nexample: '- [ ] YAML'\n---\n# Title\n- [ ] Todo\n  - [b] Bookmark\n> - [/] Doing\n1. [X] Done\n- [?] Question\n- [ ]invalid\n```md\n- [ ] Code\n```\n\n    - [x] Indented code\n";
    let source = note(&v, "Tasks", body);
    let tasks = call(&v, "tasks.list", json!({"id":source["id"]}));
    assert_eq!(tasks.as_array().unwrap().len(), 5, "{tasks}");
    assert_eq!(tasks[0]["line"], 5);
    assert_eq!(tasks[1]["status"], "bookmark");
    assert_eq!(
        call(&v, "tasks.list", json!({"status":"done"}))
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let changed = call(
        &v,
        "task.update",
        json!({"id":source["id"],"line":6,"status":"pin","expectedRevision":source["revision"]}),
    );
    assert_eq!(changed["body"], body.replace("[b]", "[p]"));
    failure(
        &v,
        "task.update",
        json!({"id":source["id"],"line":5,"toggle":true,"expectedRevision":source["revision"]}),
        "conflict",
    );
    let toggled = call(
        &v,
        "task.update",
        json!({"id":source["id"],"line":5,"toggle":true,"expectedRevision":changed["revision"]}),
    );
    assert!(toggled["body"].as_str().unwrap().contains("- [x] Todo"));
    failure(
        &v,
        "task.update",
        json!({"id":source["id"],"line":12,"toggle":true,"expectedRevision":toggled["revision"]}),
        "not_found",
    );
    assert_eq!(read(&v, &source), toggled);
}

#[test]
fn every_displayed_task_marker_is_editable_through_core() {
    let v = vault();
    let mut source = note(&v, "Task", "- [ ] Task");
    for status in [
        "doing",
        "done",
        "bookmark",
        "cancelled",
        "deferred",
        "question",
        "important",
        "star",
        "info",
        "pin",
        "todo",
    ] {
        source = call(
            &v,
            "task.update",
            json!({"id":source["id"],"expectedRevision":source["revision"],"line":1,"status":status}),
        );
        assert_eq!(
            call(&v, "tasks.list", json!({"id":source["id"]}))[0]["status"],
            status
        );
    }
}

#[test]
fn properties_edit_one_key_preserving_other_source_and_managed_metadata() {
    let v = vault();
    let body="---\n# retained\n한글: 원본 # inline\ncount: 2\nnested:\n  child: value\n---\n\nMarkdown  \n";
    let source = note(&v, "Properties", body);
    let updated = call(
        &v,
        "property.set",
        json!({"id":source["id"],"expectedRevision":source["revision"],"name":"한글","value":"새 값"}),
    );
    assert_eq!(updated["body"], body.replace("원본", "\"새 값\""));
    assert_eq!(updated["title"], source["title"]);
    assert_eq!(updated["createdAt"], source["createdAt"]);
    let added = call(
        &v,
        "property.set",
        json!({"id":source["id"],"expectedRevision":updated["revision"],"name":"tags","type":"json","value":"[\"study\",\"한글\"]"}),
    );
    assert_eq!(
        call(&v, "note.frontmatter", json!({"id":source["id"]}))["properties"]["tags"],
        json!(["study", "한글"])
    );
    let removed = call(
        &v,
        "property.remove",
        json!({"id":source["id"],"expectedRevision":added["revision"],"name":"count"}),
    );
    assert!(!removed["body"].as_str().unwrap().contains("count:"));
    assert!(removed["body"]
        .as_str()
        .unwrap()
        .contains("nested:\n  child: value\n"));
    assert!(removed["body"]
        .as_str()
        .unwrap()
        .ends_with("\n\nMarkdown  \n"));
    failure(
        &v,
        "property.remove",
        json!({"id":source["id"],"expectedRevision":source["revision"],"name":"한글"}),
        "conflict",
    );
    assert_eq!(read(&v, &source), removed);
}

#[test]
fn property_mutations_cover_crlf_multiline_nested_empty_and_quoted_keys() {
    let v = vault();
    for yaml in [
        "'한글 key': old\nkeep: true\n",
        "'한글 key': |\n  Line one\n  Line two\nkeep: true\n",
        "'한글 key':\n  nested: value\nkeep: true\n",
        "'한글 key': [a, b]\nkeep: true\n",
        "'한글 key':\nkeep: true\n",
        "'한글 key': old\r\nkeep: true\r\n",
    ] {
        let source = note(&v, "Property", &format!("---\n{yaml}---\nBody"));
        let updated = call(
            &v,
            "property.set",
            json!({"id":source["id"],"expectedRevision":source["revision"],"name":"한글 key","value":"새 값"}),
        );
        assert_eq!(
            call(&v, "note.frontmatter", json!({"id":source["id"]}))["properties"],
            json!({"한글 key":"새 값","keep":true})
        );
        let removed = call(
            &v,
            "property.remove",
            json!({"id":source["id"],"expectedRevision":updated["revision"],"name":"한글 key"}),
        );
        assert!(removed["body"].as_str().unwrap().ends_with("---\nBody"));
        assert_eq!(
            call(&v, "note.frontmatter", json!({"id":source["id"]}))["properties"],
            json!({"keep":true})
        );
    }
    let source = note(&v, "No YAML", "# Body\n");
    let added = call(
        &v,
        "property.set",
        json!({"id":source["id"],"expectedRevision":source["revision"],"name":"enabled","type":"boolean","value":"true"}),
    );
    assert_eq!(added["body"], "---\n\"enabled\": true\n---\n# Body\n");
}

#[test]
fn invalid_or_unsupported_yaml_is_never_rewritten_or_partially_saved() {
    let v = vault();
    for yaml in [
        "key: [\n",
        "key: first\nkey: second\n",
        "{key: old, keep: yes}\n",
    ] {
        let source = note(&v, "Invalid", &format!("---\n{yaml}---\nBody"));
        failure(
            &v,
            "property.set",
            json!({"id":source["id"],"expectedRevision":source["revision"],"name":"key","value":"new"}),
            "invalid_frontmatter",
        );
        assert_eq!(read(&v, &source), source);
    }
}

#[test]
fn outline_stats_and_link_audit_are_read_only() {
    let v = vault();
    let target = note(
        &v,
        "Target",
        "# Hello *world*\n\n## 가나다\n````\n# hidden\n````\n",
    );
    let source = note(&v, "Source", "[[Target]] [[Missing]]");
    let before = call(&v, "vault.export", json!({}));
    let outline = call(&v, "note.outline", json!({"id":target["id"]}));
    assert_eq!(
        outline,
        json!([{"level":1,"text":"Hello world","line":1},{"level":2,"text":"가나다","line":3}])
    );
    assert_eq!(
        call(&v, "note.stats", json!({"id":source["id"]}))["words"],
        2
    );
    assert_eq!(
        call(&v, "links.unresolved", json!({}))[0]["name"],
        "Missing"
    );
    assert_eq!(
        call(&v, "links.outgoing", json!({"id":source["id"]}))
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(call(&v, "notes.orphans", json!({}))[0]["id"], source["id"]);
    assert_eq!(call(&v, "notes.deadends", json!({}))[0]["id"], target["id"]);
    assert_eq!(
        call(&v, "vault.export", json!({}))["files"],
        before["files"]
    );
}

#[test]
fn prepend_at_frontmatter_eof_keeps_the_closing_fence_separate_even_inline() {
    let v = vault();
    for inline in [false, true] {
        let source = note(&v, "EOF", "---\nkey: value\n---");
        let result = call(
            &v,
            "note.prepend",
            json!({"id":source["id"],"content":"First","inline":inline}),
        );
        assert_eq!(result["body"], "---\nkey: value\n---\nFirst");
        assert_eq!(
            call(&v, "note.frontmatter", json!({"id":source["id"]}))["properties"]["key"],
            "value"
        );
    }
}

#[test]
fn property_edit_and_delete_keep_comments_before_the_next_property() {
    let v = vault();
    for body in [
        "---\nkey:\n  child: old\n# comment for keep\nkeep: true\n---\nBody",
        "---\n  key:\n    child: old\n\n  # comment for keep\n  keep: true\n---\nBody",
    ] {
        let source = note(&v, "Comments", body);
        let changed = call(
            &v,
            "property.set",
            json!({"id":source["id"],"expectedRevision":source["revision"],"name":"key","value":"new"}),
        );
        assert!(changed["body"]
            .as_str()
            .unwrap()
            .contains("# comment for keep"));
        let removed = call(
            &v,
            "property.remove",
            json!({"id":source["id"],"expectedRevision":changed["revision"],"name":"key"}),
        );
        assert!(removed["body"]
            .as_str()
            .unwrap()
            .contains("# comment for keep"));
        assert_eq!(
            call(&v, "note.frontmatter", json!({"id":source["id"]}))["properties"],
            json!({"keep":true})
        );
    }
}
