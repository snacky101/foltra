use foltra_core::execute;
use serde_json::{json, Value};
use tempfile::TempDir;

fn call(v: &TempDir, command: &str, args: Value) -> Value {
    execute(v.path().to_str().unwrap(), command, args).unwrap()
}
fn vault() -> TempDir {
    let v = tempfile::tempdir().unwrap();
    call(&v, "vault.init", json!({"name":"Fonts"}));
    v
}

#[test]
fn font_defaults_preserve_legacy_settings_until_an_explicit_update() {
    let v = vault();
    let defaults = call(&v, "settings.get", json!({}));
    assert_eq!(defaults["editorFontFamily"], "");
    assert_eq!(defaults["databaseFontFamily"], "");
    let file = v.path().join(".foltra/settings.json");
    let legacy = r#"{"vim":true,"editorMode":"source","databaseFontSize":16}"#;
    std::fs::write(&file, legacy).unwrap();
    let settings = call(&v, "workspace.get", json!({}))["settings"].clone();
    assert_eq!(settings["editorFontFamily"], "");
    assert_eq!(settings["databaseFontFamily"], "");
    assert_eq!(settings["vim"], true);
    assert_eq!(settings["databaseFontSize"], 16);
    assert_eq!(std::fs::read_to_string(file).unwrap(), legacy);
}

#[test]
fn font_families_persist_independently_per_vault_without_changing_content() {
    let v = vault();
    let note = call(
        &v,
        "note.create",
        json!({"title":"글꼴","body":"---\ntags: [보존]\n---\n\n- [ ] 한글 **본문**"}),
    );
    let db = call(&v, "database.create", json!({"name":"Data"}));
    call(
        &v,
        "record.create",
        json!({"databaseId":db["id"],"values":{"title":"원본 데이터"}}),
    );
    let before = call(&v, "vault.export", json!({}))["files"].clone();
    call(
        &v,
        "settings.update",
        json!({"editorFontFamily":"나눔고딕"}),
    );
    let saved = call(&v, "settings.update", json!({"databaseFontFamily":"serif"}));
    assert_eq!(saved["editorFontFamily"], "나눔고딕");
    assert_eq!(saved["databaseFontFamily"], "serif");
    call(&v, "settings.update", json!({"editorFontFamily":""}));
    let reopened = call(&v, "workspace.get", json!({}));
    assert_eq!(reopened["settings"]["editorFontFamily"], "");
    assert_eq!(reopened["settings"]["databaseFontFamily"], "serif");
    assert_eq!(call(&v, "note.read", json!({"id":note["id"]})), note);
    let after = call(&v, "vault.export", json!({}))["files"].clone();
    for (path, contents) in before.as_object().unwrap() {
        if path != ".foltra/settings.json" {
            assert_eq!(&after[path], contents);
        }
    }
    let other = vault();
    let defaults = call(&other, "settings.get", json!({}));
    assert_eq!(defaults["editorFontFamily"], "");
    assert_eq!(defaults["databaseFontFamily"], "");
    call(
        &other,
        "settings.update",
        json!({"databaseFontFamily":"Menlo"}),
    );
    assert_eq!(
        call(&v, "settings.get", json!({}))["databaseFontFamily"],
        "serif"
    );
}

#[test]
fn font_names_accept_generic_families_unicode_and_literal_punctuation() {
    let v = vault();
    for key in ["editorFontFamily", "databaseFontFamily"] {
        for name in [
            "",
            "system-ui",
            "sans-serif",
            "serif",
            "monospace",
            "나눔 고딕",
            r#"Family "Serif" \ CJK"#,
            &"가".repeat(100),
        ] {
            let saved = call(&v, "settings.update", json!({key:name}));
            assert_eq!(saved[key], name);
            assert_eq!(call(&v, "settings.get", json!({}))[key], name);
        }
    }
}

#[test]
fn invalid_font_names_reject_the_entire_patch_and_invalid_external_files() {
    let v = vault();
    call(
        &v,
        "settings.update",
        json!({"editorFontFamily":"monospace","databaseFontFamily":"serif"}),
    );
    let file = v.path().join(".foltra/settings.json");
    let before = std::fs::read(&file).unwrap();
    for key in ["editorFontFamily", "databaseFontFamily"] {
        for invalid in [
            json!(null),
            json!(14),
            json!(true),
            json!([]),
            json!({}),
            json!(" "),
            json!(" Font"),
            json!("Font "),
            json!("Font\u{a0}"),
            json!("Font\nName"),
            json!("Font\tName"),
            json!("Font\0Name"),
            json!("Font\u{7f}Name"),
            json!("Font\u{85}Name"),
            json!("가".repeat(101)),
        ] {
            let mut patch = json!({"editorFontFamily":"New Editor","databaseFontFamily":"New Database","vim":true});
            patch[key] = invalid;
            assert!(
                execute(v.path().to_str().unwrap(), "settings.update", patch.clone()).is_err(),
                "{patch}"
            );
            assert_eq!(std::fs::read(&file).unwrap(), before);
        }
        let invalid = json!({key:"Font\nName"}).to_string();
        std::fs::write(&file, &invalid).unwrap();
        assert_eq!(
            execute(v.path().to_str().unwrap(), "settings.get", json!({}))
                .unwrap_err()
                .code,
            "invalid_settings"
        );
        assert_eq!(std::fs::read_to_string(&file).unwrap(), invalid);
        std::fs::write(&file, &before).unwrap();
    }
}
