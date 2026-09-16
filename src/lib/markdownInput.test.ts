// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { getCM, vim, Vim } from '@replit/codemirror-vim';
import { syntaxTree } from '@codemirror/language';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { markdownEditing } from './markdownEditing';
import { markdownListLayout } from './markdownListLayout';

let view: EditorView;
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
  document.body.replaceChildren();
  if (rects) Object.defineProperty(Range.prototype, 'getClientRects', rects);
  else delete (Range.prototype as Partial<Range>).getClientRects;
  if (rect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rect);
  else delete (Range.prototype as Partial<Range>).getBoundingClientRect;
});
function editor(doc: string, vimEnabled = false) {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [
        vimEnabled ? vim() : [],
        markdown({ addKeymap: false }),
        markdownEditing,
        history(),
        keymap.of(defaultKeymap),
      ],
    }),
  });
  view.focus();
  if (vimEnabled) Vim.handleKey(getCM(view)!, 'i', 'user');
}

test.each([
  [false, 'Backspace'],
  [true, 'Backspace'],
  [false, 'Enter'],
  [true, 'Enter'],
] as const)('Vim %s: %s exits an empty bullet without adding a row', (vimEnabled, key) => {
  const before = '안녕하세요\n\n- aaaa\n- bbb\n- ccc\n- ';
  editor(before, vimEnabled);
  const event = new KeyboardEvent('keydown', {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(view.state.doc.toString()).toBe('안녕하세요\n\n- aaaa\n- bbb\n- ccc\n');
  expect(view.state.doc.lines).toBe(before.split('\n').length);
  expect(view.state.selection.main.head).toBe(view.state.doc.length);
  undo(view);
  expect(view.state.doc.toString()).toBe(before);
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }),
  );
  view.dispatch(view.state.replaceSelection('안녕'));
  expect(markdownListLayout(view.state.doc, syntaxTree(view.state)).lines.has(view.state.doc.lines)).toBe(
    false,
  );
});

test.each(['insertLineBreak', 'insertParagraph'])(
  'native %s after Korean composition continues exactly one bullet',
  async (inputType) => {
    editor('- 한글');
    const event = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(event);
    await Promise.resolve();
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe('- 한글\n- ');
  },
);

test.each(['insertLineBreak', 'insertParagraph'])(
  'native %s on an empty bullet removes its marker without adding a row',
  async (inputType) => {
    editor('- 한글\n- ');
    view.contentDOM.dispatchEvent(
      new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe('- 한글\n');
    expect(view.state.doc.lines).toBe(2);
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  },
);

test('a composing Enter is left to the IME, while plain text gets one newline after commit', async () => {
  editor('한글');
  const composing = new InputEvent('beforeinput', {
    inputType: 'insertLineBreak',
    isComposing: true,
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(composing);
  await Promise.resolve();
  expect(composing.defaultPrevented).toBe(false);
  expect(view.state.doc.toString()).toBe('한글');
  view.contentDOM.dispatchEvent(
    new InputEvent('beforeinput', { inputType: 'insertLineBreak', bubbles: true, cancelable: true }),
  );
  await Promise.resolve();
  expect(view.state.doc.toString()).toBe('한글\n');
});

test.each([false, true])(
  'Vim %s: opening a Go code block makes one pair, one undo step, and positions the cursor inside',
  (vimEnabled) => {
    editor('```go', vimEnabled);
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(view.state.doc.toString()).toBe('```go\n\n```');
    expect(view.state.selection.main.head).toBe(6);
    undo(view);
    expect(view.state.doc.toString()).toBe('```go');
  },
);

test('Vim Normal Enter does not insert a code fence pair', () => {
  editor('```go', true);
  Vim.handleKey(getCM(view)!, '<Esc>', 'user');
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }),
  );
  expect(view.state.doc.toString()).toBe('```go');
});
