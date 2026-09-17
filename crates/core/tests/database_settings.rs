use foltra_core::execute;
use serde_json::json;

#[test]
fn database_font_size_defaults_migrates_and_persists_per_vault() {
    let vault = tempfile::tempdir().unwrap();
    let path = vault.path().to_str().unwrap();
    execute(path, "vault.init", json!({"name":"Database type"})).unwrap();
    let settings = || execute(path, "settings.get", json!({})).unwrap();
    assert_eq!(settings()["databaseFontSize"], 14);
    let file = vault.path().join(".foltra/settings.json");
    let legacy = r#"{"vim":true,"editorMode":"source"}"#;
    std::fs::write(&file, legacy).unwrap();
    assert_eq!(settings()["databaseFontSize"], 14);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), legacy);
    for size in [12, 16, 20, 14] {
        execute(path, "settings.update", json!({"databaseFontSize":size})).unwrap();
        let reopened = execute(path, "workspace.get", json!({})).unwrap();
        assert_eq!(reopened["settings"]["databaseFontSize"], size);
        assert_eq!(reopened["settings"]["vim"], true);
        assert_eq!(reopened["settings"]["editorMode"], "source");
    }
    execute(path, "settings.update", json!({"databaseFontSize":18})).unwrap();
    let other = tempfile::tempdir().unwrap();
    let other_path = other.path().to_str().unwrap();
    execute(other_path, "vault.init", json!({"name":"Other vault"})).unwrap();
    assert_eq!(
        execute(other_path, "settings.get", json!({})).unwrap()["databaseFontSize"],
        14
    );
    assert_eq!(settings()["databaseFontSize"], 18);
}

#[test]
fn invalid_database_font_size_rejects_entire_patch_without_writing() {
    let vault = tempfile::tempdir().unwrap();
    let path = vault.path().to_str().unwrap();
    execute(path, "vault.init", json!({"name":"Database validation"})).unwrap();
    execute(path, "settings.update", json!({"databaseFontSize":16})).unwrap();
    let file = vault.path().join(".foltra/settings.json");
    let before = std::fs::read(&file).unwrap();
    for invalid in [
        json!(11),
        json!(21),
        json!(-1),
        json!(14.5),
        json!("16"),
        json!(true),
        json!(null),
    ] {
        assert!(execute(
            path,
            "settings.update",
            json!({"databaseFontSize":invalid,"vim":true})
        )
        .is_err());
        assert_eq!(std::fs::read(&file).unwrap(), before);
    }
}
