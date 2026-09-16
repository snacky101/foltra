use crate::{
    storage::{revision, Store},
    validation::pretty,
    wiki, Error, Note, Result,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const PATH: &str = ".foltra/topic-order.json";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Anchor {
    pub note_id: String,
    pub line: usize,
    hash: String,
    head: String,
}
impl Anchor {
    pub fn new(note_id: &str, line: usize, body: &str) -> Self {
        // Renaming/resolving a wiki destination must not change the card's identity.
        let mut canonical = String::new();
        let mut end = 0;
        for link in wiki::spans(body) {
            canonical.push_str(&body[end..link.range.start]);
            canonical.push_str("[[link]]");
            end = link.range.end;
        }
        canonical.push_str(&body[end..]);
        Self {
            note_id: note_id.into(),
            line,
            hash: revision(&canonical),
            head: revision(canonical.lines().next().unwrap_or("")),
        }
    }
    pub fn id(&self) -> String {
        format!("{}:{}", self.note_id, self.line)
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Orders {
    version: u32,
    pub topics: BTreeMap<String, Vec<Anchor>>,
}
pub fn parse(raw: &str) -> Result<Orders> {
    let data: Orders = serde_json::from_str(raw)?;
    if data.version != 1 {
        return Err(Error::new(
            "unsupported_format",
            "Unsupported topic order version",
        ));
    }
    for (topic, anchors) in &data.topics {
        if topic.len() > 1024 || !(topic.starts_with("name:") || topic.starts_with("note:")) {
            return Err(Error::new("invalid_data", "Invalid topic order key"));
        }
        let mut seen = BTreeSet::new();
        for anchor in anchors {
            crate::id(&anchor.note_id)?;
            if anchor.line == 0
                || !seen.insert((&anchor.note_id, anchor.line))
                || [&anchor.hash, &anchor.head]
                    .iter()
                    .any(|s| s.len() != 64 || !s.bytes().all(|b| b.is_ascii_hexdigit()))
            {
                return Err(Error::new("invalid_data", "Invalid topic card anchor"));
            }
        }
    }
    Ok(data)
}
pub fn load(store: &Store) -> Result<Orders> {
    store.optional(PATH)?.map_or_else(
        || {
            Ok(Orders {
                version: 1,
                topics: BTreeMap::new(),
            })
        },
        |raw| parse(&raw),
    )
}
pub fn file_revision(store: &Store) -> Result<String> {
    Ok(revision(&store.optional(PATH)?.unwrap_or_default()))
}

// Resolve content first, then surviving first lines. For in-place edits with the
// same remaining block count, retain source order within each note. Ambiguous
// insertions/deletions get appended rather than borrowing another note's position.
pub fn apply(current: &[Anchor], saved: &[Anchor]) -> Vec<usize> {
    let mut matched = BTreeMap::new();
    let mut used = BTreeSet::new();
    let mut previous: Vec<_> = (0..saved.len()).collect();
    previous.sort_by_key(|&i| (&saved[i].note_id, saved[i].line));
    for head in [false, true] {
        for &old in &previous {
            if matched.contains_key(&old) {
                continue;
            }
            let a = &saved[old];
            let candidates: Vec<_> = current
                .iter()
                .enumerate()
                .filter(|(i, b)| {
                    !used.contains(i)
                        && a.note_id == b.note_id
                        && if head {
                            a.head == b.head
                        } else {
                            a.hash == b.hash
                        }
                })
                .map(|(i, _)| i)
                .collect();
            if head && candidates.len() != 1 {
                continue;
            }
            if let Some(&new) = candidates.first() {
                matched.insert(old, new);
                used.insert(new);
            }
        }
    }
    let notes: BTreeSet<_> = saved.iter().map(|a| &a.note_id).collect();
    for note in notes {
        let ordered: Vec<_> = previous
            .iter()
            .copied()
            .filter(|&i| &saved[i].note_id == note)
            .collect();
        let mut gaps: BTreeMap<_, Vec<usize>> = BTreeMap::new();
        for (position, &old) in ordered.iter().enumerate() {
            if matched.contains_key(&old) {
                continue;
            }
            let before = ordered[..position]
                .iter()
                .rev()
                .find_map(|i| matched.get(i).copied());
            let after = ordered[position + 1..]
                .iter()
                .find_map(|i| matched.get(i).copied());
            gaps.entry((before, after)).or_default().push(old);
        }
        for ((before, after), old) in gaps {
            let new: Vec<_> = current
                .iter()
                .enumerate()
                .filter(|(i, a)| {
                    &a.note_id == note
                        && !used.contains(i)
                        && before.is_none_or(|b| a.line > current[b].line)
                        && after.is_none_or(|b| a.line < current[b].line)
                })
                .map(|(i, _)| i)
                .collect();
            if old.len() == new.len() {
                for (a, b) in old.into_iter().zip(new) {
                    matched.insert(a, b);
                    used.insert(b);
                }
            }
        }
    }
    matched
        .into_values()
        .chain((0..current.len()).filter(|i| !used.contains(i)))
        .collect()
}

// Keep unresolved topic names attached to their destination when a note is
// created/renamed. The caller commits this alongside all related note writes.
pub fn rekey(
    store: &Store,
    before: &[Note],
    after: &[Note],
) -> Result<Option<(String, Option<String>)>> {
    if store.optional(PATH)?.is_none() {
        return Ok(None);
    }
    let mut orders = load(store)?;
    let mut changes = vec![];
    for key in orders.topics.keys() {
        if let Some(name) = key.strip_prefix("name:") {
            if let Some(note) =
                wiki::resolve_note(before, name).or_else(|| wiki::resolve_note(after, name))
            {
                changes.push((key.clone(), format!("note:{}", note.meta.id)));
            }
        }
    }
    if changes.is_empty() {
        return Ok(None);
    }
    for (old, new) in changes {
        let entries = orders.topics.remove(&old).unwrap();
        orders.topics.entry(new).or_insert(entries);
    }
    Ok(Some((PATH.into(), Some(pretty(&orders)?))))
}
