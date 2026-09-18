// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call } from './api';
import { usePlugins } from './usePlugins';
import type { Workspace } from './types';
import type { EditorHandle } from '../components/Editor';
import type { PluginEvent, PluginResponse } from './pluginTypes';
vi.mock('./api', () => ({ call: vi.fn() }));
let host: HTMLDivElement, root: Root, api: ReturnType<typeof usePlugins>;
let finish: (value: unknown) => void;
const onError = vi.fn();
const effects: PluginResponse['effects'] = [{ type: 'git', args: { action: 'sync', params: {} } }];
let passive = false;
function Harness() {
  const editor = useRef<EditorHandle>(null);
  api = usePlugins({
    workspace: {
      path: '/disposable',
      extensions: [
        {
          id: 'git-sync',
          name: 'Git',
          commands: [{ id: 'sync', title: 'Sync', action: { type: 'script' } }],
          runtime: {
            permissions: ['git.sync', 'ui'],
            settingsView: 'sync',
            views: [{ id: 'sync', title: 'Sync' }],
          },
        },
      ],
      pluginStates: [{ id: 'git-sync', digest: 'digest', enabled: true }],
    } as Workspace,
    editor,
    noteId: null,
    visible: false,
    save: async () => true,
    refresh: async () => {},
    openNote: async () => {},
    openView: () => {},
    onError,
    notify: () => {},
  });
  return null;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  onError.mockReset();
  passive = false;
  vi.mocked(call)
    .mockReset()
    .mockImplementation(async (_path, command, args) => {
      if (command === 'git.sync')
        return new Promise((resolve) => {
          finish = resolve;
        });
      if (command === 'extension.invoke') {
        const { event } = args as { event: PluginEvent };
        return {
          state: {},
          result: null,
          changed: false,
          view: { type: 'text', text: 'Session responds' },
          effects: event.type === 'command' || passive ? effects : [],
        };
      }
      return { phase: 'running' };
    });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

test('Git command resolves and same session renders while long Git request is still pending', async () => {
  await act(async () => {
    await api.commands[0].run();
  });
  expect(call).toHaveBeenCalledWith('/disposable', 'git.sync', {
    automatic: false,
    pluginId: 'git-sync',
    pluginDigest: 'digest',
  });
  let rendered: PluginResponse | null = null;
  await act(async () => {
    rendered = await api.invokeSettings('git-sync', { type: 'render', id: 'sync' });
  });
  expect((rendered as PluginResponse | null)?.view?.text).toBe('Session responds');
  expect(api.errors).toEqual({});
  await act(async () => finish({ phase: 'error', message: 'Network unavailable' }));
  await act(async () => {
    rendered = await api.invokeSettings('git-sync', { type: 'render', id: 'sync' });
  });
  expect(api.errors).toEqual({});
  expect(onError).not.toHaveBeenCalled();
});

test('passive render cannot launch a Git effect even if a response incorrectly supplies one', async () => {
  passive = true;
  await act(async () => {
    await api.invokeSettings('git-sync', { type: 'render', id: 'sync' });
  });
  expect(vi.mocked(call).mock.calls.filter(([, command]) => command.startsWith('git.'))).toEqual([]);
});
