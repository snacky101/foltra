use crate::{
    frontmatter, notes, storage::Store, text, validation::check_revision, Error, Note, Result,
};
use pulldown_cmark::{Event, Tag, TagEnd};
use regex::Regex;
use serde_json::{json, Value};
use std::sync::LazyLock;

const STATES: &[(&str, char)] = &[
    ("todo", ' '),
    ("doing", '/'),
    ("done", 'x'),
    ("bookmark", 'b'),
    ("cancelled", '-'),
    ("deferred", '>'),
    ("question", '?'),
    ("important", '!'),
    ("star", '*'),
    ("info", 'i'),
    ("pin", 'p'),
];
static TASK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:[-+*]|[0-9]+[.)])[ \t]+\[([^\]\r\n])\](?:[ \t]+|$)").unwrap()
});

fn marker(value: &str) -> Result<char> {
    STATES.iter().find(|(status, ch)| *status == value || ch.to_string() == value.to_lowercase())
        .map(|(_, ch)| *ch).ok_or_else(|| Error::new("invalid_arguments", "Unknown task status; use todo, doing, done, bookmark, cancelled, deferred, question, important, star, info or pin"))
}

fn tasks(note: &Note) -> Vec<(usize, Value)> {
    let mut out = vec![];
    for (event, range) in frontmatter::markdown_events(&note.body) {
        if !matches!(event, Event::Start(Tag::Item)) {
            continue;
        }
        let source = &note.body[range.start..range.end];
        let Some(captures) = TASK.captures(source) else {
            continue;
        };
        let value = captures.get(1).unwrap();
        let Ok(ch) = marker(value.as_str()) else {
            continue;
        };
        let status = STATES.iter().find(|(_, m)| *m == ch).unwrap().0;
        let line = note.body[..range.start]
            .bytes()
            .filter(|b| *b == b'\n')
            .count()
            + 1;
        let content = source[captures.get(0).unwrap().end()..]
            .lines()
            .next()
            .unwrap_or("");
        out.push((range.start + value.start(), json!({"id":note.meta.id,"title":note.meta.title,"line":line,"status":status,"marker":value.as_str(),"text":content,"revision":note.revision})));
    }
    out
}

pub fn list_tasks(store: &Store, args: &Value) -> Result<Value> {
    let wanted = args["status"].as_str().map(marker).transpose()?;
    let all = if let Some(id) = args["id"].as_str() {
        vec![notes::read_note(store, id)?]
    } else {
        notes::notes(store)?
    };
    Ok(json!(all
        .iter()
        .flat_map(tasks)
        .map(|(_, task)| task)
        .filter(|task| wanted
            .is_none_or(|ch| marker(task["marker"].as_str().unwrap()).ok() == Some(ch)))
        .collect::<Vec<_>>()))
}

pub fn update_task(store: &Store, args: &Value) -> Result<Value> {
    let mut note = notes::read_note(store, text(args, "id")?)?;
    check_revision(text(args, "expectedRevision")?, &note.revision)?;
    let toggle = args["toggle"].as_bool().unwrap_or(false);
    if toggle == args.get("status").is_some() {
        return Err(Error::new(
            "invalid_arguments",
            "Use either status or toggle",
        ));
    }
    let (position, task) = tasks(&note)
        .into_iter()
        .find(|(_, task)| task["line"] == args["line"])
        .ok_or_else(|| {
            Error::new(
                "not_found",
                "No task at this body line (line numbers start at 1)",
            )
        })?;
    let next = if toggle {
        if task["status"] == "done" {
            ' '
        } else {
            'x'
        }
    } else {
        marker(text(args, "status")?)?
    };
    if note.body[position..].starts_with(next) {
        return Ok(serde_json::to_value(note)?);
    }
    note.body
        .replace_range(position..position + 1, &next.to_string());
    crate::note_actions::save_body(store, note)
}

pub fn outline(store: &Store, args: &Value) -> Result<Value> {
    let note = notes::read_note(store, text(args, "id")?)?;
    let mut out = vec![];
    let mut heading = None;
    for (event, range) in frontmatter::markdown_events(&note.body) {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                heading = Some((level as u8, range.start, String::new()))
            }
            Event::Text(text) | Event::Code(text) => {
                if let Some((_, _, content)) = &mut heading {
                    content.push_str(&text);
                }
            }
            Event::End(TagEnd::Heading(_)) => {
                if let Some((level, start, title)) = heading.take() {
                    out.push(json!({"level":level,"text":title,"line":note.body[..start].bytes().filter(|b| *b == b'\n').count() + 1}));
                }
            }
            _ => {}
        }
    }
    Ok(json!(out))
}

pub fn stats(store: &Store, args: &Value) -> Result<Value> {
    let note = notes::read_note(store, text(args, "id")?)?;
    let start = frontmatter::range(&note.body).map_or(0, |range| range.body_from);
    let body = &note.body[start..];
    Ok(
        json!({"id":note.meta.id,"title":note.meta.title,"words":body.split_whitespace().count(),"characters":body.chars().count(),"lines":body.lines().count(),"bytes":body.len()}),
    )
}

pub fn search_context(store: &Store, args: &Value) -> Result<Value> {
    let query = text(args, "query")?;
    let limit = args["limit"].as_u64().unwrap_or(100) as usize;
    if query.trim().is_empty() || query.len() > 500 || !(1..=200).contains(&limit) {
        return Err(Error::new(
            "invalid_arguments",
            "Use a nonempty query (at most 500 bytes) and a limit of 1–200",
        ));
    }
    let sensitive = args["caseSensitive"].as_bool().unwrap_or(false);
    let query = if sensitive {
        query.to_string()
    } else {
        query.to_lowercase()
    };
    let all = if let Some(id) = args["id"].as_str() {
        vec![notes::read_note(store, id)?]
    } else {
        notes::notes(store)?
    };
    let mut result = vec![];
    for note in all {
        let lines: Vec<_> = note.body.lines().collect();
        for (index, line) in lines.iter().enumerate() {
            if !(if sensitive {
                line.to_string()
            } else {
                line.to_lowercase()
            })
            .contains(&query)
            {
                continue;
            }
            result.push(json!({"id":note.meta.id,"title":note.meta.title,"line":index+1,"text":line,"before":index.checked_sub(1).map(|i|lines[i]),"after":lines.get(index+1),"revision":note.revision}));
            if result.len() == limit {
                return Ok(json!(result));
            }
        }
    }
    Ok(json!(result))
}
