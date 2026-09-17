// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call, CoreError } from './api';
import { useDatabaseActions, type DatabaseInspection } from './useDatabaseActions';
import type { Database } from './types';

vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), call: vi.fn() }));
const database: Database = {
  id: 'chosen-db',
  name: '선택한 DB',
  properties: [{ id: 'title', name: '제목', type: 'text' }],
  createdAt: '',
};
const snapshot: DatabaseInspection = { database, revision: 'chosen-revision', recordCount: 2 };
const save = vi.fn<() => Promise<boolean>>();
const refresh = vi.fn<() => Promise<void>>();
const open = vi.fn<(id: string) => Promise<void>>();
const deleted = vi.fn();
const notify = vi.fn();
let root: Root;
let actions: ReturnType<typeof useDatabaseActions>;
function Harness({ vault = '/disposable', enabled = true }: { vault?: string; enabled?: boolean }) {
  actions = useDatabaseActions(vault, save, refresh, open, deleted, notify, enabled);
  return null;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  save.mockResolvedValue(true);
  refresh.mockResolvedValue(undefined);
  open.mockResolvedValue(undefined);
  vi.mocked(call).mockResolvedValue(snapshot);
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
});

test('rename captures the chosen DB once and retains the snapshot on conflict', async () => {
  await act(async () => actions.run('rename', database));
  expect(actions.renaming).toEqual(snapshot);
  expect(call).toHaveBeenCalledExactlyOnceWith('/disposable', 'database.inspect', { id: 'chosen-db' });
  vi.mocked(call).mockRejectedValue(new CoreError('conflict', 'External change'));
  await act(async () => {
    await expect(actions.rename('새 이름')).rejects.toMatchObject({ code: 'conflict' });
  });
  expect(call).toHaveBeenLastCalledWith('/disposable', 'database.rename', {
    id: 'chosen-db',
    name: '새 이름',
    expectedRevision: 'chosen-revision',
  });
  expect(call).toHaveBeenCalledTimes(2);
  expect(actions.renaming).toEqual(snapshot);
  expect(refresh).not.toHaveBeenCalled();
});

test('unchanged inline name closes without writing and a new name refreshes the sidebar', async () => {
  await act(async () => actions.run('rename', database));
  await act(async () => actions.rename(' 선택한 DB '));
  expect(actions.renaming).toBeNull();
  expect(call).toHaveBeenCalledTimes(1);
  await act(async () => actions.run('rename', database));
  await act(async () => actions.rename('새 이름'));
  expect(refresh).toHaveBeenCalledOnce();
  expect(actions.renaming).toBeNull();
});

test('deletion waits for confirmation and refreshes the tree and trash together', async () => {
  await act(async () => actions.run('delete', database));
  expect(actions.deleting).toEqual(snapshot);
  expect(call).toHaveBeenCalledTimes(1);
  await act(async () => actions.confirmDelete());
  expect(call).toHaveBeenLastCalledWith('/disposable', 'database.delete', {
    id: 'chosen-db',
    expectedRevision: 'chosen-revision',
  });
  expect(deleted).toHaveBeenCalledExactlyOnceWith('chosen-db');
  expect(refresh).toHaveBeenCalledOnce();
  expect(actions.deleting).toBeNull();
  expect(notify).toHaveBeenCalledOnce();
});

test('delete conflict keeps the original confirmation and never retries', async () => {
  await act(async () => actions.run('delete', database));
  vi.mocked(call).mockRejectedValue(new CoreError('conflict', 'External row edit'));
  await act(async () => {
    await expect(actions.confirmDelete()).rejects.toMatchObject({ code: 'conflict' });
  });
  expect(call).toHaveBeenCalledTimes(2);
  expect(actions.deleting).toEqual(snapshot);
  expect(deleted).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  expect(actions.busy).toBe(false);
});

test('new record uses the chosen DB, saves first, and opens it after refresh', async () => {
  await act(async () => actions.run('new-record', database));
  expect(call).toHaveBeenCalledExactlyOnceWith('/disposable', 'record.create', {
    databaseId: 'chosen-db',
    values: { title: 'Untitled' },
  });
  expect(save.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(call).mock.invocationCallOrder[0]);
  expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(open.mock.invocationCallOrder[0]);
  expect(open).toHaveBeenCalledExactlyOnceWith('chosen-db');
});

test('failed saves prevent record creation and navigation', async () => {
  save.mockResolvedValue(false);
  await act(async () => {
    await expect(actions.run('new-record', database)).rejects.toThrow('저장');
  });
  expect(call).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

test('duplicate requests are ignored while an inspection is pending', async () => {
  let finish!: (result: DatabaseInspection) => void;
  vi.mocked(call).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    const pending = actions.run('rename', database);
    await actions.run('delete', database);
    finish(snapshot);
    await pending;
  });
  expect(call).toHaveBeenCalledOnce();
  expect(actions.renaming).toEqual(snapshot);
  expect(actions.deleting).toBeNull();
});

test('a vault switch discards a late inspection and clears an existing confirmation', async () => {
  await act(async () => actions.run('delete', database));
  let finish!: (result: DatabaseInspection) => void;
  vi.mocked(call).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = actions.run('rename', database);
  });
  await act(async () => root.render(<Harness vault="/other-disposable" />));
  await act(async () => {
    finish(snapshot);
    await pending;
  });
  expect(actions.renaming).toBeNull();
  expect(actions.deleting).toBeNull();
  expect(refresh).not.toHaveBeenCalled();
});

test('a vault switch during record creation does not refresh or navigate the new vault', async () => {
  let finish!: (result: unknown) => void;
  vi.mocked(call).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = actions.run('new-record', database);
  });
  await act(async () => root.render(<Harness vault="/other-disposable" />));
  await act(async () => {
    finish({});
    await pending;
  });
  expect(refresh).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

test('settings navigation cancels a late inspection even after returning to the workspace', async () => {
  let finish!: (result: DatabaseInspection) => void;
  vi.mocked(call).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = actions.run('rename', database);
  });
  await act(async () => root.render(<Harness enabled={false} />));
  await act(async () => root.render(<Harness />));
  await act(async () => {
    finish(snapshot);
    await pending;
  });
  expect(actions.renaming).toBeNull();
  expect(actions.deleting).toBeNull();
});
