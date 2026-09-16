import { useRef } from 'react';
import { call } from './api';
import type { Note, Workspace } from './types';
import { resolveWikiNote } from './wikiLinks';

export function useOpenWikiLink(
  path: string,
  workspace: Workspace | null,
  save: () => Promise<boolean>,
  refresh: () => Promise<unknown>,
  openNote: (id: string) => Promise<void>,
  onError: (error: unknown) => void,
) {
  const currentPath = useRef(path);
  currentPath.current = path;
  const opening = useRef(false);
  return async (target: string, createIfMissing = true) => {
    if (opening.current || !workspace) return;
    const name = target.split('#')[0];
    const existingId = name.startsWith('record:')
      ? workspace.records.find((row) => row.id === name.slice(7))?.bodyNoteId
      : resolveWikiNote(workspace.notes, name)?.id;
    // Missing targets in the navigation-only command are a no-op, including save and history.
    if (!createIfMissing && !workspace.notes.some((note) => note.id === existingId)) return;
    opening.current = true;
    try {
      if (!(await save()) || currentPath.current !== path) return;
      if (!createIfMissing || name.startsWith('record:')) {
        if (!existingId || !workspace.notes.some((note) => note.id === existingId))
          throw new Error('이 데이터베이스 행에 연결된 본문 노트가 없습니다.');
        await openNote(existingId);
      } else {
        const note = await call<Note>(path, 'note.open-link', { target: name });
        if (currentPath.current !== path) return;
        await refresh();
        if (currentPath.current === path) await openNote(note.id);
      }
    } catch (error) {
      if (currentPath.current === path) onError(error);
    } finally {
      opening.current = false;
    }
  };
}
