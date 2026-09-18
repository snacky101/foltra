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
