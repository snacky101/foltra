use crate::{
    databases::*,
    storage::{revision, Store},
    validation::*,
    *,
};
use serde_json::{json, Map, Number, Value};

struct ChangePlan {
    database: Database,
    writes: Vec<(String, Option<String>)>,
    preview: Value,
}

fn convert(value: &Value, kind: &str) -> Option<Value> {
    if value.is_null() {
        return Some(Value::Null);
    }
    match kind {
        "number" if value.is_number() => Some(value.clone()),
        "number" => {
            let text = value.as_str()?.trim();
            if text.is_empty() {
                return Some(Value::Null);
            }
            let number: Number = text.parse().ok()?;
            // Reject rounding, overflow and ambiguous numeric spellings instead of losing digits.
            (number.to_string() == text).then_some(Value::Number(number))
        }
        "checkbox" if value.is_boolean() => Some(value.clone()),
        "checkbox" => match value {
            Value::String(text) if text.trim().is_empty() => Some(Value::Null),
            Value::String(text) if text.trim().eq_ignore_ascii_case("true") => Some(json!(true)),
            Value::String(text) if text.trim().eq_ignore_ascii_case("false") => Some(json!(false)),
            Value::Number(number) if number.as_i64() == Some(1) => Some(json!(true)),
            Value::Number(number) if number.as_i64() == Some(0) => Some(json!(false)),
            _ => None,
        },
        _ if value.is_string() => Some(value.clone()),
        _ if value.is_number() || value.is_boolean() => Some(json!(value.to_string())),
        _ => None,
    }
}

fn plan(store: &Store, args: &Value) -> Result<ChangePlan> {
    let database_id = text(args, "databaseId")?;
    let raw_database = store.read(&database_path(database_id)?)?;
    let mut database: Database = serde_json::from_str(&raw_database)?;
    let raw_property = args
        .get("property")
        .ok_or_else(|| Error::new("invalid_arguments", "property is required"))?;
    let mut property: Property = serde_json::from_value(raw_property.clone())?;
    let index = database
        .properties
        .iter()
        .position(|p| p.id == property.id)
        .ok_or_else(|| Error::new("invalid_property", "Column does not exist"))?;
    let renamed = database.properties[index].name != property.name;
    if property.id == "title" && property.kind != "text" {
        return Err(Error::new(
            "invalid_schema",
            "The row name column must remain text",
        ));
    }
    let mut rows: Vec<_> = records(store)?
        .into_iter()
        .filter(|row| row.database_id == database_id)
        .collect();
    rows.sort_by(|a, b| a.id.cmp(&b.id));
    let row_revisions: Vec<_> = rows
        .iter()
        .map(|row| {
            Ok(json!([
                row.id,
                revision(&store.read(&record_path(&row.id)?)?)
            ]))
        })
        .collect::<Result<_>>()?;
    // Covers schema AND row edits/additions/deletions between preview and apply.
    let mut token = revision(&format!(
        "{raw_database}\n{}",
        serde_json::to_string(&row_revisions)?
    ));
    if matches!(property.kind.as_str(), "select" | "status")
        && raw_property.get("options").is_none()
    {
        let mut options = std::collections::BTreeSet::new();
        for row in &rows {
            if let Some(value) = row
                .values
                .get(&property.id)
                .and_then(|v| convert(v, "text"))
            {
                if let Some(text) = value.as_str().filter(|s| !s.is_empty()) {
                    options.insert(text.to_string());
                }
            }
        }
        property.options = options.into_iter().collect();
    }
    if !matches!(property.kind.as_str(), "select" | "status") {
        property.options.clear();
    }
    validate_property(&property)?;
    if property
        .options
        .iter()
        .any(|option| option.trim().is_empty())
        || property
            .options
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != property.options.len()
    {
        return Err(Error::new(
            "invalid_schema",
            "Options must be nonempty and unique",
        ));
    }
    database.properties[index] = property.clone();
    let rename_plan = renamed
        .then(|| crate::sql_rename::plan(store, &database))
        .transpose()?;
    if let Some(rename) = &rename_plan {
        token = revision(&format!("{token}\n{}", rename.revision));
    }
    let mut writes = vec![];
    let mut errors = vec![];
    let mut error_count = 0;
    let total = rows.len();
    let time = now();
    for mut row in rows {
        let Some(value) = row.values.get(&property.id) else {
            continue;
        };
        let converted = convert(value, &property.kind).filter(|next| {
            let mut values = Map::new();
            values.insert(property.id.clone(), next.clone());
            validate_values(&database, &values).is_ok()
        });
        let Some(converted) = converted else {
            error_count += 1;
            if errors.len() < 8 {
                errors.push(json!({"rowId":row.id,"title":row.values.get("title"),"value":value.to_string().chars().take(120).collect::<String>()}));
            }
            continue;
        };
        if converted != *value {
            row.values.insert(property.id.clone(), converted);
            row.updated_at = time.clone();
            writes.push((record_path(&row.id)?, Some(pretty(&row)?)));
        }
    }
    let changed_notes = rename_plan.as_ref().map_or(0, |plan| plan.changed_notes);
    let changed_queries = rename_plan.as_ref().map_or(0, |plan| plan.changed_queries);
    let query_errors = rename_plan
        .as_ref()
        .map(|plan| plan.errors.clone())
        .unwrap_or_default();
    let preview = json!({"revision":token,"property":property,"rowCount":total,"changedRows":writes.len(),"errorCount":error_count,"errors":errors,"changedNotes":changed_notes,"changedQueries":changed_queries,"queryErrors":query_errors,"canApply":error_count == 0 && query_errors.is_empty()});
    if let Some(rename) = rename_plan {
        writes.extend(rename.writes);
    }
    // Patch only known property fields so rename also preserves extension/future metadata.
    let mut schema: Value = serde_json::from_str(&raw_database)?;
    let target = &mut schema["properties"][index];
    target["name"] = json!(property.name);
    target["type"] = json!(property.kind);
    if !property.options.is_empty() {
        target["options"] = json!(property.options);
    } else {
        target.as_object_mut().unwrap().remove("options");
    }
    writes.push((database_path(database_id)?, Some(pretty(&schema)?)));
    Ok(ChangePlan {
        database,
        writes,
        preview,
    })
}

pub fn preview(store: &Store, args: &Value) -> Result<Value> {
    Ok(plan(store, args)?.preview)
}

pub fn update(store: &Store, args: &Value) -> Result<Value> {
    let plan = plan(store, args)?;
    check_revision(
        text(args, "expectedRevision")?,
        plan.preview["revision"].as_str().unwrap(),
    )?;
    if plan.preview["canApply"] != true {
        if !plan.preview["queryErrors"].as_array().unwrap().is_empty() {
            return Err(Error::new("query_rename_blocked", "연결된 SQL 쿼리를 안전하게 변경할 수 없습니다. 미리보기에 표시된 노트를 수정한 뒤 다시 시도해 주세요. 변경된 데이터는 없습니다."));
        }
        return Err(Error::new(
            "conversion_failed",
            format!(
                "{} rows cannot be converted. No data was changed.",
                plan.preview["errorCount"]
            ),
        ));
    }
    // The existing journal commits schema and all converted rows as one recoverable change.
    store.commit(plan.writes)?;
    Ok(
        json!({"database":plan.database,"changedRows":plan.preview["changedRows"],"changedNotes":plan.preview["changedNotes"],"changedQueries":plan.preview["changedQueries"]}),
    )
}
