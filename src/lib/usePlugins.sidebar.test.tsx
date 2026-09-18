// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call } from './api';
import { usePlugins } from './usePlugins';
import { PluginSidebarViews } from '../components/PluginSidebarViews';
import type { Workspace } from './types';
import type { EditorHandle } from '../components/Editor';
import type { PluginEvent, PluginResponse } from './pluginTypes';

vi.mock('./api', () => ({ call: vi.fn() }));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let workspace: Workspace;
let noteId: string | null;
let plugins: ReturnType<typeof usePlugins>;
const refresh = vi.fn(async () => {});
const openNote = vi.fn(async () => {});
const openView = vi.fn();
const openSidebar = vi.fn();
const onError = vi.fn();
const notify = vi.fn();
function fixture(path = '/temporary/sidebar'): Workspace {
  return {
    path,
    vault: { id: path },
    notes: [],
    databases: [],
    records: [],
    links: [],
    settings: {},
    extensions: [
      {
        id: 'calendar',
        name: 'Calendar',
        runtime: {
          permissions: ['ui'],
          settingsView: 'settings',
          events: ['workspace.changed'],
          views: [
            { id: 'month', title: '달력', placement: 'right-sidebar' },
            { id: 'settings', title: '설정' },
            { id: 'main', title: '화면', placement: 'main' },
          ],
        },
        commands: [{ id: 'next', title: '다음 달', action: { type: 'script' } }],
      },
    ],
    pluginStates: [{ id: 'calendar', digest: 'calendar-1', enabled: true, dataRevision: 'data-1' }],
  } as unknown as Workspace;
}
function response(state: Record<string, unknown>, event: PluginEvent, label = ''): PluginResponse {
  return {
    state: {
      ...state,
      loaded: true,
      month:
        event.type === 'action' || event.type === 'command'
          ? Number(state.month ?? 0) + 1
          : (state.month ?? 0),
    },
    changed: false,
    effects: event.type === 'command' ? [{ type: 'openView', args: { id: 'month' } }] : [],
    result: null,
    view: {
      type: 'stack',
      children: [
        { type: 'text', text: `${label}month ${state.month ?? 0}` },
        { type: 'button', text: '다음 달', action: 'next' },
      ],
    },
  };
}
function Harness() {
  const editor = useRef<EditorHandle>(null);
  plugins = usePlugins({
    workspace,
    visible: false,
    editor,
    noteId,
    save: async () => true,
    refresh,
    openNote,
    openView,
    openSidebar,
    onError,
    notify,
  });
  return (
    <PluginSidebarViews
      views={plugins.sidebarViews}
      revision={plugins.sidebarRevision}
      invoke={plugins.invokeSidebar}
      errors={plugins.errors}
    />
  );
}
const render = () => act(async () => root.render(<Harness />));
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.clearAllMocks();
  workspace = fixture();
  noteId = null;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(call).mockImplementation(async (_path, _command, args) => {
    const { state, event } = args as { state: Record<string, unknown>; event: PluginEvent };
    if (event.type !== 'load') expect(state.loaded).toBe(true);
    return response(state, event);
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

test('sidebar shares one session with commands/settings and retains its mounted view across note/data changes', async () => {
  await render();
  expect(host.textContent).toContain('month 0');
  expect(plugins.sidebarViews.map((view) => view.id)).toEqual(['month']);
  const section = host.querySelector('[data-plugin-sidebar-view]');
  const events = () =>
    vi.mocked(call).mock.calls.map(([, , args]) => (args as { event: PluginEvent }).event.type);
  expect(events()[0]).toBe('load');
  expect(openSidebar).not.toHaveBeenCalled();
  await act(async () => host.querySelector('button')!.click());
  expect(host.textContent).toContain('month 1');
  await act(async () => plugins.commands[0].run());
  expect(host.textContent).toContain('month 2');
  expect(openSidebar).toHaveBeenCalledTimes(1);
  expect(openView).not.toHaveBeenCalled();
  await act(async () => {
    await plugins.invokeSettings('calendar', { type: 'action', id: 'settings', action: { id: 'change' } });
  });
  expect(host.textContent).toContain('month 3');
  workspace = {
    ...workspace,
    notes: [{ id: 'new', title: 'New', updatedAt: 'today' }] as Workspace['notes'],
    settings: { ...workspace.settings, vim: true },
  };
  noteId = 'new';
  await render();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(125);
  });
  expect(host.textContent).toContain('month 3');
  expect(host.querySelector('[data-plugin-sidebar-view]')).toBe(section);
  expect(events().filter((event) => event === 'load')).toHaveLength(1);
  expect(openView).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});

test('sidebar invocation accepts only an enabled declared right-sidebar view with UI permission', async () => {
  await render();
  for (const id of ['settings', 'main', 'missing']) {
    const count = vi.mocked(call).mock.calls.length;
    expect(await plugins.invokeSidebar('calendar', { type: 'render', id })).toBeNull();
    expect(vi.mocked(call).mock.calls).toHaveLength(count);
  }
  workspace = {
    ...workspace,
    extensions: workspace.extensions.map((extension) => ({
      ...extension,
      runtime: { ...extension.runtime!, permissions: [] },
    })),
  };
  await render();
  expect(plugins.sidebarViews).toEqual([]);
  expect(await plugins.invokeSidebar('calendar', { type: 'render', id: 'month' })).toBeNull();
  workspace = fixture();
  workspace.pluginStates![0].enabled = false;
  await render();
  expect(plugins.sidebarViews).toEqual([]);
  expect(
    await plugins.invokeSidebar('calendar', { type: 'action', id: 'month', action: { id: 'next' } }),
  ).toBeNull();
});

test.each(['vault', 'digest', 'disable', 'uninstall'] as const)(
  'late sidebar responses cannot escape the previous %s lifetime',
  async (change) => {
    let finish: ((response: PluginResponse) => void) | undefined;
    let captured: { state: Record<string, unknown>; event: PluginEvent } | undefined;
    vi.mocked(call).mockImplementation(async (path, _command, args) => {
      const request = args as { state: Record<string, unknown>; event: PluginEvent; digest: string };
      if (
        request.event.type === 'render' &&
        path === '/temporary/sidebar' &&
        request.digest === 'calendar-1'
      ) {
        captured = request;
        return new Promise<PluginResponse>((resolve) => {
          finish = resolve;
        });
      }
      return response(request.state, request.event, 'current ');
    });
    await render();
    expect(finish).toBeDefined();
    if (change === 'vault') workspace = fixture('/temporary/other');
    else if (change === 'digest')
      workspace = { ...workspace, pluginStates: [{ ...workspace.pluginStates![0], digest: 'calendar-2' }] };
    else if (change === 'disable')
      workspace = { ...workspace, pluginStates: [{ ...workspace.pluginStates![0], enabled: false }] };
    else workspace = { ...workspace, extensions: [], pluginStates: [] };
    await render();
    await act(async () =>
      finish!({
        ...response(captured!.state, captured!.event, 'STALE '),
        changed: true,
        effects: [
          { type: 'notify', args: { message: 'STALE' } },
          { type: 'openNote', args: { id: 'old-note' } },
        ],
      }),
    );
    expect(host.textContent).not.toContain('STALE');
    expect(refresh).not.toHaveBeenCalled();
    expect(openNote).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    if (change === 'vault' || change === 'digest') expect(host.textContent).toContain('current month 0');
    else expect(host.querySelector('[data-plugin-sidebar-view]')).toBeNull();
  },
);

test('failed sidebar isolates its error while another plugin remains interactive', async () => {
  const healthy = fixture().extensions[0];
  workspace = {
    ...workspace,
    extensions: [...workspace.extensions, { ...healthy, id: 'healthy' }],
    pluginStates: [...workspace.pluginStates!, { id: 'healthy', digest: 'healthy-1', enabled: true }],
  };
  vi.mocked(call).mockImplementation(async (_path, _command, args) => {
    const { id, state, event } = args as { id: string; state: Record<string, unknown>; event: PluginEvent };
    if (id === 'calendar' && event.type === 'render') throw new Error('Calendar failed');
    return response(state, event, 'healthy ');
  });
  await render();
  expect(host.querySelector('[role=alert]')).toBeNull();
  expect(host.textContent).not.toContain('Calendar failed');
  expect(host.textContent).toContain('healthy month 0');
  await act(async () => host.querySelector('button')!.click());
  expect(host.textContent).toContain('healthy month 1');
  expect(onError).toHaveBeenCalledTimes(1);
});

test.each(['action', 'render'] as const)(
  'a sidebar %s failure retains the calendar, disables controls, and reports only once',
  async (failure) => {
    let fail = false;
    vi.mocked(call).mockImplementation(async (_path, _command, args) => {
      const { state, event } = args as { state: Record<string, unknown>; event: PluginEvent };
      if (fail && event.type === failure) throw new Error('Calendar stopped');
      return {
        ...response(state, event),
        view: {
          type: 'calendar',
          month: '2026-09',
          today: '2026-09-18',
          markedDates: ['2026-09-18'],
          action: 'open',
          previousAction: 'previous',
          nextAction: 'next',
          todayAction: 'today',
        },
      };
    });
    await render();
    const calendar = host.querySelector('[data-plugin-calendar]');
    const day = host.querySelector<HTMLButtonElement>('[data-calendar-date="2026-09-18"]')!;
    const text = calendar!.textContent;
    expect(day.disabled).toBe(false);
    fail = true;
    if (failure === 'action') await act(async () => day.click());
    else {
      noteId = 'other-note';
      await render();
    }
    expect(host.querySelector('[data-plugin-calendar]')).toBe(calendar);
    expect(calendar!.textContent).toBe(text);
    expect(host.querySelector('[role=alert]')).toBeNull();
    expect(host.querySelector('.plugin-error')).toBeNull();
    expect([...host.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    const calls = vi.mocked(call).mock.calls.length;
    await act(async () => day.click());
    workspace = { ...workspace, settings: { ...workspace.settings, vim: true } };
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(125));
    expect(vi.mocked(call)).toHaveBeenCalledTimes(calls);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-plugin-calendar]')).toBe(calendar);
  },
);
