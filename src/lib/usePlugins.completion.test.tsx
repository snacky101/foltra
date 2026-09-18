// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call } from './api';
import { usePlugins } from './usePlugins';
import type { Workspace } from './types';
import type { EditorHandle } from '../components/Editor';
import type { PluginCompletionItem, PluginEvent, PluginResponse } from './pluginTypes';

vi.mock('./api', () => ({ call: vi.fn() }));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let workspace: Workspace;
let plugins: ReturnType<typeof usePlugins>;
let mounted: boolean;
const save = vi.fn(async () => true);
const refresh = vi.fn(async () => {});
const openNote = vi.fn(async () => {});
const openView = vi.fn();
const onError = vi.fn();
const notify = vi.fn();
const pluginSnapshot = vi.fn(() => ({
  noteId: 'editing',
  body: 'Private draft',
  from: 3,
  to: 3,
  selection: '',
}));
const applyPluginEdit = vi.fn();
const items = [{ label: 'Today', insertText: '2026-09-18', detail: '오늘' }];
type Request = { id: string; digest: string; state: Record<string, unknown>; event: PluginEvent };

function fixture(path = '/temporary/completion'): Workspace {
  return {
    path,
    vault: { id: 'same-vault-id' },
    notes: [],
    databases: [],
    records: [],
    links: [],
    settings: {},
    extensions: [
      {
        id: 'dates',
        name: 'Dates',
        commands: [],
        runtime: { permissions: ['editor.write'], completions: [{ id: 'dates', trigger: '@' }] },
      },
    ],
    pluginStates: [{ id: 'dates', digest: 'dates-1', enabled: true }],
  } as unknown as Workspace;
}

function response(request: Request): PluginResponse {
  return {
    state: { ...request.state, loaded: true, requests: Number(request.state.requests ?? 0) + 1 },
    changed: false,
    effects: [],
    view: null,
    result: request.event.type === 'completion' ? items : null,
  };
}

function Harness() {
  const editor = useRef({ pluginSnapshot, applyPluginEdit } as unknown as EditorHandle);
  plugins = usePlugins({
    workspace,
    visible: false,
    editor,
    noteId: 'editing',
    save,
    refresh,
    openNote,
    openView,
    onError,
    notify,
  });
  return null;
}

const render = () => act(async () => root.render(<Harness />));
const completionRequests = () =>
  vi.mocked(call).mock.calls.filter(([, , args]) => (args as Request).event.type === 'completion');
function expectNoEditorOrUiEffects() {
  for (const effect of [save, refresh, openNote, openView, notify, applyPluginEdit])
    expect(effect).not.toHaveBeenCalled();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.clearAllMocks();
  workspace = fixture();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  mounted = true;
  vi.mocked(call).mockImplementation(async (_path, _command, args) => response(args as Request));
});
afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

test('completions share loaded session state but do not capture or save the editor or execute response effects', async () => {
  await render();
  pluginSnapshot.mockClear();
  const sidebarRevision = plugins.sidebarRevision;
  vi.mocked(call).mockImplementation(async (_path, _command, raw) => {
    const request = raw as Request;
    expect(request.state.loaded).toBe(true);
    expect(raw).not.toHaveProperty('editor');
    return {
      ...response(request),
      changed: true,
      effects: [
        { type: 'notify', args: { message: 'Must not appear' } },
        { type: 'openNote', args: { id: 'must-not-open' } },
        { type: 'editor.replaceSelection', args: { text: 'must-not-insert' } },
      ],
    };
  });
  await act(async () => expect(await plugins.complete('dates', 'dates', 'to')).toEqual(items));
  const [[path, command, request]] = completionRequests();
  expect(path).toBe(workspace.path);
  expect(command).toBe('extension.invoke');
  expect(request).toMatchObject({
    id: 'dates',
    digest: 'dates-1',
    event: { type: 'completion', id: 'dates', args: { query: 'to' } },
  });
  expect(pluginSnapshot).not.toHaveBeenCalled();
  expectNoEditorOrUiEffects();
  expect(plugins.sidebarRevision).toBe(sidebarRevision);
});

test('completion requests use the session queue and preserve state between requests', async () => {
  await render();
  let finish: ((value: PluginResponse) => void) | undefined;
  let captured: Request | undefined;
  vi.mocked(call).mockImplementation(async (_path, _command, args) => {
    const request = args as Request;
    if (request.event.args?.query === 'first') {
      captured = request;
      return new Promise<PluginResponse>((resolve) => {
        finish = resolve;
      });
    }
    expect(request.state.requests).toBe(2);
    return response(request);
  });
  let first: Promise<PluginCompletionItem[]>;
  let second: Promise<PluginCompletionItem[]>;
  await act(async () => {
    first = plugins.complete('dates', 'dates', 'first');
    second = plugins.complete('dates', 'dates', 'second');
  });
  expect(completionRequests()).toHaveLength(1);
  await act(async () => {
    finish!(response(captured!));
    expect(await first!).toEqual(items);
    expect(await second!).toEqual(items);
  });
  expect(completionRequests()).toHaveLength(2);
  expectNoEditorOrUiEffects();
});

test.each(['missing-plugin', 'missing-provider', 'permissions', 'disable', 'uninstall'] as const)(
  'only an enabled declared provider with editor.write can run: %s',
  async (invalid) => {
    await render();
    if (invalid === 'permissions') workspace.extensions[0].runtime!.permissions = [];
    if (invalid === 'disable') workspace.pluginStates![0].enabled = false;
    if (invalid === 'uninstall') workspace = { ...workspace, extensions: [], pluginStates: [] };
    await render();
    const count = completionRequests().length;
    const result = await plugins.complete(
      invalid === 'missing-plugin' ? 'missing' : 'dates',
      invalid === 'missing-provider' ? 'missing' : 'dates',
      '',
    );
    expect(result).toEqual([]);
    expect(completionRequests()).toHaveLength(count);
    expectNoEditorOrUiEffects();
  },
);

test.each(['vault', 'digest', 'disable', 'uninstall', 'permissions', 'provider'] as const)(
  'late candidates are discarded after %s changes',
  async (change) => {
    let finish: ((value: PluginResponse) => void) | undefined;
    let captured: Request | undefined;
    vi.mocked(call).mockImplementation(async (path, _command, args) => {
      const request = args as Request;
      if (
        request.event.type === 'completion' &&
        path === '/temporary/completion' &&
        request.digest === 'dates-1'
      ) {
        captured = request;
        return new Promise<PluginResponse>((resolve) => {
          finish = resolve;
        });
      }
      return response(request);
    });
    await render();
    let pending: Promise<PluginCompletionItem[]>;
    await act(async () => {
      pending = plugins.complete('dates', 'dates', '');
    });
    expect(finish).toBeDefined();
    if (change === 'vault') workspace = fixture('/temporary/copied-vault');
    else if (change === 'digest')
      workspace = { ...workspace, pluginStates: [{ ...workspace.pluginStates![0], digest: 'dates-2' }] };
    else if (change === 'disable')
      workspace = { ...workspace, pluginStates: [{ ...workspace.pluginStates![0], enabled: false }] };
    else if (change === 'uninstall') workspace = { ...workspace, extensions: [], pluginStates: [] };
    else {
      const runtime = workspace.extensions[0].runtime!;
      workspace = {
        ...workspace,
        extensions: [
          {
            ...workspace.extensions[0],
            runtime: {
              ...runtime,
              ...(change === 'permissions' ? { permissions: [] } : { completions: [] }),
            },
          },
        ],
      };
    }
    await render();
    await act(async () => {
      finish!({
        ...response(captured!),
        changed: true,
        effects: [{ type: 'notify', args: { message: 'STALE' } }],
      });
      expect(await pending!).toEqual([]);
    });
    expectNoEditorOrUiEffects();
    expect(onError).not.toHaveBeenCalled();
    if (change === 'vault' || change === 'digest') {
      await act(async () => expect(await plugins.complete('dates', 'dates', '')).toEqual(items));
    }
  },
);

test('a provider failure is reported once, stops only its session, and clears after reactivation', async () => {
  workspace = {
    ...workspace,
    extensions: [...workspace.extensions, { ...workspace.extensions[0], id: 'healthy' }],
    pluginStates: [...workspace.pluginStates!, { id: 'healthy', digest: 'healthy-1', enabled: true }],
  };
  let fail = true;
  vi.mocked(call).mockImplementation(async (_path, _command, args) => {
    const request = args as Request;
    if (fail && request.id === 'dates' && request.event.type === 'completion')
      throw new Error('Completion failed');
    return response(request);
  });
  await render();
  await act(async () => expect(await plugins.complete('dates', 'dates', '')).toEqual([]));
  expect(plugins.errors.dates).toBe('Completion failed');
  expect(onError).toHaveBeenCalledTimes(1);
  const count = completionRequests().length;
  expect(await plugins.complete('dates', 'dates', '')).toEqual([]);
  expect(completionRequests()).toHaveLength(count);
  await act(async () => expect(await plugins.complete('healthy', 'dates', '')).toEqual(items));
  expectNoEditorOrUiEffects();
  workspace = {
    ...workspace,
    pluginStates: workspace.pluginStates!.map((status) => ({ ...status, enabled: status.id !== 'dates' })),
  };
  await render();
  fail = false;
  workspace = {
    ...workspace,
    pluginStates: workspace.pluginStates!.map((status) => ({ ...status, enabled: true })),
  };
  await render();
  expect(plugins.errors.dates).toBeUndefined();
  await act(async () => expect(await plugins.complete('dates', 'dates', '')).toEqual(items));
  expect(onError).toHaveBeenCalledTimes(1);
});

test('unmount cancels a pending completion without effects or error callbacks', async () => {
  await render();
  let reject: ((error: Error) => void) | undefined;
  vi.mocked(call).mockImplementation(async (_path, _command, args) => {
    if ((args as Request).event.type === 'completion')
      return new Promise((_resolve, fail) => {
        reject = fail;
      });
    return response(args as Request);
  });
  let pending: Promise<PluginCompletionItem[]>;
  await act(async () => {
    pending = plugins.complete('dates', 'dates', '');
  });
  await act(async () => root.unmount());
  mounted = false;
  await act(async () => {
    reject!(new Error('Late failure'));
    expect(await pending!).toEqual([]);
  });
  expect(onError).not.toHaveBeenCalled();
  expectNoEditorOrUiEffects();
});

test('queued requests report a stopped provider only once', async () => {
  await render();
  let reject: ((error: Error) => void) | undefined;
  vi.mocked(call).mockImplementation(async (_path, _command, args) => {
    if ((args as Request).event.type === 'completion')
      return new Promise((_resolve, fail) => {
        reject = fail;
      });
    return response(args as Request);
  });
  let first: Promise<PluginCompletionItem[]>;
  let second: Promise<PluginCompletionItem[]>;
  await act(async () => {
    first = plugins.complete('dates', 'dates', 't');
    second = plugins.complete('dates', 'dates', 'to');
  });
  await act(async () => {
    reject!(new Error('Provider stopped'));
    expect(await first!).toEqual([]);
    expect(await second!).toEqual([]);
  });
  expect(completionRequests()).toHaveLength(1);
  expect(onError).toHaveBeenCalledTimes(1);
  expectNoEditorOrUiEffects();
});
