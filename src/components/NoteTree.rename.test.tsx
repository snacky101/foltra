// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { NoteTree } from './NoteTree';
import { call, CoreError } from '../lib/api';
import { useNoteActions } from '../lib/useNoteActions';
import { useTreeEditing } from '../lib/useTreeEditing';
import type { Note, Workspace } from '../lib/types';

vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  call: vi.fn(),
}));
const original: Note = {
  id: 'note',
  title: 'Original',
  body: 'Keep this body',
  revision: 'r1',
  folderId: null,
  createdAt: '',
  updatedAt: '',
};
const folder = { id: 'folder', name: 'Folder', parentId: null, revision: 'folder-r1' };
let store: Workspace, current: Note, dirty: boolean;
let root: Root, host: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>, frameId: number;
const open = vi.fn(),
  save = vi.fn(),
  refreshed = vi.fn(),
  onError = vi.fn(),
  requested = vi.fn();

function Harness() {
  const [workspace, setWorkspace] = useState(store);
  const refresh = async () => {
    refreshed();
    setWorkspace({ ...store });
  };
  const tree = useTreeEditing('/disposable', workspace, save, refresh, open);
  const actions = useNoteActions(
    '/disposable',
    {
      currentNote: () => current,
      isDirty: () => dirty,
      save,
    },
    refresh,
    open,
    () => {},
    tree.renameNote,
  );
  return (
    <NoteTree
      workspace={workspace}
      activeId={current.id}
      openNote={open}
      renameNote={(note) => {
        requested(note);
        void actions.run('rename', note).catch(onError);
      }}
      noteMenu={() => {}}
      folderMenu={() => {}}
      rootMenu={() => {}}
      folderDialog={(target) => {
        if (target.kind === 'rename') tree.renameFolder(target.folder);
      }}
      createNote={() => {}}
      moveNote={actions.moveTo}
      onError={onError}
      treeEditing={tree}
    />
  );
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  current = { ...original };
  dirty = false;
  store = {
    vault: { id: 'vault' },
    path: '/disposable',
    notes: [original, { ...original, id: 'child', title: 'Child', folderId: 'folder' }],
    folders: [folder],
  } as unknown as Workspace;
  open.mockReset().mockResolvedValue(undefined);
  save.mockReset().mockResolvedValue(true);
  vi.mocked(call)
    .mockReset()
    .mockImplementation(async (_vault, command, args) => {
      const value = args as { id: string; title?: string; name?: string };
      if (command === 'note.update')
        store = {
          ...store,
          notes: store.notes.map((note) => (note.id === value.id ? { ...note, title: value.title! } : note)),
        };
      if (command === 'folder.update')
        store = {
          ...store,
          folders: store.folders.map((item) =>
            item.id === value.id ? { ...item, name: value.name! } : item,
          ),
        };
      return {} as never;
    });
  frames = new Map();
  frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  HTMLElement.prototype.scrollIntoView = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function flushFrames() {
  await act(async () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(0);
  });
}
const noteButton = () => host.querySelector<HTMLButtonElement>('[data-note-id="note"] > button')!;
const folderButton = () => host.querySelector<HTMLButtonElement>('[data-folder-id="folder"] > button')!;
const input = () => host.querySelector<HTMLInputElement>('[data-inline-rename] input');
async function doubleClick(element: HTMLElement) {
  element.focus();
  for (const [type, detail] of [
    ['click', 1],
    ['click', 2],
    ['dblclick', 2],
  ] as const)
    await act(async () =>
      element.dispatchEvent(new MouseEvent(type, { detail, bubbles: true, cancelable: true })),
    );
  await flushFrames();
}
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input()!.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function key(value: string, options: KeyboardEventInit = {}) {
  await act(async () =>
    input()!.dispatchEvent(
      new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options }),
    ),
  );
  await flushFrames();
}

test('a native double-click opens once then selects the inline name without writing', async () => {
  await doubleClick(noteButton());
  expect(open).toHaveBeenCalledExactlyOnceWith('note');
  expect(requested).toHaveBeenCalledExactlyOnceWith(original);
  expect(document.activeElement).toBe(input());
  expect(input()?.value).toBe('Original');
  expect([input()?.selectionStart, input()?.selectionEnd]).toEqual([0, 8]);
  expect(call).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

test.each([false, true])(
  'folder double-click keeps its initial collapsed=%s state while renaming',
  async (collapsed) => {
    if (collapsed) await act(async () => folderButton().click());
    await doubleClick(folderButton());
    expect(input()?.getAttribute('aria-label')).toBe('폴더 이름 변경');
    expect(host.querySelector('[data-note-id="child"]') !== null).toBe(!collapsed);
    await type('Renamed folder');
    await key('Enter');
    expect(call).toHaveBeenCalledExactlyOnceWith('/disposable', 'folder.update', {
      id: 'folder',
      expectedRevision: 'folder-r1',
      name: 'Renamed folder',
    });
    expect(folderButton().textContent).toBe('Renamed folder');
    expect(folderButton().getAttribute('aria-expanded')).toBe(String(!collapsed));
    expect(open).not.toHaveBeenCalled();
  },
);

test('renaming a dirty current note waits for save and uses its resulting revision', async () => {
  dirty = true;
  let finish!: () => void;
  save.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        finish = () => {
          current = { ...current, body: 'Newest saved body', revision: 'r2' };
          dirty = false;
          resolve(true);
        };
      }),
  );
  await doubleClick(noteButton());
  expect(save).toHaveBeenCalledOnce();
  expect(input()).toBeNull();
  await act(async () => finish());
  await flushFrames();
  expect(document.activeElement).toBe(input());
  await type('Saved name');
  await key('Enter');
  expect(call).toHaveBeenCalledExactlyOnceWith('/disposable', 'note.update', {
    id: 'note',
    expectedRevision: 'r2',
    title: 'Saved name',
  });
  expect(current.body).toBe('Newest saved body');
  expect(noteButton().textContent).toBe('Saved name');
});

test('save failure preserves the draft and prevents entering inline rename', async () => {
  dirty = true;
  save.mockResolvedValue(false);
  await doubleClick(noteButton());
  expect(input()).toBeNull();
  expect(onError).toHaveBeenCalledOnce();
  expect(onError.mock.calls[0][0].message).toContain('편집 내용을 보존');
  expect(call).not.toHaveBeenCalled();
  expect(dirty).toBe(true);
  expect(current.body).toBe(original.body);
});

test('input double-click does not restart rename; IME Enter waits and ordinary Enter saves once', async () => {
  await doubleClick(noteButton());
  await doubleClick(input()!);
  expect(requested).toHaveBeenCalledOnce();
  await type('한글 이름');
  await key('Enter', { isComposing: true });
  await key('Enter', { keyCode: 229 });
  expect(call).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(input());
  await key('Enter');
  expect(call).toHaveBeenCalledExactlyOnceWith('/disposable', 'note.update', {
    id: 'note',
    expectedRevision: 'r1',
    title: '한글 이름',
  });
  expect(refreshed).toHaveBeenCalledOnce();
  expect(input()).toBeNull();
  expect(document.activeElement).toBe(noteButton());
});

test('Escape cancels without a write, and a later blur saves the new name once', async () => {
  await doubleClick(noteButton());
  await type('Discarded');
  await key('Escape');
  expect(call).not.toHaveBeenCalled();
  expect(noteButton().textContent).toBe('Original');
  expect(document.activeElement).toBe(noteButton());
  await doubleClick(noteButton());
  await type('Blur name');
  await act(async () => input()!.blur());
  expect(call).toHaveBeenCalledExactlyOnceWith('/disposable', 'note.update', {
    id: 'note',
    expectedRevision: 'r1',
    title: 'Blur name',
  });
  expect(noteButton().textContent).toBe('Blur name');
});

test('rename conflicts retain the entered name and selected revision without automatic retry', async () => {
  await doubleClick(noteButton());
  await type('My name');
  vi.mocked(call).mockRejectedValueOnce(new CoreError('conflict', 'Changed externally'));
  await key('Enter');
  expect(input()?.value).toBe('My name');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('다른 곳에서 변경');
  expect(call).toHaveBeenCalledExactlyOnceWith('/disposable', 'note.update', {
    id: 'note',
    expectedRevision: 'r1',
    title: 'My name',
  });
  expect(refreshed).not.toHaveBeenCalled();
});
