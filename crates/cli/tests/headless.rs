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

fn invoke(vault: Option<&str>, args: &[&str], input: Option<&str>) -> std::process::Output {
    use std::io::Write;
    use std::process::Stdio;
    let mut command = Command::new(env!("CARGO_BIN_EXE_foltra"));
    command.env_remove("FOLTRA_VAULT").args(args);
    if let Some(vault) = vault {
        command.env("FOLTRA_VAULT", vault);
    }
    let mut process = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    if let Some(input) = input {
        process
            .stdin
            .take()
            .unwrap()
            .write_all(input.as_bytes())
            .unwrap();
    }
    process.wait_with_output().unwrap()
}
fn success(output: std::process::Output) -> String {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}
fn json_output(output: std::process::Output) -> Value {
    serde_json::from_str(&success(output)).unwrap()
}
fn new_vault() -> tempfile::TempDir {
    let v = tempfile::tempdir().unwrap();
    cli(
        v.path().to_str().unwrap(),
        &["vault.init", "--name", "New CLI"],
    );
    v
}

#[test]
fn help_is_discoverable_per_command_and_alias_without_a_vault() {
    for args in [
        vec![],
        vec!["--help"],
        vec!["help"],
        vec!["help", "all"],
        vec!["note", "--help"],
        vec!["read", "--help"],
        vec!["open", "--help"],
        vec!["rpc", "--help"],
        vec!["completions", "--help"],
        vec!["help", "open"],
        vec!["help", "database", "property", "update"],
    ] {
        let output = success(invoke(None, &args, None));
        assert!(!output.is_empty());
    }
    let help = success(invoke(None, &["property", "set", "--help"], None));
    assert!(help.contains("--expected-revision"));
    assert!(help.contains("--note"));
    assert!(success(invoke(None, &["task", "--help"], None)).contains("bookmark [b]"));
    assert!(!invoke(None, &["help", "nonesuch"], None).status.success());
    for shell in ["bash", "zsh", "fish"] {
        let script = success(invoke(None, &["completions", shell], None));
        assert!(script.contains("note.append") && script.contains("foltra"));
    }
}

#[test]
fn title_selectors_stdin_and_output_formats_work_with_legacy_json() {
    let v = new_vault();
    let path = v.path().to_str().unwrap();
    let source = json_output(invoke(
        Some(path),
        &["create", "--title", "한글 메모", "--content-file", "-"],
        Some("---\nstatus: draft\n---\n원본\n"),
    ));
    assert_eq!(
        success(invoke(Some(path), &["read", "--note", "한글 메모"], None)),
        source["body"].as_str().unwrap()
    );
    assert_eq!(
        json_output(invoke(
            Some(path),
            &["read", "--note", "한글 메모", "--json"],
            None
        )),
        source
    );
    let updated = json_output(invoke(
        Some(path),
        &[
            "append",
            "--note",
            "한글 메모",
            "--content",
            "추가",
            "--inline=false",
        ],
        None,
    ));
    assert!(updated["body"].as_str().unwrap().ends_with("원본\n추가"));
    let raw = cli(path, &["note:read", "--id", source["id"].as_str().unwrap()]);
    assert_eq!(raw, updated);
    let request = json!({"command":"note.read","args":{"id":source["id"]}}).to_string();
    assert_eq!(
        json_output(invoke(Some(path), &["rpc"], Some(&request))),
        updated
    );
    assert_eq!(
        json_output(invoke(Some(path), &["rpc", "--json"], Some(&request))),
        updated
    );
    let jsonl = success(invoke(Some(path), &["files", "--format", "jsonl"], None));
    assert_eq!(jsonl.lines().count(), 1);
    assert_eq!(
        serde_json::from_str::<Value>(jsonl.trim()).unwrap()["title"],
        "한글 메모"
    );
    for format in ["csv", "tsv"] {
        assert!(
            success(invoke(Some(path), &["files", "--format", format], None)).contains("한글 메모")
        );
    }
}

#[test]
fn schema_options_cover_sql_and_boolean_flags() {
    let v = new_vault();
    let path = v.path().to_str().unwrap();
    let database = cli(path, &["database.create", "--name", "Tasks"]);
    let record = cli(
        path,
        &[
            "record.create",
            "--database",
            "Tasks",
            "--values",
            "{\"title\":\"Review\"}",
        ],
    );
    assert_eq!(record["databaseId"], database["id"]);
    let result = json_output(invoke(
        Some(path),
        &["sql", "--sql-file", "-"],
        Some("SELECT COUNT(*) AS total FROM \"Tasks\""),
    ));
    assert_eq!(result["rows"][0][0], "1");
    let note = cli(
        path,
        &["create", "--title", "Task", "--body", "- [ ] Check"],
    );
    let updated = cli(path, &["task", "--note", "Task", "--line", "1", "--toggle"]);
    assert_eq!(updated["body"], "- [x] Check");
    let failed = invoke(
        Some(path),
        &["task", "--note", "Task", "--line", "-1", "--toggle"],
        None,
    );
    assert!(!failed.status.success());
    assert_eq!(
        cli(path, &["note.read", "--id", note["id"].as_str().unwrap()]),
        updated
    );
}

#[test]
fn friendly_selectors_rename_move_and_property_edit_preserve_cas() {
    let v = new_vault();
    let path = v.path().to_str().unwrap();
    cli(path, &["folder.create", "--name", "Projects"]);
    let source = cli(path, &["create", "--title", "Before", "--body", "Text"]);
    let moved = cli(path, &["move", "--note", "Before", "--folder", "Projects"]);
    assert!(moved["folderId"].is_string());
    let renamed = cli(path, &["rename", "--note", "Before", "--title", "After"]);
    assert_eq!(renamed["id"], source["id"]);
    cli(
        path,
        &[
            "property", "set", "--note", "After", "--name", "progress", "--value", "2", "--type",
            "number",
        ],
    );
    assert_eq!(
        cli(path, &["properties", "--note", "After"])["properties"]["progress"],
        2
    );
    let stale = invoke(
        Some(path),
        &[
            "rename",
            "--note",
            "After",
            "--title",
            "Lost",
            "--expected-revision",
            source["revision"].as_str().unwrap(),
        ],
        None,
    );
    assert_eq!(stale.status.code(), Some(3));
    assert_eq!(
        cli(path, &["note.read", "--id", source["id"].as_str().unwrap()])["title"],
        "After"
    );
    cli(
        path,
        &["property.remove", "--note", "After", "--name", "progress"],
    );
    assert_eq!(
        cli(path, &["properties", "--note", "After"])["properties"],
        json!({})
    );
    cli(path, &["delete", "--note", "After"]);
    assert_eq!(cli(path, &["files"]), json!([]));
    assert_eq!(cli(path, &["trash.list"])[0]["title"], "After");
}

#[test]
fn ambiguous_names_and_invalid_formats_do_not_mutate_data() {
    let v = new_vault();
    let path = v.path().to_str().unwrap();
    cli(path, &["create", "--title", "Duplicate", "--body", "A"]);
    cli(path, &["create", "--title", "Duplicate", "--body", "B"]);
    let before = cli(path, &["vault.export"]);
    for args in [
        vec!["append", "--note", "Duplicate", "--content", "X"],
        vec!["create", "--title", "No", "--format", "bogus"],
        vec!["rename", "--note", "Missing", "--title", "No"],
        vec!["read", "--note", "Missing"],
    ] {
        assert!(!invoke(Some(path), &args, None).status.success());
    }
    assert_eq!(cli(path, &["vault.export"])["files"], before["files"]);
}

#[test]
fn vault_inference_from_cwd_note_path_and_global_option_is_explicit() {
    let v = new_vault();
    let path = v.path().to_str().unwrap();
    let source = cli(path, &["create", "--title", "From cwd", "--body", "Body"]);
    let result = Command::new(env!("CARGO_BIN_EXE_foltra"))
        .current_dir(v.path().join("notes"))
        .env_remove("FOLTRA_VAULT")
        .args(["read", "--note", "From cwd"])
        .output()
        .unwrap();
    assert_eq!(success(result), "Body");
    assert_eq!(
        success(invoke(
            None,
            &["read", "--note", "From cwd", "--vault", path],
            None
        )),
        "Body"
    );
    let file = v
        .path()
        .join(format!("notes/{}.md", source["id"].as_str().unwrap()));
    assert_eq!(
        success(invoke(
            None,
            &["read", "--note-path", file.to_str().unwrap()],
            None
        )),
        "Body"
    );
    let other = new_vault();
    assert!(!invoke(
        Some(other.path().to_str().unwrap()),
        &["read", "--note-path", file.to_str().unwrap()],
        None
    )
    .status
    .success());
}

#[test]
fn daily_and_task_workflow_runs_without_the_desktop() {
    let v = new_vault();
    let path = v.path().to_str().unwrap();
    assert!(
        !invoke(Some(path), &["daily.read", "--date", "2026-09-01"], None)
            .status
            .success()
    );
    cli(
        path,
        &[
            "daily",
            "append",
            "--date",
            "2026-09-01",
            "--content",
            "- [ ] Review\n- [b] Keep",
        ],
    );
    assert_eq!(
        cli(path, &["tasks", "--status", "todo"])
            .as_array()
            .unwrap()
            .len(),
        1
    );
    cli(
        path,
        &[
            "task",
            "--note",
            "2026-09-01",
            "--line",
            "1",
            "--status",
            "done",
        ],
    );
    assert_eq!(
        cli(path, &["tasks", "--status", "done"])[0]["text"],
        "Review"
    );
    assert_eq!(
        cli(path, &["tasks", "--status", "bookmark"])[0]["text"],
        "Keep"
    );
}

#[test]
fn search_context_reports_matching_lines_and_schema_boolean_switches_work() {
    let v = new_vault();
    let path = v.path().to_str().unwrap();
    cli(
        path,
        &[
            "create",
            "--title",
            "Search",
            "--body",
            "before\nHello 한글\nafter\nhello",
        ],
    );
    let hits = cli(
        path,
        &[
            "find",
            "--query",
            "hello",
            "--note",
            "Search",
            "--no-case-sensitive",
            "--limit",
            "1",
        ],
    );
    assert_eq!(hits.as_array().unwrap().len(), 1);
    assert_eq!(hits[0]["line"], 2);
    assert_eq!(hits[0]["before"], "before");
    assert_eq!(hits[0]["after"], "after");
    assert!(success(invoke(
        Some(path),
        &["find", "--query", "한글", "--format", "text"],
        None
    ))
    .contains("Search:2\tHello 한글"));
    let exact = cli(path, &["find", "--query", "hello", "--case-sensitive"]);
    assert_eq!(exact.as_array().unwrap().len(), 1);
    assert_eq!(exact[0]["line"], 4);
    assert_eq!(cli(path, &["find", "--query", "한글"])[0]["line"], 2);
}

#[test]
fn sql_csv_uses_column_labels_in_order_and_quotes_multiline_cells() {
    let v = new_vault();
    let path = v.path().to_str().unwrap();
    let sql = "SELECT 'a,b' AS z, 'line1\nline2' AS a, 'quote\"value' AS q";
    let csv = success(invoke(
        Some(path),
        &["sql", "--sql", sql, "--format", "csv"],
        None,
    ));
    assert_eq!(
        csv,
        "\"z\",\"a\",\"q\"\n\"a,b\",\"line1\nline2\",\"quote\"\"value\"\n"
    );
    let tsv = success(invoke(
        Some(path),
        &["sql", "--sql", sql, "--format", "tsv"],
        None,
    ));
    assert_eq!(tsv, "z\ta\tq\na,b\tline1\\nline2\tquote\"value\n");
}
