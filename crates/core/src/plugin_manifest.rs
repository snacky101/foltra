use crate::{extensions::valid_slug, Error, Result};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashSet;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RuntimeConfig {
    pub api_version: u32,
    pub source: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub views: Vec<ViewSpec>,
    #[serde(default)]
    pub settings_view: Option<String>,
    #[serde(default)]
    pub events: Vec<String>,
    #[serde(default)]
    pub background_command: Option<String>,
    #[serde(default)]
    pub settings: Vec<Setting>,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ViewSpec {
    pub id: String,
    pub title: String,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Setting {
    pub id: String,
    pub label: String,
    pub r#type: String,
    pub default: Value,
    #[serde(default)]
    pub options: Vec<String>,
}
impl Setting {
    pub fn accepts(&self, value: &Value) -> bool {
        match self.r#type.as_str() {
            "text" => value.as_str().is_some_and(|s| s.len() <= 4000),
            "number" => value.as_f64().is_some_and(f64::is_finite),
            "checkbox" => value.is_boolean(),
            "select" => value
                .as_str()
                .is_some_and(|v| self.options.iter().any(|s| s == v)),
            _ => false,
        }
    }
}
pub(crate) fn validate(value: &Value) -> Result<RuntimeConfig> {
    let config: RuntimeConfig = serde_json::from_value(value.clone())?;
    let allowed = [
        "notes.read",
        "notes.write",
        "databases.read",
        "databases.write",
        "editor.read",
        "editor.write",
        "ui",
        "anki.connect",
        "automation",
    ];
    let mut ids = HashSet::new();
    if config.api_version != 1
        || config.source.trim().is_empty()
        || config.source.len() > 200_000
        || config.permissions.len() > allowed.len()
        || config
            .permissions
            .iter()
            .any(|p| !allowed.contains(&p.as_str()) || !ids.insert(p))
        || config.background_command.as_ref().is_some_and(|id| {
            !valid_slug(id) || !config.permissions.iter().any(|p| p == "automation")
        })
        || config.views.len() > 12
        || config.settings.len() > 30
        || config.events.len() > 2
        || config
            .events
            .iter()
            .any(|e| !["workspace.changed", "note.opened"].contains(&e.as_str()))
    {
        return Err(Error::new(
            "invalid_plugin",
            "Unsupported plugin SDK, source, permissions or limits",
        ));
    }
    ids.clear();
    for view in &config.views {
        if !valid_slug(&view.id)
            || !ids.insert(&view.id)
            || view.title.trim().is_empty()
            || view.title.len() > 120
            || !config.permissions.iter().any(|p| p == "ui")
        {
            return Err(Error::new("invalid_plugin", "Invalid view declaration"));
        }
    }
    ids.clear();
    if config
        .settings_view
        .as_ref()
        .is_some_and(|id| !config.views.iter().any(|view| &view.id == id))
    {
        return Err(Error::new(
            "invalid_plugin",
            "Settings view must be a declared view",
        ));
    }
    for setting in &config.settings {
        if !valid_slug(&setting.id)
            || !ids.insert(&setting.id)
            || setting.label.trim().is_empty()
            || setting.label.len() > 120
            || setting.options.len() > 50
            || setting.options.iter().any(|s| s.len() > 120)
            || !setting.accepts(&setting.default)
        {
            return Err(Error::new("invalid_plugin", "Invalid plugin setting"));
        }
    }
    Ok(config)
}

pub(crate) fn validate_tree(tree: &Value) -> Result<()> {
    fn visit(node: &Value, depth: usize, count: &mut usize) -> Result<()> {
        *count += 1;
        if depth > 16 || *count > 1500 || !node.is_object() {
            return Err(Error::new(
                "invalid_view",
                "View exceeds nesting or node limits",
            ));
        }
        let kind = node["type"].as_str().unwrap_or("");
        if ![
            "stack", "row", "grid", "card", "text", "heading", "button", "input", "select",
            "checkbox",
        ]
        .contains(&kind)
        {
            return Err(Error::new("invalid_view", "Unsupported view element"));
        }
        for (key, value) in node.as_object().unwrap() {
            let valid = match key.as_str() {
                "type" => true,
                "text" | "label" | "value" | "placeholder" | "action" => {
                    value.as_str().is_some_and(|s| s.len() <= 8000)
                }
                "tone" => value
                    .as_str()
                    .is_some_and(|s| ["muted", "accent", "danger"].contains(&s)),
                "inputType" => value
                    .as_str()
                    .is_some_and(|s| ["text", "number", "date"].contains(&s)),
                "checked" | "disabled" => value.is_boolean(),
                "columns" => value.as_u64().is_some_and(|n| (1..=7).contains(&n)),
                "payload" => value.to_string().len() <= 8000,
                "options" => value.as_array().is_some_and(|a| {
                    a.len() <= 100 && a.iter().all(|v| v.as_str().is_some_and(|s| s.len() <= 200))
                }),
                "children" => {
                    if !["stack", "row", "grid", "card"].contains(&kind) {
                        false
                    } else if let Some(children) = value.as_array() {
                        for child in children {
                            visit(child, depth + 1, count)?;
                        }
                        true
                    } else {
                        false
                    }
                }
                _ => false,
            };
            if !valid {
                return Err(Error::new(
                    "invalid_view",
                    format!("Invalid view property: {key}"),
                ));
            }
        }
        Ok(())
    }
    visit(tree, 0, &mut 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn settings_view_requires_a_declared_permissioned_view() {
        let mut value = json!({"apiVersion":1,"source":"export default {}",
            "permissions":["ui"],"views":[{"id":"preferences","title":"Preferences"}],
            "settingsView":"preferences"});
        assert!(validate(&value).is_ok());
        value["settingsView"] = json!("missing");
        assert!(validate(&value).is_err());
        value["settingsView"] = json!("preferences");
        value["permissions"] = json!([]);
        assert!(validate(&value).is_err());
        value.as_object_mut().unwrap().remove("settingsView");
        value["views"] = json!([]);
        assert!(validate(&value).is_ok());
    }
}
