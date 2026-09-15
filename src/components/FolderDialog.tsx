import { useCallback, useRef, useState } from 'react';
import { call, CoreError } from '../lib/api';
import type { Folder, NoteSummary } from '../lib/types';
import { Modal } from './Modal';
import { FolderSelect } from './FolderSelect';

type Target =
  | { kind: 'delete'; folder: Folder }
  | { kind: 'move'; note: NoteSummary; submit: (folderId: string) => Promise<void> };
export function FolderDialog({
  target,
  folders,
  vault,
  close,
  refresh,
}: {
  target: Target;
  folders: Folder[];
  vault: string;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const [location, setLocation] = useState(target.kind === 'move' ? (target.note.folderId ?? '') : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const closeRef = useRef(close);
  closeRef.current = close;
  const dismiss = useCallback(() => {
    if (!busy.current) closeRef.current();
  }, []);
  return (
    <Modal title={target.kind === 'move' ? '노트 이동' : '빈 폴더 삭제'} close={dismiss}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy.current) return;
          busy.current = true;
          setSaving(true);
          setError('');
          try {
            if (target.kind === 'move') await target.submit(location);
            else {
              await call(vault, 'folder.delete', {
                id: target.folder.id,
                expectedRevision: target.folder.revision,
              });
              await refresh();
            }
            closeRef.current();
          } catch (e) {
            setError(
              e instanceof CoreError && e.code === 'folder_not_empty'
                ? '노트나 하위 폴더가 남아 있습니다. 내용을 이동한 뒤 삭제하세요.'
                : e instanceof CoreError && e.code === 'conflict'
                  ? '다른 곳에서 내용이 변경되었습니다. 취소한 뒤 최신 상태를 확인하세요.'
                  : (e as Error).message,
            );
          } finally {
            busy.current = false;
            setSaving(false);
          }
        }}
      >
        {target.kind === 'move' ? (
          <>
            <FolderSelect folders={folders} value={location} onChange={setLocation} />
            <p className="muted">“{target.note.title}”의 본문과 연결은 유지됩니다.</p>
          </>
        ) : (
          <p className="muted">
            “{target.folder.name}” 폴더를 삭제합니다. 비어 있는 폴더만 삭제할 수 있습니다.
          </p>
        )}
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={dismiss} disabled={saving}>
            취소
          </button>
          <button className="primary-button" disabled={saving}>
            {saving ? '저장 중…' : target.kind === 'move' ? '이동' : '삭제'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
