import { useEffect, useRef, useState } from 'react';
import { call } from './api';
import type { Folder, Note, NoteSummary, Workspace } from './types';

export type FolderAction =
  { kind: 'create'; parentId?: string } | { kind: 'rename' | 'delete'; folder: Folder };
export interface TreeEdit {
  kind: 'note' | 'folder';
  id: string;
  name: string;
  revision: string;
  parentId: string | null;
}
export function nextTreeName(base: string, names: string[]): string {
  const taken = new Set(names);
  let name = base;
  for (let number = 2; taken.has(name); number++) name = `${base} ${number}`;
  return name;
}
export async function saveTreeName(vault: string, target: TreeEdit, name: string): Promise<void> {
  const value = name.trim();
  if (!value) throw new Error('이름을 입력하세요.');
  if (value === target.name) return;
  await call(vault, target.kind === 'note' ? 'note.update' : 'folder.update', {
    id: target.id,
    expectedRevision: target.revision,
    ...(target.kind === 'note' ? { title: value } : { name: value }),
  });
}
export function useTreeEditing(
  vault: string,
  workspace: Workspace | null,
  saveNote: () => Promise<boolean>,
  refresh: () => Promise<void>,
  openNote: (id: string) => Promise<void>,
) {
  const [editing, setEditing] = useState<TreeEdit | null>(null);
  const busy = useRef(false);
  const currentVault = useRef(vault);
  currentVault.current = vault;
  useEffect(() => {
    setEditing(null);
  }, [vault]);
  const renameNote = (note: NoteSummary) =>
    setEditing({
      kind: 'note',
      id: note.id,
      name: note.title,
      revision: note.revision,
      parentId: note.folderId ?? null,
    });
  const renameFolder = (folder: Folder) =>
    setEditing({
      kind: 'folder',
      id: folder.id,
      name: folder.name,
      revision: folder.revision,
      parentId: folder.parentId,
    });
  const create = async (kind: TreeEdit['kind'], parentId = '') => {
    if (busy.current || !workspace) return;
    busy.current = true;
    try {
      if (!(await saveNote())) throw new Error('현재 노트를 저장한 뒤 다시 만드세요.');
      if (currentVault.current !== vault) return;
      if (kind === 'folder') {
        const name = nextTreeName(
          '새 폴더',
          workspace.folders.filter((f) => (f.parentId ?? '') === parentId).map((f) => f.name),
        );
        const folder = await call<Folder>(vault, 'folder.create', { name, parentId });
        await refresh();
        if (currentVault.current === vault) renameFolder(folder);
      } else {
        const title = nextTreeName(
          '새 노트',
          workspace.notes.map((n) => n.title),
        );
        const note = await call<Note>(vault, 'note.create', { title, folderId: parentId });
        await refresh();
        if (currentVault.current === vault) {
          await openNote(note.id);
          if (currentVault.current === vault) renameNote(note);
        }
      }
    } finally {
      busy.current = false;
    }
  };
  const commit = async (name: string) => {
    if (busy.current || !editing) return;
    busy.current = true;
    try {
      await saveTreeName(vault, editing, name);
      await refresh();
      if (currentVault.current === vault) setEditing((current) => (current === editing ? null : current));
    } finally {
      busy.current = false;
    }
  };
  return {
    editing,
    create,
    commit,
    renameNote,
    renameFolder,
    cancel: () => {
      if (!busy.current) setEditing(null);
    },
  };
}
