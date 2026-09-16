import { expect, test, vi, beforeEach } from 'vitest';
import { call } from './api';
import { PluginSession } from './pluginSession';
import type { PluginResponse } from './pluginTypes';
vi.mock('./api', () => ({ call: vi.fn() }));
const status = { id: 'test', digest: 'code-sha', enabled: true };
const response = (state = {}): PluginResponse => ({
  state,
  result: null,
  effects: [],
  changed: false,
  view: null,
});
beforeEach(() => vi.resetAllMocks());
test('serializes calls and passes the previous session state with an exact package digest', async () => {
  let finish!: (value: PluginResponse) => void;
  vi.mocked(call)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(response());
  const session = new PluginSession('/temporary-vault', status);
  const first = session.invoke({ type: 'load' });
  const second = session.invoke({ type: 'command', id: 'next' });
  await Promise.resolve();
  expect(call).toHaveBeenCalledTimes(1);
  finish(response({ count: 7 }));
  await first;
  await second;
  expect(call).toHaveBeenLastCalledWith('/temporary-vault', 'extension.invoke', {
    id: 'test',
    digest: 'code-sha',
    event: { type: 'command', id: 'next' },
    state: { count: 7 },
  });
});
test('disposal discards late results, cancels queued commands, and attempts unload once', async () => {
  let finish!: (value: PluginResponse) => void;
  vi.mocked(call)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(response());
  const session = new PluginSession('/old-vault', status);
  const first = session.invoke({ type: 'command', id: 'running' });
  const queued = session.invoke({ type: 'command', id: 'queued' });
  await Promise.resolve();
  const stop = session.dispose();
  finish(response());
  expect(await first).toBeNull();
  expect(await queued).toBeNull();
  await stop;
  await session.dispose();
  expect(call).toHaveBeenCalledTimes(2);
  expect(vi.mocked(call).mock.calls[1][2]).toMatchObject({ event: { type: 'unload' } });
  expect(await session.invoke({ type: 'load' })).toBeNull();
});
test('a failed plugin stops issuing core requests without affecting another session', async () => {
  vi.mocked(call).mockRejectedValueOnce(new Error('Execution interrupted')).mockResolvedValue(response());
  const broken = new PluginSession('/vault', status);
  await expect(broken.invoke({ type: 'load' })).rejects.toThrow('interrupted');
  await expect(broken.invoke({ type: 'command', id: 'again' })).rejects.toThrow('interrupted');
  const other = new PluginSession('/vault', { ...status, id: 'other' });
  expect(await other.invoke({ type: 'load' })).toEqual(response());
  expect(call).toHaveBeenCalledTimes(2);
});
