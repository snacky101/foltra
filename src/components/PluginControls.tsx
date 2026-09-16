import { useState } from 'react';
import { call } from '../lib/api';
import type { Extension } from '../lib/types';
import { pluginPermissionLabels, type PluginStatus } from '../lib/pluginTypes';
export function PluginControls({
  extension,
  status,
  vault,
  refresh,
  error,
  onError,
  beforeDisable,
}: {
  beforeDisable?: (id: string) => Promise<void>;
  extension: Extension;
  status?: PluginStatus;
  vault: string;
  error?: string;
  refresh: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const runtime = extension.runtime!;
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
      setReview(false);
      await refresh();
    });
  const disable = () =>
    run(async () => {
      await beforeDisable?.(extension.id);
      await call(vault, 'extension.disable', { id: extension.id });
      await refresh();
    });
  return (
    <div className="plugin-controls">
      <label>
        <span>{status?.enabled ? '활성화됨' : '비활성화됨'}</span>
        <input
          className="switch"
          role="switch"
          type="checkbox"
          aria-label={`${extension.name} 활성화`}
          checked={status?.enabled ?? false}
          disabled={busy || !status}
          onChange={(e) => {
            if (e.target.checked) setReview(true);
            else void disable();
          }}
        />
      </label>
      {review && !status?.enabled && (
        <div className="plugin-permissions" role="group" aria-label={`${extension.name} 권한 확인`}>
          <strong>이 플러그인에 허용할 기능</strong>
          <ul>
            {runtime.permissions.length ? (
              runtime.permissions.map((p) => <li key={p}>{pluginPermissionLabels[p]}</li>)
            ) : (
              <li>플러그인 전용 데이터 저장</li>
            )}
          </ul>
          <p>이 기기의 현재 vault에서 실행합니다. 코드나 권한이 바뀌면 다시 확인합니다.</p>
          <div className="plugin-row">
            <button className="secondary-button" disabled={busy} onClick={() => void enable()}>
              허용하고 활성화
            </button>
            <button className="text-button" disabled={busy} onClick={() => setReview(false)}>
              취소
            </button>
          </div>
        </div>
      )}
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
