import { expect, test, vi } from 'vitest';
import { moveNoteToFolder, prepareNoteAction, type NoteActionEditor } from './useNoteActions';
import { call, CoreError } from './api';
import type { Note } from './types';

vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), call: vi.fn() }));

const original: Note = {
  id: 'note-1',
  title: '기록',
  body: '보존할 본문',
  revision: 'r1',
  createdAt: '',
  updatedAt: '',
};
function editor(dirty: boolean): NoteActionEditor {
  return { currentNote: () => original, isDirty: () => dirty, save: vi.fn(async () => false) };
}
test('failed saves stop note management and retain the original draft', async () => {
  const state = editor(true);
  await expect(prepareNoteAction(original, state)).rejects.toThrow('보존');
  expect(state.currentNote()).toBe(original);
  expect(state.isDirty()).toBe(true);
});
test('note actions drain newly arriving edits and use the successfully saved revision', async () => {
  let dirty = true;
  let saved = original;
  const save = vi
    .fn()
    .mockImplementationOnce(async () => {
      saved = { ...original, revision: 'r2' };
      return true;
    })
    .mockImplementationOnce(async () => {
      saved = { ...saved, body: '추가 입력까지 저장', revision: 'r3' };
      dirty = false;
      return true;
    });
  expect(await prepareNoteAction(original, { currentNote: () => saved, isDirty: () => dirty, save })).toEqual(
    { ...original, body: '추가 입력까지 저장', revision: 'r3' },
  );
  expect(save).toHaveBeenCalledTimes(2);
});
test('a clean note keeps the chosen revision instead of silently accepting external changes', async () => {
  const state = editor(false);
  state.currentNote = () => ({ ...original, revision: 'external-newer' });
  expect(await prepareNoteAction(original, state)).toBe(original);
  expect(state.save).not.toHaveBeenCalled();
});
test('managing another note does not overwrite or save the current note draft', async () => {
  const state = editor(true);
  const other = { ...original, id: 'note-2' };
  expect(await prepareNoteAction(other, state)).toBe(other);
  expect(state.save).not.toHaveBeenCalled();
  expect(state.isDirty()).toBe(true);
});

test('moving a dirty note writes only its folder after saving the draft', async () => {
  vi.mocked(call).mockReset().mockResolvedValue({});
  let dirty = true;
  let saved = original;
  const state = {
    currentNote: () => saved,
    isDirty: () => dirty,
    save: async () => {
      dirty = false;
      saved = { ...original, body: '저장한 초안', revision: 'saved' };
      return true;
    },
  };
  await moveNoteToFolder('/vault', original, 'folder-1', state);
  expect(call).toHaveBeenCalledExactlyOnceWith('/vault', 'note.update', {
    id: original.id,
    expectedRevision: 'saved',
    folderId: 'folder-1',
  });
  expect(saved.body).toBe('저장한 초안');
});

test('failed saves and same-folder drops never send a move', async () => {
  vi.mocked(call).mockReset();
  await expect(moveNoteToFolder('/vault', original, 'folder-1', editor(true))).rejects.toThrow('보존');
  await moveNoteToFolder('/vault', { ...original, folderId: 'folder-1' }, 'folder-1', editor(false));
  await moveNoteToFolder('/vault', original, '', editor(false));
  expect(call).not.toHaveBeenCalled();
});

test('move conflicts use the selected revision once and never retry with newer content', async () => {
  vi.mocked(call).mockReset().mockRejectedValue(new CoreError('conflict', 'External change'));
  const state = editor(false);
  state.currentNote = () => ({ ...original, revision: 'external' });
  await expect(
    moveNoteToFolder('/vault', { ...original, folderId: 'folder-1' }, '', state),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect(call).toHaveBeenCalledExactlyOnceWith('/vault', 'note.update', {
    id: original.id,
    expectedRevision: 'r1',
    folderId: '',
  });
});
