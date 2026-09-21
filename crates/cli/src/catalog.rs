use foltra_core::{Error, Result};
use serde_json::Value;

pub const ALIASES: &[(&str, &str)] = &[
    ("files", "note.list"),
    ("read", "note.read"),
    ("create", "note.create"),
    ("append", "note.append"),
    ("prepend", "note.prepend"),
    ("rename", "note.update"),
    ("move", "note.update"),
    ("delete", "note.delete"),
    ("daily", "daily.read"),
    ("tasks", "tasks.list"),
    ("task", "task.update"),
    ("properties", "note.frontmatter"),
    ("outline", "note.outline"),
    ("wordcount", "note.stats"),
    ("tags", "tags.list"),
    ("links", "links.outgoing"),
    ("backlinks", "backlinks.list"),
    ("unresolved", "links.unresolved"),
    ("orphans", "notes.orphans"),
    ("deadends", "notes.deadends"),
    ("databases", "database.list"),
    ("sql", "query.sql"),
    ("folders", "folder.list"),
    ("plugins", "extension.list"),
    ("find", "search.context"),
];

pub fn normalize(command: &str) -> String {
    let command = command
        .replace(':', ".")
        .replace("db.record.", "record.")
        .replace("database.record.", "record.")
        .replace("db.", "database.");
    let command = match command.as_str() {
        "db" => "database".into(),
        "database.record" => "record".into(),
        _ => command,
    };
    ALIASES
        .iter()
        .find(|(alias, _)| *alias == command)
        .map_or(command.clone(), |(_, id)| (*id).into())
}

pub fn flag(name: &str) -> String {
    let mut flag = String::from("--");
    for ch in name.chars() {
        if ch.is_uppercase() {
            flag.push('-');
            flag.extend(ch.to_lowercase());
        } else {
            flag.push(ch);
        }
    }
    flag
}

pub fn help(specs: &[Value], topic: &str) -> Result<String> {
    match topic {
        "open" => return Ok("Usage: foltra open PATH\nOpen an existing vault directory or managed notes/UUID.md file in the macOS app.\nRelative paths and ~/ paths are accepted. This does not import plain Markdown files.\n".into()),
        "rpc" => return Ok("Usage: foltra [--vault PATH] rpc < request.json\nRead one {\"command\":\"note.read\",\"args\":{\"id\":\"UUID\"}} request from stdin.\nOutput is JSON. Input limit: 18 MiB. Exit 3 means a revision conflict.\n".into()),
        "completions" => return Ok("Usage: foltra completions bash|zsh|fish\nPrint shell completion definitions for command names, options and file paths.\nSource the output in your shell; Zsh requires compinit.\n".into()),
        _ => {}
    }
    let command = normalize(topic);
    if topic.is_empty() {
        let mut out = String::from("Foltra — notes and databases from your terminal, without a running app\n\nUsage: foltra [--vault PATH] COMMAND [OPTIONS]\n       foltra PATH | foltra open PATH\n\nQuick commands:\n");
        for (alias, id) in ALIASES {
            out.push_str(&format!("  {alias:14} {id}\n"));
        }
        out.push_str("\nUse foltra help COMMAND or foltra COMMAND --help for arguments.\nUse foltra help all to list every data command; dots, colons and spaces work.\n\nVault: --vault PATH > FOLTRA_VAULT > enclosing vault of the current directory.\nNotes: --note TITLE_OR_ID (ambiguous titles fail), --note-path PATH, or raw --id UUID.\nOutput: JSON by default; read/daily aliases print Markdown. --json, --format text|json|jsonl|tsv|csv.\nInput: --args JSON, --file JSON_FILE, --content-file FILE, --body-file FILE; '-' reads stdin.\nAgent API: foltra rpc < request.json; commands.list returns argument schemas.\nShell: foltra completions bash|zsh|fish\n\nExamples:\n  foltra read --note 'Welcome'\n  foltra append --note 'Ideas' --content 'A new idea'\n  foltra daily append --content '- [ ] Review notes'\n  foltra tasks --status todo\n  foltra task --note 'Ideas' --line 12 --status done\n  foltra property set --note 'Ideas' --name status --value draft\n  foltra search --query 'project'\n  foltra sql --sql 'SELECT * FROM \"Tasks\"'\n");
        return Ok(out);
    }
    if let Some(spec) = specs.iter().find(|spec| spec["id"] == command) {
        let mut out = format!(
            "{} — {}\n\nUsage: foltra [--vault PATH] {} [OPTIONS]\n\n",
            spec["id"].as_str().unwrap(),
            spec["title"].as_str().unwrap(),
            topic
        );
        let schema = &spec["argsSchema"];
        for (name, value) in schema["properties"].as_object().unwrap() {
            let required = if schema["required"]
                .as_array()
                .unwrap()
                .contains(&Value::String(name.clone()))
            {
                "required"
            } else {
                "optional"
            };
            out.push_str(&format!(
                "  {:24} {:8} {required}\n",
                flag(name),
                value["type"].as_str().unwrap_or("json")
            ));
        }
        out.push_str("\nCommon: --vault PATH, --json, --format text|json|jsonl|tsv|csv, --args JSON, --file FILE.\nString arguments also accept --ARG-file FILE ('-' for stdin); objects/arrays use JSON.\nBoolean options accept true/false, a bare flag, or --no-FLAG.\n");
        if note_key(&command).is_some() {
            out.push_str("Use --note TITLE_OR_ID or --note-path PATH instead of a note ID.\n");
            if schema["required"]
                .as_array()
                .unwrap()
                .contains(&Value::String("expectedRevision".into()))
            {
                out.push_str("With --note/--note-path, a missing expected revision uses the resolved snapshot once; conflicts are never retried.\n");
            }
        }
        if matches!(command.as_str(), "tasks.list" | "task.update") {
            out.push_str("Statuses: todo [ ], doing [/], done [x], bookmark [b], cancelled [-], deferred [>], question [?], important [!], star [*], info [i], pin [p].\nTask lines are 1-based body lines, including user frontmatter; code examples are excluded.\n");
        }
        return Ok(out);
    }
    let prefix = format!("{command}.");
    let rows: Vec<_> = specs
        .iter()
        .filter(|spec| topic == "all" || spec["id"].as_str().unwrap().starts_with(&prefix))
        .collect();
    if rows.is_empty() {
        return Err(Error::new(
            "unknown_command",
            format!("Unknown command: {topic}. Run foltra help all"),
        ));
    }
    Ok(rows
        .iter()
        .map(|spec| {
            format!(
                "  {:28} {}\n",
                spec["id"].as_str().unwrap(),
                spec["title"].as_str().unwrap()
            )
        })
        .collect())
}

pub fn note_key(command: &str) -> Option<&'static str> {
    if command == "backlinks.list" {
        Some("target")
    } else if command.starts_with("note.")
        && !matches!(
            command,
            "note.create" | "note.list" | "note.resolve" | "note.open-link"
        )
        || matches!(
            command,
            "task.update"
                | "tasks.list"
                | "property.set"
                | "property.remove"
                | "links.outgoing"
                | "search.context"
        )
    {
        Some("id")
    } else {
        None
    }
}

pub fn completions(specs: &[Value], shell: &str) -> Result<String> {
    let mut commands: Vec<String> = specs
        .iter()
        .filter_map(|s| s["id"].as_str().map(str::to_string))
        .collect();
    commands.extend(ALIASES.iter().map(|(alias, _)| alias.to_string()));
    commands.extend(["help", "open", "rpc", "completions"].map(str::to_string));
    let mut options = vec![
        "--vault".into(),
        "--help".into(),
        "--note".into(),
        "--note-path".into(),
        "--folder".into(),
        "--json".into(),
        "--format".into(),
        "--args".into(),
        "--file".into(),
        "--content-file".into(),
    ];
    for spec in specs {
        for (name, value) in spec["argsSchema"]["properties"].as_object().unwrap() {
            options.push(flag(name));
            if value["type"] == "string" {
                options.push(format!("{}-file", flag(name)));
            }
            if value["type"] == "boolean" {
                options.push(format!("--no-{}", &flag(name)[2..]));
            }
        }
    }
    // Package command metadata is untrusted. Completion scripts only interpolate shell-safe tokens.
    for values in [&mut commands, &mut options] {
        values.retain(|v| {
            v.bytes()
                .all(|ch| ch.is_ascii_alphanumeric() || b".-_".contains(&ch))
        });
        values.sort();
        values.dedup();
    }
    let words = commands.join(" ");
    let flags = options.join(" ");
    match shell {
        "bash" => Ok(format!("_foltra() {{\n  local cur=\"${{COMP_WORDS[COMP_CWORD]}}\"\n  if [[ $cur == -* ]]; then\n    COMPREPLY=( $(compgen -W '{flags}' -- \"$cur\") )\n  elif [[ $COMP_CWORD == 1 ]]; then\n    COMPREPLY=( $(compgen -W '{words}' -- \"$cur\") )\n  else\n    COMPREPLY=( $(compgen -f -- \"$cur\") )\n  fi\n}}\ncomplete -F _foltra foltra\n")),
        "zsh" => Ok(format!("#compdef foltra\n_foltra() {{\n  if [[ $words[CURRENT] == -* ]]; then\n    compadd -- {flags}\n  elif (( CURRENT == 2 )); then\n    compadd -- {words}\n  else\n    _files\n  fi\n}}\ncompdef _foltra foltra\n")),
        "fish" => Ok(format!("complete -c foltra -n '__fish_use_subcommand' -a '{words}'\n") + &options.iter().map(|flag| format!("complete -c foltra -l {}\n", &flag[2..])).collect::<String>()),
        _ => Err(Error::new("invalid_arguments", "Choose bash, zsh or fish")),
    }
}
