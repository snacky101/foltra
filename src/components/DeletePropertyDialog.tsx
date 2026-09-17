import { useCallback, useEffect, useRef, useState } from 'react';
import { call, CoreError } from '../lib/api';
import type { DatabaseInspection } from '../lib/useDatabaseActions';
import { Modal } from './Modal';

export function DeletePropertyDialog({
  vault,
  databaseId,
  propertyId,
  refresh,
  close,
}: {
  vault: string;
  databaseId: string;
  propertyId: string;
  refresh: () => Promise<void>;
  close: () => void;
}) {
  const [snapshot, setSnapshot] = useState<DatabaseInspection | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    let active = true;
    mounted.current = true;
    void call<DatabaseInspection>(vault, 'database.inspect', { id: databaseId }).then(
      (snapshot) => {
        if (active) setSnapshot(snapshot);
      },
      (error) => {
        if (active) setError((error as Error).message);
      },
    );
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [vault, databaseId]);
  const dismiss = useCallback(() => {
    if (!pending.current) close();
  }, [close]);
  const property = snapshot?.database.properties.find((property) => property.id === propertyId);
  const allowed = !!property && property.id !== 'title' && snapshot!.database.properties.length > 1;
  const confirm = async () => {
    if (!snapshot || !allowed || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await call(vault, 'database.property.delete', {
        databaseId,
        propertyId,
        expectedRevision: snapshot.revision,
      });
      if (mounted.current) {
        await refresh();
        if (mounted.current) close();
      }
    } catch (error) {
      if (mounted.current)
        setError(
          error instanceof CoreError && error.code === 'conflict'
            ? '데이터베이스나 행이 변경되었습니다. 취소한 뒤 최신 내용을 확인하고 다시 시도하세요.'
            : (error as Error).message,
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <Modal title="컬럼 삭제" close={dismiss}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void confirm();
        }}
      >
        {!snapshot && !error && <p role="status">컬럼 정보를 불러오는 중…</p>}
        {snapshot && allowed && (
          <>
            <p>
              “{snapshot.database.name}”의 “{property!.name}” 컬럼을 삭제합니다.
            </p>
            <p className="muted">
              전체 {snapshot.recordCount}개 행에서 이 컬럼의 값도 함께 삭제됩니다. 연결된 노트 본문은
              유지됩니다.
            </p>
          </>
        )}
        {snapshot && !allowed && (
          <p role="alert">
            {property
              ? '이 컬럼은 삭제할 수 없습니다. 제목 컬럼과 마지막 컬럼은 유지해야 합니다.'
              : '컬럼이 변경되었거나 삭제되었습니다. 취소한 뒤 다시 확인하세요.'}
          </p>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={dismiss} disabled={busy}>
            취소
          </button>
          <button className="primary-button" disabled={busy || !allowed}>
            {busy ? '삭제 중…' : '컬럼 삭제'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
