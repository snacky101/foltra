import { useRef, useState } from 'react';
import { call } from '../lib/api';
import type { PluginPolicy } from '../lib/pluginTypes';

export function PluginPolicyControls({
  policy,
  vault,
  refresh,
  onError,
  beforeDisable,
}: {
  policy?: PluginPolicy;
  vault: string;
  refresh: () => Promise<void>;
  onError: (error: unknown) => void;
  beforeDisable: () => Promise<void>;
}) {
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const update = async (enabled: boolean, acceptConsent = false) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await call(vault, 'extension.policy.update', { enabled, acceptConsent });
      if (!enabled) await beforeDisable();
      await refresh();
      setReview(false);
    } catch (error) {
      onError(error);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="plugin-policy">
      <label>
        <strong>플러그인 사용</strong>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          aria-label="플러그인 사용"
          checked={policy?.enabled ?? false}
          disabled={busy}
          onChange={(event) => {
            if (event.target.checked && !policy?.consentAccepted) setReview(true);
            else void update(event.target.checked);
          }}
        />
      </label>
      <p>
        {policy?.enabled
          ? '개별 플러그인을 설치하고 활성화하면 바로 사용할 수 있습니다.'
          : '사용을 켜면 기존 플러그인의 활성화 상태도 복원됩니다. 테마는 별도로 사용할 수 있습니다.'}
      </p>
      {review && !policy?.consentAccepted && (
        <div className="plugin-permissions" role="group" aria-label="플러그인 사용 동의">
          <strong>플러그인 사용을 시작할까요?</strong>
          <p>
            활성화한 플러그인은 선언한 권한에 따라 노트·데이터베이스를 읽고 수정하거나 Anki·Git과 연동할 수
            있습니다. 신뢰하는 플러그인만 설치하세요.
          </p>
          <p>
            이 기기의 현재 vault에서 한 번만 동의합니다. 이후 설치·활성화·업데이트에는 다시 묻지 않습니다.
          </p>
          <div className="plugin-row">
            <button className="primary-button" disabled={busy} onClick={() => void update(true, true)}>
              동의하고 사용
            </button>
            <button className="text-button" disabled={busy} onClick={() => setReview(false)}>
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
