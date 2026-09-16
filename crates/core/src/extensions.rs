use crate::storage::Store;
use crate::validation::pretty;
use crate::{Error, Query, Result};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    kind: String,
    #[serde(default)]
    runtime: Option<Value>,
    id: String,
    name: String,
    version: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    commands: Vec<Contribution>,
    #[serde(default)]
    tokens: std::collections::BTreeMap<String, String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Contribution {
    id: String,
    title: String,
    action: Action,
    #[serde(default)]
    headless: bool,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum Action {
    Script,
    View { view: String },
    Template { title: String, body: String },
    Query { query: Query },
}
pub(crate) fn valid_slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
fn validate(value: &Value) -> Result<Manifest> {
    if value.to_string().len() > 256_000 {
        return Err(Error::new("invalid_extension", "Manifest too large"));
    }
    let manifest: Manifest = serde_json::from_value(value.clone())?;
    if !valid_slug(&manifest.id)
        || manifest.name.trim().is_empty()
        || manifest.name.len() > 120
        || manifest.version.len() > 30
        || manifest.description.len() > 2000
    {
        return Err(Error::new("invalid_extension", "Invalid manifest metadata"));
    }
    if manifest.version.split('.').count() != 3
        || !manifest
            .version
            .split('.')
            .all(|s| s.parse::<u32>().is_ok())
    {
        return Err(Error::new(
            "invalid_extension",
            "Version must use major.minor.patch",
        ));
    }
    match manifest.kind.as_str() {
        "plugin" => {
            if manifest.commands.len() > 50 || !manifest.tokens.is_empty() {
                return Err(Error::new("invalid_extension", "Invalid plugin fields"));
            }
            if let Some(runtime) = &manifest.runtime {
                let config = crate::plugin_manifest::validate(runtime)?;
                if config.background_command.as_ref().is_some_and(|id| {
                    !manifest
                        .commands
                        .iter()
                        .any(|c| c.id == *id && matches!(c.action, Action::Script))
                }) {
                    return Err(Error::new(
                        "invalid_extension",
                        "Background command must be a declared script command",
                    ));
                }
            }
            let mut seen = std::collections::HashSet::new();
            for contribution in &manifest.commands {
                if !valid_slug(&contribution.id)
                    || !seen.insert(&contribution.id)
                    || contribution.title.trim().is_empty()
                    || contribution.title.len() > 120
                {
                    return Err(Error::new(
                        "invalid_extension",
                        "Invalid or duplicate command",
                    ));
                }
                match &contribution.action {
                    Action::Script if manifest.runtime.is_some() => {}
                    Action::View { view }
                        if ["graph", "timeline", "topics", "notes", "databases"]
                            .contains(&view.as_str()) => {}
                    Action::Template { title, body }
                        if !title.trim().is_empty()
                            && title.len() <= 240
                            && body.len() <= 100_000 => {}
                    Action::Query { query } if query.limit <= 500 && query.filters.len() <= 20 => {}
                    _ => {
                        return Err(Error::new(
                            "invalid_extension",
                            "Unsupported command action",
                        ))
                    }
                }
            }
        }
        "theme" => {
            if !manifest.commands.is_empty() || manifest.runtime.is_some() {
                return Err(Error::new(
                    "invalid_extension",
                    "Themes cannot register commands",
                ));
            }
            for (key, color) in &manifest.tokens {
                if ![
                    "paper",
                    "panel",
                    "ink",
                    "muted",
                    "line",
                    "accent",
                    "sidebar",
                    "sidebar-ink",
                    "selection",
                    "danger",
                    "warning",
                    "success",
                    "syntax-keyword",
                    "syntax-atom",
                    "syntax-literal",
                    "syntax-string",
                ]
                .contains(&key.as_str())
                    || color.len() != 7
                    || !color.starts_with('#')
                    || !color[1..].bytes().all(|b| b.is_ascii_hexdigit())
                {
                    return Err(Error::new(
                        "invalid_extension",
                        "Themes accept only approved color tokens in #RRGGBB format",
                    ));
                }
            }
        }
        _ => return Err(Error::new("invalid_extension", "Expected plugin or theme")),
    }
    Ok(manifest)
}
pub fn install(store: &Store, value: &Value) -> Result<Value> {
    let manifest = validate(value)?;
    if store
        .optional(&format!("extensions/{}.json", manifest.id))?
        .is_some()
    {
        return Err(Error::new(
            "extension_exists",
            "Remove the installed version before replacing it",
        ));
    }
    store.commit(vec![(
        format!("extensions/{}.json", manifest.id),
        Some(pretty(value)?),
    )])?;
    Ok(value.clone())
}
pub(crate) fn validate_manifest(value: &Value) -> Result<()> {
    validate(value).map(|_| ())
}
pub fn remove(store: &Store, extension_id: &str) -> Result<Value> {
    if !valid_slug(extension_id) {
        return Err(Error::new("invalid_extension", "Invalid extension ID"));
    }
    let path = format!("extensions/{extension_id}.json");
    let raw = store
        .optional(&path)?
        .ok_or_else(|| Error::new("not_found", "Extension is not installed"))?;
    let manifest: Value = serde_json::from_str(&raw)?;
    let mut writes = vec![(path, None)];
    if manifest["kind"] == "theme" {
        let mut settings = crate::vault::settings(store)?;
        if settings["theme"] == extension_id {
            settings["theme"] = json!("paper");
            writes.push((".foltra/settings.json".into(), Some(pretty(&settings)?)));
        }
    }
    crate::plugin_runtime::disable(store, extension_id)?;
    store.commit(writes)?;
    Ok(json!({"removed":extension_id}))
}
pub fn list(store: &Store) -> Result<Value> {
    let mut manifests = vec![];
    for path in store.files("extensions", "json")? {
        let manifest: Value = serde_json::from_str(&store.read(&path)?)?;
        // Loading never evaluates script or applies arbitrary CSS.
        validate(&manifest)?;
        manifests.push(manifest);
    }
    Ok(json!(manifests))
}

pub fn command_specs(store: &Store) -> Result<Vec<Value>> {
    let mut specs = vec![];
    for manifest in list(store)?.as_array().unwrap() {
        if let Some(commands) = manifest["commands"].as_array() {
            for command in commands {
                let kind = command["action"]["type"].as_str().unwrap_or("");
                specs.push(json!({
                    "id":format!("plugin.{}.{}",manifest["id"].as_str().unwrap(),command["id"].as_str().unwrap()),
                    "title":command["title"], "headless": if kind == "script" { command["headless"].as_bool().unwrap_or(false) } else {kind != "view"}, "readOnly":kind != "template" && kind != "script",
                    "argsSchema":{"type":"object","properties":{},"required":[],"additionalProperties":kind == "script"}
                }));
            }
        }
    }
    Ok(specs)
}

pub fn execute_command(store: &Store, command_id: &str, args: &Value) -> Result<Value> {
    if !args.is_object() {
        return Err(Error::new(
            "invalid_arguments",
            "Declarative commands take no arguments",
        ));
    }
    for value in list(store)?.as_array().unwrap() {
        let manifest = validate(value)?;
        for command in manifest.commands {
            if format!("plugin.{}.{}", manifest.id, command.id) != command_id {
                continue;
            }
            if !matches!(command.action, Action::Script) && !args.as_object().unwrap().is_empty() {
                return Err(Error::new(
                    "invalid_arguments",
                    "Declarative commands take no arguments",
                ));
            }
            return match command.action {
                Action::Script => {
                    if !command.headless {
                        return Err(Error::new(
                            "requires_ui",
                            "This plugin command needs the desktop app",
                        ));
                    }
                    crate::plugin_runtime::invoke(
                        store,
                        &json!({"id":manifest.id,"event":{"type":"command","id":command.id,"args":args}}),
                        true,
                    )
                }
                Action::Template { title, body } => {
                    crate::notes::create_note(store, &json!({"title":title,"body":body}))
                }
                Action::Query { query } => crate::query::run(store, query),
                Action::View { .. } => Err(Error::new(
                    "requires_ui",
                    "This command opens a view in the desktop app",
                )),
            };
        }
    }
    Err(Error::new(
        "unknown_command",
        format!("Unknown command: {command_id}"),
    ))
}
