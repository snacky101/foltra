// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useWorkspace } from './useWorkspace';
import { call } from './api';

vi.mock('./api', () => ({ call: vi.fn() }));
let root: Root, host: HTMLDivElement, vault: ReturnType<typeof useWorkspace>;
function Harness() {
  vault = useWorkspace();
  return null;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  });
  localStorage.clear();
  vi.mocked(call).mockReset();
  localStorage.setItem('foltra:last-vault', '/active');
  localStorage.setItem(
    'foltra:recent-vaults',
    JSON.stringify([
      { path: '/active', name: 'Active' },
      { path: '/other', name: 'Other' },
    ]),
  );
  vi.mocked(call).mockImplementation(async (path) => ({
    path,
    vault: { id: path, name: path === '/active' ? 'Active' : 'Other' },
  }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.unstubAllGlobals();
});

test('forgetting an inactive vault only updates registrations and survives refresh', async () => {
  vi.mocked(call).mockClear();
  await act(async () => vault.forget('/other'));
  expect(call).not.toHaveBeenCalled();
  expect(vault.path).toBe('/active');
  expect(JSON.parse(localStorage.getItem('foltra:recent-vaults')!)).toEqual([
    { path: '/active', name: 'Active' },
  ]);
  await act(async () => vault.refresh());
  expect(vault.recentVaults.map((v) => v.path)).toEqual(['/active']);
});

test('forgetting the active vault closes it; explicitly reopening registers it again', async () => {
  vi.mocked(call).mockClear();
  await act(async () => vault.forget('/active'));
  expect(call).not.toHaveBeenCalled();
  expect(vault.workspace).toBeNull();
  expect(vault.path).toBe('');
  expect(localStorage.getItem('foltra:last-vault')).toBeNull();
  expect(vault.recentVaults.map((v) => v.path)).toEqual(['/other']);
  await act(async () => vault.open('/active'));
  expect(call).toHaveBeenCalledWith('/active', 'workspace.get');
  expect(vault.recentVaults.map((v) => v.path)).toEqual(['/active', '/other']);
});

test('an older refresh cannot restore a forgotten active vault', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let refresh!: Promise<void>;
  await act(async () => {
    refresh = vault.refresh();
  });
  await act(async () => vault.forget('/active'));
  await act(async () => {
    finish({ path: '/active', vault: { id: 'active', name: 'Active' } });
    await refresh;
  });
  expect(vault.workspace).toBeNull();
  expect(vault.recentVaults.map((v) => v.path)).toEqual(['/other']);
});
