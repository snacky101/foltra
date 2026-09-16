import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { expect, test } from 'vitest';
import { tagCompletions, tagCompletionEdit } from './tagCompletion';

const tags = [
  { name: 'anki', noteCount: 2 },
  { name: '개발', noteCount: 3 },
  { name: '개발/rust', noteCount: 1 },
  { name: '한글/학습', noteCount: 1 },
];
function state(doc: string, anchor = doc.length) {
  return EditorState.create({ doc, selection: { anchor }, extensions: [markdown({ extensions: [GFM] })] });
}
function complete(doc: string, anchor = doc.length) {
  return tagCompletions(new CompletionContext(state(doc, anchor), anchor, false), tags);
}

test('a hash opens existing tags, filters case-insensitively and supports nested names', () => {
  expect(
    complete('#')
      ?.options.map((x) => x.label)
      .sort(),
  ).toEqual(tags.map((x) => `#${x.name}`).sort());
  expect(complete('- 질문 #AN')?.options.map((x) => x.label)).toEqual(['#anki']);
  expect(complete('(#개발/')?.options.map((x) => x.label)).toEqual(['#개발/rust']);
  expect(complete('#없는태그')?.options).toEqual([]);
});

test('completion excludes headings, code, comments, links, URLs and escaped hashes', () => {
  for (const doc of [
    '# 제목',
    '##',
    '문장#',
    '\\#',
    '`#an`',
    '```md\n#an',
    '    #an',
    '<!-- #an',
    'https://a/#an',
    '[[#an',
    '[[노트|#an',
    '![#an](file)',
    '[#an](url)',
    '<span title="#an">',
  ]) {
    const cursor = ['![#an](file)', '[#an](url)', '<span title="#an">', '`#an`'].includes(doc)
      ? doc.indexOf('#an') + 3
      : doc.length;
    expect(complete(doc, cursor), doc).toBeNull();
  }
  expect(complete('### 제목 #an')?.options[0].label).toBe('#anki');
});

test('Korean composition updates the same result while typing, selecting marked text and deleting', () => {
  let composing = true;
  let result = complete('#')!;
  for (const input of ['#ㅎ', '#하', '#한', '#한글/', '#한', '#']) {
    const s = state(input);
    result = result.update!(result, 1, input.length, new CompletionContext(s, input.length, false))!;
    expect(result).not.toBeNull();
    expect(result.options.some((x) => x.label === '#한글/학습')).toBe(true);
  }
  const marked = state('#한').update({ selection: { anchor: 1, head: 2 } }).state;
  result = tagCompletions(new CompletionContext(marked, 2, false), tags, () => composing)!;
  expect(result.options[0].label).toBe('#한글/학습');
  composing = false;
  expect(result.update!(result, 1, 2, new CompletionContext(marked, 2, false))).toBeNull();
});

test('accepting a tag replaces its full name and preserves surrounding text and punctuation', () => {
  for (const [doc, cursor, name, expected] of [
    ['#', 1, 'anki', '#anki'],
    ['- 질문 #an', 8, 'anki', '- 질문 #anki'],
    ['#ankixyz, 다음', 3, 'anki', '#anki, 다음'],
    ['#개발/rus 뒤', 6, '개발/rust', '#개발/rust 뒤'],
  ] as const) {
    const s = state(doc, cursor),
      result = complete(doc, cursor)!;
    const next = s.update(tagCompletionEdit(s, result.from, cursor, name)).state;
    expect(next.doc.toString()).toBe(expected);
    expect(next.selection.main.head).toBe(result.from + name.length);
  }
});

test('unsaved tags elsewhere in the note are suggested once without inventing a tag from the current query', () => {
  const result = complete('#새태그 #anki #새태그\n#새')!;
  expect(result.options).toHaveLength(1);
  expect(result.options[0]).toMatchObject({ label: '#새태그', detail: '현재 노트' });
  expect(complete('#anki\n#')?.options.filter((x) => x.label === '#anki')).toHaveLength(1);
});

test('leaving a tag for a space or slash command closes the current result', () => {
  const result = complete('#an')!;
  for (const input of ['#an ', '/command', 'ordinary']) {
    const s = state(input);
    expect(result.update!(result, 1, s.doc.length, new CompletionContext(s, s.doc.length, false))).toBeNull();
  }
});
