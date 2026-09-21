use foltra_core::{Error, Result};
use serde_json::Value;

fn cell(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => String::new(),
        _ => value.to_string(),
    }
}

pub fn validate(format: &str) -> Result<()> {
    if !["json", "jsonl", "text", "tsv", "csv"].contains(&format) {
        return Err(Error::new(
            "invalid_arguments",
            "Format must be json, jsonl, text, tsv or csv",
        ));
    }
    Ok(())
}

fn escaped(text: &str, format: &str) -> String {
    if format == "csv" {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text.replace('\\', "\\\\")
            .replace('\t', "\\t")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
    }
}

pub fn render(value: &Value, format: &str) -> Result<String> {
    validate(format)?;
    if format == "json" {
        return Ok(serde_json::to_string_pretty(value)? + "\n");
    }
    let rows = value.as_array().or_else(|| value["rows"].as_array());
    if format == "jsonl" {
        return Ok(rows.map_or_else(
            || format!("{value}\n"),
            |rows| rows.iter().map(|row| format!("{row}\n")).collect(),
        ));
    }
    if let (Some(columns), Some(rows)) = (value["columns"].as_array(), value["rows"].as_array()) {
        if columns.iter().all(|column| column["name"].is_string())
            && rows.iter().all(Value::is_array)
        {
            let separator = if format == "csv" { "," } else { "\t" };
            let mut lines = vec![columns
                .iter()
                .map(|column| escaped(column["name"].as_str().unwrap(), format))
                .collect::<Vec<_>>()
                .join(separator)];
            for row in rows {
                lines.push(
                    row.as_array()
                        .unwrap()
                        .iter()
                        .map(|value| escaped(&cell(value), format))
                        .collect::<Vec<_>>()
                        .join(separator),
                );
            }
            return Ok(lines.join("\n") + "\n");
        }
    }
    if format == "text" {
        if let Some(body) = value["body"].as_str().or_else(|| value.as_str()) {
            return Ok(body.into());
        }
        return Ok(rows.map_or_else(
            || serde_json::to_string_pretty(value).unwrap() + "\n",
            |rows| {
                rows.iter()
                    .map(|row| {
                        if let Some(text) = row.as_str() {
                            return format!("{text}\n");
                        }
                        if let (Some(line), Some(text)) =
                            (row["line"].as_u64(), row["text"].as_str())
                        {
                            let title = row["title"]
                                .as_str()
                                .or_else(|| row["id"].as_str())
                                .unwrap_or("");
                            let marker = row["marker"]
                                .as_str()
                                .map_or(String::new(), |marker| format!("[{marker}] "));
                            return format!("{title}:{line}\t{marker}{text}\n");
                        }
                        let label = row["title"]
                            .as_str()
                            .or_else(|| row["name"].as_str())
                            .or_else(|| row["text"].as_str());
                        if let Some(label) = label {
                            format!("{}\t{label}\n", row["id"].as_str().unwrap_or(""))
                        } else {
                            format!("{row}\n")
                        }
                    })
                    .collect()
            },
        ));
    }
    let single = vec![value.clone()];
    let rows = rows.unwrap_or(&single);
    let mut columns = std::collections::BTreeSet::new();
    for row in rows {
        if let Some(row) = row.as_object() {
            columns.extend(row.keys().cloned());
        } else {
            columns.insert("value".into());
        }
    }
    if columns.is_empty() {
        return Ok(String::new());
    }
    let encode = |text: String| escaped(&text, format);
    let separator = if format == "csv" { "," } else { "\t" };
    let mut lines = vec![columns
        .iter()
        .cloned()
        .map(&encode)
        .collect::<Vec<_>>()
        .join(separator)];
    for row in rows {
        lines.push(
            columns
                .iter()
                .map(|key| {
                    encode(cell(if row.is_object() {
                        &row[key]
                    } else if key == "value" {
                        row
                    } else {
                        &Value::Null
                    }))
                })
                .collect::<Vec<_>>()
                .join(separator),
        );
    }
    Ok(lines.join("\n") + "\n")
}
