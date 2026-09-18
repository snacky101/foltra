import { useEffect, useRef, useState } from 'react';
import { call } from '../lib/api';
import type { Database } from '../lib/types';
import type { DatabaseInspection } from '../lib/useDatabaseActions';

export function DatabaseTitle({
  vault,
  database,
  refresh,
  onError,
}: {
  vault: string;
  database: Database;
  refresh: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [draft, setDraft] = useState(database.name);
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const session = useRef<Promise<DatabaseInspection | null> | null>(null);
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!session.current && !saving.current) setDraft(database.name);
  }, [database.name]);
  const commit = async (raw: string) => {
    const snapshot = session.current;
    if (!snapshot || saving.current) return;
    const name = raw.trim();
    if (name === database.name) {
      session.current = null;
      setInvalid(false);
      setDraft(database.name);
      return;
    }
    if (!name) {
      setInvalid(true);
      onError(new Error('데이터베이스 이름을 입력하세요.'));
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
      const original = await snapshot;
      if (!original) {
        if (mounted.current) setInvalid(true);
        return;
      }
      if (original.database.name !== database.name)
        throw new Error('데이터베이스 이름이 변경됐습니다. 새로고침 후 다시 변경하세요.');
      await call(vault, 'database.rename', { id: database.id, name, expectedRevision: original.revision });
      session.current = null;
      if (mounted.current) {
        setInvalid(false);
        setDraft(name);
        await refresh();
      }
    } catch (error) {
      if (mounted.current) {
        setInvalid(true);
        onError(error);
      }
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <input
      className="database-title"
      aria-label="데이터베이스 제목"
      title="클릭해서 이름 변경"
      value={draft}
      readOnly={busy}
      aria-busy={busy}
      aria-invalid={invalid}
      onFocus={() => {
        if (saving.current || session.current) return;
        const inspection = call<DatabaseInspection>(vault, 'database.inspect', { id: database.id }).catch(
          (error) => {
            if (session.current === inspection) session.current = null;
            if (mounted.current) {
              setInvalid(true);
              onError(error);
            }
            return null;
          },
        );
        session.current = inspection;
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        setInvalid(false);
      }}
      onBlur={(event) => void commit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape' && !busy) {
          event.preventDefault();
          event.stopPropagation();
          session.current = null;
          setInvalid(false);
          setDraft(database.name);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
