// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { NoteTree } from './NoteTree';
import type { NoteSummary, Workspace } from '../lib/types';

type Props = ComponentProps<typeof NoteTree>;
const source: NoteSummary = {
  id: 'source',
  title: 'Source',
  folderId: null,
  revision: 'source-v1',
  createdAt: '',
  updatedAt: '',
};
const notes: NoteSummary[] = [
  source,
  { ...source, id: 'parent-note', title: 'Parent note', folderId: 'parent' },
  { ...source, id: 'nested-note', title: 'Nested note', folderId: 'nested' },
  { ...source, id: 'other-note', title: 'Other note', folderId: 'other' },
];
const workspace = {
  vault: { id: 'vault' },
  path: '/disposable',
  notes,
  folders: [
    { id: 'parent', name: 'Parent', parentId: null, revision: 'p1' },
    { id: 'nested', name: 'Nested', parentId: 'parent', revision: 'n1' },
    { id: 'other', name: 'Other', parentId: null, revision: 'o1' },
  ],
} as Workspace;
let host: HTMLDivElement, root: Root, props: Props;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  props = {
    workspace,
    activeId: 'source',
    openNote: vi.fn(),
    renameNote: vi.fn(),
    noteMenu: vi.fn(),
    folderMenu: vi.fn(),
    rootMenu: vi.fn(),
    folderDialog: vi.fn(),
    createNote: vi.fn(),
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
  vi.restoreAllMocks();
});
async function render() {
  await act(async () => root.render(<NoteTree key={props.workspace.vault.id} {...props} />));
}
const folder = (id: string) =>
  host.querySelector<HTMLElement>(`.note-navigation-row[data-folder-id="${id}"]`)!;
const branch = (id: string) => folder(id).closest<HTMLElement>('.folder-branch')!;
const row = (id: string) => host.querySelector<HTMLElement>(`[data-note-id="${id}"]`)!;
const button = (id: string) => row(id).querySelector<HTMLButtonElement>('button')!;
function transfer() {
  const values = new Map<string, string>();
  return {
    effectAllowed: '',
    dropEffect: '',
    get types() {
      return [...values.keys()];
    },
    setData: (key: string, value: string) => void values.set(key, value),
    getData: (key: string) => values.get(key) ?? '',
  };
}
async function drag(target: HTMLElement, type: string, data: ReturnType<typeof transfer>) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: data });
  await act(async () => target.dispatchEvent(event));
  return event;
}
async function start(id = 'source') {
  const data = transfer();
  await drag(button(id), 'dragstart', data);
  return data;
}
async function startFolder(id: string) {
  const data = transfer();
  const source = folder(id).querySelector<HTMLButtonElement>('button')!;
  expect(source.draggable).toBe(true);
  await drag(source, 'dragstart', data);
  return data;
}
async function drop(target: HTMLElement, data: ReturnType<typeof transfer>) {
  await drag(target, 'dragover', data);
  await drag(target, 'drop', data);
}

test('notes, inter-row space and indentation inside a folder all target that folder', async () => {
  await render();
  const targets = [
    row('parent-note'),
    branch('parent').querySelector<HTMLElement>(':scope > .folder-children')!,
    branch('parent'),
  ];
  for (const target of targets) {
    vi.mocked(props.moveNote).mockClear();
    const data = await start();
    await drag(target, 'dragover', data);
    expect(data.dropEffect).toBe('move');
    expect(folder('parent').classList.contains('note-drop-target')).toBe(true);
    expect(host.querySelector('.notes-root')?.textContent).toContain('Parent');
    await drag(target, 'drop', data);
    expect(props.moveNote).toHaveBeenCalledExactlyOnceWith(source, 'parent');
    expect(host.querySelector('.note-drop-target')).toBeNull();
    expect(host.querySelector('.note-dragging')).toBeNull();
  }
});

test('nested contents choose their deepest visible folder and parent indentation remains the parent', async () => {
  await render();
  const data = await start();
  await drag(row('nested-note'), 'dragover', data);
  expect(folder('nested').classList.contains('note-drop-target')).toBe(true);
  expect(folder('parent').classList.contains('note-drop-target')).toBe(false);
  await drag(row('nested-note'), 'drop', data);
  expect(props.moveNote).toHaveBeenCalledExactlyOnceWith(source, 'nested');
  vi.mocked(props.moveNote).mockClear();
  const next = await start('nested-note');
  await drop(branch('parent').querySelector<HTMLElement>(':scope > .folder-children')!, next);
  expect(props.moveNote).toHaveBeenCalledExactlyOnceWith(notes[2], 'parent');
});

test('same-folder drops stop propagation instead of moving the note to a parent or root', async () => {
  await render();
  const data = await start('nested-note');
  await drag(row('nested-note'), 'dragover', data);
  expect(data.dropEffect).toBe('none');
  await drag(row('nested-note'), 'drop', data);
  expect(props.moveNote).not.toHaveBeenCalled();
  expect(host.querySelector('.note-drop-target')).toBeNull();
  expect(host.querySelector('.note-dragging')).toBeNull();
});

test('root notes, navigation background and the NOTES header move a folder note to root', async () => {
  await render();
  for (const target of [
    row('source'),
    host.querySelector<HTMLElement>('.note-navigation')!,
    host.querySelector<HTMLElement>('.notes-root')!,
  ]) {
    vi.mocked(props.moveNote).mockClear();
    const data = await start('nested-note');
    await drag(target, 'dragover', data);
    expect(host.querySelector('.notes-root')?.classList.contains('note-drop-target')).toBe(true);
    await drag(target, 'drop', data);
    expect(props.moveNote).toHaveBeenCalledExactlyOnceWith(notes[2], '');
  }
});

test('external payloads, unrelated data and cancelled native drags cannot move a note', async () => {
  await render();
  const external = transfer();
  external.setData('application/x-foltra-note', source.id);
  await drop(row('nested-note'), external);
  expect(props.moveNote).not.toHaveBeenCalled();
  const active = await start();
  const unrelated = transfer();
  unrelated.setData('text/plain', source.id);
  await drop(row('nested-note'), unrelated);
  expect(props.moveNote).not.toHaveBeenCalled();
  await drag(button('source'), 'dragstart', active);
  await drag(row('nested-note'), 'dragover', active);
  // Native Escape cancellation dispatches dragend; jsdom cannot synthesize that browser behavior.
  await drag(button('source'), 'dragend', active);
  expect(host.querySelector('.note-drop-target')).toBeNull();
  expect(host.querySelector('.note-dragging')).toBeNull();
  await drop(row('nested-note'), active);
  expect(props.moveNote).not.toHaveBeenCalled();
});

test('drop uses the latest source revision and folder snapshot instead of captured drag-start data', async () => {
  await render();
  const data = await start();
  const updated = { ...source, revision: 'source-v2', title: 'Changed while dragging', folderId: 'other' };
  props.workspace = { ...workspace, notes: [updated, ...notes.slice(1)] };
  await render();
  await drop(row('nested-note'), data);
  expect(props.moveNote).toHaveBeenCalledExactlyOnceWith(updated, 'nested');
});

test('a removed source and a remounted vault cannot be moved by a stale drag', async () => {
  await render();
  const data = await start();
  props.workspace = { ...workspace, notes: notes.slice(1) };
  await render();
  await drop(row('nested-note'), data);
  expect(props.moveNote).not.toHaveBeenCalled();
  props.workspace = workspace;
  await render();
  const previousVault = await start();
  props.workspace = { ...workspace, vault: { ...workspace.vault, id: 'other-vault' } };
  await render();
  await drop(row('nested-note'), previousVault);
  expect(props.moveNote).not.toHaveBeenCalled();
});

test('failed moves report once and clear drag feedback without opening a collapsed destination', async () => {
  await render();
  const toggle = folder('parent').querySelector<HTMLButtonElement>('button')!;
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  const error = new Error('Revision changed');
  vi.mocked(props.moveNote).mockRejectedValueOnce(error);
  await drop(branch('parent'), await start());
  expect(props.onError).toHaveBeenCalledExactlyOnceWith(error);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('.note-drop-target')).toBeNull();
  expect(host.querySelector('.note-dragging')).toBeNull();
  await drop(branch('parent'), await start());
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
});

test('folders move onto folder titles, child notes and the spaces between them', async () => {
  await render();
  for (const target of [
    folder('parent'),
    row('parent-note'),
    branch('parent').querySelector<HTMLElement>('.folder-children')!,
  ]) {
    vi.mocked(props.treeEditing.moveFolder).mockClear();
    const data = await startFolder('other');
    expect(branch('other').classList.contains('note-dragging')).toBe(true);
    await drag(target, 'dragover', data);
    expect(data.dropEffect).toBe('move');
    expect(folder('parent').classList.contains('note-drop-target')).toBe(true);
    await drag(target, 'drop', data);
    expect(props.treeEditing.moveFolder).toHaveBeenCalledExactlyOnceWith(workspace.folders[2], 'parent');
    expect(props.moveNote).not.toHaveBeenCalled();
    expect(host.querySelector('.note-dragging')).toBeNull();
  }
  vi.mocked(props.treeEditing.moveFolder).mockClear();
  await drop(row('nested-note'), await startFolder('other'));
  expect(props.treeEditing.moveFolder).toHaveBeenCalledExactlyOnceWith(workspace.folders[2], 'nested');
});

test('folders can move to root using the NOTES header, root notes or root background', async () => {
  await render();
  for (const target of [
    row('source'),
    host.querySelector<HTMLElement>('.notes-root')!,
    host.querySelector<HTMLElement>('.note-navigation')!,
  ]) {
    vi.mocked(props.treeEditing.moveFolder).mockClear();
    await drop(target, await startFolder('nested'));
    expect(props.treeEditing.moveFolder).toHaveBeenCalledExactlyOnceWith(workspace.folders[1], '');
  }
});

test('self, descendants and unchanged parents reject folder drops without falling through to root', async () => {
  await render();
  for (const target of [
    folder('parent'),
    folder('nested'),
    row('nested-note'),
    branch('parent').querySelector<HTMLElement>('.folder-children')!,
  ]) {
    const data = await startFolder('parent');
    await drag(target, 'dragover', data);
    expect(data.dropEffect).toBe('none');
    await drag(target, 'drop', data);
  }
  await drop(row('parent-note'), await startFolder('nested'));
  await drop(host.querySelector<HTMLElement>('.notes-root')!, await startFolder('parent'));
  expect(props.treeEditing.moveFolder).not.toHaveBeenCalled();
  expect(props.moveNote).not.toHaveBeenCalled();
  expect(host.querySelector('.note-drop-target')).toBeNull();
});

test('folder drags reject external payloads, cancellation and a previous vault', async () => {
  await render();
  const external = transfer();
  external.setData('application/x-foltra-folder', 'other');
  await drop(folder('parent'), external);
  const data = await startFolder('other');
  await drag(folder('other').querySelector('button')!, 'dragend', data);
  await drop(folder('parent'), data);
  const old = await startFolder('other');
  props.workspace = { ...workspace, vault: { ...workspace.vault, id: 'other-vault' } };
  await render();
  await drop(folder('parent'), old);
  expect(props.treeEditing.moveFolder).not.toHaveBeenCalled();
});

test('folder moves use the current snapshot and report failure without changing the tree', async () => {
  await render();
  const data = await startFolder('other');
  const updated = { ...workspace.folders[2], name: 'Updated', revision: 'o2' };
  props.workspace = { ...workspace, folders: [...workspace.folders.slice(0, 2), updated] };
  await render();
  const toggle = folder('parent').querySelector<HTMLButtonElement>('button')!;
  await act(async () => toggle.click());
  const error = new Error('Folder already exists');
  vi.mocked(props.treeEditing.moveFolder).mockRejectedValueOnce(error);
  await drop(folder('parent'), data);
  expect(props.treeEditing.moveFolder).toHaveBeenCalledExactlyOnceWith(updated, 'parent');
  expect(props.onError).toHaveBeenCalledExactlyOnceWith(error);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('.note-dragging')).toBeNull();
  await drop(folder('parent'), await startFolder('other'));
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
});

test('collapse all folds nested folders and leaves root notes selectable', async () => {
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="폴더 모두 접기"]')!.click());
  expect(row('source')).not.toBeNull();
  expect(row('nested-note')).toBeNull();
  expect(folder('parent').querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
  await act(async () => folder('parent').querySelector<HTMLButtonElement>('button')!.click());
  expect(folder('nested').querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
  expect(row('parent-note')).not.toBeNull();
});

test('custom sorting inserts beside folders, while center drops still enter folders', async () => {
  props.workspace = { ...workspace, settings: { ...workspace.settings, treeCustomSort: true } };
  props.updateSettings = vi.fn().mockResolvedValue(true);
  await render();
  vi.spyOn(folder('parent'), 'getBoundingClientRect').mockReturnValue({ top: 0, height: 40 } as DOMRect);
  const data = await start();
  await drag(folder('parent'), 'dragover', data);
  expect(folder('parent').dataset.dropPosition).toBe('before');
  await drag(folder('parent'), 'drop', data);
  expect(props.moveNote).not.toHaveBeenCalled();
  const patch = vi.mocked(props.updateSettings).mock.calls[0][0];
  expect(patch.treeOrder!.indexOf('source')).toBe(patch.treeOrder!.indexOf('parent') - 1);
  props.workspace = { ...props.workspace, settings: { ...props.workspace.settings, ...patch } };
  await render();
  expect(row('source').nextElementSibling).toBe(branch('parent'));
  // Default ordering can be restored without deleting the user's order.
  props.workspace = { ...props.workspace, settings: { ...props.workspace.settings, treeCustomSort: false } };
  await render();
  expect(host.querySelector('.note-navigation > :first-child')?.classList.contains('folder-branch')).toBe(
    true,
  );
  props.workspace.settings.treeCustomSort = true;
  await render();
  const next = await start();
  vi.spyOn(folder('parent'), 'getBoundingClientRect').mockReturnValue({ top: -20, height: 40 } as DOMRect);
  await drop(folder('parent'), next);
  expect(props.moveNote).toHaveBeenCalledWith(source, 'parent');
});

test('custom ordering rejects a dragged folder inside its descendants', async () => {
  props.workspace = { ...workspace, settings: { ...workspace.settings, treeCustomSort: true } };
  props.updateSettings = vi.fn().mockResolvedValue(true);
  await render();
  vi.spyOn(row('nested-note'), 'getBoundingClientRect').mockReturnValue({ top: 0, height: 40 } as DOMRect);
  await drop(row('nested-note'), await startFolder('parent'));
  expect(props.treeEditing.moveFolder).not.toHaveBeenCalled();
  expect(props.updateSettings).not.toHaveBeenCalled();
});
