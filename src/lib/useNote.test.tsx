// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call, CoreError } from './api';
import { useNote } from './useNote';
import type { Note } from './types';

vi.mock('./api', async (original) => ({ ...(await original<object>()), call: vi.fn() }));
const original = { id: 'one', title: 'Title', body: 'Original', revision: 'r1' } as Note;
let root: Root;
let host: HTMLDivElement;
let note: ReturnType<typeof useNote>;
let refresh: () => Promise<void>;
function Harness({ revision = 'r1' }: { revision?: string }) {
  note = useNote('/temporary-vault', 'one', revision, refresh);
  return null;
}

beforeEach(async () => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  refresh = vi.fn().mockResolvedValue(undefined);
  vi.mocked(call)
    .mockReset()
    .mockImplementation(async (_vault, command, args) => {
      if (command === 'note.read') return original;
      if (command === 'note.update') return { ...original, ...args, revision: 'r2' };
      throw new Error(command);
    });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
const tick = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));
const edit = (body: string) => act(async () => note.edit({ body }));
const writes = () => vi.mocked(call).mock.calls.filter(([, command]) => command === 'note.update');

test('idle autosave persists the exact body, including newlines', async () => {
  await edit('First\nSecond\n\n- Item\n');
  await tick(650);
  expect(writes()[0][2]).toMatchObject({ body: 'First\nSecond\n\n- Item\n', expectedRevision: 'r1' });
  expect(note.status).toBe('saved');
  expect(note.isDirty()).toBe(false);
});

test.each(['idle', 'window blur'])(
  'title spacing survives a normalized %s save response',
  async (trigger) => {
    vi.mocked(call).mockImplementation(async (_vault, command, args) => {
      if (command === 'note.update')
        return {
          ...original,
          ...args,
          title: String((args as { title: string }).title).trim(),
          revision: `r${writes().length + 1}`,
        };
      throw new Error(command);
    });
    await act(async () => note.edit({ title: '한글 ' }));
    if (trigger === 'idle') await tick(650);
    else await act(async () => window.dispatchEvent(new Event('blur')));
    expect(note.draft.title).toBe('한글 ');
    expect(note.currentNote()).toMatchObject({ title: '한글', revision: 'r2' });
    expect(note.isDirty()).toBe(false);
    await tick(3000);
    expect(writes()).toHaveLength(1);
    await act(async () => note.edit({ title: `${note.draft.title}English` }));
    await tick(650);
    expect(writes().at(-1)?.[2]).toMatchObject({ title: '한글 English', expectedRevision: 'r2' });
  },
);

test('title edits during a normalized save retain spacing and use the acknowledged revision', async () => {
  let finish!: (value: Note) => void;
  vi.mocked(call).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  await act(async () => note.edit({ title: '한글 ' }));
  let saving!: Promise<boolean>;
  await act(async () => {
    saving = note.save();
  });
  await act(async () => note.edit({ title: '한글 English ' }));
  vi.mocked(call).mockResolvedValueOnce({ ...original, title: '한글 English', revision: 'r3' });
  await act(async () => finish({ ...original, title: '한글', revision: 'r2' }));
  expect(await saving).toBe(true);
  expect(writes().at(-1)?.[2]).toMatchObject({ title: '한글 English ', expectedRevision: 'r2' });
  expect(note.draft.title).toBe('한글 English ');
  expect(note.currentNote()?.revision).toBe('r3');
  expect(note.isDirty()).toBe(false);
});

test('continuous typing cannot postpone autosave indefinitely', async () => {
  for (let i = 0; i < 8; i++) {
    await edit(`typing ${i}`);
    await tick(400);
  }
  expect(writes().length).toBeGreaterThan(0);
  await tick(650);
  expect(writes().at(-1)?.[2]).toMatchObject({ body: 'typing 7' });
  expect(note.status).toBe('saved');
});

test('save waits for edits made during its request before permitting navigation', async () => {
  let finish!: (value: Note) => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await edit('First write');
  let saving!: Promise<boolean>;
  await act(async () => {
    saving = note.save();
  });
  await edit('Typed while saving');
  await act(async () => finish({ ...original, body: 'First write', revision: 'r2' }));
  expect(await saving).toBe(true);
  expect(writes().at(-1)?.[2]).toMatchObject({ body: 'Typed while saving', expectedRevision: 'r2' });
  expect(note.isDirty()).toBe(false);
});

test('conflicts retain the draft and revision and prevent navigation', async () => {
  vi.mocked(call).mockRejectedValueOnce(new CoreError('conflict', 'changed externally'));
  await edit('Keep my edits');
  let ok = true;
  await act(async () => {
    ok = await note.save();
  });
  expect(ok).toBe(false);
  expect(note.draft.body).toBe('Keep my edits');
  expect(note.currentNote()?.revision).toBe('r1');
  expect(note.isDirty()).toBe(true);
  await tick(5000);
  expect(writes()).toHaveLength(1);
});

test('a failed write remains editable and the next edit retries saving', async () => {
  vi.mocked(call).mockRejectedValueOnce(new CoreError('io', 'Disk unavailable'));
  await edit('First');
  await tick(650);
  expect(note.status).toBe('error');
  await edit('Recovered\nbody');
  await tick(650);
  expect(note.status).toBe('saved');
  expect(writes().at(-1)?.[2]).toMatchObject({ expectedRevision: 'r1', body: 'Recovered\nbody' });
});

test('a delayed background reload does not overwrite newly typed content', async () => {
  let finish!: (value: Note) => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => root.render(<Harness revision="external" />));
  expect(note.status).toBe('saved');
  await edit('Typed during the read');
  await act(async () => finish({ ...original, body: 'External change', revision: 'external' }));
  expect(note.draft.body).toBe('Typed during the read');
  expect(note.isDirty()).toBe(true);
  expect(note.currentNote()?.revision).toBe('r1');
});

test('losing window focus flushes edits and concurrent save callers share one write', async () => {
  let finish!: (value: Note) => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await edit('Flush before leaving');
  await act(async () => {
    window.dispatchEvent(new Event('blur'));
  });
  let saving!: Promise<boolean>;
  await act(async () => {
    saving = note.save();
  });
  expect(writes()).toHaveLength(1);
  await act(async () => finish({ ...original, body: 'Flush before leaving', revision: 'r2' }));
  expect(await saving).toBe(true);
  expect(note.isDirty()).toBe(false);
});

test('saving a conflict copy preserves edits typed while the copy request is pending', async () => {
  await edit('Draft to copy');
  let finish!: (value: Note) => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let copying!: Promise<Note>;
  await act(async () => {
    copying = note.saveCopy();
  });
  const outcome = copying.then(
    () => 'navigated',
    () => 'retained',
  );
  await edit('New input while copying');
  await act(async () => finish({ ...original, id: 'copy', body: 'Draft to copy' }));
  expect(await outcome).toBe('retained');
  expect(note.draft.body).toBe('New input while copying');
  expect(note.isDirty()).toBe(true);
  expect(note.currentNote()?.id).toBe('one');
});

test('saving an unchanged conflict draft as a copy still allows opening the saved copy', async () => {
  await edit('Copied body');
  const copied = { ...original, id: 'copy', title: 'Title (사본)', body: 'Copied body' };
  vi.mocked(call).mockResolvedValueOnce(copied);
  let saved!: Note;
  await act(async () => {
    saved = await note.saveCopy();
  });
  expect(saved).toEqual(copied);
  expect(note.isDirty()).toBe(false);
  expect(refresh).toHaveBeenCalledOnce();
});

test('copy refresh cannot discard input typed after creation but before navigation', async () => {
  await edit('Copied body');
  vi.mocked(call).mockResolvedValueOnce({ ...original, id: 'copy', body: 'Copied body' });
  let finish!: () => void;
  refresh = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => root.render(<Harness />));
  let copying!: Promise<Note>;
  await act(async () => {
    copying = note.saveCopy();
  });
  const outcome = copying.then(
    () => 'navigated',
    () => 'retained',
  );
  await edit('Typed during refresh');
  await act(async () => finish());
  expect(await outcome).toBe('retained');
  expect(note.draft.body).toBe('Typed during refresh');
  expect(note.isDirty()).toBe(true);
});
