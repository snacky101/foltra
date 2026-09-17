use crate::{
    databases::{database_path, record_path, validate_property, validate_values},
    storage::{revision, Store},
    validation::{check_revision, nonempty, pretty},
    *,
};
use serde_json::{json, Value};
use std::collections::HashSet;

struct Snapshot {
    database: Database,
    schema: String,
    records: Vec<(String, String)>,
    revision: String,
}

fn validate_database(database: &Database) -> Result<()> {
    id(&database.id)?;
    nonempty(&database.name, "Database name")?;
    if database.properties.is_empty() || database.properties.len() > 100 {
        return Err(Error::new(
            "invalid_schema",
            "A database needs 1–100 properties",
        ));
    }
    let mut ids = HashSet::new();
    for property in &database.properties {
        validate_property(property)?;
        if !ids.insert(&property.id) {
            return Err(Error::new("invalid_schema", "Duplicate property ID"));
        }
    }
    Ok(())
}

fn snapshot(store: &Store, database_id: &str) -> Result<Snapshot> {
    let schema = store.read(&database_path(database_id)?)?;
    let database: Database = serde_json::from_str(&schema)?;
    if database.id != database_id {
        return Err(Error::new(
            "invalid_data",
            "Database ID does not match filename",
        ));
    }
    validate_database(&database)?;
    let mut records = vec![];
    // Store::files is sorted, and each original is read once while holding the vault lock.
    for path in store.files("records", "json")? {
        let content = store.read(&path)?;
        let record: Record = serde_json::from_str(&content)?;
        if record_path(&record.id)? != path {
            return Err(Error::new(
                "invalid_data",
                "Record ID does not match filename",
            ));
        }
        if record.database_id == database_id {
            validate_values(&database, &record.values)?;
            records.push((path, content));
        }
    }
    let row_revisions: Vec<_> = records
        .iter()
        .map(|(path, content)| (path, revision(content)))
        .collect();
    let revision = revision(&serde_json::to_string(&(&schema, row_revisions))?);
    Ok(Snapshot {
        database,
        schema,
        records,
        revision,
    })
}

pub fn inspect(store: &Store, args: &Value) -> Result<Value> {
    let snapshot = snapshot(store, text(args, "id")?)?;
    Ok(
        json!({"database":snapshot.database,"revision":snapshot.revision,"recordCount":snapshot.records.len()}),
    )
}

pub fn rename(store: &Store, args: &Value) -> Result<Value> {
    let mut snapshot = snapshot(store, text(args, "id")?)?;
    check_revision(text(args, "expectedRevision")?, &snapshot.revision)?;
    snapshot.database.name = nonempty(text(args, "name")?, "Database name")?;
    // Preserve unknown schema fields, and leave records and linked notes byte-for-byte intact.
    let mut schema: Value = serde_json::from_str(&snapshot.schema)?;
    schema["name"] = json!(snapshot.database.name);
    store.commit(vec![(
        database_path(&snapshot.database.id)?,
        Some(pretty(&schema)?),
    )])?;
    Ok(serde_json::to_value(snapshot.database)?)
}

pub fn delete(store: &Store, args: &Value) -> Result<Value> {
    let snapshot = snapshot(store, text(args, "id")?)?;
    check_revision(text(args, "expectedRevision")?, &snapshot.revision)?;
    let original = database_path(&snapshot.database.id)?;
    let trash_id = new_id();
    let records: Vec<_> = snapshot
        .records
        .iter()
        .map(|(path, content)| json!({"originalPath":path,"content":content}))
        .collect();
    let item = json!({
        "id":trash_id,"kind":"database","title":snapshot.database.name,"deletedAt":now(),
        "originalPath":original,"content":snapshot.schema,
        "recordCount":records.len(),"records":records
    });
    let raw = pretty(&item)?;
    // A bundle must remain readable under the same managed-file limit after deletion.
    if raw.len() > 16 * 1024 * 1024 {
        return Err(Error::new(
            "file_too_large",
            "Database trash bundle exceeds 16 MiB; no data was deleted",
        ));
    }
    let mut writes = vec![
        (format!("trash/{trash_id}.json"), Some(raw)),
        (original, None),
    ];
    writes.extend(snapshot.records.into_iter().map(|(path, _)| (path, None)));
    store.commit(writes)?;
    Ok(json!({"deleted":snapshot.database.id,"trashId":trash_id}))
}

// Shared by restore and backup import: only this schema and its own managed rows are writable.
pub(crate) fn restoration_files(item: &Value) -> Result<Vec<(String, String)>> {
    let content = text(item, "content")?;
    let database: Database = serde_json::from_str(content)?;
    validate_database(&database)?;
    let original = text(item, "originalPath")?;
    if database_path(&database.id)? != original {
        return Err(Error::new(
            "invalid_path",
            "Invalid database trash destination",
        ));
    }
    let records = item["records"]
        .as_array()
        .ok_or_else(|| Error::new("invalid_data", "Database trash records must be an array"))?;
    if item["recordCount"].as_u64() != Some(records.len() as u64) {
        return Err(Error::new(
            "invalid_data",
            "Database trash record count does not match",
        ));
    }
    let mut files = vec![(original.into(), content.into())];
    let mut ids = HashSet::new();
    for entry in records {
        let content = text(entry, "content")?;
        let record: Record = serde_json::from_str(content)?;
        let path = text(entry, "originalPath")?;
        if record_path(&record.id)? != path || record.database_id != database.id {
            return Err(Error::new(
                "invalid_data",
                "Invalid database trash record ownership or path",
            ));
        }
        if !ids.insert(record.id.clone()) {
            return Err(Error::new(
                "invalid_data",
                "Duplicate database trash record",
            ));
        }
        validate_values(&database, &record.values)?;
        files.push((path.into(), content.into()));
    }
    Ok(files)
}

pub(crate) fn restore(store: &Store, item: &Value, trash_path: &str) -> Result<Value> {
    let files = restoration_files(item)?;
    for (path, _) in &files {
        if store.optional(path)?.is_some() {
            return Err(Error::new(
                "conflict",
                "A database or record destination already exists",
            ));
        }
    }
    let mut writes: Vec<_> = files
        .into_iter()
        .map(|(path, content)| (path, Some(content)))
        .collect();
    writes.push((trash_path.into(), None));
    store.commit(writes)?;
    Ok(json!({"restored":item["originalPath"]}))
}
