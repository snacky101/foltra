import { useEffect, useRef } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function useCloseGuard(
  isDirty: () => boolean,
  save: () => Promise<boolean>,
  onError: (e: unknown) => void,
) {
  const current = useRef({ isDirty, save, onError });
  current.current = { isDirty, save, onError };
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const window = getCurrentWindow();
    void window
      .onCloseRequested(async (event) => {
        if (!current.current.isDirty()) return;
        event.preventDefault();
        try {
          if (await current.current.save()) await window.destroy();
        } catch (e) {
          current.current.onError(e);
        }
      })
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      })
      .catch(onError);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
