import { expect, test, vi } from 'vitest';
import { runNoteCommand, type NoteCommandContext } from './noteCommands';

function context(dirty = false): NoteCommandContext {
  return {
    save: vi.fn(async () => true),
    isDirty: () => dirty,
    discard: vi.fn(async () => {}),
    close: vi.fn(),
    notify: vi.fn(),
  };
}
test('quit closes a clean note but refuses unsaved changes', async () => {
  const clean = context();
  await runNoteCommand('quit', false, clean);
  expect(clean.close).toHaveBeenCalledOnce();
  expect(clean.save).not.toHaveBeenCalled();
  const dirty = context(true);
  await expect(runNoteCommand('quit', false, dirty)).rejects.toThrow('E37');
  expect(dirty.close).not.toHaveBeenCalled();
});
test('write and writequit preserve the editor when a save conflicts, including bang', async () => {
  for (const command of ['write', 'writequit'] as const) {
    const failed = context(true);
    failed.save = async () => false;
    await expect(runNoteCommand(command, true, failed)).rejects.toThrow('보존');
    expect(failed.close).not.toHaveBeenCalled();
    expect(failed.discard).not.toHaveBeenCalled();
  }
});
test('writequit waits for a write and drains input that arrived while saving', async () => {
  const c = context();
  let finish!: (ok: boolean) => void;
  let dirty = true;
  c.isDirty = () => dirty;
  c.save = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    )
    .mockImplementationOnce(async () => {
      dirty = false;
      return true;
    });
  const pending = runNoteCommand('writequit', false, c);
  expect(c.close).not.toHaveBeenCalled();
  finish(true);
  await pending;
  expect(c.save).toHaveBeenCalledTimes(2);
  expect(c.close).toHaveBeenCalledOnce();
});
test('write stays open; forced quit waits for draft discard before closing', async () => {
  const c = context();
  await runNoteCommand('write', false, c);
  expect(c.close).not.toHaveBeenCalled();
  expect(c.notify).toHaveBeenCalledWith('저장했습니다.');
  let discard!: () => void;
  c.discard = () =>
    new Promise<void>((resolve) => {
      discard = resolve;
    });
  const pending = runNoteCommand('quit', true, c);
  expect(c.close).not.toHaveBeenCalled();
  discard();
  await pending;
  expect(c.close).toHaveBeenCalledOnce();
});
