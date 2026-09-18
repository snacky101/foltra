import { useEffect, useRef, useState } from 'react';
import type { PluginNode, PluginSettingsInvoke } from '../lib/pluginTypes';
import { PluginView } from './PluginView';

/** Settings share the running plugin session, including its serialized action queue. */
export function PluginSettingsView({
  pluginId,
  viewId,
  revision,
  invoke,
  error,
  title = '확장 설정',
  preserveOnError = false,
}: {
  pluginId: string;
  viewId: string;
  revision: string;
  invoke: PluginSettingsInvoke;
  error?: string;
  title?: string;
  preserveOnError?: boolean;
}) {
  const [tree, setTree] = useState<PluginNode | null>(null);
  const [busy, setBusy] = useState(true);
  const generation = useRef(0);
  const request = useRef(0);
  const pending = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++request.current;
    };
  }, []);
  const render = async () => {
    if (error) return;
    const current = ++request.current;
    const response = await invoke(pluginId, { type: 'render', id: viewId });
    if (mounted.current && current === request.current && response) setTree(response.view);
  };
  const renderRef = useRef(render);
  renderRef.current = render;
  useEffect(() => {
    const current = ++generation.current;
    setBusy(true);
    void renderRef.current().finally(() => {
      if (current === generation.current && !pending.current) setBusy(false);
    });
    return () => {
      ++generation.current;
      ++request.current;
    };
  }, [pluginId, viewId, revision]);
  const action = async (id: string, value?: string | boolean, payload?: unknown) => {
    if (error) return;
    ++pending.current;
    setBusy(true);
    try {
      const response = await invoke(pluginId, { type: 'action', id: viewId, action: { id, value, payload } });
      if (response && mounted.current) await renderRef.current();
    } finally {
      --pending.current;
      if (mounted.current && !pending.current) setBusy(false);
    }
  };
  return (
    <PluginView
      embedded
      title={title}
      tree={tree}
      busy={busy}
      error={error}
      preserveOnError={preserveOnError}
      action={action}
      refresh={() => void renderRef.current()}
    />
  );
}
