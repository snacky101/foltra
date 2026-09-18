import { ArrowDownToLine, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import type { AppUpdates } from '../lib/useAppUpdates';
import { Modal } from './Modal';
import '../styles/updates.css';

const descriptions: Partial<Record<AppUpdates['phase'], string>> = {
  idle: '새로운 Foltra 버전이 있는지 확인하세요.',
  checking: '업데이트를 확인하고 있습니다…',
  current: '최신 버전을 사용하고 있습니다.',
  available: '새 버전을 다운로드할 수 있습니다.',
  downloading: '다운로드 중에도 작업을 계속할 수 있습니다.',
  downloaded: '다운로드가 완료됐습니다. 설치하면 앱이 다시 시작됩니다.',
  unsupported: '업데이트는 Foltra 데스크톱 앱에서 사용할 수 있습니다.',
};
const bytes = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MB`;

export function AppUpdatesPanel({ updates }: { updates: AppUpdates }) {
  const busy = updates.phase === 'checking' || updates.phase === 'downloading' || updates.blocking;
  const percent = updates.total
    ? Math.min(100, Math.floor((updates.downloaded / updates.total) * 100))
    : undefined;
  return (
    <div className="app-updates-panel">
      <div className="app-update-version">
        <span className="app-update-emblem" aria-hidden="true">
          <RefreshCw size={22} strokeWidth={1.5} />
        </span>
        <div>
          <strong>Foltra</strong>
          <span>현재 버전 {updates.version || '—'}</span>
        </div>
        {updates.phase === 'current' && <CheckCircle2 size={19} aria-hidden="true" />}
      </div>
      <div className="app-update-status" role="status">
        <p>{descriptions[updates.phase]}</p>
        {updates.available && <strong>{updates.available.version}</strong>}
      </div>
      {updates.phase === 'downloading' && (
        <div className="app-update-download">
          <progress aria-label="업데이트 다운로드" max={100} value={percent} />
          <span>
            {percent === undefined
              ? bytes(updates.downloaded)
              : `${percent}% · ${bytes(updates.downloaded)} / ${bytes(updates.total!)}`}
          </span>
        </div>
      )}
      {updates.available?.body && (
        <section className="app-update-notes" aria-label="릴리스 노트">
          <h3>이번 업데이트</h3>
          <p>{updates.available.body}</p>
        </section>
      )}
      {updates.error && (
        <p className="inline-error" role="alert">
          {updates.error}
        </p>
      )}
      {updates.desktop && (
        <>
          <div className="app-update-actions">
            {updates.phase === 'downloaded' ? (
              <button className="primary-button" onClick={() => void updates.install()}>
                <RefreshCw size={15} />
                설치 후 다시 시작
              </button>
            ) : (
              <>
                {updates.phase === 'available' && (
                  <button className="primary-button" onClick={() => void updates.download()}>
                    <ArrowDownToLine size={15} />
                    다운로드
                  </button>
                )}
                <button className="secondary-button" disabled={busy} onClick={() => void updates.check()}>
                  {updates.phase === 'checking' ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  업데이트 확인
                </button>
              </>
            )}
          </div>
          <label className="setting-row app-update-automatic">
            <span>
              <strong>시작할 때 자동으로 확인</strong>
              <small>이 기기에 적용됩니다. 다운로드와 설치는 직접 선택합니다.</small>
            </span>
            <input
              type="checkbox"
              className="switch"
              checked={updates.automatic}
              disabled={updates.blocking}
              onChange={(event) => updates.setAutomatic(event.target.checked)}
            />
          </label>
        </>
      )}
    </div>
  );
}

export function AppUpdateDialogs({ updates }: { updates: AppUpdates }) {
  if (updates.blocking)
    return (
      <div className="modal-backdrop app-update-blocker">
        <section
          className="modal app-update-installing"
          role="dialog"
          aria-modal="true"
          aria-label="업데이트 설치"
        >
          <RefreshCw
            size={25}
            className={updates.phase === 'restart-required' ? undefined : 'spin'}
            aria-hidden="true"
          />
          <h2>
            {updates.phase === 'preparing'
              ? '작업을 저장하고 있습니다'
              : updates.phase === 'installing'
                ? '업데이트를 설치하고 있습니다'
                : 'Foltra를 다시 시작합니다'}
          </h2>
          <p role="status">
            {updates.phase === 'preparing'
              ? '편집 내용과 진행 중인 작업이 저장될 때까지 기다려 주세요.'
              : '앱이 다시 시작되면 작업을 이어갈 수 있습니다.'}
          </p>
          {updates.error && (
            <p className="inline-error" role="alert">
              {updates.error}
            </p>
          )}
          {updates.phase === 'restart-required' && (
            <button autoFocus className="primary-button" onClick={() => void updates.retryRestart()}>
              <RefreshCw size={15} />
              다시 시작 재시도
            </button>
          )}
        </section>
      </div>
    );
  return updates.opened ? (
    <Modal title="앱 업데이트" close={updates.close} className="app-update-modal">
      <AppUpdatesPanel updates={updates} />
    </Modal>
  ) : null;
}
