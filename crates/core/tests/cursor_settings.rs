use foltra_core::execute;
use serde_json::{json, Value};

#[test]
fn cursor_preferences_round_trip_and_reject_invalid_patches_atomically() {
    let vault = tempfile::tempdir().unwrap();
    let path = vault.path().to_str().unwrap();
    execute(path, "vault.init", json!({"name":"Cursor"})).unwrap();
    let call = |command, args| execute(path, command, args).unwrap();
    for shape in ["bar", "block", "underline"] {
        for animation in ["none", "smooth", "smear"] {
            call(
                "settings.update",
                json!({"cursorShape":shape,"cursorAnimation":animation}),
            );
            let saved = call("workspace.get", json!({}));
            assert_eq!(saved["settings"]["cursorShape"], shape);
            assert_eq!(saved["settings"]["cursorAnimation"], animation);
        }
    }
    for blink in ["steady", "blink", "breath"] {
        for rate in [200, 600, 2000] {
            call(
                "settings.update",
                json!({"cursorBlink":blink,"cursorBlinkRate":rate,"cursorFollowVim":false}),
            );
            let saved = call("workspace.get", json!({}));
            assert_eq!(saved["settings"]["cursorBlink"], blink);
            assert_eq!(saved["settings"]["cursorBlinkRate"], rate);
            assert_eq!(saved["settings"]["cursorFollowVim"], false);
            assert_eq!(saved["settings"]["cursorAnimation"], "smear");
        }
    }
    let settings_file = vault.path().join(".foltra/settings.json");
    let before = std::fs::read(&settings_file).unwrap();
    for patch in [
        json!({"cursorShape":"circle","vim":true}),
        json!({"cursorAnimation":"blink","cursorShape":"bar"}),
        json!({"cursorShape":true}),
        json!({"cursorAnimation":null}),
        json!({"cursorBlink":"pulse","cursorShape":"bar"}),
        json!({"cursorBlinkRate":0,"cursorBlink":"breath"}),
        json!({"cursorBlinkRate":199}),
        json!({"cursorBlinkRate":2001}),
        json!({"cursorBlinkRate":600.5}),
        json!({"cursorBlinkRate":"600"}),
        json!({"cursorFollowVim":"true"}),
    ] {
        assert!(execute(path, "settings.update", patch).is_err());
        assert_eq!(std::fs::read(&settings_file).unwrap(), before);
    }
}

#[test]
fn old_and_new_vaults_keep_cursor_defaults_without_rewriting_settings() {
    let vault = tempfile::tempdir().unwrap();
    let path = vault.path().to_str().unwrap();
    execute(path, "vault.init", json!({"name":"Cursor"})).unwrap();
    let assert_defaults = |settings: Value| {
        assert_eq!(settings["cursorShape"], "bar");
        assert_eq!(settings["cursorFollowVim"], true);
        assert_eq!(settings["cursorBlink"], "blink");
        assert_eq!(settings["cursorBlinkRate"], 600);
        assert_eq!(settings["cursorAnimation"], "none");
    };
    assert_defaults(execute(path, "settings.get", json!({})).unwrap());
    let settings_file = vault.path().join(".foltra/settings.json");
    let legacy = r#"{"vim":true,"editorMode":"source","theme":"night"}"#;
    std::fs::write(&settings_file, legacy).unwrap();
    let settings = execute(path, "settings.get", json!({})).unwrap();
    assert_defaults(settings.clone());
    assert_eq!(settings["vim"], true);
    assert_eq!(settings["theme"], "night");
    assert_eq!(std::fs::read_to_string(settings_file).unwrap(), legacy);
}

#[test]
fn old_auto_and_fixed_shapes_migrate_without_changing_their_vim_behavior() {
    let vault = tempfile::tempdir().unwrap();
    let path = vault.path().to_str().unwrap();
    execute(path, "vault.init", json!({"name":"Cursor"})).unwrap();
    let file = vault.path().join(".foltra/settings.json");
    for shape in ["auto", "bar", "block", "underline"] {
        let raw = json!({"vim":true,"cursorShape":shape,"cursorAnimation":"smear"}).to_string();
        std::fs::write(&file, &raw).unwrap();
        let saved = execute(path, "settings.get", json!({})).unwrap();
        assert_eq!(
            saved["cursorShape"],
            if shape == "auto" { "bar" } else { shape }
        );
        assert_eq!(saved["cursorFollowVim"], shape == "auto");
        assert_eq!(saved["cursorAnimation"], "smear");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), raw);
    }
    let saved = execute(path, "settings.update", json!({"cursorShape":"auto"})).unwrap();
    assert_eq!(saved["cursorShape"], "bar");
    assert_eq!(saved["cursorFollowVim"], true);
    // Choosing a new shape must not silently change the separate mode override.
    let saved = execute(path, "settings.update", json!({"cursorShape":"block"})).unwrap();
    assert_eq!(saved["cursorFollowVim"], true);
    let persisted: Value = serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
    assert_eq!(persisted["cursorShape"], "block");
    assert_eq!(persisted["cursorFollowVim"], true);
}
