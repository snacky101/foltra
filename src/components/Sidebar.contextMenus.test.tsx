// @vitest-environment jsdom
import { act, useCallback, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Workspace } from '../lib/types';
import { NoteContextMenu, type NoteMenuTarget } from './NoteContextMenu';
import { Sidebar } from './Sidebar';

type Props = ComponentProps<typeof Sidebar>;
const database = (id: string) => ({ id, name: `DB ${id}`, properties: [], createdAt: '2026-09-17' });
const note = { id: 'note', title: 'Note', createdAt: '', updatedAt: '', revision: 'r1', folderId: null };
const folder = { id: 'folder', name: 'Folder', parentId: null, revision: 'r2' };
const workspace: Workspace = {
  vault: { id: 'vault', name: 'Disposable', formatVersion: 1 },
  path: '/disposable',
  notes: [note],
  folders: [folder],
  databases: [database('active'), database('target')],
  records: [],
  links: [],
  trash: [],
  extensions: [],
  settings: {
    vim: false,
    editorMode: 'live',
    lineNumbers: 'none',
    databaseFontSize: 14,
    editorFontFamily: '',
    databaseFontFamily: '',
    topicFolders: { include: [], exclude: [] },
    cursorShape: 'bar',
    cursorFollowVim: true,
    cursorBlink: 'steady',
    cursorBlinkRate: 500,
    cursorAnimation: 'none',
    slash: true,
    showUnresolvedLinks: true,
    leader: ' ',
    theme: 'paper',
    keybindings: {},
  },
};
let host: HTMLDivElement;
let root: Root;
let props: Props;

function Harness({ settings }: { settings: Props }) {
  const [target, setTarget] = useState<NoteMenuTarget | null>(null);
  const closeNoteMenu = useCallback(() => setTarget(null), []);
  return (
    <>
      <Sidebar
        {...settings}
        noteMenu={(value) => {
          settings.noteMenu(value);
          setTarget(value);
        }}
        closeNoteMenu={closeNoteMenu}
        noteMenuOpen={!!target}
      />
      {target && <NoteContextMenu target={target} close={closeNoteMenu} run={() => {}} />}
    </>
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  props = {
    workspace,
    settingsOpen: false,
    settingsGroup: 'editor',
    collapsed: false,
    compactNavigation: true,
    view: 'database',
    noteId: 'note',
    databaseId: 'active',
    databaseEditing: null,
    noteMenuOpen: false,
    selectSettingsGroup: vi.fn(),
    closeSettings: vi.fn(),
    collapse: vi.fn(),
    toggleCompactNavigation: vi.fn(),
    openNote: vi.fn(),
    renameNote: vi.fn(),
    navigate: vi.fn(),
    search: vi.fn(),
    createNote: vi.fn(),
    createDatabase: vi.fn(),
    databaseAction: vi.fn(),
    switchVault: vi.fn(),
    folderDialog: vi.fn(),
    noteMenu: vi.fn(),
    closeNoteMenu: vi.fn(),
    moveNote: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn(),
    treeEditing: {
      editing: null,
      commit: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn(),
      create: vi.fn().mockResolvedValue(undefined),
      renameNote: vi.fn(),
      renameFolder: vi.fn(),
      moveFolder: vi.fn().mockResolvedValue(undefined),
    },
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(changes: Partial<Props> = {}) {
  props = { ...props, ...changes };
  await act(async () => root.render(<Harness settings={props} />));
}
function element(selector: string) {
  const result = document.querySelector<HTMLElement>(selector);
  if (!result) throw new Error(`Missing element: ${selector}`);
  return result;
}
async function context(selector: string) {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: 2,
    clientX: 120,
    clientY: 220,
  });
  await act(async () => {
    element(selector).dispatchEvent(event);
  });
  return event;
}
async function key(selector: string, value: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true });
  await act(async () => {
    element(selector).dispatchEvent(event);
  });
  return event;
}
function labels() {
  return [...document.querySelectorAll('[role=menuitem]')].map((item) => item.textContent);
}
async function choose(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('[role=menuitem]')].find(
    (item) => item.textContent === label,
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}

test.each(['.note-navigation', '.notes-root', '.note-tree'])(
  'notes blank area and header %s create at vault root without an active folder',
  async (selector) => {
    await render();
    expect((await context(selector)).defaultPrevented).toBe(true);
    expect(labels()).toEqual(['새 노트', '새 폴더']);
    await choose('새 노트');
    expect(props.createNote).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(document.querySelector('[role=menu]')).toBeNull();
    await context(selector);
    await choose('새 폴더');
    expect(props.folderDialog).toHaveBeenCalledExactlyOnceWith({ kind: 'create' });
  },
);

test.each(['.database-tree', '.database-tree .sidebar-section-title', '.database-navigation'])(
  'database section %s offers database creation',
  async (selector) => {
    await render();
    await context(selector);
    expect(labels()).toEqual(['새 데이터베이스']);
    await choose('새 데이터베이스');
    expect(props.createDatabase).toHaveBeenCalledExactlyOnceWith();
    expect(props.createNote).not.toHaveBeenCalled();
  },
);

test('empty note and database sections retain right-click creation', async () => {
  await render({ workspace: { ...workspace, notes: [], folders: [], databases: [] } });
  await context('.note-navigation > button');
  expect(labels()).toEqual(['새 노트', '새 폴더']);
  await context('.database-navigation > button');
  expect(labels()).toEqual(['새 데이터베이스']);
  expect(document.querySelectorAll('[role=menu]')).toHaveLength(1);
});

test.each([
  ['열기', 'open'],
  ['이름 변경', 'rename'],
  ['새 행 추가', 'new-record'],
  ['휴지통으로 이동', 'delete'],
])('DB action %s targets the right-clicked database without first navigating', async (label, action) => {
  await render();
  await context('button[data-database-id="target"]');
  expect(labels()).toEqual(['열기', '이름 변경', '새 행 추가', '휴지통으로 이동']);
  expect(props.navigate).not.toHaveBeenCalled();
  expect(element('button[data-database-id="active"]').className).toBe('active');
  await choose(label);
  expect(props.databaseAction).toHaveBeenCalledExactlyOnceWith(action, workspace.databases[1]);
  expect(document.querySelector('[role=menu]')).toBeNull();
});

test.each([
  ['ContextMenu', false],
  ['F10', true],
] as const)(
  'database keyboard %s opens the menu, arrows move and Escape restores row focus',
  async (value, shift) => {
    await render();
    element('button[data-database-id="target"]').focus();
    expect((await key('button[data-database-id="target"]', value, shift)).defaultPrevented).toBe(true);
    expect(document.activeElement?.textContent).toBe('열기');
    await key('[role=menu]', 'ArrowDown');
    expect(document.activeElement?.textContent).toBe('이름 변경');
    await key('[role=menu]', 'End');
    expect(document.activeElement?.textContent).toBe('휴지통으로 이동');
    await key('[role=menu]', 'Escape');
    expect(document.querySelector('[role=menu]')).toBeNull();
    expect(document.activeElement).toBe(element('button[data-database-id="target"]'));
  },
);

test('note, folder, database and root menus replace one another without event bubbling', async () => {
  await render();
  await context('[data-folder-id="folder"] > button');
  expect(labels()).toEqual(['여기에 새 노트', '하위 폴더 만들기', '이름 변경', '휴지통으로 이동']);
  await choose('여기에 새 노트');
  expect(props.createNote).toHaveBeenCalledExactlyOnceWith('folder');
  await context('[data-folder-id="folder"] > button');
  await choose('하위 폴더 만들기');
  expect(props.folderDialog).toHaveBeenCalledExactlyOnceWith({ kind: 'create', parentId: 'folder' });
  await context('[data-folder-id="folder"] > button');
  await choose('휴지통으로 이동');
  expect(props.folderDialog).toHaveBeenLastCalledWith({ kind: 'delete', folder });
  await context('[data-note-id="note"] > button');
  expect(props.noteMenu).toHaveBeenCalledWith({ note, x: 120, y: 220 });
  expect(labels()).toContain('내부 링크 복사');
  await context('button[data-database-id="target"]');
  expect(document.querySelectorAll('[role=menu]')).toHaveLength(1);
  expect(labels()).not.toContain('내부 링크 복사');
  await context('[data-note-id="note"] > button');
  expect(document.querySelectorAll('[role=menu]')).toHaveLength(1);
  expect(labels()).toContain('내부 링크 복사');
  await context('.note-navigation');
  expect(document.querySelectorAll('[role=menu]')).toHaveLength(1);
  expect(labels()).toEqual(['새 노트', '새 폴더']);
});

test('menus live outside the clipping sidebar and a right click in the menu does not reopen roots', async () => {
  await render();
  await context('[data-folder-id="folder"] > button');
  expect(element('[role=menu]').parentElement).toBe(document.body);
  await context('[role=menuitem]');
  expect(labels()).toContain('하위 폴더 만들기');
  expect(labels()).not.toContain('새 폴더');
  await act(async () => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
  expect(document.querySelector('[role=menu]')).toBeNull();
});

test.each(['note', 'folder'] as const)(
  '%s keyboard menu keeps item actions instead of root creation',
  async (kind) => {
    await render();
    const row = `[data-${kind}-id="${kind}"] > button`;
    element(row).focus();
    await key(row, 'F10', true);
    expect(labels()).toContain(kind === 'folder' ? '하위 폴더 만들기' : '내부 링크 복사');
    expect(labels()).not.toContain('새 폴더');
    await key('[role=menu]', 'Escape');
    expect(document.activeElement).toBe(element(row));
  },
);

test('reopening at identical coordinates focuses the new menu rather than leaving focus on the tree', async () => {
  await render();
  await context('.note-navigation');
  await context('[data-folder-id="folder"] > button');
  expect(document.activeElement?.textContent).toBe('여기에 새 노트');
  await context('[data-folder-id="folder"] > button');
  expect(document.activeElement?.textContent).toBe('여기에 새 노트');
});

test.each(['note', 'folder', 'database'] as const)(
  'inline %s rename preserves the native text context menu',
  async (kind) => {
    if (kind === 'database') {
      await render({
        databaseEditing: {
          target: { kind, id: 'target', name: 'DB target' },
          commit: vi.fn().mockResolvedValue(undefined),
          cancel: vi.fn(),
        },
      });
    } else {
      await render({
        treeEditing: {
          ...props.treeEditing,
          editing: { kind, id: kind, name: kind, revision: 'r', parentId: null },
        },
      });
    }
    expect((await context('[data-inline-rename] input')).defaultPrevented).toBe(false);
    expect(document.querySelector('[role=menu]')).toBeNull();
    expect((await key('[data-inline-rename] input', 'ContextMenu')).defaultPrevented).toBe(false);
    expect(document.querySelector('[role=menu]')).toBeNull();
  },
);

test.each(['settings', 'vault', 'collapsed'])('a %s transition dismisses the local menu', async (change) => {
  await render();
  await context('button[data-database-id="target"]');
  await render(
    change === 'settings'
      ? { settingsOpen: true }
      : change === 'collapsed'
        ? { collapsed: true }
        : { workspace: { ...workspace, vault: { ...workspace.vault, id: 'other' } } },
  );
  expect(document.querySelector('[role=menu]')).toBeNull();
});
