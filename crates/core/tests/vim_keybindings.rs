use foltra_core::execute;
use serde_json::json;

#[test]
fn version_three_splits_only_plain_gd_and_preserves_explicit_version_four_choices() {
    let vault = tempfile::tempdir().unwrap();
    let path = vault.path().to_str().unwrap();
    execute(path, "vault.init", json!({"name":"Link commands"})).unwrap();
    let file = vault.path().join(".foltra/settings.json");
    let old = json!({"shortcutVersion":3,"keybindings":{
        "note.follow-link":[{"keys":"g d","leader":false},{"keys":"Mod+Enter","leader":false},{"keys":"gd","leader":true},{"keys":"gD","leader":false}]
    }}).to_string();
    std::fs::write(&file, &old).unwrap();
    let loaded = execute(path, "settings.get", json!({})).unwrap();
    assert_eq!(loaded["shortcutVersion"], 4);
    assert_eq!(
        loaded["keybindings"]["note.follow-existing-link"],
        json!([{"keys":"g d","leader":false}])
    );
    assert_eq!(
        loaded["keybindings"]["note.follow-link"],
        json!([{"keys":"Mod+Enter","leader":false},{"keys":"gd","leader":true},{"keys":"gD","leader":false}])
    );
    assert_eq!(std::fs::read_to_string(&file).unwrap(), old);
    execute(path, "settings.update", json!({"vim":true})).unwrap();
    assert_eq!(
        execute(path, "settings.get", json!({})).unwrap()["keybindings"],
        loaded["keybindings"]
    );
    let custom =
        json!({"note.follow-link":[{"keys":"gd","leader":false}],"note.follow-existing-link":[]});
    execute(path, "settings.update", json!({"keybindings":custom})).unwrap();
    assert_eq!(
        execute(path, "settings.get", json!({})).unwrap()["keybindings"],
        custom
    );
}

#[test]
fn legacy_bindings_migrate_without_rewriting_or_losing_any_shortcut() {
    let vault = tempfile::tempdir().unwrap();
    let path = vault.path().to_str().unwrap();
    execute(path, "vault.init", json!({"name":"Key migration"})).unwrap();
    let file = vault.path().join(".foltra/settings.json");
    let old = json!({"shortcutVersion":2,"keybindings":{
        "note.follow-link":{"leader":"l o","shortcut":"Mod+Enter","vimNormal":"gD"},
        "plugin.example.run":{"leader":"g t","shortcut":"Ctrl+H","vimNormal":"gT"},
        "plugin.legacy.keys":{"leader":"F2","vimNormal":"Enter"}
    }})
    .to_string();
    std::fs::write(&file, &old).unwrap();
    let loaded = execute(path, "settings.get", json!({})).unwrap();
    assert_eq!(loaded["shortcutVersion"], 4);
    assert_eq!(
        loaded["keybindings"],
        json!({
            "note.follow-link":[{"keys":"Mod+Enter","leader":false},{"keys":"l o","leader":true},{"keys":"g D","leader":false}],
        "note.follow-existing-link":[],
        "plugin.example.run":[{"keys":"Ctrl+H","leader":false},{"keys":"g t","leader":true},{"keys":"g T","leader":false}],
        "plugin.legacy.keys":[{"keys":"F 2","leader":true},{"keys":"E n t e r","leader":false}]
        })
    );
    assert_eq!(std::fs::read_to_string(&file).unwrap(), old);
    execute(path, "settings.update", json!({"vim":true})).unwrap();
    let stored: serde_json::Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    assert_eq!(stored["keybindings"], loaded["keybindings"]);
    assert_eq!(
        execute(path, "settings.get", json!({})).unwrap()["keybindings"],
        loaded["keybindings"]
    );
}

#[test]
fn legacy_missing_normal_keeps_gd_but_explicit_empty_disables_it() {
    let vault = tempfile::tempdir().unwrap();
    let path = vault.path().to_str().unwrap();
    execute(path, "vault.init", json!({"name":"Legacy default"})).unwrap();
    for (fields, expected, existing) in [
        (
            json!({"leader":"l o"}),
            json!([{"keys":"l o","leader":true}]),
            json!([{"keys":"g d","leader":false}]),
        ),
        (
            json!({"leader":"l o","vimNormal":""}),
            json!([{"keys":"l o","leader":true}]),
            json!([]),
        ),
    ] {
        let result = execute(
            path,
            "settings.update",
            json!({"keybindings":{"note.follow-link":fields}}),
        )
        .unwrap();
        assert_eq!(result["keybindings"]["note.follow-link"], expected);
        assert_eq!(result["keybindings"]["note.follow-existing-link"], existing);
    }
}

#[test]
fn unified_bindings_toggle_leader_persist_multiple_rows_and_allow_disabling_all() {
    let vault = tempfile::tempdir().unwrap();
    let path = vault.path().to_str().unwrap();
    execute(path, "vault.init", json!({"name":"Unified keys"})).unwrap();
    for leader in [false, true, false] {
        let bindings = json!({
            "note.follow-link":[{"keys":"g d","leader":leader},{"keys":"Mod+Enter","leader":false}],
            "plugin.example.run":[{"keys":"g t","leader":true},{"keys":"Mod+Enter","leader":true}]
        });
        execute(path, "settings.update", json!({"keybindings":bindings})).unwrap();
        assert_eq!(
            execute(path, "workspace.get", json!({})).unwrap()["settings"]["keybindings"],
            bindings
        );
    }
    execute(
        path,
        "settings.update",
        json!({"keybindings":{"note.follow-link":[]}}),
    )
    .unwrap();
    assert_eq!(
        execute(path, "settings.get", json!({})).unwrap()["keybindings"]["note.follow-link"],
        json!([])
    );
    execute(path, "settings.update", json!({"keybindings":{}})).unwrap();
    assert_eq!(
        execute(path, "settings.get", json!({})).unwrap()["keybindings"],
        json!({})
    );
}

#[test]
fn invalid_binding_rejects_the_entire_patch_and_keeps_the_saved_file() {
    let vault = tempfile::tempdir().unwrap();
    let path = vault.path().to_str().unwrap();
    execute(path, "vault.init", json!({"name":"Key validation"})).unwrap();
    execute(path, "settings.update", json!({"vim":true})).unwrap();
    let file = vault.path().join(".foltra/settings.json");
    let before = std::fs::read(&file).unwrap();
    for binding in [
        json!([{"keys":"gd","leader":"true"}]),
        json!([{"keys":"gd"}]),
        json!([{"keys":3,"leader":false}]),
        json!([{"keys":"gd","leader":false,"extra":true}]),
        json!([{"keys":"g\nd","leader":true}]),
        json!([{"keys":"2gd","leader":false}]),
        json!([{"keys":"<Esc>","leader":false}]),
        json!([{"keys":" ","leader":false}]),
        json!([{"keys":"가","leader":false}]),
        json!([{"keys":"abcdefghijklm","leader":false}]),
        json!([{"keys":" ".repeat(81),"leader":false}]),
        json!({"vimNormal":"g\nd"}),
        json!({"vimNormal":null}),
    ] {
        assert!(execute(
            path,
            "settings.update",
            json!({"vim":false,"keybindings":{"note.follow-link":binding}})
        )
        .is_err());
        assert_eq!(std::fs::read(&file).unwrap(), before);
    }
}
