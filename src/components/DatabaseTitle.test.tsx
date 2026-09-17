// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DatabaseTitle } from './DatabaseTitle';
import { call } from '../lib/api';
import type { Database } from '../lib/types';

vi.mock('../lib/api', () => ({ call: vi.fn() }));
const database: Database = { id: 'db', name: 'Projects', properties: [], createdAt: '' };
let host: HTMLDivElement, root: Root;
let refresh = vi.fn(),
  onError = vi.fn();
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  refresh = vi.fn().mockResolvedValue(undefined);
  onError = vi.fn();
  vi.mocked(call).mockReset().mockResolvedValue({ database, revision: 'original', recordCount: 1 });
  await act(async () =>
    root.render(
      <DatabaseTitle vault="/disposable" database={database} refresh={refresh} onError={onError} />,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const input = () => host.querySelector('input')!;
async function edit(text: string) {
  await act(async () => input().focus());
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), text);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function key(key: string, options: KeyboardEventInit = {}) {
  await act(async () =>
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })),
  );
}
const renames = () => vi.mocked(call).mock.calls.filter(([, command]) => command === 'database.rename');

test('Enter saves a trimmed Korean title once using the focus snapshot', async () => {
  await edit('  공부 기록  ');
  await key('Enter');
  expect(renames()).toEqual([
    ['/disposable', 'database.rename', { id: 'db', name: '공부 기록', expectedRevision: 'original' }],
  ]);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(input().value).toBe('공부 기록');
  expect(onError).not.toHaveBeenCalled();
});
test('blur saves; Escape cancels without a write or refresh', async () => {
  await edit('Cancelled');
  await key('Escape');
  expect(input().value).toBe('Projects');
  expect(renames()).toHaveLength(0);
  await edit('After blur');
  await act(async () => input().blur());
  expect(renames()).toHaveLength(1);
  expect(renames()[0][2]).toMatchObject({ name: 'After blur' });
});
test('composition Enter keeps input focused and does not save', async () => {
  await edit('한글');
  await key('Enter', { isComposing: true });
  await key('Enter', { keyCode: 229 });
  expect(document.activeElement).toBe(input());
  expect(renames()).toHaveLength(0);
  await key('Enter');
  expect(renames()).toHaveLength(1);
});
test('blank and unchanged titles do not write', async () => {
  await edit('Projects');
  await key('Enter');
  expect(renames()).toHaveLength(0);
  await edit('  ');
  await key('Enter');
  expect(renames()).toHaveLength(0);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(input().value).toBe('  ');
});
test('a conflict preserves draft and original revision instead of automatically retrying', async () => {
  await edit('My draft');
  vi.mocked(call).mockRejectedValue(new Error('Revision conflict'));
  await key('Enter');
  expect(input().value).toBe('My draft');
  expect(onError).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => input().focus());
  await key('Enter');
  expect(vi.mocked(call).mock.calls.filter(([, cmd]) => cmd === 'database.inspect')).toHaveLength(1);
  expect(
    renames().every(([, , args]) => (args as { expectedRevision: string }).expectedRevision === 'original'),
  ).toBe(true);
});
test('a rename that happened before focus is not overwritten by a stale displayed name', async () => {
  vi.mocked(call).mockResolvedValue({ database: { ...database, name: 'External change' }, revision: 'new' });
  await edit('My draft');
  await key('Enter');
  expect(renames()).toHaveLength(0);
  expect(onError).toHaveBeenCalledTimes(1);
});
test('a quick blur waits for inspection and saves at most once', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await edit('Quick edit');
  await key('Enter');
  expect(renames()).toHaveLength(0);
  expect(input().readOnly).toBe(true);
  await act(async () => resolve({ database, revision: 'captured' }));
  expect(renames()).toHaveLength(1);
  expect(renames()[0][2]).toMatchObject({ name: 'Quick edit', expectedRevision: 'captured' });
});

test('a failed inspection can be retried on the next focus without losing the draft', async () => {
  vi.mocked(call).mockRejectedValueOnce(new Error('Could not inspect'));
  await edit('Retry title');
  await key('Enter');
  expect(renames()).toHaveLength(0);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(input().value).toBe('Retry title');
  await act(async () => input().focus());
  await key('Enter');
  expect(renames()).toHaveLength(1);
  expect(renames()[0][2]).toMatchObject({ name: 'Retry title', expectedRevision: 'original' });
});
