use foltra_core::execute;
use serde_json::json;

#[test]
fn removing_active_theme_restores_paper_and_preserves_other_settings_and_notes() {
    let vault = tempfile::tempdir().unwrap();
    let path = vault.path().to_str().unwrap();
    let call = |command: &str, args| execute(path, command, args).unwrap();
    call("vault.init", json!({"name":"Theme removal"}));
    let note = call("note.create", json!({"title":"Keep", "body":"My content"}));
    let manifest = json!({"kind":"theme","id":"custom","name":"Custom","version":"1.0.0","tokens":{"paper":"#202020"}});
    call("extension.install", json!({"manifest":manifest}));
    call("settings.update", json!({"theme":"custom","vim":true}));
    let mut settings = call("workspace.get", json!({}))["settings"].clone();
    settings["theme"] = json!("paper");
    call("extension.remove", json!({"id":"custom"}));
    assert_eq!(call("workspace.get", json!({}))["settings"], settings);
    assert_eq!(call("extension.list", json!({})), json!([]));
    assert_eq!(call("note.read", json!({"id":note["id"]})), note);
    assert_eq!(
        execute(path, "extension.remove", json!({"id":"custom"}))
            .unwrap_err()
            .code,
        "not_found"
    );
    assert_eq!(call("workspace.get", json!({}))["settings"], settings);
}

#[test]
fn removing_an_inactive_theme_or_a_plugin_does_not_change_selected_theme() {
    let vault = tempfile::tempdir().unwrap();
    let path = vault.path().to_str().unwrap();
    let call = |command: &str, args| execute(path, command, args).unwrap();
    call("vault.init", json!({"name":"Theme selection"}));
    call("settings.update", json!({"theme":"night"}));
    call(
        "extension.install",
        json!({"manifest":{"kind":"theme","id":"custom","name":"Custom","version":"1.0.0","tokens":{}}}),
    );
    call("extension.remove", json!({"id":"custom"}));
    assert_eq!(
        call("workspace.get", json!({}))["settings"]["theme"],
        "night"
    );
    call(
        "extension.install",
        json!({"manifest":{"kind":"plugin","id":"night","name":"Plugin","version":"1.0.0","commands":[]}}),
    );
    call("extension.remove", json!({"id":"night"}));
    assert_eq!(
        call("workspace.get", json!({}))["settings"]["theme"],
        "night"
    );
}
