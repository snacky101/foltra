import { useState } from 'react';
import { CoreError } from '../lib/api';
import type { DatabaseInspection } from '../lib/useDatabaseActions';
import { Modal } from './Modal';

export function DeleteDatabaseDialog({
  snapshot,
  busy,
  confirm,
  close,
}: {
  snapshot: DatabaseInspection;
  busy: boolean;
  confirm: () => Promise<void>;
  close: () => void;
}) {
  const [error, setError] = useState('');
  return (
    <Modal title="데이터베이스를 휴지통으로 이동" close={close}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setError('');
          try {
            await confirm();
          } catch (error) {
            setError(
              error instanceof CoreError && error.code === 'conflict'
                ? '데이터베이스나 행이 변경되었습니다. 취소한 뒤 최신 내용을 확인하고 다시 시도하세요.'
                : (error as Error).message,
            );
          }
        }}
      >
        <p>
          “{snapshot.database.name}” 데이터베이스와 {snapshot.recordCount}개 행을 휴지통으로 옮깁니다.
        </p>
        <p className="muted">
          연결된 노트는 유지됩니다. 데이터베이스와 행은 휴지통에서 함께 복원할 수 있습니다.
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={close} disabled={busy}>
            취소
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? '이동 중…' : '휴지통으로 이동'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
