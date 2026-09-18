import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from './api';
import type { Workspace } from './types';

export interface GitStatus {
  history?: {
    id: string;
    phase: string;
    message: string;
    updatedAt: string;
    localCommit: string | null;
    remoteCommit: string | null;
    remote: string;
  }[];
  config: { remote: string; branch: string; automatic: boolean; intervalMinutes: number } | null;
  configRevision: string;
  jobId: string;
  phase: string;
  message: string;
  updatedAt: string;
  applied: boolean;
  conflictCount: number;
  conflicts: { path: string; local: string | null; remote: string | null }[];
  localCommit: string | null;
  remoteCommit: string | null;
}
export interface GitOwner {
  path: string;
  id: string;
  digest: string;
}
export interface GitConnection {
  owner: GitOwner;
  params: {
    remote: string;
    branch: string;
    automatic: boolean;
    intervalMinutes: number;
    expectedRevision: string;
  };
}
interface Options {
  workspace: Workspace | null;
  save: () => Promise<boolean>;
  refresh: () => Promise<void>;
  updateView: (pluginId: string) => void;
  onError: (error: unknown) => void;
  notify: (message: string) => void;
}

/** Long Git requests never enter a plugin's serialized QuickJS queue. */
export function usePluginGit(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const mounted = useRef(true);
  const operations = useRef(
    new Map<string, { timer?: ReturnType<typeof setInterval>; status: string; polling: boolean }>(),
  );
  const [connection, setConnection] = useState<GitConnection | null>(null);
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const [busy, setBusy] = useState(false);
  const confirming = useRef(false);
  const [error, setError] = useState('');
  const authorized = useCallback((owner: GitOwner) => {
    const workspace = latest.current.workspace;
    return (
      mounted.current &&
      workspace?.path === owner.path &&
      workspace.pluginStates?.some(
        (state) => state.id === owner.id && state.enabled && state.digest === owner.digest,
      ) &&
      workspace.extensions.some(
        (extension) =>
          extension.id === owner.id &&
          extension.runtime?.permissions.includes('git.sync') &&
          extension.runtime.permissions.includes('ui'),
      )
    );
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const operation of operations.current.values()) clearInterval(operation.timer);
    };
  }, []);
  useEffect(() => {
    if (connection && !authorized(connection.owner)) {
      connectionRef.current = null;
      setConnection(null);
      setError('');
    }
  }, [options.workspace?.path, options.workspace?.pluginStates, connection, authorized]);
  const launch = useCallback(
    async (owner: GitOwner, action: 'sync' | 'resolve', params: Record<string, unknown>) => {
      if (!authorized(owner) || operations.current.has(owner.path)) return;
      const operation: { timer?: ReturnType<typeof setInterval>; status: string; polling: boolean } = {
        status: '',
        polling: false,
      };
      operations.current.set(owner.path, operation);
      const update = (status: GitStatus) => {
        if (!authorized(owner)) return;
        const signature = JSON.stringify(status);
        if (signature !== operation.status) {
          operation.status = signature;
          latest.current.updateView(owner.id);
        }
      };
      try {
        if (!(await latest.current.save()) || !authorized(owner)) return;
        operation.timer = setInterval(() => {
          if (!authorized(owner) || operation.polling) return;
          operation.polling = true;
          void call<GitStatus>(owner.path, 'git.status')
            .then(update, () => {})
            .finally(() => {
              operation.polling = false;
            });
        }, 1000);
        // Whitelist operation arguments; never accept a caller-supplied permission owner.
        const args =
          action === 'sync'
            ? { automatic: params.automatic === true }
            : { jobId: params.jobId, ...(params.all ? { all: params.all } : { choices: params.choices }) };
        const status = await call<GitStatus>(owner.path, `git.${action}`, {
          ...args,
          pluginId: owner.id,
          pluginDigest: owner.digest,
        });
        if (!authorized(owner)) return;
        update(status);
        // Saving through useNote preserves conflicts and newer drafts before a workspace refresh.
        if ((await latest.current.save()) && authorized(owner)) await latest.current.refresh();
        if (authorized(owner) && params.automatic !== true && status.message)
          latest.current.notify(status.message);
      } catch (failure) {
        if (authorized(owner)) latest.current.onError(failure);
      } finally {
        clearInterval(operation.timer);
        operations.current.delete(owner.path);
        if (authorized(owner)) latest.current.updateView(owner.id);
      }
    },
    [authorized],
  );
  const request = useCallback(
    (owner: GitOwner, action: string | undefined, params: Record<string, unknown> = {}) => {
      if (!authorized(owner) || operations.current.has(owner.path) || connectionRef.current) return;
      if (action === 'configure') {
        if (
          typeof params.remote !== 'string' ||
          !params.remote.trim() ||
          typeof params.expectedRevision !== 'string'
        ) {
          latest.current.onError(new Error('저장소 주소와 현재 연결 설정을 확인해 주세요.'));
          return;
        }
        const next: GitConnection = {
          owner,
          params: {
            remote: params.remote.trim(),
            branch: typeof params.branch === 'string' ? params.branch : 'main',
            automatic: params.automatic === true,
            intervalMinutes: typeof params.intervalMinutes === 'number' ? params.intervalMinutes : 5,
            expectedRevision: params.expectedRevision,
          },
        };
        connectionRef.current = next;
        setError('');
        setConnection(next);
      } else if (action === 'sync' || action === 'resolve') void launch(owner, action, params);
    },
    [authorized, launch],
  );
  const close = useCallback(() => {
    if (confirming.current) return;
    connectionRef.current = null;
    setConnection(null);
    setError('');
  }, []);
  const confirm = async () => {
    const current = connectionRef.current;
    if (!current || confirming.current || !authorized(current.owner)) return;
    confirming.current = true;
    setBusy(true);
    setError('');
    try {
      await call(current.owner.path, 'git.configure', {
        ...current.params,
        pluginId: current.owner.id,
        pluginDigest: current.owner.digest,
      });
      if (authorized(current.owner)) {
        connectionRef.current = null;
        setConnection(null);
        latest.current.updateView(current.owner.id);
        latest.current.notify('Git 저장소를 연결했습니다. 동기화를 실행하면 데이터를 전송합니다.');
      }
    } catch (failure) {
      if (authorized(current.owner)) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      confirming.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { request, connection, confirm, close, busy, error };
}
