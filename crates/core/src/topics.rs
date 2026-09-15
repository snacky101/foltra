use crate::{notes, storage::Store, text, wiki::resolve_note, Error, Note, Result};
use pulldown_cmark::{Event, LinkType, Parser, Tag, TagEnd};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    ops::Range,
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Topic {
    id: String,
    title: String,
    note_id: Option<String>,
    block_count: usize,
    note_count: usize,
}

struct Item {
    range: Range<usize>,
    topics: BTreeSet<String>,
}
struct Block {
    note: usize,
    range: Range<usize>,
    line: usize,
    end_line: usize,
    topics: BTreeSet<String>,
}
struct Index {
    notes: Vec<Note>,
    topics: BTreeMap<String, Topic>,
    blocks: Vec<Block>,
}

fn index(store: &Store) -> Result<Index> {
    let notes = notes::notes(store)?;
    let mut topics = BTreeMap::new();
    let mut sources: BTreeMap<String, BTreeSet<usize>> = BTreeMap::new();
    let mut blocks = Vec::new();
    let mut resolved_names = BTreeMap::new();
    for (note_index, note) in notes.iter().enumerate() {
        let starts: Vec<_> = std::iter::once(0)
            .chain(note.body.match_indices('\n').map(|(i, _)| i + 1))
            .collect();
        let line_number = |offset| starts.partition_point(|start| *start <= offset);
        let mut items: Vec<Item> = Vec::new();
        for (event, range) in Parser::new_ext(&note.body, crate::wiki::options()).into_offset_iter()
        {
            match event {
                Event::Start(Tag::Item) => {
                    // With tab indentation the parser range may include the preceding newline.
                    let raw = &note.body[range.clone()];
                    let start = range.start + raw.len() - raw.trim_start().len();
                    items.push(Item {
                        range: start..range.end,
                        topics: BTreeSet::new(),
                    });
                }
                Event::Start(Tag::Link {
                    link_type: LinkType::WikiLink { .. },
                    dest_url,
                    ..
                }) => {
                    let Some(item) = items.last_mut() else {
                        continue;
                    };
                    // Only a link on the item's own bullet line selects it. Child links select the child.
                    if line_number(range.start) != line_number(item.range.start) {
                        continue;
                    }
                    let name = dest_url.split('#').next().unwrap_or("");
                    if name.is_empty() {
                        continue;
                    }
                    let resolved = *resolved_names
                        .entry(name.to_string())
                        .or_insert_with(|| resolve_note(&notes, name));
                    let is_id = crate::id(name).is_ok();
                    let id = resolved
                        .map(|n| format!("note:{}", n.meta.id))
                        .unwrap_or_else(|| {
                            format!("{}:{name}", if is_id { "note" } else { "name" })
                        });
                    let label = note.body[range.clone()]
                        .strip_prefix("[[")
                        .and_then(|s| s.strip_suffix("]]"))
                        .and_then(|s| s.split_once('|'))
                        .map(|(_, label)| label)
                        .filter(|s| !s.is_empty());
                    topics.entry(id.clone()).or_insert_with(|| Topic {
                        id: id.clone(),
                        title: resolved.map(|n| n.meta.title.clone()).unwrap_or_else(|| {
                            if is_id { label.unwrap_or(name) } else { name }.into()
                        }),
                        note_id: resolved.map(|n| n.meta.id.clone()),
                        block_count: 0,
                        note_count: 0,
                    });
                    item.topics.insert(id);
                }
                Event::End(TagEnd::Item) => {
                    let item = items.pop().expect("balanced Markdown item events");
                    if item.topics.is_empty() {
                        continue;
                    }
                    let line = line_number(item.range.start);
                    let end = note.body[..item.range.end].trim_end().len();
                    for id in &item.topics {
                        topics.get_mut(id).unwrap().block_count += 1;
                        sources.entry(id.clone()).or_default().insert(note_index);
                    }
                    blocks.push(Block {
                        note: note_index,
                        range: starts[line - 1]..end,
                        line,
                        end_line: line_number(end.saturating_sub(1)),
                        topics: item.topics,
                    });
                }
                _ => {}
            }
        }
    }
    for (id, source_notes) in sources {
        topics.get_mut(&id).unwrap().note_count = source_notes.len();
    }
    Ok(Index {
        notes,
        topics,
        blocks,
    })
}

// Lift a nested item to the card's root without changing relative child/code indentation.
fn excerpt(source: &str) -> String {
    let expanded: Vec<_> = source
        .lines()
        .map(|line| {
            let mut columns = 0;
            let mut bytes = 0;
            for ch in line.bytes() {
                match ch {
                    b' ' => columns += 1,
                    b'\t' => columns += 4 - columns % 4,
                    _ => break,
                }
                bytes += 1;
            }
            format!("{}{}", " ".repeat(columns), &line[bytes..])
        })
        .collect();
    let indent = expanded
        .iter()
        .filter(|line| !line.trim().is_empty())
        .map(|line| line.bytes().take_while(|c| *c == b' ').count())
        .min()
        .unwrap_or(0);
    expanded
        .iter()
        .map(|line| &line[indent.min(line.bytes().take_while(|c| *c == b' ').count())..])
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn list(store: &Store) -> Result<Value> {
    let mut topics: Vec<_> = index(store)?.topics.into_values().collect();
    topics.sort_by(|a, b| a.title.cmp(&b.title).then(a.id.cmp(&b.id)));
    Ok(serde_json::to_value(topics)?)
}

pub fn blocks(store: &Store, args: &Value) -> Result<Value> {
    let topic = text(args, "topic")?;
    let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(50);
    if !(1..=100).contains(&limit) {
        return Err(Error::new(
            "query_limit",
            "Topic blocks require a limit between 1 and 100",
        ));
    }
    let offset = args.get("offset").and_then(Value::as_u64).unwrap_or(0);
    let descending = args
        .get("descending")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let index = index(store)?;
    let mut matching: Vec<_> = index
        .blocks
        .iter()
        .filter(|b| b.topics.contains(topic))
        .collect();
    matching.sort_by(|a, b| {
        let a_note = &index.notes[a.note];
        let b_note = &index.notes[b.note];
        let date = a_note.meta.created_at.cmp(&b_note.meta.created_at);
        (if descending { date.reverse() } else { date })
            .then(a_note.meta.id.cmp(&b_note.meta.id))
            .then(a.line.cmp(&b.line))
    });
    let total = matching.len();
    let page: Vec<_> = matching.into_iter().skip(usize::try_from(offset).unwrap_or(usize::MAX))
        .take(limit as usize).map(|block| {
            let note = &index.notes[block.note];
            json!({"noteId":note.meta.id,"noteTitle":note.meta.title,"revision":note.revision,
                "createdAt":note.meta.created_at,"updatedAt":note.meta.updated_at,
                "line":block.line,"endLine":block.end_line,"body":excerpt(&note.body[block.range.clone()])})
        }).collect();
    Ok(
        json!({"topic":index.topics.get(topic),"blocks":page,"total":total,"offset":offset,"limit":limit}),
    )
}
