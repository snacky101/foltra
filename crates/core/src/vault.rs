use crate::{databases::*, extensions, notes::*, query, storage::Store, validation::*};
use crate::{id, new_id, now, text, Error, Note, Record, Result, VaultInfo};
use serde_json::{json, Map, Value};

pub fn init(store: &Store, args: &Value) -> Result<Value> {
    if store.optional(".foltra/vault.json")?.is_some() {
        return Err(Error::new(
            "vault_exists",
            "A vault already exists here. Open it instead.",
        ));
    }
    // Initialization must not overwrite existing user files, including .gitignore.
    for entry in std::fs::read_dir(&store.root)? {
        if entry?.file_name() != ".foltra" {
            return Err(Error::new(
                "folder_not_empty",
                "Choose an empty folder for a new vault.",
            ));
        }
    }
    let info = VaultInfo {
        id: new_id(),
        name: nonempty(text(args, "name")?, "Vault name")?,
        format_version: 1,
    };
    store.commit(vec![
        (".foltra/vault.json".into(), Some(pretty(&info)?)),
        (
            ".gitignore".into(),
            Some(".foltra/local/\n.foltra/cache/\n".into()),
        ),
    ])?;
    Ok(json!({"vault":info,"path":store.root}))
}

pub fn workspace(store: &Store, info: VaultInfo) -> Result<Value> {
    let notes = notes(store)?;
    let records = records(store)?;
    let links = query::links(&notes, &records)?;
    let summary: Vec<_> = notes.iter().map(|n| json!({"id":n.meta.id,"title":n.meta.title,"folderId":n.meta.folder_id,"createdAt":n.meta.created_at,"updatedAt":n.meta.updated_at,"revision":n.revision,"words":n.body.split_whitespace().count()})).collect();
    Ok(
        json!({"vault":info,"path":store.root,"notes":summary,"folders":crate::folders::list(store)?,"trash":trash(store)?,"databases":databases(store)?,"records":records.iter().map(|r|record_value(store,r)).collect::<Result<Vec<_>>>()?,"links":links,"settings":settings(store)?,"extensions":extensions::list(store)?,"pluginStates":crate::plugin_runtime::statuses(store)?,"topicOrderRevision":crate::topic_order::file_revision(store)?}),
    )
}

pub fn trash(store: &Store) -> Result<Value> {
    let mut out = vec![];
    for path in store.files("trash", "json")? {
        let mut item: Value = serde_json::from_str(&store.read(&path)?)?;
        let metadata = item
            .as_object_mut()
            .ok_or_else(|| Error::new("invalid_data", "Trash entry must be an object"))?;
        metadata.remove("content");
        metadata.remove("records");
        metadata.remove("folders");
        metadata.remove("notes");
        metadata.remove("linkTargets");
        out.push(item);
    }
    out.sort_by(|a, b| b["deletedAt"].as_str().cmp(&a["deletedAt"].as_str()));
    Ok(json!(out))
}

pub fn restore(store: &Store, args: &Value) -> Result<Value> {
    let path = format!("trash/{}.json", id(text(args, "id")?)?);
    let item: Value = serde_json::from_str(&store.read(&path)?)?;
    if text(&item, "id")? != text(args, "id")? {
        return Err(Error::new(
            "invalid_data",
            "Trash ID does not match filename",
        ));
    }
    if item["kind"] == "database" {
        return crate::database_lifecycle::restore(store, &item, &path);
    }
    if item["kind"] == "folder" {
        return crate::folder_lifecycle::restore(store, &item, &path);
    }
    let original = text(&item, "originalPath")?;
    if store.optional(original)?.is_some() {
        return Err(Error::new("conflict", "The destination already exists"));
    }
    let content = text(&item, "content")?;
    // A trash entry may restore only a managed note or record with a matching ID.
    let expected = match text(&item, "kind")? {
        "note" => note_path(&Note::parse(content)?.meta.id)?,
        "record" => {
            let record: Record = serde_json::from_str(content)?;
            let database = read_database(store, &record.database_id)?;
            validate_values(&database, &record.values)?;
            record_path(&record.id)?
        }
        _ => return Err(Error::new("invalid_data", "Unknown trash item type")),
    };
    if expected != original {
        return Err(Error::new("invalid_path", "Invalid trash destination"));
    }
    let mut writes = if item["kind"] == "note" {
        let mut note = Note::parse(content)?;
        if let Some(folder_id) = &note.meta.folder_id {
            if !crate::folders::folders(store)?
                .iter()
                .any(|f| &f.id == folder_id)
            {
                note.meta.folder_id = None;
            }
        }
        plan_note_write(store, &note.meta.id, Some(&note))?
    } else {
        vec![(original.into(), Some(content.into()))]
    };
    writes.push((path, None));
    store.commit(writes)?;
    Ok(json!({"restored":original}))
}

pub fn settings(store: &Store) -> Result<Value> {
    let mut defaults = json!({"vim":false,"editorMode":"live","lineNumbers":"none","cursorShape":"bar","cursorFollowVim":true,"cursorBlink":"blink","cursorBlinkRate":600,"cursorAnimation":"none","slash":false,"showUnresolvedLinks":true,"leader":" ","theme":"paper","keybindings":{},"shortcutVersion":4});
    if let Some(raw) = store.optional(".foltra/settings.json")? {
        let mut saved: Map<String, Value> = serde_json::from_str(&raw)?;
        validate_settings(&saved)?;
        // The old "auto" shape combined a bar with Vim's mode overrides.
        // Keep explicit shapes fixed when reading settings from that version.
        if let Some(shape) = saved.get("cursorShape").and_then(Value::as_str) {
            let follow_vim = shape == "auto";
            saved.entry("cursorFollowVim").or_insert(json!(follow_vim));
            normalize_cursor_shape(&mut saved);
        }
        normalize_keybindings(&mut saved);
        defaults.as_object_mut().unwrap().extend(saved);
    }
    Ok(defaults)
}

pub(crate) fn validate_settings(values: &Map<String, Value>) -> Result<()> {
    for (key, value) in values {
        match key.as_str() {
            "shortcutVersion" if matches!(value.as_u64(), Some(1..=4)) => {}
            "vim" | "slash" | "showUnresolvedLinks" | "cursorFollowVim" if value.is_boolean() => {}
            "editorMode"
                if value
                    .as_str()
                    .is_some_and(|s| ["live", "source", "read"].contains(&s)) => {}
            "lineNumbers"
                if value
                    .as_str()
                    .is_some_and(|s| ["none", "absolute", "relative"].contains(&s)) => {}
            "cursorShape"
                if value
                    .as_str()
                    .is_some_and(|s| ["auto", "bar", "block", "underline"].contains(&s)) => {}
            "cursorAnimation"
                if value
                    .as_str()
                    .is_some_and(|s| ["none", "smooth", "smear"].contains(&s)) => {}
            "cursorBlink"
                if value
                    .as_str()
                    .is_some_and(|s| ["steady", "blink", "breath"].contains(&s)) => {}
            "cursorBlinkRate" if value.as_u64().is_some_and(|n| (200..=2000).contains(&n)) => {}
            "theme"
                if value.as_str().is_some_and(|s| {
                    s.len() <= 80 && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
                }) => {}
            "leader" if value.as_str().is_some_and(valid_leader_key) => {}
            "keybindings"
                if value.as_object().is_some_and(|bindings| {
                    value.to_string().len() < 64_000
                        && bindings.iter().all(|(id, binding)| {
                            !id.is_empty() && id.len() <= 200 && valid_bindings(binding)
                        })
                }) => {}
            _ => {
                return Err(Error::new(
                    "invalid_settings",
                    format!("Invalid setting: {key}"),
                ))
            }
        }
    }
    Ok(())
}

fn valid_bindings(value: &Value) -> bool {
    if let Some(bindings) = value.as_array() {
        return bindings.iter().all(|binding| {
            binding.as_object().is_some_and(|fields| {
                fields.len() == 2
                    && fields.get("leader").is_some_and(Value::is_boolean)
                    && fields
                        .get("keys")
                        .and_then(Value::as_str)
                        .is_some_and(|keys| {
                            keys.len() <= 80
                                && keys.is_ascii()
                                && (valid_sequence(keys, binding["leader"] == true)
                                    || valid_shortcut(keys))
                        })
            })
        });
    }
    // Legacy files and CLI callers retain their old input contract.
    value.as_object().is_some_and(|fields| {
        fields.iter().all(|(key, value)| {
            ["leader", "shortcut", "vimNormal"].contains(&key.as_str())
                && value.as_str().is_some_and(|s| {
                    s.len() <= 80
                        && s.is_ascii()
                        && (key != "vimNormal"
                            || s.bytes().all(|c| c == b' ')
                            || valid_sequence(
                                &s.chars()
                                    .map(|c| c.to_string())
                                    .collect::<Vec<_>>()
                                    .join(" "),
                                false,
                            ))
                })
        })
    })
}

fn valid_sequence(value: &str, leader: bool) -> bool {
    if [
        "enter",
        "escape",
        "tab",
        "space",
        "backspace",
        "delete",
        "insert",
        "home",
        "end",
        "pageup",
        "pagedown",
        "arrowleft",
        "arrowright",
        "arrowup",
        "arrowdown",
    ]
    .contains(&value.to_ascii_lowercase().as_str())
    {
        return false;
    }
    let keys: Vec<_> = value.bytes().filter(|c| *c != b' ').collect();
    !keys.is_empty()
        && keys.len() <= 12
        && (leader || keys[0].is_ascii_alphabetic())
        && keys.iter().all(u8::is_ascii_alphanumeric)
}

fn valid_shortcut(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let mut parts: Vec<_> = lower.split('+').collect();
    let key = parts.pop().unwrap_or_default();
    let function = key
        .strip_prefix('f')
        .and_then(|n| n.parse::<u8>().ok())
        .is_some_and(|n| (1..=12).contains(&n));
    let key_valid = function
        || ["enter", "arrowleft", "arrowright", "arrowup", "arrowdown"].contains(&key)
        || (key.len() == 1 && (key.as_bytes()[0].is_ascii_alphanumeric() || ",./".contains(key)));
    let primary = parts
        .iter()
        .filter(|p| ["mod", "ctrl", "meta"].contains(p))
        .count();
    key_valid
        && primary <= 1
        && (primary == 1 || function)
        && parts
            .iter()
            .all(|p| ["mod", "ctrl", "meta", "shift", "alt"].contains(p))
        && parts.iter().collect::<std::collections::HashSet<_>>().len() == parts.len()
}

fn normalize_keybindings(settings: &mut Map<String, Value>) {
    let version = settings
        .get("shortcutVersion")
        .and_then(Value::as_u64)
        .unwrap_or(1);
    let legacy_case = version < 2;
    if let Some(bindings) = settings
        .get_mut("keybindings")
        .and_then(Value::as_object_mut)
    {
        let split_follow_link = version < 4
            || bindings
                .get("note.follow-link")
                .is_some_and(Value::is_object);
        for (id, value) in bindings.iter_mut() {
            let Some(fields) = value.as_object() else {
                continue;
            };
            let mut rows = Vec::new();
            for (field, leader) in [("shortcut", false), ("leader", true), ("vimNormal", false)] {
                let keys = fields.get(field).and_then(Value::as_str).or_else(|| {
                    (field == "vimNormal" && id == "note.follow-link").then_some("g d")
                });
                let Some(keys) = keys.filter(|s| !s.bytes().all(|c| c == b' ')) else {
                    continue;
                };
                let mut keys = keys.to_string();
                if legacy_case && field == "shortcut" {
                    if let Some((prefix, key)) = keys.rsplit_once('+') {
                        if key.len() == 1 && key.as_bytes()[0].is_ascii_alphabetic() {
                            keys = format!("{prefix}+{}", key.to_ascii_lowercase());
                        }
                    }
                }
                // Spacing keeps legacy letter sequences (e.g. F2/Enter) distinct from named keys.
                if field != "shortcut" {
                    keys = keys
                        .replace(' ', "")
                        .chars()
                        .map(|c| c.to_string())
                        .collect::<Vec<_>>()
                        .join(" ");
                }
                rows.push(json!({"keys":keys,"leader":leader}));
            }
            *value = json!(rows);
        }
        if split_follow_link && !bindings.contains_key("note.follow-existing-link") {
            if let Some(rows) = bindings
                .get_mut("note.follow-link")
                .and_then(Value::as_array_mut)
            {
                let (existing, open): (Vec<_>, Vec<_>) = rows.iter().cloned().partition(|row| {
                    row["leader"] == false
                        && row["keys"]
                            .as_str()
                            .is_some_and(|keys| keys.replace(' ', "") == "gd")
                });
                *rows = open;
                // An explicit empty override also preserves a previously disabled gd.
                bindings.insert("note.follow-existing-link".into(), json!(existing));
            }
        }
    }
    settings.insert("shortcutVersion".into(), json!(4));
}

pub fn update_settings(store: &Store, args: &Value) -> Result<Value> {
    let mut settings = settings(store)?;
    let mut patch = args.as_object().unwrap().clone();
    validate_settings(&patch)?;
    normalize_cursor_shape(&mut patch);
    patch.entry("shortcutVersion").or_insert(json!(4));
    normalize_keybindings(&mut patch);
    settings.as_object_mut().unwrap().extend(patch);
    store.commit(vec![(
        ".foltra/settings.json".into(),
        Some(pretty(&settings)?),
    )])?;
    Ok(settings)
}

fn normalize_cursor_shape(values: &mut Map<String, Value>) {
    if values.get("cursorShape").and_then(Value::as_str) == Some("auto") {
        values.insert("cursorShape".into(), json!("bar"));
        values.entry("cursorFollowVim").or_insert(json!(true));
    }
}

pub fn export(store: &Store) -> Result<Value> {
    let mut files = Map::new();
    for folder in [
        "notes",
        "folders",
        "databases",
        "records",
        "extensions",
        "plugin-data",
        "trash",
    ] {
        for extension in ["md", "json"] {
            for path in store.files(folder, extension)? {
                files.insert(path.clone(), json!(store.read(&path)?));
            }
        }
    }
    for path in [
        ".foltra/vault.json",
        ".foltra/settings.json",
        crate::topic_order::PATH,
    ] {
        if let Some(text) = store.optional(path)? {
            files.insert(path.into(), json!(text));
        }
    }
    let attachments = crate::attachments::export(store)?;
    let mut snapshot =
        json!({"format":"foltra-export","version":1,"exportedAt":now(),"files":files});
    if !attachments.is_empty() {
        snapshot["version"] = json!(2);
        snapshot["attachments"] = json!(attachments);
    }
    Ok(snapshot)
}
