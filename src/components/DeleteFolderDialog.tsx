import { useCallback, useEffect, useRef, useState } from 'react';
import { call, CoreError } from '../lib/api';
import type { Folder } from '../lib/types';
import { Modal } from './Modal';

interface FolderInspection {
  folder: Folder;
  revision: string;
  folderCount: number;
  noteCount: number;
}

// FolderDialog remounts this confirmation when its vault or folder changes.
export function DeleteFolderDialog({
  folder,
  vault,
  save,
  refresh,
  close,
  onDeleted,
}: {
  folder: Folder;
  vault: string;
  save: () => Promise<boolean>;
  refresh: () => Promise<void>;
  close: () => void;
  onDeleted?: () => void;
}) {
  const [snapshot, setSnapshot] = useState<FolderInspection | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const busy = useRef(false);
  const active = useRef(false);
  const preparation = useRef<Promise<FolderInspection | null> | null>(null);
  const callbacks = useRef({ save, refresh, close, onDeleted });
  callbacks.current = { save, refresh, close, onDeleted };
  const dismiss = useCallback(() => {
    if (!busy.current) callbacks.current.close();
  }, []);

  useEffect(() => {
    active.current = true;
    let current = true;
    // Reuse the preparation in StrictMode and when parent callback identities change.
    preparation.current ??= (async () => {
      if (!(await callbacks.current.save()))
        throw new Error('노트의 변경사항을 저장하지 못했습니다. 취소한 뒤 저장 상태를 확인하세요.');
      if (!active.current) return null;
      return call<FolderInspection>(vault, 'folder.inspect', { id: folder.id });
    })();
    void preparation.current.then(
      (value) => {
        if (current) setSnapshot(value);
      },
      (reason: Error) => {
        if (current) setError(reason.message);
      },
    );
    return () => {
      current = false;
      active.current = false;
    };
  }, [vault, folder.id]);

  return (
    <Modal title="폴더를 휴지통으로 이동" close={dismiss}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!snapshot || conflicted || busy.current) return;
          busy.current = true;
          setSaving(true);
          setError('');
          try {
            await call(vault, 'folder.delete', {
              id: snapshot.folder.id,
              expectedRevision: snapshot.revision,
            });
            if (!active.current) return;
            await callbacks.current.refresh();
            if (!active.current) return;
            callbacks.current.close();
            callbacks.current.onDeleted?.();
          } catch (reason) {
            if (!active.current) return;
            const conflict = reason instanceof CoreError && reason.code === 'conflict';
            setConflicted(conflict);
            setError(
              conflict
                ? '폴더나 노트가 변경되었습니다. 취소한 뒤 최신 내용을 확인하고 다시 시도하세요.'
                : (reason as Error).message,
            );
          } finally {
            busy.current = false;
            if (active.current) setSaving(false);
          }
        }}
      >
        {snapshot ? (
          <>
            <p>
              “{snapshot.folder.name}” 폴더와 하위 폴더 {snapshot.folderCount}개, 노트 {snapshot.noteCount}
              개를 휴지통으로 옮깁니다.
            </p>
            <p className="muted">폴더와 안의 노트는 휴지통에서 함께 복원할 수 있습니다.</p>
          </>
        ) : !error ? (
          <p role="status">폴더의 내용을 확인하는 중…</p>
        ) : null}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={dismiss} disabled={saving}>
            취소
          </button>
          <button className="primary-button" disabled={!snapshot || saving || conflicted}>
            {saving ? '이동 중…' : '휴지통으로 이동'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
