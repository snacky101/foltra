import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from './api';
import type { Database } from './types';

export type DatabaseAction = 'open' | 'rename' | 'new-record' | 'delete';
export interface DatabaseInspection {
  database: Database;
  revision: string;
  recordCount: number;
}

export function useDatabaseActions(
  vault: string,
  saveNote: () => Promise<boolean>,
  refresh: () => Promise<void>,
  openDatabase: (id: string) => Promise<void>,
  deleted: (id: string) => void,
  notify: (message: string) => void,
  enabled = true,
) {
  const [renaming, setRenaming] = useState<DatabaseInspection | null>(null);
  const [deleting, setDeleting] = useState<DatabaseInspection | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const context = useRef({ vault, enabled });
  if (context.current.vault !== vault || context.current.enabled !== enabled)
    context.current = { vault, enabled };
  const current = context.current;
  const isCurrent = () => context.current === current && current.enabled;
  useEffect(() => {
    setRenaming(null);
    setDeleting(null);
  }, [vault, enabled]);
  const cancelRename = useCallback(() => {
    if (!inFlight.current) setRenaming(null);
  }, []);
  const closeDelete = useCallback(() => {
    if (!inFlight.current) setDeleting(null);
  }, []);
  const perform = async (action: () => Promise<void>) => {
    if (inFlight.current || !isCurrent()) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const run = (action: DatabaseAction, database: Database) =>
    perform(async () => {
      if (action === 'open') {
        await openDatabase(database.id);
        return;
      }
      if (action === 'new-record') {
        if (!(await saveNote())) throw new Error('현재 노트를 저장한 뒤 다시 추가하세요.');
        if (!isCurrent()) return;
        await call(vault, 'record.create', {
          databaseId: database.id,
          values: database.properties.some((p) => p.id === 'title') ? { title: 'Untitled' } : {},
        });
        if (!isCurrent()) return;
        await refresh();
        if (isCurrent()) await openDatabase(database.id);
        return;
      }
      // Capture the displayed confirmation/rename snapshot once. A conflict must
      // remain a conflict instead of silently fetching and deleting newer rows.
      const snapshot = await call<DatabaseInspection>(vault, 'database.inspect', { id: database.id });
      if (!isCurrent()) return;
      setRenaming(action === 'rename' ? snapshot : null);
      setDeleting(action === 'delete' ? snapshot : null);
    });
  const rename = (name: string) =>
    perform(async () => {
      if (!renaming) return;
      const value = name.trim();
      if (!value) throw new Error('이름을 입력하세요.');
      if (value !== renaming.database.name) {
        await call(vault, 'database.rename', {
          id: renaming.database.id,
          name: value,
          expectedRevision: renaming.revision,
        });
        if (!isCurrent()) return;
        await refresh();
      }
      if (isCurrent()) setRenaming(null);
    });
  const confirmDelete = () =>
    perform(async () => {
      if (!deleting) return;
      await call(vault, 'database.delete', {
        id: deleting.database.id,
        expectedRevision: deleting.revision,
      });
      if (!isCurrent()) return;
      await refresh();
      if (!isCurrent()) return;
      deleted(deleting.database.id);
      setDeleting(null);
      notify('데이터베이스와 행을 휴지통으로 옮겼습니다. 연결된 노트는 유지됩니다.');
    });
  return { run, renaming, rename, cancelRename, deleting, confirmDelete, closeDelete, busy };
}
