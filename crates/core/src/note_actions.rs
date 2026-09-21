use crate::{
    frontmatter, notes, storage::Store, text, validation::check_revision, Error, Note, Result,
};
use chrono::{Local, NaiveDate};
use serde_json::{json, Value};

pub fn resolve(store: &Store, target: &str) -> Result<Note> {
    let all = notes::notes(store)?;
    if let Some(note) = all.iter().find(|note| note.meta.id == target) {
        return notes::read_note(store, &note.meta.id);
    }
    let matches: Vec<_> = all
        .iter()
        .filter(|note| note.meta.title == target)
        .collect();
    match matches.as_slice() {
        [note] => notes::read_note(store, &note.meta.id),
        [] => Err(Error::new("not_found", format!("Note not found: {target}"))),
        _ => Err(Error::new(
            "ambiguous_note",
            format!("More than one note is named {target}; use its ID"),
        )),
    }
}

pub fn append(store: &Store, args: &Value, prepend: bool) -> Result<Value> {
    let mut note = notes::read_note(store, text(args, "id")?)?;
    if let Some(revision) = args.get("expectedRevision") {
        check_revision(revision.as_str().unwrap(), &note.revision)?;
    }
    let content = text(args, "content")?;
    if content.is_empty() {
        return Ok(serde_json::to_value(note)?);
    }
    let inline = args["inline"].as_bool().unwrap_or(false);
    let join = |a: &str, b: &str| {
        let separator =
            if inline || a.is_empty() || b.is_empty() || a.ends_with('\n') || b.starts_with('\n') {
                ""
            } else {
                "\n"
            };
        format!("{a}{separator}{b}")
    };
    note.body = if prepend {
        // User frontmatter stays at the beginning, separate from Foltra's managed header.
        let start = frontmatter::range(&note.body).map_or(0, |range| range.body_from);
        let prefix = &note.body[..start];
        let separator =
            if !prefix.is_empty() && !prefix.ends_with('\n') && !content.starts_with('\n') {
                "\n"
            } else {
                ""
            };
        format!("{prefix}{separator}{}", join(content, &note.body[start..]))
    } else {
        join(&note.body, content)
    };
    save_body(store, note)
}

pub(crate) fn save_body(store: &Store, mut note: Note) -> Result<Value> {
    note.meta.updated_at = crate::now();
    store.commit(vec![notes::plan_body_replacement(store, &note)?])?;
    Ok(serde_json::to_value(notes::read_note(
        store,
        &note.meta.id,
    )?)?)
}

pub fn daily(store: &Store, command: &str, args: &Value) -> Result<Value> {
    let date = args["date"]
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
    if NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .ok()
        .is_none_or(|parsed| parsed.format("%Y-%m-%d").to_string() != date)
    {
        return Err(Error::new("invalid_arguments", "Date must be YYYY-MM-DD"));
    }
    let note = match resolve(store, &date) {
        Ok(note) => serde_json::to_value(note)?,
        Err(error) if error.code == "not_found" && command != "daily.read" => {
            let mut create = json!({"title":date});
            if let Some(folder) = args.get("folderId") {
                create["folderId"] = folder.clone();
            }
            if let Some(content) = args.get("content") {
                create["body"] = content.clone();
            }
            // Validate a destination before creating anything; the vault lock covers lookup + write.
            return notes::create_note(store, &create);
        }
        Err(error) => return Err(error),
    };
    if matches!(command, "daily.read" | "daily.create") {
        return Ok(note);
    }
    let mut edit = args.clone();
    edit["id"] = note["id"].clone();
    append(store, &edit, command == "daily.prepend")
}

pub fn link_audit(store: &Store, command: &str, args: &Value) -> Result<Value> {
    let all = notes::notes(store)?;
    let links = crate::query::links(&all, &crate::databases::records(store)?)?;
    if command == "links.unresolved" {
        return Ok(serde_json::to_value(
            links
                .into_iter()
                .filter(|link| link.target.is_none())
                .collect::<Vec<_>>(),
        )?);
    }
    if command == "links.outgoing" {
        let id = text(args, "id")?;
        notes::read_note(store, id)?;
        return Ok(serde_json::to_value(
            links
                .into_iter()
                .filter(|link| link.source == id)
                .collect::<Vec<_>>(),
        )?);
    }
    Ok(json!(all
        .iter()
        .filter(|note| {
            if command == "notes.orphans" {
                !links.iter().any(|link| {
                    link.target.as_deref() == Some(&note.meta.id) && link.source != note.meta.id
                })
            } else {
                !links.iter().any(|link| link.source == note.meta.id)
            }
        })
        .map(|note| json!({"id":note.meta.id,"title":note.meta.title}))
        .collect::<Vec<_>>()))
}
