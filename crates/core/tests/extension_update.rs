use foltra_core::execute;
use serde_json::{json, Value};

struct Fixture {
    dir: tempfile::TempDir,
    manifest: Value,
}
impl Fixture {
    fn new() -> Self {
        let result = Self {
            dir: tempfile::tempdir().unwrap(),
            manifest: json!({
                "kind":"plugin","id":"update-test","name":"Update test","version":"1.0.0",
                "commands":[{"id":"status","title":"Read saved data","headless":true,"action":{"type":"script"}}],
                "runtime":{"apiVersion":1,"permissions":[],"source":"export default {commands:{status(api){return api.storage.read().value}}}"}
            }),
        };
        result.call("vault.init", json!({"name":"Extension update test"}));
        result.call(
            "extension.policy.update",
            json!({"enabled":true,"acceptConsent":true}),
        );
        result.call("extension.install", json!({"manifest":result.manifest}));
        result.call(
            "note.create",
            json!({"title":"Keep","body":"Body [[Link]]"}),
        );
        let database = result.call("database.create", json!({"name":"Keep database"}));
        result.call(
            "record.create",
            json!({"databaseId":database["id"],"values":{"title":"Keep row"}}),
        );
        std::fs::create_dir_all(result.dir.path().join("plugin-data")).unwrap();
        std::fs::write(result.dir.path().join("plugin-data/update-test.json"),
            "{\n  \"settings\": {\"custom\":\"keep\"},\n  \"data\": {\"config\":{\"deck\":\"My deck\",\"auto\":false},\"sent\":{\"row-1\":{\"id\":123,\"digest\":\"last-sent\",\"revision\":\"old\"}},\"unknown\":[1,2]}\n}\n"
        ).unwrap();
        result
    }
    fn call(&self, command: &str, args: Value) -> Value {
        execute(self.dir.path().to_str().unwrap(), command, args).unwrap()
    }
    fn status(&self) -> Value {
        self.call("extension.status", json!({}))[0].clone()
    }
    fn files(&self) -> Value {
        self.call("vault.export", json!({}))["files"].clone()
    }
    fn next(&self) -> Value {
        let mut next = self.manifest.clone();
        next["version"] = json!("1.2.0");
        next["runtime"]["source"] = json!("export default {commands:{status(api){return {version:2,data:api.storage.read().value}}}}");
        next
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        // The grant belongs only to this disposable vault, including assertion-failure cleanup.
        let _ = execute(
            self.dir.path().to_str().unwrap(),
            "extension.disable",
            json!({"id":"update-test"}),
        );
    }
}

#[test]
fn update_preserves_all_data_and_device_activation() {
    let f = Fixture::new();
    let old = f.status();
    f.call(
        "extension.enable",
        json!({"id":"update-test","digest":old["digest"]}),
    );
    let data = f.call("plugin.update-test.status", json!({}))["result"].clone();
    let before = f.files();
    let next = f.next();
    assert_eq!(
        f.call(
            "extension.update",
            json!({"manifest":next,"expectedDigest":old["digest"]})
        ),
        next
    );
    let after = f.files();
    assert_eq!(
        before.as_object().unwrap().len(),
        after.as_object().unwrap().len()
    );
    for (path, raw) in before.as_object().unwrap() {
        if path == "extensions/update-test.json" {
            assert_eq!(
                serde_json::from_str::<Value>(after[path].as_str().unwrap()).unwrap(),
                next
            );
        } else {
            assert_eq!(&after[path], raw, "Changed unrelated data: {path}");
        }
    }
    let status = f.status();
    assert_ne!(status["digest"], old["digest"]);
    assert_eq!(status["enabled"], true);
    assert_eq!(
        execute(
            f.dir.path().to_str().unwrap(),
            "extension.enable",
            json!({"id":"update-test","digest":old["digest"]})
        )
        .unwrap_err()
        .code,
        "plugin_changed"
    );
    assert_eq!(
        f.call("plugin.update-test.status", json!({}))["result"],
        json!({"version":2,"data":data})
    );
}

#[test]
fn update_retains_disabled_state_and_activation_while_plugin_use_is_off() {
    let f = Fixture::new();
    f.call(
        "extension.update",
        json!({"manifest":f.next(),"expectedDigest":f.status()["digest"]}),
    );
    assert_eq!(f.status()["enabled"], false);
    f.call(
        "extension.enable",
        json!({"id":"update-test","digest":f.status()["digest"]}),
    );
    f.call("extension.policy.update", json!({"enabled":false}));
    f.call(
        "extension.update",
        json!({"manifest":f.manifest,"expectedDigest":f.status()["digest"]}),
    );
    assert_eq!(f.status()["enabled"], false);
    f.call("extension.policy.update", json!({"enabled":true}));
    assert_eq!(f.status()["enabled"], true);
}

#[test]
fn stale_update_digest_is_rejected_without_writes() {
    let f = Fixture::new();
    let old = f.status();
    let mut changed = f.manifest.clone();
    changed["description"] = json!("External edit after update screen opened");
    std::fs::write(
        f.dir.path().join("extensions/update-test.json"),
        changed.to_string(),
    )
    .unwrap();
    let before = f.files();
    let error = execute(
        f.dir.path().to_str().unwrap(),
        "extension.update",
        json!({"manifest":f.next(),"expectedDigest":old["digest"]}),
    )
    .unwrap_err();
    assert_eq!(error.code, "conflict");
    assert_eq!(f.files(), before);
}

#[test]
fn malformed_or_different_package_and_missing_digest_do_not_replace_installation() {
    let f = Fixture::new();
    let digest = f.status()["digest"].clone();
    let before = f.files();
    let mut unsupported = f.next();
    unsupported["runtime"]["permissions"] = json!(["filesystem"]);
    let mut other = f.next();
    other["id"] = json!("other");
    let theme = json!({"kind":"theme","id":"update-test","name":"Wrong kind","version":"1.2.0","tokens":{"paper":"#ffffff"}});
    for manifest in [unsupported, other, theme] {
        assert!(execute(
            f.dir.path().to_str().unwrap(),
            "extension.update",
            json!({"manifest":manifest,"expectedDigest":digest})
        )
        .is_err());
        assert_eq!(f.files(), before);
    }
    assert!(execute(
        f.dir.path().to_str().unwrap(),
        "extension.update",
        json!({"manifest":f.next()})
    )
    .is_err());
    assert_eq!(f.files(), before);
}

#[test]
fn update_compares_the_status_digest_independent_of_json_whitespace() {
    let f = Fixture::new();
    let digest = f.status()["digest"].clone();
    std::fs::write(
        f.dir.path().join("extensions/update-test.json"),
        f.manifest.to_string(),
    )
    .unwrap();
    assert_eq!(f.status()["digest"], digest);
    assert_eq!(
        f.call(
            "extension.update",
            json!({"manifest":f.next(),"expectedDigest":digest})
        )["version"],
        "1.2.0"
    );
}
