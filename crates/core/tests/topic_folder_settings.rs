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
