use foltra_core::execute;
use serde_json::{json, Value};
use tempfile::TempDir;

fn call(v: &TempDir, command: &str, args: Value) -> Value {
    execute(v.path().to_str().unwrap(), command, args).unwrap()
}
fn vault() -> TempDir {
    let v = tempfile::tempdir().unwrap();
    call(&v, "vault.init", json!({"name":"Frontmatter"}));
    v
}
fn note(v: &TempDir, body: &str) -> Value {
    call(v, "note.create", json!({"title":"Source","body":body}))
}
fn properties(v: &TempDir, note: &Value) -> Value {
    call(v, "note.frontmatter", json!({"id":note["id"]}))
}

#[test]
fn reads_yaml_values_without_changing_the_managed_header_source_or_revision() {
    let v = vault();
    let body="---\n# Keep this comment\ntitle: 사용자 제목\ncount: 7\nratio: 1.25\nactive: true\nempty: null\ndate: 2026-09-17\nquoted: 'true'\nlist: [one, 2, false]\nnested:\n  author: Me\nmultiline: |\n  First\n  Second\n---\n# Body\nExact whitespace  \n";
    let source = note(&v, body);
    let before = call(&v, "vault.export", json!({}))["files"].clone();
    assert_eq!(
        properties(&v, &source),
        json!({"properties":{
        "title":"사용자 제목","count":7,"ratio":1.25,"active":true,"empty":null,
        "date":"2026-09-17","quoted":"true","list":["one",2,false],
        "nested":{"author":"Me"},"multiline":"First\nSecond\n"
    },"error":null})
    );
    assert_eq!(call(&v, "note.read", json!({"id":source["id"]})), source);
    assert_eq!(source["body"], body);
    assert_eq!(source["title"], "Source");
    assert_eq!(call(&v, "vault.export", json!({}))["files"], before);
}

#[test]
fn boundaries_match_bom_crlf_standalone_fences_and_keep_unclosed_horizontal_rules_as_markdown() {
    let v = vault();
    let source = note(
        &v,
        "\u{feff}--- \t\r\nkey: yes\r\n--- \t\r\n[[Real]] #body\r\n",
    );
    assert_eq!(
        properties(&v, &source),
        json!({"properties":{"key":"yes"},"error":null})
    );
    let links = call(&v, "links.list", json!({}));
    assert_eq!(links[0]["name"], "Real");
    assert_eq!(links[0]["line"], 4);
    for body in [
        "---",
        "---\n[[Ordinary]] #ordinary",
        "Before\n---\nkey: value\n---",
        " ---\nkey: value\n---",
        "---\nkey: value\n---\r",
    ] {
        let source = note(&v, body);
        assert_eq!(
            properties(&v, &source),
            json!({"properties":null,"error":null}),
            "{body}"
        );
        assert_eq!(
            call(&v, "note.read", json!({"id":source["id"]}))["body"],
            body
        );
    }
    for yaml in ["", "# comment only\n", "null\n", "{}\n"] {
        let source = note(&v, &format!("---\n{yaml}---\n"));
        assert_eq!(
            properties(&v, &source),
            json!({"properties":{},"error":null})
        );
    }
}

#[test]
fn invalid_yaml_is_saved_verbatim_and_errors_are_read_only_metadata() {
    let v = vault();
    for yaml in [
        "broken: [unclosed\n",
        "key: one\nkey: two\n",
        "nested: {same: 1, same: 2}\n",
        "first: &shared [one, two]\nsecond: *shared\n",
        "value: !custom example\n",
        "value: !custom [one]\n",
        "value: !custom {one: two}\n",
        "[one, two]\n",
        "true: value\n",
        "'': value\n",
        "value: .inf\n",
        "value: .nan\n",
        "value: 9007199254740992\n",
        "value: -9007199254740992\n",
        "value: 1e20\n",
        "value: 0xffffffffffffffff\n",
        "value: 0o77777777777777777777777777\n",
        "? [complex, key]\n: value\n",
    ] {
        let body = format!("---\n{yaml}---\nBody remains\n");
        let source = note(&v, &body);
        let before = call(&v, "vault.export", json!({}))["files"].clone();
        let result = properties(&v, &source);
        assert!(result["properties"].is_null(), "{yaml}");
        assert!(result["error"].is_string(), "{yaml}");
        assert_eq!(
            call(&v, "note.read", json!({"id":source["id"]}))["body"],
            body
        );
        assert_eq!(call(&v, "vault.export", json!({}))["files"], before);
        let next = format!("{body}Edited\n");
        let updated = call(
            &v,
            "note.update",
            json!({"id":source["id"],"expectedRevision":source["revision"],"body":next}),
        );
        assert_eq!(updated["body"], next);
        assert!(properties(&v, &updated)["error"].is_string());
    }
}

#[test]
fn aliases_depth_and_utf8_size_are_bounded_without_expansion_or_source_loss() {
    let v = vault();
    let valid = note(
        &v,
        &format!("---\nvalue: {}0{}\n---", "[".repeat(15), "]".repeat(15)),
    );
    assert!(properties(&v, &valid)["error"].is_null());
    for yaml in [
        format!("value: {}0{}\n", "[".repeat(1000), "]".repeat(1000)),
        format!("value: {}\n", "한".repeat(24_000)),
        "a: &a [*a]\n".to_string(),
        "a: &a [one]\nb: &b [*a,*a,*a,*a]\nc: [*b,*b,*b,*b]\n".to_string(),
    ] {
        let body = format!("---\n{yaml}---\nContent");
        let source = note(&v, &body);
        assert!(properties(&v, &source)["error"].is_string());
        assert_eq!(call(&v, "note.read", json!({"id":source["id"]})), source);
    }
}

#[test]
fn builtin_scalar_tags_and_safe_integer_boundaries_remain_json_compatible() {
    let v = vault();
    let source=note(&v,"---\nmax: 9007199254740991\nmin: -9007199254740991\nbig: '9007199254740992'\ntext: !!str 123\nnumber: !!int '42'\nflag: !!bool TRUE\nsequence: !!seq [one]\nmap: !!map {name: value}\n---\n");
    assert_eq!(
        properties(&v, &source),
        json!({"properties":{
        "max":9007199254740991_i64,"min":-9007199254740991_i64,"big":"9007199254740992",
        "text":"123","number":42,"flag":true,"sequence":["one"],"map":{"name":"value"}
    },"error":null})
    );
}

#[test]
fn explicit_float_tags_accept_decimal_numbers_and_reject_hex_and_octal_without_source_changes() {
    let v = vault();
    for value in [
        "!!float 0x2a",
        "!!float 0o10",
        "!!float '0x2a'",
        "!!float '0o10'",
        "!!float 42",
        "!!float '42'",
    ] {
        let body = format!("---\nvalue: {value}\n---\nBody");
        let source = note(&v, &body);
        let result = properties(&v, &source);
        assert!(result["properties"].is_null(), "{value}");
        assert!(result["error"].is_string(), "{value}");
        assert_eq!(call(&v, "note.read", json!({"id":source["id"]})), source);
        assert_eq!(source["body"], body);
    }
    for (value, expected) in [
        ("!!float 42.0", 42.0),
        ("!!float '42.5'", 42.5),
        ("!!float 1e3", 1000.0),
        ("!!int 0x2a", 42.0),
        ("!!int 0o10", 8.0),
    ] {
        let source = note(&v, &format!("---\nvalue: {value}\n---\n"));
        let result = properties(&v, &source);
        assert!(result["error"].is_null(), "{value}");
        assert_eq!(
            result["properties"]["value"].as_f64(),
            Some(expected),
            "{value}"
        );
    }
}

#[test]
fn yaml_links_tags_and_fake_blocks_are_never_markdown_or_rewritten_by_note_rename() {
    let v = vault();
    let target = call(&v, "note.create", json!({"title":"Target"}));
    let yaml="---\nlink: '[[Target|inside]]'\n# Hidden #metadata\ntext: |\n  - [[Target]] #anki\n  # Fake heading [[Hidden]]\n---\n";
    let source = note(
        &v,
        &format!("{yaml}- Real [[Target|outside]] #anki\n  - Child\n"),
    );
    let links = call(&v, "links.list", json!({}));
    assert_eq!(links.as_array().unwrap().len(), 1);
    assert_eq!(links[0]["line"], 8);
    let topic = format!("note:{}", target["id"].as_str().unwrap());
    let blocks = call(&v, "topics.blocks", json!({"topic":topic}));
    assert_eq!(blocks["total"], 1);
    assert_eq!(blocks["blocks"][0]["line"], 8);
    assert!(blocks["blocks"][0]["body"]
        .as_str()
        .unwrap()
        .starts_with("- Real"));
    let tagged = call(&v, "tags.blocks", json!({"tag":"anki"}));
    assert_eq!(tagged["total"], 1);
    assert_eq!(tagged["blocks"][0]["line"], 8);
    call(
        &v,
        "note.update",
        json!({"id":target["id"],"expectedRevision":target["revision"],"title":"Renamed"}),
    );
    assert_eq!(
        call(&v, "note.read", json!({"id":source["id"]}))["body"],
        format!("{yaml}- Real [[Renamed|outside]] #anki\n  - Child\n")
    );
}

#[test]
fn property_tags_are_normalized_deduplicated_and_searchable_but_do_not_create_anki_blocks() {
    let v = vault();
    let a=note(&v,"---\ntags: [Work, '#WORK', '한글/주제', anki, 'bad tag', 'x,other', '##bad', '] #sneaky']\n---\nBody #work\n");
    let b = note(&v, "---\ntags: '#AnKi'\n---\nBody without a tag\n");
    note(&v, "---\n# Comment #ignored\ntags: [ignored, 7]\n---\nBody");
    assert_eq!(
        call(&v, "tags.list", json!({})),
        json!([
            {"name":"anki","noteCount":2},{"name":"work","noteCount":1},{"name":"한글/주제","noteCount":1}
        ])
    );
    let results = call(&v, "search", json!({"query":"tag:anki"}));
    assert_eq!(results.as_array().unwrap().len(), 2);
    assert!(results
        .as_array()
        .unwrap()
        .iter()
        .any(|result| result["id"] == a["id"]));
    assert!(results
        .as_array()
        .unwrap()
        .iter()
        .any(|result| result["id"] == b["id"]));
    assert_eq!(
        call(&v, "search", json!({"query":"tag:#한글/주제"}))
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(call(&v, "tags.blocks", json!({"tag":"anki"}))["total"], 0);
    assert_eq!(call(&v, "tags.blocks", json!({"tag":"work"}))["total"], 1);
}
