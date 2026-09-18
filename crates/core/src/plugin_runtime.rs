use crate::plugin_manifest::{self, RuntimeConfig};
use crate::storage::{revision, Store};
use crate::{extensions, text, Error, Result};
use rquickjs::{Context, Function, Module, Object, Runtime};
use serde_json::{json, Value};
use std::cell::{Cell, RefCell};
use std::path::PathBuf;
use std::rc::Rc;
use std::time::{Duration, Instant};

fn package(store: &Store, id: &str) -> Result<(Value, RuntimeConfig, String)> {
    if !extensions::valid_slug(id) {
        return Err(Error::new("invalid_plugin", "Invalid plugin ID"));
    }
    let manifest: Value = serde_json::from_str(&store.read(&format!("extensions/{id}.json"))?)?;
    extensions::validate_manifest(&manifest)?;
    let config = plugin_manifest::validate(&manifest["runtime"])?;
    let digest = revision(&manifest.to_string());
    Ok((manifest, config, digest))
}
fn grant_path(store: &Store, id: &str) -> Result<PathBuf> {
    if !extensions::valid_slug(id) {
        return Err(Error::new("invalid_plugin", "Invalid plugin ID"));
    }
    #[cfg(test)]
    let root = {
        thread_local! { static ROOT: tempfile::TempDir = tempfile::tempdir().unwrap(); }
        ROOT.with(|r| r.path().to_path_buf())
    };
    #[cfg(not(test))]
    let root = dirs::data_local_dir()
        .ok_or_else(|| Error::new("plugin_trust", "Application data directory unavailable"))?
        .join("app.foltra.desktop/plugin-grants");
    Ok(root
        .join(revision(&store.root.to_string_lossy()))
        .join(format!("{id}.json")))
}
fn approved(store: &Store, id: &str, digest: &str) -> Result<bool> {
    match std::fs::read_to_string(grant_path(store, id)?) {
        Ok(value) => Ok(value == digest),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}
pub(crate) fn authorize_git(store: &Store, id: &str, expected_digest: &str) -> Result<()> {
    let (_, config, digest) = package(store, id)?;
    if digest != expected_digest || !approved(store, id, &digest)? {
        return Err(Error::new(
            "plugin_disabled",
            "Git 확장이 변경되거나 비활성화되어 작업을 중단했습니다.",
        ));
    }
    permission(&config, "git.sync")?;
    Ok(())
}
pub fn enable(store: &Store, id: &str, expected_digest: &str) -> Result<Value> {
    let (_, _, digest) = package(store, id)?;
    if digest != expected_digest {
        return Err(Error::new(
            "plugin_changed",
            "Plugin changed; review its permissions again",
        ));
    }
    let path = grant_path(store, id)?;
    std::fs::create_dir_all(path.parent().unwrap())?;
    std::fs::write(path, &digest)?;
    Ok(json!({"id":id,"digest":digest,"enabled":true}))
}
pub fn disable(store: &Store, id: &str) -> Result<Value> {
    match std::fs::remove_file(grant_path(store, id)?) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    Ok(json!({"id":id,"enabled":false}))
}
pub fn statuses(store: &Store) -> Result<Value> {
    let mut result = vec![];
    for manifest in extensions::list(store)?.as_array().unwrap() {
        if manifest.get("runtime").is_none_or(Value::is_null) {
            continue;
        }
        let id = text(manifest, "id")?;
        let digest = revision(&manifest.to_string());
        result.push(json!({"id":id,"enabled":approved(store,id,&digest)?,"digest":digest,"dataRevision":store.optional(&data_path(id)).map(|raw| revision(&raw.unwrap_or_default())).unwrap_or_else(|_| "unreadable".into())}));
    }
    Ok(json!(result))
}
fn data_path(id: &str) -> String {
    format!("plugin-data/{id}.json")
}
fn data(store: &Store, id: &str) -> Result<(Value, String)> {
    let raw = store.optional(&data_path(id))?.unwrap_or_default();
    let value = if raw.is_empty() {
        json!({"settings":{},"data":null})
    } else {
        serde_json::from_str(&raw)?
    };
    if raw.len() > 256_000 || !value.is_object() || !value["settings"].is_object() {
        return Err(Error::new(
            "invalid_plugin_data",
            "Plugin data must contain settings and data within 256 KB",
        ));
    }
    Ok((value, revision(&raw)))
}
fn write_data(store: &Store, id: &str, value: &Value, expected: &str) -> Result<Value> {
    if data(store, id)?.1 != expected {
        return Err(Error::new(
            "conflict",
            "Plugin data changed; reload before saving",
        ));
    }
    let raw = crate::validation::pretty(value)?;
    if raw.len() > 256_000 {
        return Err(Error::new("plugin_limit", "Plugin data exceeds 256 KB"));
    }
    store.commit(vec![(data_path(id), Some(raw))])?;
    let (value, rev) = data(store, id)?;
    Ok(json!({"value":value["data"],"revision":rev}))
}
fn settings_value(store: &Store, id: &str, config: &RuntimeConfig) -> Result<Value> {
    let (saved, _) = data(store, id)?;
    let mut values = serde_json::Map::new();
    for setting in &config.settings {
        let value = saved["settings"]
            .get(&setting.id)
            .filter(|v| setting.accepts(v))
            .unwrap_or(&setting.default);
        values.insert(setting.id.clone(), value.clone());
    }
    Ok(Value::Object(values))
}
pub fn settings(store: &Store, id: &str) -> Result<Value> {
    let (_, config, _) = package(store, id)?;
    Ok(json!({"values":settings_value(store,id,&config)?,"revision":data(store,id)?.1}))
}
pub fn configure(store: &Store, args: &Value) -> Result<Value> {
    let id = text(args, "id")?;
    let (_, config, _) = package(store, id)?;
    let patch = args["values"]
        .as_object()
        .ok_or_else(|| Error::new("invalid_plugin", "Settings must be an object"))?;
    let (mut saved, _) = data(store, id)?;
    let mut values = settings_value(store, id, &config)?;
    for (key, value) in patch {
        if !config
            .settings
            .iter()
            .any(|s| s.id == *key && s.accepts(value))
        {
            return Err(Error::new("invalid_plugin", "Unsupported setting value"));
        }
        values[key] = value.clone();
    }
    saved["settings"] = values;
    write_data(store, id, &saved, text(args, "expectedRevision")?)?;
    settings(store, id)
}
fn permission<'a>(config: &RuntimeConfig, name: &'a str) -> Result<&'a str> {
    if config.permissions.iter().any(|p| p == name) {
        Ok(name)
    } else {
        Err(Error::new(
            "permission_denied",
            format!("Plugin requires {name}"),
        ))
    }
}
fn command_permission(command: &str) -> Option<(&'static str, bool)> {
    match command {
        "note.list" | "note.read" | "note.link" | "links.list" | "backlinks.list" | "search"
        | "tags.list" | "tags.blocks" | "topics.list" | "topics.blocks" | "folder.list" => {
            Some(("notes.read", false))
        }
        "note.create" | "note.update" | "note.delete" | "note.open-link" | "folder.create"
        | "folder.update" | "folder.delete" => Some(("notes.write", true)),
        "database.list" | "query.run" | "database.property.preview" => {
            Some(("databases.read", false))
        }
        "database.create"
        | "database.property.add"
        | "database.property.update"
        | "record.create"
        | "record.update"
        | "record.delete" => Some(("databases.write", true)),
        "record.body" => Some(("databases.write", true)),
        _ => None,
    }
}

pub fn invoke(store: &Store, args: &Value, headless: bool) -> Result<Value> {
    if args.to_string().len() > 512_000 {
        return Err(Error::new("plugin_limit", "Plugin input is too large"));
    }
    let id = text(args, "id")?;
    let (manifest, config, digest) = package(store, id)?;
    if args.get("digest").is_some_and(|d| d != &digest) {
        return Err(Error::new("plugin_changed", "Plugin package changed"));
    }
    if !approved(store, id, &digest)? {
        return Err(Error::new(
            "plugin_disabled",
            "Review permissions and enable this plugin on this device",
        ));
    }
    let event = &args["event"];
    let kind = text(event, "type")?;
    match kind {
        "command" => {
            let target = text(event, "id")?;
            if !manifest["commands"].as_array().is_some_and(|commands| {
                commands.iter().any(|c| {
                    c["id"] == target
                        && c["action"]["type"] == "script"
                        && (!headless || c["headless"] == true)
                })
            }) {
                return Err(Error::new(
                    "unknown_command",
                    "Plugin command is unavailable",
                ));
            }
        }
        "render" | "action" => {
            if headless || !config.views.iter().any(|v| event["id"] == v.id) {
                return Err(Error::new("invalid_view", "Plugin view is unavailable"));
            }
        }
        "completion" => {
            if headless {
                return Err(Error::new(
                    "requires_ui",
                    "Completions need the desktop editor",
                ));
            }
            if !config
                .completions
                .iter()
                .any(|provider| event["id"] == provider.id)
            {
                return Err(Error::new(
                    "invalid_completion",
                    "Undeclared completion provider",
                ));
            }
            let valid_query = event["args"].as_object().is_some_and(|args| {
                args.len() == 1
                    && args
                        .get("query")
                        .and_then(Value::as_str)
                        .is_some_and(|query| {
                            query.len() <= 256 && !query.chars().any(char::is_control)
                        })
            });
            if !valid_query {
                return Err(Error::new("invalid_completion", "Invalid completion query"));
            }
        }
        "event" => {
            if !config.events.iter().any(|e| event["name"] == *e) {
                return Err(Error::new("invalid_plugin", "Undeclared event"));
            }
        }
        "load" | "unload" => {}
        _ => return Err(Error::new("invalid_plugin", "Unsupported invocation")),
    }
    let runtime = Runtime::new().map_err(js_error)?;
    runtime.set_memory_limit(32 * 1024 * 1024);
    runtime.set_max_stack_size(512 * 1024);
    let started = Instant::now();
    let network_time = Rc::new(Cell::new(Duration::ZERO));
    let budget = Rc::clone(&network_time);
    runtime.set_interrupt_handler(Some(Box::new(move || {
        started.elapsed().saturating_sub(budget.get()) > Duration::from_millis(500)
            || started.elapsed() > Duration::from_secs(8)
    })));
    let context = Context::full(&runtime).map_err(js_error)?;
    let effects = Rc::new(RefCell::new(Vec::<Value>::new()));
    let calls = Rc::new(Cell::new(0));
    let changed = Rc::new(Cell::new(false));
    let response = context.with(|ctx| -> rquickjs::Result<String> {
        let store = store.clone();
        let config = config.clone();
        let input = json!({"event":event,"state":args.get("state").cloned().unwrap_or(json!({}))}).to_string();
        let args = args.clone();
        let id = id.to_owned();
        let kind = kind.to_owned();
        let effects = Rc::clone(&effects);
        let calls = Rc::clone(&calls);
        let changed = Rc::clone(&changed);
        let source = config.source.clone();
        let bridge = move |request: String| -> String {
            let store = &store;
            let config = &config;
            let args = &args;
            let id = id.as_str();
            let kind = kind.as_str();
            let result = (|| -> Result<Value> {
                calls.set(calls.get()+1);
                if calls.get() > 64 || started.elapsed().saturating_sub(network_time.get()) > Duration::from_millis(500) || started.elapsed() > Duration::from_secs(8) || request.len() > 256_000 { return Err(Error::new("plugin_limit","Plugin SDK budget exceeded")); }
                let request: Value = serde_json::from_str(&request)?;
                let params = &request["args"];
                let readonly = !["command","action"].contains(&kind);
                match text(&request,"op")? {
                    "settings" => settings_value(store,id,config),
                    "vaultId" => { let info:Value=serde_json::from_str(&store.read(".foltra/vault.json")?)?; Ok(info["id"].clone()) },
                    "createId" => Ok(json!(crate::new_id())),
                    "hash" => Ok(json!(revision(text(params,"text")?))),
                    "git" => {
                        permission(config,"git.sync")?;
                        let action=text(params,"action")?;
                        if action == "status" {
                            if kind == "completion" { return Err(Error::new("permission_denied","Git is unavailable to completions")); }
                            return crate::git_sync::status(store);
                        }
                        if readonly || headless { return Err(Error::new("requires_ui","Request Git operations from a desktop command or view action; CLI clients use the git.* commands directly")); }
                        permission(config,"ui")?;
                        if !["configure","sync","resolve"].contains(&action) { return Err(Error::new("invalid_arguments","Unknown Git operation")); }
                        if effects.borrow().len() >= 16 { return Err(Error::new("plugin_limit","Too many UI effects")); }
                        if !params["params"].is_object() { return Err(Error::new("invalid_arguments","Git parameters must be an object")); }
                        effects.borrow_mut().push(json!({"type":"git","args":{"action":action,"params":params["params"]}}));
                        Ok(Value::Null)
                    },
                    "anki" => {
                        permission(config,"anki.connect")?;
                        if readonly { return Err(Error::new("permission_denied","AnkiConnect is available from commands and actions only")); }
                        let at=Instant::now();
                        let action=text(params,"action")?;
                        let result=if action == "storeVaultImage" {
                            permission(config,"notes.read")?;
                            crate::anki_bridge::store_vault_image(store,&params["params"])
                        } else { crate::anki_bridge::request(action,&params["params"]) };
                        network_time.set(network_time.get()+at.elapsed());
                        result
                    },
                    "storage.read" => { let (value,rev)=data(store,id)?; Ok(json!({"value":value["data"],"revision":rev})) },
                    "storage.write" => {
                        if readonly { return Err(Error::new("permission_denied","Write storage from a command or view action")); }
                        let (mut saved,_) = data(store,id)?; saved["data"] = params["value"].clone();
                        let result = write_data(store,id,&saved,text(params,"expectedRevision")?)?;
                        changed.set(true);
                        Ok(result)
                    },
                    "call" => {
                        let command = text(params,"command")?;
                        let (needed,write) = command_permission(command).ok_or_else(|| Error::new("permission_denied","This core command is not exposed to plugins"))?;
                        permission(config,needed)?;
                        if command == "record.body" { permission(config,"notes.write")?; permission(config,"notes.read")?; }
                        if ["links.list", "backlinks.list", "record.update", "record.delete", "record.body", "database.property.add", "database.property.update"].contains(&command) { permission(config,"databases.read")?; }
                        if write && readonly { return Err(Error::new("permission_denied","Write vault data from a command or view action")); }
                        let result = crate::dispatch(store,command,params["args"].clone())?;
                        if write { changed.set(true); }
                        Ok(result)
                    },
                    "editor.read" => {
                        permission(config,"editor.read")?;
                        if kind == "completion" { return Err(Error::new("permission_denied","Completions receive only their query")); }
                        if headless || !args["editor"].is_object() { return Err(Error::new("requires_editor","Open an editable note first")); }
                        Ok(args["editor"].clone())
                    },
                    op @ ("openView" | "openNote" | "notify" | "editor.replaceSelection") => {
                        if kind == "completion" { return Err(Error::new("permission_denied","Completion requests cannot produce UI effects")); }
                        if headless { return Err(Error::new("requires_ui","This action needs the desktop app")); }
                        permission(config,if op == "editor.replaceSelection" {"editor.write"} else {"ui"})?;
                        if readonly && op != "notify" { return Err(Error::new("permission_denied","UI navigation and editing require a command or view action")); }
                        if effects.borrow().len() >= 16 { return Err(Error::new("plugin_limit","Too many UI effects")); }
                        if op == "openView" && !config.views.iter().any(|v| params["id"]==v.id) { return Err(Error::new("invalid_view","Undeclared view")); }
                        if op == "openNote" { crate::id(text(params,"id")?)?; }
                        if op == "notify" && text(params,"message")?.len() > 1000 { return Err(Error::new("plugin_limit","Message too long")); }
                        if op == "editor.replaceSelection" {
                            if !args["editor"].is_object() { return Err(Error::new("requires_editor","Open an editable note first")); }
                            if text(params,"text")?.len() > 100_000 { return Err(Error::new("plugin_limit","Editor replacement too long")); }
                        }
                        effects.borrow_mut().push(json!({"type":op,"args":params}));
                        Ok(Value::Null)
                    },
                    _ => Err(Error::new("permission_denied","Unknown SDK method")),
                }
            })();
            let envelope = match result { Ok(value) => json!({"value":value}), Err(error) => json!({"error":error}) };
            let serialized = envelope.to_string();
            if serialized.len()>512_000 { json!({"error":{"code":"plugin_limit","message":"SDK response too large; use a smaller query"}}).to_string() } else { serialized }
        };
        ctx.globals().set("__foltraBridge",Function::new(ctx.clone(),bridge)?)?;
        let (module,promise) = Module::declare(ctx.clone(),"plugin",source.as_bytes())?.eval()?;
        promise.finish::<()>()?;
        let plugin: Object = module.get("default")?;
        let run: Function = ctx.eval(include_str!("plugin_sdk.js"))?;
        let result = run.call((plugin,input));
        // Deferred JS work is unsupported; never allow it to outlive this context.
        result
    });
    let output = response.map_err(|error| {
        let message = context.with(|ctx| {
            let value = ctx.catch();
            value
                .as_exception()
                .and_then(|e| e.message())
                .unwrap_or_else(|| format!("{value:?}"))
        });
        Error::new(
            "plugin_error",
            format!(
                "{id}: {error}: {}",
                message.chars().take(1000).collect::<String>()
            ),
        )
    })?;
    if output.len() > 512_000 {
        return Err(Error::new("plugin_limit", "Plugin output too large"));
    }
    let mut output: Value = serde_json::from_str(&output)?;
    if !output["state"].is_object() || output["state"].to_string().len() > 64_000 {
        return Err(Error::new(
            "plugin_limit",
            "Plugin session state must be an object under 64 KB",
        ));
    }
    if !output["view"].is_null() {
        plugin_manifest::validate_tree(&output["view"])?;
    }
    if kind == "completion" {
        plugin_manifest::validate_completions(&output["result"])?;
    }
    output["effects"] = json!(*effects.borrow());
    output["changed"] = json!(changed.get());
    Ok(output)
}
fn js_error(error: rquickjs::Error) -> Error {
    Error::new("plugin_error", error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup(source: &str, permissions: Value) -> (tempfile::TempDir, Store, Value) {
        let dir = tempfile::tempdir().unwrap();
        crate::execute(
            dir.path().to_str().unwrap(),
            "vault.init",
            json!({"name":"Code plugin test"}),
        )
        .unwrap();
        let store = Store::open(dir.path().to_str().unwrap(), false).unwrap();
        let manifest = json!({"id":"test-code","kind":"plugin","name":"Test code","version":"1.0.0","commands":[{"id":"run","title":"Run code","headless":true,"action":{"type":"script"}}],"runtime":{"apiVersion":1,"source":source,"permissions":permissions,"views":[{"id":"main","title":"Main"}]}});
        extensions::install(&store, &manifest).unwrap();
        (dir, store, manifest)
    }
    fn allow(store: &Store) {
        let status = statuses(store).unwrap();
        enable(store, "test-code", status[0]["digest"].as_str().unwrap()).unwrap();
    }
    fn run(store: &Store) -> Result<Value> {
        extensions::execute_command(store, "plugin.test-code.run", &json!({}))
    }
    fn completion_plugin(source: &str, permissions: Value) -> (tempfile::TempDir, Store, Value) {
        let dir = tempfile::tempdir().unwrap();
        crate::execute(
            dir.path().to_str().unwrap(),
            "vault.init",
            json!({"name":"Completions"}),
        )
        .unwrap();
        let store = Store::open(dir.path().to_str().unwrap(), false).unwrap();
        let manifest = json!({"id":"test-code","kind":"plugin","name":"Completions","version":"1.0.0",
            "commands":[],"runtime":{"apiVersion":1,"source":source,"permissions":permissions,
            "completions":[{"id":"dates","trigger":"@"}]}});
        extensions::install(&store, &manifest).unwrap();
        (dir, store, manifest)
    }
    fn complete(store: &Store, query: &str) -> Result<Value> {
        invoke(
            store,
            &json!({"id":"test-code","event":{"type":"completion","id":"dates","args":{"query":query}}}),
            false,
        )
    }

    #[test]
    fn completion_invokes_declared_handler_without_creating_notes_or_effects() {
        let (_dir,store,_) = completion_plugin(
            "export default {completions:{dates(api,{query}){api.state.query=query;return [{label:'@'+query,insertText:'2026-09-18',detail:'Local date'}]}}}",
            json!(["editor.write"]));
        assert_eq!(
            complete(&store, "Today").unwrap_err().code,
            "plugin_disabled"
        );
        allow(&store);
        let result = complete(&store, "Today").unwrap();
        assert_eq!(
            result["result"],
            json!([{"label":"@Today","insertText":"2026-09-18","detail":"Local date"}])
        );
        assert_eq!(result["state"]["query"], "Today");
        assert_eq!(result["effects"], json!([]));
        assert_eq!(result["changed"], false);
        assert_eq!(
            crate::dispatch(&store, "note.list", json!({})).unwrap(),
            json!([])
        );
        assert!(store
            .optional("plugin-data/test-code.json")
            .unwrap()
            .is_none());
        disable(&store, "test-code").unwrap();
        assert_eq!(
            complete(&store, "Today").unwrap_err().code,
            "plugin_disabled"
        );
    }

    #[test]
    fn bundled_date_completion_installs_and_returns_local_plain_dates() {
        let dir = tempfile::tempdir().unwrap();
        crate::execute(
            dir.path().to_str().unwrap(),
            "vault.init",
            json!({"name":"Date completion"}),
        )
        .unwrap();
        let store = Store::open(dir.path().to_str().unwrap(), false).unwrap();
        let manifest: Value =
            serde_json::from_str(include_str!("../../../examples/plugins/date-mentions.json"))
                .unwrap();
        extensions::install(&store, &manifest).unwrap();
        let request = json!({"id":"date-mentions","event":{"type":"completion","id":"dates","args":{"query":""}}});
        assert_eq!(
            invoke(&store, &request, false).unwrap_err().code,
            "plugin_disabled"
        );
        let status = statuses(&store).unwrap();
        enable(
            &store,
            "date-mentions",
            status[0]["digest"].as_str().unwrap(),
        )
        .unwrap();
        let before = chrono::Local::now().date_naive();
        let result = invoke(&store, &request, false).unwrap();
        let after = chrono::Local::now().date_naive();
        let items = result["result"].as_array().unwrap();
        assert_eq!(items.len(), 3);
        let today =
            chrono::NaiveDate::parse_from_str(items[0]["insertText"].as_str().unwrap(), "%Y-%m-%d")
                .unwrap();
        assert!(today == before || today == after);
        for (item, (label, offset)) in
            items
                .iter()
                .zip([("Today", 0), ("Yesterday", -1), ("Tomorrow", 1)])
        {
            assert_eq!(item["label"], label);
            assert_eq!(
                item["insertText"],
                (today + chrono::Duration::days(offset))
                    .format("%Y-%m-%d")
                    .to_string()
            );
        }
        let mut filtered = request;
        filtered["event"]["args"]["query"] = json!("tom");
        let result = invoke(&store, &filtered, false).unwrap();
        assert_eq!(result["result"].as_array().unwrap().len(), 1);
        assert_eq!(result["result"][0]["label"], "Tomorrow");
        assert_eq!(result["effects"], json!([]));
        assert_eq!(result["changed"], false);
        assert_eq!(
            crate::dispatch(&store, "note.list", json!({})).unwrap(),
            json!([])
        );
    }

    #[test]
    fn completion_rejects_undeclared_headless_invalid_queries_and_stale_packages() {
        let (_dir, store, mut manifest) = completion_plugin(
            "export default {completions:{dates(){return []}}}",
            json!(["editor.write"]),
        );
        allow(&store);
        let base = json!({"id":"test-code","event":{"type":"completion","id":"dates","args":{"query":""}}});
        assert_eq!(invoke(&store, &base, true).unwrap_err().code, "requires_ui");
        let mut request = base.clone();
        request["event"]["id"] = json!("missing");
        assert_eq!(
            invoke(&store, &request, false).unwrap_err().code,
            "invalid_completion"
        );
        for args in [
            Value::Null,
            json!({}),
            json!({"query":1}),
            json!({"query":"\n"}),
            json!({"query":"x","body":"private"}),
            json!({"query":"a".repeat(257)}),
        ] {
            request = base.clone();
            request["event"]["args"] = args;
            assert_eq!(
                invoke(&store, &request, false).unwrap_err().code,
                "invalid_completion"
            );
        }
        assert!(complete(&store, &"a".repeat(256)).is_ok());
        let old_digest = statuses(&store).unwrap()[0]["digest"].clone();
        manifest["description"] = json!("Changed package");
        store
            .commit(vec![(
                "extensions/test-code.json".into(),
                Some(manifest.to_string()),
            )])
            .unwrap();
        request = base;
        request["digest"] = old_digest;
        assert_eq!(
            invoke(&store, &request, false).unwrap_err().code,
            "plugin_changed"
        );
        assert_eq!(
            complete(&store, "Today").unwrap_err().code,
            "plugin_disabled"
        );
    }

    #[test]
    fn completion_cannot_write_navigate_notify_connect_or_read_editor() {
        let source = r#"export default {completions:{dates(api){
          const attempts = {
            note: () => api.call('note.create',{title:'Unwanted'}),
            storage: () => api.storage.write({bad:true},api.storage.read().revision),
            openNote: () => api.openNote('example'), openView: () => api.openView('missing'),
            notify: () => api.notify('unwanted'), replace: () => api.editor.replaceSelection('bad'),
            editor: () => api.editor.read(), anki: () => api.anki('version')
          };
          return Object.entries(attempts).map(([label,run]) => {
            let insertText='allowed'; try{run()}catch(error){insertText=error.code}
            return {label,insertText};
          });
        }}}"#;
        let (_dir, store, _) = completion_plugin(
            source,
            json!([
                "editor.read",
                "editor.write",
                "notes.write",
                "ui",
                "anki.connect"
            ]),
        );
        allow(&store);
        let result = invoke(&store,&json!({"id":"test-code","event":{"type":"completion","id":"dates","args":{"query":""}},"editor":{"body":"private","selection":"private"}}),false).unwrap();
        for candidate in result["result"].as_array().unwrap() {
            assert_eq!(
                candidate["insertText"], "permission_denied",
                "{}",
                candidate["label"]
            );
        }
        assert_eq!(result["effects"], json!([]));
        assert_eq!(result["changed"], false);
        assert_eq!(
            crate::dispatch(&store, "note.list", json!({})).unwrap(),
            json!([])
        );
        assert!(store
            .optional("plugin-data/test-code.json")
            .unwrap()
            .is_none());
    }

    #[test]
    fn completion_rejects_missing_async_and_malformed_handlers() {
        for (source, code) in [
            ("export default {}", "plugin_error"),
            ("export default {completions:{dates(){return Promise.resolve([])}}}", "plugin_error"),
            ("export default {completions:{dates(){return null}}}", "invalid_completion"),
            ("export default {completions:{dates(){return [{label:'Today',insertText:'date',html:'<b>bad</b>'}]}}}", "invalid_completion"),
            ("export default {completions:{dates(){return Array.from({length:101},()=>({label:'Today',insertText:'date'}))}}}", "invalid_completion"),
        ] {
            let (_dir,store,_) = completion_plugin(source,json!(["editor.write"]));
            allow(&store);
            assert_eq!(complete(&store,"").unwrap_err().code,code,"{source}");
        }
    }

    #[test]
    fn vault_images_require_both_capabilities_and_an_action() {
        let source = "export default {commands:{run(api){try{api.anki('storeVaultImage',{path:'../private.png',profile:'QA'})}catch(e){return e.code}}},views:{main:{render(api){try{api.anki('storeVaultImage',{path:'../private.png',profile:'QA'})}catch(e){return {type:'text',text:e.code}}}}}}";
        for permissions in [
            json!(["ui", "anki.connect"]),
            json!(["ui", "notes.read"]),
            json!(["ui", "anki.connect", "notes.read"]),
        ] {
            let (_dir, store, _) = setup(source, permissions.clone());
            allow(&store);
            assert_eq!(
                run(&store).unwrap()["result"],
                if permissions.as_array().unwrap().len() == 3 {
                    "invalid_path"
                } else {
                    "permission_denied"
                }
            );
            let rendered = invoke(
                &store,
                &json!({"id":"test-code","event":{"type":"render","id":"main"}}),
                false,
            )
            .unwrap();
            assert_eq!(rendered["view"]["text"], "permission_denied");
        }
    }
    #[test]
    fn anki_and_background_commands_require_explicit_capabilities() {
        let (_dir,store,mut manifest)=setup("export default {commands:{run(api){try{api.anki('version')}catch(e){return e.code}}},views:{main:{render(api){try{api.anki('version')}catch(e){return {type:'text',text:e.code}}}}}}",json!(["ui"]));
        allow(&store);
        assert_eq!(run(&store).unwrap()["result"], "permission_denied");
        manifest["runtime"]["permissions"] = json!(["ui", "anki.connect"]);
        store
            .commit(vec![(
                "extensions/test-code.json".into(),
                Some(manifest.to_string()),
            )])
            .unwrap();
        allow(&store);
        let rendered = invoke(
            &store,
            &json!({"id":"test-code","event":{"type":"render","id":"main"}}),
            false,
        )
        .unwrap();
        assert_eq!(rendered["view"]["text"], "permission_denied");
        manifest["runtime"]["backgroundCommand"] = json!("run");
        assert!(extensions::validate_manifest(&manifest).is_err());
        manifest["runtime"]["permissions"] = json!(["ui", "anki.connect", "automation"]);
        assert!(extensions::validate_manifest(&manifest).is_ok());
        manifest["runtime"]["backgroundCommand"] = json!("missing");
        assert!(extensions::validate_manifest(&manifest).is_err());
    }
    #[test]
    fn code_requires_device_approval_and_changed_code_loses_it() {
        let (_dir, store, mut manifest) = setup(
            "export default {commands:{run(api){return api.call('note.list').length}}}",
            json!(["ui", "notes.read"]),
        );
        assert_eq!(run(&store).unwrap_err().code, "plugin_disabled");
        allow(&store);
        assert_eq!(run(&store).unwrap()["result"], 0);
        manifest["runtime"]["source"] = json!("export default {commands:{run(){return 9}}}");
        store
            .commit(vec![(
                "extensions/test-code.json".into(),
                Some(manifest.to_string()),
            )])
            .unwrap();
        assert_eq!(run(&store).unwrap_err().code, "plugin_disabled");
        assert_eq!(statuses(&store).unwrap()[0]["enabled"], false);
    }
    #[test]
    fn sdk_does_not_expose_files_network_or_ungranted_commands() {
        let (_dir,store,_)=setup("export default {commands:{run(api){const result=[typeof fetch,typeof process,typeof require,typeof document];for(const command of ['note.list','settings.update','extension.enable']){try{api.call(command,{})}catch(e){result.push(e.code)}}return result}}}",json!(["ui"]));
        allow(&store);
        assert_eq!(
            run(&store).unwrap()["result"],
            json!([
                "undefined",
                "undefined",
                "undefined",
                "undefined",
                "permission_denied",
                "permission_denied",
                "permission_denied"
            ])
        );
    }
    #[test]
    fn plugin_writes_use_core_revisions_and_preserve_notes_after_removal() {
        let (_dir,store,_)=setup("export default {commands:{run(api){const n=api.call('note.create',{title:'Created by code',body:'original'});api.call('note.update',{id:n.id,title:n.title,body:'updated',expectedRevision:n.revision});try{api.call('note.update',{id:n.id,title:n.title,body:'lost',expectedRevision:n.revision})}catch(e){return {id:n.id,conflict:e.code}}}}}",json!(["ui","notes.read","notes.write"]));
        allow(&store);
        let result = run(&store).unwrap();
        assert_eq!(result["result"]["conflict"], "conflict");
        let id = result["result"]["id"].as_str().unwrap();
        extensions::remove(&store, "test-code").unwrap();
        assert_eq!(crate::notes::read_note(&store, id).unwrap().body, "updated");
    }
    #[test]
    fn custom_view_is_computed_by_code_and_rejects_html() {
        let (_dir,store,mut manifest)=setup("export default {views:{main:{render(api){return {type:'grid',columns:3,children:[{type:'text',text:String(6*7)}]}}}}}",json!(["ui"]));
        allow(&store);
        let result = invoke(
            &store,
            &json!({"id":"test-code","event":{"type":"render","id":"main"}}),
            false,
        )
        .unwrap();
        assert_eq!(result["view"]["children"][0]["text"], "42");
        manifest["runtime"]["source"]=json!("export default {views:{main:{render(){return {type:'iframe',src:'https://example.com'}}}}}");
        store
            .commit(vec![(
                "extensions/test-code.json".into(),
                Some(manifest.to_string()),
            )])
            .unwrap();
        allow(&store);
        assert_eq!(
            invoke(
                &store,
                &json!({"id":"test-code","event":{"type":"render","id":"main"}}),
                false
            )
            .unwrap_err()
            .code,
            "invalid_view"
        );
    }
    #[test]
    fn infinite_loop_is_interrupted_and_vault_remains_usable() {
        let (_dir, store, _) = setup(
            "export default {commands:{run(){while(true){}}}}",
            json!(["ui"]),
        );
        allow(&store);
        let start = Instant::now();
        assert!(run(&store).is_err());
        assert!(start.elapsed() < Duration::from_secs(3));
        assert_eq!(
            crate::dispatch(&store, "note.list", json!({})).unwrap(),
            json!([])
        );
    }
    #[test]
    fn heap_exhaustion_is_an_error_not_a_host_allocation() {
        let (_dir, store, _) = setup(
            "export default {commands:{run(){return 'x'.repeat(100000000)}}}",
            json!(["ui"]),
        );
        allow(&store);
        assert!(run(&store).is_err());
    }
    #[test]
    fn plugin_storage_has_conflict_checks_and_survives_export_without_trust() {
        let (_dir,store,_)=setup("export default {commands:{run(api){const old=api.storage.read();api.storage.write({count:42},old.revision);try{api.storage.write({count:0},old.revision)}catch(e){return e.code}}}}",json!(["ui"]));
        allow(&store);
        assert_eq!(run(&store).unwrap()["result"], "conflict");
        let exported = crate::vault::export(&store).unwrap();
        assert!(exported["files"]["plugin-data/test-code.json"].is_string());
        let copy = tempfile::tempdir().unwrap();
        let imported = Store::open(copy.path().to_str().unwrap(), true).unwrap();
        crate::backup::import(&imported, &json!({"snapshot":exported})).unwrap();
        assert_eq!(data(&imported, "test-code").unwrap().0["data"]["count"], 42);
        assert_eq!(statuses(&imported).unwrap()[0]["enabled"], false);
    }
    #[test]
    fn render_cannot_write_and_headless_commands_cannot_navigate() {
        let (_dir,store,_)=setup("export default {commands:{run(api){try{api.openView('main')}catch(e){return e.code}}},views:{main:{render(api){let code;try{api.call('note.create',{title:'unexpected'})}catch(e){code=e.code}return {type:'text',text:code}}}}}",json!(["ui","notes.write"]));
        allow(&store);
        assert_eq!(run(&store).unwrap()["result"], "requires_ui");
        assert_eq!(
            invoke(
                &store,
                &json!({"id":"test-code","event":{"type":"render","id":"main"}}),
                false
            )
            .unwrap()["view"]["text"],
            "permission_denied"
        );
        assert_eq!(
            crate::dispatch(&store, "note.list", json!({})).unwrap(),
            json!([])
        );
    }
    #[test]
    fn fixture_packages_run_views_actions_editor_effects_and_headless_commands() {
        let dir = tempfile::tempdir().unwrap();
        crate::execute(
            dir.path().to_str().unwrap(),
            "vault.init",
            json!({"name":"Code catalog"}),
        )
        .unwrap();
        let store = Store::open(dir.path().to_str().unwrap(), false).unwrap();
        for raw in [
            include_str!("../../../tests/fixtures/plugins/calendar.json"),
            include_str!("../../../tests/fixtures/plugins/kanban.json"),
            include_str!("../../../tests/fixtures/plugins/editor-tools.json"),
        ] {
            let manifest: Value = serde_json::from_str(raw).unwrap();
            extensions::install(&store, &manifest).unwrap();
            let id = manifest["id"].as_str().unwrap();
            enable(&store, id, &revision(&manifest.to_string())).unwrap();
        }
        let invoke_event = |id: &str, event: Value, state: Value| {
            invoke(&store, &json!({"id":id,"event":event,"state":state}), false).unwrap()
        };
        let result = invoke_event("calendar", json!({"type":"command","id":"open"}), json!({}));
        assert_eq!(result["effects"][0]["type"], "openView");
        let calendar = invoke_event(
            "calendar",
            json!({"type":"render","id":"calendar"}),
            json!({"month":"2026-09"}),
        );
        assert_eq!(calendar["view"]["type"], "stack");
        let created = invoke_event(
            "kanban",
            json!({"type":"action","id":"board","action":{"id":"create"}}),
            json!({}),
        );
        let mut state = created["state"].clone();
        state["draft"] = json!("A real record");
        let result = invoke_event(
            "kanban",
            json!({"type":"action","id":"board","action":{"id":"add"}}),
            state,
        );
        let db = result["state"]["databaseId"].as_str().unwrap();
        let rows = crate::dispatch(&store, "query.run", json!({"databaseId":db})).unwrap();
        assert_eq!(rows["rows"][0]["values"]["title"], "A real record");
        assert!(rows["rows"][0]["bodyNoteId"].is_null());
        let body = invoke_event(
            "kanban",
            json!({"type":"action","id":"board","action":{"id":"body","payload":{"id":rows["rows"][0]["id"],"revision":rows["rows"][0]["revision"]}}}),
            result["state"].clone(),
        );
        assert_eq!(body["effects"][0]["type"], "openNote");
        let summary =
            extensions::execute_command(&store, "plugin.kanban.summary", &json!({})).unwrap();
        assert_eq!(summary["result"][0]["total"], 1);
        let edited=invoke(&store,&json!({"id":"editor-tools","event":{"type":"command","id":"uppercase"},"editor":{"selection":"hello 한글"}}),false).unwrap();
        assert_eq!(edited["effects"][0]["args"]["text"], "HELLO 한글");
    }
    #[test]
    fn settings_validate_types_and_expected_revision() {
        let (_dir, store, mut manifest) = setup("export default {}", json!(["ui"]));
        manifest["runtime"]["settings"] =
            json!([{"id":"label","label":"Label","type":"text","default":"Before"}]);
        store
            .commit(vec![(
                "extensions/test-code.json".into(),
                Some(manifest.to_string()),
            )])
            .unwrap();
        let before = settings(&store, "test-code").unwrap();
        let args = json!({"id":"test-code","values":{"label":"After"},"expectedRevision":before["revision"]});
        assert_eq!(
            configure(&store, &args).unwrap()["values"]["label"],
            "After"
        );
        assert_eq!(configure(&store, &args).unwrap_err().code, "conflict");
        assert!(configure(&store,&json!({"id":"test-code","values":{"label":false},"expectedRevision":settings(&store,"test-code").unwrap()["revision"]})).is_err());
    }
    #[test]
    fn mixed_note_database_queries_require_both_permissions_and_corrupt_plugin_data_is_isolated() {
        let (_dir,store,_)=setup("export default {commands:{run(api){try{api.call('links.list')}catch(e){return e.code}}}}",json!(["ui","notes.read"]));
        allow(&store);
        assert_eq!(run(&store).unwrap()["result"], "permission_denied");
        store
            .commit(vec![(data_path("test-code"), Some("[]".into()))])
            .unwrap();
        assert!(statuses(&store).is_ok());
        assert_eq!(
            settings(&store, "test-code").unwrap_err().code,
            "invalid_plugin_data"
        );
        assert_eq!(
            crate::dispatch(&store, "note.list", json!({})).unwrap(),
            json!([])
        );
    }

    #[test]
    fn git_sdk_emits_bounded_host_requests_without_running_or_configuring_git() {
        let (_dir, store, _) = setup(
            "export default {commands:{run(api){const status=api.git('status');for(const action of ['configure','sync','resolve'])api.git(action,{example:true});return status}}}",
            json!(["ui", "git.sync"]),
        );
        let request = json!({"id":"test-code","event":{"type":"command","id":"run"}});
        assert_eq!(
            invoke(&store, &request, false).unwrap_err().code,
            "plugin_disabled"
        );
        allow(&store);
        let before = crate::dispatch(&store, "vault.export", json!({})).unwrap()["files"].clone();
        let result = invoke(&store, &request, false).unwrap();
        assert_eq!(
            result["effects"],
            json!([
                {"type":"git","args":{"action":"configure","params":{"example":true}}},
                {"type":"git","args":{"action":"sync","params":{"example":true}}},
                {"type":"git","args":{"action":"resolve","params":{"example":true}}}
            ])
        );
        assert_eq!(result["changed"], false);
        assert!(result["result"]["config"].is_null());
        assert_eq!(
            crate::dispatch(&store, "vault.export", json!({})).unwrap()["files"],
            before
        );
        assert!(store
            .optional(".foltra/local/git/config.json")
            .unwrap()
            .is_none());
        assert!(store
            .optional(".foltra/local/git/state.json")
            .unwrap()
            .is_none());
    }

    #[test]
    fn git_sdk_requires_permissions_and_rejects_passive_headless_or_direct_call_writes() {
        let source = "function attempt(api){try{api.git('sync',{});return 'allowed'}catch(e){return e.code}}export default {commands:{run:attempt},onLoad:attempt,views:{main:{render(api){let direct;try{api.call('git.sync',{});direct='allowed'}catch(e){direct=e.code}return {type:'text',text:attempt(api)+','+direct}}}}}";
        let (_dir, store, _) = setup(source, json!(["ui"]));
        allow(&store);
        let request = json!({"id":"test-code","event":{"type":"command","id":"run"}});
        let denied = invoke(&store, &request, false).unwrap();
        assert_eq!(denied["result"], "permission_denied");
        assert_eq!(denied["effects"], json!([]));

        let (_dir, store, mut manifest) = setup(source, json!(["ui", "git.sync"]));
        allow(&store);
        let loaded = invoke(
            &store,
            &json!({"id":"test-code","event":{"type":"load"}}),
            false,
        )
        .unwrap();
        assert_eq!(loaded["result"], "requires_ui");
        assert_eq!(loaded["effects"], json!([]));
        let rendered = invoke(
            &store,
            &json!({"id":"test-code","event":{"type":"render","id":"main"}}),
            false,
        )
        .unwrap();
        assert_eq!(rendered["view"]["text"], "requires_ui,permission_denied");
        assert_eq!(rendered["effects"], json!([]));
        assert_eq!(run(&store).unwrap()["result"], "requires_ui");

        manifest["runtime"]["permissions"] = json!(["git.sync"]);
        manifest["runtime"]["views"] = json!([]);
        store
            .commit(vec![(
                "extensions/test-code.json".into(),
                Some(manifest.to_string()),
            )])
            .unwrap();
        allow(&store);
        let denied = invoke(&store, &request, false).unwrap();
        assert_eq!(denied["result"], "permission_denied");
        assert_eq!(denied["effects"], json!([]));
        assert!(store
            .optional(".foltra/local/git/config.json")
            .unwrap()
            .is_none());
    }

    #[test]
    fn git_sdk_is_unavailable_to_completions_even_with_declared_permissions() {
        let (_dir, store, _) = completion_plugin(
            "export default {completions:{dates(api){return ['status','sync'].map(action=>{let label;try{api.git(action,{});label='allowed'}catch(e){label=e.code}return {label,insertText:action}})}}}",
            json!(["ui", "editor.write", "git.sync"]),
        );
        allow(&store);
        let result = complete(&store, "").unwrap();
        assert_eq!(
            result["result"],
            json!([
                {"label":"permission_denied","insertText":"status"},
                {"label":"requires_ui","insertText":"sync"}
            ])
        );
        assert_eq!(result["effects"], json!([]));
        assert_eq!(result["changed"], false);
        assert!(store
            .optional(".foltra/local/git/state.json")
            .unwrap()
            .is_none());
    }
}
