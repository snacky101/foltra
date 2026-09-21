use crate::{notes, storage::Store, Error, Result, VaultInfo};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

pub fn locate(path: Option<&str>) -> Result<Value> {
    let start = match path {
        Some(path) => PathBuf::from(path),
        None => std::env::current_dir()?,
    };
    let start = fs::canonicalize(start)?;
    for parent in start.ancestors() {
        if parent.join(".foltra/vault.json").exists() {
            return resolve(
                parent
                    .to_str()
                    .ok_or_else(|| Error::new("invalid_path", "Vault path must be UTF-8"))?,
            );
        }
    }
    Err(Error::new(
        "vault_required",
        "Use --vault PATH, set FOLTRA_VAULT, or run inside a Foltra vault",
    ))
}

pub fn resolve(path: &str) -> Result<Value> {
    if path.trim().is_empty() {
        return Err(Error::new(
            "invalid_path",
            "Choose a vault or managed note path",
        ));
    }
    let target = if let Some(rest) = path.strip_prefix("~/") {
        dirs::home_dir()
            .ok_or_else(|| Error::new("invalid_path", "Home directory unavailable"))?
            .join(rest)
    } else {
        PathBuf::from(path)
    };
    let target = if target.is_absolute() {
        target
    } else {
        std::env::current_dir()?.join(target)
    };
    let metadata = fs::metadata(&target)?;
    let (root, note_id) = if metadata.is_dir() {
        (target.as_path(), None)
    } else if metadata.is_file()
        && target
            .extension()
            .is_some_and(|extension| extension == "md")
        && target
            .parent()
            .and_then(|parent| parent.file_name())
            .is_some_and(|name| name == "notes")
    {
        let note_id = target
            .file_stem()
            .and_then(|stem| stem.to_str())
            .ok_or_else(|| Error::new("invalid_path", "Invalid note filename"))?;
        crate::id(note_id)?;
        (target.parent().unwrap().parent().unwrap(), Some(note_id))
    } else {
        return Err(Error::new(
            "unsupported_open_path",
            "Open an existing Foltra vault folder or its notes/<UUID>.md file. Plain Markdown files are not supported.",
        ));
    };
    let store = Store::open(
        root.to_str()
            .ok_or_else(|| Error::new("invalid_path", "Vault paths must be UTF-8"))?,
        false,
    )?;
    let info: VaultInfo = serde_json::from_str(&store.read(".foltra/vault.json")?)?;
    if info.format_version != 1 {
        return Err(Error::new(
            "unsupported_format",
            "This vault needs a different Foltra version",
        ));
    }
    let vault_path = store
        .root
        .to_str()
        .ok_or_else(|| Error::new("invalid_path", "Vault paths must be UTF-8"))?;
    let mut result = json!({"path":vault_path,"vaultPath":vault_path});
    if let Some(note_id) = note_id {
        // Keep the input's managed path intact until Store has checked symlinks.
        notes::read_note(&store, note_id)?;
        let path = store.root.join(notes::note_path(note_id)?);
        result["path"] = json!(path);
        result["noteId"] = json!(note_id);
    }
    Ok(result)
}
