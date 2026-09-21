use clap::Parser;
use foltra_core::{Error, Result};
use serde_json::{json, Value};
use std::io::{Read, Write};

mod arguments;
mod catalog;
mod desktop;
mod output;

#[derive(Parser)]
#[command(name = "foltra", version, disable_help_flag = true)]
struct Cli {
    #[arg(long)]
    vault: Option<String>,
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    command: Vec<String>,
}

fn read_input(reader: impl Read, limit: u64) -> Result<String> {
    let mut bytes = vec![];
    reader.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(Error::new("file_too_large", "Input exceeds the size limit"));
    }
    String::from_utf8(bytes).map_err(|_| Error::new("invalid_arguments", "Input must be UTF-8"))
}

fn read_file(path: &str) -> Result<String> {
    if path == "-" {
        read_input(std::io::stdin().lock(), 16 * 1024 * 1024)
    } else {
        read_input(std::fs::File::open(path)?, 16 * 1024 * 1024)
    }
}

fn normalize_command(command: &str) -> String {
    catalog::normalize(command)
}

fn specifications(vault: &str) -> Result<Vec<Value>> {
    Ok(serde_json::from_value(foltra_core::execute(
        vault,
        "commands.list",
        json!({}),
    )?)?)
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
    if target.starts_with('-')
        || matches!(command.as_str(), "rpc" | "help" | "completions")
        || command.starts_with("plugin.")
    {
        return Ok(None);
    }
    let known = command == "db"
        || specifications("")?.iter().any(|spec| {
            let id = spec["id"].as_str().unwrap();
            id == command || id.split('.').next() == Some(command.as_str())
        });
    Ok((!known).then_some(target.as_str()))
}

fn run(cli: Cli) -> Result<String> {
    let mut specs = specifications("")?;
    if cli.command.is_empty() || cli.command == ["--help"] || cli.command == ["-h"] {
        return catalog::help(&specs, "");
    }
    if cli.command == ["open", "--help"] || cli.command == ["open", "-h"] {
        return catalog::help(&specs, "open");
    }
    if let Some(path) = open_target(&cli)? {
        return output::render(&desktop::open(path)?, "json");
    }
    let split = cli
        .command
        .iter()
        .position(|s| s.starts_with('-'))
        .unwrap_or(cli.command.len());
    let words = &cli.command[..split];
    let mut options = arguments::scan(&cli.command[split..], &specs)?;
    let vault_option = arguments::take(&mut options, "--vault")?;
    if vault_option.is_some() && cli.vault.is_some() {
        return Err(Error::new("invalid_arguments", "Specify --vault only once"));
    }
    let explicit_vault = cli
        .vault
        .or(vault_option)
        .or_else(|| std::env::var("FOLTRA_VAULT").ok());
    let mut vault = explicit_vault.clone().unwrap_or_else(|| {
        foltra_core::execute("", "vault.locate", json!({}))
            .ok()
            .and_then(|v| v["vaultPath"].as_str().map(str::to_string))
            .unwrap_or_default()
    });
    let help = words.first().is_some_and(|word| word == "help")
        || options
            .iter()
            .any(|(flag, _)| matches!(flag.as_str(), "--help" | "-h"));
    options.retain(|(flag, _)| !matches!(flag.as_str(), "--help" | "-h"));
    let topic = if words.first().is_some_and(|word| word == "help") {
        words[1..].join(".")
    } else {
        words.join(".")
    };
    let command = normalize_command(&topic);
    if (help || command.starts_with("plugin.") || words.first().is_some_and(|s| s == "completions"))
        && !vault.is_empty()
    {
        specs = specifications(&vault)?;
    }
    if help {
        return catalog::help(&specs, &topic);
    }
    if words.first().is_some_and(|s| s == "completions") {
        if words.len() != 2 || !options.is_empty() {
            return Err(Error::new(
                "invalid_arguments",
                "Usage: foltra completions bash|zsh|fish",
            ));
        }
        return catalog::completions(&specs, &words[1]);
    }
    if command == "rpc" {
        options.retain(|(flag, value)| !(flag == "--json" && value.is_none()));
        if !options.is_empty() {
            return Err(Error::new(
                "invalid_arguments",
                "rpc takes a JSON request on stdin",
            ));
        }
        let value: Value =
            serde_json::from_str(&read_input(std::io::stdin().lock(), 18 * 1024 * 1024)?)?;
        let command = value["command"]
            .as_str()
            .ok_or_else(|| Error::new("invalid_arguments", "command is required"))?;
        return output::render(
            &foltra_core::execute(
                &vault,
                command,
                value.get("args").cloned().unwrap_or(json!({})),
            )?,
            "json",
        );
    }
    let Some(spec) = specs.iter().find(|spec| spec["id"] == command) else {
        if !options.is_empty() {
            return Err(Error::new(
                "unknown_command",
                format!("Choose a complete command; run foltra help {topic}"),
            ));
        }
        return catalog::help(&specs, &topic);
    };
    if options.iter().any(|(flag, value)| {
        flag == "--json"
            && value
                .as_deref()
                .is_some_and(|v| !matches!(v, "true" | "false"))
    }) {
        return Err(Error::new(
            "invalid_arguments",
            "--json accepts only true or false",
        ));
    }
    let json_flag = options
        .iter()
        .any(|(flag, value)| flag == "--json" && value.as_deref().is_none_or(|v| v == "true"));
    options.retain(|(flag, _)| flag != "--json");
    let format = arguments::take(&mut options, "--format")?.unwrap_or_else(|| {
        if !json_flag && matches!(topic.as_str(), "read" | "daily") {
            "text"
        } else {
            "json"
        }
        .into()
    });
    if json_flag && format != "json" {
        return Err(Error::new(
            "invalid_arguments",
            "--json conflicts with --format",
        ));
    }
    output::validate(&format)?;
    let note = arguments::take(&mut options, "--note")?;
    let note_path = arguments::take(&mut options, "--note-path")?;
    let folder = arguments::take(&mut options, "--folder")?;
    let database = arguments::take(&mut options, "--database")?;
    let mut args = arguments::parse(options, spec)?;
    let resolved_path = note_path
        .as_ref()
        .map(|path| foltra_core::execute("", "path.resolve", json!({"path":path})))
        .transpose()?;
    if let Some(path) = &resolved_path {
        if path.get("noteId").is_none() {
            return Err(Error::new(
                "invalid_arguments",
                "--note-path requires a managed note file",
            ));
        }
        if explicit_vault.is_some() {
            let selected = foltra_core::execute("", "path.resolve", json!({"path":vault}))?;
            if selected["vaultPath"] != path["vaultPath"] {
                return Err(Error::new(
                    "invalid_arguments",
                    "Note path belongs to a different vault",
                ));
            }
        }
        vault = path["vaultPath"].as_str().unwrap().into();
    }
    if note.is_some() && resolved_path.is_some() {
        return Err(Error::new(
            "invalid_arguments",
            "Use --note or --note-path, not both",
        ));
    }
    if let Some(target) = note
        .as_deref()
        .or_else(|| resolved_path.as_ref().and_then(|v| v["noteId"].as_str()))
    {
        let key = catalog::note_key(&command).ok_or_else(|| {
            Error::new("invalid_arguments", "This command does not accept --note")
        })?;
        if args.get(key).is_some() {
            return Err(Error::new(
                "invalid_arguments",
                "Do not combine a note selector with its raw ID argument",
            ));
        }
        let note = foltra_core::execute(&vault, "note.resolve", json!({"target":target}))?;
        args[key] = note["id"].clone();
        if spec["argsSchema"]["required"]
            .as_array()
            .unwrap()
            .contains(&json!("expectedRevision"))
            && args.get("expectedRevision").is_none()
        {
            args["expectedRevision"] = note["revision"].clone();
        }
    }
    if let Some(name) = database {
        insert_selector(
            &mut args,
            spec,
            "databaseId",
            arguments::resolve_named(&vault, "database.list", &name)?["id"].clone(),
        )?;
    }
    if let Some(name) = folder {
        let id = if name == "/" {
            json!("")
        } else {
            arguments::resolve_named(&vault, "folder.list", &name)?["id"].clone()
        };
        let key = if spec["argsSchema"]["properties"].get("folderId").is_some() {
            "folderId"
        } else {
            "parentId"
        };
        insert_selector(&mut args, spec, key, id)?;
    }
    for (alias, required) in [("rename", "title"), ("move", "folderId")] {
        if topic == alias && args.get(required).is_none() {
            return Err(Error::new(
                "invalid_arguments",
                format!("{alias} requires {required}"),
            ));
        }
    }
    if vault.is_empty()
        && !matches!(
            command.as_str(),
            "commands.list" | "path.resolve" | "vault.default" | "vault.locate"
        )
    {
        return Err(Error::new(
            "vault_required",
            "Use --vault PATH, FOLTRA_VAULT, or run inside a vault",
        ));
    }
    output::render(&foltra_core::execute(&vault, &command, args)?, &format)
}

fn insert_selector(args: &mut Value, spec: &Value, key: &str, value: Value) -> Result<()> {
    if spec["argsSchema"]["properties"].get(key).is_none() || args.get(key).is_some() {
        return Err(Error::new(
            "invalid_arguments",
            format!("Unsupported or repeated selector: {key}"),
        ));
    }
    args[key] = value;
    Ok(())
}

fn main() {
    match run(Cli::parse()) {
        Ok(result) => {
            if let Err(error) = std::io::stdout().lock().write_all(result.as_bytes()) {
                if error.kind() != std::io::ErrorKind::BrokenPipe {
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            }
        }
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
