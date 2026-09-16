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

struct SourceBlock {
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

fn columns(text: &str) -> usize {
    text.chars()
        .fold(0, |col, ch| col + if ch == '\t' { 4 - col % 4 } else { 1 })
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
        let mut items: Vec<SourceBlock> = Vec::new();
        let mut paragraph = None;
        let mut paragraph_end = 0;
        let mut list_indent = 0;
        let mut inline_depth = 0;
        for (event, range) in Parser::new_ext(&note.body, crate::wiki::options()).into_offset_iter()
        {
            // Do not split a multiline inline construct when it crosses a list boundary.
            match &event {
                Event::Start(
                    Tag::Emphasis
                    | Tag::Strong
                    | Tag::Strikethrough
                    | Tag::Link { .. }
                    | Tag::Image { .. },
                ) => inline_depth += 1,
                Event::End(
                    TagEnd::Emphasis
                    | TagEnd::Strong
                    | TagEnd::Strikethrough
                    | TagEnd::Link
                    | TagEnd::Image,
                ) => inline_depth -= 1,
                _ => {}
            }
            match event {
                Event::Start(Tag::Item) => {
                    // With tab indentation the parser range may include the preceding newline.
                    let raw = &note.body[range.clone()];
                    let start = range.start + raw.len() - raw.trim_start().len();
                    if items.is_empty() {
                        let line_start = starts[line_number(start) - 1];
                        let marker = note.body[start..].split_whitespace().next().unwrap_or("");
                        let end = start + marker.len();
                        let whitespace = note.body[end..]
                            .bytes()
                            .take_while(|ch| matches!(ch, b' ' | b'\t'))
                            .count();
                        let marker_indent = columns(&note.body[line_start..end]);
                        let gap = columns(&note.body[line_start..end + whitespace]) - marker_indent;
                        list_indent = marker_indent + if (1..=4).contains(&gap) { gap } else { 1 };
                    }
                    items.push(SourceBlock {
                        range: start..range.end,
                        topics: BTreeSet::new(),
                    });
                    // Tight lists omit Paragraph events, so use the item's range.
                    paragraph_end = range.end;
                }
                Event::Start(Tag::Paragraph | Tag::Heading { .. }) => {
                    paragraph_end = range.end;
                    if items.is_empty() {
                        paragraph = Some(SourceBlock {
                            range,
                            topics: BTreeSet::new(),
                        });
                    }
                }
                Event::SoftBreak | Event::HardBreak
                    if !items.is_empty() && paragraph.is_none() && inline_depth == 0 =>
                {
                    // Foltra ends a list when text returns to the outer margin,
                    // including Enter on an empty bullet without a blank separator.
                    let next = starts
                        .get(line_number(range.start))
                        .copied()
                        .unwrap_or(note.body.len());
                    let prefix: String = note.body[next..]
                        .chars()
                        .take_while(|ch| matches!(ch, ' ' | '\t' | '>'))
                        .collect();
                    if next < paragraph_end && columns(&prefix) < list_indent {
                        for item in &mut items {
                            item.range.end = item.range.end.min(next);
                        }
                        paragraph = Some(SourceBlock {
                            range: next..paragraph_end,
                            topics: BTreeSet::new(),
                        });
                    }
                }
                Event::Start(Tag::Link {
                    link_type: LinkType::WikiLink { .. },
                    dest_url,
                    ..
                }) => {
                    // List links still select their own bullet and subtree. Standalone
                    // paragraphs/headings collect links from every line of that block.
                    let source = if paragraph.is_some() {
                        paragraph.as_mut()
                    } else if let Some(item) = items.last_mut() {
                        (line_number(range.start) == line_number(item.range.start)).then_some(item)
                    } else {
                        None
                    };
                    let Some(source) = source else {
                        continue;
                    };
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
                    source.topics.insert(id);
                }
                Event::End(end @ (TagEnd::Item | TagEnd::Paragraph | TagEnd::Heading(_))) => {
                    let paragraph = paragraph.take();
                    let item = if end == TagEnd::Item {
                        items.pop()
                    } else {
                        None
                    };
                    for source in paragraph
                        .into_iter()
                        .chain(item)
                        .filter(|s| !s.topics.is_empty())
                    {
                        let line = line_number(source.range.start);
                        let end = note.body[..source.range.end].trim_end().len();
                        for id in &source.topics {
                            topics.get_mut(id).unwrap().block_count += 1;
                            sources.entry(id.clone()).or_default().insert(note_index);
                        }
                        blocks.push(Block {
                            note: note_index,
                            range: starts[line - 1]..end,
                            line,
                            end_line: line_number(end.saturating_sub(1)),
                            topics: source.topics,
                        });
                    }
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

struct Collection {
    index: Index,
    matching: Vec<usize>,
    anchors: Vec<crate::topic_order::Anchor>,
    positions: Vec<usize>,
    sort: String,
    revision: String,
}
fn collection(store: &Store, args: &Value) -> Result<Collection> {
    let topic = text(args, "topic")?;
    let orders = crate::topic_order::load(store)?;
    let saved = orders.topics.get(topic);
    let sort = args.get("sort").and_then(Value::as_str).unwrap_or_else(|| {
        if let Some(descending) = args.get("descending").and_then(Value::as_bool) {
            if descending {
                "newest"
            } else {
                "oldest"
            }
        } else if saved.is_some() {
            "custom"
        } else {
            "newest"
        }
    });
    if !["newest", "oldest", "custom"].contains(&sort) {
        return Err(Error::new("invalid_arguments", "Unknown topic sort"));
    }
    let index = index(store)?;
    let mut matching: Vec<_> = index
        .blocks
        .iter()
        .enumerate()
        .filter(|(_, b)| b.topics.contains(topic))
        .map(|(i, _)| i)
        .collect();
    matching.sort_by(|&a, &b| {
        let a = &index.blocks[a];
        let b = &index.blocks[b];
        let a_note = &index.notes[a.note];
        let b_note = &index.notes[b.note];
        let date = a_note.meta.created_at.cmp(&b_note.meta.created_at);
        (if sort == "oldest" {
            date
        } else {
            date.reverse()
        })
        .then(a_note.meta.id.cmp(&b_note.meta.id))
        .then(a.line.cmp(&b.line))
    });
    // The snapshot includes source revisions, so a stale drag cannot move a
    // different card that has since occupied the same line.
    let mut revision_sources: Vec<_> = matching
        .iter()
        .map(|&i| {
            let b = &index.blocks[i];
            let n = &index.notes[b.note];
            (&n.meta.id, &n.revision, b.line)
        })
        .collect();
    revision_sources.sort();
    let revision =
        crate::storage::revision(&serde_json::to_string(&(topic, revision_sources, saved))?);
    let anchors: Vec<_> = matching
        .iter()
        .map(|&i| {
            let b = &index.blocks[i];
            let n = &index.notes[b.note];
            crate::topic_order::Anchor::new(&n.meta.id, b.line, &excerpt(&n.body[b.range.clone()]))
        })
        .collect();
    let positions = if sort == "custom" {
        crate::topic_order::apply(&anchors, saved.map_or(&[], Vec::as_slice))
    } else {
        (0..matching.len()).collect()
    };
    Ok(Collection {
        index,
        matching,
        anchors,
        positions,
        sort: sort.into(),
        revision,
    })
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
    let result = collection(store, args)?;
    let total = result.matching.len();
    let page: Vec<_> = result.positions.iter().skip(usize::try_from(offset).unwrap_or(usize::MAX))
        .take(limit as usize).map(|&position| {
            let block=&result.index.blocks[result.matching[position]];
            let note = &result.index.notes[block.note];
            json!({"id":result.anchors[position].id(),"noteId":note.meta.id,"noteTitle":note.meta.title,"revision":note.revision,
                "createdAt":note.meta.created_at,"updatedAt":note.meta.updated_at,
                "line":block.line,"endLine":block.end_line,"body":excerpt(&note.body[block.range.clone()])})
        }).collect();
    Ok(
        json!({"topic":result.index.topics.get(topic),"blocks":page,"total":total,"offset":offset,"limit":limit,"sort":result.sort,"orderRevision":result.revision}),
    )
}

pub fn reorder(store: &Store, args: &Value) -> Result<Value> {
    let topic = text(args, "topic")?;
    let mut result = collection(store, args)?;
    crate::validation::check_revision(text(args, "expectedRevision")?, &result.revision)?;
    let source = text(args, "source")?;
    let target = text(args, "target")?;
    let placement = text(args, "placement")?;
    if !["before", "after"].contains(&placement) {
        return Err(Error::new(
            "invalid_arguments",
            "Use before or after placement",
        ));
    }
    let source = result
        .positions
        .iter()
        .position(|&i| result.anchors[i].id() == source);
    let target = result
        .positions
        .iter()
        .position(|&i| result.anchors[i].id() == target);
    let (Some(source), Some(target)) = (source, target) else {
        return Err(Error::new(
            "not_found",
            "주제 카드가 변경됐습니다. 새로고침 후 다시 옮겨 주세요.",
        ));
    };
    if source == target {
        return Ok(json!({"saved":false}));
    }
    let source_card = result.positions.remove(source);
    let target = target - usize::from(source < target) + usize::from(placement == "after");
    result.positions.insert(target, source_card);
    let mut orders = crate::topic_order::load(store)?;
    orders.topics.insert(
        topic.into(),
        result
            .positions
            .iter()
            .map(|&i| result.anchors[i].clone())
            .collect(),
    );
    store.commit(vec![(
        crate::topic_order::PATH.into(),
        Some(crate::validation::pretty(&orders)?),
    )])?;
    Ok(json!({"saved":true}))
}
