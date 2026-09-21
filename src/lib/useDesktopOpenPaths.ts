import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { call } from './api';
import { settleCoreRequests } from './coreRequestBarrier';

export interface DesktopOpenTarget {
  path: string;
  vaultPath: string;
  noteId?: string;
}

interface Actions {
  save: () => Promise<boolean>;
  blocked: () => string | undefined;
  open: (target: DesktopOpenTarget) => Promise<void>;
  onError: (error: unknown) => void;
}

export function useDesktopOpenPaths(actions: Actions) {
  const latest = useRef(actions);
  latest.current = actions;
  const session = useRef({ mounted: false, draining: false, requested: false });
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    const state = session.current;
    state.mounted = true;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const checkBlocked = () => {
      const reason = latest.current.blocked();
      if (reason) throw new Error(reason);
    };
    const drain = async () => {
      state.requested = true;
      if (state.draining) return;
      state.draining = true;
      try {
        while (state.requested && state.mounted) {
          state.requested = false;
          const paths = await invoke<string[]>('take_open_paths');
          for (const path of paths) {
            if (!state.mounted) return;
            try {
              checkBlocked();
              const target = await call<DesktopOpenTarget>('', 'path.resolve', { path });
              if (!state.mounted) return;
              checkBlocked();
              // Commit the input gate before blur can save a title or database cell.
              flushSync(() => setOpening(true));
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
              if (!(await settleCoreRequests()))
                throw new Error('저장하지 못한 내용을 확인한 뒤 다시 열어주세요.');
              if (!state.mounted) return;
              checkBlocked();
              if (!(await latest.current.save()))
                throw new Error('현재 노트의 저장 문제를 해결한 뒤 다시 열어주세요.');
              if (!state.mounted) return;
              checkBlocked();
              if (document.querySelector('[aria-invalid="true"], .save-error'))
                throw new Error('저장하지 못한 내용을 확인한 뒤 다시 열어주세요.');
              await latest.current.open(target);
            } catch (error) {
              if (state.mounted) latest.current.onError(error);
            }
          }
        }
      } catch (error) {
        if (state.mounted) latest.current.onError(error);
      } finally {
        state.draining = false;
        if (state.mounted) setOpening(false);
      }
    };
    // Subscribe before draining: neither cold-start requests nor live events can fall in a gap.
    void listen('foltra:open-paths', () => void drain())
      .then((cleanup) => {
        if (disposed) cleanup();
        else {
          unlisten = cleanup;
          void drain();
        }
      })
      .catch((error) => {
        if (!disposed) latest.current.onError(error);
      });
    return () => {
      disposed = true;
      state.mounted = false;
      unlisten?.();
    };
  }, []);
  return opening;
}
