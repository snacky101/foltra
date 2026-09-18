// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { call } from './api';
import { settleAndPauseCoreRequests } from './coreRequestBarrier';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn() }));

test('API adapter waits for delayed writes, blocks calls during installation and preserves original args', async () => {
  let finish!: (value: { revision: string }) => void;
  vi.mocked(invoke).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const args = { id: 'row', expectedRevision: 'original', values: { title: '보존' } };
  const write = call('/test-vault', 'record.update', args);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('execute', {
    vault: '/test-vault',
    command: 'record.update',
    args,
  });
  let paused = false;
  const locking = settleAndPauseCoreRequests().then((lock) => {
    paused = true;
    return lock;
  });
  await Promise.resolve();
  expect(paused).toBe(false);
  finish({ revision: 'next' });
  await write;
  const lock = await locking;
  expect(lock.succeeded).toBe(true);
  vi.mocked(invoke).mockResolvedValue({ notes: [] });
  const read = call('/test-vault', 'workspace.get');
  await Promise.resolve();
  expect(invoke).toHaveBeenCalledOnce();
  lock.resume();
  await expect(read).resolves.toEqual({ notes: [] });
  expect(invoke).toHaveBeenCalledTimes(2);
});
