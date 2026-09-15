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
        json!({"vault":info,"path":store.root,"notes":summary,"folders":crate::folders::list(store)?,"trash":trash(store)?,"databases":databases(store)?,"records":records.iter().map(|r|record_value(store,r)).collect::<Result<Vec<_>>>()?,"links":links,"settings":settings(store)?,"extensions":extensions::list(store)?}),
    )
}

pub fn trash(store: &Store) -> Result<Value> {
    let mut out = vec![];
    for path in store.files("trash", "json")? {
        let mut item: Value = serde_json::from_str(&store.read(&path)?)?;
        item.as_object_mut()
            .ok_or_else(|| Error::new("invalid_data", "Trash entry must be an object"))?
            .remove("content");
        out.push(item);
    }
    out.sort_by(|a, b| b["deletedAt"].as_str().cmp(&a["deletedAt"].as_str()));
    Ok(json!(out))
}

pub fn restore(store: &Store, args: &Value) -> Result<Value> {
    let path = format!("trash/{}.json", id(text(args, "id")?)?);
    let item: Value = serde_json::from_str(&store.read(&path)?)?;
    let original = text(&item, "originalPath")?;
    if store.optional(original)?.is_some() {
        return Err(Error::new("conflict", "The destination already exists"));
    }
    let content = text(&item, "content")?;
    // A trash entry may restore only a managed note or record with a matching ID.
    let expected = match text(&item, "kind")? {
        "note" => note_path(&Note::parse(content)?.meta.id)?,
        "record" => record_path(&serde_json::from_str::<Record>(content)?.id)?,
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
    let mut defaults = json!({"vim":false,"editorMode":"live","slash":false,"leader":" ","theme":"paper","keybindings":{},"shortcutVersion":2});
    if let Some(raw) = store.optional(".foltra/settings.json")? {
        let mut saved: Map<String, Value> = serde_json::from_str(&raw)?;
        validate_settings(&saved)?;
        // Version 1 treated uppercase key labels as unshifted. Normalize only
        // the returned settings; persist the upgrade on the next explicit write.
        if saved.get("shortcutVersion").and_then(Value::as_u64) != Some(2) {
            if let Some(bindings) = saved.get_mut("keybindings").and_then(Value::as_object_mut) {
                for binding in bindings.values_mut() {
                    if let Some(value) = binding.get_mut("shortcut") {
                        if let Some((prefix, key)) = value.as_str().and_then(|s| s.rsplit_once('+'))
                        {
                            if key.len() == 1 && key.as_bytes()[0].is_ascii_alphabetic() {
                                *value = json!(format!("{prefix}+{}", key.to_ascii_lowercase()));
                            }
                        }
                    }
                }
            }
        }
        saved.insert("shortcutVersion".into(), json!(2));
        defaults.as_object_mut().unwrap().extend(saved);
    }
    Ok(defaults)
}

pub(crate) fn validate_settings(values: &Map<String, Value>) -> Result<()> {
    for (key, value) in values {
        match key.as_str() {
            "shortcutVersion" if matches!(value.as_u64(), Some(1 | 2)) => {}
            "vim" | "slash" if value.is_boolean() => {}
            "editorMode"
                if value
                    .as_str()
                    .is_some_and(|s| ["live", "source", "read"].contains(&s)) => {}
            "theme"
                if value.as_str().is_some_and(|s| {
                    s.len() <= 80 && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
                }) => {}
            "leader" if value.as_str().is_some_and(valid_leader_key) => {}
            "keybindings"
                if value.as_object().is_some_and(|bindings| {
                    value.to_string().len() < 64_000
                        && bindings.iter().all(|(id, binding)| {
                            !id.is_empty()
                                && id.len() <= 200
                                && binding.as_object().is_some_and(|fields| {
                                    fields.iter().all(|(key, value)| {
                                        ["leader", "shortcut"].contains(&key.as_str())
                                            && value
                                                .as_str()
                                                .is_some_and(|s| s.len() <= 80 && s.is_ascii())
                                    })
                                })
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

pub fn update_settings(store: &Store, args: &Value) -> Result<Value> {
    let mut settings = settings(store)?;
    let patch = args.as_object().unwrap();
    validate_settings(patch)?;
    settings.as_object_mut().unwrap().extend(patch.clone());
    store.commit(vec![(
        ".foltra/settings.json".into(),
        Some(pretty(&settings)?),
    )])?;
    Ok(settings)
}

pub fn export(store: &Store) -> Result<Value> {
    let mut files = Map::new();
    for folder in [
        "notes",
        "folders",
        "databases",
        "records",
        "extensions",
        "trash",
    ] {
        for extension in ["md", "json"] {
            for path in store.files(folder, extension)? {
                files.insert(path.clone(), json!(store.read(&path)?));
            }
        }
    }
    for path in [".foltra/vault.json", ".foltra/settings.json"] {
        if let Some(text) = store.optional(path)? {
            files.insert(path.into(), json!(text));
        }
    }
    Ok(json!({"format":"foltra-export","version":1,"exportedAt":now(),"files":files}))
}
