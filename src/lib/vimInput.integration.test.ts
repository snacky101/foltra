// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history } from '@codemirror/commands';
import { getCM, vim } from '@replit/codemirror-vim';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { bindVimInput } from './vimInput';

let view: EditorView;
let unbind: (() => void) | undefined;
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
  unbind?.();
  unbind = undefined;
  view?.destroy();
  document.body.replaceChildren();
  if (rects) Object.defineProperty(Range.prototype, 'getClientRects', rects);
  else delete (Range.prototype as Partial<Range>).getClientRects;
  if (rect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rect);
  else delete (Range.prototype as Partial<Range>).getBoundingClientRect;
  vi.restoreAllMocks();
});
function editor(doc = 'one\nsecond\nthird', enabled = true) {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [enabled ? vim() : [], history(), keymap.of(defaultKeymap)],
    }),
  });
  view.focus();
  unbind = bindVimInput(view);
}
function press(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  view.contentDOM.dispatchEvent(event);
  return event;
}
function beforeInput(text: string, inputType = 'insertCompositionText') {
  const event = new InputEvent('beforeinput', { data: text, inputType, bubbles: true, cancelable: true });
  view.contentDOM.dispatchEvent(event);
  return event;
}
// jsdom cannot generate an OS IME commit. Deliver its resulting text through
// the real CodeMirror input-handler pipeline, then apply the normal fallback.
function inputText(text: string) {
  const { from, to } = view.state.selection.main;
  const insert = () => view.state.update(view.state.replaceSelection(text));
  const handled = view.state
    .facet(EditorView.inputHandler)
    .some((handler) => handler(view, from, to, text, insert));
  if (!handled) view.dispatch(insert());
  return handled;
}

test.each([
  ['ㅓ', {}],
  ['Process', { isComposing: true }],
  ['Dead', { keyCode: 229 }],
  ['', { keyCode: 229 }],
] as const)('real Vim Normal resolves %j to j without inserting Korean text', (key, signal) => {
  editor();
  // jsdom has no line geometry. Compare with the real engine's ASCII motion,
  // leaving visual one-line distances to browser coverage.
  expect(press('j', { code: 'KeyJ' }).defaultPrevented).toBe(true);
  const asciiPosition = view.state.selection.main.head;
  expect(asciiPosition).toBeGreaterThan(0);
  view.dispatch({ selection: { anchor: 0 } });
  expect(beforeInput('ㅓ').defaultPrevented).toBe(true);
  expect(press(key, { code: 'KeyJ', ...signal }).defaultPrevented).toBe(true);
  expect(view.state.selection.main.head).toBe(asciiPosition);
  expect(view.state.doc.toString()).toBe('one\nsecond\nthird');
  expect(getCM(view)?.state.vim?.insertMode).toBe(false);
});

test.each([
  ['ㅑ', {}],
  ['Process', { isComposing: true }],
  ['Dead', { keyCode: 229 }],
] as const)('real Vim enters Insert with %j, preserves input, then returns with Escape', (key, signal) => {
  editor('body');
  expect(press(key, { code: 'KeyI', ...signal }).defaultPrevented).toBe(true);
  expect(getCM(view)?.state.vim?.insertMode).toBe(true);
  expect(beforeInput('한글').defaultPrevented).toBe(false);
  expect(press('Process', { code: 'KeyJ', isComposing: true, keyCode: 229 }).defaultPrevented).toBe(false);
  expect(inputText('한글')).toBe(false);
  expect(press('j', { code: 'KeyJ' }).defaultPrevented).toBe(false);
  expect(beforeInput('j', 'insertText').defaultPrevented).toBe(false);
  expect(inputText('j')).toBe(false);
  expect(view.state.doc.toString()).toBe('한글jbody');
  expect(press('Escape', { code: 'Escape', keyCode: 27 }).defaultPrevented).toBe(true);
  expect(getCM(view)?.state.vim?.insertMode).toBe(false);
  expect(beforeInput('ㅓ').defaultPrevented).toBe(true);
});

test.each(['f', 'r'])(
  'real Vim %s preserves the following Korean literal instead of physical-key normalization',
  (command) => {
    editor('abc한def');
    press(command, { code: command === 'f' ? 'KeyF' : 'KeyR' });
    expect(getCM(view)?.state.vim?.expectLiteralNext).toBe(true);
    expect(beforeInput('한').defaultPrevented).toBe(false);
    expect(press('Process', { code: 'KeyG', keyCode: 229 }).defaultPrevented).toBe(false);
    expect(inputText('한')).toBe(true);
    expect(getCM(view)?.state.vim?.insertMode).toBe(false);
    expect(getCM(view)?.state.vim?.expectLiteralNext).toBe(false);
    if (command === 'f') {
      expect(view.state.doc.toString()).toBe('abc한def');
      expect(view.state.selection.main.head).toBe(3);
    } else {
      expect(view.state.doc.toString()).toBe('한bc한def');
      expect(view.state.selection.main.head).toBe(0);
    }
  },
);

test('Vim disabled preserves Korean physical command keys and native text', () => {
  editor('body', false);
  expect(press('ㅑ', { code: 'KeyI' }).defaultPrevented).toBe(false);
  expect(beforeInput('한글').defaultPrevented).toBe(false);
  expect(inputText('한글')).toBe(false);
  expect(view.state.doc.toString()).toBe('한글body');
  expect(getCM(view)?.state.vim).toBeUndefined();
});
