use crate::{
    attachments, database_lifecycle, databases, folder_lifecycle, folders, id,
    storage::Store,
    text, topic_order,
    validation::{check_revision, nonempty},
    Database, Error, Folder, Note, Record, Result, VaultInfo,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

pub(crate) type Snapshot = BTreeMap<String, Vec<u8>>;
const MAX_FILES: usize = 10_000;
const MAX_TOTAL_BYTES: usize = 128 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 16 * 1024 * 1024;

fn invalid(message: impl Into<String>) -> Error {
    Error::new("invalid_sync_snapshot", message)
}

fn source(bytes: &[u8]) -> Result<&str> {
    std::str::from_utf8(bytes).map_err(|_| invalid("Managed text must be UTF-8"))
}

fn check_size(files: usize, total: usize) -> Result<()> {
    if files > MAX_FILES || total > MAX_TOTAL_BYTES {
        return Err(Error::new(
            "file_too_large",
            "Sync snapshot exceeds 10,000 files or 128 MiB",
        ));
    }
    Ok(())
}

pub(crate) fn capture(store: &Store) -> Result<Snapshot> {
    let mut files = Snapshot::new();
    let mut total = 0;
    for (directory, extensions) in [
        ("notes", &["md"][..]),
        ("folders", &["json"][..]),
        ("databases", &["json"][..]),
        ("records", &["json"][..]),
        ("trash", &["json"][..]),
        ("attachments", &["png", "jpg", "gif", "webp"][..]),
    ] {
        for extension in extensions {
            for path in store.files(directory, extension)? {
                let limit = if directory == "attachments" {
                    attachments::MAX_BYTES
                } else {
                    MAX_TEXT_BYTES
                };
                let bytes = store.read_bytes(&path, limit)?;
                total += bytes.len();
                check_size(files.len() + 1, total)?;
                files.insert(path, bytes);
            }
        }
    }
    for path in [".foltra/vault.json", topic_order::PATH] {
        if let Some(raw) = store.optional(path)? {
            total += raw.len();
            check_size(files.len() + 1, total)?;
            files.insert(path.into(), raw.into_bytes());
        }
    }
    validate(&files)?;
    Ok(files)
}

fn metadata(files: &Snapshot) -> Result<VaultInfo> {
    let bytes = files
        .get(".foltra/vault.json")
        .ok_or_else(|| invalid("Vault metadata is missing"))?;
    let info: VaultInfo = serde_json::from_slice(bytes)?;
    id(&info.id)?;
    nonempty(&info.name, "Vault name")?;
    if info.format_version != 1 {
        return Err(Error::new("unsupported_format", "Unsupported vault format"));
    }
    Ok(info)
}

fn record_ids(record: &Record) -> Result<()> {
    id(&record.id)?;
    id(&record.database_id)?;
    if let Some(note) = &record.body_note_id {
        // Deleting a linked note intentionally leaves this ID available for later recreation.
        id(note)?;
    }
    Ok(())
}

fn validate_trash(item: &Value) -> Result<()> {
    id(text(item, "id")?)?;
    text(item, "title")?;
    text(item, "deletedAt")?;
    let original = text(item, "originalPath")?;
    let raw = text(item, "content")?;
    match text(item, "kind")? {
        "note" => {
            let note = Note::parse(raw)?;
            nonempty(&note.meta.title, "Note title")?;
            if let Some(folder) = &note.meta.folder_id {
                id(folder)?;
            }
            if original != format!("notes/{}.md", id(&note.meta.id)?) {
                return Err(invalid("Invalid note trash destination"));
            }
        }
        "record" => {
            let record: Record = serde_json::from_str(raw)?;
            record_ids(&record)?;
            if original != databases::record_path(&record.id)? {
                return Err(invalid("Invalid record trash destination"));
            }
            // Its database may itself have been deleted or changed since this row was trashed.
        }
        "database" => {
            for (path, raw) in database_lifecycle::restoration_files(item)? {
                if path.starts_with("records/") {
                    record_ids(&serde_json::from_str(&raw)?)?;
                }
            }
        }
        "folder" => {
            folder_lifecycle::validate_bundle(item)?;
        }
        _ => return Err(invalid("Unsupported trash item kind")),
    }
    Ok(())
}

pub(crate) fn validate(files: &Snapshot) -> Result<()> {
    check_size(files.len(), 0)?;
    let mut total = 0;
    let mut paths = BTreeSet::new();
    let mut notes = Vec::new();
    let mut tree = Vec::new();
    let mut schemas = BTreeMap::new();
    let mut rows = Vec::new();
    for (path, bytes) in files {
        total += bytes.len();
        check_size(files.len(), total)?;
        if !paths.insert(path.to_ascii_lowercase()) {
            return Err(invalid(
                "Sync paths collide on case-insensitive filesystems",
            ));
        }
        if path.starts_with("attachments/") {
            if bytes.len() > attachments::MAX_BYTES {
                return Err(Error::new("file_too_large", "Attachment exceeds 10 MiB"));
            }
            attachments::decode_entry(path, &STANDARD.encode(bytes))?;
            continue;
        }
        if bytes.len() > MAX_TEXT_BYTES {
            return Err(Error::new("file_too_large", "Managed text exceeds 16 MiB"));
        }
        let raw = source(bytes)?;
        let expected = if path == ".foltra/vault.json" {
            path.clone()
        } else if path == topic_order::PATH {
            topic_order::parse(raw)?;
            path.clone()
        } else if path.starts_with("notes/") {
            let note = Note::parse(raw)?;
            let expected = format!("notes/{}.md", id(&note.meta.id)?);
            nonempty(&note.meta.title, "Note title")?;
            if let Some(folder) = &note.meta.folder_id {
                id(folder)?;
            }
            notes.push(note);
            expected
        } else if path.starts_with("folders/") {
            let folder: Folder = serde_json::from_str(raw)?;
            let expected = folders::path(&folder.id)?;
            tree.push(folder);
            expected
        } else if path.starts_with("databases/") {
            let database: Database = serde_json::from_str(raw)?;
            database_lifecycle::validate_database(&database)?;
            let expected = databases::database_path(&database.id)?;
            schemas.insert(database.id.clone(), database);
            expected
        } else if path.starts_with("records/") {
            let record: Record = serde_json::from_str(raw)?;
            record_ids(&record)?;
            let expected = databases::record_path(&record.id)?;
            rows.push(record);
            expected
        } else if path.starts_with("trash/") {
            let item: Value = serde_json::from_str(raw)?;
            validate_trash(&item)?;
            format!("trash/{}.json", text(&item, "id")?)
        } else {
            return Err(invalid(format!("Unsupported sync path: {path}")));
        };
        if path != &expected {
            return Err(invalid(format!(
                "Content ID does not match sync path: {path}"
            )));
        }
    }
    metadata(files)?;
    folders::validate_tree(&tree)?;
    let folder_ids: BTreeSet<_> = tree.iter().map(|folder| folder.id.as_str()).collect();
    for note in notes {
        if note
            .meta
            .folder_id
            .as_ref()
            .is_some_and(|folder| !folder_ids.contains(folder.as_str()))
        {
            return Err(invalid("Note folder does not exist"));
        }
    }
    for record in rows {
        let database = schemas
            .get(&record.database_id)
            .ok_or_else(|| invalid("Record database does not exist"))?;
        databases::validate_values(database, &record.values)?;
    }
    Ok(())
}

pub(crate) fn revision(files: &Snapshot) -> String {
    let mut digest = Sha256::new();
    for (path, bytes) in files {
        // Length framing prevents ambiguous path/content concatenation; BTreeMap fixes ordering.
        digest.update((path.len() as u64).to_be_bytes());
        digest.update(path.as_bytes());
        digest.update((bytes.len() as u64).to_be_bytes());
        digest.update(bytes);
    }
    format!("{:x}", digest.finalize())
}

pub(crate) fn apply(store: &Store, expected: &str, candidate: &Snapshot) -> Result<()> {
    let current = capture(store)?;
    check_revision(expected, &revision(&current))?;
    validate(candidate)?;
    if metadata(&current)?.id != metadata(candidate)?.id
        && current.keys().any(|path| !path.starts_with(".foltra/"))
    {
        return Err(invalid("Sync cannot replace this vault's identity"));
    }
    let mut writes = Vec::new();
    let mut binaries = Vec::new();
    for (path, bytes) in &current {
        if path.starts_with("attachments/") {
            if candidate.get(path) != Some(bytes) {
                return Err(invalid(
                    "Managed attachments cannot be removed or changed by sync",
                ));
            }
        } else if !candidate.contains_key(path) {
            writes.push((path.clone(), None));
        }
    }
    for (path, bytes) in candidate {
        if current.get(path) == Some(bytes) {
            continue;
        }
        if path.starts_with("attachments/") {
            binaries.push((path.clone(), bytes.clone()));
        } else {
            writes.push((path.clone(), Some(source(bytes)?.into())));
        }
    }
    if !writes.is_empty() || !binaries.is_empty() {
        store.commit_with_binary(writes, binaries)?;
    }
    Ok(())
}

#[derive(Debug)]
pub(crate) struct MergeResult {
    // Conflicting entries retain a side for inspection; do not apply until conflicts are resolved.
    pub files: Snapshot,
    pub conflicts: Vec<String>,
}

pub(crate) fn merge(base: Option<&Snapshot>, local: &Snapshot, remote: &Snapshot) -> MergeResult {
    let paths: BTreeSet<_> = local
        .keys()
        .chain(remote.keys())
        .chain(base.into_iter().flat_map(|files| files.keys()))
        .collect();
    let mut result = MergeResult {
        files: Snapshot::new(),
        conflicts: Vec::new(),
    };
    for path in paths {
        let before = base.and_then(|files| files.get(path));
        let ours = local.get(path);
        let theirs = remote.get(path);
        let mut conflict = false;
        let selected = if path.starts_with("attachments/") {
            let available: Vec<_> = [before, ours, theirs].into_iter().flatten().collect();
            conflict = available.windows(2).any(|pair| pair[0] != pair[1]);
            ours.or(theirs).or(before)
        } else if ours == theirs {
            ours
        } else if base.is_none() && (ours.is_none() || theirs.is_none()) {
            ours.or(theirs)
        } else if base.is_some() && ours == before {
            theirs
        } else if base.is_some() && theirs == before {
            ours
        } else {
            conflict = true;
            ours.or(theirs)
        };
        if conflict {
            result.conflicts.push(path.clone());
        }
        if let Some(bytes) = selected {
            result.files.insert(path.clone(), bytes.clone());
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{execute, new_id};
    use serde_json::json;

    fn setup() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        execute(
            dir.path().to_str().unwrap(),
            "vault.init",
            json!({"name":"Sync test"}),
        )
        .unwrap();
        dir
    }

    fn call(dir: &tempfile::TempDir, command: &str, args: Value) -> Value {
        execute(dir.path().to_str().unwrap(), command, args).unwrap()
    }

    fn snapshot(dir: &tempfile::TempDir) -> Snapshot {
        capture(&Store::open(dir.path().to_str().unwrap(), false).unwrap()).unwrap()
    }

    fn map(entries: &[(&str, &str)]) -> Snapshot {
        entries
            .iter()
            .map(|(path, raw)| (path.to_string(), raw.as_bytes().to_vec()))
            .collect()
    }

    fn replace_json(files: &mut Snapshot, path: &str, change: impl FnOnce(&mut Value)) {
        let mut value: Value = serde_json::from_slice(&files[path]).unwrap();
        change(&mut value);
        files.insert(path.into(), serde_json::to_vec(&value).unwrap());
    }

    fn image() -> (String, Vec<u8>) {
        let bytes = STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=").unwrap();
        let path = format!("attachments/{:x}.png", Sha256::digest(&bytes));
        (path, bytes)
    }

    #[test]
    fn merge_independent_edits_deletions_and_first_connection_absence() {
        let base = map(&[("a", "before"), ("b", "before"), ("gone", "before")]);
        let local = map(&[("a", "local"), ("b", "before"), ("new", "local")]);
        let remote = map(&[("a", "before"), ("b", "remote"), ("gone", "before")]);
        let merged = merge(Some(&base), &local, &remote);
        assert!(merged.conflicts.is_empty());
        assert_eq!(
            merged.files,
            map(&[("a", "local"), ("b", "remote"), ("new", "local")])
        );
        let first = merge(None, &map(&[("a", "local")]), &map(&[("b", "remote")]));
        assert!(first.conflicts.is_empty());
        assert_eq!(first.files.len(), 2);
    }

    #[test]
    fn divergent_edits_and_delete_edit_conflict_without_silent_choice() {
        let base = map(&[("a", "before"), ("b", "before"), ("c", "before")]);
        let local = map(&[("a", "local"), ("c", "local")]);
        let remote = map(&[("a", "remote"), ("b", "remote")]);
        assert_eq!(
            merge(Some(&base), &local, &remote).conflicts,
            ["a", "b", "c"]
        );
        assert_eq!(
            merge(None, &map(&[("a", "local")]), &map(&[("a", "remote")])).conflicts,
            ["a"]
        );
        assert!(merge(Some(&base), &local, &local).conflicts.is_empty());
    }

    #[test]
    fn attachments_are_immutable_union_even_when_deleted_from_both_sides() {
        let base = map(&[("attachments/a.png", "image")]);
        let result = merge(Some(&base), &Snapshot::new(), &Snapshot::new());
        assert_eq!(result.files, base);
        assert!(result.conflicts.is_empty());
        assert_eq!(
            merge(
                Some(&base),
                &base,
                &map(&[("attachments/a.png", "changed")])
            )
            .conflicts,
            ["attachments/a.png"]
        );
    }

    #[test]
    fn captures_only_managed_sync_data_and_revision_ignores_local_state() {
        let dir = setup();
        call(
            &dir,
            "note.create",
            json!({"title":"Keep","body":"Original"}),
        );
        let before = snapshot(&dir);
        for path in [
            ".foltra/settings.json",
            "extensions/example.json",
            "plugin-data/example.json",
            ".foltra/local/sync.json",
            ".foltra/cache/derived.json",
        ] {
            let path = dir.path().join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "local-only").unwrap();
        }
        assert_eq!(snapshot(&dir), before);
        assert_eq!(revision(&snapshot(&dir)), revision(&before));
        let mut changed = before.clone();
        changed.insert("new".into(), vec![1]);
        assert_ne!(revision(&before), revision(&changed));
        assert_ne!(
            revision(&map(&[("a", "bc")])),
            revision(&map(&[("ab", "c")]))
        );
    }

    #[test]
    fn rejects_unsupported_paths_wrong_ids_invalid_utf8_and_attachment_hashes() {
        let dir = setup();
        let note = call(
            &dir,
            "note.create",
            json!({"title":"Keep","body":"Original"}),
        );
        let good = snapshot(&dir);
        let note_path = format!("notes/{}.md", note["id"].as_str().unwrap());
        for path in [
            "../escape",
            ".foltra/settings.json",
            ".git/config",
            "extensions/unsafe.json",
            "notes/../escape.md",
            "notes/nested/note.md",
        ] {
            let mut bad = good.clone();
            bad.insert(path.into(), good[&note_path].clone());
            assert!(validate(&bad).is_err(), "{path}");
        }
        let mut bad = good.clone();
        bad.insert(format!("notes/{}.md", new_id()), good[&note_path].clone());
        assert!(validate(&bad).is_err());
        let mut bad = good.clone();
        bad.insert(note_path, vec![255]);
        assert!(validate(&bad).is_err());
        let (path, bytes) = image();
        let mut valid = good.clone();
        valid.insert(path.clone(), bytes);
        validate(&valid).unwrap();
        valid.insert(path, b"not an image".to_vec());
        assert!(validate(&valid).is_err());
    }

    #[test]
    fn rejects_semantically_invalid_schema_row_merge_before_any_write() {
        let dir = setup();
        let database = call(&dir, "database.create", json!({"name":"Data"}));
        let row = call(
            &dir,
            "record.create",
            json!({"databaseId":database["id"],"values":{"title":"One"}}),
        );
        let base = snapshot(&dir);
        let schema_path = format!("databases/{}.json", database["id"].as_str().unwrap());
        let row_path = format!("records/{}.json", row["id"].as_str().unwrap());
        let mut local = base.clone();
        replace_json(&mut local, &schema_path, |value| {
            value["properties"]
                .as_array_mut()
                .unwrap()
                .retain(|p| p["id"] != "status")
        });
        let mut remote = base.clone();
        replace_json(&mut remote, &row_path, |value| {
            value["values"]["status"] = json!("Done")
        });
        validate(&local).unwrap();
        validate(&remote).unwrap();
        let merged = merge(Some(&base), &local, &remote);
        assert!(merged.conflicts.is_empty());
        assert!(validate(&merged.files).is_err());
        let store = Store::open(dir.path().to_str().unwrap(), false).unwrap();
        assert!(apply(&store, &revision(&base), &merged.files).is_err());
        assert_eq!(capture(&store).unwrap(), base);
        assert!(!store.root.join(".foltra/local/pending.json").exists());
    }

    #[test]
    fn missing_database_folder_cycle_and_missing_note_folder_fail_but_dangling_body_is_valid() {
        let dir = setup();
        let folder = call(&dir, "folder.create", json!({"name":"Folder"}));
        let note = call(
            &dir,
            "note.create",
            json!({"title":"Keep","body":"Original","folderId":folder["id"]}),
        );
        let database = call(&dir, "database.create", json!({"name":"Data"}));
        let row = call(
            &dir,
            "record.create",
            json!({"databaseId":database["id"],"values":{}}),
        );
        let mut good = snapshot(&dir);
        let row_path = format!("records/{}.json", row["id"].as_str().unwrap());
        replace_json(&mut good, &row_path, |value| {
            value["bodyNoteId"] = json!(new_id())
        });
        validate(&good).unwrap();
        for path in [
            format!("databases/{}.json", database["id"].as_str().unwrap()),
            format!("folders/{}.json", folder["id"].as_str().unwrap()),
        ] {
            let mut bad = good.clone();
            bad.remove(&path);
            assert!(validate(&bad).is_err());
        }
        let mut cycle = good.clone();
        replace_json(
            &mut cycle,
            &format!("folders/{}.json", folder["id"].as_str().unwrap()),
            |value| value["parentId"] = folder["id"].clone(),
        );
        assert!(validate(&cycle).is_err());
        let mut bad = good;
        replace_json(&mut bad, &row_path, |value| {
            value["bodyNoteId"] = json!("not-a-uuid")
        });
        assert!(validate(&bad).is_err());
        assert_eq!(call(&dir, "note.read", json!({"id":note["id"]})), note);
    }

    #[test]
    fn stale_apply_preserves_new_local_edits_and_unchanged_apply_does_not_write() {
        let dir = setup();
        let note = call(&dir, "note.create", json!({"title":"Keep","body":"Before"}));
        let before = snapshot(&dir);
        call(
            &dir,
            "note.update",
            json!({"id":note["id"],"expectedRevision":note["revision"],"body":"Fresh local edit"}),
        );
        let store = Store::open(dir.path().to_str().unwrap(), false).unwrap();
        let fresh = capture(&store).unwrap();
        assert_eq!(
            apply(&store, &revision(&before), &before).unwrap_err().code,
            "conflict"
        );
        assert_eq!(capture(&store).unwrap(), fresh);
        let note_path = store
            .root
            .join(format!("notes/{}.md", note["id"].as_str().unwrap()));
        let modified = std::fs::metadata(&note_path).unwrap().modified().unwrap();
        apply(&store, &revision(&fresh), &fresh).unwrap();
        assert_eq!(
            std::fs::metadata(note_path).unwrap().modified().unwrap(),
            modified
        );
        assert!(!store.root.join(".foltra/local/pending.json").exists());
    }

    #[test]
    fn bootstrap_can_adopt_identity_only_while_the_captured_vault_is_empty() {
        let source = setup();
        call(
            &source,
            "note.create",
            json!({"title":"Remote note","body":"Keep"}),
        );
        let incoming = snapshot(&source);
        let destination = setup();
        call(&destination, "settings.update", json!({"vim":true}));
        let settings = std::fs::read(destination.path().join(".foltra/settings.json")).unwrap();
        let initial = snapshot(&destination);
        {
            let store = Store::open(destination.path().to_str().unwrap(), false).unwrap();
            apply(&store, &revision(&initial), &incoming).unwrap();
            assert_eq!(capture(&store).unwrap(), incoming);
            assert_eq!(
                std::fs::read(store.root.join(".foltra/settings.json")).unwrap(),
                settings
            );
        }
        let racing = setup();
        let before = snapshot(&racing);
        call(
            &racing,
            "note.create",
            json!({"title":"Fresh local note","body":"Keep"}),
        );
        let store = Store::open(racing.path().to_str().unwrap(), false).unwrap();
        let current = capture(&store).unwrap();
        assert_eq!(
            apply(&store, &revision(&before), &incoming)
                .unwrap_err()
                .code,
            "conflict"
        );
        assert!(apply(&store, &revision(&current), &incoming).is_err());
        assert_eq!(capture(&store).unwrap(), current);
    }

    #[test]
    fn applies_raw_notes_deletion_and_new_images_without_changing_local_settings() {
        let dir = setup();
        let note = call(
            &dir,
            "note.create",
            json!({"title":"Delete","body":"Before"}),
        );
        call(&dir, "settings.update", json!({"vim":true}));
        let settings = std::fs::read(dir.path().join(".foltra/settings.json")).unwrap();
        let store = Store::open(dir.path().to_str().unwrap(), false).unwrap();
        let before = capture(&store).unwrap();
        let mut candidate = before.clone();
        candidate.remove(&format!("notes/{}.md", note["id"].as_str().unwrap()));
        let raw = format!("---\n{{\"id\":\"{}\",\"title\":\"New\",\"createdAt\":\"now\",\"updatedAt\":\"now\",\"future\":42}}\n---\n\nExact body  \n", new_id());
        let parsed = Note::parse(&raw).unwrap();
        candidate.insert(format!("notes/{}.md", parsed.meta.id), raw.into_bytes());
        let (image_path, bytes) = image();
        candidate.insert(image_path.clone(), bytes);
        apply(&store, &revision(&before), &candidate).unwrap();
        assert_eq!(capture(&store).unwrap(), candidate);
        assert_eq!(
            std::fs::read(store.root.join(".foltra/settings.json")).unwrap(),
            settings
        );
        let mut without_image = candidate.clone();
        without_image.remove(&image_path);
        assert!(apply(&store, &revision(&candidate), &without_image).is_err());
        let mut wrong_vault = candidate.clone();
        replace_json(&mut wrong_vault, ".foltra/vault.json", |value| {
            value["id"] = json!(new_id())
        });
        assert!(apply(&store, &revision(&candidate), &wrong_vault).is_err());
        assert_eq!(capture(&store).unwrap(), candidate);
    }

    #[test]
    fn captures_all_existing_trash_kinds_and_rejects_changed_restore_paths() {
        let dir = setup();
        let folder = call(&dir, "folder.create", json!({"name":"Folder"}));
        call(
            &dir,
            "note.create",
            json!({"title":"In folder","body":"Keep","folderId":folder["id"]}),
        );
        let folder_revision = call(&dir, "folder.inspect", json!({"id":folder["id"]}));
        call(
            &dir,
            "folder.delete",
            json!({"id":folder["id"],"expectedRevision":folder_revision["revision"]}),
        );
        let note = call(&dir, "note.create", json!({"title":"Note","body":"Keep"}));
        call(
            &dir,
            "note.delete",
            json!({"id":note["id"],"expectedRevision":note["revision"]}),
        );
        let database = call(&dir, "database.create", json!({"name":"Data"}));
        let row = call(
            &dir,
            "record.create",
            json!({"databaseId":database["id"],"values":{}}),
        );
        call(
            &dir,
            "record.delete",
            json!({"id":row["id"],"expectedRevision":row["revision"]}),
        );
        let db_revision = call(&dir, "database.inspect", json!({"id":database["id"]}));
        call(
            &dir,
            "database.delete",
            json!({"id":database["id"],"expectedRevision":db_revision["revision"]}),
        );
        let good = snapshot(&dir);
        let trash: Vec<_> = good
            .keys()
            .filter(|path| path.starts_with("trash/"))
            .cloned()
            .collect();
        assert_eq!(trash.len(), 4);
        for path in trash {
            let mut bad = good.clone();
            replace_json(&mut bad, &path, |value| {
                value["originalPath"] = json!(".foltra/settings.json")
            });
            assert!(validate(&bad).is_err());
        }
    }

    #[cfg(unix)]
    #[test]
    fn capture_rejects_symlinks_to_managed_files() {
        let dir = setup();
        let outside = tempfile::NamedTempFile::new().unwrap();
        std::fs::create_dir(dir.path().join("notes")).unwrap();
        std::os::unix::fs::symlink(
            outside.path(),
            dir.path().join(format!("notes/{}.md", new_id())),
        )
        .unwrap();
        assert_eq!(
            capture(&Store::open(dir.path().to_str().unwrap(), false).unwrap())
                .unwrap_err()
                .code,
            "unsafe_path"
        );
    }
}
