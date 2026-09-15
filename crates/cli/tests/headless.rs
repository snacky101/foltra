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
