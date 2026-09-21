// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import App from './App';
import { call } from './lib/api';
import { useDesktopOpenPaths } from './lib/useDesktopOpenPaths';
import { platformModifier } from './lib/commands';
import type { Workspace } from './lib/types';

vi.mock('./lib/api', async (original) => ({
  ...(await original<typeof import('./lib/api')>()),
  call: vi.fn(),
}));
vi.mock('./lib/useDesktopOpenPaths', () => ({ useDesktopOpenPaths: vi.fn() }));
vi.mock('./components/Sidebar', () => ({
  Sidebar: ({ view, navigate }: ComponentProps<typeof import('./components/Sidebar').Sidebar>) => (
    <>
      <button data-view={view} onClick={() => navigate('all-notes')}>
        All notes
      </button>
      {(['notes', 'database', 'plugin', 'settings'] as const).map((target) => (
        <button key={target} data-test-view={target} onClick={() => navigate(target)}>
          {target}
        </button>
      ))}
    </>
  ),
}));
vi.mock('./components/AllNotesView', () => ({ AllNotesView: () => null }));
vi.mock('./components/NotePane', () => ({
  NotePane: ({
    workspace,
    noteId,
    note,
    setDialog,
  }: ComponentProps<typeof import('./components/NotePane').NotePane>) => (
    <>
      <output
        className="note-scroll"
        tabIndex={-1}
        data-vault={workspace.path}
        data-selected={noteId ?? ''}
        data-loaded={note.note?.id ?? ''}
      >
        {note.draft.body}
      </output>
      <button data-test-new-note onClick={() => setDialog({ kind: 'new-note' })}>
        New note
      </button>
    </>
  ),
}));

let root: Root;
let host: HTMLDivElement;
let workspaces: Record<string, Workspace>;

function workspace(path: string, ids: string[]): Workspace {
  return {
    path,
    vault: { id: path, name: path, formatVersion: 1 },
    notes: ids.map((id) => ({
      id,
      title: id,
      revision: `revision-${id}`,
      createdAt: '2026-09-21T00:00:00Z',
      updatedAt: '2026-09-21T00:00:00Z',
    })),
    folders: [],
    trash: [],
    databases: [],
    records: [],
    links: [],
    extensions: [],
    settings: {
      vim: false,
      editorMode: 'live',
      lineNumbers: 'none',
      databaseFontSize: 14,
      editorFontFamily: 'system',
      databaseFontFamily: 'system',
      topicFolders: { include: [], exclude: [] },
      cursorShape: 'bar',
      cursorFollowVim: false,
      cursorBlink: 'steady',
      cursorBlinkRate: 500,
      cursorAnimation: 'none',
      slash: false,
      showUnresolvedLinks: false,
      leader: ' ',
      theme: 'paper',
      keybindings: {},
    },
  };
}

const actions = () => vi.mocked(useDesktopOpenPaths).mock.calls.at(-1)![0];
function expectNote(path: string, id: string | null) {
  const pane = host.querySelector('output')!;
  expect(pane).not.toBeNull();
  expect(pane.dataset.vault).toBe(path);
  expect(pane.dataset.selected).toBe(id ?? '');
  expect(pane.dataset.loaded).toBe(id ?? '');
  expect(pane.textContent).toBe(id ? `${id} body` : '');
}
async function refreshWorkspace(path: string) {
  workspaces[path].vault.name += ' refreshed';
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(useDesktopOpenPaths).mockReturnValue(false);
  vi.mocked(useDesktopOpenPaths).mockReturnValue(false);
  const storage = new Map<string, string>([['foltra:last-vault', '/active']]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  workspaces = {
    '/active': workspace('/active', ['active-first', 'active-target']),
    '/other': workspace('/other', ['other-first', 'other-target']),
    '/empty': workspace('/empty', []),
  };
  vi.mocked(call).mockImplementation(async (path, command, args) => {
    if (command === 'workspace.get') return structuredClone(workspaces[path]);
    if (command === 'note.read') {
      const note = workspaces[path].notes.find((item) => item.id === (args as { id: string }).id);
      if (!note) throw new Error('Requested note is outside this vault');
      return { ...note, body: `${note.id} body` };
    }
    throw new Error(`Unexpected core command: ${command}`);
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<App />));
  expectNote('/active', 'active-first');
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('a managed note in another vault survives initial selection and subsequent workspace refresh', async () => {
  await act(async () =>
    actions().open({
      path: '/other/notes/other-target.md',
      vaultPath: '/other',
      noteId: 'other-target',
    }),
  );
  expectNote('/other', 'other-target');
  expect(call).toHaveBeenCalledWith('/other', 'note.read', { id: 'other-target' });
  expect(localStorage.getItem('foltra:last-vault')).toBe('/other');
  await refreshWorkspace('/other');
  expectNote('/other', 'other-target');
});

test('a managed note in the current vault uses ordinary note navigation and back history', async () => {
  vi.mocked(call).mockClear();
  await act(async () =>
    actions().open({
      path: '/active/notes/active-target.md',
      vaultPath: '/active',
      noteId: 'active-target',
    }),
  );
  expectNote('/active', 'active-target');
  expect(vi.mocked(call).mock.calls.some(([, command]) => command === 'workspace.get')).toBe(false);
  const back = host.querySelector<HTMLButtonElement>('button[aria-label="이전 노트"]')!;
  expect(back.disabled).toBe(false);
  await act(async () => back.click());
  expectNote('/active', 'active-first');
});

test('opening the current vault folder returns to notes without replacing the selected note', async () => {
  await act(async () =>
    actions().open({
      path: '/active/notes/active-target.md',
      vaultPath: '/active',
      noteId: 'active-target',
    }),
  );
  await act(async () => host.querySelector<HTMLButtonElement>('[data-view]')!.click());
  expect(host.querySelector('output')).toBeNull();
  await act(async () => actions().open({ path: '/active', vaultPath: '/active' }));
  expectNote('/active', 'active-target');
  expect(host.querySelector('[data-view]')?.getAttribute('data-view')).toBe('notes');
});

test('opening an empty vault clears the previous note and keeps the empty notes view', async () => {
  vi.mocked(call).mockClear();
  await act(async () => actions().open({ path: '/empty', vaultPath: '/empty' }));
  expectNote('/empty', null);
  await refreshWorkspace('/empty');
  expectNote('/empty', null);
  expect(vi.mocked(call).mock.calls.every(([, command]) => command === 'workspace.get')).toBe(true);
});

test('an unfinished new-note dialog blocks native opening and keeps its form draft', async () => {
  await act(async () => host.querySelector<HTMLButtonElement>('[data-test-new-note]')!.click());
  const input = host.querySelector<HTMLInputElement>('input[aria-label="새 노트 이름"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '작성 중인 제목');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  vi.mocked(call).mockClear();
  expect(actions().blocked()).toBe('현재 편집 중인 창이나 작업을 마치거나 취소한 뒤 다시 열어주세요.');
  expectNote('/active', 'active-first');
  expect(host.querySelector('[role="dialog"][aria-label="새 노트"]')).not.toBeNull();
  expect(input.value).toBe('작성 중인 제목');
  expect(call).not.toHaveBeenCalled();
});

test('native opening keeps content inert and shortcuts blocked until the requested note has loaded', async () => {
  let finishLoading!: (value: Workspace) => void;
  const loading = new Promise<Workspace>((resolve) => (finishLoading = resolve));
  const original = vi.mocked(call).getMockImplementation()!;
  vi.mocked(call).mockImplementation((path, command, args) =>
    path === '/other' && command === 'workspace.get' ? loading : original(path, command, args),
  );
  vi.mocked(useDesktopOpenPaths).mockReturnValue(true);
  await act(async () => root.render(<App />));
  let opening!: Promise<void>;
  await act(async () => {
    opening = actions().open({
      path: '/other/notes/other-target.md',
      vaultPath: '/other',
      noteId: 'other-target',
    });
  });
  expect(call).toHaveBeenCalledWith('/other', 'workspace.get');
  expect(host.querySelector('.app-shell')?.hasAttribute('inert')).toBe(true);
  expectNote('/active', 'active-first');
  const newNoteShortcut = () =>
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'n',
        code: 'KeyN',
        ctrlKey: platformModifier() === 'ctrl',
        metaKey: platformModifier() === 'meta',
        bubbles: true,
        cancelable: true,
      }),
    );
  await act(async () => void newNoteShortcut());
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => {
    finishLoading(structuredClone(workspaces['/other']));
    await opening;
  });
  expectNote('/other', 'other-target');
  expect(host.querySelector('.app-shell')?.hasAttribute('inert')).toBe(true);
  vi.mocked(useDesktopOpenPaths).mockReturnValue(false);
  await act(async () => root.render(<App />));
  expect(host.querySelector('.app-shell')?.hasAttribute('inert')).toBe(false);
  expectNote('/other', 'other-target');
  await act(async () => void newNoteShortcut());
  expect(host.querySelector('[role="dialog"][aria-label="새 노트"]')).not.toBeNull();
});

test.each(['notes', 'database', 'plugin'])(
  'Escape closes settings and restores the actual App %s view',
  async (view) => {
    await act(async () => host.querySelector<HTMLButtonElement>(`[data-test-view="${view}"]`)!.click());
    const origin = host.querySelector<HTMLButtonElement>('[data-test-view="settings"]')!;
    await act(async () => {
      origin.focus();
      origin.click();
    });
    expect(host.querySelector('[data-view]')?.getAttribute('data-view')).toBe('settings');
    await act(async () => {
      origin.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    await act(async () => vi.advanceTimersByTime(20));
    expect(host.querySelector('[data-view]')?.getAttribute('data-view')).toBe(view);
    expect(document.activeElement).toBe(origin);
    if (view === 'notes') expectNote('/active', 'active-first');
  },
);

test('reading mode waits to focus the requested note until the native input gate is released', async () => {
  workspaces['/other'].settings.editorMode = 'read';
  vi.mocked(useDesktopOpenPaths).mockReturnValue(true);
  await act(async () => root.render(<App />));
  await act(async () =>
    actions().open({
      path: '/other/notes/other-target.md',
      vaultPath: '/other',
      noteId: 'other-target',
    }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30);
  });
  const note = host.querySelector('output')!;
  expect(document.activeElement).not.toBe(note);
  vi.mocked(useDesktopOpenPaths).mockReturnValue(false);
  await act(async () => root.render(<App />));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30);
  });
  expect(document.activeElement).toBe(note);
  expectNote('/other', 'other-target');
});
