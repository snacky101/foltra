use crate::{catalog, read_file};
use foltra_core::{Error, Result};
use serde_json::{json, Map, Value};

pub type Options = Vec<(String, Option<String>)>;

pub fn scan(tokens: &[String], specs: &[Value]) -> Result<Options> {
    let mut options = vec![];
    let mut index = 0;
    while index < tokens.len() {
        let token = &tokens[index];
        let (flag, inline) = token
            .split_once('=')
            .map_or((token.as_str(), None), |(k, v)| (k, Some(v.to_string())));
        if !flag.starts_with("--") && flag != "-h" {
            return Err(Error::new(
                "invalid_arguments",
                format!("Unexpected argument: {token}; use named options"),
            ));
        }
        let boolean = matches!(flag, "--json" | "--help" | "-h")
            || flag.starts_with("--no-")
            || specs.iter().any(|spec| {
                spec["argsSchema"]["properties"]
                    .as_object()
                    .unwrap()
                    .iter()
                    .any(|(key, prop)| prop["type"] == "boolean" && catalog::flag(key) == flag)
            });
        let mut value = inline;
        if value.is_none() {
            if let Some(next) = tokens.get(index + 1) {
                if !boolean || matches!(next.as_str(), "true" | "false") {
                    value = Some(next.clone());
                    index += 1;
                }
            }
        }
        options.push((flag.into(), value));
        index += 1;
    }
    Ok(options)
}

pub fn take(options: &mut Options, flag: &str) -> Result<Option<String>> {
    let mut found = None;
    let mut rest = vec![];
    for (key, value) in options.drain(..) {
        if key == flag {
            if found.is_some() {
                return Err(Error::new(
                    "invalid_arguments",
                    format!("Repeated option: {flag}"),
                ));
            }
            found = Some(value.ok_or_else(|| {
                Error::new("invalid_arguments", format!("Missing value for {flag}"))
            })?);
        } else {
            rest.push((key, value));
        }
    }
    *options = rest;
    Ok(found)
}

pub fn parse(options: Options, spec: &Value) -> Result<Value> {
    let mut args = Map::new();
    let properties = spec["argsSchema"]["properties"].as_object().unwrap();
    for (flag, input) in options {
        let required_value = || {
            input
                .as_deref()
                .ok_or_else(|| Error::new("invalid_arguments", format!("Missing value for {flag}")))
        };
        if flag == "--args" || flag == "--file" {
            let value = if flag == "--file" {
                read_file(required_value()?)?
            } else {
                required_value()?.to_string()
            };
            args.extend(serde_json::from_str::<Map<String, Value>>(&value)?);
            continue;
        }
        let negative = flag.starts_with("--no-");
        let normalized = if negative {
            format!("--{}", &flag[5..])
        } else {
            flag.clone()
        };
        let file = normalized.ends_with("-file");
        let base = if file {
            &normalized[..normalized.len() - 5]
        } else {
            normalized.as_str()
        };
        let alias = match base {
            "--database" => "--database-id",
            "--data" => "--values",
            "--content" if properties.contains_key("body") => "--body",
            _ => base,
        };
        let (name, property) = properties
            .iter()
            .find(|(name, _)| catalog::flag(name) == alias)
            .ok_or_else(|| {
                Error::new(
                    "invalid_arguments",
                    format!(
                        "Unknown option {flag}; run foltra {} --help",
                        spec["id"].as_str().unwrap()
                    ),
                )
            })?;
        let kind = property["type"].as_str().unwrap();
        if negative && (kind != "boolean" || input.is_some()) {
            return Err(Error::new(
                "invalid_arguments",
                format!("{flag} only works as a bare boolean option"),
            ));
        }
        let raw = if file {
            Some(read_file(required_value()?)?)
        } else {
            input.clone()
        };
        let value = match kind {
            "boolean" if negative => json!(false),
            "boolean" if raw.is_none() => json!(true),
            "string" => json!(raw.ok_or_else(|| Error::new(
                "invalid_arguments",
                format!("Missing value for {flag}")
            ))?),
            _ => serde_json::from_str(raw.as_deref().ok_or_else(|| {
                Error::new("invalid_arguments", format!("Missing value for {flag}"))
            })?)?,
        };
        args.insert(name.clone(), value);
    }
    Ok(Value::Object(args))
}

pub fn resolve_named(vault: &str, command: &str, name: &str) -> Result<Value> {
    let items = foltra_core::execute(vault, command, json!({}))?;
    let items = items.as_array().unwrap();
    if let Some(item) = items.iter().find(|item| item["id"] == name) {
        return Ok(item.clone());
    }
    let matches: Vec<_> = items.iter().filter(|item| item["name"] == name).collect();
    match matches.as_slice() {
        [item] => Ok((*item).clone()),
        [] => Err(Error::new("not_found", format!("Name not found: {name}"))),
        _ => Err(Error::new(
            "ambiguous_name",
            format!("More than one item is named {name}; use its ID"),
        )),
    }
}
