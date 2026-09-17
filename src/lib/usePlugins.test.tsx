// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { call } from './api';
import { usePlugins } from './usePlugins';
import { PluginSettingsView } from '../components/PluginSettingsView';
import type { Workspace } from './types';
import type { EditorHandle } from '../components/Editor';

vi.mock('./api', () => ({ call: vi.fn() }));
test.each([
  { id: 'custom', version: '1.0.0', settingsView: 'preferences', view: 'preferences' },
  { id: 'anki', version: '1.0.0', settingsView: undefined, view: 'sync' },
])('$id settings mount immediately after activation and share lifecycle session state', async (extension) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let enabled = false;
  const calls: string[] = [];
  vi.mocked(call).mockImplementation(async (_path, _command, raw) => {
    const { event, state } = raw as any;
    calls.push(event.type);
    if (event.type === 'render' || event.type === 'action') expect(state.loaded).toBe(true);
    return {
      state: { ...state, loaded: true, saved: event.type === 'action' || state.saved },
      changed: false,
      effects: [],
      result: null,
      view: {
        type: 'stack',
        children: [
          { type: 'text', text: state.saved ? '저장 완료' : '설정 준비' },
          { type: 'button', text: '저장', action: 'save' },
        ],
      },
    };
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  function Harness() {
    const editor = useRef<EditorHandle>(null);
    const workspace = {
      path: '/temporary',
      extensions: [
        {
          id: extension.id,
          version: extension.version,
          runtime: {
            permissions: ['ui'],
            settingsView: extension.settingsView,
            views: [{ id: extension.view, title: '설정' }],
          },
        },
      ],
      pluginStates: [{ id: extension.id, enabled, digest: 'digest' }],
    } as Workspace;
    const plugins = usePlugins({
      workspace,
      visible: false,
      editor,
      noteId: null,
      save: async () => true,
      refresh: async () => {},
      openNote: async () => {},
      openView: () => {},
      onError: () => {},
      notify: () => {},
    });
    return enabled ? (
      <PluginSettingsView
        pluginId={extension.id}
        viewId={extension.view}
        revision="r1"
        invoke={plugins.invokeSettings}
      />
    ) : null;
  }
  try {
    await act(async () => root.render(<Harness />));
    enabled = true;
    await act(async () => root.render(<Harness />));
    expect(calls.slice(0, 2)).toEqual(['load', 'render']);
    expect(host.textContent).toContain('설정 준비');
    await act(async () => host.querySelector('button')!.click());
    expect(host.textContent).toContain('저장 완료');
    expect(calls).toContain('action');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
