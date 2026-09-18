// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import manifest from '../../examples/plugins/daily-calendar.json';
import { call } from './api';
import { usePlugins } from './usePlugins';
import { useCommandKeys } from './useCommandKeys';
import { bindingsFor } from './commands';
import type { EditorHandle } from '../components/Editor';
import type { PluginEvent } from './pluginTypes';
import type { Workspace, Settings } from './types';

vi.mock('./api', () => ({ call: vi.fn() }));
const id = 'plugin.daily-calendar.open-today';
let workspace: Workspace;
let root: Root;
let host: HTMLDivElement;
let plugins: ReturnType<typeof usePlugins>;
const save = vi.fn(async () => true);
const refresh = vi.fn(async () => {});
const openNote = vi.fn(async () => {});
const onError = vi.fn();
function Harness() {
  const editor = useRef<EditorHandle>(null);
  plugins = usePlugins({
    workspace,
    visible: false,
    editor,
    noteId: null,
    save,
    refresh,
    openNote,
    openView() {},
    onError,
    notify() {},
  });
  useCommandKeys(plugins.commands, workspace.settings, 'NORMAL', false, onError);
  return <button>Workspace</button>;
}
const render = () => act(async () => root.render(<Harness />));
async function press(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  await act(async () => host.querySelector('button')!.dispatchEvent(event));
  return event;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
  save.mockResolvedValue(true);
  workspace = {
    path: '/temporary/daily-shortcuts',
    extensions: [manifest],
    pluginStates: [{ id: manifest.id, enabled: true, digest: 'v1' }],
    settings: { vim: true, leader: ' ', keybindings: {} },
  } as unknown as Workspace;
  vi.mocked(call).mockImplementation(async (_path, _command, raw) => {
    const { event } = raw as { event: PluginEvent };
    return {
      state: {},
      result: null,
      view: null,
      changed: event.type === 'command',
      effects: event.type === 'command' ? [{ type: 'openNote', args: { id: 'today-id' } }] : [],
    };
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await render();
  host.querySelector('button')!.focus();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

test('default regular and leader bindings invoke the same saved plugin command', async () => {
  const command = plugins.commands.find((command) => command.id === id)!;
  expect(bindingsFor(command, workspace.settings)).toEqual(
    manifest.commands.find((command) => command.id === 'open-today')!.bindings,
  );
  expect((await press('D', { code: 'KeyD', metaKey: true, shiftKey: true })).defaultPrevented).toBe(true);
  await press(' ');
  await press('n', { code: 'KeyN' });
  await press('d', { code: 'KeyD' });
  expect(save).toHaveBeenCalledTimes(2);
  expect(openNote).toHaveBeenCalledTimes(2);
  expect(openNote).toHaveBeenCalledWith('today-id');
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(
    vi
      .mocked(call)
      .mock.calls.map(([, , raw]) => (raw as { event: PluginEvent }).event)
      .filter((event) => event.type === 'command'),
  ).toEqual([
    { type: 'command', id: 'open-today' },
    { type: 'command', id: 'open-today' },
  ]);
  expect(onError).not.toHaveBeenCalled();
});

test('custom bindings and explicit disabling survive plugin reactivation without rewriting settings', async () => {
  const settings = {
    ...workspace.settings,
    keybindings: { [id]: [{ keys: 'Mod+y', leader: false }] },
  } as Settings;
  workspace = { ...workspace, settings };
  await render();
  expect((await press('D', { code: 'KeyD', metaKey: true, shiftKey: true })).defaultPrevented).toBe(false);
  await press('y', { metaKey: true });
  expect(openNote).toHaveBeenCalledOnce();
  workspace = { ...workspace, settings: { ...settings, keybindings: { [id]: [] } } };
  await render();
  workspace = { ...workspace, pluginStates: [] };
  await render();
  workspace = { ...workspace, pluginStates: [{ id: manifest.id, enabled: true, digest: 'v1' }] };
  await render();
  expect(
    bindingsFor(
      plugins.commands.find((command) => command.id === id)!,
      workspace.settings,
    ),
  ).toEqual([]);
  expect((await press('y', { metaKey: true })).defaultPrevented).toBe(false);
  expect((await press('D', { code: 'KeyD', metaKey: true, shiftKey: true })).defaultPrevented).toBe(false);
  expect(openNote).toHaveBeenCalledOnce();
  expect(workspace.settings.keybindings[id]).toEqual([]);
});

test('disabled extensions and failed draft saves cannot create or open a daily note', async () => {
  save.mockResolvedValue(false);
  await press('D', { metaKey: true, shiftKey: true });
  expect(openNote).not.toHaveBeenCalled();
  expect(
    vi.mocked(call).mock.calls.some(([, , raw]) => (raw as { event: PluginEvent }).event.type === 'command'),
  ).toBe(false);
  workspace = { ...workspace, pluginStates: [] };
  await render();
  expect(plugins.commands).toEqual([]);
  expect((await press('D', { metaKey: true, shiftKey: true })).defaultPrevented).toBe(false);
});
