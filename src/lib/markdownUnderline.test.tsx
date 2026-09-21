import { EditorSelection, EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { GFM } from '@lezer/markdown';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { NotePreview } from '../components/NotePreview';
import { livePreviewDecorations } from './livePreview';
import { underlineRanges } from './markdownUnderline';
import type { Workspace } from './types';

const context = {
  workspace: { notes: [], records: [], databases: [], extensions: [] } as unknown as Workspace,
  openNote() {},
  openLink() {},
};
function preview(body: string) {
  return renderToStaticMarkup(<NotePreview body={body} {...context} executeQueries={false} />);
}
function state(doc: string, anchor = doc.length) {
  return EditorState.create({
    doc,
    selection: { anchor },
    extensions: [yamlFrontmatter({ content: markdown({ extensions: [GFM] }) })],
  });
}
function decorations(editor: EditorState, focused = true) {
  const result: { from: number; to: number; className: string; hidden: boolean }[] = [];
  livePreviewDecorations(editor, context, focused).between(0, editor.doc.length, (from, to, value) => {
    result.push({
      from,
      to,
      className: value.spec.class ?? '',
      hidden: from < to && !value.spec.class && !value.spec.widget,
    });
  });
  return result;
}

test.each([
  ['<u>hello</u>', '<p><u>hello</u></p>'],
  ['앞 <u>안녕 👋</u> 뒤', '앞 <u>안녕 👋</u> 뒤'],
  [
    '<u>**bold** *italic* ~~gone~~ `code`</u>',
    '<u><strong>bold</strong> <em>italic</em> <del>gone</del> <code>code</code></u>',
  ],
  ['**<u>nested</u>**', '<strong><u>nested</u></strong>'],
  ['<u>outer <u>inner</u> end</u>', '<u>outer <u>inner</u> end</u>'],
  ['<u>first\nsecond</u>', '<u>first<br/>\nsecond</u>'],
  ['# <u>heading</u>', '<h1><u>heading</u></h1>'],
  ['- <u>item</u>', '<li><u>item</u></li>'],
])('safe underline reading and range detection agree: %s', (source, expected) => {
  expect(preview(source)).toContain(expected);
  const editor = state(source);
  const ranges = underlineRanges(source, syntaxTree(editor));
  expect(ranges.length).toBeGreaterThan(0);
  for (const range of ranges) {
    expect(source.slice(range.from, range.openEnd)).toBe('<u>');
    expect(source.slice(range.closeFrom, range.to)).toBe('</u>');
  }
  expect(underlineRanges(source)).toEqual(ranges);
});

test('underlined Markdown links, wiki links and tags keep their existing safe renderers', () => {
  const html = preview('<u>[web](https://example.com) [[Note|alias]] #topic</u>');
  expect(html).toContain('<u><a href="https://example.com/"');
  expect(html).toContain('wiki-link unresolved');
  expect(html).toContain('>alias');
  expect(html).toContain('tag-chip');
  expect(html).toContain('</u>');
});

test.each([
  '<u class="unsafe">hello</u>',
  '<u onclick="alert(1)">hello</u>',
  '<U>hello</U>',
  '<u >hello</u>',
  '<u>hello</u >',
  '\\<u>escaped</u>',
  '&lt;u&gt;entity&lt;/u&gt;',
  '`<u>code</u>`',
  '```html\n<u>code</u>\n```',
  '    <u>code</u>',
  '<u>open',
  'closed</u>',
  '<u>first\n\nsecond</u>',
  '<u>\nblock HTML\n</u>',
  '<div><u>block HTML</u></div>',
  '[<u>link label</u>](https://example.com)',
])('non-allowlisted or literal underline syntax stays inert: %s', (source) => {
  expect(preview(source)).not.toMatch(/<u(?:\s|>)/);
  expect(underlineRanges(source)).toEqual([]);
});

test('unrelated raw HTML remains escaped even inside safe underline wrappers', () => {
  const html = preview('<u>safe <img src=x onerror=alert(1)> <script>alert(2)</script></u>');
  expect(html).not.toMatch(/<(?:img|script)(?:\s|>)/);
  expect(html).toContain('&lt;img');
  expect(html).toContain('&lt;script&gt;');
});

test('frontmatter values are not converted into underline markup', () => {
  const source = '---\nlabel: "<u>literal</u>"\n---\n\n<u>body</u>';
  expect(underlineRanges(source)).toEqual([
    {
      from: source.lastIndexOf('<u>'),
      openEnd: source.lastIndexOf('<u>') + 3,
      closeFrom: source.lastIndexOf('</u>'),
      to: source.length,
    },
  ]);
  expect(underlineRanges(source, syntaxTree(state(source)))).toEqual(underlineRanges(source));
  expect(preview(source).match(/<u>/g)).toHaveLength(1);
});

test('table cells use the same safe reading renderer without overlapping the live table widget', () => {
  const source = '| Title |\n| --- |\n| <u>cell</u> |';
  expect(preview(source)).toContain('<u>cell</u>');
  expect(underlineRanges(source)).toHaveLength(1);
  expect(decorations(state(source)).some((value) => value.className === 'cm-live-underline')).toBe(false);
});

test('inactive underline hides only exact tags and leaves the source and cursor unchanged', () => {
  const source = '<u>**안녕**</u>\n\nEditing';
  const editor = state(source);
  const range = underlineRanges(source)[0];
  const values = decorations(editor);
  expect(values).toContainEqual({
    from: range.openEnd,
    to: range.closeFrom,
    className: 'cm-live-underline',
    hidden: false,
  });
  expect(values).toContainEqual({ from: range.from, to: range.openEnd, className: '', hidden: true });
  expect(values).toContainEqual({ from: range.closeFrom, to: range.to, className: '', hidden: true });
  expect(editor.doc.toString()).toBe(source);
  expect(editor.selection.main.head).toBe(source.length);
});

test('cursor entry and selections expose both underline tags at every source position', () => {
  const source = '<u>hello</u>\n\nEditing';
  for (let anchor = 0; anchor <= '<u>hello</u>'.length; anchor++) {
    const editor = state(source, anchor);
    expect(decorations(editor).filter((value) => value.hidden)).toEqual([]);
    expect(decorations(editor, false).filter((value) => value.hidden)).toHaveLength(2);
  }
  const editor = state(source).update({ selection: EditorSelection.range(0, source.length) }).state;
  expect(decorations(editor).filter((value) => value.hidden)).toEqual([]);
});

test('empty wrappers remain editable and unmatched tags cannot consume another paragraph', () => {
  const editor = state('<u></u>', 3);
  expect(decorations(editor).filter((value) => value.hidden)).toEqual([]);
  expect(decorations(editor, false).filter((value) => value.hidden)).toHaveLength(2);
  expect(preview('<u></u>')).toContain('<u></u>');
  expect(underlineRanges('<u>first\n\nsecond</u>')).toEqual([]);
});
