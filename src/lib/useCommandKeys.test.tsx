// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createBuiltinCommands, type BuiltinCommandId } from './builtinCommands';
import { runNoteCommand } from './noteCommands';
import type { Settings } from './types';
import { useCommandKeys } from './useCommandKeys';
import { moveWorkspaceFocus, rememberWorkspaceFocus } from './workspaceFocus';

const save = vi.fn<() => Promise<boolean>>();
const close = vi.fn();
const onError = vi.fn();
const addFrontmatterProperty = vi.fn();
const cycleTask = vi.fn();
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
  commands.find((command) => command.id === 'note.frontmatter.add')!.run = addFrontmatterProperty;
  commands.find((command) => command.id === 'note.task.cycle')!.run = cycleTask;
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
  vi.useRealTimers();
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

test('Cmd+; adds a property through the command router and respects overrides and explicit disable', async () => {
  expect((await press(';')).defaultPrevented).toBe(true);
  expect(addFrontmatterProperty).toHaveBeenCalledOnce();
  await act(async () =>
    root.render(<Harness overrides={{ 'note.frontmatter.add': [{ keys: 'Mod+y', leader: false }] }} />),
  );
  expect((await press(';')).defaultPrevented).toBe(false);
  expect((await press('y')).defaultPrevented).toBe(true);
  expect(addFrontmatterProperty).toHaveBeenCalledTimes(2);
  await act(async () => root.render(<Harness overrides={{ 'note.frontmatter.add': [] }} />));
  expect((await press(';')).defaultPrevented).toBe(false);
  expect((await press('y')).defaultPrevented).toBe(false);
  expect(addFrontmatterProperty).toHaveBeenCalledTimes(2);
});

test('Cmd+W keeps the note open when saving fails', async () => {
  save.mockResolvedValue(false);
  await press('w');
  expect(close).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledOnce();
});

test('Cmd+L routes task cycling and supports custom shortcuts and disable', async () => {
  expect((await press('l')).defaultPrevented).toBe(true);
  expect(cycleTask).toHaveBeenCalledOnce();
  await act(async () =>
    root.render(<Harness overrides={{ 'note.task.cycle': [{ keys: 'Mod+y', leader: false }] }} />),
  );
  expect((await press('l')).defaultPrevented).toBe(false);
  expect((await press('y')).defaultPrevented).toBe(true);
  expect(cycleTask).toHaveBeenCalledTimes(2);
  await act(async () => root.render(<Harness overrides={{ 'note.task.cycle': [] }} />));
  expect((await press('y')).defaultPrevented).toBe(false);
  expect(cycleTask).toHaveBeenCalledTimes(2);
});

test('Cmd+L uses the physical key with the Korean layout', async () => {
  const event = new KeyboardEvent('keydown', {
    key: 'ㅣ',
    code: 'KeyL',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    document.activeElement!.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
  expect(cycleTask).toHaveBeenCalledOnce();
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

function NavigationHarness({ configuration = {} }: { configuration?: Partial<Settings> }) {
  const commands = createBuiltinCommands({} as Record<BuiltinCommandId, () => void>);
  commands.find((command) => command.id === 'focus.left')!.run = () => moveWorkspaceFocus('left');
  commands.find((command) => command.id === 'focus.right')!.run = () => moveWorkspaceFocus('right');
  commands.find((command) => command.id === 'focus.up')!.run = () => moveWorkspaceFocus('up');
  commands.find((command) => command.id === 'focus.down')!.run = () => moveWorkspaceFocus('down');
  commands.find((command) => command.id === 'note.task.cycle')!.run = cycleTask;
  const pending = useCommandKeys(
    commands,
    { ...settings, vim: true, ...configuration },
    'NORMAL',
    false,
    onError,
  );
  return (
    <div onFocusCapture={(event) => rememberWorkspaceFocus(event.target)}>
      <div className="sidebar">
        <div data-focus-region="sidebar-tree" tabIndex={-1}>
          <button data-sidebar-item aria-label="New note">
            New
          </button>
          <button data-tree-item aria-label="Note">
            Note
          </button>
          <button data-tree-item aria-label="Database">
            Database
          </button>
          <input aria-label="Rename" data-inline-rename />
        </div>
      </div>
      <header data-focus-region="main-toolbar">
        <button aria-label="Save note">Save</button>
      </header>
      <section data-focus-region="main">
        <textarea aria-label="Draft" />
      </section>
      <aside data-focus-region="backlinks">
        <button aria-label="Heading control">Heading</button>
        <button data-backlink-item="incoming" aria-label="Incoming">
          Incoming
        </button>
        <button data-backlink-item="outgoing" aria-label="Outgoing">
          Outgoing
        </button>
      </aside>
      <output>{pending === null ? 'idle' : 'leader'}</output>
    </div>
  );
}
async function navigation(configuration: Partial<Settings> = {}) {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  await act(async () => root.render(<NavigationHarness configuration={configuration} />));
  host.querySelector('textarea')!.focus();
}
async function dispatch(target: HTMLElement, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  await act(async () => target.dispatchEvent(event));
  return event;
}

test.each([
  ['ㅓ', {}],
  ['Process', { isComposing: true }],
  ['Dead', { keyCode: 229 }],
  ['', { isComposing: true }],
] as const)(
  'pane navigation and sidebar movement handle %s and stale editor event targets',
  async (pressed, signal) => {
    await navigation();
    const editor = host.querySelector('textarea')!;
    expect(
      (await dispatch(editor, 'Process', { code: 'KeyH', ctrlKey: true, keyCode: 229 })).defaultPrevented,
    ).toBe(true);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Note');
    expect((await dispatch(editor, pressed, { code: 'KeyJ', ...signal })).defaultPrevented).toBe(true);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Database');
    await dispatch(editor, pressed, { code: 'KeyJ', ...signal });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Database');
    expect((await dispatch(editor, 'ㅏ', { code: 'KeyK', shiftKey: true })).defaultPrevented).toBe(false);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Database');
    await dispatch(editor, 'ㅏ', { code: 'KeyK' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Note');
  },
);

test('right sidebar navigation selects only incoming and outgoing links', async () => {
  await navigation();
  const editor = host.querySelector('textarea')!;
  await dispatch(editor, 'ㅣ', { code: 'KeyL', ctrlKey: true });
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Incoming');
  await dispatch(document.activeElement as HTMLElement, 'Process', { code: 'KeyJ', isComposing: true });
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Outgoing');
  await dispatch(document.activeElement as HTMLElement, 'ㅏ', { code: 'KeyK' });
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Incoming');
});

test('IME text and inline rename keep their keys while only explicit pane navigation interrupts composition', async () => {
  await navigation();
  const editor = host.querySelector('textarea')!;
  for (const [key, code, options] of [
    [' ', 'Space', {}],
    ['Process', 'KeyJ', { isComposing: true }],
    ['ㅣ', 'KeyL', { metaKey: true, keyCode: 229 }],
  ] as const) {
    expect((await dispatch(editor, key, { code, ...options })).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(editor);
  }
  expect(cycleTask).not.toHaveBeenCalled();
  const rename = host.querySelector<HTMLInputElement>('input')!;
  rename.focus();
  expect(
    (await dispatch(rename, 'Process', { code: 'KeyL', ctrlKey: true, isComposing: true })).defaultPrevented,
  ).toBe(false);
  expect(document.activeElement).toBe(rename);
  expect(host.querySelector('output')?.textContent).toBe('idle');
});

test('left and right sidebars return to the remembered main input', async () => {
  await navigation();
  const editor = host.querySelector('textarea')!;
  await dispatch(editor, 'h', { ctrlKey: true });
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Note');
  await dispatch(document.activeElement as HTMLElement, 'l', { ctrlKey: true });
  expect(document.activeElement).toBe(editor);
  await dispatch(editor, 'l', { ctrlKey: true });
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Incoming');
  await dispatch(document.activeElement as HTMLElement, 'h', { ctrlKey: true });
  expect(document.activeElement).toBe(editor);
});

test.each([
  ['k', 'KeyK', {}],
  ['ㅏ', 'KeyK', {}],
  ['Process', 'KeyK', { isComposing: true, keyCode: 229 }],
  ['j', 'KeyJ', {}],
] as const)('Ctrl+%s keeps focus in the editor rather than its toolbar', async (key, code, signal) => {
  await navigation();
  const editor = host.querySelector('textarea')!;
  expect((await dispatch(editor, key, { code, ctrlKey: true, ...signal })).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(editor);
  expect(onError).not.toHaveBeenCalled();
});

test.each([' ', ','])(
  'Leader %j remains pending after a minute and executes one custom sequence',
  async (leader) => {
    await navigation({ leader, keybindings: { 'note.task.cycle': [{ keys: 'rn', leader: true }] } });
    const note = host.querySelector<HTMLElement>('[aria-label="Note"]')!;
    note.focus();
    vi.useFakeTimers();
    expect((await dispatch(note, leader)).defaultPrevented).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(host.querySelector('output')?.textContent).toBe('leader');
    await dispatch(note, 'ㄱ', { code: 'KeyR' });
    await dispatch(note, 'Process', { code: 'KeyN', keyCode: 229 });
    expect(cycleTask).toHaveBeenCalledOnce();
    expect(host.querySelector('output')?.textContent).toBe('idle');
    await dispatch(note, leader);
    await dispatch(note, 'Escape');
    await dispatch(note, 'r');
    await dispatch(note, 'n');
    expect(cycleTask).toHaveBeenCalledOnce();
  },
);

test('a custom uppercase pane binding distinguishes Shift with Korean physical keys', async () => {
  await navigation({ keybindings: { 'focus.left': [{ keys: 'Ctrl+H', leader: false }] } });
  const editor = host.querySelector('textarea')!;
  expect((await dispatch(editor, 'ㅗ', { code: 'KeyH', ctrlKey: true })).defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(editor);
  expect(
    (await dispatch(editor, 'Process', { code: 'KeyH', ctrlKey: true, shiftKey: true, keyCode: 229 }))
      .defaultPrevented,
  ).toBe(true);
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Note');
});
