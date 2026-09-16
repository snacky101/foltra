use crate::{notes, storage::Store, text, Error, Result};
use pulldown_cmark::{Event, Parser, Tag};
use regex::Regex;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    ops::Range,
    sync::LazyLock,
};
static TOKEN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r##"(^|[\s(\[{"'“‘>*~])#([\p{L}\p{N}_][\p{L}\p{N}\p{M}_-]*(?:/[\p{L}\p{N}_][\p{L}\p{N}\p{M}_-]*)*)"##).unwrap()
});
pub struct Span {
    pub name: String,
    pub range: Range<usize>,
}
pub fn spans(body: &str) -> Vec<Span> {
    let mut excluded = vec![];
    for (event, range) in Parser::new_ext(body, crate::wiki::options()).into_offset_iter() {
        if matches!(
            event,
            Event::Start(Tag::CodeBlock(_) | Tag::HtmlBlock | Tag::Link { .. } | Tag::Image { .. })
                | Event::Code(_)
                | Event::Html(_)
                | Event::InlineHtml(_)
        ) {
            excluded.push(range);
        }
    }
    TOKEN
        .captures_iter(body)
        .filter_map(|m| {
            let name = m.get(2).unwrap();
            let from = name.start() - 1;
            if name.as_str().chars().count() > 128 || excluded.iter().any(|r| r.contains(&from)) {
                return None;
            }
            Some(Span {
                name: name.as_str().to_lowercase(),
                range: from..name.end(),
            })
        })
        .collect()
}
pub fn list(store: &Store) -> Result<Value> {
    let mut tags: BTreeMap<String, usize> = BTreeMap::new();
    for note in notes::notes(store)? {
        for name in spans(&note.body)
            .into_iter()
            .map(|s| s.name)
            .collect::<BTreeSet<_>>()
        {
            *tags.entry(name).or_default() += 1;
        }
    }
    Ok(json!(tags
        .into_iter()
        .map(|(name, note_count)| json!({"name":name,"noteCount":note_count}))
        .collect::<Vec<_>>()))
}
pub fn search(store: &Store, name: &str) -> Result<Value> {
    let name = name.trim().trim_start_matches('#').to_lowercase();
    Ok(json!(notes::notes(store)?.into_iter().filter_map(|note| {
        let span=spans(&note.body).into_iter().find(|s|s.name==name)?;
        let start=note.body[..span.range.start].rfind('\n').map_or(0,|p|p+1);
        Some(json!({"id":note.meta.id,"title":note.meta.title,"excerpt":note.body[start..].chars().take(180).collect::<String>()}))
    }).take(100).collect::<Vec<_>>()))
}
pub fn blocks(store: &Store, args: &Value) -> Result<Value> {
    let name = text(args, "tag")?.trim_start_matches('#').to_lowercase();
    let offset = args["offset"].as_u64().unwrap_or(0) as usize;
    let limit = args["limit"].as_u64().unwrap_or(100) as usize;
    if name.is_empty() || name.len() > 512 || limit > 200 {
        return Err(Error::new(
            "invalid_arguments",
            "Use a tag and at most 200 blocks",
        ));
    }
    let mut blocks = vec![];
    for note in notes::notes(store)? {
        let hits = spans(&note.body)
            .into_iter()
            .filter(|s| s.name == name)
            .collect::<Vec<_>>();
        let mut items = vec![];
        let mut paragraphs = vec![];
        for (event, range) in Parser::new_ext(&note.body, crate::wiki::options()).into_offset_iter()
        {
            match event {
                Event::Start(Tag::Item) => items.push(range),
                Event::Start(Tag::Paragraph) => paragraphs.push(range),
                _ => {}
            }
        }
        let mut used = BTreeSet::new();
        for hit in hits {
            let start = note.body[..hit.range.start]
                .rfind('\n')
                .map_or(0, |p| p + 1);
            let range = items
                .iter()
                .filter(|r| {
                    r.start >= start && r.start <= hit.range.start && r.end >= hit.range.end
                })
                .min_by_key(|r| r.end - r.start)
                .or_else(|| paragraphs.iter().find(|r| r.contains(&hit.range.start)))
                .cloned()
                .unwrap_or(
                    start
                        ..note.body[hit.range.end..]
                            .find('\n')
                            .map_or(note.body.len(), |p| p + hit.range.end),
                );
            if !used.insert(range.start) {
                continue;
            }
            blocks.push(json!({"noteId":note.meta.id,"title":note.meta.title,"revision":note.revision,"line":note.body[..range.start].bytes().filter(|b|*b==b'\n').count()+1,"body":note.body[range].trim_end()}));
        }
    }
    let total = blocks.len();
    Ok(
        json!({"blocks":blocks.into_iter().skip(offset).take(limit).collect::<Vec<_>>(),"total":total}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_tag_grammar() {
        let cases: Value =
            serde_json::from_str(include_str!("../../../tests/fixtures/tags.json")).unwrap();
        for case in cases.as_array().unwrap() {
            assert_eq!(
                json!(spans(case["body"].as_str().unwrap())
                    .iter()
                    .map(|s| &s.name)
                    .collect::<Vec<_>>()),
                case["tags"]
            );
        }
    }
    #[test]
    fn tagged_blocks_include_children_and_search_is_exact() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().to_str().unwrap();
        crate::execute(p, "vault.init", json!({"name":"Tags"})).unwrap();
        crate::execute(p,"note.create",json!({"title":"Tagged","body":"- 질문 #anki\n  - 답\n  - 하위 #other\n- 무관 #anki-more\n\n문장 #anki\n다음 문장"})).unwrap();
        let result = crate::execute(p, "tags.blocks", json!({"tag":"anki"})).unwrap();
        assert_eq!(result["total"], 2);
        assert!(result["blocks"][0]["body"]
            .as_str()
            .unwrap()
            .contains("하위"));
        assert!(!result["blocks"][0]["body"]
            .as_str()
            .unwrap()
            .contains("무관"));
        assert_eq!(
            crate::execute(p, "search", json!({"query":"tag:anki"}))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(crate::execute(p, "search", json!({"query":"tag:ank"}))
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty());
    }
}
