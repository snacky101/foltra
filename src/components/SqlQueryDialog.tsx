import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Modal } from './Modal';
import { call } from '../lib/api';
import { sqlQueryMarkdown, type SqlCatalog } from '../lib/sqlQuery';
import type { Workspace } from '../lib/types';

export function SqlQueryDialog({
  workspace,
  insert,
  close,
}: {
  workspace: Workspace;
  insert: (text: string) => void;
  close: () => void;
}) {
  const vault = workspace.path;
  const revision = useMemo(() => JSON.stringify(workspace.databases), [workspace.databases]);
  const identity = JSON.stringify([vault, revision]);
  const [state, setState] = useState<{ identity: string; catalog?: SqlCatalog; error?: string }>({
    identity,
  });
  useEffect(() => {
    let active = true;
    void call<SqlCatalog>(vault, 'query.catalog')
      .then((catalog) => {
        if (active) setState({ identity, catalog });
      })
      .catch((error: Error) => {
        if (active) setState({ identity, error: error.message });
      });
    return () => {
      active = false;
    };
  }, [vault, identity]);
  const current = state.identity === identity ? state : undefined;
  return (
    <Modal title="노트에 SQL 쿼리 넣기" close={close}>
      <p className="muted">
        데이터베이스와 컬럼 이름으로 조회합니다. 삽입한 SQL에서 필터·정렬·집계를 바꾸면 결과에 반영됩니다.
      </p>
      {current?.error ? (
        <p className="inline-error" role="alert">
          {current.error}
        </p>
      ) : !current?.catalog ? (
        <p role="status">데이터베이스 불러오는 중…</p>
      ) : (
        <>
          <div className="choice-list sql-query-choices">
            {current.catalog.tables.map((table) => (
              <button
                key={table.databaseId}
                onClick={() => {
                  insert(sqlQueryMarkdown(table.sql));
                  close();
                }}
              >
                <span>
                  <strong>{table.name}</strong>
                  <small>
                    {table.columns
                      .filter((column) => column.propertyId !== null)
                      .map((column) => column.name)
                      .join(' · ')}
                  </small>
                </span>
                <ArrowUpRight size={14} />
              </button>
            ))}
          </div>
          {!current.catalog.tables.length && <p>먼저 데이터베이스를 만들어 주세요.</p>}
        </>
      )}
    </Modal>
  );
}
