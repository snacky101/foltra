import { useState } from 'react';
import { ArrowRight, FolderOpen, Sprout } from 'lucide-react';
import { useVaultLocation } from '../lib/useVaultLocation';
import { VaultPathField } from './VaultPathField';
import { isTauri } from '@tauri-apps/api/core';
import { open as chooseDirectory } from '@tauri-apps/plugin-dialog';

export function Welcome({
  open,
  create,
  error,
  previousPath,
}: {
  open: (path: string) => Promise<void>;
  create: (path: string, name: string, demo: boolean) => Promise<void>;
  error: string;
  previousPath: string;
}) {
  const location = useVaultLocation(previousPath, 'Personal');
  const { path, setPath, name, setName } = location;
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setLocalError('');
    try {
      await action();
    } catch (e) {
      setLocalError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const browse = () =>
    run(async () => {
      const selected = await chooseDirectory({
        directory: true,
        multiple: false,
        title: '새 Vault를 만들 상위 폴더 선택',
        defaultPath: location.directory || undefined,
      });
      if (selected) location.selectDirectory(selected);
    });
  const openExisting = () =>
    run(async () => {
      if (!isTauri()) return open(path);
      const selected = await chooseDirectory({
        directory: true,
        multiple: false,
        title: '기존 Foltra vault 선택',
        defaultPath: previousPath || path || undefined,
      });
      if (selected) await open(selected);
    });
  return (
    <div className="welcome">
      <div className="welcome-brand" data-tauri-drag-region>
        <span className="brand-mark">
          <Sprout size={23} strokeWidth={1.6} />
        </span>
        foltra<span className="preview-badge">LOCAL PREVIEW</span>
      </div>
      <div className="welcome-content">
        <div className="welcome-art">
          <span />
          <span />
          <span />
          <span />
          <i />
        </div>
        <div className="eyebrow">A PLACE FOR CONNECTED THOUGHT</div>
        <h1>
          생각이 머물고,
          <br />
          서로 이어지는 곳.
        </h1>
        <p className="welcome-copy">
          노트와 데이터를 한 공간에.
          <br />
          모든 기록은 당신의 기기에 남습니다.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => create(path, name, false));
          }}
        >
          <label>
            Vault 이름
            <input
              aria-label="Vault 이름"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={busy}
            />
          </label>
          <VaultPathField
            label="Vault 저장 경로"
            ariaLabel="Vault 경로"
            value={path}
            onChange={setPath}
            disabled={busy}
            browse={isTauri() ? () => void browse() : undefined}
          />
          <div className="welcome-actions">
            <button className="primary-button" disabled={busy || !path.trim() || !name.trim()}>
              새 vault 만들기
              <ArrowRight size={17} />
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || (!isTauri() && !path.trim())}
              onClick={() => void openExisting()}
            >
              <FolderOpen size={16} />
              기존 vault 열기
            </button>
          </div>
        </form>
        <button
          className="demo-link"
          disabled={busy || !path.trim() || !name.trim()}
          onClick={() => void run(() => create(path, name, true))}
        >
          예제 노트와 DB를 담아 시작하기 <ArrowRight size={14} />
        </button>
        {(localError || error || location.error) && (
          <p role="alert" className="inline-error">
            {localError || error || location.error}
          </p>
        )}
        <div className="welcome-foot">
          <span>계정 없이</span>
          <i />
          <span>오프라인에서도</span>
          <i />
          <span>키보드 중심으로</span>
        </div>
      </div>
      <div className="welcome-bottom">
        FOLIO + TRAIL <span>기록을 따라, 생각을 잇다.</span>
      </div>
    </div>
  );
}
