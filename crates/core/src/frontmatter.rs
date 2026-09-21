use crate::{notes::read_note, storage::Store, text, Result};
use pulldown_cmark::{Event as MarkdownEvent, Parser as MarkdownParser};
use saphyr::Scalar;
use saphyr_parser::{Event, Parser, ScalarStyle, Tag};
use serde_json::{json, Map, Number, Value};
use std::{borrow::Cow, ops::Range};

pub(crate) struct Frontmatter {
    yaml: Range<usize>,
    pub body_from: usize,
}

fn delimiter(line: &str) -> bool {
    let line = line
        .strip_suffix('\n')
        .map_or(line, |line| line.strip_suffix('\r').unwrap_or(line));
    line.trim_end_matches([' ', '\t']) == "---"
}

// This range belongs to the editable body, never the managed JSON file header.
pub(crate) fn range(body: &str) -> Option<Frontmatter> {
    let start = body
        .strip_prefix('\u{feff}')
        .map_or(0, |_| '\u{feff}'.len_utf8());
    let opening_end = body.find('\n')? + 1;
    if !delimiter(&body[start..opening_end]) {
        return None;
    }
    let mut offset = opening_end;
    for line in body[opening_end..].split_inclusive('\n') {
        if delimiter(line) {
            return Some(Frontmatter {
                yaml: opening_end..offset,
                body_from: offset + line.len(),
            });
        }
        offset += line.len();
    }
    // A leading Markdown horizontal rule remains ordinary text until a closing fence exists.
    None
}

// Parsing only the suffix prevents YAML from changing Markdown block structure, while mapped
// byte ranges still address the untouched source for links, tags, topics and line numbers.
pub(crate) fn markdown_events(
    body: &str,
) -> impl Iterator<Item = (MarkdownEvent<'_>, Range<usize>)> {
    let start = range(body).map_or(0, |frontmatter| frontmatter.body_from);
    MarkdownParser::new_ext(&body[start..], crate::wiki::options())
        .into_offset_iter()
        .map(move |(event, range)| (event, start + range.start..start + range.end))
}

enum Container {
    Object(Map<String, Value>, Option<String>),
    Array(Vec<Value>),
}

fn insert(
    stack: &mut [Container],
    root: &mut Option<Value>,
    value: Value,
) -> std::result::Result<(), String> {
    match stack.last_mut() {
        Some(Container::Array(values)) => values.push(value),
        Some(Container::Object(values, key)) => {
            if let Some(key) = key.take() {
                if values.insert(key.clone(), value).is_some() {
                    return Err(format!("Duplicate property: {key}"));
                }
            } else {
                let Value::String(name) = value else {
                    return Err("Property names must be strings".into());
                };
                if name.trim().is_empty() {
                    return Err("Property names must not be empty".into());
                }
                *key = Some(name);
            }
        }
        None => {
            if root.replace(value).is_some() {
                return Err("Frontmatter must contain one YAML document".into());
            }
        }
    }
    Ok(())
}

fn validate_tag(tag: Option<&Cow<'_, Tag>>, kind: &str) -> std::result::Result<(), String> {
    if let Some(tag) = tag {
        if !tag.is_yaml_core_schema()
            || match kind {
                "map" | "seq" => tag.suffix != kind,
                _ => !["str", "null", "bool", "int", "float"].contains(&tag.suffix.as_str()),
            }
        {
            return Err("Custom YAML tags are not supported".into());
        }
    }
    Ok(())
}

fn parse(source: &str) -> std::result::Result<Map<String, Value>, String> {
    if source.len() > 64 * 1024 {
        return Err(
            "Frontmatter display is limited to 64 KiB; the original text is preserved".into(),
        );
    }
    let mut stack = vec![];
    let mut root = None;
    let mut documents = 0;
    for event in Parser::new_from_str(source) {
        let (event, _) = event.map_err(|error| error.to_string())?;
        let key = matches!(stack.last(), Some(Container::Object(_, None)));
        let object = matches!(&event, Event::MappingStart(..));
        match event {
            Event::DocumentStart(_) => {
                documents += 1;
                if documents > 1 {
                    return Err("Frontmatter must contain one YAML document".into());
                }
            }
            Event::Alias(_) => return Err("YAML aliases are not supported".into()),
            Event::MappingStart(_, tag) | Event::SequenceStart(_, tag) => {
                if key {
                    return Err("Property names must be strings".into());
                }
                if stack.len() > 16 {
                    return Err("Frontmatter nesting is limited to 16 levels".into());
                }
                validate_tag(tag.as_ref(), if object { "map" } else { "seq" })?;
                stack.push(if object {
                    Container::Object(Map::new(), None)
                } else {
                    Container::Array(vec![])
                });
            }
            Event::MappingEnd | Event::SequenceEnd => {
                let value = match stack.pop().ok_or("Unexpected YAML collection end")? {
                    Container::Object(values, None) => Value::Object(values),
                    Container::Object(_, Some(_)) => return Err("Missing property value".into()),
                    Container::Array(values) => Value::Array(values),
                };
                insert(&mut stack, &mut root, value)?;
            }
            Event::Scalar(text, style, _, tag) => {
                if !key && stack.len() > 16 {
                    return Err("Frontmatter nesting is limited to 16 levels".into());
                }
                validate_tag(tag.as_ref(), "scalar")?;
                // The scalar library falls back to strings for overflowing hex/octal integers.
                // Reject them consistently with decimal numbers and the frontend YAML parser.
                if (style == ScalarStyle::Plain && tag.is_none())
                    || tag
                        .as_ref()
                        .is_some_and(|tag| matches!(tag.suffix.as_str(), "int" | "float"))
                {
                    if let Some((digits, radix)) = text
                        .strip_prefix("0x")
                        .map(|s| (s, 16))
                        .or_else(|| text.strip_prefix("0o").map(|s| (s, 8)))
                    {
                        if !digits.is_empty()
                            && digits.chars().all(|ch| ch.is_digit(radix))
                            && u64::from_str_radix(digits, radix)
                                .ok()
                                .is_none_or(|value| value > 9_007_199_254_740_991)
                        {
                            return Err("Integers must be within the JSON safe integer range; quote larger values".into());
                        }
                    }
                }
                let scalar = if let Some(tag) = &tag {
                    if tag.suffix == "str" {
                        Scalar::String(text)
                    } else if tag.suffix == "float" {
                        if !text.contains(['.', 'e', 'E']) {
                            return Err(
                                "Explicit YAML float values need a decimal point or exponent"
                                    .into(),
                            );
                        }
                        Scalar::FloatingPoint(
                            saphyr::parse_core_schema_fp(&text)
                                .ok_or("Invalid YAML float tag value")?
                                .into(),
                        )
                    } else {
                        let scalar = Scalar::parse_from_cow(text);
                        let valid = matches!(
                            (tag.suffix.as_str(), &scalar),
                            ("null", Scalar::Null)
                                | ("bool", Scalar::Boolean(_))
                                | ("int", Scalar::Integer(_))
                        );
                        if !valid {
                            return Err("Invalid YAML scalar tag value".into());
                        }
                        scalar
                    }
                } else {
                    Scalar::parse_from_cow_and_metadata(text, style, None)
                        .ok_or("Invalid YAML scalar")?
                };
                let value = match scalar {
                    Scalar::Null => Value::Null,
                    Scalar::Boolean(value) => Value::Bool(value),
                    Scalar::Integer(value) => {
                        if value.unsigned_abs() > 9_007_199_254_740_991 {
                            return Err("Integers must be within the JSON safe integer range; quote larger values".into());
                        }
                        json!(value)
                    }
                    Scalar::FloatingPoint(value) => {
                        let value = value.into_inner();
                        if value.fract() == 0.0 && value.abs() > 9_007_199_254_740_991.0 {
                            return Err("Integers must be within the JSON safe integer range; quote larger values".into());
                        }
                        Value::Number(
                            Number::from_f64(value).ok_or("Only finite numbers are supported")?,
                        )
                    }
                    Scalar::String(value) => Value::String(value.into_owned()),
                };
                insert(&mut stack, &mut root, value)?;
            }
            _ => {}
        }
    }
    match root {
        None | Some(Value::Null) => Ok(Map::new()),
        Some(Value::Object(value)) => Ok(value),
        _ => Err("Frontmatter must be a property mapping".into()),
    }
}

pub(crate) fn properties(body: &str) -> std::result::Result<Option<Map<String, Value>>, String> {
    let Some(frontmatter) = range(body) else {
        return Ok(None);
    };
    parse(&body[frontmatter.yaml]).map(Some)
}

pub fn inspect(store: &Store, args: &Value) -> Result<Value> {
    let note = read_note(store, text(args, "id")?)?;
    Ok(match properties(&note.body) {
        Ok(properties) => json!({"properties":properties,"error":null}),
        Err(error) => json!({"properties":null,"error":error}),
    })
}

// Patch the requested top-level entry, preserving the other YAML source and Markdown verbatim.
// Flow mappings and explicit complex keys need a CST editor; refuse those instead of losing comments.
fn patch_property(source: &str, name: &str, replacement: Option<&Value>) -> Result<String> {
    use crate::Error;
    let invalid = |message| Error::new("invalid_frontmatter", message);
    let mut expected = parse(source).map_err(invalid)?;
    if replacement.is_none() && !expected.contains_key(name) {
        return Ok(source.into());
    }
    let mut depth = 0;
    let mut key: Option<(String, usize, usize)> = None;
    let mut selected = None;
    // Saphyr string-parser markers count Unicode scalar values, not UTF-8 bytes.
    let offsets: Vec<_> = source
        .char_indices()
        .map(|(offset, _)| offset)
        .chain(std::iter::once(source.len()))
        .collect();
    for event in Parser::new_from_str(source) {
        let (event, span) = event.map_err(|e| invalid(e.to_string()))?;
        let start = *offsets
            .get(span.start.index())
            .ok_or_else(|| invalid("Invalid YAML source span".into()))?;
        let end = *offsets
            .get(span.end.index())
            .ok_or_else(|| invalid("Invalid YAML source span".into()))?;
        match event {
            Event::MappingStart(..) | Event::SequenceStart(..) => {
                if depth == 0 && source[start..].starts_with('{') {
                    return Err(invalid("Edit flow-style frontmatter in the note source; property commands require a block mapping".into()));
                }
                depth += 1;
            }
            Event::MappingEnd | Event::SequenceEnd => {
                depth -= 1;
                if depth == 1 {
                    if let Some((key_name, key_start, key_end)) = key.take() {
                        if key_name == name {
                            selected = Some((key_start, key_end, end));
                        }
                    }
                }
            }
            Event::Scalar(value, ..) if depth == 1 => {
                if let Some((key_name, key_start, key_end)) = key.take() {
                    if key_name == name {
                        selected = Some((key_start, key_end, end));
                    }
                } else {
                    key = Some((value.into_owned(), start, end));
                }
            }
            _ => {}
        }
    }
    let newline = if source.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut updated = source.to_string();
    if let Some((key_start, key_end, value_end)) = selected {
        let line_start = source[..key_start].rfind('\n').map_or(0, |p| p + 1);
        let tail = source[key_end..].split('\n').next().unwrap();
        let colon_offset = tail
            .find(':')
            .ok_or_else(|| invalid("Edit complex property keys in the note source".into()))?;
        if !source[line_start..key_start].trim().is_empty()
            || !tail[..colon_offset].trim().is_empty()
        {
            return Err(invalid(
                "Edit complex property keys in the note source".into(),
            ));
        }
        let colon = key_end + colon_offset + 1;
        // An implicit empty scalar is marked at its colon, before the insertion point.
        let mut value_end = value_end.max(colon);
        // Block collection end markers may include comments preceding the next property.
        // Keep those comments (and surrounding empty lines) outside this edit.
        while value_end > colon {
            let before_newline = value_end - usize::from(source[..value_end].ends_with('\n'));
            let start = source[..before_newline].rfind('\n').map_or(0, |p| p + 1);
            if start < colon {
                break;
            }
            let line = &source[start..value_end];
            let indent = line.len() - line.trim_start_matches([' ', '\t']).len();
            if line.trim().is_empty()
                || (indent <= key_start - line_start && line.trim_start().starts_with('#'))
            {
                value_end = start;
            } else {
                break;
            }
        }
        if let Some(value) = replacement {
            let ended_line = source[colon..value_end].ends_with('\n');
            let next = format!(
                " {}{}",
                serde_json::to_string(value)?,
                if ended_line { newline } else { "" }
            );
            updated.replace_range(colon..value_end, &next);
        } else {
            let end = if source[..value_end].ends_with('\n') {
                value_end
            } else {
                source[value_end..]
                    .find('\n')
                    .map_or(source.len(), |p| value_end + p + 1)
            };
            updated.replace_range(line_start..end, "");
        }
    } else if let Some(value) = replacement {
        if !updated.is_empty() && !updated.ends_with('\n') {
            updated.push_str(newline);
        }
        updated.push_str(&format!(
            "{}: {}{newline}",
            serde_json::to_string(name)?,
            serde_json::to_string(value)?
        ));
    }
    if let Some(value) = replacement {
        expected.insert(name.into(), value.clone());
    } else {
        expected.remove(name);
    }
    // A parser span must never let an edit silently change another property.
    if parse(&updated).map_err(invalid)? != expected {
        return Err(invalid(
            "This YAML layout requires editing the note source".into(),
        ));
    }
    Ok(updated)
}

pub fn edit_property(store: &Store, args: &Value, remove: bool) -> Result<Value> {
    use crate::{validation::check_revision, Error};
    let mut note = read_note(store, text(args, "id")?)?;
    check_revision(text(args, "expectedRevision")?, &note.revision)?;
    let name = text(args, "name")?;
    if name.trim().is_empty() || name.contains(['\r', '\n']) {
        return Err(Error::new(
            "invalid_arguments",
            "Use a nonempty property name on one line",
        ));
    }
    let value = if remove {
        None
    } else {
        let raw = text(args, "value")?;
        let kind = args["type"].as_str().unwrap_or("string");
        let value = if kind == "string" {
            Value::String(raw.into())
        } else {
            serde_json::from_str(raw)?
        };
        if !match kind {
            "string" => value.is_string(),
            "number" => value.is_number(),
            "boolean" => value.is_boolean(),
            "json" => true,
            _ => false,
        } {
            return Err(Error::new(
                "invalid_arguments",
                "Property type must be string, number, boolean or json, matching the value",
            ));
        }
        Some(value)
    };
    if let Some(frontmatter) = range(&note.body) {
        let yaml = &note.body[frontmatter.yaml.clone()];
        let next = patch_property(yaml, name, value.as_ref())?;
        if next == yaml {
            return Ok(serde_json::to_value(note)?);
        }
        note.body.replace_range(frontmatter.yaml, &next);
    } else if let Some(value) = value {
        let yaml = patch_property("", name, Some(&value))?;
        note.body = format!("---\n{yaml}---\n{}", note.body);
    } else {
        return Ok(serde_json::to_value(note)?);
    }
    crate::note_actions::save_body(store, note)
}
