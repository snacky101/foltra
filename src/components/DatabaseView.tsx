import { ContextMenu } from './ContextMenu';
import { Select } from './Select';
import { DateField } from './DateField';
import { ColumnHeader } from './ColumnHeader';
import { clampColumnWidth, defaultColumnWidth, readColumnWidths } from '../lib/columnWidths';
import { useCallback, useEffect, useState, useRef } from 'react';
import {
  Plus,
  Table2,
  Columns3,
  CalendarDays,
  FileText,
  ArrowUpRight,
  Filter,
  Trash2,
  MoreHorizontal,
} from 'lucide-react';
import { call } from '../lib/api';
import type { Database, Row, Property, QueryResult, Workspace, Query } from '../lib/types';

function Cell({
  property,
  row,
  save,
}: {
  property: Property;
  row: Row;
  save: (value: unknown, revision: string) => Promise<void>;
}) {
  const value = row.values[property.id] ?? '';
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  const editing = useRef(false);
  const revision = useRef(row.revision);
  useEffect(() => {
    if (!editing.current) {
      setDraft(String(value));
      revision.current = row.revision;
    }
  }, [value, row.revision]);
  const commit = async (value: unknown) => {
    try {
      await save(value, revision.current);
      setInvalid(false);
      editing.current = false;
    } catch {
      setInvalid(true);
    }
  };
  if (property.type === 'checkbox')
    return (
      <input
        type="checkbox"
        aria-label={`${property.name} ${row.values.title ?? ''}`}
        checked={!!value}
        onChange={(e) => {
          revision.current = row.revision;
          void commit(e.target.checked);
        }}
      />
    );
  if (property.type === 'status' || property.type === 'select')
    return (
      <Select
        aria-label={`${property.name} ${row.values.title ?? ''}`}
        className={`status-select status-${String(value).toLowerCase().replaceAll(' ', '-')}`}
        value={value as string}
        onValueChange={(value) => {
          revision.current = row.revision;
          void commit(value);
        }}
      >
        <option value="">—</option>
        {property.options?.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </Select>
    );
  if (property.type === 'date')
    return (
      <DateField
        value={draft}
        label={`${property.name} ${row.values.title ?? ''}`}
        invalid={invalid}
        onChange={setDraft}
        onFocus={() => {
          editing.current = true;
          revision.current = row.revision;
        }}
        onCommit={(next) => {
          if (next === String(value)) {
            editing.current = false;
            return;
          }
          void commit(next);
        }}
      />
    );
  return (
    <input
      aria-label={`${property.name} ${row.values.title ?? ''}`}
      aria-invalid={invalid}
      className={invalid ? 'invalid' : ''}
      type={property.type === 'number' ? 'number' : 'text'}
      value={draft}
      onFocus={() => {
        editing.current = true;
        revision.current = row.revision;
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === String(value)) {
          editing.current = false;
          return;
        }
        void commit(property.type === 'number' ? (draft === '' ? null : Number(draft)) : draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(String(value));
          editing.current = false;
          setInvalid(false);
        }
      }}
    />
  );
}

interface Props {
  vault: string;
  workspace: Workspace;
  database: Database;
  refresh: () => Promise<void>;
  openBody: (row: Row) => void;
  addProperty: () => void;
  editProperty: (property: Property) => void;
  onError: (e: unknown) => void;
  initialQuery?: Query;
}
export function DatabaseView({
  vault,
  workspace,
  database,
  refresh,
  openBody,
  addProperty,
  editProperty,
  onError,
  initialQuery,
}: Props) {
  const [layout, setLayout] = useState<'table' | 'board' | 'timeline'>('table');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState('');
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [page, setPage] = useState(0);
  const [rowMenu, setRowMenu] = useState<{ row: Row; x: number; y: number } | null>(null);
  const closeRowMenu = useCallback(() => setRowMenu(null), []);
  const widthKey = `foltra:column-widths:${workspace.vault.id}:${database.id}`;
  const [widths, setWidths] = useState(() => readColumnWidths(localStorage.getItem(widthKey)));
  useEffect(() => {
    localStorage.setItem(widthKey, JSON.stringify(widths));
  }, [widthKey, widths]);
  const columnWidth = (property: Property) =>
    clampColumnWidth(
      typeof widths[property.id] === 'number' ? widths[property.id] : defaultColumnWidth(property),
      property,
    );
  const tableWidth = 34 + database.properties.reduce((sum, property) => sum + columnWidth(property), 0);
  const schema = JSON.stringify(database.properties);
  useEffect(() => {
    setFilter('');
    setPage(0);
  }, [schema]);
  const status = database.properties.find((p) => p.type === 'status' || p.type === 'select');
  const title =
    database.properties.find((p) => p.id === 'title') ?? database.properties.find((p) => p.type === 'text');
  const bodyColumn = title ?? database.properties[0];
  useEffect(() => {
    setFilter('');
    setSort('');
    setSearch('');
    setPage(0);
    setResult(null);
  }, [database.id]);
  useEffect(() => {
    let canceled = false;
    const filters = [...(initialQuery?.filters ?? [])];
    if (filter && status) filters.push({ property: status.id, op: 'eq', value: filter });
    if (search && title) filters.push({ property: title.id, op: 'contains', value: search });
    const timeout = setTimeout(
      () => {
        void call<QueryResult>(vault, 'query.run', {
          databaseId: database.id,
          filters,
          ...(sort ? { sort } : {}),
          limit: 100,
          offset: page * 100,
        })
          .then((value) => {
            if (!canceled) setResult(value);
          })
          .catch(onError);
      },
      search ? 180 : 0,
    );
    return () => {
      canceled = true;
      clearTimeout(timeout);
    };
  }, [vault, database.id, schema, workspace.records, filter, sort, search, page, initialQuery]);
  const mutate = async (command: string, args: object) => {
    try {
      await call(vault, command, args);
      await refresh();
    } catch (e) {
      onError(e);
      throw e;
    }
  };
  const create = () =>
    void mutate('record.create', {
      databaseId: database.id,
      values: {
        ...(title ? { [title.id]: 'Untitled' } : {}),
        ...(filter && status ? { [status.id]: filter } : {}),
      },
    }).catch(() => {});
  const rows = result?.rows ?? [];
  return (
    <section className="database-view page-view">
      <div className="eyebrow">STRUCTURE YOUR THOUGHTS</div>
      <div className="page-heading">
        <h1>{database.name}</h1>
        <button className="primary-button" onClick={create}>
          <Plus size={16} /> 새 항목
        </button>
      </div>
      <p className="page-description">데이터부터 기록하세요. 본문은 필요할 때 덧붙일 수 있어요.</p>
      <div className="view-tabs">
        {(
          [
            { id: 'table', label: '표', icon: Table2 },
            { id: 'board', label: '보드', icon: Columns3 },
            { id: 'timeline', label: '타임라인', icon: CalendarDays },
          ] as const
        ).map((tab) => (
          <button
            className={layout === tab.id ? 'active' : ''}
            key={tab.id}
            onClick={() => setLayout(tab.id)}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
        <span className="view-count">{result?.total ?? 0} records</span>
      </div>
      <div className="database-tools">
        <input
          aria-label="DB 항목 검색"
          placeholder="항목 찾기…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        {status && (
          <label>
            <Filter size={14} />
            <Select
              aria-label="상태 필터"
              value={filter}
              onValueChange={(value) => {
                setFilter(value);
                setPage(0);
              }}
            >
              <option value="">모든 상태</option>
              {status.options?.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </Select>
          </label>
        )}
        <Select aria-label="정렬 기준" value={sort} onValueChange={(value) => setSort(value)}>
          <option value="">생성 순서</option>
          {database.properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} 순
            </option>
          ))}
        </Select>
        <button className="text-button" onClick={addProperty}>
          <Plus size={14} /> 속성
        </button>
      </div>
      {rowMenu && (
        <ContextMenu
          title={String(rowMenu.row.values.title ?? '항목')}
          position={rowMenu}
          close={closeRowMenu}
          items={[
            { id: 'open', label: '본문 열기', Icon: FileText, run: () => openBody(rowMenu.row) },
            {
              id: 'delete',
              label: '휴지통으로 이동',
              Icon: Trash2,
              danger: true,
              run: () => {
                void mutate('record.delete', {
                  id: rowMenu.row.id,
                  expectedRevision: rowMenu.row.revision,
                }).catch(() => {});
              },
            },
          ]}
        />
      )}
      {layout === 'table' && (
        <div className="table-scroll">
          <table className="data-table" style={{ width: tableWidth }}>
            <colgroup>
              <col style={{ width: 34 }} />
              {database.properties.map((property) => (
                <col key={property.id} style={{ width: columnWidth(property) }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="row-index">#</th>
                {database.properties.map((p) => (
                  <ColumnHeader
                    key={p.id}
                    property={p}
                    width={columnWidth(p)}
                    edit={() => editProperty(p)}
                    resize={(width) => setWidths((current) => ({ ...current, [p.id]: width }))}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.id}
                  tabIndex={0}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.currentTarget.focus();
                    setRowMenu({ row, x: e.clientX, y: e.clientY });
                  }}
                  aria-label={`행 ${row.values.title ?? index + 1}`}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setRowMenu({ row, x: rect.left + 12, y: rect.bottom });
                    }
                    if ((workspace.settings.vim && e.key === 'j') || e.key === 'ArrowDown') {
                      e.preventDefault();
                      (e.currentTarget.nextElementSibling as HTMLElement)?.focus();
                    }
                    if ((workspace.settings.vim && e.key === 'k') || e.key === 'ArrowUp') {
                      e.preventDefault();
                      (e.currentTarget.previousElementSibling as HTMLElement)?.focus();
                    }
                    if (e.key === 'Enter') openBody(row);
                  }}
                >
                  <td className="row-index">
                    <span className="row-number">{page * 100 + index + 1}</span>
                    <button
                      className="row-menu-button"
                      aria-label={`항목 메뉴 ${row.values.title ?? index + 1}`}
                      aria-haspopup="menu"
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setRowMenu({ row, x: rect.left, y: rect.bottom });
                      }}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </td>
                  {database.properties.map((property) => (
                    <td key={property.id} data-property-id={property.id}>
                      <div className={property.id === bodyColumn?.id ? 'name-cell' : 'property-cell'}>
                        <Cell
                          key={property.type}
                          property={property}
                          row={row}
                          save={(value, revision) =>
                            mutate('record.update', {
                              id: row.id,
                              expectedRevision: revision,
                              values: { [property.id]: value },
                            })
                          }
                        />
                        {property.id === bodyColumn?.id && (
                          <button
                            className={`body-link ${row.bodyNoteId ? 'has-body' : ''}`}
                            aria-label={`본문 ${row.values.title ?? ''}`}
                            onClick={() => openBody(row)}
                          >
                            {row.bodyNoteId ? <FileText size={13} /> : <Plus size={13} />}
                            {row.bodyNoteId ? '열기' : '본문'}
                          </button>
                        )}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <button className="new-row" onClick={create}>
            <Plus size={15} /> 새 항목 추가
          </button>
        </div>
      )}
      {layout === 'board' && (
        <div className="board">
          {[...(status?.options ?? []), ''].map((group) => (
            <div className="board-column" key={group}>
              <h3>
                <span className={`status-dot status-${group.toLowerCase().replaceAll(' ', '-')}`} />
                {group || '분류 없음'}
                <small>{rows.filter((r) => String(r.values[status?.id ?? ''] ?? '') === group).length}</small>
              </h3>
              {rows
                .filter((r) => String(r.values[status?.id ?? ''] ?? '') === group)
                .map((row) => (
                  <button className="board-card" key={row.id} onClick={() => openBody(row)}>
                    <FileText size={16} />
                    <strong>{String(row.values[title?.id ?? ''] || 'Untitled')}</strong>
                    <small>{String(row.values.date ?? '')}</small>
                    <ArrowUpRight size={14} />
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
      {layout === 'timeline' && (
        <div className="timeline-list">
          {[...rows]
            .sort((a, b) => String(a.values.date ?? '9999').localeCompare(String(b.values.date ?? '9999')))
            .map((row) => (
              <button key={row.id} className="timeline-entry" onClick={() => openBody(row)}>
                <time>{String(row.values.date || '날짜 없음')}</time>
                <span className="timeline-marker" />
                <span>
                  <strong>{String(row.values[title?.id ?? ''] || 'Untitled')}</strong>
                  <small>{String(row.values[status?.id ?? ''] ?? '')}</small>
                </span>
                <ArrowUpRight size={15} />
              </button>
            ))}
        </div>
      )}
      <div className="database-footer">
        <span>
          행 선택 <kbd>{workspace.settings.vim ? 'j' : '↓'}</kbd>{' '}
          <kbd>{workspace.settings.vim ? 'k' : '↑'}</kbd> · 본문 <kbd>Enter</kbd>
        </span>
        <div>
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            이전
          </button>
          <span>{page + 1} 페이지</span>
          <button disabled={(page + 1) * 100 >= (result?.total ?? 0)} onClick={() => setPage((p) => p + 1)}>
            다음
          </button>
        </div>
      </div>
    </section>
  );
}
