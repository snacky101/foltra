import { useState } from 'react';
import { call } from '../lib/api';
import type { Extension } from '../lib/types';
import { pluginPermissionLabels, type PluginStatus } from '../lib/pluginTypes';
export function PluginToggle({
  extension,
  status,
  vault,
  refresh,
  onError,
  beforeDisable,
  pluginsEnabled,
}: {
  pluginsEnabled: boolean;
  beforeDisable?: (id: string) => Promise<void>;
  extension: Extension;
  status?: PluginStatus;
  vault: string;
  refresh: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  const enable = () =>
    run(async () => {
      await call(vault, 'extension.enable', { id: extension.id, digest: status!.digest });
      await refresh();
    });
  const disable = () =>
    run(async () => {
      await beforeDisable?.(extension.id);
      await call(vault, 'extension.disable', { id: extension.id });
      await refresh();
    });
  return (
    <label className="plugin-toggle">
      <span>{status?.enabled ? '활성화됨' : '비활성화됨'}</span>
      <input
        className="switch"
        role="switch"
        type="checkbox"
        aria-label={`${extension.name} 활성화`}
        checked={status?.enabled ?? false}
        disabled={busy || !status || !pluginsEnabled}
        onChange={(e) => {
          if (e.target.checked) void enable();
          else void disable();
        }}
      />
    </label>
  );
}

export function PluginDetails({
  extension,
  error,
  pluginsEnabled,
}: {
  extension: Extension;
  error?: string;
  pluginsEnabled: boolean;
}) {
  const runtime = extension.runtime!;
  return (
    <div className="plugin-details">
      {!pluginsEnabled && <p className="extension-settings-hint">확장 목록에서 플러그인 사용을 켜세요.</p>}
      <details className="plugin-permissions">
        <summary>사용하는 권한</summary>
        <ul>
          {runtime.permissions.length ? (
            runtime.permissions.map((p) => <li key={p}>{pluginPermissionLabels[p]}</li>)
          ) : (
            <li>플러그인 전용 데이터 저장</li>
          )}
        </ul>
      </details>
      {error && (
        <p className="plugin-error" role="alert">
          실행 중지 · {error}
          <br />
          껐다 켜면 다시 실행합니다.
        </p>
      )}
    </div>
  );
}

export function PluginControls(props: React.ComponentProps<typeof PluginToggle> & { error?: string }) {
  return (
    <div className="plugin-controls">
      <PluginToggle {...props} />
      <PluginDetails extension={props.extension} error={props.error} pluginsEnabled={props.pluginsEnabled} />
    </div>
  );
}
