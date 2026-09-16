// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call } from './api';
import { useOpenWikiLink } from './useOpenWikiLink';
import type { Workspace } from './types';

vi.mock('./api', () => ({ call: vi.fn() }));
const workspace = {
  notes: [
    { id: 'existing-id', title: 'Existing' },
    { id: 'one', title: 'Duplicate' },
    { id: 'two', title: 'Duplicate' },
  ],
  records: [
    { id: 'linked', bodyNoteId: 'existing-id' },
    { id: 'empty', bodyNoteId: null },
  ],
} as unknown as Workspace;
const save = vi.fn<() => Promise<boolean>>();
const refresh = vi.fn<() => Promise<void>>();
const openNote = vi.fn<(id: string) => Promise<void>>();
const onError = vi.fn();
let root: Root;
let open: ReturnType<typeof useOpenWikiLink>;
function Harness({ path = '/temporary-vault' }: { path?: string }) {
  open = useOpenWikiLink(path, workspace, save, refresh, openNote, onError);
  return null;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  save.mockResolvedValue(true);
  refresh.mockResolvedValue(undefined);
  openNote.mockResolvedValue(undefined);
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
});

test.each(['Missing', 'Duplicate', 'record:empty', 'record:missing'])(
  'navigation-only %s has no save, creation, refresh, navigation or error side effects',
  async (target) => {
    await open(target, false);
    expect(save).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(openNote).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  },
);

test.each(['Existing', 'existing-id', 'Existing#section', 'record:linked'])(
  'navigation-only %s opens the existing note without calling the creation API',
  async (target) => {
    await open(target, false);
    expect(save).toHaveBeenCalledOnce();
    expect(openNote).toHaveBeenCalledExactlyOnceWith('existing-id');
    expect(call).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  },
);

test('normal link opening still uses atomic open-or-create then refreshes and navigates', async () => {
  vi.mocked(call).mockResolvedValue({ id: 'created' });
  await open('Missing#section');
  expect(call).toHaveBeenCalledExactlyOnceWith('/temporary-vault', 'note.open-link', { target: 'Missing' });
  expect(refresh).toHaveBeenCalledOnce();
  expect(openNote).toHaveBeenCalledExactlyOnceWith('created');
});

test.each([false, true])('save failure prevents navigation and creation (create %s)', async (create) => {
  save.mockResolvedValue(false);
  await open('Existing', create);
  expect(openNote).not.toHaveBeenCalled();
  expect(call).not.toHaveBeenCalled();
});

test('a vault switch while saving cancels the pending existing-note navigation', async () => {
  let finish!: (saved: boolean) => void;
  save.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = open('Existing', false);
  await act(async () => root.render(<Harness path="/another-vault" />));
  finish(true);
  await pending;
  expect(openNote).not.toHaveBeenCalled();
  expect(call).not.toHaveBeenCalled();
});
