import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { EditorHandle } from '../components/Editor';
import type { Workspace } from './types';
import type { Command } from './commands';
import type {
  PluginCompletionInvoke,
  PluginCompletionItem,
  PluginEvent,
  PluginNode,
  PluginSettingsInvoke,
} from './pluginTypes';
import { PluginSession } from './pluginSession';
import { pluginSettingsView } from './pluginSettings';

interface Options {
  visible: boolean;
  workspace: Workspace | null;
  editor: RefObject<EditorHandle | null>;
  noteId: string | null;
  save: () => Promise<boolean>;
  refresh: () => Promise<void>;
  openNote: (id: string) => Promise<void>;
  openView: () => void;
  openSidebar?: () => void;
  onError: (error: unknown) => void;
  notify: (message: string) => void;
}
export interface PluginSidebarView {
  pluginId: string;
  id: string;
  title: string;
  key: string;
}
export function usePlugins(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const sessions = useRef(new Map<string, PluginSession>());
  const completionErrors = useRef(new WeakSet<PluginSession>());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [active, setActive] = useState<{ pluginId: string; id: string; title: string } | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [tree, setTree] = useState<PluginNode | null>(null);
  const [busy, setBusy] = useState(false);
  const [sidebarVersion, setSidebarVersion] = useState(0);
  const viewRequest = useRef(0);
  const enabled = (options.workspace?.pluginStates ?? []).filter((s) => s.enabled);
  const signature = JSON.stringify(enabled);
  const activationSignature = JSON.stringify(enabled.map((s) => [s.id, s.digest]));
  const path = options.workspace?.path;
  const alive = (id: string, session: PluginSession) => sessions.current.get(id) === session;
  const invoke = async (id: string, event: PluginEvent) => {
    const session = sessions.current.get(id);
    if (!session) return null;
    const editor = latest.current.editor.current?.pluginSnapshot() ?? null;
    try {
      const response = await session.invoke(event, editor);
      if (!response || !alive(id, session)) return null;
      if (response.changed) await latest.current.refresh();
      if (!alive(id, session)) return null;
      for (const effect of response.effects) {
        if (!alive(id, session)) return null;
        if (effect.type === 'notify') latest.current.notify(effect.args.message ?? '');
        if (effect.type === 'openNote') await latest.current.openNote(effect.args.id!);
        if (effect.type === 'openView') {
          const view = latest.current.workspace?.extensions
            .find((e) => e.id === id)
            ?.runtime?.views?.find((v) => v.id === effect.args.id);
          if (view?.placement === 'right-sidebar') latest.current.openSidebar?.();
          else if (view) {
            setTree(null);
            setActive({ pluginId: id, ...view });
            latest.current.openView();
          }
        }
        if (effect.type === 'editor.replaceSelection') {
          if (!editor || !latest.current.editor.current?.applyPluginEdit(editor, effect.args.text!)) {
            throw new Error(
              '편집 내용이나 선택 영역이 바뀌어 플러그인 수정을 적용하지 않았습니다. 다시 실행하세요.',
            );
          }
        }
      }
      if (event.type !== 'render' && alive(id, session)) setSidebarVersion((value) => value + 1);
      return response;
    } catch (error) {
      if (alive(id, session)) {
        setErrors((old) => ({ ...old, [id]: error instanceof Error ? error.message : String(error) }));
        latest.current.onError(error);
        // A failed core call can follow successful atomic writes; refresh their actual state.
        void latest.current.refresh();
      }
      return null;
    }
  };
  const invokeRef = useRef(invoke);
  invokeRef.current = invoke;
  const invokeSettings = useCallback<PluginSettingsInvoke>((id, event) => {
    const extension = latest.current.workspace?.extensions.find((e) => e.id === id);
    const declared = extension && pluginSettingsView(extension);
    if (!declared || event.id !== declared) return Promise.resolve(null);
    return invokeRef.current(id, event);
  }, []);
  const invokeSidebar = useCallback<PluginSettingsInvoke>((id, event) => {
    const workspace = latest.current.workspace;
    const extension = workspace?.extensions.find((item) => item.id === id);
    const status = workspace?.pluginStates?.find((item) => item.id === id && item.enabled);
    const session = sessions.current.get(id);
    if (
      !status ||
      !session ||
      session.error ||
      session.path !== workspace?.path ||
      session.status.digest !== status.digest ||
      !extension?.runtime?.permissions.includes('ui') ||
      !extension.runtime.views?.some((view) => view.id === event.id && view.placement === 'right-sidebar')
    )
      return Promise.resolve(null);
    return invokeRef.current(id, event);
  }, []);
  const complete = useCallback<PluginCompletionInvoke>(async (id, providerId, query) => {
    const session = sessions.current.get(id);
    const current = () => {
      const workspace = latest.current.workspace;
      const extension = workspace?.extensions.find((item) => item.id === id);
      const status = workspace?.pluginStates?.find((item) => item.id === id && item.enabled);
      return (
        session &&
        alive(id, session) &&
        !session.error &&
        session.path === workspace?.path &&
        session.status.digest === status?.digest &&
        extension?.runtime?.permissions.includes('editor.write') &&
        extension.runtime.completions?.some((provider) => provider.id === providerId)
      );
    };
    if (!session || !current()) return [];
    try {
      // Candidate requests never capture the editor or run command/view effects.
      const response = await session.invoke({ type: 'completion', id: providerId, args: { query } });
      return response && current() ? (response.result as PluginCompletionItem[]) : [];
    } catch (error) {
      if (alive(id, session) && !completionErrors.current.has(session)) {
        completionErrors.current.add(session);
        setErrors((old) => ({ ...old, [id]: error instanceof Error ? error.message : String(error) }));
        latest.current.onError(error);
      }
      return [];
    }
  }, []);
  // Establish sessions before embedded settings views issue their first passive render.
  useLayoutEffect(() => {
    const wanted = new Map(enabled.map((s) => [s.id, s]));
    for (const [id, session] of sessions.current) {
      if (session.path !== path || wanted.get(id)?.digest !== session.status.digest) {
        sessions.current.delete(id);
        session.dispose();
        if (activeRef.current?.pluginId === id) {
          setActive(null);
          setTree(null);
        }
      }
    }
    for (const status of enabled) {
      if (sessions.current.has(status.id) || !path) continue;
      sessions.current.set(status.id, new PluginSession(path, status));
      setErrors((old) => {
        const next = { ...old };
        delete next[status.id];
        return next;
      });
      void invokeRef.current(status.id, { type: 'load' });
    }
  }, [path, signature]);
  useEffect(
    () => () => {
      for (const session of sessions.current.values()) session.dispose();
      sessions.current.clear();
    },
    [],
  );
  const dataSignature = JSON.stringify([
    options.workspace?.notes,
    options.workspace?.databases,
    options.workspace?.records,
    options.workspace?.links,
  ]);
  const sidebarViews: PluginSidebarView[] = [];
  for (const extension of options.workspace?.extensions ?? []) {
    const status = enabled.find((item) => item.id === extension.id);
    const session = sessions.current.get(extension.id);
    if (
      !status ||
      !session ||
      session.path !== path ||
      session.status.digest !== status.digest ||
      !extension.runtime?.permissions.includes('ui')
    )
      continue;
    for (const view of extension.runtime.views ?? []) {
      if (view.placement !== 'right-sidebar') continue;
      sidebarViews.push({
        pluginId: extension.id,
        id: view.id,
        title: view.title,
        key: JSON.stringify([path, extension.id, status.digest, view.id]),
      });
    }
  }
  const sidebarRevision = JSON.stringify([
    path,
    signature,
    dataSignature,
    options.workspace?.settings,
    options.noteId,
    sidebarVersion,
  ]);
  const renderView = async () => {
    const view = activeRef.current;
    if (!view || !latest.current.visible || sessions.current.get(view.pluginId)?.error) return;
    const request = ++viewRequest.current;
    setBusy(true);
    const response = await invokeRef.current(view.pluginId, { type: 'render', id: view.id });
    if (request !== viewRequest.current) return;
    if (activeRef.current?.pluginId === view.pluginId && activeRef.current?.id === view.id && response)
      setTree(response.view);
    setBusy(false);
  };
  const renderRef = useRef(renderView);
  renderRef.current = renderView;
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const extension of options.workspace?.extensions ?? []) {
        if (
          extension.runtime?.events?.includes('workspace.changed') &&
          !sessions.current.get(extension.id)?.error
        )
          void invokeRef.current(extension.id, { type: 'event', name: 'workspace.changed' });
      }
      void renderRef.current();
    }, 120);
    return () => clearTimeout(timer);
  }, [dataSignature, signature, path, active?.pluginId, active?.id, options.visible]);
  useEffect(() => {
    for (const extension of options.workspace?.extensions ?? []) {
      if (extension.runtime?.events?.includes('note.opened') && !sessions.current.get(extension.id)?.error)
        void invokeRef.current(extension.id, {
          type: 'event',
          name: 'note.opened',
          args: { noteId: options.noteId },
        });
    }
  }, [options.noteId, path, signature]);
  useEffect(() => {
    if (
      !enabled.some((s) =>
        options.workspace?.extensions.some((e) => e.id === s.id && e.runtime?.backgroundCommand),
      )
    )
      return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      let pending = false;
      let updated = false;
      if (await latest.current.save()) {
        for (const extension of latest.current.workspace?.extensions ?? []) {
          const id = extension.runtime?.backgroundCommand;
          if (
            cancelled ||
            !id ||
            !sessions.current.has(extension.id) ||
            sessions.current.get(extension.id)?.error
          )
            continue;
          const response = await invokeRef.current(extension.id, {
            type: 'command',
            id,
            args: { automatic: true },
          });
          updated ||= Boolean(response?.changed);
          if (response?.result && typeof response.result === 'object' && 'pending' in response.result)
            pending ||= response.result.pending === true;
        }
        if (!cancelled && updated) void renderRef.current();
      }
      if (!cancelled) timer = setTimeout(run, pending ? 1000 : 15000);
    };
    timer = setTimeout(run, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [dataSignature, path, activationSignature]);
  const commands: Command[] = [];
  for (const extension of options.workspace?.extensions ?? []) {
    if (!enabled.some((s) => s.id === extension.id)) continue;
    for (const command of extension.commands ?? []) {
      if (command.action.type !== 'script') continue;
      commands.push({
        id: `plugin.${extension.id}.${command.id}`,
        title: command.title,
        group: extension.name,
        bindings: command.bindings,
        run: async () => {
          if (!(await latest.current.save())) return;
          await invokeRef.current(extension.id, { type: 'command', id: command.id });
          void renderRef.current();
        },
      });
    }
  }
  const action = async (id: string, value?: string | boolean, payload?: unknown) => {
    const view = activeRef.current;
    if (!view) return;
    const request = ++viewRequest.current;
    setBusy(true);
    const response = await invokeRef.current(view.pluginId, {
      type: 'action',
      id: view.id,
      action: { id, value, payload },
    });
    const rendered =
      response && activeRef.current === view && latest.current.visible
        ? await invokeRef.current(view.pluginId, { type: 'render', id: view.id })
        : null;
    if (request === viewRequest.current) {
      if (rendered && activeRef.current === view) setTree(rendered.view);
      setBusy(false);
    }
  };
  const stop = async (id: string) => {
    const session = sessions.current.get(id);
    if (!session) return;
    sessions.current.delete(id);
    setSidebarVersion((value) => value + 1);
    if (activeRef.current?.pluginId === id) {
      ++viewRequest.current;
      setActive(null);
      setTree(null);
      setBusy(false);
    }
    await session.dispose();
  };
  return {
    commands,
    active,
    tree,
    busy,
    action,
    errors,
    renderView,
    stop,
    invokeSettings,
    sidebarViews,
    sidebarRevision,
    invokeSidebar,
    complete,
  };
}
