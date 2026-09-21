// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { Vim, getCM, vim } from '@replit/codemirror-vim';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { bindVimInput } from './vimInput';
import { bindVimKeybindings } from './vimKeybindings';
import { livePreviewExtension } from './livePreview';
import type { Workspace } from './types';

let view: EditorView;
let unbind: (() => void) | undefined;
const rects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
const rect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
const context = {
  workspace: { notes: [], records: [] } as unknown as Workspace,
  openNote() {},
  openLink() {},
};

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
});

function editor(doc: string, at: string | number = 0, live = false) {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor: typeof at === 'number' ? at : doc.indexOf(at) },
      extensions: [
        vim(),
        history(),
        markdown({ extensions: [GFM] }),
        live ? livePreviewExtension(() => context, true) : [],
        keymap.of(defaultKeymap),
      ],
    }),
  });
  view.focus();
  const inputCleanup = bindVimInput(view);
  const keyCleanup = bindVimKeybindings(getCM(view)!, [], () => {});
  unbind = () => {
    keyCleanup();
    inputCleanup();
  };
}

function press(keys: string) {
  for (const key of keys) Vim.handleKey(getCM(view)!, key, 'user');
}

function selected() {
  const { from, to } = view.state.selection.main;
  return view.state.doc.sliceString(from, to);
}

async function answerPrompt(value: string) {
  const dialog = getCM(view)!.state.dialog as HTMLElement;
  const input = dialog.querySelector('input')!;
  expect(input).toBeTruthy();
  input.value = value;
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }),
  );
  await Promise.resolve();
}

test.each([
  ['dif', 'outer(first, inner(second, third))', 'second', 'outer(first, inner())'],
  ['daf', 'outer(first, inner(second, third))', 'second', 'outer(first, )'],
  ['dia', 'fn(first, nested(second, third), last)', 'nested', 'fn(first, , last)'],
  ['daa', 'fn(first,second,last)', 'second', 'fn(first,last)'],
  ['daa', 'fn(first,second,last)', 'last', 'fn(first,second)'],
  ['diq', 'before "한글 단어" after', '한글', 'before "" after'],
  ['daq', "before 'word' after", 'word', 'before  after'],
  ['dib', 'before [word] after', 'word', 'before [] after'],
  ['di(', 'before (  word  ) after', 'word', 'before (    ) after'],
  ['di)', 'before (  word  ) after', 'word', 'before () after'],
  ['di|', 'left|middle|right', 'middle', 'left||right'],
  ['da|', 'left|middle|right', 'middle', 'left|right'],
] as const)('%s integrates with real Vim operators: %s', (keys, doc, at, expected) => {
  editor(doc, at);
  press(keys);
  expect(view.state.doc.toString()).toBe(expected);
  expect(getCM(view)!.state.vim?.insertMode).toBe(false);
  press('u');
  expect(view.state.doc.toString()).toBe(doc);
});

test.each([
  ['din)', '(first) between (second) after', 'first', '(first) between () after'],
  ['danq', '"first" between `second` after', 'first', '"first" between  after'],
  ['dil)', '(first) between (second) after', 'second', '() between (second) after'],
  ['dalq', '\'first\' between "second" after', 'second', ' between "second" after'],
] as const)(
  '%s waits for its object identifier instead of consuming the prefix',
  (keys, doc, at, expected) => {
    editor(doc, at);
    press(keys.slice(0, -1));
    expect(view.state.doc.toString()).toBe(doc);
    expect(getCM(view)!.state.vim?.insertMode).toBe(false);
    press(keys.slice(-1));
    expect(view.state.doc.toString()).toBe(expected);
  },
);

test('next-object prefix can be cancelled without leaving a pending operator', () => {
  const doc = '(first) and (second)';
  editor(doc, 'first');
  press('din');
  Vim.handleKey(getCM(view)!, '<Esc>', 'user');
  press('l');
  expect(view.state.doc.toString()).toBe(doc);
  expect(view.state.selection.main.head).toBe(doc.indexOf('first') + 1);
  expect(getCM(view)!.state.vim?.inputState.operator).toBeFalsy();
});

test.each([
  ['d2if', 'outer(first, inner(second, third))', 'second', 'outer()'],
  ['2diq', '"first" "second" "third"', 'first', '"first" "" "third"'],
  ['2d2iq', '"first" "second" "third" "fourth"', 'first', '"first" "second" "third" ""'],
  ['d2in)', '(first) (second) (third)', 'first', '(first) (second) ()'],
  ['2d2inq', '"first" "second" "third" "fourth" "fifth"', 'first', '"first" "second" "third" "fourth" ""'],
] as const)('%s preserves Vim count semantics', (keys, doc, at, expected) => {
  editor(doc, at);
  press(keys);
  expect(view.state.doc.toString()).toBe(expected);
});

test('repeated Visual objects expand from the existing selection', () => {
  editor('outer(first, inner(second, third))', 'second');
  press('vif');
  expect(selected()).toBe('second, third');
  press('if');
  expect(selected()).toBe('first, inner(second, third)');
  press('y');
  expect(Vim.getRegisterController().getRegister('"').toString()).toBe('first, inner(second, third)');
});

test('repeated Visual selection expands even when the first inner object is one character', () => {
  editor('outer(inner(x))', 'x');
  press('vif');
  expect(selected()).toBe('x');
  press('if');
  expect(selected()).toBe('inner(x)');
});

test.each(['hello 😀', '😀', '😀 한글 😀'])(
  'Visual emoji object %j preserves the full source range',
  (body) => {
    editor(`fn(${body}) after`, body);
    press('vif');
    expect(selected()).toBe(body);
    press('o');
    expect(selected()).toBe(body);
    press('d');
    expect(view.state.doc.toString()).toBe('fn() after');
  },
);

test('motion after an emoji-ended object selection starts at the complete last character', () => {
  editor('fn(hello 😀) after', 'hello');
  press('vif');
  press('h');
  expect(selected()).toBe('hello ');
  press('d');
  expect(view.state.doc.toString()).toBe('fn(😀) after');
});

test('Visual next and previous objects replace selection without extending through the gap', () => {
  editor('"first" between `second` after', 'first');
  press('viq');
  expect(selected()).toBe('first');
  press('inq');
  expect(selected()).toBe('second');
  press('ilq');
  expect(selected()).toBe('first');
});

test('named registers and dot repeat retain the new text object motion', () => {
  editor('fn(first,last) and fn(second,last)', 'first');
  press('"zdia');
  expect(Vim.getRegisterController().getRegister('z').toString()).toBe('first');
  const doc = view.state.doc.toString();
  view.dispatch({ selection: { anchor: doc.indexOf('second') } });
  press('.');
  expect(view.state.doc.toString()).toBe('fn(,last) and fn(,last)');
  press('u');
  expect(view.state.doc.toString()).toBe(doc);
});

test('dot repeat preserves explicit next-object traversal', () => {
  editor('(first) (second) (third)', 'first');
  press('dan)');
  expect(view.state.doc.toString()).toBe('(first)  (third)');
  view.dispatch({ selection: { anchor: 1 } });
  press('.');
  expect(view.state.doc.toString()).toBe('(first)  ');
});

test.each(['ci)', 'cif'])('%s enters Insert in an empty pair without deleting its closer', (keys) => {
  editor('fn() after', 3);
  press(keys);
  expect(getCM(view)!.state.vim?.insertMode).toBe(true);
  expect(view.state.doc.toString()).toBe('fn() after');
  view.dispatch(view.state.replaceSelection('한글'));
  expect(view.state.doc.toString()).toBe('fn(한글) after');
});

test('object edge motions support both boundaries and counts', () => {
  const doc = 'before outer(first, inner(second)) after';
  editor(doc, 'second');
  press('g[f');
  expect(view.state.selection.main.head).toBe(doc.indexOf('inner'));
  press('g]f');
  expect(view.state.selection.main.head).toBe(doc.indexOf('))'));
  press('g]f');
  expect(view.state.selection.main.head).toBe(doc.indexOf('))') + 1);
  view.dispatch({ selection: { anchor: doc.indexOf('second') } });
  press('2g[f');
  expect(view.state.selection.main.head).toBe(doc.indexOf('outer'));
  expect(view.state.doc.toString()).toBe(doc);
});

test('next quote selection works while Markdown decorations are active', () => {
  editor('**before** "first" and `second`', 'first', true);
  press('vinq');
  expect(selected()).toBe('second');
  press('d');
  expect(view.state.doc.toString()).toBe('**before** "first" and ``');
});

test('a separator object uses the physical Space event without entering Insert', () => {
  editor('first middle last', 'middle');
  press('di');
  const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
  view.contentDOM.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(view.state.doc.toString()).toBe('first  last');
  expect(getCM(view)!.state.vim?.insertMode).toBe(false);
});

test('Korean command events resolve the complete next-object sequence', () => {
  editor('"첫째" and "둘째"', '첫째', true);
  for (const code of ['KeyD', 'KeyI', 'KeyN', 'KeyQ']) {
    const event = new KeyboardEvent('keydown', {
      key: 'Process',
      code,
      isComposing: true,
      keyCode: 229,
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(getCM(view)!.state.vim?.expectLiteralNext).not.toBe(true);
  }
  expect(view.state.doc.toString()).toBe('"첫째" and ""');
});

test('unmatched objects and a cancelled prefix preserve ordinary Insert and Append', () => {
  editor('plain text', 2);
  press('dif');
  expect(view.state.doc.toString()).toBe('plain text');
  expect(getCM(view)!.state.vim?.insertMode).toBe(false);
  expect(view.state.selection.main.head).toBe(2);
  press('i');
  expect(getCM(view)!.state.vim?.insertMode).toBe(true);
  Vim.handleKey(getCM(view)!, '<Esc>', 'user');
  press('a');
  expect(getCM(view)!.state.vim?.insertMode).toBe(true);
});

test('configured commands take precedence and rebinding removes only the old editor mappings', () => {
  const doc = 'fn(word)';
  editor(doc, 'word');
  const cm = getCM(view)!;
  const calls: string[] = [];
  const customCleanup = bindVimKeybindings(cm, [{ id: 'test.command', keys: 'g]f' }], (id) => calls.push(id));
  const ordinaryCleanup = () => bindVimKeybindings(cm, [], () => {});
  let cleanup: (() => void) | undefined;
  try {
    press('g]f');
    expect(calls).toEqual(['test.command']);
    expect(view.state.selection.main.head).toBe(doc.indexOf('word'));
    cleanup = ordinaryCleanup();
    customCleanup();
    press('g]f');
    expect(view.state.selection.main.head).toBe(doc.indexOf(')'));
    expect(calls).toEqual(['test.command']);
  } finally {
    cleanup?.();
    customCleanup();
  }
});

test('literal pair prompts feed the native operator and dot repeat reuses the entered delimiters', async () => {
  editor('BEGIN first END then BEGIN second END', 'first');
  press('di?');
  await answerPrompt('BEGIN');
  await answerPrompt('END');
  expect(view.state.doc.toString()).toBe('BEGINEND then BEGIN second END');
  const doc = view.state.doc.toString();
  view.dispatch({ selection: { anchor: doc.indexOf('second') } });
  press('.');
  expect(view.state.doc.toString()).toBe('BEGINEND then BEGINEND');
  press('u');
  expect(view.state.doc.toString()).toBe(doc);
});

test('literal pair prompts preserve Visual selection, counts, and literal punctuation', async () => {
  editor('[.outer [.inner.] outer.]', 'inner');
  press('v2a?');
  await answerPrompt('[.');
  await answerPrompt('.]');
  expect(selected()).toBe('[.outer [.inner.] outer.]');
  expect(getCM(view)!.state.vim?.visualMode).toBe(true);
});

test('literal pair prompts support empty inner changes', async () => {
  editor('BEGINEND after', 5);
  press('ci?');
  await answerPrompt('BEGIN');
  await answerPrompt('END');
  expect(getCM(view)!.state.vim?.insertMode).toBe(true);
  view.dispatch(view.state.replaceSelection('한글'));
  expect(view.state.doc.toString()).toBe('BEGIN한글END after');
});

test('cancelling a pair prompt leaves the document and pending input unchanged', () => {
  const doc = 'BEGIN content END';
  editor(doc, 'content');
  press('da?');
  const dialog = getCM(view)!.state.dialog as HTMLElement;
  dialog
    .querySelector('input')!
    .dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }),
    );
  expect(view.state.doc.toString()).toBe(doc);
  press('l');
  expect(view.state.selection.main.head).toBe(doc.indexOf('content') + 1);
  expect(getCM(view)!.state.vim?.insertMode).toBe(false);
});

test('delayed pair prompt completion cannot modify a changed document', async () => {
  editor('BEGIN content END', 'content');
  press('di?');
  await answerPrompt('BEGIN');
  view.dispatch({ changes: { from: 0, insert: 'changed ' } });
  await answerPrompt('END');
  expect(view.state.doc.toString()).toBe('changed BEGIN content END');
});

test('pair edge prompts can move from Normal mode without entering Insert', async () => {
  editor('BEGIN content END', 'content');
  press('g[?');
  await answerPrompt('BEGIN');
  await answerPrompt('END');
  expect(view.state.selection.main.head).toBe(0);
  expect(getCM(view)!.state.vim?.insertMode).toBe(false);
});

test('Enter during delimiter composition does not submit the pair prompt', async () => {
  editor('시작 content 끝', 'content');
  press('di?');
  const dialog = getCM(view)!.state.dialog as HTMLElement;
  const input = dialog.querySelector('input')!;
  input.value = '시작';
  input.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      keyCode: 13,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(getCM(view)!.state.dialog).toBe(dialog);
  expect(view.state.doc.toString()).toBe('시작 content 끝');
  await answerPrompt('시작');
  await answerPrompt('끝');
  expect(view.state.doc.toString()).toBe('시작끝');
});

test('unbinding while a delimiter prompt is open cancels it and its delayed operator', async () => {
  const doc = 'BEGIN content END';
  editor(doc, 'content');
  press('di?');
  await answerPrompt('BEGIN');
  const input = (getCM(view)!.state.dialog as HTMLElement).querySelector('input')!;
  unbind?.();
  unbind = undefined;
  input.value = 'END';
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }),
  );
  await Promise.resolve();
  expect(view.state.doc.toString()).toBe(doc);
  expect(getCM(view)!.state.dialog).toBeNull();
});
