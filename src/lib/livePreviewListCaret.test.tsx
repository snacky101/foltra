// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { cursorCharLeft, cursorCharRight, history, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { getCM, vim, Vim } from '@replit/codemirror-vim';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { focusLivePreview, livePreviewDecorations, livePreviewExtension } from './livePreview';
import { indentMarkdownList } from './markdownIndentation';
import type { Workspace } from './types';

const context = {
  workspace: { notes: [], records: [] } as unknown as Workspace,
  openNote() {},
  openLink() {},
};
let view: EditorView | undefined;
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
  view?.destroy();
  view = undefined;
  document.body.replaceChildren();
  if (rects) Object.defineProperty(Range.prototype, 'getClientRects', rects);
  else delete (Range.prototype as Partial<Range>).getClientRects;
  if (rect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rect);
  else delete (Range.prototype as Partial<Range>).getBoundingClientRect;
});

function editor(doc: string, anchor: number, vimEnabled = false, live = true) {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        vimEnabled ? vim() : [],
        history(),
        markdown({ extensions: [GFM] }),
        live ? livePreviewExtension(() => context, true) : [],
      ],
    }),
  });
  view.focus();
  return view;
}

function replacements(state: EditorState) {
  const ranges: [number, number][] = [];
  livePreviewDecorations(state, context).between(0, state.doc.length, (from, to, decoration) => {
    if (from < to && !decoration.spec.class && !decoration.spec.attributes) ranges.push([from, to]);
  });
  return ranges;
}

test.each(['- Text', '* Text', '+ Text', '12. Text', '-   Text', '-\tText', '- [b] Text', '- [ ] Text'])(
  'every hidden prefix position in %j becomes visible without moving the caret or editing source',
  (doc) => {
    const body = doc.indexOf('Text');
    const editorView = editor(doc, body);
    expect(editorView.contentDOM.querySelector('.cm-live-list-marker')).not.toBeNull();
    for (let anchor = 0; anchor < body; anchor++) {
      editorView.dispatch({ selection: { anchor } });
      expect(editorView.state.selection.main.head).toBe(anchor);
      expect(editorView.state.doc.toString()).toBe(doc);
      expect(editorView.contentDOM.textContent).toContain(doc);
      const position = editorView.domAtPos(anchor);
      expect(editorView.posAtDOM(position.node, position.offset)).toBe(anchor);
      expect(replacements(editorView.state).some(([from, to]) => from <= anchor && anchor < to)).toBe(false);
    }
    editorView.dispatch({ selection: { anchor: body } });
    expect(editorView.contentDOM.querySelector('.cm-live-list-marker')).not.toBeNull();
  },
);

test.each(['- Parent\n  - Child', '- Parent\n    - Child', '- Parent\n  continuation'])(
  'nested indentation in %j stays editable and visible while the caret is inside it',
  (doc) => {
    const editorView = editor(doc, doc.length);
    const line = editorView.state.doc.line(2);
    const indent = line.text.match(/^\s+/)![0].length;
    for (let offset = 0; offset < indent; offset++) {
      const anchor = line.from + offset;
      editorView.dispatch({ selection: { anchor } });
      expect(editorView.state.selection.main.head).toBe(anchor);
      expect(replacements(editorView.state).some(([from, to]) => from <= anchor && anchor < to)).toBe(false);
      expect(editorView.contentDOM.querySelectorAll('.cm-line')[1].textContent).toMatch(/^\s{2}/);
    }
    expect(editorView.state.doc.toString()).toBe(doc);
  },
);

test.each(['- ', '-   ', '12. ', '- [b] '])(
  'the content start of empty %j retains its rendered marker',
  (doc) => {
    const editorView = editor(doc, doc.length);
    expect(editorView.contentDOM.querySelector('.cm-live-list-marker')).not.toBeNull();
    editorView.dispatch(editorView.state.replaceSelection('한글'));
    expect(editorView.state.doc.toString()).toBe(doc + '한글');
    expect(editorView.state.selection.main.head).toBe(doc.length + 2);
    expect(editorView.contentDOM.querySelector('.cm-live-list-marker')).not.toBeNull();
    undo(editorView);
    expect(editorView.state.doc.toString()).toBe(doc);
  },
);

test('arrow movement reveals source inside a prefix and hides it only after reaching actual text', () => {
  const editorView = editor('- Text', 2);
  cursorCharLeft(editorView);
  expect(editorView.state.selection.main.head).toBe(1);
  expect(editorView.contentDOM.textContent).toContain('- Text');
  cursorCharRight(editorView);
  expect(editorView.state.selection.main.head).toBe(2);
  expect(editorView.contentDOM.querySelector('.cm-live-bullet')).not.toBeNull();
});

test.each(['- Text', '- ', '- Parent\n  - Child', '12. Text'])(
  'clicking the rendered marker of %j selects the actual content start',
  (doc) => {
    const editorView = editor(doc, doc.length);
    const markers = editorView.contentDOM.querySelectorAll<HTMLElement>('.cm-live-list-marker');
    const marker = markers[markers.length - 1];
    expect(marker.onmousedown).toBeTypeOf('function');
    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
    marker.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    const line = editorView.state.doc.line(editorView.state.doc.lines);
    const from = line.from + line.text.match(/^\s*(?:[-+*]|\d+[.)])[ \t]+/)![0].length;
    expect(editorView.state.selection.main.head).toBe(from);
    editorView.dispatch(editorView.state.replaceSelection('X'));
    expect(editorView.state.doc.toString()).toBe(doc.slice(0, from) + 'X' + doc.slice(from));
    expect(editorView.state.selection.main.head).toBe(from + 1);
  },
);

test('Vim h/l and i keep the displayed source position equal to the insertion offset', () => {
  const editorView = editor('- Text', 2, true);
  const cm = getCM(editorView)!;
  Vim.handleKey(cm, 'h', 'user');
  expect(editorView.state.selection.main.head).toBe(1);
  expect(editorView.contentDOM.textContent).toContain('- Text');
  Vim.handleKey(cm, 'l', 'user');
  expect(editorView.state.selection.main.head).toBe(2);
  expect(editorView.contentDOM.querySelector('.cm-live-bullet')).not.toBeNull();
  Vim.handleKey(cm, '0', 'user');
  expect(editorView.state.selection.main.head).toBe(0);
  expect(editorView.contentDOM.textContent).toContain('- Text');
  Vim.handleKey(cm, 'i', 'user');
  editorView.dispatch(editorView.state.replaceSelection('Start '));
  expect(editorView.state.doc.toString()).toBe('Start - Text');
  expect(editorView.state.selection.main.head).toBe(6);
});

test('indent and outdent recompute prefix positions while body composition leaves the marker rendered', () => {
  const editorView = editor('- Parent\n- Child', 11);
  indentMarkdownList(false)(editorView);
  const body = editorView.state.doc.toString().indexOf('Child');
  editorView.dispatch({ selection: { anchor: body } });
  expect(editorView.contentDOM.querySelectorAll('.cm-live-bullet')).toHaveLength(2);
  editorView.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  editorView.dispatch({
    changes: { from: body, insert: '한' },
    selection: { anchor: body, head: body + 1 },
    userEvent: 'input.type.compose',
  });
  expect(editorView.contentDOM.querySelectorAll('.cm-live-bullet')).toHaveLength(2);
  expect(editorView.state.doc.toString()).toContain('- 한Child');
  editorView.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  editorView.dispatch({ selection: { anchor: body + 1 } });
  indentMarkdownList(true)(editorView);
  expect(editorView.state.doc.toString()).toBe('- Parent\n- 한Child');
  expect(editorView.contentDOM.querySelectorAll('.cm-live-bullet')).toHaveLength(2);
});

test('source mode keeps normal caret placement and never installs marker click behavior', () => {
  const editorView = editor('- Text', 1, false, false);
  expect(editorView.contentDOM.querySelector('.cm-live-list-marker')).toBeNull();
  editorView.dispatch(editorView.state.replaceSelection('X'));
  expect(editorView.state.doc.toString()).toBe('-X Text');
  expect(editorView.state.selection.main.head).toBe(2);
});

test('focus restoration reveals selected syntax and body selections keep the marker rendered', () => {
  const editorView = editor('- Text', 1);
  editorView.dispatch({ effects: focusLivePreview.of(false) });
  expect(editorView.contentDOM.querySelector('.cm-live-bullet')).not.toBeNull();
  editorView.dispatch({ effects: focusLivePreview.of(true) });
  expect(editorView.contentDOM.textContent).toBe('- Text');
  expect(editorView.state.selection.main.head).toBe(1);
  editorView.dispatch({ selection: { anchor: 2, head: 6 } });
  expect(editorView.contentDOM.querySelector('.cm-live-bullet')).not.toBeNull();
  expect(editorView.state.doc.toString()).toBe('- Text');
});

test('a marker click after earlier source edits uses its updated content offset', () => {
  const editorView = editor('- Text', 6);
  editorView.dispatch({ changes: { from: 0, insert: 'Before\n\n' } });
  editorView.contentDOM
    .querySelector('.cm-live-bullet')!
    .dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
  expect(editorView.state.selection.main.head).toBe('Before\n\n- '.length);
  editorView.dispatch(editorView.state.replaceSelection('X'));
  expect(editorView.state.doc.toString()).toBe('Before\n\n- XText');
});
