use chrono::{Duration, Local};
use foltra_core::execute;
use serde_json::{json, Value};

struct Fixture {
    vault: tempfile::TempDir,
    manifest: Value,
}

impl Fixture {
    fn new() -> Self {
        Self::with_manifest(
            serde_json::from_str(include_str!(
                "../../../examples/plugins/daily-calendar.json"
            ))
            .unwrap(),
        )
    }

    fn with_manifest(manifest: Value) -> Self {
        let fixture = Self {
            vault: tempfile::tempdir().unwrap(),
            manifest,
        };
        fixture.call("vault.init", json!({"name":"Calendar daily notes test"}));
        fixture.call("extension.install", json!({"manifest":fixture.manifest}));
        fixture
    }

    fn call(&self, command: &str, args: Value) -> Value {
        execute(self.vault.path().to_str().unwrap(), command, args).unwrap()
    }

    fn status(&self) -> Value {
        self.call("extension.status", json!({}))[0].clone()
    }

    fn enable(&self) {
        self.call(
            "extension.enable",
            json!({"id":"daily-calendar","digest":self.status()["digest"]}),
        );
    }

    fn request(&self) -> Value {
        json!({"id":"daily-calendar","digest":self.status()["digest"],
            "event":{"type":"command","id":"open-today"}})
    }

    fn invoke(&self) -> Value {
        self.call("extension.invoke", self.request())
    }

    fn event(&self, event: Value, state: Value) -> Value {
        self.call(
            "extension.invoke",
            json!({"id":"daily-calendar",
            "digest":self.status()["digest"],"event":event,"state":state}),
        )
    }

    fn select_date(&self, date: &str) -> Value {
        self.event(
            json!({"type":"action","id":"calendar","action":{"id":"select-date","value":date}}),
            json!({"month":&date[..7]}),
        )
    }

    fn settings(&self) -> Value {
        self.call("extension.settings.get", json!({"id":"daily-calendar"}))
    }

    fn create_missing(&self, enabled: bool) {
        self.call("extension.settings.update", json!({"id":"daily-calendar",
            "values":{"create-missing-notes":enabled},"expectedRevision":self.settings()["revision"]}));
    }

    fn files(&self) -> Value {
        self.call("vault.export", json!({}))["files"].clone()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // Only this disposable vault's device approval is removed, even on assertion failure.
        let _ = execute(
            self.vault.path().to_str().unwrap(),
            "extension.disable",
            json!({"id":"daily-calendar"}),
        );
    }
}

fn assert_opened(response: &Value, note: &Value) {
    assert_eq!(response["state"]["selectedDate"], note["title"]);
    assert_eq!(
        response["effects"],
        json!([{"type":"openNote","args":{"id":note["id"]}}])
    );
}

#[test]
fn installation_is_inactive_and_exposes_default_bindings_without_creating_notes() {
    let f = Fixture::new();
    assert_eq!(f.manifest["id"], "daily-calendar");
    assert_eq!(f.manifest["version"], "1.1.0");
    assert_eq!(
        f.manifest["runtime"]["permissions"],
        json!(["notes.read", "notes.write", "ui"])
    );
    assert_eq!(f.status()["enabled"], false);
    assert_eq!(
        f.settings()["values"],
        json!({"create-missing-notes":false})
    );
    assert_eq!(f.call("note.list", json!({})), json!([]));
    let commands = f.call("commands.list", json!({}));
    let command = commands
        .as_array()
        .unwrap()
        .iter()
        .find(|command| command["id"] == "plugin.daily-calendar.open-today")
        .unwrap();
    assert_eq!(
        command["bindings"],
        json!([{"keys":"Mod+Shift+d","leader":false},{"keys":"nd","leader":true}])
    );
    let before = f.files();
    assert_eq!(
        execute(
            f.vault.path().to_str().unwrap(),
            "extension.invoke",
            f.request()
        )
        .unwrap_err()
        .code,
        "plugin_disabled"
    );
    assert_eq!(f.files(), before);
}

#[test]
fn approved_command_creates_one_blank_local_date_note_and_keeps_other_data_unchanged() {
    let f = Fixture::new();
    let existing = f.call(
        "note.create",
        json!({"title":"Keep me","body":"---\ncount: 42\n---\nExact text  \n\n- [b] Keep"}),
    );
    let database = f.call("database.create", json!({"name":"Keep database"}));
    f.call(
        "record.create",
        json!({"databaseId":database["id"],"values":{"title":"Keep row"}}),
    );
    f.enable();
    let before = f.files();
    let day_before = Local::now().date_naive();
    let response = f.invoke();
    let day_after = Local::now().date_naive();
    let note = f.call(
        "note.read",
        json!({"id":response["effects"][0]["args"]["id"]}),
    );
    let expected_titles = [day_before, day_after].map(|day| day.format("%Y-%m-%d").to_string());
    assert!(expected_titles
        .iter()
        .any(|title| note["title"].as_str() == Some(title.as_str())));
    assert_eq!(note["body"], "");
    assert!(note.get("folderId").is_none());
    assert_opened(&response, &note);
    assert_eq!(f.call("note.list", json!({})).as_array().unwrap().len(), 2);
    assert_eq!(f.call("note.read", json!({"id":existing["id"]})), existing);
    let after = f.files();
    assert_eq!(
        after.as_object().unwrap().len(),
        before.as_object().unwrap().len() + 1
    );
    for (path, content) in before.as_object().unwrap() {
        assert_eq!(&after[path], content, "Unexpected mutation of {path}");
    }
}

#[test]
fn empty_date_notifies_by_default_and_render_or_load_never_creates_notes() {
    let f = Fixture::new();
    f.enable();
    let before = f.files();
    let selected = f.select_date("2000-02-29");
    assert_eq!(selected["changed"], false);
    assert_eq!(selected["state"]["selectedDate"], "2000-02-29");
    assert_eq!(
        selected["effects"],
        json!([{"type":"notify",
        "args":{"message":"2000-02-29 · 노트가 없습니다."}}])
    );
    let view = f.event(
        json!({"type":"render","id":"calendar"}),
        selected["state"].clone(),
    );
    assert_eq!(view["view"]["children"].as_array().unwrap().len(), 1);
    assert_eq!(view["effects"], json!([]));
    assert_eq!(f.files(), before);

    f.create_missing(true);
    let before = f.files();
    let load = f.event(json!({"type":"load"}), selected["state"].clone());
    let view = f.event(
        json!({"type":"render","id":"calendar"}),
        selected["state"].clone(),
    );
    for result in [load, view] {
        assert_eq!(result["effects"], json!([]));
        assert_eq!(result["changed"], false);
    }
    for date in ["2000-02-30", "2000-03-01", "not-a-date"] {
        let rejected = f.event(
            json!({"type":"action","id":"calendar",
            "action":{"id":"select-date","value":date}}),
            json!({"month":"2000-02"}),
        );
        assert_eq!(rejected["effects"], json!([]));
        assert_eq!(rejected["changed"], false);
    }
    assert_eq!(f.files(), before);
}

#[test]
fn enabled_date_click_creates_once_then_opens_existing_content_without_revisions() {
    let f = Fixture::new();
    f.enable();
    f.create_missing(true);
    let before = f.files();
    let response = f.select_date("2000-02-29");
    let note = f.call(
        "note.read",
        json!({"id":response["effects"][0]["args"]["id"]}),
    );
    assert_eq!(note["title"], "2000-02-29");
    assert_eq!(note["body"], "");
    assert_eq!(response["changed"], true);
    assert_opened(&response, &note);
    let after = f.files();
    assert_eq!(
        after.as_object().unwrap().len(),
        before.as_object().unwrap().len() + 1
    );
    for (path, content) in before.as_object().unwrap() {
        assert_eq!(&after[path], content, "Unexpected mutation of {path}");
    }
    let folder = f.call("folder.create", json!({"name":"Archive"}));
    let note = f.call("note.update", json!({"id":note["id"],"title":note["title"],
        "body":"Existing content  \n\n- [b] Keep","folderId":folder["id"],"expectedRevision":note["revision"]}));
    for enabled in [true, false] {
        f.create_missing(enabled);
        let before = f.files();
        for _ in 0..2 {
            let reused = f.select_date("2000-02-29");
            assert_opened(&reused, &note);
            assert_eq!(reused["changed"], false);
            assert_eq!(f.call("note.read", json!({"id":note["id"]})), note);
            assert_eq!(f.files(), before);
        }
    }
    assert_eq!(f.call("note.list", json!({})).as_array().unwrap().len(), 1);
}

#[test]
fn existing_today_command_and_calendar_button_only_reset_the_visible_month() {
    let f = Fixture::new();
    f.enable();
    f.create_missing(true);
    let before = f.files();
    for event in [
        json!({"type":"command","id":"today"}),
        json!({"type":"action","id":"calendar","action":{"id":"today"}}),
    ] {
        let before_day = Local::now().date_naive();
        let response = f.event(
            event.clone(),
            json!({"month":"2000-02","selectedDate":"2000-02-29","notePage":3}),
        );
        let after_day = Local::now().date_naive();
        assert!([before_day, after_day]
            .iter()
            .any(|day| response["state"]["month"].as_str()
                == Some(day.format("%Y-%m").to_string().as_str())));
        assert!(response["state"]["selectedDate"].is_null());
        assert!(response["state"]["notePage"].is_null());
        assert_eq!(response["changed"], false);
        assert_eq!(
            response["effects"],
            if event["type"] == "command" {
                json!([{"type":"openView","args":{"id":"calendar"}}])
            } else {
                json!([])
            }
        );
    }
    assert_eq!(f.files(), before);
    assert_eq!(f.call("note.list", json!({})), json!([]));
}

#[test]
fn repeated_open_uses_existing_note_in_any_folder_without_changing_body_revision_or_files() {
    let f = Fixture::new();
    let folder = f.call("folder.create", json!({"name":"Daily archive"}));
    let today = Local::now().date_naive();
    // Include tomorrow as well so the reuse assertion stays valid across midnight.
    for day in [today, today + Duration::days(1)] {
        f.call("note.create", json!({"title":day.format("%Y-%m-%d").to_string(),
            "folderId":folder["id"],"body":"---\ncustom: true\n---\nExisting daily content  \n\n- [x] Keep"}));
    }
    f.enable();
    let before = f.files();
    for _ in 0..3 {
        let response = f.invoke();
        let note = f.call(
            "note.read",
            json!({"id":response["effects"][0]["args"]["id"]}),
        );
        assert_opened(&response, &note);
        assert_eq!(note["folderId"], folder["id"]);
        assert_eq!(
            note["body"],
            "---\ncustom: true\n---\nExisting daily content  \n\n- [x] Keep"
        );
        assert_eq!(f.files(), before);
    }
    assert_eq!(f.call("note.list", json!({})).as_array().unwrap().len(), 2);
}

#[test]
fn duplicate_date_titles_offer_the_existing_picker_without_writes() {
    let f = Fixture::new();
    let today = Local::now().date_naive();
    for day in [today, today + Duration::days(1)] {
        for body in ["First duplicate", "Second duplicate"] {
            f.call(
                "note.create",
                json!({"title":day.format("%Y-%m-%d").to_string(),"body":body}),
            );
        }
    }
    f.enable();
    let before = f.files();
    let response = f.invoke();
    assert_eq!(response["changed"], false);
    assert_eq!(
        response["effects"],
        json!([{"type":"openView","args":{"id":"calendar"}}])
    );
    let date = response["state"]["selectedDate"].as_str().unwrap();
    let selected = f.select_date(date);
    assert_eq!(selected["effects"], json!([]));
    let view = f.event(
        json!({"type":"render","id":"calendar"}),
        selected["state"].clone(),
    );
    let choices: Vec<&Value> = view["view"]["children"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|child| child["action"] == "open-note")
        .collect();
    assert_eq!(choices.len(), 2);
    for choice in choices {
        let note = f.call("note.read", json!({"id":choice["payload"]}));
        assert_eq!(note["title"], date);
        let opened = f.event(
            json!({"type":"action","id":"calendar",
            "action":{"id":"open-note","payload":note["id"]}}),
            selected["state"].clone(),
        );
        assert_opened(&opened, &note);
    }
    assert_eq!(f.files(), before);
}

#[test]
fn disabled_or_changed_package_cannot_run_with_an_old_approval() {
    let f = Fixture::new();
    f.enable();
    let request = f.request();
    f.call("extension.disable", json!({"id":"daily-calendar"}));
    let before = f.files();
    assert_eq!(
        execute(
            f.vault.path().to_str().unwrap(),
            "extension.invoke",
            request.clone()
        )
        .unwrap_err()
        .code,
        "plugin_disabled"
    );
    assert_eq!(f.files(), before);
    f.enable();
    let mut next = f.manifest.clone();
    next["version"] = json!("1.1.1");
    f.call(
        "extension.update",
        json!({"manifest":next,"expectedDigest":request["digest"]}),
    );
    assert_eq!(f.status()["enabled"], false);
    let before = f.files();
    assert_eq!(
        execute(
            f.vault.path().to_str().unwrap(),
            "extension.invoke",
            request
        )
        .unwrap_err()
        .code,
        "plugin_changed"
    );
    assert_eq!(
        execute(
            f.vault.path().to_str().unwrap(),
            "extension.invoke",
            f.request()
        )
        .unwrap_err()
        .code,
        "plugin_disabled"
    );
    assert_eq!(f.files(), before);
}

#[test]
fn upgrade_from_old_calendar_permissions_preserves_settings_data_and_requires_approval() {
    let current: Value = serde_json::from_str(include_str!(
        "../../../examples/plugins/daily-calendar.json"
    ))
    .unwrap();
    // Reconstruct 1.0.0's declarations; the shipped source also supports these old entry points.
    let mut legacy = current.clone();
    legacy["version"] = json!("1.0.0");
    legacy["runtime"]["permissions"] = json!(["notes.read", "ui"]);
    legacy["runtime"]
        .as_object_mut()
        .unwrap()
        .remove("settings");
    legacy["commands"]
        .as_array_mut()
        .unwrap()
        .retain(|command| command["id"] != "open-today");
    let f = Fixture::with_manifest(legacy);
    let note = f.call(
        "note.create",
        json!({"title":"Keep","body":"Exact content  \n\n- [x] Preserve"}),
    );
    f.call(
        "settings.update",
        json!({"vim":true,"leader":",","keybindings":{
        "plugin.daily-calendar.today":[{"keys":"Mod+k","leader":false}],
        "plugin.daily-calendar.open-today":[]}}),
    );
    std::fs::create_dir_all(f.vault.path().join("plugin-data")).unwrap();
    std::fs::write(
        f.vault.path().join("plugin-data/daily-calendar.json"),
        "{\n  \"settings\": {\"legacy-option\":true},\n  \"data\": {\"saved\":[1,2,3]}\n}\n",
    )
    .unwrap();
    f.enable();
    let old = f.status();
    let before = f.files();
    f.call(
        "extension.update",
        json!({"manifest":current,"expectedDigest":old["digest"]}),
    );
    assert_eq!(f.status()["enabled"], false);
    assert_eq!(
        f.settings()["values"],
        json!({"create-missing-notes":false})
    );
    let after = f.files();
    assert_eq!(
        after.as_object().unwrap().len(),
        before.as_object().unwrap().len()
    );
    for (path, content) in before.as_object().unwrap() {
        if path != "extensions/daily-calendar.json" {
            assert_eq!(&after[path], content, "Unexpected migration of {path}");
        }
    }
    assert_eq!(f.call("note.read", json!({"id":note["id"]})), note);
    assert_eq!(
        execute(
            f.vault.path().to_str().unwrap(),
            "extension.enable",
            json!({"id":"daily-calendar","digest":old["digest"]})
        )
        .unwrap_err()
        .code,
        "plugin_changed"
    );
    assert_eq!(
        execute(
            f.vault.path().to_str().unwrap(),
            "extension.invoke",
            f.request()
        )
        .unwrap_err()
        .code,
        "plugin_disabled"
    );
    f.enable();
    f.create_missing(true);
    let settings = f.settings();
    let before = f.files();
    let mut next = current;
    next["version"] = json!("1.1.1");
    f.call(
        "extension.update",
        json!({"manifest":next,"expectedDigest":f.status()["digest"]}),
    );
    assert_eq!(f.settings(), settings);
    assert_eq!(f.status()["enabled"], false);
    let after = f.files();
    for (path, content) in before.as_object().unwrap() {
        if path != "extensions/daily-calendar.json" {
            assert_eq!(&after[path], content, "Unexpected update of {path}");
        }
    }
}

#[test]
fn write_and_navigation_require_the_packages_requested_permissions() {
    for missing in ["notes.read", "notes.write", "ui"] {
        let mut manifest: Value = serde_json::from_str(include_str!(
            "../../../examples/plugins/daily-calendar.json"
        ))
        .unwrap();
        manifest["runtime"]["permissions"]
            .as_array_mut()
            .unwrap()
            .retain(|permission| permission != missing);
        if missing == "ui" {
            manifest["runtime"]["views"] = json!([]);
        }
        let f = Fixture::with_manifest(manifest);
        // No write is needed in the UI-permission scenario: only navigation must fail.
        if missing == "ui" {
            let today = Local::now().date_naive();
            for day in [today, today + Duration::days(1)] {
                f.call(
                    "note.create",
                    json!({"title":day.format("%Y-%m-%d").to_string(),"body":"Existing"}),
                );
            }
        }
        f.enable();
        let before = f.files();
        let error = execute(
            f.vault.path().to_str().unwrap(),
            "extension.invoke",
            f.request(),
        )
        .unwrap_err();
        assert_eq!(error.code, "plugin_error");
        assert!(error
            .message
            .contains(&format!("Plugin requires {missing}")));
        assert_eq!(f.files(), before);
    }
}
