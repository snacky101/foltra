use serde_json::{json, Value};
use std::process::Command;

fn cli(vault: &str, args: &[&str]) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_foltra"))
        .args(["--vault", vault])
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}
#[test]
fn independent_processes_share_the_same_vault_and_command_contract() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    cli(path, &["vault", "init", "--name", "CLI only"]);
    let database = cli(path, &["db", "create", "--name", "Tasks"]);
    cli(
        path,
        &[
            "db",
            "record",
            "create",
            "--database",
            database["id"].as_str().unwrap(),
            "--values",
            r#"{"title":"Agent task"}"#,
        ],
    );
    let state = foltra_core::execute(path, "workspace.get", json!({})).unwrap();
    assert_eq!(state["notes"], json!([]));
    assert_eq!(state["records"][0]["values"]["title"], "Agent task");
    assert!(cli(path, &["commands", "list"])
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c["id"] == "record.update"));
}

#[test]
fn agents_can_discover_rename_delete_and_restore_databases_through_shared_commands() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    cli(path, &["vault", "init", "--name", "Database CLI"]);
    let specs = cli(path, &["commands", "list"]);
    for (command, read_only) in [
        ("database.inspect", true),
        ("database.rename", false),
        ("database.delete", false),
    ] {
        let spec = specs
            .as_array()
            .unwrap()
            .iter()
            .find(|spec| spec["id"] == command)
            .unwrap();
        assert_eq!(spec["headless"], true);
        assert_eq!(spec["readOnly"], read_only);
        if !read_only {
            assert!(spec["argsSchema"]["required"]
                .as_array()
                .unwrap()
                .contains(&json!("expectedRevision")));
        }
    }
    let db = cli(path, &["db", "create", "--name", "Before"]);
    let id = db["id"].as_str().unwrap();
    let inspection = cli(path, &["db", "inspect", "--id", id]);
    let renamed = cli(
        path,
        &[
            "db",
            "rename",
            "--id",
            id,
            "--name",
            "After",
            "--expected-revision",
            inspection["revision"].as_str().unwrap(),
        ],
    );
    assert_eq!(renamed["name"], "After");
    let current = cli(path, &["db", "inspect", "--id", id]);
    let removed = cli(
        path,
        &[
            "db",
            "delete",
            "--id",
            id,
            "--expected-revision",
            current["revision"].as_str().unwrap(),
        ],
    );
    assert_eq!(cli(path, &["db", "list"]), json!([]));
    cli(
        path,
        &[
            "trash",
            "restore",
            "--id",
            removed["trashId"].as_str().unwrap(),
        ],
    );
    assert_eq!(cli(path, &["db", "list"]), json!([renamed]));
}

#[test]
fn folder_subtrees_can_be_inspected_deleted_and_restored_without_ui() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    cli(path, &["vault", "init", "--name", "Folder CLI"]);
    let specs = cli(path, &["commands", "list"]);
    assert!(specs
        .as_array()
        .unwrap()
        .iter()
        .any(|spec| spec["id"] == "folder.inspect"
            && spec["readOnly"] == true
            && spec["headless"] == true));
    let folder = cli(path, &["folder", "create", "--name", "Projects"]);
    let id = folder["id"].as_str().unwrap();
    let note = cli(
        path,
        &["note", "create", "--title", "Inside", "--folder-id", id],
    );
    let inspection = cli(path, &["folder", "inspect", "--id", id]);
    assert_eq!(inspection["noteCount"], 1);
    let removed = cli(
        path,
        &[
            "folder",
            "delete",
            "--id",
            id,
            "--expected-revision",
            inspection["revision"].as_str().unwrap(),
        ],
    );
    assert_eq!(cli(path, &["note", "list"]), json!([]));
    cli(
        path,
        &[
            "trash",
            "restore",
            "--id",
            removed["trashId"].as_str().unwrap(),
        ],
    );
    assert_eq!(
        cli(
            path,
            &["note", "read", "--id", note["id"].as_str().unwrap()]
        ),
        note
    );
}

#[test]
fn user_frontmatter_is_discoverable_and_readable_without_a_ui() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    cli(path, &["vault", "init", "--name", "Frontmatter CLI"]);
    let specs = cli(path, &["commands", "list"]);
    assert!(specs
        .as_array()
        .unwrap()
        .iter()
        .any(|spec| spec["id"] == "note.frontmatter"
            && spec["readOnly"] == true
            && spec["headless"] == true));
    let note = cli(
        path,
        &[
            "note",
            "create",
            "--title",
            "Properties",
            "--body",
            "---\nstatus: draft\ntags: [work]\n---\nBody",
        ],
    );
    let result = cli(
        path,
        &["note", "frontmatter", "--id", note["id"].as_str().unwrap()],
    );
    assert_eq!(
        result,
        json!({"properties":{"status":"draft","tags":["work"]},"error":null})
    );
    assert_eq!(
        cli(
            path,
            &["note", "read", "--id", note["id"].as_str().unwrap()]
        ),
        note
    );
}
#[test]
fn stale_cli_write_returns_conflict_exit_code_and_keeps_current_content() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    cli(path, &["vault", "init", "--name", "Conflict"]);
    let note = cli(path, &["note", "create", "--title", "Original"]);
    let note_id = note["id"].as_str().unwrap();
    let revision = note["revision"].as_str().unwrap();
    cli(
        path,
        &[
            "note",
            "update",
            "--id",
            note_id,
            "--expected-revision",
            revision,
            "--body",
            "Fresh",
        ],
    );
    let output = Command::new(env!("CARGO_BIN_EXE_foltra"))
        .args([
            "--vault",
            path,
            "note",
            "update",
            "--id",
            note_id,
            "--expected-revision",
            revision,
            "--body",
            "Stale",
        ])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(3));
    assert!(output.stdout.is_empty());
    assert_eq!(
        cli(path, &["note", "read", "--id", note_id])["body"],
        "Fresh"
    );
}

#[test]
fn agents_can_discover_and_read_topic_blocks_without_a_ui() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    cli(path, &["vault", "init", "--name", "Topic CLI"]);
    cli(
        path,
        &[
            "note",
            "create",
            "--title",
            "Journal",
            "--body",
            "- Work [[Foo]]\n  - Child\n- Other",
        ],
    );
    let topics = cli(path, &["topics", "list"]);
    let args = json!({"topic":topics[0]["id"],"limit":10}).to_string();
    let result = cli(path, &["topics", "blocks", "--args", &args]);
    assert_eq!(result["total"], 1);
    assert_eq!(result["blocks"][0]["body"], "- Work [[Foo]]\n  - Child");
    assert_eq!(result["blocks"][0]["line"], 1);
}

#[test]
fn title_links_and_aliases_roundtrip_through_cli_and_rename() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    cli(path, &["vault", "init", "--name", "Aliases"]);
    let target = cli(path, &["note", "create", "--title", "노트이름"]);
    let source = cli(
        path,
        &[
            "note",
            "create",
            "--title",
            "Source",
            "--body",
            "[[노트이름|foo]]",
        ],
    );
    assert_eq!(source["body"], "[[노트이름|foo]]");
    assert_eq!(
        cli(
            path,
            &["note", "link", "--id", target["id"].as_str().unwrap()]
        ),
        "[[노트이름]]"
    );
    cli(
        path,
        &[
            "note",
            "update",
            "--id",
            target["id"].as_str().unwrap(),
            "--expected-revision",
            target["revision"].as_str().unwrap(),
            "--title",
            "새이름",
        ],
    );
    assert_eq!(
        cli(
            path,
            &["note", "read", "--id", source["id"].as_str().unwrap()]
        )["body"],
        "[[새이름|foo]]"
    );
}

#[test]
fn path_resolution_and_rpc_remain_headless_without_a_vault_flag() {
    use std::io::Write;
    use std::process::Stdio;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    cli(path, &["vault", "init", "--name", "Open from CLI"]);
    let note = cli(path, &["note", "create", "--title", "Selected note"]);
    let note_path = dir
        .path()
        .join(format!("notes/{}.md", note["id"].as_str().unwrap()));
    let output = Command::new(env!("CARGO_BIN_EXE_foltra"))
        .args(["path", "resolve", "--path", note_path.to_str().unwrap()])
        .env_remove("FOLTRA_VAULT")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let resolved: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(resolved["noteId"], note["id"]);
    assert_eq!(
        resolved["vaultPath"],
        json!(std::fs::canonicalize(dir.path()).unwrap())
    );

    let mut process = Command::new(env!("CARGO_BIN_EXE_foltra"))
        .arg("rpc")
        .env_remove("FOLTRA_VAULT")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    process
        .stdin
        .take()
        .unwrap()
        .write_all(
            json!({"command":"path.resolve","args":{"path":note_path}})
                .to_string()
                .as_bytes(),
        )
        .unwrap();
    let output = process.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap(),
        resolved
    );
}

#[cfg(target_os = "macos")]
#[test]
fn direct_and_explicit_open_validate_the_app_override_without_launching_ui() {
    let dir = tempfile::tempdir().unwrap();
    cli(
        dir.path().to_str().unwrap(),
        &["vault", "init", "--name", "Open fixture"],
    );
    for prefix in [vec![], vec!["open"]] {
        let output = Command::new(env!("CARGO_BIN_EXE_foltra"))
            .args(prefix)
            .arg(dir.path())
            .env("FOLTRA_APP_PATH", dir.path().join("missing-app"))
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(1));
        assert!(output.stdout.is_empty());
        assert_eq!(
            serde_json::from_slice::<Value>(&output.stderr).unwrap()["error"]["code"],
            "invalid_app_path"
        );
    }
}
