use foltra_core::execute;
use serde_json::{json, Value};
use std::{fs, path::Path};

fn init(path: &Path) -> Value {
    let path = path.to_str().unwrap();
    execute(path, "vault.init", json!({"name":"Launch fixture"})).unwrap();
    execute(
        path,
        "note.create",
        json!({"title":"한글 노트","body":"Keep this body"}),
    )
    .unwrap()
}

fn resolve(path: &Path) -> foltra_core::Result<Value> {
    execute("", "path.resolve", json!({"path":path}))
}

#[test]
fn resolves_relative_vault_and_note_paths_without_changing_note_bytes() {
    let dir = tempfile::Builder::new()
        .prefix(".foltra-open-path-")
        .tempdir_in(".")
        .unwrap();
    let vault = dir.path().join("한글 space;$(literal)");
    let note = init(&vault);
    let note_path = vault.join(format!("notes/{}.md", note["id"].as_str().unwrap()));
    let before = fs::read(&note_path).unwrap();
    let root = fs::canonicalize(&vault).unwrap();
    assert_eq!(
        resolve(&vault).unwrap(),
        json!({"path":root,"vaultPath":root})
    );
    assert_eq!(
        resolve(&note_path).unwrap(),
        json!({"path":fs::canonicalize(&note_path).unwrap(),"vaultPath":root,"noteId":note["id"]})
    );
    assert_eq!(fs::read(note_path).unwrap(), before);
}

#[test]
fn refuses_missing_plain_or_nonvault_paths_without_initializing_or_importing() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(resolve(dir.path()).unwrap_err().code, "not_a_vault");
    assert!(!dir.path().join(".foltra").exists());
    let plain = dir.path().join("draft.md");
    fs::write(&plain, "# Ordinary Markdown\n").unwrap();
    assert_eq!(resolve(&plain).unwrap_err().code, "unsupported_open_path");
    assert_eq!(fs::read_to_string(plain).unwrap(), "# Ordinary Markdown\n");
    let missing = dir.path().join("new-vault");
    assert_eq!(resolve(&missing).unwrap_err().code, "not_found");
    assert!(!missing.exists());
    assert_eq!(
        execute("", "path.resolve", json!({"path":" "}))
            .unwrap_err()
            .code,
        "invalid_path"
    );
}

#[test]
fn validates_note_filename_metadata_and_vault_version() {
    let dir = tempfile::tempdir().unwrap();
    let note = init(dir.path());
    let id = note["id"].as_str().unwrap();
    let note_path = dir.path().join(format!("notes/{id}.md"));
    let raw = fs::read_to_string(&note_path).unwrap();
    fs::write(dir.path().join("notes/title.md"), &raw).unwrap();
    assert_eq!(
        resolve(&dir.path().join("notes/title.md"))
            .unwrap_err()
            .code,
        "invalid_id"
    );
    fs::write(
        &note_path,
        raw.replace(id, "00000000-0000-0000-0000-000000000000"),
    )
    .unwrap();
    assert_eq!(resolve(&note_path).unwrap_err().code, "invalid_note");
    let info_path = dir.path().join(".foltra/vault.json");
    let mut info: Value = serde_json::from_slice(&fs::read(&info_path).unwrap()).unwrap();
    info["formatVersion"] = json!(99);
    fs::write(info_path, serde_json::to_vec(&info).unwrap()).unwrap();
    assert_eq!(resolve(dir.path()).unwrap_err().code, "unsupported_format");
}

#[cfg(unix)]
#[test]
fn root_aliases_work_but_managed_note_and_notes_directory_symlinks_are_rejected() {
    use std::os::unix::fs::symlink;
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("vault");
    let note = init(&root);
    let relative = format!("notes/{}.md", note["id"].as_str().unwrap());
    let alias = dir.path().join("alias");
    symlink(&root, &alias).unwrap();
    assert_eq!(
        resolve(&alias).unwrap()["vaultPath"],
        json!(fs::canonicalize(&root).unwrap())
    );
    assert_eq!(
        resolve(&alias.join(&relative)).unwrap()["noteId"],
        note["id"]
    );
    let actual_note = root.join(&relative);
    let moved_note = dir.path().join("outside.md");
    fs::rename(&actual_note, &moved_note).unwrap();
    symlink(&moved_note, &actual_note).unwrap();
    assert_eq!(resolve(&actual_note).unwrap_err().code, "unsafe_path");
    fs::remove_file(&actual_note).unwrap();
    fs::rename(&moved_note, &actual_note).unwrap();
    let moved_notes = dir.path().join("outside-notes");
    fs::rename(root.join("notes"), &moved_notes).unwrap();
    symlink(moved_notes, root.join("notes")).unwrap();
    assert_eq!(resolve(&actual_note).unwrap_err().code, "unsafe_path");
}

#[test]
fn path_resolution_is_discoverable_without_selecting_a_vault() {
    let specs = execute("", "commands.list", json!({})).unwrap();
    assert!(specs
        .as_array()
        .unwrap()
        .iter()
        .any(|spec| spec["id"] == "path.resolve"
            && spec["readOnly"] == true
            && spec["headless"] == true));
    assert_eq!(
        execute("", "path.resolve", json!({})).unwrap_err().code,
        "invalid_arguments"
    );
    assert_eq!(
        execute("", "path.resolve", json!({"path":42}))
            .unwrap_err()
            .code,
        "invalid_arguments"
    );
}
