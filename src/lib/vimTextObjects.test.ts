// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
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

function editor(doc: string, at: string, live = true) {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor: doc.indexOf(at) },
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
  const unbindInput = bindVimInput(view);
  const unbindKeys = bindVimKeybindings(getCM(view)!, [], () => {});
  unbind = () => {
    unbindKeys();
    unbindInput();
  };
}

function press(keys: string) {
  for (const key of keys) Vim.handleKey(getCM(view)!, key, 'user');
}

test.each([
  ['iw', 'prefix hello-world suffix', 'ello', 'prefix -world suffix'],
  ['aw', 'prefix hello world', 'ello', 'prefix world'],
  ['iW', 'prefix hello-world suffix', 'ello', 'prefix  suffix'],
  ['aW', 'prefix hello-world suffix', 'ello', 'prefix suffix'],
  ['i(', 'prefix (hello world) suffix', 'ello', 'prefix () suffix'],
  ['a)', 'prefix (hello world) suffix', 'ello', 'prefix  suffix'],
  ['ib', 'prefix (hello world) suffix', 'ello', 'prefix () suffix'],
  ['i[', 'prefix [hello world] suffix', 'ello', 'prefix [] suffix'],
  ['a]', 'prefix [hello world] suffix', 'ello', 'prefix  suffix'],
  ['i{', 'prefix {hello world} suffix', 'ello', 'prefix {} suffix'],
  ['aB', 'prefix {hello world} suffix', 'ello', 'prefix  suffix'],
  ['i<', 'prefix <hello world> suffix', 'ello', 'prefix <> suffix'],
  ['i"', 'prefix "hello world" suffix', 'ello', 'prefix "" suffix'],
  ["a'", "prefix 'hello world' suffix", 'ello', 'prefix  suffix'],
  ['i`', 'prefix `hello world` suffix', 'ello', 'prefix `` suffix'],
  ['is', 'First sentence. Second sentence. Third sentence.', 'econd', 'First sentence.  Third sentence.'],
  [
    'ip',
    'First paragraph.\n\nSecond paragraph.\nContinued.\n\nLast.',
    'econd',
    'First paragraph.\n\n\nLast.',
  ],
] as const)('standard d%s edits the correct source range in live preview', (object, doc, at, expected) => {
  editor(doc, at);
  press(`d${object}`);
  expect(view.state.doc.toString()).toBe(expected);
  press('u');
  expect(view.state.doc.toString()).toBe(doc);
});

test.each([
  ['iw', 'prefix 한글단어 suffix', '글', '한글단어'],
  ['iW', 'prefix hello-world suffix', 'ello', 'hello-world'],
  ['i(', 'prefix (hello world) suffix', 'ello', 'hello world'],
  ['a[', 'prefix [hello world] suffix', 'ello', '[hello world]'],
  ['i"', 'prefix "hello world" suffix', 'ello', 'hello world'],
  ['is', 'First sentence. Second sentence. Third sentence.', 'econd', 'Second sentence.'],
] as const)('standard v%s selects editable text in live preview', (object, doc, at, expected) => {
  editor(doc, at);
  press(`v${object}`);
  expect(getCM(view)!.state.vim?.visualMode).toBe(true);
  const { from, to } = view.state.selection.main;
  expect(view.state.doc.sliceString(from, to)).toBe(expected);
  expect(view.state.doc.toString()).toBe(doc);
});

test('Korean command events support pending operator text objects', () => {
  editor('prefix 한글단어 suffix', '글');
  for (const [key, code] of [
    ['ㅊ', 'KeyC'],
    ['ㅑ', 'KeyI'],
    ['ㅈ', 'KeyW'],
  ]) {
    const event = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  }
  expect(view.state.doc.toString()).toBe('prefix  suffix');
  expect(getCM(view)!.state.vim?.insertMode).toBe(true);
});

test.each([
  ['i*', 'prefix **bold words** suffix', 'old', 'prefix **** suffix'],
  ['a*', 'prefix **bold words** suffix', 'old', 'prefix  suffix'],
  ['i*', 'prefix *italic words* suffix', 'talic', 'prefix ** suffix'],
  ['a*', 'prefix *italic words* suffix', 'talic', 'prefix  suffix'],
  ['i_', 'prefix __bold words__ suffix', 'old', 'prefix ____ suffix'],
  ['a_', 'prefix _italic words_ suffix', 'talic', 'prefix  suffix'],
  ['i~', 'prefix ~~obsolete words~~ suffix', 'bsolete', 'prefix ~~~~ suffix'],
  ['a~', 'prefix ~~obsolete words~~ suffix', 'bsolete', 'prefix  suffix'],
  ['i*', '**outer *inner* end**', 'nner', '**outer ** end**'],
  ['2i*', '**outer *inner* end**', 'nner', '****'],
  ['a*', '**multiple\nlines**', 'lines', ''],
  ['i*', '**boundary**', '**boundary', '****'],
  ['i*', '**boundary**', 'y**', '****'],
  ['it', 'prefix <u>underlined words</u> suffix', 'nderlined', 'prefix <u></u> suffix'],
  ['at', 'prefix <u>underlined words</u> suffix', 'nderlined', 'prefix  suffix'],
  ['it', 'prefix <u>outer <u>inner</u> end</u> suffix', 'nner', 'prefix <u>outer <u></u> end</u> suffix'],
] as const)('Markdown d%s edits the matching syntax node: %s', (object, doc, at, expected) => {
  editor(doc, at);
  press(`d${object}`);
  expect(view.state.doc.toString()).toBe(expected);
  press('u');
  expect(view.state.doc.toString()).toBe(doc);
});

test.each([
  ['i*', '**bold words**', 'old', 'bold words'],
  ['a*', '**bold words**', 'old', '**bold words**'],
  ['i_', '_italic words_', 'talic', 'italic words'],
  ['a~', '~~obsolete words~~', 'bsolete', '~~obsolete words~~'],
  ['i*', '**multiple\nlines**', 'lines', 'multiple\nlines'],
  ['2a*', '**outer *inner* end**', 'nner', '**outer *inner* end**'],
  ['it', '<u>underlined words</u>', 'nderlined', 'underlined words'],
  ['at', '<u>underlined words</u>', 'nderlined', '<u>underlined words</u>'],
] as const)('Markdown v%s selects delimiters only for around objects', (object, doc, at, expected) => {
  editor(doc, at);
  press(`v${object}`);
  const { from, to } = view.state.selection.main;
  expect(view.state.doc.sliceString(from, to)).toBe(expected);
  press('y');
  expect(Vim.getRegisterController().getRegister('"').toString()).toBe(expected);
  expect(view.state.doc.toString()).toBe(doc);
});

test.each([
  ['i*', '\\*not emphasis\\*', 'not'],
  ['i*', '*not closed', 'not'],
  ['2i*', '**one**', 'one'],
  ['i_', '**only stars**', 'only'],
  ['it', '<u>not closed', 'not'],
] as const)('Markdown d%s leaves nonmatching text unchanged: %s', (object, doc, at) => {
  editor(doc, at);
  const anchor = view.state.selection.main.head;
  press(`d${object}`);
  expect(view.state.doc.toString()).toBe(doc);
  expect(view.state.selection.main.head).toBe(anchor);
  expect(getCM(view)!.state.vim?.insertMode).toBe(false);
});

test.each([
  ['i*', '`**not bold**`', 'not', '`****`'],
  ['i_', 'some_identifier_here', 'identifier', 'some__here'],
  ['i*', '**one** plain **two**', 'plain', '**one** plain ****'],
  ['it', '`<u>code</u>`', 'code', '`<u></u>`'],
  ['it', '<u class="unsafe">text</u>', 'text', '<u class="unsafe"></u>'],
] as const)(
  'mini.ai d%s searches source delimiters and the next available object',
  (object, doc, at, expected) => {
    editor(doc, at);
    press(`d${object}`);
    expect(view.state.doc.toString()).toBe(expected);
    press('u');
    expect(view.state.doc.toString()).toBe(doc);
  },
);

test('Markdown text objects support named registers, dot repeat and source mode', () => {
  editor('**first** then **second**', 'first', false);
  press('"ada*');
  expect(Vim.getRegisterController().getRegister('a').toString()).toBe('**first**');
  const doc = view.state.doc.toString();
  view.dispatch({ selection: { anchor: doc.indexOf('second') } });
  press('.');
  expect(view.state.doc.toString()).toBe(' then ');
});

test('Markdown change-inner keeps the markup and enters Insert for replacement', () => {
  editor('prefix **한글** suffix', '한');
  press('ci*');
  expect(getCM(view)!.state.vim?.insertMode).toBe(true);
  view.dispatch(view.state.replaceSelection('새 내용'));
  expect(view.state.doc.toString()).toBe('prefix **새 내용** suffix');
});

test('Markdown object mappings preserve immediate Normal i/a behavior', () => {
  editor('**word**', 'word');
  press('i');
  expect(getCM(view)!.state.vim?.insertMode).toBe(true);
  Vim.handleKey(getCM(view)!, '<Esc>', 'user');
  press('a');
  expect(getCM(view)!.state.vim?.insertMode).toBe(true);
});

test('Korean Visual object keys select Markdown text without inserting composition', () => {
  editor('prefix **한글** suffix', '한');
  for (const [code, shiftKey] of [
    ['KeyV', false],
    ['KeyI', false],
    ['Digit8', true],
  ] as const) {
    const event = new KeyboardEvent('keydown', {
      key: 'Process',
      code,
      shiftKey,
      isComposing: true,
      keyCode: 229,
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  }
  expect(getCM(view)!.state.vim?.visualMode).toBe(true);
  const { from, to } = view.state.selection.main;
  expect(view.state.doc.sliceString(from, to)).toBe('한글');
  expect(view.state.doc.toString()).toBe('prefix **한글** suffix');
});

test('custom formatting sequences run in Visual after Vim finishes its operation', async () => {
  editor('prefix word suffix', 'word');
  const cm = getCM(view)!;
  const calls: string[] = [];
  const cleanup = bindVimKeybindings(cm, [{ id: 'note.format.bold', keys: 'gB' }], (id) => {
    calls.push(id);
    expect(cm.curOp?.isVimOp).not.toBe(true);
    const { from, to } = view.state.selection.main;
    expect(view.state.doc.sliceString(from, to)).toBe('word');
  });
  try {
    press('viwgB');
    expect(calls).toEqual([]);
    await Promise.resolve();
    expect(calls).toEqual(['note.format.bold']);
  } finally {
    cleanup();
  }
});

test('cleaning up a queued formatting action prevents a stale editor command', async () => {
  editor('word', 'word');
  const calls: string[] = [];
  const cleanup = bindVimKeybindings(getCM(view)!, [{ id: 'note.format.bold', keys: 'gB' }], (id) =>
    calls.push(id),
  );
  press('gB');
  cleanup();
  await Promise.resolve();
  expect(calls).toEqual([]);
});

test('custom note actions remain Normal-only while formatting supports Visual', async () => {
  editor('word', 'word');
  const calls: string[] = [];
  const cleanup = bindVimKeybindings(
    getCM(view)!,
    [
      { id: 'note.format.bold', keys: 'gB' },
      { id: 'note.delete', keys: 'gZ' },
    ],
    (id) => calls.push(id),
  );
  try {
    press('viwgZ');
    await Promise.resolve();
    expect(calls).toEqual([]);
    press('gB');
    await Promise.resolve();
    expect(calls).toEqual(['note.format.bold']);
  } finally {
    cleanup();
  }
});

test('safe underline fallback preserves existing HTML-language tag objects', () => {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: '<div><span>content</span></div>',
      selection: { anchor: 12 },
      extensions: [vim(), html()],
    }),
  });
  unbind = bindVimKeybindings(getCM(view)!, [], () => {});
  press('dit');
  expect(view.state.doc.toString()).toBe('<div><span></span></div>');
});
