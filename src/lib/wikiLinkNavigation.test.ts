import { EditorSelection, EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { expect, test, vi } from 'vitest';
import { followWikiLink, wikiLinkAt } from './wikiLinkNavigation';

test('source links open their destination rather than the alias or neighbouring text', () => {
  const doc = 'Before [[노트 이름#^block|표시 이름]] after';
  const state = EditorState.create({ doc, extensions: [markdown()] });
  expect(wikiLinkAt(state, doc.indexOf('표시'))).toBe('노트 이름#^block');
  expect(wikiLinkAt(state, 0)).toBeNull();
  expect(wikiLinkAt(state, doc.length)).toBeNull();
});

test('following the caret opens only its link, including aliases and either closing bracket', () => {
  const doc = '[[첫 노트]] [[다음 노트|별칭]] 끝';
  for (let position = doc.indexOf('[[다음'); position < doc.indexOf(' 끝'); position++) {
    const state = EditorState.create({ doc, selection: { anchor: position }, extensions: [markdown()] });
    const open = vi.fn();
    expect(followWikiLink(state, open), String(position)).toBe(true);
    expect(open).toHaveBeenCalledExactlyOnceWith('다음 노트');
  }
  const outside = EditorState.create({
    doc,
    selection: { anchor: doc.indexOf(' 끝') },
    extensions: [markdown()],
  });
  const open = vi.fn();
  expect(followWikiLink(outside, open)).toBe(false);
  expect(open).not.toHaveBeenCalled();
});

test('following ignores code examples and ambiguous multiple cursors without changing the document', () => {
  const doc = '`[[코드]]` [[노트]]';
  const base = EditorState.create({
    doc,
    selection: { anchor: doc.indexOf('코드') },
    extensions: [markdown(), EditorState.allowMultipleSelections.of(true)],
  });
  const open = vi.fn();
  expect(followWikiLink(base, open)).toBe(false);
  const multiple = base.update({
    selection: EditorSelection.create([
      EditorSelection.cursor(2),
      EditorSelection.cursor(doc.indexOf('노트')),
    ]),
  }).state;
  expect(followWikiLink(multiple, open)).toBe(false);
  expect(open).not.toHaveBeenCalled();
  expect(multiple.doc.toString()).toBe(doc);
});
test('code and escaped examples are never opened as note links', () => {
  for (const doc of [
    '`[[Foo]]`',
    '```md\n[[Foo]]\n```',
    '    [[Foo]]',
    '\\[[Foo]]',
    '[external](https://example.com/[[Foo]])',
  ]) {
    const state = EditorState.create({ doc, extensions: [markdown()] });
    expect(wikiLinkAt(state, doc.indexOf('Foo')), doc).toBeNull();
  }
});
