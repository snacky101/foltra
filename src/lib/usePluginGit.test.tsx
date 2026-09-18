// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call } from './api';
import { usePluginGit, type GitStatus } from './usePluginGit';
import { GitConnectionDialog } from '../components/GitConnectionDialog';
import type { Workspace } from './types';

vi.mock('./api', () => ({ call: vi.fn() }));
const owner = { path: '/disposable', id: 'git-sync', digest: 'approved' };
const status: GitStatus = {
  config: { remote: 'git@example.test:notes.git', branch: 'main', automatic: false, intervalMinutes: 5 },
  configRevision: 'cfg1',
  jobId: 'job1',
  phase: 'synced',
  message: '동기화 완료',
  updatedAt: '',
  applied: true,
  conflictCount: 0,
  conflicts: [],
  localCommit: null,
  remoteCommit: null,
};
let workspace: Workspace;
let host: HTMLDivElement, root: Root, api: ReturnType<typeof usePluginGit>;
const save = vi.fn<() => Promise<boolean>>();
const refresh = vi.fn<() => Promise<void>>();
const updateView = vi.fn(),
  onError = vi.fn(),
  notify = vi.fn();
function Harness() {
  api = usePluginGit({ workspace, save, refresh, updateView, onError, notify });
  return api.connection ? (
    <GitConnectionDialog
      connection={api.connection}
      busy={api.busy}
      error={api.error}
      confirm={api.confirm}
      close={api.close}
    />
  ) : null;
}
async function render() {
  await act(async () => root.render(<Harness />));
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  workspace = {
    path: owner.path,
    extensions: [{ id: owner.id, runtime: { permissions: ['git.sync', 'ui'] } }],
    pluginStates: [{ id: owner.id, digest: owner.digest, enabled: true }],
  } as Workspace;
  save.mockReset().mockResolvedValue(true);
  refresh.mockReset().mockResolvedValue(undefined);
  updateView.mockReset();
  onError.mockReset();
  notify.mockReset();
  vi.mocked(call).mockReset().mockResolvedValue(status);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
const configure = () =>
  api.request(owner, 'configure', {
    ...status.config,
    expectedRevision: 'cfg1',
    pluginId: 'spoof',
    pluginDigest: 'spoof',
  });

test('configuration displays actual destination and scope; no request on cancel, explicit confirm uses captured revision and real permission owner', async () => {
  await act(async () => configure());
  expect(call).not.toHaveBeenCalled();
  expect(host.textContent).toContain(status.config!.remote);
  expect(host.textContent).toContain('브랜치 · main');
  expect(host.textContent).toContain('휴지통');
  expect(host.textContent).toContain('주제 순서');
  expect(host.textContent).toContain('빈 Vault');
  await act(async () => api.close());
  expect(call).not.toHaveBeenCalled();
  await act(async () => configure());
  await act(async () => api.confirm());
  expect(call).toHaveBeenCalledExactlyOnceWith(owner.path, 'git.configure', {
    ...status.config,
    expectedRevision: 'cfg1',
    pluginId: owner.id,
    pluginDigest: owner.digest,
  });
  expect(api.connection).toBeNull();
});

test('configuration failure retains draft/approval dialog without fresh revision or implicit retry', async () => {
  vi.mocked(call).mockRejectedValue(new Error('설정 변경 충돌'));
  await act(async () => configure());
  await act(async () => api.confirm());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('설정 변경 충돌');
  expect(api.connection?.params.expectedRevision).toBe('cfg1');
  expect(call).toHaveBeenCalledOnce();
});

test('long operation returns immediately, deduplicates per vault, polls status and refreshes only after completion', async () => {
  let finish!: (status: GitStatus) => void;
  vi.mocked(call).mockImplementation(async (_path, command) =>
    command === 'git.sync'
      ? new Promise<GitStatus>((resolve) => {
          finish = resolve;
        })
      : { ...status, phase: 'running' },
  );
  await act(async () => {
    expect(api.request(owner, 'sync', { pluginId: 'spoof' })).toBeUndefined();
    api.request(owner, 'sync');
  });
  expect(vi.mocked(call).mock.calls.filter(([, command]) => command === 'git.sync')).toEqual([
    [owner.path, 'git.sync', { automatic: false, pluginId: owner.id, pluginDigest: owner.digest }],
  ]);
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2100);
  });
  expect(updateView).toHaveBeenCalledTimes(1);
  await act(async () => finish(status));
  expect(refresh).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledTimes(2);
  expect(notify).toHaveBeenCalledWith('동기화 완료');
  const count = vi.mocked(call).mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(call).toHaveBeenCalledTimes(count);
});

test('failed save or permission revoked during save prevents starting any Git request', async () => {
  save.mockResolvedValueOnce(false);
  await act(async () => api.request(owner, 'sync'));
  expect(call).not.toHaveBeenCalled();
  let saved!: (ok: boolean) => void;
  save.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        saved = resolve;
      }),
  );
  await act(async () => api.request(owner, 'sync'));
  workspace = { ...workspace, pluginStates: [{ id: owner.id, digest: 'new-package', enabled: true }] };
  await render();
  await act(async () => saved(true));
  expect(call).not.toHaveBeenCalled();
});

test('switching vault during a job ignores its completion, save and notifications; changing data alone does not cancel it', async () => {
  let finish!: (status: GitStatus) => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise<GitStatus>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => api.request(owner, 'sync'));
  workspace = { ...workspace, notes: [] };
  await render();
  await act(async () => api.request(owner, 'sync'));
  expect(call).toHaveBeenCalledOnce();
  workspace = { ...workspace, path: '/different-vault' };
  await render();
  await act(async () => finish(status));
  expect(refresh).not.toHaveBeenCalled();
  expect(save).toHaveBeenCalledTimes(1);
  expect(notify).not.toHaveBeenCalled();
});

test('configuration approval becomes stale on vault/permission change and cannot apply to the next vault', async () => {
  await act(async () => configure());
  workspace = { ...workspace, pluginStates: [] };
  await render();
  expect(api.connection).toBeNull();
  await act(async () => api.confirm());
  expect(call).not.toHaveBeenCalled();
});

test('failed long call reports once and releases dedup state; newer dirty draft blocks completion refresh', async () => {
  vi.mocked(call).mockRejectedValueOnce(new Error('Network unavailable'));
  await act(async () => api.request(owner, 'sync'));
  expect(onError).toHaveBeenCalledTimes(1);
  save.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await act(async () => api.request(owner, 'resolve', { jobId: 'job1', all: 'local', pluginId: 'spoof' }));
  expect(call).toHaveBeenLastCalledWith(owner.path, 'git.resolve', {
    jobId: 'job1',
    all: 'local',
    pluginId: owner.id,
    pluginDigest: owner.digest,
  });
  expect(refresh).not.toHaveBeenCalled();
});
