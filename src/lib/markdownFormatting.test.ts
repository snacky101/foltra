// @vitest-environment jsdom
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { history, undo, redo } from '@codemirror/commands';
import { GFM } from '@lezer/markdown';
import { getCM, vim, Vim } from '@replit/codemirror-vim';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { toggleMarkdownFormat, type MarkdownFormat } from './markdownFormatting';

let view: EditorView;
beforeEach(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => {
  view?.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
function editor(doc: string, anchor = 0, head = anchor, vimEnabled = false) {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor, head },
      extensions: [
        vimEnabled ? vim() : [],
        history(),
        yamlFrontmatter({ content: markdown({ extensions: [GFM] }) }),
      ],
    }),
  });
  view.focus();
}

test.each([
  ['bold', '**hello**'],
  ['italic', '*hello*'],
  ['underline', '<u>hello</u>'],
  ['strike', '~~hello~~'],
  ['code', '`hello`'],
] as [MarkdownFormat, string][])(
  '%s wraps selected text, toggles off and supports isolated undo/redo',
  (format, expected) => {
    editor('hello world', 0, 5);
    expect(toggleMarkdownFormat(view, format)).toBe(true);
    expect(view.state.doc.toString()).toBe(expected + ' world');
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('hello');
    expect(toggleMarkdownFormat(view, format)).toBe(true);
    expect(view.state.doc.toString()).toBe('hello world');
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(expected + ' world');
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('hello world');
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(expected + ' world');
  },
);
test.each(['bold', 'italic', 'underline', 'strike', 'code'] as const)(
  '%s toggles the Korean word at a caret without consuming neighbors',
  (format) => {
    editor('앞 한글 뒤', 3);
    toggleMarkdownFormat(view, format);
    expect(view.state.doc.toString()).toMatch(/^앞 .+ 뒤$/);
    toggleMarkdownFormat(view, format);
    expect(view.state.doc.toString()).toBe('앞 한글 뒤');
  },
);
test.each([
  ['bold', '**hello**', 4],
  ['bold', '__hello__', 4],
  ['italic', '*hello*', 3],
  ['italic', '_hello_', 3],
  ['strike', '~~hello~~', 4],
  ['underline', '<u>hello</u>', 4],
  ['code', '``hello `there` ``', 5],
] as [MarkdownFormat, string, number][])(
  '%s removes the containing format at the cursor in %s',
  (format, doc, anchor) => {
    editor(doc, anchor);
    toggleMarkdownFormat(view, format);
    expect(view.state.doc.toString()).not.toBe(doc);
    expect(view.state.doc.toString()).toContain('hello');
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  },
);
test('reverse selection and surrounding spaces are preserved', () => {
  editor('  hello  ', 9, 0);
  toggleMarkdownFormat(view, 'bold');
  expect(view.state.doc.toString()).toBe('  **hello**  ');
  expect(view.state.selection.main.anchor).toBeGreaterThan(view.state.selection.main.head);
  expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('hello');
});
test('empty caret is placed between markers, including underline', () => {
  editor('');
  toggleMarkdownFormat(view, 'underline');
  expect(view.state.doc.toString()).toBe('<u></u>');
  expect(view.state.selection.main.head).toBe(3);
  view.dispatch(view.state.replaceSelection('한글'));
  expect(view.state.doc.toString()).toBe('<u>한글</u>');
});
test.each(['bold', 'italic', 'underline', 'strike', 'code'] as const)(
  'empty %s toggles off again without accumulating delimiters',
  (format) => {
    editor('');
    toggleMarkdownFormat(view, format);
    toggleMarkdownFormat(view, format);
    expect(view.state.doc.toString()).toBe('');
    expect(view.state.selection.main.head).toBe(0);
  },
);
test('whole-line selections preserve headings, tasks, lists and blank lines', () => {
  const doc = '# Title\n\n- item\n- [b] saved\n> quote';
  editor(doc, 0, doc.length);
  toggleMarkdownFormat(view, 'bold');
  expect(view.state.doc.toString()).toBe('# **Title**\n\n- **item**\n- [b] **saved**\n> **quote**');
  toggleMarkdownFormat(view, 'bold');
  expect(view.state.doc.toString()).toBe(doc);
});
test.each([
  ['---\ntitle: example\n---\n\nbody', 12],
  ['```go\nhello\n```', 8],
  ['    hello', 6],
  ['`hello`', 3],
  ['[hello](https://example.com)', 12],
])('does not format protected code, YAML or link destinations (%s)', (doc, pos) => {
  editor(doc as string, pos as number);
  expect(toggleMarkdownFormat(view, 'bold')).toBe(false);
  expect(view.state.doc.toString()).toBe(doc);
});
test('Vim visual word formatting keeps its selection usable by subsequent yank/delete', () => {
  editor('hello world', 0, 0, true);
  const cm = getCM(view)!;
  for (const key of ['v', 'i', 'w']) Vim.handleKey(cm, key, 'user');
  toggleMarkdownFormat(view, 'bold');
  expect(view.state.doc.toString()).toBe('**hello** world');
  expect(cm.state.vim?.visualMode).toBe(true);
  Vim.handleKey(cm, 'y', 'user');
  expect(Vim.getRegisterController().unnamedRegister.toString()).toBe('hello');
  expect(view.state.doc.toString()).toBe('**hello** world');
});
test('multiple carets in the same marked span remove delimiters only once', () => {
  editor('**hello**');
  view.dispatch({
    selection: EditorSelection.create([EditorSelection.cursor(3), EditorSelection.cursor(5)]),
  });
  toggleMarkdownFormat(view, 'bold');
  expect(view.state.doc.toString()).toBe('hello');
});

test('code delimiter padding roundtrips text containing literal backticks', () => {
  editor('`a', 0, 2);
  toggleMarkdownFormat(view, 'code');
  expect(view.state.doc.toString()).toBe('`` `a ``');
  toggleMarkdownFormat(view, 'code');
  expect(view.state.doc.toString()).toBe('`a');
});

test.each(['text [hello](https://example.com)', 'text `hello`', 'text <b>hello</b>'])(
  'partial inline syntax selections cannot corrupt %s',
  (doc) => {
    editor(doc, 0, doc.length - 2);
    expect(toggleMarkdownFormat(view, 'bold')).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
  },
);

test('does not insert a closing marker that a trailing backslash would escape', () => {
  editor('hello\\', 0, 6);
  expect(toggleMarkdownFormat(view, 'bold')).toBe(false);
  expect(view.state.doc.toString()).toBe('hello\\');
});
