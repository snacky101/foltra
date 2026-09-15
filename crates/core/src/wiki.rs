use crate::Note;
use pulldown_cmark::{Event, LinkType, Options, Parser, Tag};
use std::ops::Range;

pub fn options() -> Options {
    Options::ENABLE_WIKILINKS
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
}

pub fn resolve_note<'a>(notes: &'a [Note], name: &str) -> Option<&'a Note> {
    if let Some(note) = notes.iter().find(|n| n.meta.id == name) {
        return Some(note);
    }
    // Record links have their own namespace, even if a note shares their spelling.
    if name.starts_with("record:") {
        return None;
    }
    let mut matches = notes.iter().filter(|n| n.meta.title == name);
    let first = matches.next()?;
    matches.next().is_none().then_some(first)
}

fn target<'a>(note: &'a Note, notes: &[Note]) -> &'a str {
    let title = &note.meta.title;
    if !title.contains(['[', ']', '|', '#', '\n', '\r', '\\'])
        && resolve_note(notes, title).is_some_and(|n| n.meta.id == note.meta.id)
    {
        title
    } else {
        &note.meta.id
    }
}

fn label(title: &str) -> String {
    title.replace(['[', ']', '\n', '\r', '\\'], " ")
}

pub fn note_link(note: &Note, notes: &[Note]) -> String {
    let name = target(note, notes);
    if name == note.meta.title {
        format!("[[{name}]]")
    } else {
        format!("[[{name}|{}]]", label(&note.meta.title))
    }
}

pub struct WikiLink<'a> {
    pub range: Range<usize>,
    pub name: &'a str,
    pub suffix: &'a str,
    pub alias: Option<&'a str>,
}
impl WikiLink<'_> {
    pub fn label(&self) -> String {
        self.alias
            .map(str::to_string)
            .unwrap_or_else(|| format!("{}{}", self.name, self.suffix))
    }
}

// Use Markdown source ranges so rewrites preserve aliases, whitespace and literal examples.
pub fn spans(body: &str) -> impl Iterator<Item = WikiLink<'_>> {
    Parser::new_ext(body, options())
        .into_offset_iter()
        .filter_map(move |(event, range)| {
            if !matches!(
                event,
                Event::Start(Tag::Link {
                    link_type: LinkType::WikiLink { .. },
                    ..
                })
            ) {
                return None;
            }
            let raw = body[range.clone()].strip_prefix("[[")?.strip_suffix("]]")?;
            let (destination, alias) = raw
                .split_once('|')
                .map_or((raw, None), |(a, b)| (a, Some(b)));
            let split = destination.find('#').unwrap_or(destination.len());
            Some(WikiLink {
                range,
                name: &destination[..split],
                suffix: &destination[split..],
                alias,
            })
        })
}

pub fn rewrite(body: &str, before: &[Note], after: &[Note], normalize: bool) -> String {
    let mut result = String::new();
    let mut end = 0;
    for link in spans(body) {
        let old = resolve_note(before, link.name);
        let resolved = old.or_else(|| resolve_note(after, link.name));
        let Some(note) = resolved else { continue };
        let current = after.iter().find(|n| n.meta.id == note.meta.id);
        let name = current.map(|n| target(n, after)).unwrap_or(&note.meta.id);
        if !normalize && old.is_none_or(|n| target(n, before) == name) {
            continue;
        }
        result.push_str(&body[end..link.range.start]);
        result.push_str("[[");
        result.push_str(name);
        result.push_str(link.suffix);
        if let Some(alias) = link.alias {
            result.push('|');
            result.push_str(alias);
        } else if current.is_none() || current.is_some_and(|n| name != n.meta.title) {
            result.push('|');
            result.push_str(&label(&note.meta.title));
            result.push_str(link.suffix);
        }
        result.push_str("]]");
        end = link.range.end;
    }
    result.push_str(&body[end..]);
    result
}
