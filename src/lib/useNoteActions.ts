import { useRef, useState } from 'react';
import { call, CoreError } from './api';
import type { Note, NoteSummary } from './types';

export type NoteAction = 'open' | 'move' | 'rename' | 'duplicate' | 'copy-link' | 'delete';
export interface NoteActionEditor {
  currentNote: () => Note | null;
  isDirty: () => boolean;
  save: () => Promise<boolean>;
}

export async function prepareNoteAction(target: NoteSummary, editor: NoteActionEditor): Promise<NoteSummary> {
  if (editor.currentNote()?.id !== target.id || !editor.isDirty()) return target;
  do {
    if (!(await editor.save())) throw new Error('저장하지 못했습니다. 편집 내용을 보존했습니다.');
  } while (editor.isDirty());
  const saved = editor.currentNote();
  if (!saved || saved.id !== target.id) throw new Error('선택한 노트가 변경되었습니다. 다시 선택하세요.');
  return saved;
}

export async function moveNoteToFolder(
  vault: string,
  target: NoteSummary,
  folderId: string,
  editor: NoteActionEditor,
): Promise<void> {
  if ((target.folderId ?? '') === folderId) return;
  const prepared = await prepareNoteAction(target, editor);
  await call(vault, 'note.update', { id: prepared.id, expectedRevision: prepared.revision, folderId });
}

export function useNoteActions(
  vault: string,
  editor: NoteActionEditor,
  refresh: () => Promise<void>,
  openNote: (id: string) => Promise<void>,
  notify: (message: string) => void,
  beginRename: (note: NoteSummary) => void,
) {
  const [moving, setMoving] = useState<NoteSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const perform = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const run = (action: NoteAction, target: NoteSummary) =>
    perform(async () => {
      if (action === 'copy-link') {
        const link = await call<string>(vault, 'note.link', { id: target.id });
        await navigator.clipboard.writeText(link);
        notify('노트 링크를 복사했습니다.');
        return;
      }
      if (action === 'open') {
        await openNote(target.id);
        return;
      }
      const prepared = await prepareNoteAction(target, editor);
      if (action === 'move') {
        setMoving(prepared);
        return;
      }
      if (action === 'rename') {
        beginRename(prepared);
        return;
      }
      if (action === 'delete') {
        await call(vault, 'note.delete', { id: prepared.id, expectedRevision: prepared.revision });
        await refresh();
        notify('노트를 휴지통으로 옮겼습니다. 휴지통에서 복원할 수 있습니다.');
        return;
      }
      const source = await call<Note>(vault, 'note.read', { id: prepared.id });
      if (source.revision !== prepared.revision)
        throw new CoreError('conflict', '노트가 변경되었습니다. 최신 내용을 확인한 뒤 다시 복제하세요.');
      const copy = await call<Note>(vault, 'note.create', {
        title: `${source.title} (사본)`,
        body: source.body,
        folderId: source.folderId ?? '',
      });
      await refresh();
      await openNote(copy.id);
      notify('노트 사본을 만들었습니다.');
    });
  const commitMove = async (target: NoteSummary, folderId: string) => {
    await moveNoteToFolder(vault, target, folderId, editor);
    await refresh();
    notify('노트를 이동했습니다.');
  };
  const moveTo = (target: NoteSummary, folderId: string) => perform(() => commitMove(target, folderId));
  const move = (folderId: string) =>
    perform(async () => {
      if (!moving) return;
      await commitMove(moving, folderId);
      setMoving(null);
    });
  return {
    moving,
    move,
    moveTo,
    closeMove: () => {
      if (!inFlight.current) setMoving(null);
    },
    run,
    busy,
  };
}
