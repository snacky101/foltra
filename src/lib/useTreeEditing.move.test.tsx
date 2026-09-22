// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useTreeEditing } from './useTreeEditing';
import { call, CoreError } from './api';

vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), call: vi.fn() }));
const folder = { id: 'folder', name: 'Work', parentId: null, revision: 'selected-revision' };
const refresh = vi.fn(),
  save = vi.fn(),
  open = vi.fn();
let host: HTMLDivElement, root: Root, actions: ReturnType<typeof useTreeEditing>;
function Harness({ vault }: { vault: string }) {
  actions = useTreeEditing(vault, null, save, refresh, open);
  return null;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  vi.mocked(call).mockResolvedValue({});
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness vault="/disposable" />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
test('folder moves preserve the selected name and revision without touching the active note', async () => {
  await act(async () => actions.moveFolder(folder, 'parent'));
  expect(call).toHaveBeenCalledExactlyOnceWith('/disposable', 'folder.update', {
    id: folder.id,
    name: folder.name,
    expectedRevision: folder.revision,
    parentId: 'parent',
  });
  expect(refresh).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});
test('same-parent moves do nothing and conflicts are propagated without retries', async () => {
  await actions.moveFolder(folder, '');
  expect(call).not.toHaveBeenCalled();
  vi.mocked(call).mockRejectedValueOnce(new CoreError('conflict', 'Changed'));
  await expect(actions.moveFolder(folder, 'parent')).rejects.toMatchObject({ code: 'conflict' });
  expect(call).toHaveBeenCalledOnce();
  expect(refresh).not.toHaveBeenCalled();
});
test('a completed move in an old vault does not refresh the new vault', async () => {
  let finish!: () => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = actions.moveFolder(folder, 'parent');
  await act(async () => root.render(<Harness vault="/other" />));
  await act(async () => {
    finish();
    await pending;
  });
  expect(refresh).not.toHaveBeenCalled();
});
