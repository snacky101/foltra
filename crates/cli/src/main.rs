use clap::Parser;
use foltra_core::{Error, Result};
use serde_json::{json, Map, Value};
use std::{io::Read, path::PathBuf};

mod desktop;

#[derive(Parser)]
#[command(
    name = "foltra",
    version,
    about = "Open a Foltra vault/note: foltra PATH or foltra open PATH. Headless example: foltra --vault ./vault note create --title Hello --json"
)]
struct Cli {
    #[arg(long)]
    vault: Option<String>,
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    command: Vec<String>,
}

fn read_file(path: &str) -> Result<String> {
    let file = std::fs::File::open(PathBuf::from(path))?;
    if file.metadata()?.len() > 16 * 1024 * 1024 {
        return Err(Error::new("file_too_large", "Input exceeds 16 MiB"));
    }
    let mut text = String::new();
    file.take(16 * 1024 * 1024 + 1).read_to_string(&mut text)?;
    Ok(text)
}

fn normalize_command(command: &str) -> String {
    command
        .replace("db.record.", "record.")
        .replace("database.record.", "record.")
        .replace("db.", "database.")
}

fn open_target(cli: &Cli) -> Result<Option<&str>> {
    if cli.command.first().is_some_and(|command| command == "open") {
        if cli.command.len() != 2 || cli.vault.is_some() {
            return Err(Error::new(
                "invalid_arguments",
                "Usage: foltra open PATH (one vault folder or managed note file)",
            ));
        }
        return Ok(Some(&cli.command[1]));
    }
    if cli.vault.is_some() || cli.command.len() != 1 {
        return Ok(None);
    }
    let target = &cli.command[0];
    let command = normalize_command(target);
    if target.starts_with('-') || command == "rpc" || command.starts_with("plugin.") {
        return Ok(None);
    }
    let specs = foltra_core::execute("", "commands.list", json!({}))?;
    let known = command == "db"
        || specs.as_array().unwrap().iter().any(|spec| {
            let id = spec["id"].as_str().unwrap();
            id == command || id.split('.').next() == Some(command.as_str())
        });
    Ok((!known).then_some(target.as_str()))
}

fn run(cli: Cli) -> Result<Value> {
    if let Some(path) = open_target(&cli)? {
        return desktop::open(path);
    }
    let split = cli
        .command
        .iter()
        .position(|s| s.starts_with("--"))
        .unwrap_or(cli.command.len());
    let mut command = normalize_command(&cli.command[..split].join("."));
    let mut args = Map::new();
    let mut index = split;
    while index < cli.command.len() {
        let flag = &cli.command[index];
        if flag == "--json" {
            index += 1;
            continue;
        }
        let value = cli
            .command
            .get(index + 1)
            .ok_or_else(|| Error::new("invalid_arguments", format!("Missing value for {flag}")))?;
        match flag.as_str() {
            "--args" => args.extend(serde_json::from_str::<Map<String, Value>>(value)?),
            "--file" => args.extend(serde_json::from_str::<Map<String, Value>>(&read_file(
                value,
            )?)?),
            "--body-file" => {
                args.insert("body".into(), json!(read_file(value)?));
            }
            "--data-file" => {
                args.insert("values".into(), serde_json::from_str(&read_file(value)?)?);
            }
            "--snapshot-file" => {
                args.insert("snapshot".into(), serde_json::from_str(&read_file(value)?)?);
            }
            "--manifest-file" => {
                args.insert("manifest".into(), serde_json::from_str(&read_file(value)?)?);
            }
            "--values" | "--properties" | "--filters" | "--property" => {
                args.insert(flag[2..].into(), serde_json::from_str(value)?);
            }
            "--limit" | "--offset" => {
                args.insert(
                    flag[2..].into(),
                    json!(value.parse::<usize>().map_err(|_| Error::new(
                        "invalid_arguments",
                        "Expected a positive integer"
                    ))?),
                );
            }
            "--database" => {
                args.insert("databaseId".into(), json!(value));
            }
            "--expected-revision" => {
                args.insert("expectedRevision".into(), json!(value));
            }
            "--folder-id" => {
                args.insert("folderId".into(), json!(value));
            }
            "--parent-id" => {
                args.insert("parentId".into(), json!(value));
            }
            "--note-id" => {
                args.insert("noteId".into(), json!(value));
            }
            "--id" | "--title" | "--body" | "--name" | "--target" | "--query" | "--sort"
            | "--path" => {
                args.insert(flag[2..].into(), json!(value));
            }
            _ => {
                return Err(Error::new(
                    "invalid_arguments",
                    format!("Unknown flag {flag}. Use --args for a JSON argument object."),
                ))
            }
        }
        index += 2;
    }
    if command == "rpc" {
        let mut request = String::new();
        std::io::stdin()
            .take(18 * 1024 * 1024)
            .read_to_string(&mut request)?;
        let value: Value = serde_json::from_str(&request)?;
        command = value["command"]
            .as_str()
            .ok_or_else(|| Error::new("invalid_arguments", "command is required"))?
            .into();
        args = serde_json::from_value(value.get("args").cloned().unwrap_or(json!({})))?;
    }
    let vault = cli
        .vault
        .or_else(|| std::env::var("FOLTRA_VAULT").ok())
        .unwrap_or_default();
    foltra_core::execute(&vault, &command, Value::Object(args))
}

fn main() {
    match run(Cli::parse()) {
        Ok(result) => println!("{}", serde_json::to_string_pretty(&result).unwrap()),
        Err(error) => {
            eprintln!("{}", json!({"error":error}));
            std::process::exit(if error.code == "conflict" { 3 } else { 1 });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_open_and_command_names_keep_headless_precedence() {
        for arguments in [
            vec!["foltra", "./vault"],
            vec!["foltra", "한글 폴더"],
            vec!["foltra", "./commands.list"],
            vec!["foltra", "open", "rpc"],
        ] {
            let cli = Cli::try_parse_from(arguments.clone()).unwrap();
            assert_eq!(open_target(&cli).unwrap(), arguments.last().copied());
        }
        for arguments in [
            vec!["foltra", "rpc"],
            vec!["foltra", "vault.default"],
            vec!["foltra", "commands.list"],
            vec!["foltra", "note.list"],
            vec!["foltra", "db.list"],
            vec!["foltra", "plugin.example.run"],
            vec!["foltra", "note"],
            vec!["foltra", "db"],
            vec!["foltra", "note", "list"],
            vec!["foltra", "--vault", "./vault", "note.list"],
        ] {
            let cli = Cli::try_parse_from(arguments).unwrap();
            assert_eq!(open_target(&cli).unwrap(), None);
        }
        assert_eq!(normalize_command("db.record.create"), "record.create");
        assert_eq!(normalize_command("database.record.create"), "record.create");
    }

    #[test]
    fn explicit_open_requires_one_path_without_a_competing_vault_flag() {
        for arguments in [
            vec!["foltra", "open"],
            vec!["foltra", "open", "one", "two"],
            vec!["foltra", "--vault", "./vault", "open", "./other"],
        ] {
            let cli = Cli::try_parse_from(arguments).unwrap();
            assert_eq!(open_target(&cli).unwrap_err().code, "invalid_arguments");
        }
    }
}
