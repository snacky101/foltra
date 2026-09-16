use crate::storage::{safe_path, Store};
use crate::{id, text, Database, Error, Note, Record, Result, VaultInfo};
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub fn import(store: &Store, args: &Value) -> Result<Value> {
    for entry in std::fs::read_dir(&store.root)? {
        if entry?.file_name() != ".foltra" {
            return Err(Error::new(
                "folder_not_empty",
                "Restore into an empty folder",
            ));
        }
    }
    if store.optional(".foltra/vault.json")?.is_some() {
        return Err(Error::new("vault_exists", "Restore into a new vault"));
    }
    let snapshot = &args["snapshot"];
    if snapshot["format"] != "foltra-export" || ![json!(1), json!(2)].contains(&snapshot["version"])
    {
        return Err(Error::new(
            "unsupported_format",
            "Unsupported backup format",
        ));
    }
    let mut attachments = vec![];
    if snapshot["version"] == 2 {
        let encoded: BTreeMap<String, String> =
            serde_json::from_value(snapshot["attachments"].clone())?;
        for (path, data) in encoded {
            safe_path(&store.root, &path)?;
            let bytes = crate::attachments::decode_entry(&path, &data)?;
            attachments.push((path, bytes));
        }
    } else if snapshot.get("attachments").is_some() {
        return Err(Error::new(
            "invalid_backup",
            "Attachments require backup version 2",
        ));
    }
    let mut files: BTreeMap<String, String> = serde_json::from_value(snapshot["files"].clone())?;
    let metadata = files
        .get(".foltra/vault.json")
        .ok_or_else(|| Error::new("invalid_backup", "Vault metadata is missing"))?;
    let info: VaultInfo = serde_json::from_str(metadata)?;
    if info.format_version != 1 {
        return Err(Error::new("unsupported_format", "Unsupported vault format"));
    }
    id(&info.id)?;
    for (path, content) in &files {
        safe_path(&store.root, path)?;
        if content.len() > 16 * 1024 * 1024 {
            return Err(Error::new(
                "file_too_large",
                "Backup contains a file over 16 MiB",
            ));
        }
        let valid = if path == ".foltra/vault.json" {
            true
        } else if path == ".foltra/settings.json" {
            let settings: serde_json::Map<String, Value> = serde_json::from_str(content)?;
            crate::vault::validate_settings(&settings)?;
            true
        } else if path == crate::topic_order::PATH {
            crate::topic_order::parse(content)?;
            true
        } else if path.starts_with("notes/") {
            let note = Note::parse(content)?;
            path == &format!("notes/{}.md", id(&note.meta.id)?)
        } else if path.starts_with("folders/") {
            let folder: crate::Folder = serde_json::from_str(content)?;
            path == &crate::folders::path(&folder.id)?
        } else if path.starts_with("databases/") {
            let db: Database = serde_json::from_str(content)?;
            path == &format!("databases/{}.json", id(&db.id)?)
        } else if path.starts_with("records/") {
            let record: Record = serde_json::from_str(content)?;
            path == &format!("records/{}.json", id(&record.id)?)
        } else if path.starts_with("extensions/") {
            let manifest: Value = serde_json::from_str(content)?;
            crate::extensions::validate_manifest(&manifest)?;
            path == &format!("extensions/{}.json", text(&manifest, "id")?)
        } else if path.starts_with("plugin-data/") {
            let name = path
                .strip_prefix("plugin-data/")
                .and_then(|s| s.strip_suffix(".json"))
                .unwrap_or("");
            let value: Value = serde_json::from_str(content)?;
            crate::extensions::valid_slug(name)
                && content.len() <= 256_000
                && value.is_object()
                && value["settings"].is_object()
        } else if path.starts_with("trash/") {
            let item: Value = serde_json::from_str(content)?;
            path == &format!("trash/{}.json", id(text(&item, "id")?)?)
        } else {
            false
        };
        if !valid {
            return Err(Error::new(
                "invalid_backup",
                format!("Unsupported backup entry: {path}"),
            ));
        }
    }
    let folders = files
        .iter()
        .filter(|(p, _)| p.starts_with("folders/"))
        .map(|(_, content)| serde_json::from_str::<crate::Folder>(content).map_err(Error::from))
        .collect::<Result<Vec<_>>>()?;
    crate::folders::validate_tree(&folders)?;
    for (path, content) in &files {
        if path.starts_with("notes/") {
            let note = Note::parse(content)?;
            if note
                .meta
                .folder_id
                .is_some_and(|id| !folders.iter().any(|f| f.id == id))
            {
                return Err(Error::new("invalid_backup", "Note folder does not exist"));
            }
        }
    }
    files.insert(
        ".gitignore".into(),
        ".foltra/local/\n.foltra/cache/\n".into(),
    );
    // Validate all entries before the first durable write. Never restore caches or recovery journals.
    store.commit_with_binary(
        files
            .into_iter()
            .map(|(path, body)| (path, Some(body)))
            .collect(),
        attachments,
    )?;
    Ok(json!({"vault":info,"path":store.root}))
}
