import { useEffect, useMemo, useState } from 'react';
import { Table2 } from 'lucide-react';
import { call } from '../lib/api';
import type { SqlResult } from '../lib/sqlQuery';
import type { Workspace } from '../lib/types';

export function SqlQuery({ source, workspace }: { source: string; workspace: Workspace }) {
  const vault = workspace.path;
  const identity = JSON.stringify([vault, source]);
  const revision = useMemo(
    () => JSON.stringify([workspace.databases, workspace.records]),
    [workspace.databases, workspace.records],
  );
  const [state, setState] = useState<{ identity: string; result?: SqlResult; error?: string }>({ identity });
  useEffect(() => {
    let active = true;
    setState((previous) => ({
      identity,
      result: previous.identity === identity ? previous.result : undefined,
    }));
    void call<SqlResult>(vault, 'query.sql', { sql: source })
      .then((result) => {
        if (active) setState({ identity, result });
      })
      .catch((error: Error) => {
        if (active) setState({ identity, error: error.message });
      });
    return () => {
      active = false;
    };
  }, [source, vault, identity, revision]);
  const current = state.identity === identity ? state : undefined;
  if (current?.error)
    return (
      <div className="query-error" role="alert">
        {current.error}
      </div>
    );
  const result = current?.result;
  if (!result)
    return (
      <div className="embedded-query query-status" role="status">
        SQL 조회 중…
      </div>
    );
  return (
    <div className="embedded-query">
      <div className="embedded-heading">
        <Table2 size={16} />
        <strong>SQL</strong>
        <span>{result.truncated ? `처음 ${result.rows.length}개 행` : `${result.rows.length}개 행`}</span>
        <span className="live-label">LIVE</span>
      </div>
      <div className="table-scroll">
        <table aria-label="SQL 조회 결과">
          <thead>
            <tr>
              {result.columns.map((column, index) => (
                <th key={index} title={column.type}>
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {result.columns.map((_column, index) => (
                  <td key={index}>
                    {row[index] === null ? (
                      <span className="muted" title="값 없음">
                        NULL
                      </span>
                    ) : (
                      row[index]
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!result.rows.length && <div className="query-status">조건에 맞는 결과가 없습니다.</div>}
      {result.truncated && (
        <div className="query-status" role="status">
          결과는 최대 {result.limit}개 행까지 표시합니다. WHERE 또는 LIMIT으로 범위를 줄여 주세요.
        </div>
      )}
    </div>
  );
}
