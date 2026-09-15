import { useCallback, useRef, useState } from 'react';
import { ArrowLeft, Check, FolderOpen, Plus } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { open as chooseDirectory } from '@tauri-apps/plugin-dialog';
import { Modal } from './Modal';
import type { RecentVault } from '../lib/recentVaults';
import { useVaultLocation } from '../lib/useVaultLocation';
import { VaultPathField } from './VaultPathField';

interface Props {
  current: string;
  recent: RecentVault[];
  close: () => void;
  open: (path: string) => Promise<void>;
  create: (path: string, name: string, demo: boolean) => Promise<void>;
}
export function VaultPicker({ current, recent, close, open, create }: Props) {
  const [step, setStep] = useState<'list' | 'open' | 'create'>('list');
  const [openPath, setOpenPath] = useState('');
  const location = useVaultLocation(current || recent[0]?.path || '');
  const { name, setName } = location;
  const path = step === 'create' ? location.path : openPath;
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const dismiss = useCallback(() => {
    if (!busyRef.current) close();
  }, [close]);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const browse = async () => {
    try {
      const folder = await chooseDirectory({
        directory: true,
        multiple: false,
        title: step === 'create' ? '새 Vault를 만들 상위 폴더 선택' : '기존 Foltra vault 선택',
        defaultPath: (step === 'create' ? location.directory : openPath || current) || undefined,
      });
      if (folder) {
        if (step === 'create') location.selectDirectory(folder);
        else setOpenPath(folder);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title={step === 'list' ? 'Vault 선택' : step === 'open' ? '다른 vault 열기' : '새 vault 만들기'}
      close={dismiss}
      className="vault-picker"
    >
      {step === 'list' ? (
        <>
          <p className="muted">이 기기에서 열었던 공간</p>
          <div className="vault-picker-list">
            {recent.map((vault) => (
              <button
                key={vault.path}
                className="vault-picker-item"
                disabled={busy}
                aria-label={`Vault ${vault.name} 열기`}
                onClick={() => (vault.path === current ? close() : void run(() => open(vault.path)))}
              >
                <FolderOpen size={20} />
                <span>
                  <strong>{vault.name}</strong>
                  <small>{vault.path}</small>
                </span>
                {vault.path === current && (
                  <span className="vault-current">
                    <Check size={14} />
                    현재
                  </span>
                )}
              </button>
            ))}
            {!recent.length && <p className="muted">아직 등록된 vault가 없습니다.</p>}
          </div>
          <div className="vault-picker-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setStep('open');
                setError('');
              }}
            >
              <FolderOpen size={16} />
              다른 vault 열기
            </button>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => {
                setStep('create');
                setError('');
              }}
            >
              <Plus size={16} />새 vault 만들기
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => (step === 'open' ? open(path) : create(path, name, demo)));
          }}
        >
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              setStep('list');
              setError('');
            }}
          >
            <ArrowLeft size={14} />
            목록으로
          </button>
          {step === 'create' && (
            <label className="form-field">
              Vault 이름
              <input
                autoFocus
                aria-label="새 Vault 이름"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={busy}
              />
            </label>
          )}
          <VaultPathField
            label={step === 'create' ? 'Vault 저장 경로' : 'Vault 폴더'}
            ariaLabel="선택할 Vault 경로"
            autoFocus={step === 'open'}
            value={path}
            onChange={step === 'create' ? location.setPath : setOpenPath}
            disabled={busy}
            browse={isTauri() ? () => void browse() : undefined}
          />
          {step === 'create' && (
            <label className="vault-example-choice">
              <input
                type="checkbox"
                checked={demo}
                onChange={(e) => setDemo(e.target.checked)}
                disabled={busy}
              />
              예제 노트와 데이터베이스 포함
            </label>
          )}
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={dismiss} disabled={busy}>
              취소
            </button>
            <button
              className="primary-button"
              disabled={busy || !path.trim() || (step === 'create' && !name.trim())}
            >
              {busy ? '여는 중…' : step === 'open' ? 'Vault 열기' : '만들기'}
            </button>
          </div>
        </form>
      )}
      {(error || (step === 'create' && location.error)) && (
        <p className="inline-error" role="alert">
          {error || location.error}
        </p>
      )}
    </Modal>
  );
}
