// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { SettingsView } from './SettingsView';
import { usePlugins } from '../lib/usePlugins';
import { call } from '../lib/api';
import { extensionCatalog } from '../lib/extensionCatalog';
import type { Workspace } from '../lib/types';
import type { PluginEvent, PluginResponse } from '../lib/pluginTypes';
import type { EditorHandle } from './Editor';

vi.mock('../lib/api', () => ({ call: vi.fn() }));

test.each([true, false])(
  'an old update cannot stop a copied vault session when settings active=%s',
  async (keepSettingsOpen) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    vi.clearAllMocks();
    const latest = extensionCatalog.find((extension) => extension.id === 'anki')!;
    let workspace: Workspace = {
      path: '/temporary/original',
      vault: { id: 'same-vault-uuid', name: 'Copied vault', formatVersion: 1 },
      extensions: [{ ...latest, version: '1.1.0' }],
      pluginStates: [{ id: 'anki', enabled: true, digest: 'original-digest' }],
      notes: [],
      folders: [],
      trash: [],
      databases: [],
      records: [],
      links: [],
      settings: {
        leader: ' ',
        theme: 'paper-pine',
        keybindings: {},
        vim: false,
        slash: true,
        showUnresolvedLinks: true,
        editorMode: 'live',
        lineNumbers: 'none',
        editorFontFamily: '',
        databaseFontFamily: '',
        databaseFontSize: 14,
        cursorShape: 'bar',
        cursorBlink: 'steady',
        cursorBlinkRate: 600,
        cursorAnimation: 'none',
        cursorFollowVim: true,
        topicFolders: { include: [], exclude: [] },
      },
    };
    let active = true;
    let plugins: ReturnType<typeof usePlugins>;
    let finish!: () => void;
    const refresh = vi.fn(async () => {});
    const onError = vi.fn();
    const stop = vi.fn(async (id: string) => plugins.stop(id));
    vi.mocked(call).mockImplementation(async (path, command, args) => {
      if (command === 'extension.update')
        return new Promise((resolve) => {
          finish = () => resolve(latest);
        });
      if (command === 'extension.invoke') {
        const { state, event } = args as { state: Record<string, unknown>; event: PluginEvent };
        if (event.type !== 'load') expect(state.loaded).toBe(true);
        return {
          state: { ...state, loaded: true },
          view: { type: 'text', text: `${path} active` },
          changed: false,
          effects: [],
          result: null,
        } satisfies PluginResponse;
      }
      throw new Error(`Unexpected command ${command}`);
    });
    function Harness() {
      const editor = useRef<EditorHandle>(null);
      plugins = usePlugins({
        workspace,
        visible: false,
        editor,
        noteId: null,
        save: async () => true,
        refresh,
        openNote: async () => {},
        openView: () => {},
        onError,
        notify: () => {},
      });
      return (
        <SettingsView
          active={active}
          group="extensions"
          workspace={workspace}
          commands={[]}
          update={async () => true}
          refresh={refresh}
          onError={onError}
          beforeDisablePlugin={stop}
          invokePluginSettings={plugins.invokeSettings}
          pluginErrors={plugins.errors}
        />
      );
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<Harness />));
      await act(async () =>
        host.querySelector<HTMLButtonElement>('[aria-label="Anki 연결 업데이트"]')!.click(),
      );
      expect(finish).toBeDefined();
      if (!keepSettingsOpen) {
        active = false;
        await act(async () => root.render(<Harness />));
      }
      workspace = {
        ...workspace,
        path: '/temporary/copied',
        pluginStates: [{ id: 'anki', enabled: true, digest: 'copied-digest' }],
      };
      await act(async () => root.render(<Harness />));
      await act(async () => finish());
      expect(stop).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      let rendered: PluginResponse | null = null;
      await act(async () => {
        rendered = await plugins.invokeSettings('anki', { type: 'render', id: 'settings' });
      });
      expect(rendered).toMatchObject({ view: { text: '/temporary/copied active' } });
      expect(
        vi
          .mocked(call)
          .mock.calls.filter(
            ([path, command, args]) =>
              path === '/temporary/copied' &&
              command === 'extension.invoke' &&
              (args as { event: PluginEvent }).event.type === 'unload',
          ),
      ).toHaveLength(0);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.useRealTimers();
    }
  },
);
