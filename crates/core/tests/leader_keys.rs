use foltra_core::execute;
use serde_json::json;

#[test]
fn recorded_leader_keys_roundtrip_through_settings_and_reject_malformed_values_atomically() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    execute(path, "vault.init", json!({"name":"Leader keys"})).unwrap();
    for value in [
        " ",
        ",",
        "\\",
        ";",
        "Ctrl+Space",
        "Meta+Shift+k",
        "Shift++",
        "F9",
        "Alt+ArrowRight",
    ] {
        execute(path, "settings.update", json!({"leader":value})).unwrap();
        assert_eq!(
            execute(path, "settings.get", json!({})).unwrap()["leader"],
            value
        );
    }
    let before = std::fs::read(dir.path().join(".foltra/settings.json")).unwrap();
    for value in [
        "",
        "\n",
        "\u{200b}",
        "Ctrl+Ctrl+a",
        "Alt+Ctrl+a",
        "F01",
        "F+1",
        "F25",
        "Ctrl+Escape",
        "abc",
    ] {
        assert_eq!(
            execute(path, "settings.update", json!({"leader":value}))
                .unwrap_err()
                .code,
            "invalid_settings",
            "{value:?}"
        );
        assert_eq!(
            std::fs::read(dir.path().join(".foltra/settings.json")).unwrap(),
            before
        );
    }
}
