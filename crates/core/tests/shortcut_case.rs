use foltra_core::execute;
use serde_json::json;

#[test]
fn legacy_shortcut_labels_keep_their_behavior_and_new_settings_preserve_case() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    execute(path, "vault.init", json!({"name":"Shortcut case"})).unwrap();
    let file = dir.path().join(".foltra/settings.json");
    let old = json!({"keybindings":{
        "focus.left":{"shortcut":"Ctrl+H"},
        "focus.up":{"shortcut":"Ctrl+Shift+K"},
        "note.rename":{"shortcut":"F2","leader":"r n"}
    }})
    .to_string();
    std::fs::write(&file, &old).unwrap();
    let loaded = execute(path, "settings.get", json!({})).unwrap();
    assert_eq!(loaded["shortcutVersion"], 4);
    assert_eq!(loaded["keybindings"]["focus.left"][0]["keys"], "Ctrl+h");
    assert_eq!(loaded["keybindings"]["focus.up"][0]["keys"], "Ctrl+Shift+k");
    assert_eq!(loaded["keybindings"]["note.rename"][0]["keys"], "F2");
    assert_eq!(std::fs::read_to_string(&file).unwrap(), old);
    execute(path, "settings.update", json!({"theme":"night"})).unwrap();
    let stored: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(stored["shortcutVersion"], 4);
    assert_eq!(stored["keybindings"], loaded["keybindings"]);
    let bindings = json!({"focus.left":[{"keys":"Ctrl+h","leader":false}],"focus.right":[{"keys":"Ctrl+H","leader":false},{"keys":"R n","leader":true}]});
    execute(path, "settings.update", json!({"keybindings":bindings})).unwrap();
    assert_eq!(
        execute(path, "settings.get", json!({})).unwrap()["keybindings"],
        bindings
    );
    for version in [0, 5] {
        std::fs::write(&file, json!({"shortcutVersion":version}).to_string()).unwrap();
        assert_eq!(
            execute(path, "settings.get", json!({})).unwrap_err().code,
            "invalid_settings"
        );
    }
}
