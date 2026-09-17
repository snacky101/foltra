// @vitest-environment jsdom
import { act, StrictMode, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call, CoreError } from '../lib/api';
import { FolderDialog } from './FolderDialog';

vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  call: vi.fn(),
}));

const folder = { id: 'parent', name: 'Projects', parentId: null, revision: 'folder-only' };
const inspection = { folder, revision: 'whole-subtree', folderCount: 2, noteCount: 3 };
type Props = ComponentProps<typeof FolderDialog>;
let host: HTMLDivElement;
let root: Root;
let props: Props;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function render(next = props) {
  props = next;
  await act(async () => {
    root.render(
      <StrictMode>
        <FolderDialog {...props} />
      </StrictMode>,
    );
  });
}
function confirm() {
  return host.querySelector<HTMLButtonElement>('.primary-button')!;
}
function submit() {
  host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(call).mockReset().mockResolvedValue(inspection);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  props = {
    target: { kind: 'delete', folder },
    vault: '/disposable',
    folders: [folder],
    save: vi.fn().mockResolvedValue(true),
    refresh: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    onDeleted: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

test('saves drafts before inspecting, displays subtree counts, and deletes the reviewed revision once', async () => {
  const saved = deferred<boolean>();
  const inspected = deferred<typeof inspection>();
  const deleted = deferred<unknown>();
  const refreshed = deferred<void>();
  props.save = vi.fn(() => saved.promise);
  props.refresh = vi.fn(() => refreshed.promise);
  vi.mocked(call).mockReturnValueOnce(inspected.promise).mockReturnValueOnce(deleted.promise);
  await render();
  expect(props.save).toHaveBeenCalledOnce();
  expect(call).not.toHaveBeenCalled();
  expect(confirm().disabled).toBe(true);
  await act(async () => submit());
  expect(call).not.toHaveBeenCalled();
  await act(async () => saved.resolve(true));
  expect(call).toHaveBeenCalledExactlyOnceWith('/disposable', 'folder.inspect', { id: 'parent' });
  expect(confirm().disabled).toBe(true);
  await act(async () => inspected.resolve(inspection));
  expect(host.textContent).toContain('하위 폴더 2개, 노트 3개');
  expect(host.textContent).toContain('휴지통에서 함께 복원');
  expect(confirm().disabled).toBe(false);
  await act(async () => {
    submit();
    submit();
  });
  expect(call).toHaveBeenCalledTimes(2);
  expect(call).toHaveBeenLastCalledWith('/disposable', 'folder.delete', {
    id: 'parent',
    expectedRevision: 'whole-subtree',
  });
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="닫기"]')!.click());
  expect(props.close).not.toHaveBeenCalled();
  await act(async () => deleted.resolve({}));
  expect(props.refresh).toHaveBeenCalledOnce();
  expect(props.close).not.toHaveBeenCalled();
  expect(props.onDeleted).not.toHaveBeenCalled();
  await act(async () => refreshed.resolve());
  expect(props.close).toHaveBeenCalledOnce();
  expect(props.onDeleted).toHaveBeenCalledOnce();
});

test('parent rerenders and callback changes keep the originally reviewed snapshot', async () => {
  await render();
  const originalSave = props.save;
  const changedSave = vi.fn().mockResolvedValue(true);
  await render({
    ...props,
    target: { kind: 'delete', folder: { ...folder, revision: 'new-folder-revision' } },
    save: changedSave,
  });
  expect(originalSave).toHaveBeenCalledOnce();
  expect(changedSave).not.toHaveBeenCalled();
  expect(call).toHaveBeenCalledTimes(1);
  await act(async () => submit());
  expect(call).toHaveBeenLastCalledWith('/disposable', 'folder.delete', {
    id: 'parent',
    expectedRevision: inspection.revision,
  });
});

test.each([false, new Error('Draft write failed')])(
  'failed draft save keeps deletion disabled (%s)',
  async (failure) => {
    props.save =
      failure instanceof Error ? vi.fn().mockRejectedValue(failure) : vi.fn().mockResolvedValue(failure);
    await render();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(confirm().disabled).toBe(true);
    await act(async () => submit());
    expect(call).not.toHaveBeenCalled();
    expect(props.close).not.toHaveBeenCalled();
  },
);

test('inspection errors remain visible without allowing an unreviewed delete', async () => {
  vi.mocked(call).mockRejectedValue(new Error('Folder unavailable'));
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Folder unavailable');
  expect(confirm().disabled).toBe(true);
  await act(async () => submit());
  expect(call).toHaveBeenCalledTimes(1);
});

test('a subtree conflict stays visible and never fetches a new revision or retries deletion', async () => {
  vi.mocked(call)
    .mockResolvedValueOnce(inspection)
    .mockRejectedValueOnce(new CoreError('conflict', 'Subtree changed'));
  await render();
  await act(async () => submit());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('폴더나 노트가 변경');
  expect(confirm().disabled).toBe(true);
  await act(async () => submit());
  expect(call).toHaveBeenCalledTimes(2);
  expect(props.refresh).not.toHaveBeenCalled();
  expect(props.close).not.toHaveBeenCalled();
  expect(props.onDeleted).not.toHaveBeenCalled();
});

test('changing the folder and vault ignores a late inspection from the previous confirmation', async () => {
  const old = deferred<typeof inspection>();
  const nextFolder = { ...folder, id: 'next', name: 'New folder' };
  vi.mocked(call)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({
      ...inspection,
      folder: nextFolder,
      folderCount: 0,
      noteCount: 1,
      revision: 'next-tree',
    });
  await render();
  await render({ ...props, vault: '/next-vault', target: { kind: 'delete', folder: nextFolder } });
  await act(async () => old.resolve(inspection));
  expect(host.textContent).toContain('“New folder”');
  expect(host.textContent).not.toContain('“Projects”');
  await act(async () => submit());
  expect(call).toHaveBeenLastCalledWith('/next-vault', 'folder.delete', {
    id: 'next',
    expectedRevision: 'next-tree',
  });
});

test('closing while draft save is pending does not inspect or delete afterwards', async () => {
  const saved = deferred<boolean>();
  props.save = vi.fn(() => saved.promise);
  await render();
  await act(async () => root.render(null));
  await act(async () => saved.resolve(true));
  expect(call).not.toHaveBeenCalled();
});

test('a late deletion after the dialog unmounts does not refresh, close another dialog, or move focus', async () => {
  const deleted = deferred<unknown>();
  vi.mocked(call).mockResolvedValueOnce(inspection).mockReturnValueOnce(deleted.promise);
  await render();
  await act(async () => submit());
  await act(async () => root.render(null));
  await act(async () => deleted.resolve({}));
  expect(props.refresh).not.toHaveBeenCalled();
  expect(props.close).not.toHaveBeenCalled();
  expect(props.onDeleted).not.toHaveBeenCalled();
});

test('moving a note retains its existing submit flow without folder inspection or deletion', async () => {
  const move = vi.fn().mockResolvedValue(undefined);
  await render({
    ...props,
    target: {
      kind: 'move',
      note: {
        id: 'note',
        title: 'Note',
        folderId: 'parent',
        createdAt: '',
        updatedAt: '',
        revision: 'note-r1',
      },
      submit: move,
    },
  });
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('노트 이동');
  await act(async () => submit());
  expect(move).toHaveBeenCalledExactlyOnceWith('parent');
  expect(props.close).toHaveBeenCalledOnce();
  expect(props.save).not.toHaveBeenCalled();
  expect(call).not.toHaveBeenCalled();
});
