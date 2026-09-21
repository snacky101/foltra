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
    pub completions: Vec<CompletionSpec>,
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
    #[serde(default)]
    pub placement: Option<String>,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CompletionSpec {
    pub id: String,
    pub trigger: String,
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
        "git.sync",
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
        || config.completions.len() > 12
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
            || view
                .placement
                .as_deref()
                .is_some_and(|p| !["main", "right-sidebar"].contains(&p))
            || !config.permissions.iter().any(|p| p == "ui")
        {
            return Err(Error::new("invalid_plugin", "Invalid view declaration"));
        }
    }
    ids.clear();
    for completion in &config.completions {
        if !valid_slug(&completion.id)
            || !ids.insert(&completion.id)
            || completion.trigger.len() != 1
            || !completion.trigger.as_bytes()[0].is_ascii_punctuation()
            || !config.permissions.iter().any(|p| p == "editor.write")
        {
            return Err(Error::new(
                "invalid_plugin",
                "Invalid completion declaration",
            ));
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

pub(crate) fn validate_completions(value: &Value) -> Result<()> {
    let valid = value.as_array().is_some_and(|items| {
        items.len() <= 100
            && items.iter().all(|item| {
                item.as_object().is_some_and(|fields| {
                    fields
                        .keys()
                        .all(|key| ["label", "insertText", "detail"].contains(&key.as_str()))
                        && item["label"]
                            .as_str()
                            .is_some_and(|text| !text.trim().is_empty() && text.len() <= 120)
                        && item["insertText"]
                            .as_str()
                            .is_some_and(|text| text.len() <= 8000)
                        && item.get("detail").is_none_or(|detail| {
                            detail.as_str().is_some_and(|text| text.len() <= 240)
                        })
                })
            })
    });
    if !valid {
        return Err(Error::new(
            "invalid_completion",
            "Invalid completion candidates",
        ));
    }
    Ok(())
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
            "checkbox", "calendar",
        ]
        .contains(&kind)
        {
            return Err(Error::new("invalid_view", "Unsupported view element"));
        }
        if kind == "calendar" {
            return validate_calendar(node);
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

fn valid_calendar_date(value: &str) -> bool {
    value.len() == 10
        && value.bytes().enumerate().all(|(i, c)| {
            if i == 4 || i == 7 {
                c == b'-'
            } else {
                c.is_ascii_digit()
            }
        })
        && &value[..4] != "0000"
        && chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
}

fn validate_calendar(node: &Value) -> Result<()> {
    let month = node["month"].as_str().unwrap_or("");
    if month.len() != 7
        || !valid_calendar_date(&format!("{month}-01"))
        || !node["today"].as_str().is_some_and(valid_calendar_date)
    {
        return Err(Error::new(
            "invalid_view",
            "Calendar requires a valid month and today",
        ));
    }
    for (key, value) in node.as_object().unwrap() {
        let valid = match key.as_str() {
            "type" | "month" | "today" => true,
            "label" | "action" | "previousAction" | "nextAction" | "todayAction" => {
                value.as_str().is_some_and(|s| s.len() <= 8000)
            }
            "disabled" => value.is_boolean(),
            "markedDates" => value.as_array().is_some_and(|dates| {
                let mut unique = HashSet::new();
                dates.len() <= 31
                    && dates.iter().all(|date| {
                        date.as_str().is_some_and(|date| {
                            valid_calendar_date(date)
                                && date.starts_with(month)
                                && unique.insert(date)
                        })
                    })
            }),
            _ => false,
        };
        if !valid {
            return Err(Error::new(
                "invalid_view",
                format!("Invalid calendar property: {key}"),
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn completions_require_bounded_declarations_and_editor_permission() {
        let base = json!({"apiVersion":1,"source":"export default {}", "permissions":["editor.write"],
            "completions":[{"id":"dates","trigger":"@"}]});
        assert!(validate(&base).is_ok());
        for declarations in [
            json!([{"id":"dates","trigger":"@"}, {"id":"dates","trigger":"!"}]),
            json!([{"id":"../dates","trigger":"@"}]),
            json!([{"id":"dates","trigger":"@", "script":"untrusted"}]),
            json!((0..13)
                .map(|i| json!({"id":format!("dates-{i}"),"trigger":"@"}))
                .collect::<Vec<_>>()),
        ] {
            let mut value = base.clone();
            value["completions"] = declarations;
            assert!(validate(&value).is_err());
        }
        for trigger in ["", "@@", "a", "1", " ", "\n", "。"] {
            let mut value = base.clone();
            value["completions"][0]["trigger"] = json!(trigger);
            assert!(validate(&value).is_err(), "{trigger:?}");
        }
        let mut value = base;
        value["permissions"] = json!(["editor.read"]);
        assert!(validate(&value).is_err());
        value.as_object_mut().unwrap().remove("completions");
        assert!(validate(&value).is_ok());
    }

    #[test]
    fn completion_candidates_are_plain_bounded_data() {
        let item = json!({"label":"@Today","insertText":"2026-09-18","detail":"오늘"});
        assert!(validate_completions(&json!([])).is_ok());
        assert!(validate_completions(&json!([{"label":"Remove","insertText":""}])).is_ok());
        assert!(validate_completions(&json!(vec![item.clone(); 100])).is_ok());
        for invalid in [
            Value::Null,
            json!({"label":"@Today","insertText":"date"}),
            json!([true]),
            json!([{"label":" ","insertText":"date"}]),
            json!([{"label":"@Today"}]),
            json!([{"label":"@Today","insertText":1}]),
            json!([{"label":"@Today","insertText":"date","detail":null}]),
            json!([{"label":"@Today","insertText":"date","apply":"script"}]),
            json!(vec![item.clone(); 101]),
        ] {
            assert!(validate_completions(&invalid).is_err(), "{invalid}");
        }
        for (key, limit) in [("label", 120), ("insertText", 8000), ("detail", 240)] {
            let mut bounded = item.clone();
            bounded[key] = json!("a".repeat(limit));
            assert!(validate_completions(&json!([bounded.clone()])).is_ok());
            bounded[key] = json!("a".repeat(limit + 1));
            assert!(validate_completions(&json!([bounded])).is_err());
        }
    }

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

    #[test]
    fn view_placement_is_optional_and_restricted() {
        let mut value = json!({"apiVersion":1,"source":"export default {}",
            "permissions":["ui"],"views":[{"id":"calendar","title":"Calendar"}]});
        assert!(validate(&value).is_ok());
        for placement in ["main", "right-sidebar"] {
            value["views"][0]["placement"] = json!(placement);
            assert!(validate(&value).is_ok());
        }
        for placement in [json!("overlay"), json!(42), json!("")] {
            value["views"][0]["placement"] = placement;
            assert!(validate(&value).is_err());
        }
    }

    #[test]
    fn calendar_validates_real_dates_and_rejects_untrusted_properties() {
        let valid = json!({"type":"calendar","month":"2024-02","today":"2026-09-17",
            "markedDates":["2024-02-01","2024-02-29"],"label":"Calendar","action":"select-date",
            "previousAction":"previous","nextAction":"next","todayAction":"today","disabled":false});
        assert!(validate_tree(&valid).is_ok());
        for (key, value) in [
            ("month", json!("2024-2")),
            ("month", json!("0000-01")),
            ("month", json!("10000-01")),
            ("month", json!("2024-13")),
            ("today", json!("1900-02-29")),
            ("today", json!("2024-04-31")),
            ("today", json!("２０２４-01-01")),
            ("markedDates", json!(["2024-03-01"])),
            ("markedDates", json!(["2024-02-30"])),
            ("markedDates", json!(["2024-02-01", "2024-02-01"])),
            ("markedDates", json!(vec!["2024-02-01"; 32])),
            ("markedDates", json!([1])),
            ("markedDates", json!("2024-02-01")),
            ("action", json!(false)),
            ("disabled", json!("false")),
            ("style", json!("background:url(https://example.test)")),
            ("html", json!("<script>")),
            ("children", json!([])),
            ("payload", json!({})),
        ] {
            let mut node = valid.clone();
            node[key] = value;
            assert!(validate_tree(&node).is_err(), "accepted {node}");
        }
        for key in ["month", "today"] {
            let mut node = valid.clone();
            node.as_object_mut().unwrap().remove(key);
            assert!(validate_tree(&node).is_err());
        }
        for date in ["0001-01-01", "2000-02-29", "9999-12-31"] {
            assert!(
                validate_tree(&json!({"type":"calendar","month":&date[..7],"today":date})).is_ok()
            );
        }
        assert!(validate_tree(&json!({"type":"text","month":"2024-02"})).is_err());
    }

    #[test]
    fn bundled_calendar_defaults_to_read_only_with_live_dates_and_session_navigation() {
        use crate::{dispatch, extensions, plugin_runtime, storage::Store};
        let dir = tempfile::tempdir().unwrap();
        crate::execute(
            dir.path().to_str().unwrap(),
            "vault.init",
            json!({"name":"Calendar test"}),
        )
        .unwrap();
        let store = Store::open(dir.path().to_str().unwrap(), false).unwrap();
        let manifest: Value = serde_json::from_str(include_str!(
            "../../../examples/plugins/daily-calendar.json"
        ))
        .unwrap();
        assert_eq!(
            manifest["runtime"]["permissions"],
            json!(["notes.read", "notes.write", "ui"])
        );
        extensions::install(&store, &manifest).unwrap();
        let status = plugin_runtime::statuses(&store).unwrap();
        plugin_runtime::update_policy(&store, &json!({"enabled":true,"acceptConsent":true}))
            .unwrap();
        plugin_runtime::enable(
            &store,
            "daily-calendar",
            status[0]["digest"].as_str().unwrap(),
        )
        .unwrap();
        let invoke = |event: Value, state: Value| {
            plugin_runtime::invoke(
                &store,
                &json!({"id":"daily-calendar","event":event,"state":state}),
                false,
            )
            .unwrap()
        };
        let load = invoke(
            json!({"type":"load"}),
            json!({"month":"2000-01","selectedDate":"2000-01-01"}),
        );
        let fresh = invoke(
            json!({"type":"render","id":"calendar"}),
            load["state"].clone(),
        );
        assert_eq!(
            fresh["view"]["children"][0]["month"],
            &fresh["view"]["children"][0]["today"].as_str().unwrap()[..7]
        );
        assert!(load["state"]["selectedDate"].is_null());
        let note = dispatch(
            &store,
            "note.create",
            json!({"title":"2000-02-29","body":"Keep this body"}),
        )
        .unwrap();
        let before = dispatch(&store, "note.list", json!({})).unwrap();
        let view = invoke(
            json!({"type":"render","id":"calendar"}),
            json!({"month":"2000-02"}),
        );
        assert_eq!(
            view["view"]["children"][0]["markedDates"],
            json!(["2000-02-29"])
        );
        let selected = invoke(
            json!({"type":"action","id":"calendar","action":{"id":"select-date","value":"2000-02-29"}}),
            json!({"month":"2000-02"}),
        );
        assert_eq!(
            selected["effects"],
            json!([{"type":"openNote","args":{"id":note["id"]}}])
        );
        let missing = invoke(
            json!({"type":"action","id":"calendar","action":{"id":"select-date","value":"2000-02-28"}}),
            json!({"month":"2000-02"}),
        );
        assert_eq!(
            missing["effects"],
            json!([{"type":"notify",
            "args":{"message":"2000-02-28 · 노트가 없습니다."}}])
        );
        let next = invoke(
            json!({"type":"command","id":"next-month"}),
            json!({"month":"1999-12"}),
        );
        assert_eq!(next["state"]["month"], "2000-01");
        assert_eq!(dispatch(&store, "note.list", json!({})).unwrap(), before);
        for result in [load, fresh, view, selected, missing, next] {
            assert_eq!(result["changed"], false);
        }
        let renamed = dispatch(&store, "note.update", json!({"id":note["id"],"title":"2000-03-01","body":note["body"],"expectedRevision":note["revision"]})).unwrap();
        let view = invoke(
            json!({"type":"render","id":"calendar"}),
            json!({"month":"2000-02"}),
        );
        assert_eq!(view["view"]["children"][0]["markedDates"], json!([]));
        let view = invoke(
            json!({"type":"render","id":"calendar"}),
            json!({"month":"2000-03"}),
        );
        assert_eq!(
            view["view"]["children"][0]["markedDates"],
            json!(["2000-03-01"])
        );
        dispatch(
            &store,
            "note.delete",
            json!({"id":note["id"],"expectedRevision":renamed["revision"]}),
        )
        .unwrap();
        let view = invoke(
            json!({"type":"render","id":"calendar"}),
            json!({"month":"2000-03"}),
        );
        assert_eq!(view["view"]["children"][0]["markedDates"], json!([]));
        assert!(store
            .optional("plugin-data/daily-calendar.json")
            .unwrap()
            .is_none());
    }
}
