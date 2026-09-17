use crate::{id, new_id, now, text, Error, Note, NoteMeta, Result};
use crate::{storage::Store, validation::*, wiki};
use serde_json::{json, Value};

pub(crate) fn note_path(note_id: &str) -> Result<String> {
    Ok(format!("notes/{}.md", id(note_id)?))
}

pub fn read_note(store: &Store, note_id: &str) -> Result<Note> {
    let note = Note::parse(&store.read(&note_path(note_id)?)?)?;
    if note.meta.id != note_id {
        return Err(Error::new(
            "invalid_note",
            "Note ID does not match its filename",
        ));
    }
    Ok(note)
}

pub fn notes(store: &Store) -> Result<Vec<Note>> {
    let mut out = vec![];
    for path in store.files("notes", "md")? {
        let note = Note::parse(&store.read(&path)?)?;
        if note_path(&note.meta.id)? != path {
            return Err(Error::new(
                "invalid_note",
                format!("Note ID does not match filename: {path}"),
            ));
        }
        out.push(note);
    }
    out.sort_by(|a, b| b.meta.updated_at.cmp(&a.meta.updated_at));
    Ok(out)
}

pub fn create_note(store: &Store, args: &Value) -> Result<Value> {
    let time = now();
    let meta = NoteMeta {
        id: new_id(),
        title: nonempty(text(args, "title")?, "Title")?,
        created_at: time.clone(),
        updated_at: time,
        folder_id: crate::folders::destination(store, args.get("folderId"))?,
    };
    let body = args.get("body").and_then(Value::as_str).unwrap_or("");
    let note = Note {
        meta,
        body: body.into(),
        revision: String::new(),
    };
    store.commit(plan_note_write(store, &note.meta.id, Some(&note))?)?;
    Ok(serde_json::to_value(read_note(store, &note.meta.id)?)?)
}

// Resolution and optional creation share the vault lock, including concurrent GUI/CLI opens.
pub fn open_link(store: &Store, args: &Value) -> Result<Value> {
    let target = text(args, "target")?;
    let all = notes(store)?;
    if let Some(note) = wiki::resolve_note(&all, target) {
        return Ok(serde_json::to_value(note)?);
    }
    if all.iter().any(|note| note.meta.title == target) {
        return Err(Error::new(
            "ambiguous_link",
            "같은 제목의 노트가 여러 개입니다. 자동완성에서 노트를 선택해 주세요.",
        ));
    }
    if target.starts_with("record:") || id(target).is_ok() {
        return Err(Error::new(
            "not_found",
            "연결 대상을 찾을 수 없습니다. 삭제된 노트는 휴지통에서 복원해 주세요.",
        ));
    }
    let title = nonempty(target, "Title")?;
    if title != target || title.contains(['[', ']', '|', '#', '\n', '\r', '\\']) {
        return Err(Error::new(
            "invalid_link",
            "노트 링크의 대상 이름이 올바르지 않습니다.",
        ));
    }
    create_note(store, &json!({"title":title}))
}

pub fn update_note(store: &Store, args: &Value) -> Result<Value> {
    let mut note = read_note(store, text(args, "id")?)?;
    check_revision(text(args, "expectedRevision")?, &note.revision)?;
    if args.get("folderId").is_some() {
        note.meta.folder_id = crate::folders::destination(store, args.get("folderId"))?;
    }
    if let Some(title) = args.get("title") {
        note.meta.title = nonempty(
            title
                .as_str()
                .ok_or_else(|| Error::new("invalid_arguments", "Title must be text"))?,
            "Title",
        )?;
    }
    if let Some(body) = args.get("body") {
        note.body = body
            .as_str()
            .ok_or_else(|| Error::new("invalid_arguments", "Body must be text"))?
            .into();
    }
    note.meta.updated_at = now();
    store.commit(plan_note_write(store, &note.meta.id, Some(&note))?)?;
    Ok(serde_json::to_value(read_note(store, &note.meta.id)?)?)
}

pub fn delete_note(store: &Store, args: &Value) -> Result<Value> {
    let note = read_note(store, text(args, "id")?)?;
    check_revision(text(args, "expectedRevision")?, &note.revision)?;
    let path = note_path(&note.meta.id)?;
    // Freeze outgoing destinations while the source is in trash; targets can be renamed meanwhile.
    let body = wiki::rewrite(&note.body, &notes(store)?, &[], true);
    let tombstone = json!({"id":new_id(),"kind":"note","title":note.meta.title,"deletedAt":now(),"originalPath":path,"content":Note::encode(&note.meta, &body)?});
    let mut writes = plan_note_write(store, &note.meta.id, None)?;
    writes.push((
        format!("trash/{}.json", tombstone["id"].as_str().unwrap()),
        Some(pretty(&tombstone)?),
    ));
    store.commit(writes)?;
    Ok(json!({"deleted":note.meta.id}))
}

// The caller adds any related record/trash writes and commits the entire plan under the vault lock.
pub(crate) fn plan_note_write(
    store: &Store,
    note_id: &str,
    replacement: Option<&Note>,
) -> Result<Vec<(String, Option<String>)>> {
    let replacements = replacement.cloned().into_iter().collect::<Vec<_>>();
    let deleted = if replacement.is_none() {
        vec![note_id.to_string()]
    } else {
        vec![]
    };
    plan_note_batch(store, &replacements, &deleted, None)
}

// A subtree operation must rewrite links and topic identities against one complete before/after
// snapshot, rather than concatenate single-note plans with conflicting writes for the same source.
pub(crate) fn plan_note_batch(
    store: &Store,
    replacements: &[Note],
    deleted: &[String],
    restore_sources: Option<&[Note]>,
) -> Result<Vec<(String, Option<String>)>> {
    let before = notes(store)?;
    let targets_changed = !deleted.is_empty()
        || replacements.iter().any(|replacement| {
            before
                .iter()
                .find(|n| n.meta.id == replacement.meta.id)
                .map(|n| &n.meta.title)
                != Some(&replacement.meta.title)
        });
    let mut after = before.clone();
    after.retain(|n| {
        !deleted.contains(&n.meta.id)
            && !replacements
                .iter()
                .any(|replacement| replacement.meta.id == n.meta.id)
    });
    after.extend_from_slice(replacements);
    let mut writes = vec![];
    for note in &after {
        let selected = replacements
            .iter()
            .any(|replacement| replacement.meta.id == note.meta.id);
        if !selected && !targets_changed {
            continue;
        }
        let previous = before.iter().find(|n| n.meta.id == note.meta.id);
        let source_targets = if selected && previous.is_none() {
            restore_sources.unwrap_or(&after)
        } else {
            &before
        };
        let body = wiki::rewrite(&note.body, source_targets, &after, selected);
        if !selected && body == note.body {
            continue;
        }
        let mut meta = note.meta.clone();
        if body != note.body {
            meta.updated_at = now();
        }
        let raw = Note::encode(&meta, &body)?;
        if raw.len() > 16 * 1024 * 1024 {
            return Err(Error::new("file_too_large", "Note exceeds 16 MiB"));
        }
        writes.push((note_path(&meta.id)?, Some(raw)));
    }
    for note_id in deleted {
        writes.push((note_path(note_id)?, None));
    }
    if targets_changed {
        if let Some(write) = crate::topic_order::rekey(store, &before, &after)? {
            writes.push(write);
        }
    }
    Ok(writes)
}
