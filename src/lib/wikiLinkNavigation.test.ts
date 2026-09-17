import { EditorSelection, EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { expect, test, vi } from 'vitest';
import { followEditorLink, followWikiLink, linkAt, wikiLinkAt } from './wikiLinkNavigation';

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

test('Markdown links resolve anywhere inside their label, destination, title and delimiters', () => {
  const source = '[검색하기](https://example.com/search?q=foltra "Search title")';
  const doc = `Before ${source} after`;
  const state = EditorState.create({ doc, extensions: [markdown()] });
  for (let position = 7; position < 7 + source.length; position++) {
    expect(linkAt(state, position), String(position)).toEqual({
      kind: 'markdown',
      label: '검색하기',
      target: 'https://example.com/search?q=foltra',
      from: 7,
      to: 7 + source.length,
    });
  }
  expect(linkAt(state, 6)).toBeNull();
  expect(linkAt(state, 7 + source.length)).toBeNull();
});

test.each([
  ['[nested](https://example.com/path(foo(bar)))', 'https://example.com/path(foo(bar))', 'nested'],
  ['[space](<https://example.com/a%20b> "title")', 'https://example.com/a%20b', 'space'],
  ['[a\\]b](https://example.com/a\\(b\\))', 'https://example.com/a(b)', 'a]b'],
  ['[mail](mailto:hello@example.com)', 'mailto:hello@example.com', 'mail'],
  ['<https://example.com>', 'https://example.com', 'https://example.com'],
  ['<hello@example.com>', 'mailto:hello@example.com', 'hello@example.com'],
  ['[first\nsecond](https://example.com)', 'https://example.com', 'first second'],
  ['[a&amp;b](https://example.com/?a=1&amp;b=2)', 'https://example.com/?a=1&b=2', 'a&b'],
  ['[web](https&#58;//example.com)', 'https://example.com', 'web'],
  ['[literal](https://example.com/?a=1\\&amp;b=2)', 'https://example.com/?a=1&amp;b=2', 'literal'],
  ['[numeric](https://example.com/?q=&#x41;)', 'https://example.com/?q=A', 'numeric'],
  [
    '<https://example.com/?a=1&amp;b=2>',
    'https://example.com/?a=1&amp;b=2',
    'https://example.com/?a=1&amp;b=2',
  ],
])('Markdown syntax uses parsed URL boundaries: %s', (doc, target, label) => {
  const state = EditorState.create({ doc, extensions: [markdown()] });
  expect(linkAt(state, 1)).toMatchObject({ kind: 'markdown', target, label });
  expect(wikiLinkAt(state, 1)).toBeNull();
});

test.each([
  '`[label](https://example.com)`',
  '```md\n[label](https://example.com)\n```',
  '    [label](https://example.com)',
  '\\[label](https://example.com)',
  '![label](https://example.com)',
  '![image [label](https://example.com)](image.png)',
  '<div>\n[label](https://example.com)\n</div>',
])('Markdown examples and image sources are not navigable: %s', (doc) => {
  const state = EditorState.create({ doc, extensions: [markdown()] });
  expect(linkAt(state, doc.indexOf('label'))).toBeNull();
  expect(linkAt(state, doc.indexOf('https'))).toBeNull();
});

test('generic follow dispatches to the correct link handler without changing content or selection', () => {
  const doc = '[[노트 이름|별칭]] [web](https://example.com)';
  const openWiki = vi.fn();
  const openMarkdown = vi.fn();
  const state = EditorState.create({
    doc,
    selection: { anchor: doc.indexOf('별칭') },
    extensions: [markdown(), EditorState.allowMultipleSelections.of(true)],
  });
  expect(followEditorLink(state, { openWiki, openMarkdown })).toBe(true);
  expect(openWiki).toHaveBeenCalledExactlyOnceWith('노트 이름');
  expect(openMarkdown).not.toHaveBeenCalled();
  const web = state.update({ selection: { anchor: doc.indexOf('web') } }).state;
  expect(followEditorLink(web, { openWiki, openMarkdown })).toBe(true);
  expect(openMarkdown).toHaveBeenCalledExactlyOnceWith('https://example.com');
  expect(web.doc.toString()).toBe(doc);
  expect(web.selection.main.head).toBe(doc.indexOf('web'));
  const multiple = web.update({
    selection: EditorSelection.create([
      EditorSelection.cursor(2),
      EditorSelection.cursor(doc.indexOf('web')),
    ]),
  }).state;
  expect(followEditorLink(multiple, { openWiki, openMarkdown })).toBe(false);
  expect(openWiki).toHaveBeenCalledTimes(1);
  expect(openMarkdown).toHaveBeenCalledTimes(1);
});
