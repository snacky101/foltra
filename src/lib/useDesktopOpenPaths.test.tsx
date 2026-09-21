// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { call } from './api';
import { settleCoreRequests } from './coreRequestBarrier';
import { useDesktopOpenPaths, type DesktopOpenTarget } from './useDesktopOpenPaths';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('./api', () => ({ call: vi.fn() }));
vi.mock('./coreRequestBarrier', () => ({ settleCoreRequests: vi.fn() }));
let root: Root, host: HTMLDivElement, notify: () => void;
let opening = false;
const save = vi.fn(async () => true);
const blocked = vi.fn<() => string | undefined>(() => undefined);
const open = vi.fn<(target: DesktopOpenTarget) => Promise<void>>(async () => {});
const onError = vi.fn();
const unlisten = vi.fn();
function Harness() {
  opening = useDesktopOpenPaths({ save, blocked, open, onError });
  return null;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(listen).mockImplementation(async (_event, callback) => {
    notify = () => callback({ event: 'foltra:open-paths', id: 1, payload: undefined });
    return unlisten;
  });
  vi.mocked(invoke).mockResolvedValue([]);
  vi.mocked(call).mockImplementation(async (_vault, _command, args) => ({
    path: (args as { path: string }).path,
    vaultPath: '/vault',
    noteId: 'requested-note',
  }));
  save.mockResolvedValue(true);
  blocked.mockReturnValue(undefined);
  vi.mocked(settleCoreRequests).mockResolvedValue(true);
  open.mockResolvedValue(undefined);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

test('subscribes before draining a cold-start path and saves before opening', async () => {
  const saving = deferred<boolean>();
  save.mockReturnValueOnce(saving.promise);
  vi.mocked(invoke).mockResolvedValueOnce(['/볼트/노트 이름.md']);
  await act(async () => root.render(<Harness />));
  expect(listen).toHaveBeenCalledWith('foltra:open-paths', expect.any(Function));
  expect(vi.mocked(listen).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(invoke).mock.invocationCallOrder[0],
  );
  expect(call).toHaveBeenCalledWith('', 'path.resolve', { path: '/볼트/노트 이름.md' });
  expect(open).not.toHaveBeenCalled();
  expect(opening).toBe(true);
  await act(async () => saving.resolve(true));
  expect(open).toHaveBeenCalledExactlyOnceWith({
    path: '/볼트/노트 이름.md',
    vaultPath: '/vault',
    noteId: 'requested-note',
  });
  expect(opening).toBe(false);
});

test('live requests wait for an in-flight open and preserve order', async () => {
  const opening = deferred<void>();
  vi.mocked(invoke).mockResolvedValueOnce(['/first']);
  open.mockReturnValueOnce(opening.promise);
  await act(async () => root.render(<Harness />));
  vi.mocked(invoke).mockResolvedValueOnce(['/second', '/third']);
  await act(async () => notify());
  expect(invoke).toHaveBeenCalledTimes(1);
  await act(async () => opening.resolve());
  expect(open.mock.calls.map(([target]) => target.path)).toEqual(['/first', '/second', '/third']);
});

test('a failed save preserves the current note and does not prevent a later request', async () => {
  vi.mocked(invoke).mockResolvedValueOnce(['/first', '/second']);
  save.mockResolvedValueOnce(false);
  await act(async () => root.render(<Harness />));
  expect(onError).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(1);
  expect(open.mock.calls[0][0].path).toBe('/second');
});

test('an invalid target never saves or changes the workspace', async () => {
  vi.mocked(invoke).mockResolvedValueOnce(['/missing']);
  const error = new Error('not found');
  vi.mocked(call).mockRejectedValueOnce(error);
  await act(async () => root.render(<Harness />));
  expect(save).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith(error);
});

test('an update blocks new requests, including an update started during saving', async () => {
  blocked.mockReturnValue('앱 업데이트가 끝난 뒤 다시 열어주세요.');
  vi.mocked(invoke).mockResolvedValueOnce(['/first']);
  await act(async () => root.render(<Harness />));
  expect(call).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  blocked.mockReturnValue(undefined);
  const saving = deferred<boolean>();
  save.mockReturnValueOnce(saving.promise);
  vi.mocked(invoke).mockResolvedValueOnce(['/second']);
  await act(async () => notify());
  blocked.mockReturnValue('앱 업데이트가 끝난 뒤 다시 열어주세요.');
  await act(async () => saving.resolve(true));
  expect(open).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledTimes(2);
});

test('the input gate covers blur saves and rejects their failures before changing vault', async () => {
  const settling = deferred<boolean>();
  vi.mocked(settleCoreRequests).mockReturnValueOnce(settling.promise);
  vi.mocked(invoke).mockResolvedValueOnce(['/other']);
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  await act(async () => root.render(<Harness />));
  expect(opening).toBe(true);
  expect(document.activeElement).not.toBe(input);
  expect(save).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  await act(async () => settling.resolve(false));
  expect(opening).toBe(false);
  expect(open).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledTimes(1);
  input.remove();
});

test('the input gate stays active until asynchronous workspace loading finishes', async () => {
  const loading = deferred<void>();
  open.mockReturnValueOnce(loading.promise);
  vi.mocked(invoke).mockResolvedValueOnce(['/other']);
  await act(async () => root.render(<Harness />));
  expect(opening).toBe(true);
  await act(async () => loading.resolve());
  expect(opening).toBe(false);
});

test('StrictMode replay drains a startup request once and cleans both subscriptions', async () => {
  vi.mocked(invoke).mockResolvedValueOnce(['/first']);
  await act(async () =>
    root.render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    ),
  );
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(1);
  expect(unlisten).toHaveBeenCalledTimes(1);
});

test('late subscription completion after unmount does not consume queued native paths', async () => {
  const subscription = deferred<() => void>();
  vi.mocked(listen).mockReturnValueOnce(subscription.promise);
  await act(async () => root.render(<Harness />));
  await act(async () => root.render(null));
  await act(async () => subscription.resolve(unlisten));
  expect(unlisten).toHaveBeenCalledTimes(1);
  expect(invoke).not.toHaveBeenCalled();
});

test('the browser adapter does not subscribe to native events', async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  await act(async () => root.render(<Harness />));
  expect(listen).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
});
