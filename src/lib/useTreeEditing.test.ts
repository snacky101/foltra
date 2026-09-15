import { expect, test, vi } from 'vitest';
import { nextTreeName, saveTreeName, type TreeEdit } from './useTreeEditing';
import { call, CoreError } from './api';
vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), call: vi.fn() }));
const note: TreeEdit = {
  kind: 'note',
  id: 'note-id',
  name: '이전 이름',
  revision: 'chosen-revision',
  parentId: null,
};
test('new objects get a free default name without replacing existing siblings', () => {
  expect(nextTreeName('새 폴더', ['새 폴더', '새 폴더 2', '새 폴더 4'])).toBe('새 폴더 3');
  expect(nextTreeName('새 노트', [])).toBe('새 노트');
});
test('inline rename uses the selected revision and only changes the name field', async () => {
  vi.mocked(call).mockReset().mockResolvedValue({});
  await saveTreeName('/vault', note, ' 새 이름 ');
  expect(call).toHaveBeenLastCalledWith('/vault', 'note.update', {
    id: 'note-id',
    expectedRevision: 'chosen-revision',
    title: '새 이름',
  });
  await saveTreeName('/vault', { ...note, kind: 'folder' }, '폴더 이름');
  expect(call).toHaveBeenLastCalledWith('/vault', 'folder.update', {
    id: 'note-id',
    expectedRevision: 'chosen-revision',
    name: '폴더 이름',
  });
});
test('empty and unchanged names do not write and conflicts never retry', async () => {
  vi.mocked(call).mockReset();
  await expect(saveTreeName('/vault', note, ' ')).rejects.toThrow('이름');
  await saveTreeName('/vault', note, '이전 이름');
  expect(call).not.toHaveBeenCalled();
  vi.mocked(call).mockRejectedValue(new CoreError('conflict', 'Changed'));
  await expect(saveTreeName('/vault', note, '새 이름')).rejects.toMatchObject({ code: 'conflict' });
  expect(call).toHaveBeenCalledTimes(1);
});
