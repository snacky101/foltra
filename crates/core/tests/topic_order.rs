use foltra_core::execute;
use serde_json::{json, Value};
use tempfile::TempDir;

fn call(v: &TempDir, cmd: &str, args: Value) -> Value {
    execute(v.path().to_str().unwrap(), cmd, args).unwrap()
}
fn vault() -> TempDir {
    let v = tempfile::tempdir().unwrap();
    call(&v, "vault.init", json!({"name":"Order"}));
    v
}
fn note(v: &TempDir, title: &str, body: &str) -> Value {
    call(v, "note.create", json!({"title":title,"body":body}))
}
fn page(v: &TempDir, topic: &str) -> Value {
    call(v, "topics.blocks", json!({"topic":topic}))
}
fn bodies(p: &Value) -> Vec<String> {
    p["blocks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["body"].as_str().unwrap().into())
        .collect()
}
fn move_card(
    v: &TempDir,
    topic: &str,
    p: &Value,
    source: usize,
    target: usize,
    placement: &str,
) -> Value {
    call(
        v,
        "topics.reorder",
        json!({"topic":topic,"source":p["blocks"][source]["id"],"target":p["blocks"][target]["id"],"placement":placement,"sort":p["sort"],"expectedRevision":p["orderRevision"]}),
    )
}

#[test]
fn order_is_durable_per_topic_preserves_sources_and_date_sort_and_exports() {
    let v = vault();
    note(
        &v,
        "Source",
        "A [[Foo]] [[Bar]]\n\nB [[Foo]] [[Bar]]\n\n- C [[Foo]] [[Bar]]\n  - Child",
    );
    let before = call(&v, "vault.export", json!({}));
    let p = page(&v, "name:Foo");
    assert_eq!(p["sort"], "newest");
    move_card(&v, "name:Foo", &p, 2, 0, "before");
    let custom = page(&v, "name:Foo");
    assert_eq!(custom["sort"], "custom");
    assert_eq!(
        bodies(&custom),
        vec![
            bodies(&p)[2].clone(),
            bodies(&p)[0].clone(),
            bodies(&p)[1].clone()
        ]
    );
    assert_eq!(bodies(&page(&v, "name:Bar")), bodies(&p));
    let dated = call(
        &v,
        "topics.blocks",
        json!({"topic":"name:Foo","sort":"oldest"}),
    );
    assert_eq!(bodies(&dated), bodies(&p));
    assert_eq!(bodies(&page(&v, "name:Foo")), bodies(&custom));
    let after = call(&v, "vault.export", json!({}));
    for (path, contents) in before["files"].as_object().unwrap() {
        assert_eq!(&after["files"][path], contents);
    }
    assert!(after["files"][".foltra/topic-order.json"].is_string());
    let restored = tempfile::tempdir().unwrap();
    call(&restored, "vault.import", json!({"snapshot":after}));
    assert_eq!(bodies(&page(&restored, "name:Foo")), bodies(&custom));
}

#[test]
fn order_follows_insertions_edits_and_topic_renames_without_rewriting_notes() {
    let v = vault();
    let source = note(&v, "Source", "A [[Foo]]\n\nB [[Foo]]\n\nC [[Foo]]");
    let p = page(&v, "name:Foo");
    move_card(&v, "name:Foo", &p, 2, 0, "before");
    let changed = call(
        &v,
        "note.update",
        json!({"id":source["id"],"expectedRevision":source["revision"],"body":"Intro\n\nA [[Foo]]\n\nB [[Foo]]\n\nC edited [[Foo]]"}),
    );
    assert_eq!(
        bodies(&page(&v, "name:Foo")),
        ["C edited [[Foo]]", "A [[Foo]]", "B [[Foo]]"]
    );
    call(
        &v,
        "note.update",
        json!({"id":changed["id"],"expectedRevision":changed["revision"],"body":"New [[Foo]]\n\nA [[Foo]]\n\nB [[Foo]]\n\nC [[Foo]]"}),
    );
    assert_eq!(
        bodies(&page(&v, "name:Foo")),
        ["C [[Foo]]", "A [[Foo]]", "B [[Foo]]", "New [[Foo]]"]
    );
    let target = note(&v, "Foo", "");
    call(
        &v,
        "note.update",
        json!({"id":target["id"],"expectedRevision":target["revision"],"title":"Renamed"}),
    );
    let key = format!("note:{}", target["id"].as_str().unwrap());
    assert_eq!(
        bodies(&page(&v, &key)),
        [
            "C [[Renamed]]",
            "A [[Renamed]]",
            "B [[Renamed]]",
            "New [[Renamed]]"
        ]
    );
}

#[test]
fn stale_source_or_order_snapshot_and_invalid_targets_do_not_write() {
    let v = vault();
    let n = note(&v, "S", "A [[Foo]]\n\nB [[Foo]]");
    let p = page(&v, "name:Foo");
    let args = json!({"topic":"name:Foo","source":p["blocks"][0]["id"],"target":p["blocks"][1]["id"],"placement":"after","sort":"newest","expectedRevision":p["orderRevision"]});
    let current = call(&v, "vault.export", json!({}));
    let mut invalid = args.clone();
    invalid["target"] = json!("missing");
    assert!(execute(v.path().to_str().unwrap(), "topics.reorder", invalid).is_err());
    assert_eq!(
        call(&v, "vault.export", json!({}))["files"],
        current["files"]
    );
    call(&v, "topics.reorder", args.clone());
    assert_eq!(
        execute(v.path().to_str().unwrap(), "topics.reorder", args.clone())
            .unwrap_err()
            .code,
        "conflict"
    );
    let p = page(&v, "name:Foo");
    let mut args = args;
    args["expectedRevision"] = p["orderRevision"].clone();
    call(
        &v,
        "note.update",
        json!({"id":n["id"],"expectedRevision":n["revision"],"body":"Changed [[Foo]]\n\nB [[Foo]]"}),
    );
    let before = call(&v, "vault.export", json!({}));
    assert_eq!(
        execute(v.path().to_str().unwrap(), "topics.reorder", args)
            .unwrap_err()
            .code,
        "conflict"
    );
    assert_eq!(
        call(&v, "vault.export", json!({}))["files"],
        before["files"]
    );
}

#[test]
fn moves_across_pages_and_preserves_duplicate_cards() {
    let v = vault();
    let body = (0..55)
        .map(|i| format!("Card {i} [[Foo]]\n\n"))
        .collect::<String>();
    note(&v, "Many", &body);
    let p = page(&v, "name:Foo");
    let last = call(&v, "topics.blocks", json!({"topic":"name:Foo","offset":50}));
    call(
        &v,
        "topics.reorder",
        json!({"topic":"name:Foo","source":last["blocks"][4]["id"],"target":p["blocks"][0]["id"],"placement":"before","sort":p["sort"],"expectedRevision":p["orderRevision"]}),
    );
    assert_eq!(page(&v, "name:Foo")["blocks"][0]["body"], "Card 54 [[Foo]]");
    let v = vault();
    note(
        &v,
        "Duplicates",
        "Same [[Foo]]\n\nSame [[Foo]]\n\nOther [[Foo]]",
    );
    let p = page(&v, "name:Foo");
    move_card(&v, "name:Foo", &p, 1, 2, "after");
    let p = page(&v, "name:Foo");
    assert_eq!(p["blocks"][0]["line"], 1);
    assert_eq!(p["blocks"][1]["line"], 5);
    assert_eq!(p["blocks"][2]["line"], 3);
}

#[test]
fn deleted_card_does_not_claim_an_unrelated_new_card_and_backup_rejects_bad_anchors() {
    let v = vault();
    let n = note(&v, "Source", "A [[Foo]]\n\nB [[Foo]]\n\nC [[Foo]]");
    let p = page(&v, "name:Foo");
    move_card(&v, "name:Foo", &p, 1, 0, "before");
    call(
        &v,
        "note.update",
        json!({"id":n["id"],"expectedRevision":n["revision"],"body":"A [[Foo]]\n\nC [[Foo]]\n\nNew [[Foo]]"}),
    );
    assert_eq!(
        bodies(&page(&v, "name:Foo")),
        ["A [[Foo]]", "C [[Foo]]", "New [[Foo]]"]
    );
    let mut backup = call(&v, "vault.export", json!({}));
    let mut raw: Value = serde_json::from_str(
        backup["files"][".foltra/topic-order.json"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    raw["topics"]["name:Foo"][0]["noteId"] = json!("../outside");
    backup["files"][".foltra/topic-order.json"] = json!(serde_json::to_string(&raw).unwrap());
    let restored = tempfile::tempdir().unwrap();
    assert!(execute(
        restored.path().to_str().unwrap(),
        "vault.import",
        json!({"snapshot":backup})
    )
    .is_err());
    assert!(!restored.path().join(".foltra/vault.json").exists());
}
