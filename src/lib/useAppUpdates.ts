import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export type UpdatePhase =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'preparing'
  | 'installing'
  | 'restarting'
  | 'restart-required';
export interface UpdateState {
  phase: UpdatePhase;
  version: string;
  available?: { version: string; body?: string };
  downloaded: number;
  total?: number;
  error: string;
}
const preference = 'foltra:app-updates:automatic';
const blocked = new Set<UpdatePhase>(['preparing', 'installing', 'restarting', 'restart-required']);

export function useAppUpdates(options: {
  prepare: () => Promise<() => void>;
  notify: (message: string) => void;
}) {
  const desktop = isTauri();
  const latest = useRef(options);
  latest.current = options;
  const [state, setState] = useState<UpdateState>({
    phase: desktop ? 'idle' : 'unsupported',
    version: '',
    downloaded: 0,
    error: '',
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const [opened, setOpened] = useState(false);
  const [automatic, setAutomatic] = useState(() => localStorage.getItem(preference) !== 'false');
  const update = useRef<Update | null>(null);
  const disposed = useRef(new WeakSet<Update>());
  const operation = useRef<Promise<void> | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(false);
  const checked = useRef(false);
  const resume = useRef<(() => void) | null>(null);
  const alive = (turn: number) => mounted.current && epoch.current === turn;
  const patch = (value: Partial<UpdateState>) => {
    stateRef.current = { ...stateRef.current, ...value };
    setState(stateRef.current);
  };
  const dispose = useCallback(async (value: Update | null) => {
    if (!value || disposed.current.has(value)) return;
    disposed.current.add(value);
    await value.close().catch(() => {});
  }, []);
  const run = (task: (turn: number) => Promise<void>) => {
    if (!desktop || !mounted.current || operation.current) return Promise.resolve();
    const pending = task(epoch.current).finally(() => {
      if (operation.current === pending) operation.current = null;
    });
    operation.current = pending;
    return pending;
  };
  const checkNow = (silent = false) => {
    if (blocked.has(stateRef.current.phase) || stateRef.current.phase === 'downloaded')
      return Promise.resolve();
    return run(async (turn) => {
      checked.current = true;
      patch({ phase: 'checking', error: '', available: undefined, downloaded: 0, total: undefined });
      const old = update.current;
      update.current = null;
      await dispose(old);
      try {
        const value = await check({ timeout: 20_000 });
        if (!alive(turn)) {
          await dispose(value);
          return;
        }
        update.current = value;
        patch({
          phase: value ? 'available' : 'current',
          available: value ? { version: value.version, body: value.body } : undefined,
          ...(value ? { version: value.currentVersion } : {}),
        });
        if (value && silent)
          latest.current.notify(
            `Foltra ${value.version} 업데이트가 있습니다. 설정 → 앱 업데이트에서 확인하세요.`,
          );
      } catch (error) {
        if (alive(turn)) patch({ phase: 'idle', error: `업데이트를 확인하지 못했습니다. ${String(error)}` });
      }
    });
  };
  const download = () =>
    run(async (turn) => {
      const value = update.current;
      if (!value || stateRef.current.phase !== 'available') return;
      patch({ phase: 'downloading', error: '', downloaded: 0, total: undefined });
      try {
        await value.download(
          (event) => {
            if (!alive(turn)) return;
            if (event.event === 'Started') patch({ total: event.data.contentLength, downloaded: 0 });
            if (event.event === 'Progress')
              patch({ downloaded: stateRef.current.downloaded + event.data.chunkLength });
          },
          { timeout: 120_000 },
        );
        if (alive(turn)) patch({ phase: 'downloaded' });
      } catch (error) {
        if (alive(turn)) patch({ phase: 'available', error: `다운로드하지 못했습니다. ${String(error)}` });
      }
    });
  const restart = async (turn: number) => {
    if (!alive(turn)) return;
    patch({ phase: 'restarting', error: '' });
    try {
      await relaunch();
    } catch (error) {
      if (alive(turn))
        patch({
          phase: 'restart-required',
          error: `설치는 완료됐지만 다시 시작하지 못했습니다. ${String(error)}`,
        });
    }
  };
  const install = () =>
    run(async (turn) => {
      const value = update.current;
      if (!value || stateRef.current.phase !== 'downloaded') return;
      patch({ phase: 'preparing', error: '' });
      try {
        await invoke('set_update_in_progress', { inProgress: true });
        if (!alive(turn)) {
          await invoke('set_update_in_progress', { inProgress: false });
          return;
        }
        const release = await latest.current.prepare();
        if (!alive(turn)) {
          release();
          await invoke('set_update_in_progress', { inProgress: false });
          return;
        }
        resume.current = release;
      } catch (error) {
        await invoke('set_update_in_progress', { inProgress: false }).catch(() => {});
        if (alive(turn)) patch({ phase: 'downloaded', error: String(error) });
        return;
      }
      patch({ phase: 'installing' });
      try {
        await value.install();
      } catch (error) {
        resume.current?.();
        resume.current = null;
        await invoke('set_update_in_progress', { inProgress: false }).catch(() => {});
        update.current = null;
        await dispose(value);
        if (alive(turn))
          patch({
            phase: 'idle',
            error: `설치하지 못했습니다. 업데이트를 다시 확인해 주세요. ${String(error)}`,
          });
        return;
      }
      update.current = null;
      await dispose(value);
      await restart(turn);
    });
  const retryRestart = () =>
    stateRef.current.phase === 'restart-required' ? run(restart) : Promise.resolve();
  const open = () => {
    if (blocked.has(stateRef.current.phase)) return;
    setOpened(true);
    if (!['available', 'downloading', 'downloaded'].includes(stateRef.current.phase)) void checkNow();
  };
  const actions = useRef({ checkNow, open });
  actions.current = { checkNow, open };
  useEffect(() => {
    mounted.current = true;
    const turn = ++epoch.current;
    let unlisten: (() => void) | undefined;
    if (desktop) {
      void getVersion()
        .then((version) => {
          if (alive(turn)) patch({ version });
        })
        .catch(() => {});
      const requested = async () => {
        const pending = await invoke<boolean>('take_update_check_request');
        // This app-wide request remains valid across StrictMode effect replay.
        if (pending && mounted.current) actions.current.open();
      };
      void listen('foltra:check-for-updates', () => void requested().catch(() => {}))
        .then((cleanup) => {
          if (alive(turn)) {
            unlisten = cleanup;
            void requested().catch(() => {});
          } else cleanup();
        })
        .catch(() => {});
    }
    return () => {
      mounted.current = false;
      ++epoch.current;
      unlisten?.();
      const resource = update.current;
      update.current = null;
      const release = resume.current;
      resume.current = null;
      const wasBlocking = blocked.has(stateRef.current.phase);
      void (operation.current ?? Promise.resolve()).finally(async () => {
        await dispose(resource);
        release?.();
        if (desktop && wasBlocking)
          await invoke('set_update_in_progress', { inProgress: false }).catch(() => {});
      });
    };
  }, [desktop, dispose]);
  useEffect(() => {
    if (!desktop || !automatic || checked.current) return;
    const timer = setTimeout(() => {
      if (!checked.current) void actions.current.checkNow(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, [desktop, automatic]);
  return {
    ...state,
    desktop,
    opened,
    automatic,
    blocking: blocked.has(state.phase),
    isBlocking: () => blocked.has(stateRef.current.phase),
    open,
    close: () => {
      if (!blocked.has(stateRef.current.phase)) setOpened(false);
    },
    check: () => checkNow(),
    download,
    install,
    retryRestart,
    setAutomatic: (value: boolean) => {
      localStorage.setItem(preference, String(value));
      setAutomatic(value);
    },
  };
}

export type AppUpdates = ReturnType<typeof useAppUpdates>;
