use crate::{
    folders,
    notes::{note_path, plan_note_batch},
    storage::{revision, Store},
    validation::{check_revision, nonempty, pretty},
    *,
};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};

struct Snapshot {
    root: Folder,
    folders: Vec<(String, String)>,
    notes: Vec<(String, String)>,
    targets: Vec<NoteMeta>,
    revision: String,
}

fn snapshot(store: &Store, folder_id: &str) -> Result<Snapshot> {
    let tree = folders::folders(store)?;
    let root = tree
        .iter()
        .find(|folder| folder.id == folder_id)
        .ok_or_else(|| Error::new("not_found", "Folder does not exist"))?
        .clone();
    let mut ids = HashSet::from([root.id.clone()]);
    loop {
        let previous = ids.len();
        for folder in &tree {
            if folder
                .parent_id
                .as_ref()
                .is_some_and(|parent| ids.contains(parent))
            {
                ids.insert(folder.id.clone());
            }
        }
        if previous == ids.len() {
            break;
        }
    }
    let mut folders = vec![];
    for folder in tree.iter().filter(|folder| ids.contains(&folder.id)) {
        let path = folders::path(&folder.id)?;
        folders.push((path.clone(), store.read(&path)?));
    }
    let mut notes = vec![];
    let mut targets = vec![];
    for path in store.files("notes", "md")? {
        let raw = store.read(&path)?;
        let note = Note::parse(&raw)?;
        if note_path(&note.meta.id)? != path {
            return Err(Error::new(
                "invalid_note",
                "Note ID does not match filename",
            ));
        }
        if note
            .meta
            .folder_id
            .as_ref()
            .is_some_and(|folder| ids.contains(folder))
        {
            notes.push((path, raw));
        }
        targets.push(note.meta);
    }
    let revision = if folders.len() == 1 && notes.is_empty() {
        // Existing callers may still hold the raw revision for an empty folder.
        revision(&folders[0].1)
    } else {
        let revisions: Vec<_> = folders
            .iter()
            .chain(&notes)
            .map(|(path, raw)| (path, revision(raw)))
            .collect();
        revision(&serde_json::to_string(&revisions)?)
    };
    Ok(Snapshot {
        root,
        folders,
        notes,
        targets,
        revision,
    })
}

pub fn inspect(store: &Store, args: &Value) -> Result<Value> {
    let snapshot = snapshot(store, text(args, "id")?)?;
    let path = folders::path(&snapshot.root.id)?;
    let raw = &snapshot
        .folders
        .iter()
        .find(|(file, _)| file == &path)
        .unwrap()
        .1;
    let mut folder = serde_json::to_value(&snapshot.root)?;
    folder["revision"] = json!(revision(raw));
    Ok(
        json!({"folder":folder,"revision":snapshot.revision,"folderCount":snapshot.folders.len()-1,"noteCount":snapshot.notes.len()}),
    )
}

pub fn delete(store: &Store, args: &Value) -> Result<Value> {
    let snapshot = snapshot(store, text(args, "id")?)?;
    check_revision(text(args, "expectedRevision")?, &snapshot.revision)?;
    let original = folders::path(&snapshot.root.id)?;
    let content = &snapshot
        .folders
        .iter()
        .find(|(path, _)| path == &original)
        .unwrap()
        .1;
    let children: Vec<_> = snapshot
        .folders
        .iter()
        .filter(|(path, _)| path != &original)
        .map(|(path, content)| json!({"originalPath":path,"content":content}))
        .collect();
    let notes: Vec<_> = snapshot
        .notes
        .iter()
        .map(|(path, content)| json!({"originalPath":path,"content":content}))
        .collect();
    let trash_id = new_id();
    let item = json!({"id":trash_id,"kind":"folder","title":snapshot.root.name,"deletedAt":now(),
        "originalPath":original,"content":content,"folders":children,"notes":notes,
        "folderCount":children.len(),"noteCount":notes.len(),"linkTargets":snapshot.targets});
    let raw = pretty(&item)?;
    if raw.len() > 16 * 1024 * 1024 {
        return Err(Error::new(
            "file_too_large",
            "Folder trash bundle exceeds 16 MiB; no data was deleted",
        ));
    }
    let deleted = snapshot
        .notes
        .iter()
        .map(|(_, raw)| Ok(Note::parse(raw)?.meta.id))
        .collect::<Result<Vec<_>>>()?;
    let mut writes = plan_note_batch(store, &[], &deleted, None)?;
    writes.extend(snapshot.folders.into_iter().map(|(path, _)| (path, None)));
    writes.push((format!("trash/{trash_id}.json"), Some(raw)));
    store.commit(writes)?;
    Ok(json!({"deleted":snapshot.root.id,"trashId":trash_id}))
}

pub(crate) struct Bundle {
    root: Folder,
    folders: Vec<Folder>,
    notes: Vec<Note>,
    targets: Vec<Note>,
    files: BTreeMap<String, String>,
}

// Validate a self-contained subtree before either restoring it or importing its backup.
pub(crate) fn validate_bundle(item: &Value) -> Result<Bundle> {
    let content = text(item, "content")?;
    let root: Folder = serde_json::from_str(content)?;
    let original = text(item, "originalPath")?;
    if folders::path(&root.id)? != original {
        return Err(Error::new(
            "invalid_path",
            "Invalid folder trash destination",
        ));
    }
    let children = item["folders"]
        .as_array()
        .ok_or_else(|| Error::new("invalid_data", "Folder trash folders must be an array"))?;
    let entries = item["notes"]
        .as_array()
        .ok_or_else(|| Error::new("invalid_data", "Folder trash notes must be an array"))?;
    if item["folderCount"].as_u64() != Some(children.len() as u64)
        || item["noteCount"].as_u64() != Some(entries.len() as u64)
    {
        return Err(Error::new(
            "invalid_data",
            "Folder trash counts do not match",
        ));
    }
    let mut files = BTreeMap::from([(original.into(), content.into())]);
    let mut folders = vec![root.clone()];
    let mut ids = HashSet::from([root.id.clone()]);
    for entry in children {
        let content = text(entry, "content")?;
        let folder: Folder = serde_json::from_str(content)?;
        let path = text(entry, "originalPath")?;
        if folders::path(&folder.id)? != path || !ids.insert(folder.id.clone()) {
            return Err(Error::new(
                "invalid_data",
                "Invalid or duplicate folder trash path",
            ));
        }
        files.insert(path.into(), content.into());
        folders.push(folder);
    }
    if root
        .parent_id
        .as_ref()
        .is_some_and(|parent| ids.contains(parent))
    {
        return Err(Error::new(
            "invalid_folder",
            "Folder trash root cannot have an internal parent",
        ));
    }
    if let Some(parent) = &root.parent_id {
        id(parent)?;
    }
    for folder in &folders[1..] {
        if folder
            .parent_id
            .as_ref()
            .is_none_or(|parent| !ids.contains(parent))
        {
            return Err(Error::new(
                "invalid_folder",
                "Folder trash child must belong to the subtree",
            ));
        }
    }
    let mut detached = folders.clone();
    detached[0].parent_id = None;
    folders::validate_tree(&detached)?;
    let mut notes = vec![];
    for entry in entries {
        let content = text(entry, "content")?;
        let note = Note::parse(content)?;
        let path = text(entry, "originalPath")?;
        if note_path(&note.meta.id)? != path
            || note
                .meta
                .folder_id
                .as_ref()
                .is_none_or(|folder| !ids.contains(folder))
            || files.contains_key(path)
        {
            return Err(Error::new(
                "invalid_data",
                "Invalid folder trash note ownership or path",
            ));
        }
        nonempty(&note.meta.title, "Note title")?;
        files.insert(path.into(), content.into());
        notes.push(note);
    }
    let metadata: Vec<NoteMeta> = serde_json::from_value(item["linkTargets"].clone())?;
    let mut target_ids = HashSet::new();
    let mut targets = vec![];
    for meta in metadata {
        id(&meta.id)?;
        nonempty(&meta.title, "Link target title")?;
        if !target_ids.insert(meta.id.clone()) {
            return Err(Error::new(
                "invalid_data",
                "Duplicate folder trash link target",
            ));
        }
        targets.push(Note {
            meta,
            body: String::new(),
            revision: String::new(),
        });
    }
    for note in &notes {
        if !targets
            .iter()
            .any(|target| target.meta.id == note.meta.id && target.meta.title == note.meta.title)
        {
            return Err(Error::new(
                "invalid_data",
                "Folder trash link targets omit a deleted note",
            ));
        }
    }
    Ok(Bundle {
        root,
        folders,
        notes,
        targets,
        files,
    })
}

pub(crate) fn restore(store: &Store, item: &Value, trash_path: &str) -> Result<Value> {
    let mut bundle = validate_bundle(item)?;
    for path in bundle.files.keys() {
        if store.optional(path)?.is_some() {
            return Err(Error::new(
                "conflict",
                "A folder or note destination already exists",
            ));
        }
    }
    let mut tree = folders::folders(store)?;
    let missing_parent = bundle
        .root
        .parent_id
        .as_ref()
        .is_some_and(|parent| !tree.iter().any(|folder| &folder.id == parent));
    if missing_parent {
        bundle.folders[0].parent_id = None;
        bundle
            .files
            .insert(folders::path(&bundle.root.id)?, pretty(&bundle.folders[0])?);
    }
    tree.extend(bundle.folders);
    // Also catches same-name siblings at the original parent or the fallback vault root.
    folders::validate_tree(&tree)?;
    let canonical: BTreeMap<_, _> = bundle
        .notes
        .iter()
        .map(|note| {
            Ok((
                note_path(&note.meta.id)?,
                Note::encode(&note.meta, &note.body)?,
            ))
        })
        .collect::<Result<_>>()?;
    let mut writes: BTreeMap<String, Option<String>> = bundle
        .files
        .into_iter()
        .map(|(path, content)| (path, Some(content)))
        .collect();
    for (path, content) in plan_note_batch(store, &bundle.notes, &[], Some(&bundle.targets))? {
        // Keep exact raw metadata/body when link reconciliation does not change this note.
        if content
            .as_ref()
            .is_some_and(|raw| canonical.get(&path) == Some(raw))
        {
            continue;
        }
        writes.insert(path, content);
    }
    writes.insert(trash_path.into(), None);
    store.commit(writes.into_iter().collect())?;
    Ok(json!({"restored":item["originalPath"],"restoredAtRoot":missing_parent}))
}
