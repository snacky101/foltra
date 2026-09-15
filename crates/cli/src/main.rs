use clap::Parser;
use foltra_core::{Error, Result};
use serde_json::{json, Map, Value};
use std::{io::Read, path::PathBuf};

#[derive(Parser)]
#[command(
    name = "foltra",
    version,
    about = "Foltra local vault CLI. Example: foltra --vault ./vault note create --title Hello --json"
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

fn run(cli: Cli) -> Result<Value> {
    let split = cli
        .command
        .iter()
        .position(|s| s.starts_with("--"))
        .unwrap_or(cli.command.len());
    let mut command = cli.command[..split].join(".");
    command = command
        .replace("db.record.", "record.")
        .replace("database.record.", "record.")
        .replace("db.", "database.");
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
            "--id" | "--title" | "--body" | "--name" | "--target" | "--query" | "--sort" => {
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
