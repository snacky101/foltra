import { useEffect, useRef, useState } from 'react';
import { call } from './api';
import type { Workspace } from './types';
import type { TreeIcons } from '../components/TreeIcon';
import type { PluginResponse } from './pluginTypes';

export function useTreeIcons(
  workspace: Workspace | null,
  onError: (error: unknown) => void,
): TreeIcons | undefined {
  const error = useRef(onError);
  error.current = onError;
  const providers = (workspace?.pluginStates ?? []).filter(
    (state) =>
      state.enabled && workspace?.extensions.some((item) => item.id === state.id && item.runtime?.treeIcons),
  );
  const identity = JSON.stringify([workspace?.path, providers.map(({ id, digest }) => [id, digest])]);
  const key = JSON.stringify([workspace?.path, providers]);
  const [result, setResult] = useState<{ key: string; identity: string; icons: TreeIcons }>();
  useEffect(() => {
    let active = true;
    const [path, states] = JSON.parse(key) as [string | undefined, typeof providers];
    if (!path || !states.length) return;
    void Promise.all(
      states.map(async ({ id, digest }) => {
        try {
          const response = await call<PluginResponse>(path, 'extension.invoke', {
            id,
            digest,
            event: { type: 'tree-icons' },
          });
          return response.result as TreeIcons;
        } catch (reason) {
          if (active) error.current(reason);
          return {};
        }
      }),
    ).then((values) => {
      if (active)
        setResult({
          key,
          identity,
          icons: values.reduce<TreeIcons>(
            (all, next) => ({ ...all, ...next, items: { ...all.items, ...next.items } }),
            {},
          ),
        });
    });
    return () => {
      active = false;
    };
  }, [key]);
  return result?.identity === identity ? result.icons : undefined;
}
