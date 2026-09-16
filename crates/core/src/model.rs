use crate::{storage::revision, Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    pub id: String,
    pub name: String,
    pub format_version: u32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    #[serde(flatten)]
    pub meta: NoteMeta,
    pub body: String,
    pub revision: String,
}

impl Note {
    pub fn parse(text: &str) -> Result<Self> {
        let rest = text.strip_prefix("---\n").ok_or_else(|| {
            Error::new(
                "invalid_note",
                "Note metadata is missing. Import plain Markdown using note.create.",
            )
        })?;
        let (metadata, body) = rest
            .split_once("\n---\n")
            .ok_or_else(|| Error::new("invalid_note", "Invalid note metadata"))?;
        Ok(Self {
            meta: serde_json::from_str(metadata)?,
            body: body.strip_prefix('\n').unwrap_or(body).into(),
            revision: revision(text),
        })
    }
    pub fn encode(meta: &NoteMeta, body: &str) -> Result<String> {
        Ok(format!(
            "---\n{}\n---\n\n{}",
            serde_json::to_string(meta)?,
            body
        ))
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Property {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Database {
    pub id: String,
    pub name: String,
    pub properties: Vec<Property>,
    pub created_at: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    pub database_id: String,
    pub values: Map<String, Value>,
    pub body_note_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub source: String,
    pub target: Option<String>,
    pub name: String,
    pub label: String,
    pub block: Option<String>,
    pub line: usize,
    pub context: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Query {
    pub database_id: String,
    #[serde(default)]
    pub filters: Vec<Filter>,
    pub sort: Option<String>,
    #[serde(default)]
    pub descending: bool,
    #[serde(default = "default_limit")]
    pub limit: usize,
    #[serde(default)]
    pub offset: usize,
}
fn default_limit() -> usize {
    100
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Filter {
    pub property: String,
    pub op: String,
    pub value: Value,
}
