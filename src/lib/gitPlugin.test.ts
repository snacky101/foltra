import { expect, test, vi } from 'vitest';
import plugin from '../../examples/code/git-sync/main';
import manifest from '../../examples/code/git-sync/manifest.json';
import type { Api, ViewNode } from '../../packages/plugin-sdk';
import type { GitStatus } from './usePluginGit';
function fixture() {
  let status: GitStatus = {
    config: null,
    configRevision: 'r1',
    jobId: '',
    phase: '',
    message: '',
    updatedAt: '',
    applied: false,
    conflictCount: 0,
    conflicts: [],
    localCommit: null,
    remoteCommit: null,
  };
  const api = {
    state: {},
    git: vi.fn((action: string) => (action === 'status' ? status : undefined)),
    openView: vi.fn(),
    notify: vi.fn(),
  } as unknown as Api;
  const render = () => plugin.views.sync.render(api);
  const action = (id: string, value?: string | boolean, payload?: unknown) =>
    plugin.views.sync.onAction(api, { id, value, payload });
  return {
    api,
    render,
    action,
    set: (patch: Partial<GitStatus>) => {
      status = { ...status, ...patch };
    },
    operations: () => vi.mocked(api.git).mock.calls.filter(([action]) => action !== 'status'),
  };
}
const flatten = (node: ViewNode): ViewNode[] => [node, ...(node.children ?? []).flatMap(flatten)];
const config = { remote: 'git@example.test:notes.git', branch: 'main', automatic: false, intervalMinutes: 5 };

test('view rendering reads status only and configure queues captured connection values for host approval', () => {
  const f = fixture();
  expect(flatten(f.render()).find((node) => node.action === 'sync')?.disabled).toBe(true);
  expect(f.operations()).toEqual([]);
  f.action('remote', ' git@example.test:notes.git ');
  f.action('branch', ' main ');
  f.action('configure');
  expect(f.operations()).toEqual([['configure', { ...config, expectedRevision: 'r1' }]]);
});

test('automation is off by default and stops on failed/conflicted/running states; explicit sync opens its view', () => {
  const f = fixture();
  plugin.commands.sync(f.api, { automatic: true });
  expect(f.operations()).toEqual([]);
  expect(f.api.openView).not.toHaveBeenCalled();
  f.set({ config });
  plugin.commands.sync(f.api, { automatic: true });
  expect(f.operations()).toEqual([]);
  f.set({ config: { ...config, automatic: true } });
  for (const phase of ['running', 'conflicts', 'error', 'push-pending', 'interrupted']) {
    f.set({ phase });
    plugin.commands.sync(f.api, { automatic: true });
  }
  expect(f.operations()).toEqual([]);
  f.set({ phase: 'synced' });
  plugin.commands.sync(f.api, { automatic: true });
  plugin.commands.sync(f.api, {});
  expect(f.operations()).toEqual([
    ['sync', { automatic: true }],
    ['sync', { automatic: false }],
  ]);
  expect(f.api.openView).toHaveBeenCalledOnce();
});

test('each conflict choice is job-bound and incomplete selections cannot apply', () => {
  const f = fixture();
  f.set({
    config,
    phase: 'conflicts',
    jobId: 'j1',
    conflictCount: 2,
    conflicts: [
      { path: 'notes/a.md', local: 'A', remote: 'B' },
      { path: 'notes/b.md', local: 'C', remote: null },
    ],
  });
  f.render();
  f.action('choose', '내 변경', { path: 'notes/a.md', jobId: 'old' });
  f.action('resolve', undefined, { jobId: 'j1' });
  expect(f.operations()).toEqual([]);
  f.action('choose', '내 변경', { path: 'notes/a.md', jobId: 'j1' });
  f.action('choose', '원격 변경', { path: 'notes/b.md', jobId: 'j1' });
  expect(flatten(f.render()).find((node) => node.action === 'resolve')?.disabled).toBe(false);
  f.action('resolve', undefined, { jobId: 'j1' });
  expect(f.operations()).toEqual([
    ['resolve', { jobId: 'j1', choices: { 'notes/a.md': 'local', 'notes/b.md': 'remote' } }],
  ]);
  f.set({ jobId: 'j2' });
  expect(flatten(f.render()).find((node) => node.action === 'resolve')?.disabled).toBe(true);
});

test('large conflict batches show at most 40 previews and explicit all-side options; source stays plain text', () => {
  const f = fixture();
  const conflicts = Array.from({ length: 45 }, (_, i) => ({
    path: `notes/${i}.md`,
    local: '<script>alert(1)</script>',
    remote: null,
  }));
  f.set({ config, phase: 'conflicts', jobId: 'j1', conflictCount: 45, conflicts });
  const nodes = flatten(f.render());
  expect(nodes.filter((node) => node.action === 'choose')).toHaveLength(40);
  expect(nodes.find((node) => node.action === 'resolve')?.disabled).toBe(true);
  expect(nodes.some((node) => node.type === 'text' && node.text?.includes('<script>'))).toBe(true);
  const allRemote = nodes.find((node) => node.action === 'all-remote')!;
  expect(allRemote.payload).toEqual({ jobId: 'j1' });
  f.action('all-remote', undefined, allRemote.payload);
  expect(f.operations()).toEqual([['resolve', { jobId: 'j1', all: 'remote' }]]);
});

test('configuration changes retain draft revision on external edits, validate interval, and expose usual/leader shortcuts', () => {
  const f = fixture();
  f.set({ config });
  f.render();
  f.action('remote', 'git@example.test:different.git');
  f.set({ configRevision: 'r2', config: { ...config, branch: 'remote-edit' } });
  f.action('configure');
  expect(f.operations()[0][1]).toMatchObject({ expectedRevision: 'r1' });
  f.action('interval', '0');
  f.action('configure');
  expect(f.operations()).toHaveLength(1);
  expect(f.api.notify).toHaveBeenCalled();
  f.action('reset');
  f.action('configure');
  expect(f.operations()[1][1]).toMatchObject({ expectedRevision: 'r2', branch: 'remote-edit' });
  expect(manifest.commands[0].bindings).toEqual([
    { keys: 'Mod+Shift+s', leader: false },
    { keys: 'gs', leader: true },
  ]);
  expect(manifest.commands[1].bindings).toEqual([{ keys: 'go', leader: true }]);
});

test('an old all-conflicts button cannot resolve a newer job', () => {
  const f = fixture();
  f.set({
    config,
    phase: 'conflicts',
    jobId: 'new-job',
    conflictCount: 1,
    conflicts: [{ path: 'notes/a.md', local: 'A', remote: 'B' }],
  });
  f.action('all-local', undefined, { jobId: 'old-job' });
  expect(f.operations()).toEqual([]);
  expect(f.api.notify).toHaveBeenCalledOnce();
});

test('recent history is optional, limited to five entries and uses short commit references with accurate authentication help', () => {
  const f = fixture();
  expect(flatten(f.render()).some((node) => node.text === '최근 동기화')).toBe(false);
  f.set({
    history: Array.from({ length: 7 }, (_, index) => ({
      id: String(index),
      phase: 'synced',
      message: `Finished ${index}`,
      updatedAt: '2026-09-18T09:00:00Z',
      localCommit: '1234567890abcdef',
      remoteCommit: 'abcdef1234567890',
      remote: config.remote,
    })),
  });
  const nodes = flatten(f.render());
  const text = nodes.map((node) => node.text ?? '').join('\n');
  expect(text).toContain('최근 동기화');
  expect(nodes.filter((node) => node.text?.includes('Finished'))).toHaveLength(5);
  expect(text).toContain('내 기록 12345678');
  expect(text).not.toContain('1234567890abcdef');
  expect(text).toContain('.foltra/local/git');
  expect(text).toContain('시스템 Git');
  expect(text).toContain('SSH agent');
  expect(text).toContain('macOS Git Keychain');
  expect(text).toContain('다른 인증 helper는 읽지 않습니다');
});
