use crate::{
    databases, notes,
    storage::{safe_path, Store},
};
use crate::{Database, Error, Link, Note, Query, Record, Result};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

pub fn links(notes: &[Note], records: &[Record]) -> Result<Vec<Link>> {
    let mut out = vec![];
    for note in notes {
        let starts: Vec<_> = std::iter::once(0)
            .chain(note.body.match_indices('\n').map(|(i, _)| i + 1))
            .collect();
        for link in crate::wiki::spans(&note.body) {
            let resolved = if let Some(rid) = link.name.strip_prefix("record:") {
                records.iter().find(|r| r.id == rid).map(|r| r.id.clone())
            } else {
                crate::wiki::resolve_note(notes, link.name).map(|n| n.meta.id.clone())
            };
            let line = starts.partition_point(|start| *start <= link.range.start);
            let line_start = starts[line - 1];
            out.push(Link {
                source: note.meta.id.clone(),
                target: resolved,
                name: link.name.into(),
                label: link.label(),
                block: link.suffix.strip_prefix("#^").map(str::to_string),
                line,
                context: note.body[line_start..]
                    .lines()
                    .next()
                    .unwrap_or("")
                    .chars()
                    .take(220)
                    .collect(),
            });
        }
    }

    for record in records {
        if let Some(note_id) = &record.body_note_id {
            out.push(Link {
                source: record.id.clone(),
                name: note_id.clone(),
                target: notes
                    .iter()
                    .find(|n| n.meta.id == *note_id)
                    .map(|n| n.meta.id.clone()),
                label: "Record body".into(),
                block: None,
                line: 0,
                context: record
                    .values
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Record")
                    .into(),
            });
        }
    }
    Ok(out)
}

fn index(store: &Store) -> Result<Connection> {
    let cache = safe_path(&store.root, ".foltra/cache")?;
    std::fs::create_dir_all(cache)?;
    for path in [
        ".foltra/cache/index.sqlite",
        ".foltra/cache/index.sqlite-wal",
        ".foltra/cache/index.sqlite-shm",
    ] {
        safe_path(&store.root, path)?;
    }
    let connection = Connection::open(safe_path(&store.root, ".foltra/cache/index.sqlite")?)?;
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,title TEXT,body TEXT,revision TEXT);",
    )?;
    let notes = notes::notes(store)?;
    let mut changed = false;
    let transaction = connection.unchecked_transaction()?;
    for note in &notes {
        let old = transaction
            .query_row(
                "SELECT revision FROM notes WHERE id=?1",
                [&note.meta.id],
                |row| row.get::<_, String>(0),
            )
            .ok();
        if old.as_deref() != Some(&note.revision) {
            transaction.execute(
                "INSERT OR REPLACE INTO notes VALUES (?1,?2,?3,?4)",
                params![note.meta.id, note.meta.title, note.body, note.revision],
            )?;
            changed = true;
        }
    }
    let mut statement = transaction.prepare("SELECT id FROM notes")?;
    let indexed = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(statement);
    for old_id in indexed {
        if !notes.iter().any(|n| n.meta.id == old_id) {
            transaction.execute("DELETE FROM notes WHERE id=?1", [&old_id])?;
            changed = true;
        }
    }
    if changed {
        transaction.commit()?;
    } else {
        transaction.rollback()?;
    }
    Ok(connection)
}

pub fn search(store: &Store, term: &str) -> Result<Value> {
    if term.len() > 500 {
        return Err(Error::new(
            "invalid_arguments",
            "Search is limited to 500 bytes",
        ));
    }
    if let Some(tag) = term.trim().strip_prefix("tag:") {
        return crate::tags::search(store, tag);
    }
    let connection = index(store)?;
    if term.trim().is_empty() {
        return Ok(json!([]));
    }
    // Bind the entire value and escape LIKE wildcards; search text is never SQL.
    let pattern = format!(
        "%{}%",
        term.replace('!', "!!")
            .replace('%', "!%")
            .replace('_', "!_")
    );
    let mut statement=connection.prepare("SELECT id,title,substr(body,1,180) FROM notes WHERE title LIKE ?1 ESCAPE '!' OR body LIKE ?1 ESCAPE '!' LIMIT 100")?;
    let rows=statement.query_map([pattern],|r| Ok(json!({"id":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,"excerpt":r.get::<_,String>(2)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
    Ok(json!(rows))
}

fn validate_query(db: &Database, query: &Query) -> Result<()> {
    if query.limit > 500 || query.filters.len() > 20 {
        return Err(Error::new(
            "query_limit",
            "At most 500 results and 20 filters per query",
        ));
    }
    for filter in &query.filters {
        if !db.properties.iter().any(|p| p.id == filter.property) {
            return Err(Error::new(
                "invalid_property",
                format!("Unknown property: {}", filter.property),
            ));
        }
        if ![
            "eq", "neq", "contains", "gt", "gte", "lt", "lte", "is_empty",
        ]
        .contains(&filter.op.as_str())
        {
            return Err(Error::new("invalid_query", "Unsupported filter operator"));
        }
        let property = db
            .properties
            .iter()
            .find(|p| p.id == filter.property)
            .unwrap();
        match filter.op.as_str() {
            "is_empty" => {}
            "contains" => {
                if !filter.value.is_string()
                    || ["number", "checkbox"].contains(&property.kind.as_str())
                {
                    return Err(Error::new(
                        "invalid_query",
                        "contains requires a text property and string value",
                    ));
                }
            }
            op => {
                if ["gt", "gte", "lt", "lte"].contains(&op)
                    && (filter.value.is_null()
                        || !["number", "date"].contains(&property.kind.as_str()))
                {
                    return Err(Error::new(
                        "invalid_query",
                        "Range filters require a number or date value",
                    ));
                }
                databases::validate_values(
                    db,
                    &serde_json::Map::from_iter([(filter.property.clone(), filter.value.clone())]),
                )?;
            }
        }
    }
    if query
        .sort
        .as_ref()
        .is_some_and(|sort| !db.properties.iter().any(|p| p.id == *sort))
    {
        return Err(Error::new("invalid_property", "Unknown sort property"));
    }
    Ok(())
}
fn compare(a: &Value, b: &Value) -> std::cmp::Ordering {
    match (a.as_f64(), b.as_f64()) {
        (Some(a), Some(b)) => a.total_cmp(&b),
        _ if a.is_boolean() && b.is_boolean() => a.as_bool().cmp(&b.as_bool()),
        _ => a.as_str().unwrap_or("").cmp(b.as_str().unwrap_or("")),
    }
}
pub fn run(store: &Store, query: Query) -> Result<Value> {
    let db = databases::read_database(store, &query.database_id)?;
    validate_query(&db, &query)?;
    let mut records: Vec<_> = databases::records(store)?
        .into_iter()
        .filter(|r| r.database_id == db.id)
        .filter(|r| {
            query.filters.iter().all(|f| {
                let value = r.values.get(&f.property).unwrap_or(&Value::Null);
                match f.op.as_str() {
                    "eq" => value == &f.value,
                    "neq" => value != &f.value,
                    "contains" => value.as_str().is_some_and(|s| {
                        s.to_lowercase()
                            .contains(&f.value.as_str().unwrap_or("").to_lowercase())
                    }),
                    "gt" => !value.is_null() && compare(value, &f.value).is_gt(),
                    "gte" => !value.is_null() && compare(value, &f.value).is_ge(),
                    "lt" => !value.is_null() && compare(value, &f.value).is_lt(),
                    "lte" => !value.is_null() && compare(value, &f.value).is_le(),
                    "is_empty" => value.is_null() || value.as_str() == Some(""),
                    _ => false,
                }
            })
        })
        .collect();
    if let Some(sort) = &query.sort {
        records.sort_by(|a, b| {
            let order = compare(
                a.values.get(sort).unwrap_or(&Value::Null),
                b.values.get(sort).unwrap_or(&Value::Null),
            )
            .then(a.id.cmp(&b.id));
            if query.descending {
                order.reverse()
            } else {
                order
            }
        });
    } else {
        records.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
    }
    let total = records.len();
    let rows = records
        .iter()
        .skip(query.offset)
        .take(query.limit)
        .map(|r| databases::record_value(store, r))
        .collect::<Result<Vec<_>>>()?;
    Ok(json!({"database":db,"rows":rows,"total":total,"offset":query.offset,"limit":query.limit}))
}
