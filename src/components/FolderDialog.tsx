import { useCallback, useRef, useState } from 'react';
import { CoreError } from '../lib/api';
import type { Folder, NoteSummary } from '../lib/types';
import { Modal } from './Modal';
import { FolderSelect } from './FolderSelect';
import { DeleteFolderDialog } from './DeleteFolderDialog';

type Target =
  | { kind: 'delete'; folder: Folder }
  | { kind: 'move'; note: NoteSummary; submit: (folderId: string) => Promise<void> };
export function FolderDialog({
  target,
  folders,
  vault,
  close,
  refresh,
  save,
  onDeleted,
}: {
  target: Target;
  folders: Folder[];
  vault: string;
  close: () => void;
  refresh: () => Promise<void>;
  save: () => Promise<boolean>;
  onDeleted?: () => void;
}) {
  if (target.kind === 'delete')
    return (
      <DeleteFolderDialog
        key={JSON.stringify([vault, target.folder.id])}
        folder={target.folder}
        vault={vault}
        save={save}
        refresh={refresh}
        close={close}
        onDeleted={onDeleted}
      />
    );
  return <MoveNoteDialog target={target} folders={folders} close={close} />;
}

function MoveNoteDialog({
  target,
  folders,
  close,
}: {
  target: Extract<Target, { kind: 'move' }>;
  folders: Folder[];
  close: () => void;
}) {
  const [location, setLocation] = useState(target.note.folderId ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const closeRef = useRef(close);
  closeRef.current = close;
  const dismiss = useCallback(() => {
    if (!busy.current) closeRef.current();
  }, []);
  return (
    <Modal title="노트 이동" close={dismiss}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy.current) return;
          busy.current = true;
          setSaving(true);
          setError('');
          try {
            await target.submit(location);
            closeRef.current();
          } catch (e) {
            setError(
              e instanceof CoreError && e.code === 'conflict'
                ? '다른 곳에서 내용이 변경되었습니다. 취소한 뒤 최신 상태를 확인하세요.'
                : (e as Error).message,
            );
          } finally {
            busy.current = false;
            setSaving(false);
          }
        }}
      >
        <FolderSelect folders={folders} value={location} onChange={setLocation} />
        <p className="muted">“{target.note.title}”의 본문과 연결은 유지됩니다.</p>
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
            {saving ? '저장 중…' : '이동'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
