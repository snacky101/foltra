use foltra_core::execute;
use serde_json::json;

#[test]
fn topic_folder_preferences_default_and_persist_per_vault() {
    let vault = tempfile::tempdir().unwrap();
    let path = vault.path().to_str().unwrap();
    execute(path, "vault.init", json!({"name":"Topic folder settings"})).unwrap();
    let file = vault.path().join(".foltra/settings.json");
    let legacy = r#"{"vim":true}"#;
    std::fs::write(&file, legacy).unwrap();
    let settings = execute(path, "settings.get", json!({})).unwrap();
    assert_eq!(settings["topicFolders"], json!({"include":[],"exclude":[]}));
    assert_eq!(std::fs::read_to_string(&file).unwrap(), legacy);
    let selected = json!({"include":[""],"exclude":["00000000-0000-0000-0000-000000000001"]});
    execute(path, "settings.update", json!({"topicFolders":selected})).unwrap();
    let reopened = execute(path, "workspace.get", json!({})).unwrap();
    assert_eq!(reopened["settings"]["topicFolders"], selected);
    assert_eq!(reopened["settings"]["vim"], true);
    let other = tempfile::tempdir().unwrap();
    let other_path = other.path().to_str().unwrap();
    execute(other_path, "vault.init", json!({"name":"Other"})).unwrap();
    assert_eq!(
        execute(other_path, "settings.get", json!({})).unwrap()["topicFolders"],
        json!({"include":[],"exclude":[]})
    );
}

#[test]
fn invalid_topic_folder_preferences_do_not_partially_save() {
    let vault = tempfile::tempdir().unwrap();
    let path = vault.path().to_str().unwrap();
    execute(
        path,
        "vault.init",
        json!({"name":"Topic folder validation"}),
    )
    .unwrap();
    execute(path, "settings.update", json!({"vim":false})).unwrap();
    let file = vault.path().join(".foltra/settings.json");
    let before = std::fs::read(&file).unwrap();
    for invalid in [
        json!(null),
        json!({}),
        json!({"include":[],"exclude":false}),
        json!({"include":[true],"exclude":[]}),
        json!({"include":["../secret"],"exclude":[]}),
        json!({"include":[],"exclude":[],"extra":true}),
        json!({"include":vec!["";1001],"exclude":[]}),
    ] {
        assert!(execute(
            path,
            "settings.update",
            json!({"topicFolders":invalid,"vim":true})
        )
        .is_err());
        assert_eq!(std::fs::read(&file).unwrap(), before);
    }
}

#[test]
fn graph_timeline_and_custom_tree_preferences_are_independent_and_validated() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    execute(path, "vault.init", json!({"name":"Views"})).unwrap();
    let folder = execute(path, "folder.create", json!({"name":"Work"})).unwrap();
    let id = folder["id"].clone();
    let graph = json!({"include":[id],"exclude":[]});
    execute(
        path,
        "settings.update",
        json!({"graphFolders":graph,"treeCustomSort":true,"treeOrder":[id]}),
    )
    .unwrap();
    let settings = execute(path, "settings.get", json!({})).unwrap();
    assert_eq!(settings["graphFolders"], graph);
    assert_eq!(
        settings["timelineFolders"],
        json!({"include":[],"exclude":[]})
    );
    assert_eq!(settings["topicFolders"], json!({"include":[],"exclude":[]}));
    assert_eq!(settings["treeOrder"], json!([id]));
    for patch in [
        json!({"graphFolders":{"include":["invalid"],"exclude":[]}}),
        json!({"timelineFolders":{"exclude":true}}),
        json!({"treeOrder":[id,id]}),
        json!({"treeOrder":["../path"]}),
        json!({"treeCustomSort":"yes"}),
    ] {
        assert!(execute(path, "settings.update", patch).is_err());
        assert_eq!(execute(path, "settings.get", json!({})).unwrap(), settings);
    }
}
