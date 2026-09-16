use foltra_core::execute;
use serde_json::{json, Value};
use std::collections::HashSet;

#[test]
fn bundled_themes_and_legacy_template_install_and_remove_without_losing_notes() {
    let vault = tempfile::tempdir().unwrap();
    let path = vault.path().to_str().unwrap();
    let call = |command: &str, args| execute(path, command, args).unwrap();
    call("vault.init", json!({"name":"Catalog test"}));
    let examples = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/themes");
    let mut ids = HashSet::new();
    let mut created = vec![];
    let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/plugins/daily-trail.json");
    let files = std::fs::read_dir(examples)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .chain(std::iter::once(fixtures));
    for file in files {
        if file.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let manifest: Value =
            serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
        let id = manifest["id"].as_str().unwrap();
        assert!(ids.insert(id.to_owned()), "Duplicate catalog ID: {id}");
        let before = call("note.list", json!({}));
        call("extension.install", json!({"manifest":manifest}));
        assert_eq!(call("note.list", json!({})), before);
        assert!(execute(path, "extension.install", json!({"manifest":manifest})).is_err());
        if manifest["kind"] == "theme" {
            call("settings.update", json!({"theme":id}));
            assert_eq!(call("workspace.get", json!({}))["settings"]["theme"], id);
        } else {
            let specs = call("commands.list", json!({}));
            for command in manifest["commands"].as_array().unwrap() {
                let command_id = format!("plugin.{id}.{}", command["id"].as_str().unwrap());
                assert!(specs
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|s| s["id"] == command_id));
                if command["action"]["type"] == "template" {
                    let note = call(&command_id, json!({}));
                    assert_eq!(note["body"], command["action"]["body"]);
                    created.push(note);
                } else {
                    assert_eq!(
                        execute(path, &command_id, json!({})).unwrap_err().code,
                        "requires_ui"
                    );
                }
            }
        }
        call("extension.remove", json!({"id":id}));
        assert_eq!(call("extension.list", json!({})), json!([]));
    }
    assert_eq!(ids.len(), 5);
    for note in created {
        let saved = call("note.read", json!({"id":note["id"]}));
        assert_eq!(saved["body"], note["body"]);
        assert_eq!(saved["revision"], note["revision"]);
    }
}
