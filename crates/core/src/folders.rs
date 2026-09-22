use crate::{
    id, new_id,
    storage::{revision, Store},
    text,
    validation::*,
    Error, Folder, Result,
};
use serde_json::{json, Value};
use std::collections::HashSet;

pub fn path(folder_id: &str) -> Result<String> {
    Ok(format!("folders/{}.json", id(folder_id)?))
}
pub fn folders(store: &Store) -> Result<Vec<Folder>> {
    let mut folders = vec![];
    for file in store.files("folders", "json")? {
        let folder: Folder = serde_json::from_str(&store.read(&file)?)?;
        if path(&folder.id)? != file {
            return Err(Error::new(
                "invalid_folder",
                "Folder ID does not match filename",
            ));
        }
        folders.push(folder);
    }
    validate_tree(&folders)?;
    Ok(folders)
}
pub fn validate_tree(folders: &[Folder]) -> Result<()> {
    let mut names = HashSet::new();
    for folder in folders {
        id(&folder.id)?;
        nonempty(&folder.name, "Folder name")?;
        if !names.insert((&folder.parent_id, &folder.name)) {
            return Err(Error::new(
                "folder_exists",
                "A folder with this name already exists here",
            ));
        }
        let mut seen = HashSet::from([folder.id.as_str()]);
        let mut parent = folder.parent_id.as_deref();
        while let Some(parent_id) = parent {
            if !seen.insert(parent_id) {
                return Err(Error::new(
                    "invalid_folder",
                    "Folder hierarchy contains a cycle",
                ));
            }
            parent = folders
                .iter()
                .find(|f| f.id == parent_id)
                .ok_or_else(|| Error::new("invalid_folder", "Parent folder does not exist"))?
                .parent_id
                .as_deref();
        }
    }
    Ok(())
}
// Empty string denotes the vault root in command arguments.
pub fn destination(store: &Store, value: Option<&Value>) -> Result<Option<String>> {
    let Some(value) = value else { return Ok(None) };
    let value = value
        .as_str()
        .ok_or_else(|| Error::new("invalid_arguments", "Folder ID must be text"))?;
    if value.is_empty() {
        return Ok(None);
    }
    if !folders(store)?.iter().any(|f| f.id == value) {
        return Err(Error::new("not_found", "Folder does not exist"));
    }
    Ok(Some(value.into()))
}
pub fn list(store: &Store) -> Result<Value> {
    let values = folders(store)?
        .into_iter()
        .map(|folder| {
            let raw = store.read(&path(&folder.id)?)?;
            let mut value = serde_json::to_value(folder)?;
            value["revision"] = json!(revision(&raw));
            Ok(value)
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(json!(values))
}
pub fn create(store: &Store, args: &Value) -> Result<Value> {
    let folder = Folder {
        id: new_id(),
        name: nonempty(text(args, "name")?, "Folder name")?,
        parent_id: destination(store, args.get("parentId"))?,
    };
    let mut tree = folders(store)?;
    tree.push(folder.clone());
    validate_tree(&tree)?;
    let raw = pretty(&folder)?;
    store.commit(vec![(path(&folder.id)?, Some(raw.clone()))])?;
    let mut value = serde_json::to_value(folder)?;
    value["revision"] = json!(revision(&raw));
    Ok(value)
}
pub fn update(store: &Store, args: &Value) -> Result<Value> {
    let file = path(text(args, "id")?)?;
    let raw = store.read(&file)?;
    check_revision(text(args, "expectedRevision")?, &revision(&raw))?;
    let mut folder: Folder = serde_json::from_str(&raw)?;
    folder.name = nonempty(text(args, "name")?, "Folder name")?;
    if args.get("parentId").is_some() {
        folder.parent_id = destination(store, args.get("parentId"))?;
    }
    let mut tree = folders(store)?;
    tree.retain(|f| f.id != folder.id);
    tree.push(folder.clone());
    validate_tree(&tree)?;
    let raw = pretty(&folder)?;
    store.commit(vec![(file, Some(raw.clone()))])?;
    let mut value = serde_json::to_value(folder)?;
    value["revision"] = json!(revision(&raw));
    Ok(value)
}
