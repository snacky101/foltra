import { invoke, isTauri } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { Terminal } from 'lucide-react';

type CliStatus = { available: boolean; installed: boolean; path?: string; message?: string };

export function CliSettings() {
  const [status, setStatus] = useState<CliStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (!isTauri()) {
      setStatus({
        available: false,
        installed: false,
        message: 'CLI 설치는 macOS 데스크톱 앱에서 사용할 수 있습니다.',
      });
      return;
    }
    void invoke<CliStatus>('cli_status').then(
      (value) => {
        if (active) setStatus(value);
      },
      (reason) => {
        if (active) setError(String(reason));
      },
    );
    return () => {
      active = false;
    };
  }, []);
  async function install() {
    setBusy(true);
    setError('');
    try {
      setStatus(await invoke<CliStatus>('install_cli'));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-section">
      <h3>터미널에서 Foltra 사용하기</h3>
      <p className="muted">
        앱에 포함된 CLI를 터미널 명령으로 연결합니다. 앱을 업데이트하면 CLI도 함께 갱신됩니다.
      </p>
      <div className="setting-row">
        <span>
          <strong>foltra 명령</strong>
          <small>{status?.path ?? 'macOS 터미널'}</small>
        </span>
        <button
          className="secondary-button"
          disabled={busy || !status?.available || status.installed}
          onClick={() => void install()}
        >
          <Terminal size={15} />
          {busy ? '설치 중…' : status?.installed ? '설치됨' : 'CLI 설치'}
        </button>
      </div>
      <p className="muted" role="status">
        {status?.message ??
          (status?.installed
            ? '터미널에서 foltra --version으로 확인할 수 있습니다.'
            : '설치를 누르면 필요한 경우 macOS에서 관리자 인증을 요청합니다.')}
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <p>
        <code>foltra ~/Documents/MyVault</code> — 볼트 열기
      </p>
      <p>
        <code>foltra ./notes/노트.md</code> — 볼트 안의 노트 열기
      </p>
      <p>
        <code>foltra --help</code> — CLI 명령 확인
      </p>
    </section>
  );
}
