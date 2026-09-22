// @vitest-environment jsdom
import { EditorSelection, EditorState, StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  cursorCharLeft,
  cursorCharRight,
  deleteCharBackward,
  history,
  isolateHistory,
  undo,
} from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { GFM } from '@lezer/markdown';
import { renderToStaticMarkup } from 'react-dom/server';
import { getCM, vim, Vim } from '@replit/codemirror-vim';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { NotePreview } from '../components/NotePreview';
import { focusLivePreview, livePreviewDecorations, livePreviewExtension } from './livePreview';
import type { Workspace } from './types';

const context = {
  workspace: { notes: [], records: [] } as unknown as Workspace,
  openNote() {},
  openLink() {},
};
let editor: EditorView | undefined;
const markers = [' ', '/', 'x', 'X', 'b', 'B', '-', '>', '?', '!', '*', 'i', 'I', 'p', 'P'];
const rects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
const rect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
beforeEach(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(),
  });
});
afterEach(() => {
  editor?.destroy();
  document.body.replaceChildren();
  if (rects) Object.defineProperty(Range.prototype, 'getClientRects', rects);
  else delete (Range.prototype as Partial<Range>).getClientRects;
  if (rect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rect);
  else delete (Range.prototype as Partial<Range>).getBoundingClientRect;
});
function live(doc: string, anchor = doc.length, vimEnabled = false) {
  editor = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        vimEnabled ? vim() : [],
        history(),
        yamlFrontmatter({ content: markdown({ extensions: [GFM] }) }),
        livePreviewExtension(() => context, true),
      ],
    }),
  });
  return editor;
}
function reading(body: string) {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<NotePreview body={body} {...context} />);
  return host;
}

test('every task state uses the same accessible SVG in live and reading mode', () => {
  const doc = markers.map((marker, i) => `- [${marker}] Task ${i}`).join('\n');
  const view = live(doc);
  const preview = reading(doc);
  const liveIcons = [...view.dom.querySelectorAll('.task-icon')];
  const readIcons = [...preview.querySelectorAll('.task-icon')];
  expect(liveIcons).toHaveLength(markers.length);
  expect(readIcons).toHaveLength(markers.length);
  expect(liveIcons.map((icon) => icon.outerHTML)).toEqual(readIcons.map((icon) => icon.outerHTML));
  expect(
    readIcons.every((icon) => icon.getAttribute('role') === 'img' && icon.getAttribute('aria-label')),
  ).toBe(true);
  expect(preview.querySelector('input')).toBeNull();
  expect(preview.textContent?.trim()).toBe(markers.map((_, i) => `Task ${i}`).join('\n'));
  expect(view.state.doc.toString()).toBe(doc);
});

test.each(['- [ ] ', '- [/] ', '- [x] ', '- Parent\n  - [b] ', '> - [!] ', '1. [>] '])(
  'task prefix keeps empty and typed caret positions outside the icon: %j',
  (doc) => {
    const view = live(doc);
    const marker = view.dom.querySelector<HTMLElement>('.cm-live-task');
    expect(marker).not.toBeNull();
    expect(marker?.contentEditable).toBe('false');
    const outside = (pos: number) => {
      const { node } = view.domAtPos(pos);
      const element = node.nodeType === Node.TEXT_NODE ? node.parentElement! : (node as Element);
      expect(element.closest('.cm-live-list-marker')).toBeNull();
    };
    outside(doc.length);
    view.dispatch(view.state.replaceSelection('한'));
    outside(doc.length + 1);
    expect(view.state.doc.toString()).toBe(doc + '한');
    expect(view.state.selection.main.head).toBe(doc.length + 1);
  },
);

test('nested, quoted, ordered and empty tasks retain their list structure', () => {
  const doc = '- [ ] Parent\n  - [/] Child\n\n> - [b] Quoted\n\n1. [x] Numbered\n2. [ ] ';
  const view = live(doc);
  const preview = reading(doc);
  expect(view.dom.querySelectorAll('.task-icon')).toHaveLength(5);
  expect(preview.querySelectorAll('.task-icon')).toHaveLength(5);
  expect(preview.querySelector('li > ul .task-icon')?.getAttribute('data-task-status')).toBe('doing');
  expect(preview.querySelector('blockquote .task-icon')?.getAttribute('data-task-status')).toBe('bookmark');
  expect(preview.querySelectorAll('ol > li.task-list-item')).toHaveLength(2);
  expect(preview.textContent).not.toMatch(/\[[ /xb]\]/);
});

test.each(markers)('waits for a separator after [%s] and keeps the icon while typing', (marker) => {
  const prefix = `- [${marker}]`;
  const view = live(prefix);
  const check = (rendered: boolean) => {
    const doc = view.state.doc.toString();
    expect(!!view.dom.querySelector('.cm-live-task')).toBe(rendered);
    const preview = reading(doc);
    expect(!!preview.querySelector('.task-icon')).toBe(rendered);
    expect(preview.querySelector('input')).toBeNull();
    if (!rendered) {
      expect(view.contentDOM.textContent).toContain(doc === prefix ? prefix : `[${marker}]`);
      expect(preview.textContent).toContain(`[${marker}]`);
    }
  };
  check(false);
  view.dispatch(view.state.replaceSelection(' '));
  check(true);
  view.dispatch(view.state.replaceSelection('aaa한글'));
  check(true);
  expect(view.state.doc.toString()).toBe(`${prefix} aaa한글`);
  view.dispatch({
    changes: { from: prefix.length, to: prefix.length + 1 },
    userEvent: 'delete',
    annotations: isolateHistory.of('full'),
  });
  check(false);
  expect(view.state.doc.toString()).toBe(`${prefix}aaa한글`);
  expect(undo(view)).toBe(true);
  check(true);
});

test.each([
  '- [ ]\n  continuation',
  '- [x]\n  **bold**',
  '- [X]\r\n  continuation',
  '- [ ]\r\n  **bold**',
  '- [b]\n  continuation',
  '> - [ ]\n>   continuation',
  '- parent\n  - [x]\n    continuation',
  '1. [x]\n   continuation',
])('a newline without a separator keeps the task marker literal: %j', (doc) => {
  const view = live(doc.replace(/\r\n/g, '\n'));
  const preview = reading(doc);
  expect(view.dom.querySelector('.cm-live-task')).toBeNull();
  expect(preview.querySelector('.task-icon, input, .task-list-item')).toBeNull();
  expect(preview.textContent).toMatch(/\[[ xXb]\]/);
  expect(preview.querySelectorAll('br')).toHaveLength(1);
  if (doc.includes('**bold**')) expect(preview.querySelector('strong')?.textContent).toBe('bold');
});

test.each(['- [ ]\t', '> - [b]\ttext', '- parent\n  - [x]\ttext', '1. [/]\ttext'])(
  'accepts tab separators in both rendering modes: %j',
  (doc) => {
    expect(live(doc).dom.querySelector('.cm-live-task')).not.toBeNull();
    expect(reading(doc).querySelector('.task-icon')).not.toBeNull();
  },
);

test('code, frontmatter, escaped prefixes and ordinary bracket text remain literal', () => {
  const doc =
    '---\nexample: "- [x] YAML"\n---\n\n[ ] Paragraph\n\n`- [x] inline`\n\n```md\n- [/] fenced\n```\n\n    - [b] indented code\n\n-     [x] list code\n\n- `[x]` inline item\n- \\[x] escaped\n- [z] unknown\n- [x]suffix\n- [ ] actual';
  const view = live(doc, 1);
  const preview = reading(doc);
  expect(view.dom.querySelectorAll('.task-icon')).toHaveLength(1);
  expect(preview.querySelectorAll('.task-icon')).toHaveLength(1);
  expect(preview.textContent).toContain('[ ] Paragraph');
  expect(preview.textContent).toContain('[x] escaped');
  expect(preview.textContent).toContain('[z] unknown');
  expect(preview.textContent).toContain('[x]suffix');
  expect(view.state.doc.toString()).toBe(doc);
});

test('custom task markers preserve following escapes, links, tags and list spacing', () => {
  const preview = reading('- [/] \\*literal\\* [[Foo]] #study\n\n- [b] Blocked\n\n[b]: /blocked');
  expect(preview.querySelectorAll('.task-icon')).toHaveLength(2);
  expect(preview.textContent).toContain('*literal*');
  expect(preview.querySelector('.wiki-link')?.textContent).toBe('Foo');
  expect(preview.querySelector('.tag-chip')?.textContent).toBe('#study');
  expect(preview.querySelector('em')).toBeNull();
  expect(preview.querySelector('a')).toBeNull();
  expect(preview.querySelectorAll('[style*="--md-list-blank-lines"]')).toHaveLength(1);
});

test('custom markers parsed as links do not create overlapping replacements', () => {
  const doc = '- [/] Working\n- [b] Blocked\n- [?] Question\n\n[b]: https://example.com';
  const view = live(doc);
  const replacements: { from: number; to: number }[] = [];
  livePreviewDecorations(view.state, context).between(0, doc.length, (from, to, value) => {
    if (from < to && value.spec.widget) replacements.push({ from, to });
  });
  expect(replacements).toEqual(
    [1, 2, 3].map((number) => ({
      from: view.state.doc.line(number).from,
      to: view.state.doc.line(number).from + 6,
    })),
  );
  expect(view.state.doc.toString()).toBe(doc);
});

test.each([
  ...markers.map((marker) => `- [${marker}] Text`),
  '- Parent\n  - [b] Text',
  '> - [/] Text',
  '12. [*] Text',
  '+ [!] Text',
  '* [?] Text',
])('selecting any character in the full task prefix reveals native editable source: %s', (doc) => {
  const from = doc.lastIndexOf('[');
  const prefixFrom =
    doc.lastIndexOf('\n') +
    1 +
    doc
      .split('\n')
      .at(-1)!
      .search(/[-+*]|\d+[.)]/);
  const prefix = doc.slice(prefixFrom, from + 4);
  const view = live(doc);
  for (let anchor = prefixFrom; anchor < from + 4; anchor++) {
    view.dispatch({ selection: { anchor } });
    expect(view.dom.querySelector('.cm-live-task')).toBeNull();
    const position = view.domAtPos(anchor);
    expect(position.node.nodeType).toBe(Node.TEXT_NODE);
    expect(position.node.parentElement?.closest('[contenteditable=false]')).toBeNull();
    expect(view.posAtDOM(position.node, position.offset)).toBe(anchor);
    expect(view.contentDOM.textContent).toContain(prefix);
    expect(reading(doc).querySelector('.task-icon')).not.toBeNull();
  }
  for (const anchor of [from + 4, doc.length]) {
    view.dispatch({ selection: { anchor } });
    expect(view.dom.querySelector('.cm-live-task')).not.toBeNull();
  }
  view.dispatch({ selection: EditorSelection.range(from + 4, doc.length) });
  expect(view.dom.querySelector('.cm-live-task')).not.toBeNull();
  view.dispatch({ selection: EditorSelection.range(from + 1, from + 2) });
  expect(view.dom.querySelector('.cm-live-task')).toBeNull();
  view.dispatch({ selection: EditorSelection.range(prefixFrom, from) });
  expect(view.contentDOM.textContent).toContain(prefix);
  view.dispatch({ effects: focusLivePreview.of(false) });
  expect(view.dom.querySelector('.cm-live-task')).not.toBeNull();
  view.dispatch({ effects: focusLivePreview.of(true) });
  expect(view.dom.querySelector('.cm-live-task')).toBeNull();
  expect(view.state.doc.toString()).toBe(doc);
});

test.each(markers)('arrow navigation enters the whole [%s] prefix from either side', (marker) => {
  const doc = `Before\n- [${marker}] Text`;
  const from = doc.indexOf('-');
  const view = live(doc, from + 6);
  view.focus();
  expect(cursorCharLeft(view)).toBe(true);
  expect(view.state.selection.main.head).toBe(from + 5);
  expect(view.dom.querySelector('.cm-live-task')).toBeNull();
  for (let offset = 4; offset >= 0; offset--) {
    cursorCharLeft(view);
    expect(view.state.selection.main.head).toBe(from + offset);
    expect(view.dom.querySelector('.cm-live-task')).toBeNull();
    expect(view.contentDOM.textContent).toContain(`- [${marker}] Text`);
  }
  cursorCharLeft(view);
  expect(view.state.selection.main.head).toBe(from - 1);
  expect(view.dom.querySelector('.cm-live-task')).not.toBeNull();
  for (let offset = 0; offset <= 5; offset++) {
    cursorCharRight(view);
    expect(view.state.selection.main.head).toBe(from + offset);
    expect(view.dom.querySelector('.cm-live-task')).toBeNull();
    expect(view.contentDOM.textContent).toContain(`- [${marker}] Text`);
  }
  cursorCharRight(view);
  expect(view.state.selection.main.head).toBe(from + 6);
  expect(view.dom.querySelector('.cm-live-task')).not.toBeNull();
});

test.each(markers)('Vim h/l can enter [%s], edit its list marker and state, and undo', (marker) => {
  const doc = `- [${marker}] Text`;
  const view = live(doc, 6, true);
  view.focus();
  const cm = getCM(view)!;
  for (let offset = 5; offset >= 0; offset--) {
    Vim.handleKey(cm, 'h', 'user');
    expect(view.state.selection.main.head).toBe(offset);
    expect(view.contentDOM.textContent).toContain(doc);
  }
  Vim.handleKey(cm, 'r', 'user');
  Vim.handleKey(cm, '+', 'user');
  expect(view.state.doc.toString()).toBe(`+ [${marker}] Text`);
  expect(view.contentDOM.textContent).toContain(`+ [${marker}] Text`);
  for (let i = 0; i < 3; i++) Vim.handleKey(cm, 'l', 'user');
  expect(view.state.selection.main.head).toBe(3);
  expect(view.dom.querySelector('.cm-live-task')).toBeNull();
  Vim.handleKey(cm, 'r', 'user');
  Vim.handleKey(cm, 'b', 'user');
  expect(view.state.doc.toString()).toBe('+ [b] Text');
  Vim.handleKey(cm, 'l', 'user');
  Vim.handleKey(cm, 'l', 'user');
  expect(view.dom.querySelector('.cm-live-task')).toBeNull();
  Vim.handleKey(cm, 'l', 'user');
  expect(view.dom.querySelector('.task-icon')?.getAttribute('data-task-status')).toBe('bookmark');
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(`+ [${marker}] Text`);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(doc);
});

test.each(markers.filter((marker) => ![' ', '/', 'x', 'X'].includes(marker)))(
  'clicking a moved [%s] custom icon exposes its entire prefix for editing',
  (marker) => {
    const view = live(`- [${marker}] Text`);
    view.dispatch({ changes: { from: 0, insert: 'Before\n\n' } });
    const from = view.state.doc.toString().indexOf('[');
    const icon = view.dom.querySelector('.cm-live-task')!;
    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
    icon.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(view.hasFocus).toBe(true);
    expect(view.state.selection.main.head).toBe(from + 1);
    expect(view.dom.querySelector('.cm-live-task')).toBeNull();
    expect(view.contentDOM.textContent).toContain(`- [${marker}] Text`);
    view.dispatch({ selection: EditorSelection.range(from + 1, from + 2) });
    view.dispatch(view.state.replaceSelection('x'));
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(view.dom.querySelector('.task-icon')?.getAttribute('data-task-status')).toBe('done');
    expect(view.state.doc.toString()).toBe('Before\n\n- [x] Text');
  },
);

test('deleting and retyping a state preserves native input through temporarily invalid task syntax', () => {
  const view = live('- [x] Text', 4);
  view.focus();
  expect(deleteCharBackward(view)).toBe(true);
  expect(view.state.doc.toString()).toBe('- [] Text');
  expect(view.dom.querySelector('.cm-live-task')).toBeNull();
  expect(view.contentDOM.textContent).toContain('- [] Text');
  const position = view.domAtPos(view.state.selection.main.head);
  expect(position.node.parentElement?.closest('[contenteditable=false]')).toBeNull();
  view.dispatch(view.state.replaceSelection('b'));
  expect(view.state.doc.toString()).toBe('- [b] Text');
  expect(view.dom.querySelector('.cm-live-task')).toBeNull();
  expect(view.contentDOM.textContent).toContain('- [b] Text');
  cursorCharRight(view);
  expect(view.dom.querySelector('.cm-live-task')).toBeNull();
  cursorCharRight(view);
  expect(view.dom.querySelector('.task-icon')?.getAttribute('data-task-status')).toBe('bookmark');
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe('- [x] Text');
});

test('an unsupported intermediate state remains editable without inventing a task icon', () => {
  const view = live('- [b] Text', 3);
  view.focus();
  view.dispatch({ selection: EditorSelection.range(3, 4) });
  view.dispatch(view.state.replaceSelection('z'));
  expect(view.state.doc.toString()).toBe('- [z] Text');
  expect(view.contentDOM.textContent).toContain('- [z] Text');
  expect(view.dom.querySelector('.task-icon')).toBeNull();
  view.dispatch({ selection: EditorSelection.range(3, 4) });
  view.dispatch(view.state.replaceSelection('!'));
  expect(view.contentDOM.textContent).toContain('- [!] Text');
  cursorCharRight(view);
  expect(view.dom.querySelector('.cm-live-task')).toBeNull();
  cursorCharRight(view);
  expect(view.dom.querySelector('.task-icon')?.getAttribute('data-task-status')).toBe('important');
});

test('extended task source stays editable alongside reference definitions and emphasized content', () => {
  const doc = '- [b] **Bold**\n- [*] *Italic*\n\n[b]: https://example.com';
  const view = live(doc);
  expect(view.dom.querySelectorAll('.cm-live-task')).toHaveLength(2);
  expect(view.dom.querySelector('.cm-live-link')).toBeNull();
  for (const number of [1, 2]) {
    const line = view.state.doc.line(number);
    view.dispatch({ selection: { anchor: line.from } });
    expect(view.contentDOM.textContent).toContain(line.text);
    expect(view.dom.querySelectorAll('.cm-live-task')).toHaveLength(1);
    expect(view.dom.querySelector('.cm-live-link')).toBeNull();
    expect(view.state.doc.toString()).toBe(doc);
  }
});

test('the complete task prefix can be deleted and restored with one native undo', () => {
  const doc = '- [!] Text';
  const view = live(doc, 3);
  view.focus();
  view.dispatch({ selection: EditorSelection.range(0, 6) });
  expect(view.contentDOM.textContent).toContain(doc);
  view.dispatch(view.state.replaceSelection(''));
  expect(view.state.doc.toString()).toBe('Text');
  expect(view.dom.querySelector('.cm-live-task')).toBeNull();
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(doc);
});

test('rapid selection updates cannot discard actual editor focus or blur', async () => {
  editor = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: '- [ ] Text',
      selection: { anchor: 3 },
      extensions: [markdown({ extensions: [GFM] }), livePreviewExtension(() => context)],
    }),
  });
  editor.focus();
  editor.dispatch({ selection: { anchor: 4 } });
  editor.dispatch({ selection: { anchor: 3 } });
  await Promise.resolve();
  await Promise.resolve();
  expect(editor.hasFocus).toBe(true);
  expect(editor.dom.querySelector('.cm-live-task')).toBeNull();
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  editor.dispatch({ selection: { anchor: 4 } });
  editor.dispatch({ selection: { anchor: 3 } });
  await Promise.resolve();
  await Promise.resolve();
  expect(editor.hasFocus).toBe(false);
  expect(editor.dom.querySelector('.cm-live-task')).not.toBeNull();
});

test('queued focus recovery does not dispatch into an editor destroyed before the microtask', async () => {
  const view = live('- [ ] Text');
  view.dispatch({ selection: { anchor: 3 } });
  view.destroy();
  editor = undefined;
  const dispatch = vi.spyOn(view, 'dispatch');
  await Promise.resolve();
  await Promise.resolve();
  expect(dispatch).not.toHaveBeenCalled();
  dispatch.mockRestore();
});

test('focus recovery also preserves the existing heading and wiki-link source behavior', async () => {
  const doc = '# Heading\n\n[[Target]]';
  editor = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [markdown({ extensions: [GFM] }), livePreviewExtension(() => context)],
    }),
  });
  editor.focus();
  editor.dispatch({ selection: { anchor: 2 } });
  editor.dispatch({ selection: { anchor: 3 } });
  await Promise.resolve();
  await Promise.resolve();
  expect(editor.contentDOM.textContent).toContain('# Heading');
  editor.dispatch({ selection: { anchor: doc.indexOf('Target') } });
  expect(editor.contentDOM.textContent).toContain('[[Target]]');
  expect(editor.dom.querySelector('.cm-live-link')).toBeNull();
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  editor.dispatch({ selection: { anchor: doc.indexOf('Target') + 1 } });
  await Promise.resolve();
  await Promise.resolve();
  expect(editor.dom.querySelector('.cm-live-link')).not.toBeNull();
  expect(editor.state.doc.toString()).toBe(doc);
});

test('focus recovery lets native focusChanged notifications reach other editor extensions first', async () => {
  const focusEvents: boolean[] = [];
  editor = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: '- [ ] Text',
      extensions: [
        markdown({ extensions: [GFM] }),
        livePreviewExtension(() => context),
        EditorView.updateListener.of((update) => {
          if (update.focusChanged) focusEvents.push(update.view.hasFocus);
        }),
      ],
    }),
  });
  editor.focus();
  editor.dispatch({ selection: { anchor: 3 } });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(focusEvents).toEqual([true]);
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  editor.dispatch({ selection: { anchor: 4 } });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(focusEvents).toEqual([true, false]);
});

test.each([' ', '/', 'x', 'X'])(
  'clicking a [%s] checkbox toggles only its marker, preserves the cursor and can undo',
  (marker) => {
    const doc = `- [${marker}] 한글 내용\n\n다른 문단`;
    const view = live(doc);
    view.dispatch({ changes: { from: 0, insert: 'Before\n\n' } });
    const before = view.state.doc.toString();
    const selection = view.state.selection;
    const button = view.dom.querySelector<HTMLButtonElement>('.task-toggle')!;
    expect(button.getAttribute('role')).toBe('checkbox');
    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    button.click();
    const next = marker.toLowerCase() === 'x' ? ' ' : 'x';
    expect(view.state.doc.toString()).toBe(before.replace(`[${marker}]`, `[${next}]`));
    expect(view.state.selection.eq(selection)).toBe(true);
    expect(view.dom.querySelector('.task-toggle')?.getAttribute('aria-checked')).toBe(
      next === 'x' ? 'true' : 'false',
    );
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(before);
    expect(view.state.selection.eq(selection)).toBe(true);
  },
);

test('a read-only live preview does not allow mouse task changes', () => {
  const view = live('- [ ] 내용');
  view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) });
  const before = view.state.doc.toString();
  view.dom.querySelector<HTMLButtonElement>('.task-toggle')!.click();
  expect(view.state.doc.toString()).toBe(before);
});
