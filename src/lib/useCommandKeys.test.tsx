// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createBuiltinCommands, type BuiltinCommandId } from './builtinCommands';
import { runNoteCommand } from './noteCommands';
import type { Settings } from './types';
import { useCommandKeys } from './useCommandKeys';

const save = vi.fn<() => Promise<boolean>>();
const close = vi.fn();
const onError = vi.fn();
let root: Root;
let host: HTMLDivElement;
const settings = { vim: false, leader: ' ', keybindings: {} } as Settings;
function Harness({
  overrides = {},
  modal = false,
}: {
  overrides?: Settings['keybindings'];
  modal?: boolean;
}) {
  const commands = createBuiltinCommands({} as Record<BuiltinCommandId, () => void>);
  commands.find((command) => command.id === 'note.close')!.run = () =>
    runNoteCommand('writequit', false, {
      save,
      isDirty: () => false,
      discard: vi.fn(),
      close,
      notify: vi.fn(),
    });
  useCommandKeys(commands, { ...settings, keybindings: overrides }, 'EDIT', modal, onError);
  return <textarea aria-label="Draft" />;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
  save.mockResolvedValue(true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
  host.querySelector('textarea')!.focus();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function press(key: string) {
  const event = new KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true });
  await act(async () => {
    document.activeElement!.dispatchEvent(event);
  });
  return event;
}

test('Cmd+W waits for saving before closing the note from an editable field', async () => {
  let finish!: (ok: boolean) => void;
  save.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  expect((await press('w')).defaultPrevented).toBe(true);
  expect(save).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  await act(async () => finish(true));
  expect(close).toHaveBeenCalledOnce();
});

test('Cmd+W keeps the note open when saving fails', async () => {
  save.mockResolvedValue(false);
  await press('w');
  expect(close).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledOnce();
});

test('the close-note shortcut can be rebound or disabled', async () => {
  await act(async () =>
    root.render(<Harness overrides={{ 'note.close': [{ keys: 'Mod+y', leader: false }] }} />),
  );
  expect((await press('w')).defaultPrevented).toBe(false);
  expect(save).not.toHaveBeenCalled();
  expect((await press('y')).defaultPrevented).toBe(true);
  expect(close).toHaveBeenCalledOnce();
  await act(async () => root.render(<Harness overrides={{ 'note.close': [] }} />));
  await press('w');
  await press('y');
  expect(close).toHaveBeenCalledOnce();
});

test('Cmd+W does not close a note behind a dialog', async () => {
  await act(async () => root.render(<Harness modal />));
  await press('w');
  expect(save).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

test('a table cell input inside a Normal-mode editor accepts Space without starting Leader', async () => {
  function CellHarness() {
    const pending = useCommandKeys([], { ...settings, vim: true }, 'NORMAL', false, onError);
    return (
      <div className="cm-editor">
        <input aria-label="Table cell" />
        <output>{pending === null ? 'idle' : 'leader'}</output>
      </div>
    );
  }
  await act(async () => root.render(<CellHarness />));
  const input = host.querySelector('input')!;
  input.focus();
  const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
  await act(async () => input.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  expect(host.querySelector('output')?.textContent).toBe('idle');
});
