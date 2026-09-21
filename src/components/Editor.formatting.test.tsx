// @vitest-environment jsdom
import { act, createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { getCM, Vim } from '@replit/codemirror-vim';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Editor, type EditorHandle } from './Editor';
import { createBuiltinCommands, type BuiltinCommandId } from '../lib/builtinCommands';
import { vimNormalBindings } from '../lib/commands';
import { useCommandKeys } from '../lib/useCommandKeys';
import type { Settings, Workspace } from '../lib/types';

// Command defaults are created at module load, so choose the platform before imports run.
vi.hoisted(() => Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' }));

const handle = createRef<EditorHandle>();
const changed = vi.fn();
const onError = vi.fn();
const settings = {
  vim: false,
  leader: ' ',
  keybindings: {},
  lineNumbers: 'none',
  cursorShape: 'bar',
  cursorFollowVim: true,
  cursorBlink: 'steady',
  cursorBlinkRate: 600,
  cursorAnimation: 'none',
} as Settings;

function Harness({
  vim = false,
  live = false,
  hidden = false,
  overrides = {},
}: {
  vim?: boolean;
  live?: boolean;
  hidden?: boolean;
  overrides?: Settings['keybindings'];
}) {
  const [value, setValue] = useState('hello world');
  const [mode, setMode] = useState(vim ? 'NORMAL' : 'EDIT');
  const configuration = { ...settings, vim, keybindings: overrides };
  const commands = createBuiltinCommands({
    'note.format.bold': () => handle.current?.format('bold'),
    'note.format.italic': () => handle.current?.format('italic'),
    'note.format.underline': () => handle.current?.format('underline'),
  } as Record<BuiltinCommandId, () => void>);
  useCommandKeys(commands, configuration, mode, false, onError);
  const workspace = {
    vault: { id: 'formatting-tests' },
    path: '/temporary/formatting-tests',
    notes: [],
    databases: [],
    records: [],
    links: [],
    extensions: [],
    settings: configuration,
  } as unknown as Workspace;
  return (
    <>
      <input aria-label="Other field" />
      <output data-mode>{mode}</output>
      <Editor
        ref={handle}
        noteId="formatting-note"
        value={value}
        hidden={hidden}
        vimEnabled={vim}
        livePreview={live}
        workspace={workspace}
        openNote={() => {}}
        openLink={() => {}}
        vimBindings={vimNormalBindings(commands, configuration)}
        onCommand={(id) => void commands.find((command) => command.id === id)?.run()}
        commandLineHost={{ current: null }}
        slash={false}
        onChange={(body) => {
          changed(body);
          setValue(body);
        }}
        onMode={setMode}
        onSlash={() => {}}
        onNoteCommand={async () => {}}
        onError={onError}
      />
    </>
  );
}

let host: HTMLDivElement;
let root: Root;
const rects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
const rect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  const stored = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(),
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  if (rects) Object.defineProperty(Range.prototype, 'getClientRects', rects);
  else Reflect.deleteProperty(Range.prototype, 'getClientRects');
  if (rect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rect);
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});

const view = () => EditorView.findFromDOM(host.querySelector('.cm-content')!)!;
async function render(options: Parameters<typeof Harness>[0] = {}) {
  await act(async () => root.render(<Harness {...options} />));
  await act(async () => view().focus());
}
async function selectWord() {
  await act(async () => view().dispatch({ selection: { anchor: 0, head: 5 } }));
}
async function press(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    code: key === ' ' ? 'Space' : /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  await act(async () => void document.activeElement!.dispatchEvent(event));
  return event;
}
async function leader(keys: string) {
  await press(' ');
  for (const key of keys) await press(key);
}

test.each([
  ['b', '**hello**'],
  ['i', '*hello*'],
  ['u', '<u>hello</u>'],
])(
  'Cmd+%s toggles the real editor selection and delivers the new document to autosave',
  async (key, expected) => {
    await render();
    await selectWord();
    expect((await press(key, { metaKey: true })).defaultPrevented).toBe(true);
    expect(view().state.doc.toString()).toBe(`${expected} world`);
    expect(changed).toHaveBeenLastCalledWith(`${expected} world`);
    expect(view().state.sliceDoc(view().state.selection.main.from, view().state.selection.main.to)).toBe(
      'hello',
    );
    await press(key, { metaKey: true });
    expect(view().state.doc.toString()).toBe('hello world');
    expect(changed).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  },
);

test.each([
  ['mb', '**hello**'],
  ['mi', '*hello*'],
  ['mu', '<u>hello</u>'],
])(
  'Visual leader %s formats the selected word in Live Preview and preserves yank selection',
  async (keys, expected) => {
    await render({ vim: true, live: true });
    for (const key of ['v', 'i', 'w']) await press(key);
    expect(getCM(view())?.state.vim?.visualMode).toBe(true);
    expect(host.querySelector('[data-mode]')?.textContent).toBe('VISUAL');
    await leader(keys);
    expect(view().state.doc.toString()).toBe(`${expected} world`);
    expect(changed).toHaveBeenLastCalledWith(`${expected} world`);
    await press('y');
    expect(Vim.getRegisterController().unnamedRegister.toString()).toBe('hello');
    expect(view().state.doc.toString()).toBe(`${expected} world`);
    expect(onError).not.toHaveBeenCalled();
  },
);

test.each([
  ['bold', 'b', '**hello**'],
  ['italic', 'i', '*hello*'],
  ['underline', 'u', '<u>hello</u>'],
])(
  'custom %s shortcut replaces the default and explicit disable stops formatting',
  async (format, key, expected) => {
    const id = `note.format.${format}`;
    const overrides = { [id]: [{ keys: 'Mod+y', leader: false }] };
    await render({ overrides });
    await selectWord();
    await press(key, { metaKey: true });
    expect(view().state.doc.toString()).toBe('hello world');
    // Removing Cmd+i restores CodeMirror's select-parent-syntax binding.
    await selectWord();
    await press('y', { metaKey: true });
    expect(view().state.doc.toString()).toBe(`${expected} world`);
    changed.mockClear();
    // A fresh history isolates disable from Cmd+u's normal undo-selection fallback.
    await act(async () => root.render(<Harness key="disabled" overrides={{ [id]: [] }} />));
    await act(async () => view().focus());
    await selectWord();
    await press(key, { metaKey: true });
    await press('y', { metaKey: true });
    expect(view().state.doc.toString()).toBe('hello world');
    expect(changed).not.toHaveBeenCalled();
  },
);

test('custom Visual leader formatting honors override and disable', async () => {
  const overrides = { 'note.format.bold': [{ keys: 'zz', leader: true }] };
  await render({ vim: true, overrides });
  for (const key of ['v', 'i', 'w']) await press(key);
  await leader('mb');
  expect(view().state.doc.toString()).toBe('hello world');
  await leader('zz');
  expect(view().state.doc.toString()).toBe('**hello** world');
  await render({ vim: true, overrides: { 'note.format.bold': [] } });
  changed.mockClear();
  await leader('mb');
  await leader('zz');
  expect(view().state.doc.toString()).toBe('**hello** world');
  expect(changed).not.toHaveBeenCalled();
});

test('formatting does not change a hidden read-mode editor or a body whose focus moved to another field', async () => {
  await render();
  await selectWord();
  host.querySelector<HTMLInputElement>('input')!.focus();
  for (const key of ['b', 'i', 'u']) await press(key, { metaKey: true });
  expect(view().state.doc.toString()).toBe('hello world');
  expect(changed).not.toHaveBeenCalled();
  await render({ hidden: true });
  for (const key of ['b', 'i', 'u']) await press(key, { metaKey: true });
  expect(view().state.doc.toString()).toBe('hello world');
  expect(changed).not.toHaveBeenCalled();
});

test('formatting from a nested widget input preserves the stale body selection and its document', async () => {
  await render();
  await selectWord();
  const editor = view();
  const selection = editor.state.selection;
  const field = document.createElement('input');
  field.value = 'Property draft';
  await act(async () => {
    // Table/frontmatter widgets put separate inputs inside CodeMirror's content element.
    editor.contentDOM.append(field);
    field.focus();
    expect(editor.hasFocus).toBe(false);
    expect(document.activeElement).toBe(field);
    try {
      for (const format of ['bold', 'italic', 'underline'] as const) handle.current?.format(format);
      expect(editor.state.doc.toString()).toBe('hello world');
      expect(editor.state.selection.eq(selection)).toBe(true);
      expect(field.value).toBe('Property draft');
      expect(document.activeElement).toBe(field);
      expect(changed).not.toHaveBeenCalled();
    } finally {
      field.remove();
    }
  });
});

test('formatting leaves IME composition alone, including a shortcut without the composing flag', async () => {
  await render();
  await selectWord();
  for (const key of ['b', 'i', 'u']) {
    await press(key, { metaKey: true, isComposing: true, keyCode: 229 });
  }
  await act(async () =>
    view().contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })),
  );
  expect(view().compositionStarted).toBe(true);
  for (const key of ['b', 'i', 'u']) await press(key, { metaKey: true });
  expect(view().state.doc.toString()).toBe('hello world');
  expect(changed).not.toHaveBeenCalled();
});
