use foltra_core::{execute, Note};
use serde_json::{json, Value};
use tempfile::TempDir;

fn call(v: &TempDir, command: &str, args: Value) -> Value {
    execute(v.path().to_str().unwrap(), command, args).unwrap()
}
fn vault() -> TempDir {
    let v = tempfile::tempdir().unwrap();
    call(&v, "vault.init", json!({"name":"Topic folders"}));
    v
}
fn folder(v: &TempDir, name: &str, parent: &str) -> String {
    call(v, "folder.create", json!({"name":name,"parentId":parent}))["id"]
        .as_str()
        .unwrap()
        .into()
}
fn note(v: &TempDir, title: &str, body: &str, folder: &str, day: u8) -> Value {
    let n = call(
        v,
        "note.create",
        json!({"title":title,"body":body,"folderId":folder}),
    );
    let path = v
        .path()
        .join(format!("notes/{}.md", n["id"].as_str().unwrap()));
    let mut note = Note::parse(&std::fs::read_to_string(&path).unwrap()).unwrap();
    note.meta.created_at = format!("2026-09-{day:02}T00:00:00Z");
    std::fs::write(path, Note::encode(&note.meta, &note.body).unwrap()).unwrap();
    call(v, "note.read", json!({"id":n["id"]}))
}
fn filter(include: &[&str], exclude: &[&str]) -> Value {
    json!({"include":include,"exclude":exclude})
}
fn page(v: &TempDir, folders: &Value) -> Value {
    call(
        v,
        "topics.blocks",
        json!({"topic":"name:Foo","folders":folders}),
    )
}
fn titles(page: &Value) -> Vec<String> {
    page["blocks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|block| block["noteTitle"].as_str().unwrap().into())
        .collect()
}
fn movement(page: &Value, folders: &Value, source: usize, target: usize) -> Value {
    json!({"topic":"name:Foo","folders":folders,"source":page["blocks"][source]["id"],
        "target":page["blocks"][target]["id"],"placement":"before","sort":page["sort"],
        "expectedRevision":page["orderRevision"]})
}

#[test]
fn descendants_exclusions_and_root_apply_to_counts_without_hiding_link_destinations() {
    let v = vault();
    let parent = folder(&v, "Parent", "");
    let child = folder(&v, "Child", &parent);
    let deep = folder(&v, "Deep", &child);
    let outside = folder(&v, "Outside", "");
    let target = note(&v, "Foo", "", &outside, 1);
    note(&v, "Root", "Root [[Foo]]", "", 2);
    note(
        &v,
        "Parent note",
        "First [[Foo]]\n\nSecond [[Foo]]",
        &parent,
        3,
    );
    note(&v, "Child note", "Child [[Foo]]", &child, 4);
    note(&v, "Deep note", "Deep [[Foo]]", &deep, 5);
    note(&v, "Outside note", "Outside [[Foo]]", &outside, 6);
    let before = call(&v, "vault.export", json!({}))["files"].clone();
    let topic = format!("note:{}", target["id"].as_str().unwrap());
    for (folders, blocks, notes) in [
        (filter(&[], &[]), 6, 5),
        (filter(&[&parent], &[]), 4, 3),
        (filter(&[&parent, &child], &[&deep]), 3, 2),
        (filter(&[&parent], &[&child]), 2, 1),
        (filter(&[""], &[]), 1, 1),
        (filter(&[], &[""]), 5, 4),
    ] {
        let topics = call(&v, "topics.list", json!({"folders":folders}));
        assert_eq!(
            topics,
            json!([{"id":topic,"title":"Foo","noteId":target["id"],"blockCount":blocks,"noteCount":notes}])
        );
        let result = call(
            &v,
            "topics.blocks",
            json!({"topic":topic,"folders":folders}),
        );
        assert_eq!(result["total"], blocks);
        assert_eq!(result["topic"], topics[0]);
    }
    assert_eq!(
        call(
            &v,
            "topics.list",
            json!({"folders":filter(&[&child], &[&parent])})
        ),
        json!([])
    );
    assert_eq!(
        call(&v, "topics.list", json!({})),
        call(&v, "topics.list", json!({"folders":filter(&[], &[])}))
    );
    assert_eq!(call(&v, "vault.export", json!({}))["files"], before);
}

#[test]
fn filtered_dates_and_paging_count_only_visible_blocks() {
    let v = vault();
    let parent = folder(&v, "Visible", "");
    let child = folder(&v, "Nested", &parent);
    let body: String = (0..55).map(|i| format!("- Card {i} [[Foo]]\n")).collect();
    note(&v, "Old", &body, &parent, 1);
    note(&v, "Hidden", "Hidden [[Foo]]", "", 2);
    note(&v, "New", "Newest [[Foo]]\n\nSecond [[Foo]]", &child, 3);
    let folders = filter(&[&parent], &[]);
    let first = page(&v, &folders);
    assert_eq!(first["total"], 57);
    assert_eq!(first["topic"]["noteCount"], 2);
    assert_eq!(first["blocks"].as_array().unwrap().len(), 50);
    assert_eq!(titles(&first)[0], "New");
    let last = call(
        &v,
        "topics.blocks",
        json!({"topic":"name:Foo","folders":folders,"offset":50}),
    );
    assert_eq!(last["total"], 57);
    assert_eq!(last["blocks"].as_array().unwrap().len(), 7);
    assert_eq!(last["orderRevision"], first["orderRevision"]);
    let old = call(
        &v,
        "topics.blocks",
        json!({"topic":"name:Foo","folders":folders,"descending":false,"limit":100}),
    );
    assert_eq!(titles(&old)[0], "Old");
    assert_eq!(titles(&old)[56], "New");
    assert!(titles(&old).iter().all(|title| title != "Hidden"));
}

#[test]
fn deleted_or_unknown_includes_never_fall_back_to_all_notes() {
    let v = vault();
    note(&v, "Root", "Root [[Foo]]", "", 1);
    let deleted = folder(&v, "Deleted", "");
    let inspected = call(&v, "folder.inspect", json!({"id":deleted}));
    call(
        &v,
        "folder.delete",
        json!({"id":deleted,"expectedRevision":inspected["revision"]}),
    );
    for id in [&deleted, "00000000-0000-0000-0000-000000000001"] {
        let folders = filter(&[id], &[]);
        assert_eq!(
            call(&v, "topics.list", json!({"folders":folders})),
            json!([])
        );
        assert_eq!(page(&v, &folders)["total"], 0);
        assert_eq!(page(&v, &filter(&[], &[id]))["total"], 1);
    }
}

#[test]
fn filtered_reorder_preserves_hidden_cards_and_their_relative_order() {
    let v = vault();
    let shown = folder(&v, "Shown", "");
    for (index, (title, location)) in [
        ("A", shown.as_str()),
        ("H1", ""),
        ("B", shown.as_str()),
        ("H2", ""),
        ("C", shown.as_str()),
    ]
    .iter()
    .enumerate()
    {
        note(
            &v,
            title,
            &format!("{title} [[Foo]]"),
            location,
            index as u8 + 1,
        );
    }
    let folders = filter(&[&shown], &[]);
    let original = call(
        &v,
        "topics.blocks",
        json!({"topic":"name:Foo","folders":folders,"sort":"oldest"}),
    );
    assert_eq!(titles(&original), ["A", "B", "C"]);
    let before = call(&v, "vault.export", json!({}))["files"].clone();
    call(&v, "topics.reorder", movement(&original, &folders, 2, 0));
    assert_eq!(titles(&page(&v, &folders)), ["C", "A", "B"]);
    assert_eq!(
        titles(&page(&v, &filter(&[], &[]))),
        ["C", "A", "H1", "B", "H2"]
    );
    let current = page(&v, &folders);
    call(&v, "topics.reorder", movement(&current, &folders, 2, 0));
    assert_eq!(
        titles(&page(&v, &filter(&[], &[]))),
        ["B", "C", "A", "H1", "H2"]
    );
    let after = call(&v, "vault.export", json!({}))["files"].clone();
    for (path, raw) in before.as_object().unwrap() {
        assert_eq!(&after[path], raw);
    }
}

#[test]
fn changed_filters_note_moves_and_folder_moves_reject_stale_reorders() {
    let v = vault();
    let parent = folder(&v, "Parent", "");
    let child = folder(&v, "Child", &parent);
    let outside = folder(&v, "Outside", "");
    let a = note(&v, "A", "A [[Foo]]", &child, 1);
    note(&v, "B", "B [[Foo]]", &child, 2);
    note(&v, "Hidden", "Hidden [[Foo]]", &outside, 3);
    let folders = filter(&[&parent], &[]);
    let current = page(&v, &folders);
    let args = movement(&current, &folders, 0, 1);
    let inspected = call(&v, "folder.inspect", json!({"id":child}));
    call(
        &v,
        "folder.update",
        json!({"id":child,"name":"Renamed child","expectedRevision":inspected["folder"]["revision"]}),
    );
    assert_eq!(
        page(&v, &folders)["orderRevision"],
        current["orderRevision"]
    );
    let before = call(&v, "vault.export", json!({}))["files"].clone();
    let mut changed = args.clone();
    changed["folders"] = filter(&[], &[]);
    assert_eq!(
        execute(v.path().to_str().unwrap(), "topics.reorder", changed)
            .unwrap_err()
            .code,
        "conflict"
    );
    let hidden = page(&v, &filter(&[&outside], &[]));
    for field in ["source", "target"] {
        let mut invalid = args.clone();
        invalid[field] = hidden["blocks"][0]["id"].clone();
        assert_eq!(
            execute(v.path().to_str().unwrap(), "topics.reorder", invalid)
                .unwrap_err()
                .code,
            "not_found"
        );
    }
    assert_eq!(call(&v, "vault.export", json!({}))["files"], before);
    call(
        &v,
        "note.update",
        json!({"id":a["id"],"expectedRevision":a["revision"],"folderId":outside}),
    );
    assert_eq!(
        execute(v.path().to_str().unwrap(), "topics.reorder", args)
            .unwrap_err()
            .code,
        "conflict"
    );
    let current = page(&v, &folders);
    let args = movement(&current, &folders, 0, 0);
    let file = v.path().join(format!("folders/{child}.json"));
    let mut moved: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    moved["parentId"] = json!(outside);
    std::fs::write(file, serde_json::to_string(&moved).unwrap()).unwrap();
    let before = call(&v, "vault.export", json!({}))["files"].clone();
    assert_eq!(
        execute(v.path().to_str().unwrap(), "topics.reorder", args)
            .unwrap_err()
            .code,
        "conflict"
    );
    assert_eq!(page(&v, &folders)["total"], 0);
    assert_eq!(call(&v, "vault.export", json!({}))["files"], before);
}

#[test]
fn folder_filters_validate_shape_ids_and_bounds_for_all_commands() {
    let v = vault();
    for folders in [
        json!(null),
        json!({}),
        json!({"include":[]}),
        json!({"include":[],"exclude":[],"other":true}),
        json!({"include":[1],"exclude":[]}),
        filter(&["../outside"], &[]),
        filter(&[], &["not-an-id"]),
        json!({"include":vec!["";1001],"exclude":[]}),
    ] {
        for command in ["topics.list", "topics.blocks", "topics.reorder"] {
            let mut args = json!({"folders":folders});
            if command != "topics.list" {
                args["topic"] = json!("name:Foo");
            }
            if command == "topics.reorder" {
                for (key, value) in [
                    ("source", "a"),
                    ("target", "b"),
                    ("placement", "before"),
                    ("sort", "custom"),
                    ("expectedRevision", "old"),
                ] {
                    args[key] = json!(value);
                }
            }
            assert!(
                execute(v.path().to_str().unwrap(), command, args).is_err(),
                "{command}: {folders}"
            );
        }
    }
    assert_eq!(
        call(
            &v,
            "topics.list",
            json!({"folders":{"include":vec!["";1000],"exclude":[]}})
        ),
        json!([])
    );
    assert!(!v.path().join(".foltra/topic-order.json").exists());
}
