use crate::{id, new_id, now, text, Database, Error, Note, NoteMeta, Property, Record, Result};
use crate::{
    notes::{note_path, plan_note_write, read_note},
    storage::{revision, Store},
    validation::*,
};
use serde_json::{json, Map, Value};

pub(crate) fn record_path(record_id: &str) -> Result<String> {
    Ok(format!("records/{}.json", id(record_id)?))
}

pub(crate) fn database_path(database_id: &str) -> Result<String> {
    Ok(format!("databases/{}.json", id(database_id)?))
}

pub fn databases(store: &Store) -> Result<Vec<Database>> {
    store
        .files("databases", "json")?
        .iter()
        .map(|p| {
            let db: Database = serde_json::from_str(&store.read(p)?)?;
            if database_path(&db.id)? != *p {
                return Err(Error::new(
                    "invalid_data",
                    "Database ID does not match filename",
                ));
            }
            Ok(db)
        })
        .collect()
}

pub fn read_database(store: &Store, database_id: &str) -> Result<Database> {
    Ok(serde_json::from_str(
        &store.read(&database_path(database_id)?)?,
    )?)
}

pub fn records(store: &Store) -> Result<Vec<Record>> {
    store
        .files("records", "json")?
        .iter()
        .map(|p| {
            let record: Record = serde_json::from_str(&store.read(p)?)?;
            if record_path(&record.id)? != *p {
                return Err(Error::new(
                    "invalid_data",
                    "Record ID does not match filename",
                ));
            }
            Ok(record)
        })
        .collect()
}

fn read_record(store: &Store, record_id: &str) -> Result<(Record, String)> {
    let raw = store.read(&record_path(record_id)?)?;
    Ok((serde_json::from_str(&raw)?, revision(&raw)))
}

pub fn record_value(store: &Store, record: &Record) -> Result<Value> {
    let mut value = serde_json::to_value(record)?;
    value["revision"] = json!(revision(&store.read(&record_path(&record.id)?)?));
    Ok(value)
}

pub(crate) fn validate_property(property: &Property) -> Result<()> {
    if property.id.is_empty()
        || property.id.len() > 64
        || !property
            .id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(Error::new(
            "invalid_schema",
            "Property ID must use letters, digits, hyphens or underscores",
        ));
    }
    nonempty(&property.name, "Property name")?;
    if ![
        "text", "number", "checkbox", "date", "select", "status", "url",
    ]
    .contains(&property.kind.as_str())
    {
        return Err(Error::new("invalid_schema", "Unsupported property type"));
    }
    if property.options.len() > 100 || property.options.iter().any(|s| s.len() > 200) {
        return Err(Error::new("invalid_schema", "Too many or too long options"));
    }
    Ok(())
}

pub fn create_database(store: &Store, args: &Value) -> Result<Value> {
    let properties: Vec<Property> = if let Some(p) = args.get("properties") {
        serde_json::from_value(p.clone())?
    } else {
        vec![
            Property {
                id: "title".into(),
                name: "Name".into(),
                kind: "text".into(),
                options: vec![],
            },
            Property {
                id: "status".into(),
                name: "Status".into(),
                kind: "status".into(),
                options: vec!["To do".into(), "In progress".into(), "Done".into()],
            },
            Property {
                id: "date".into(),
                name: "Date".into(),
                kind: "date".into(),
                options: vec![],
            },
        ]
    };
    if properties.is_empty() || properties.len() > 100 {
        return Err(Error::new(
            "invalid_schema",
            "A database needs 1–100 properties",
        ));
    }
    let mut ids = std::collections::HashSet::new();
    for property in &properties {
        validate_property(property)?;
        if !ids.insert(property.id.clone()) {
            return Err(Error::new("invalid_schema", "Duplicate property ID"));
        }
    }
    let db = Database {
        id: new_id(),
        name: nonempty(text(args, "name")?, "Database name")?,
        properties,
        created_at: now(),
    };
    store.commit(vec![(database_path(&db.id)?, Some(pretty(&db)?))])?;
    Ok(serde_json::to_value(db)?)
}

pub fn add_property(store: &Store, args: &Value) -> Result<Value> {
    let mut db = read_database(store, text(args, "databaseId")?)?;
    let p: Property = serde_json::from_value(
        args.get("property")
            .cloned()
            .ok_or_else(|| Error::new("invalid_arguments", "property is required"))?,
    )?;
    validate_property(&p)?;
    if db.properties.iter().any(|old| old.id == p.id) {
        return Err(Error::new("conflict", "Property ID already exists"));
    }
    if db.properties.len() >= 100 {
        return Err(Error::new("invalid_schema", "Maximum 100 properties"));
    }
    db.properties.push(p);
    store.commit(vec![(database_path(&db.id)?, Some(pretty(&db)?))])?;
    Ok(serde_json::to_value(db)?)
}

pub(crate) fn validate_values(db: &Database, values: &Map<String, Value>) -> Result<()> {
    for (key, value) in values {
        let p =
            db.properties.iter().find(|p| p.id == *key).ok_or_else(|| {
                Error::new("invalid_property", format!("Unknown property: {key}"))
            })?;
        if value.is_null() {
            continue;
        }
        let valid = match p.kind.as_str() {
            "number" => value.is_number(),
            "checkbox" => value.is_boolean(),
            "date" => value.as_str().is_some_and(|s| {
                s.is_empty() || chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
            }),
            "select" | "status" => value
                .as_str()
                .is_some_and(|s| s.is_empty() || p.options.contains(&s.to_string())),
            _ => value.is_string(),
        };
        if !valid {
            return Err(Error::new(
                "invalid_value",
                format!("Invalid {} value for {}", p.kind, p.name),
            ));
        }
        if value.as_str().is_some_and(|s| s.len() > 100_000) {
            return Err(Error::new("invalid_value", "Property value is too long"));
        }
    }
    Ok(())
}

pub fn create_record(store: &Store, args: &Value) -> Result<Value> {
    let db = read_database(store, text(args, "databaseId")?)?;
    let values: Map<String, Value> =
        serde_json::from_value(args.get("values").cloned().unwrap_or(json!({})))?;
    validate_values(&db, &values)?;
    let time = now();
    let record = Record {
        id: new_id(),
        database_id: db.id,
        values,
        body_note_id: None,
        created_at: time.clone(),
        updated_at: time,
    };
    store.commit(vec![(record_path(&record.id)?, Some(pretty(&record)?))])?;
    record_value(store, &record)
}

pub fn update_record(store: &Store, args: &Value) -> Result<Value> {
    let (mut record, rev) = read_record(store, text(args, "id")?)?;
    check_revision(text(args, "expectedRevision")?, &rev)?;
    let db = read_database(store, &record.database_id)?;
    let values: Map<String, Value> =
        serde_json::from_value(args.get("values").cloned().unwrap_or(json!({})))?;
    validate_values(&db, &values)?;
    record.values.extend(values);
    record.updated_at = now();
    store.commit(vec![(record_path(&record.id)?, Some(pretty(&record)?))])?;
    record_value(store, &record)
}

pub fn delete_record(store: &Store, args: &Value) -> Result<Value> {
    let (record, rev) = read_record(store, text(args, "id")?)?;
    check_revision(text(args, "expectedRevision")?, &rev)?;
    let path = record_path(&record.id)?;
    let item = json!({"id":new_id(),"kind":"record","title":record.values.get("title").and_then(Value::as_str).unwrap_or("Untitled record"),"deletedAt":now(),"originalPath":path,"content":store.read(&path)?});
    store.commit(vec![
        (
            format!("trash/{}.json", item["id"].as_str().unwrap()),
            Some(pretty(&item)?),
        ),
        (path, None),
    ])?;
    Ok(json!({"deleted":record.id}))
}

pub fn record_body(store: &Store, args: &Value) -> Result<Value> {
    let (mut record, rev) = read_record(store, text(args, "id")?)?;
    check_revision(text(args, "expectedRevision")?, &rev)?;
    if let Some(note_id) = &record.body_note_id {
        if args.get("noteId").is_none() && store.optional(&note_path(note_id)?)?.is_some() {
            return Ok(serde_json::to_value(read_note(store, note_id)?)?);
        }
    }
    if let Some(note_id) = args.get("noteId").and_then(Value::as_str) {
        let note = read_note(store, note_id)?;
        record.body_note_id = Some(note_id.into());
        record.updated_at = now();
        store.commit(vec![(record_path(&record.id)?, Some(pretty(&record)?))])?;
        return Ok(serde_json::to_value(note)?);
    }
    let body = text(args, "body")?;
    let title = record
        .values
        .get("title")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("Untitled record");
    let time = now();
    let meta = NoteMeta {
        id: new_id(),
        title: title.into(),
        folder_id: None,
        created_at: time.clone(),
        updated_at: time.clone(),
    };
    let note = Note {
        meta,
        body: body.into(),
        revision: String::new(),
    };
    record.body_note_id = Some(note.meta.id.clone());
    record.updated_at = time;
    let mut writes = plan_note_write(store, &note.meta.id, Some(&note))?;
    writes.push((record_path(&record.id)?, Some(pretty(&record)?)));
    store.commit(writes)?;
    Ok(serde_json::to_value(read_note(store, &note.meta.id)?)?)
}
