// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Editor, type EditorHandle } from './Editor';
import { createBuiltinCommands, type BuiltinCommandId } from '../lib/builtinCommands';
import { vimNormalBindings } from '../lib/commands';
import { openExternalLink } from '../lib/openExternalLink';
import { useCommandKeys } from '../lib/useCommandKeys';
import type { Settings, Workspace } from '../lib/types';

vi.mock('../lib/openExternalLink', () => ({ openExternalLink: vi.fn() }));
const doc = '[[Existing|alias]] and [website](https://example.com/path(a))';
const handle = createRef<EditorHandle>();
const openWiki = vi.fn();
const onError = vi.fn();
const settings = {
  vim: true,
  leader: ' ',
  keybindings: {},
  lineNumbers: 'none',
  cursorShape: 'bar',
  cursorFollowVim: true,
  cursorBlink: 'steady',
  cursorBlinkRate: 600,
  cursorAnimation: 'none',
} as Settings;
const workspace = {
  vault: { id: 'link-tests' },
  path: '/temporary/link-tests',
  notes: [],
  databases: [],
  records: [],
  links: [],
  extensions: [],
  settings,
} as unknown as Workspace;
let root: Root;
let host: HTMLDivElement;

function Harness() {
  const commands = createBuiltinCommands({
    'note.follow-link': () => handle.current?.followLink(),
    'note.follow-existing-link': () => handle.current?.followLink(false),
  } as Record<BuiltinCommandId, () => void>);
  useCommandKeys(commands, settings, 'NORMAL', false, onError);
  return (
    <Editor
      ref={handle}
      noteId="link-note"
      value={doc}
      vimEnabled
      livePreview={false}
      workspace={workspace}
      openNote={() => {}}
      openLink={openWiki}
      vimBindings={vimNormalBindings(commands, settings)}
      onCommand={(id) => void commands.find((command) => command.id === id)?.run()}
      commandLineHost={{ current: null }}
      slash={false}
      onChange={() => {}}
      onMode={() => {}}
      onSlash={() => {}}
      onNoteCommand={async () => {}}
      onError={onError}
    />
  );
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  vi.mocked(openExternalLink).mockResolvedValue(true);
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
  await act(async () => handle.current?.focus());
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function select(text: string) {
  const position = doc.indexOf(text);
  await act(async () => handle.current?.restoreLocation({ anchor: position, head: position, scrollTop: 0 }));
}
async function press(key: string, metaKey = false) {
  await act(async () => {
    host
      .querySelector('.cm-content')!
      .dispatchEvent(new KeyboardEvent('keydown', { key, metaKey, bubbles: true, cancelable: true }));
  });
}

test('gd and Cmd+Enter use the shared external opener from the actual editor and command bindings', async () => {
  await select('website');
  await press('g');
  await press('d');
  expect(openExternalLink).toHaveBeenCalledExactlyOnceWith('https://example.com/path(a)');
  await press('Enter', true);
  expect(openExternalLink).toHaveBeenCalledTimes(2);
  expect(openWiki).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

test('wiki navigation keeps gd existing-only and Cmd+Enter create-if-missing semantics', async () => {
  await select('alias');
  await press('g');
  await press('d');
  expect(openWiki).toHaveBeenLastCalledWith('Existing', false);
  await press('Enter', true);
  expect(openWiki).toHaveBeenLastCalledWith('Existing', true);
  expect(openWiki).toHaveBeenCalledTimes(2);
  expect(openExternalLink).not.toHaveBeenCalled();
});

test('an external opener failure reaches the editor error handler', async () => {
  const error = new Error('Browser unavailable');
  vi.mocked(openExternalLink).mockRejectedValueOnce(error);
  await select('website');
  await press('Enter', true);
  expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  expect(openWiki).not.toHaveBeenCalled();
});
