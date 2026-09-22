// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { call } from './api';
import { useTreeIcons } from './useTreeIcons';
import type { Workspace } from './types';
vi.mock('./api', () => ({ call: vi.fn() }));
test('icon refresh retains existing icons, rejects old vault results and removes disabled providers', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  const root = createRoot(host);
  const error = vi.fn();
  let resolve: (result: unknown) => void = () => {};
  vi.mocked(call).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  let workspace = {
    path: '/a',
    extensions: [{ id: 'icons', runtime: { treeIcons: true } }],
    pluginStates: [{ id: 'icons', digest: 'v1', enabled: true, dataRevision: 'a' }],
  } as Workspace;
  function Probe() {
    return <span>{useTreeIcons(workspace, error)?.note ?? 'default'}</span>;
  }
  const render = () => act(async () => root.render(<Probe />));
  try {
    await render();
    await act(async () => resolve({ result: { note: 'star' } }));
    expect(host.textContent).toBe('star');
    workspace = { ...workspace, pluginStates: [{ ...workspace.pluginStates![0], dataRevision: 'b' }] };
    await render();
    expect(host.textContent).toBe('star');
    const stale = resolve;
    workspace = { ...workspace, path: '/b' };
    await render();
    expect(host.textContent).toBe('default');
    await act(async () => stale({ result: { note: 'heart' } }));
    expect(host.textContent).toBe('default');
    await act(async () => resolve({ result: { note: 'book-open' } }));
    expect(host.textContent).toBe('book-open');
    workspace = { ...workspace, pluginStates: [{ ...workspace.pluginStates![0], enabled: false }] };
    await render();
    expect(host.textContent).toBe('default');
    expect(error).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
  }
});
