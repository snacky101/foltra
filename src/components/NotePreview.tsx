import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUpRight, Table2 } from 'lucide-react';
import { call } from '../lib/api';
import { resolveWikiNote } from '../lib/wikiLinks';
import { remarkWikiLinks, wikiTarget } from '../lib/remarkWikiLinks';
import type { QueryResult, Workspace } from '../lib/types';

function EmbeddedQuery({
  source,
  vault,
  revision,
  openNote,
}: {
  source: string;
  vault: string;
  revision: unknown;
  openNote: (id: string) => void;
}) {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    try {
      const query = JSON.parse(source);
      void call<QueryResult>(vault, 'query.run', query)
        .then((value) => {
          if (active) {
            setResult(value);
            setError('');
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    } catch {
      setError('쿼리는 유효한 JSON이어야 합니다.');
    }
    return () => {
      active = false;
    };
  }, [source, vault, revision]);
  if (error) return <div className="query-error">{error}</div>;
  if (!result) return <div className="embedded-query">쿼리 불러오는 중…</div>;
  return (
    <div className="embedded-query">
      <div className="embedded-heading">
        <Table2 size={16} />
        <strong>{result.database.name}</strong>
        <span>{result.total} records</span>
        <span className="live-label">LIVE</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {result.database.properties.map((p) => (
                <th key={p.id}>{p.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.id}>
                {result.database.properties.map((p, i) => (
                  <td key={p.id}>
                    {i === 0 && row.bodyNoteId ? (
                      <button className="wiki-link" onClick={() => openNote(row.bodyNoteId!)}>
                        {String(row.values[p.id] ?? '')}
                        <ArrowUpRight size={12} />
                      </button>
                    ) : (
                      String(row.values[p.id] ?? '')
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
export function NotePreview({
  body,
  workspace,
  openNote,
  executeQueries = true,
}: {
  body: string;
  workspace: Workspace;
  openNote: (id: string) => void;
  executeQueries?: boolean;
}) {
  return (
    <div className="markdown-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkWikiLinks]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('#foltra-')) {
              const target = wikiTarget(href);
              const note = resolveWikiNote(workspace.notes, target);
              const record = target?.startsWith('record:')
                ? workspace.records.find((r) => r.id === target.slice(7))
                : undefined;
              const noteId = note?.id ?? record?.bodyNoteId;
              return (
                <button
                  className={`wiki-link ${noteId ? '' : 'unresolved'}`}
                  onClick={() => noteId && openNote(noteId)}
                  title={noteId ? '연결된 노트 열기' : '대상을 찾을 수 없는 링크'}
                >
                  {children}
                  <ArrowUpRight size={12} />
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          img: ({ alt }) => (
            <span className="blocked-image">이미지: {alt || '외부 이미지'} (자동 로드하지 않음)</span>
          ),
          pre: ({ children }) => <div className="code-container">{children}</div>,
          code: ({ className, children }) =>
            executeQueries && className === 'language-foltra-query' ? (
              <EmbeddedQuery
                source={String(children)}
                vault={workspace.path}
                revision={workspace.records}
                openNote={openNote}
              />
            ) : (
              <code className={className}>{children}</code>
            ),
        }}
      >
        {body || '*아직 작성한 내용이 없습니다.*'}
      </ReactMarkdown>
    </div>
  );
}
