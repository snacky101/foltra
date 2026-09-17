mod anki_bridge;
mod attachments;
mod backup;
mod database_schema;
mod databases;
mod extensions;
mod folders;
mod model;
mod notes;
mod plugin_manifest;
mod plugin_runtime;
mod query;
mod sql_query;
mod storage;
mod tags;
mod topic_order;
mod topics;
mod validation;
mod vault;
mod wiki;

pub use model::*;
use serde::Serialize;
use serde_json::{json, Value};
use std::fmt;
use storage::Store;

#[derive(Debug, Serialize)]
pub struct Error {
    pub code: String,
    pub message: String,
}
impl Error {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for Error {}
impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Self::new(
            if e.kind() == std::io::ErrorKind::NotFound {
                "not_found"
            } else {
                "io"
            },
            e.to_string(),
        )
    }
}
impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Self::new("invalid_data", e.to_string())
    }
}
impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Self::new("index_error", e.to_string())
    }
}
pub type Result<T> = std::result::Result<T, Error>;

pub(crate) fn text<'a>(args: &'a Value, name: &str) -> Result<&'a str> {
    args.get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| Error::new("invalid_arguments", format!("{name} must be a string")))
}
pub(crate) fn id(value: &str) -> Result<&str> {
    uuid::Uuid::parse_str(value).map_err(|_| Error::new("invalid_id", "Expected a UUID"))?;
    if value.len() != 36 {
        return Err(Error::new("invalid_id", "Expected a canonical UUID"));
    }
    Ok(value)
}
pub(crate) fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
pub(crate) fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn execute(path: &str, command: &str, args: Value) -> Result<Value> {
    if !args.is_object() {
        return Err(Error::new(
            "invalid_arguments",
            "Arguments must be an object",
        ));
    }
    let plugin_command = command.starts_with("plugin.");
    if !plugin_command {
        validate_arguments(command, &args)?;
    }
    if command == "commands.list" {
        let mut specs: Vec<Value> = serde_json::from_str(include_str!("../commands.json"))?;
        if !path.is_empty() {
            specs.extend(extensions::command_specs(&Store::open(path, false)?)?);
        }
        return Ok(json!(specs));
    }
    if command == "vault.default" {
        let path = dirs::home_dir()
            .ok_or_else(|| Error::new("invalid_path", "Home directory unavailable"))?
            .join("Foltra/Personal");
        return Ok(json!({"path":path}));
    }
    let store = Store::open(path, command == "vault.init" || command == "vault.import")?;
    if command == "vault.init" {
        return vault::init(&store, &args);
    }
    if command == "vault.import" {
        return backup::import(&store, &args);
    }
    let info: VaultInfo = serde_json::from_str(&store.read(".foltra/vault.json")?)?;
    if info.format_version != 1 {
        return Err(Error::new(
            "unsupported_format",
            "This vault needs a different Foltra version",
        ));
    }
    if plugin_command {
        return extensions::execute_command(&store, command, &args);
    }
    dispatch(&store, command, args)
}

pub(crate) fn dispatch(store: &Store, command: &str, args: Value) -> Result<Value> {
    validate_arguments(command, &args)?;
    match command {
        "workspace.get" => vault::workspace(
            store,
            serde_json::from_str(&store.read(".foltra/vault.json")?)?,
        ),
        "note.list" => Ok(serde_json::to_value(
            notes::notes(store)?
                .into_iter()
                .map(|n| n.meta)
                .collect::<Vec<_>>(),
        )?),
        "note.read" => Ok(serde_json::to_value(notes::read_note(
            store,
            text(&args, "id")?,
        )?)?),
        "note.link" => {
            let notes = notes::notes(store)?;
            let note = notes::read_note(store, text(&args, "id")?)?;
            Ok(json!(wiki::note_link(&note, &notes)))
        }
        "note.create" => notes::create_note(store, &args),
        "note.open-link" => notes::open_link(store, &args),
        "note.update" => notes::update_note(store, &args),
        "note.delete" => notes::delete_note(store, &args),
        "attachment.import" => attachments::import(store, &args),
        "attachment.read" => attachments::read(store, &args),
        "folder.list" => folders::list(store),
        "folder.create" => folders::create(store, &args),
        "folder.update" => folders::update(store, &args),
        "folder.delete" => folders::delete(store, &args),
        "trash.list" => vault::trash(store),
        "trash.restore" => vault::restore(store, &args),
        "database.create" => databases::create_database(store, &args),
        "database.list" => Ok(serde_json::to_value(databases::databases(store)?)?),
        "database.property.add" => databases::add_property(store, &args),
        "database.property.preview" => database_schema::preview(store, &args),
        "database.property.update" => database_schema::update(store, &args),
        "record.create" => databases::create_record(store, &args),
        "record.update" => databases::update_record(store, &args),
        "record.delete" => databases::delete_record(store, &args),
        "record.body" => databases::record_body(store, &args),
        "query.run" => query::run(store, serde_json::from_value(args)?),
        "query.sql" => sql_query::run(store, text(&args, "sql")?),
        "query.catalog" => sql_query::catalog(store),
        "links.list" => Ok(serde_json::to_value(query::links(
            &notes::notes(store)?,
            &databases::records(store)?,
        )?)?),
        "backlinks.list" => {
            let target = text(&args, "target")?;
            Ok(serde_json::to_value(
                query::links(&notes::notes(store)?, &databases::records(store)?)?
                    .into_iter()
                    .filter(|l| l.target.as_deref() == Some(target))
                    .collect::<Vec<_>>(),
            )?)
        }
        "search" => query::search(store, text(&args, "query")?),
        "tags.list" => tags::list(store),
        "tags.blocks" => tags::blocks(store, &args),
        "topics.list" => topics::list(store),
        "topics.blocks" => topics::blocks(store, &args),
        "topics.reorder" => topics::reorder(store, &args),
        "settings.get" => vault::settings(store),
        "settings.update" => vault::update_settings(store, &args),
        "extension.install" => extensions::install(
            store,
            args.get("manifest")
                .ok_or_else(|| Error::new("invalid_arguments", "manifest is required"))?,
        ),
        "extension.remove" => extensions::remove(store, text(&args, "id")?),
        "extension.list" => extensions::list(store),
        "extension.status" => plugin_runtime::statuses(store),
        "extension.enable" => {
            plugin_runtime::enable(store, text(&args, "id")?, text(&args, "digest")?)
        }
        "extension.disable" => plugin_runtime::disable(store, text(&args, "id")?),
        "extension.invoke" => plugin_runtime::invoke(store, &args, false),
        "extension.settings.get" => plugin_runtime::settings(store, text(&args, "id")?),
        "extension.settings.update" => plugin_runtime::configure(store, &args),
        "vault.export" => vault::export(store),
        _ => Err(Error::new(
            "unknown_command",
            format!("Unknown command: {command}"),
        )),
    }
}

fn validate_arguments(command: &str, args: &Value) -> Result<()> {
    if !args.is_object() {
        return Err(Error::new(
            "invalid_arguments",
            "Arguments must be an object",
        ));
    }
    let specs: Value = serde_json::from_str(include_str!("../commands.json"))?;
    let spec = specs
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == command)
        .ok_or_else(|| Error::new("unknown_command", format!("Unknown command: {command}")))?;
    let schema = &spec["argsSchema"];
    for required in schema["required"].as_array().unwrap() {
        let name = required.as_str().unwrap();
        if args.get(name).is_none() {
            return Err(Error::new(
                "invalid_arguments",
                format!("{name} is required"),
            ));
        }
    }
    for (key, value) in args.as_object().unwrap() {
        let kind = schema["properties"][key]["type"]
            .as_str()
            .ok_or_else(|| Error::new("invalid_arguments", format!("Unknown argument: {key}")))?;
        let valid = match kind {
            "string" => value.is_string(),
            "boolean" => value.is_boolean(),
            "object" => value.is_object(),
            "array" => value.is_array(),
            "integer" => value.as_u64().is_some(),
            _ => false,
        };
        if !valid {
            return Err(Error::new(
                "invalid_arguments",
                format!("{key} must be {kind}"),
            ));
        }
    }
    Ok(())
}
