use foltra_core::execute;
use serde_json::json;

#[test]
fn line_number_settings_default_off_persist_and_reject_invalid_patches() {
    let vault = tempfile::tempdir().unwrap();
    let path = vault.path().to_str().unwrap();
    execute(path, "vault.init", json!({"name":"Line numbers"})).unwrap();
    let settings = || execute(path, "settings.get", json!({})).unwrap();
    assert_eq!(settings()["lineNumbers"], "none");
    let file = vault.path().join(".foltra/settings.json");
    let legacy = r#"{"vim":true,"editorMode":"source"}"#;
    std::fs::write(&file, legacy).unwrap();
    assert_eq!(settings()["lineNumbers"], "none");
    assert_eq!(std::fs::read_to_string(&file).unwrap(), legacy);
    for mode in ["absolute", "relative", "none"] {
        execute(path, "settings.update", json!({"lineNumbers":mode})).unwrap();
        let reopened = execute(path, "workspace.get", json!({})).unwrap();
        assert_eq!(reopened["settings"]["lineNumbers"], mode);
        assert_eq!(reopened["settings"]["vim"], true);
        assert_eq!(reopened["settings"]["editorMode"], "source");
    }
    let before = std::fs::read(&file).unwrap();
    for mode in [json!(true), json!(null), json!("hybrid"), json!(1)] {
        assert!(execute(
            path,
            "settings.update",
            json!({"lineNumbers":mode,"vim":false})
        )
        .is_err());
        assert_eq!(std::fs::read(&file).unwrap(), before);
    }
}
