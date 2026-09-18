use foltra_core::execute;
use serde_json::{json, Value};

fn manifest() -> Value {
    json!({
        "kind":"plugin","id":"binding-test","name":"Command bindings","version":"1.0.0",
        "commands":[{"id":"today","title":"Open today","action":{"type":"script"}}],
        "runtime":{"apiVersion":1,"permissions":[],"source":"export default {commands:{today(){return 'ok'}}}"}
    })
}

fn defaults() -> Value {
    json!([{"keys":"Mod+Shift+d","leader":false},{"keys":"nd","leader":true}])
}

fn setup() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    execute(
        dir.path().to_str().unwrap(),
        "vault.init",
        json!({"name":"Binding contract"}),
    )
    .unwrap();
    dir
}

fn call(dir: &tempfile::TempDir, command: &str, args: Value) -> Value {
    execute(dir.path().to_str().unwrap(), command, args).unwrap()
}

fn plugin_spec(dir: &tempfile::TempDir) -> Value {
    call(dir, "commands.list", json!({}))
        .as_array()
        .unwrap()
        .iter()
        .find(|command| command["id"] == "plugin.binding-test.today")
        .unwrap()
        .clone()
}

#[test]
fn declared_defaults_are_discoverable_without_enabling_or_changing_settings() {
    let dir = setup();
    let before = call(&dir, "vault.export", json!({}))["files"].clone();
    let mut package = manifest();
    package["commands"][0]["bindings"] = defaults();
    call(&dir, "extension.install", json!({"manifest":package}));
    assert_eq!(plugin_spec(&dir)["bindings"], defaults());
    assert_eq!(
        call(&dir, "extension.status", json!({}))[0]["enabled"],
        false
    );
    assert_eq!(call(&dir, "note.list", json!({})), json!([]));
    let after = call(&dir, "vault.export", json!({}))["files"].clone();
    for (path, raw) in before.as_object().unwrap() {
        assert_eq!(&after[path], raw, "Changed unrelated file {path}");
    }
    assert_eq!(
        after.as_object().unwrap().len(),
        before.as_object().unwrap().len() + 1
    );
}

#[test]
fn absent_bindings_preserve_legacy_command_output_and_empty_defaults_stay_explicit() {
    let dir = setup();
    let package = manifest();
    call(&dir, "extension.install", json!({"manifest":package}));
    assert_eq!(
        plugin_spec(&dir),
        json!({
            "id":"plugin.binding-test.today","title":"Open today","headless":false,"readOnly":false,
            "argsSchema":{"type":"object","properties":{},"required":[],"additionalProperties":true}
        })
    );
    let digest = call(&dir, "extension.status", json!({}))[0]["digest"].clone();
    let mut next = package;
    next["version"] = json!("1.0.1");
    next["commands"][0]["bindings"] = json!([]);
    call(
        &dir,
        "extension.update",
        json!({"manifest":next,"expectedDigest":digest}),
    );
    assert_eq!(plugin_spec(&dir)["bindings"], json!([]));
}

#[test]
fn malformed_or_excessive_defaults_cannot_install_or_replace_a_package() {
    let dir = setup();
    let mut package = manifest();
    package["commands"][0]["bindings"] = defaults();
    call(&dir, "extension.install", json!({"manifest":package}));
    let digest = call(&dir, "extension.status", json!({}))[0]["digest"].clone();
    let before = call(&dir, "vault.export", json!({}))["files"].clone();
    for binding in [
        Value::Null,
        json!({"shortcut":"Mod+d"}),
        json!("Mod+d"),
        json!([{"keys":"Mod+d"}]),
        json!([{"keys":"Mod+d","leader":"false"}]),
        json!([{"keys":"Mod+d","leader":false,"extra":true}]),
        json!([{"keys":"Mod+Ctrl+d","leader":false}]),
        json!([{"keys":"Ctrl+Ctrl+d","leader":false}]),
        json!([{"keys":"Ctrl+안녕","leader":false}]),
        json!([{"keys":"","leader":true}]),
        json!([{"keys":"a".repeat(81),"leader":true}]),
        json!(vec![json!({"keys":"nd","leader":true}); 11]),
    ] {
        let mut invalid = package.clone();
        invalid["commands"][0]["bindings"] = binding;
        assert!(execute(
            dir.path().to_str().unwrap(),
            "extension.update",
            json!({"manifest":invalid,"expectedDigest":digest})
        )
        .is_err());
        invalid["id"] = json!("invalid-bindings");
        assert!(execute(
            dir.path().to_str().unwrap(),
            "extension.install",
            json!({"manifest":invalid})
        )
        .is_err());
        assert_eq!(call(&dir, "vault.export", json!({}))["files"], before);
        assert_eq!(plugin_spec(&dir)["bindings"], defaults());
    }
    let mut bounded = package;
    bounded["commands"][0]["bindings"] = json!(vec![json!({"keys":"nd","leader":true}); 10]);
    call(
        &dir,
        "extension.update",
        json!({"manifest":bounded,"expectedDigest":digest}),
    );
    assert_eq!(plugin_spec(&dir)["bindings"].as_array().unwrap().len(), 10);
}

#[test]
fn package_lifecycle_preserves_user_overrides_disabled_bindings_and_existing_revisions() {
    let dir = setup();
    let custom = json!({
        "plugin.binding-test.today":[{"keys":"Mod+k","leader":false}],
        "plugin.binding-test.disabled":[],
        "note.create":[{"keys":"N","leader":true}]
    });
    call(
        &dir,
        "settings.update",
        json!({"keybindings":custom,"vim":true,"leader":","}),
    );
    let settings_file = dir.path().join(".foltra/settings.json");
    let settings_bytes = std::fs::read(&settings_file).unwrap();
    let note = call(
        &dir,
        "note.create",
        json!({"title":"Keep","body":"Original draft"}),
    );
    let mut package = manifest();
    package["commands"][0]["bindings"] = defaults();
    call(&dir, "extension.install", json!({"manifest":package}));
    let digest = call(&dir, "extension.status", json!({}))[0]["digest"].clone();
    package["version"] = json!("1.0.1");
    package["commands"][0]["bindings"] = json!([{"keys":"Ctrl+j","leader":false}]);
    call(
        &dir,
        "extension.update",
        json!({"manifest":package,"expectedDigest":digest}),
    );
    assert_eq!(
        plugin_spec(&dir)["bindings"],
        package["commands"][0]["bindings"]
    );
    call(&dir, "extension.remove", json!({"id":"binding-test"}));
    // Byte-for-byte preservation also preserves the storage revision hash.
    assert_eq!(std::fs::read(&settings_file).unwrap(), settings_bytes);
    assert_eq!(call(&dir, "settings.get", json!({}))["keybindings"], custom);
    assert_eq!(call(&dir, "note.read", json!({"id":note["id"]})), note);
}
