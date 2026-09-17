import { HighlightedCode } from './HighlightedCode';
import { SqlQuery } from './SqlQuery';
import { isQueryLanguage } from '../lib/sqlQuery';
import { externalLinkUrl, openExternalLink } from '../lib/openExternalLink';
import { remarkTags } from '../lib/remarkTags';
import { AttachmentImage } from './AttachmentImage';
import { TagNavigation } from '../lib/tagNavigation';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { ArrowUpRight, Table2 } from 'lucide-react';
import { call } from '../lib/api';
import { canCreateWikiNote, resolveWikiNote } from '../lib/wikiLinks';
import { remarkWikiLinks, wikiTarget } from '../lib/remarkWikiLinks';
import { remarkListSpacing } from '../lib/remarkListSpacing';
import { separateListParagraphs } from '../lib/markdownListLayout';
import type { QueryResult, Workspace } from '../lib/types';

function EmbeddedQuery({
  source,
  workspace,
  openNote,
}: {
  source: string;
  workspace: Workspace;
  openNote: (id: string) => void;
}) {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState('');
  const vault = workspace.path;
  // Note saves replace workspace arrays too; only changed query data should refetch.
  const revision = useMemo(
    () => JSON.stringify([workspace.databases, workspace.records]),
    [workspace.databases, workspace.records],
  );
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
interface NotePreviewProps {
  body: string;
  workspace: Workspace;
  openNote: (id: string) => void;
  openLink: (target: string) => void;
  executeQueries?: boolean;
  openTag?: (tag: string) => void;
}

const PreviewContext = createContext<Omit<NotePreviewProps, 'body'> | null>(null);
// Stable component identities preserve query state when a block moves or its context updates.
const markdownComponents: Components = {
  a: function PreviewLink({ href, children }) {
    const { workspace, openLink, openTag } = useContext(PreviewContext)!;
    const [error, setError] = useState('');
    if (href?.startsWith('#foltra-tag:')) {
      const tag = decodeURIComponent(href.slice('#foltra-tag:'.length));
      return openTag ? (
        <button className="tag-chip" onClick={() => openTag(tag)} title={`#${tag} 노트 찾기`}>
          {children}
        </button>
      ) : (
        <span className="tag-chip">{children}</span>
      );
    }
    if (href?.startsWith('#foltra-')) {
      const target = wikiTarget(href);
      const note = resolveWikiNote(workspace.notes, target);
      const record = target?.startsWith('record:')
        ? workspace.records.find((r) => r.id === target.slice(7))
        : undefined;
      const noteId = note?.id ?? record?.bodyNoteId;
      const creatable = target && canCreateWikiNote(workspace.notes, target);
      return (
        <button
          className={`wiki-link ${noteId ? '' : 'unresolved'}`}
          onClick={() => target && openLink(target)}
          title={
            noteId
              ? '연결된 노트 열기'
              : creatable
                ? `클릭하여 “${target}” 노트 만들기`
                : '연결 대상을 확인할 수 없습니다'
          }
        >
          {children}
          <ArrowUpRight size={12} />
        </button>
      );
    }
    const url = externalLinkUrl(href ?? '');
    if (!url) return <span>{children}</span>;
    return (
      <>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            event.preventDefault();
            setError('');
            void openExternalLink(url).catch((error: unknown) =>
              setError(error instanceof Error ? error.message : String(error)),
            );
          }}
        >
          {children}
        </a>
        {error && <span role="alert"> 링크를 열지 못했습니다: {error}</span>}
      </>
    );
  },
  img: function PreviewImage({ src, alt }) {
    const { workspace } = useContext(PreviewContext)!;
    return <AttachmentImage vault={workspace.path} source={typeof src === 'string' ? src : ''} alt={alt} />;
  },
  pre: ({ children }) => <div className="code-container">{children}</div>,
  code: function PreviewCode({ className, children }) {
    const { workspace, openNote, executeQueries } = useContext(PreviewContext)!;
    const language = className?.match(/(?:^|\s)language-(\S+)/)?.[1] ?? '';
    const source = String(children);
    if (
      executeQueries &&
      isQueryLanguage(language) &&
      (language === 'foltra-sql' || !source.trimStart().startsWith('{'))
    )
      return <SqlQuery source={source} workspace={workspace} />;
    return executeQueries && language === 'foltra-query' ? (
      <EmbeddedQuery
        key={JSON.stringify([workspace.path, String(children)])}
        source={String(children)}
        workspace={workspace}
        openNote={openNote}
      />
    ) : (
      <HighlightedCode className={className} source={String(children)} />
    );
  },
};

export function NotePreview({
  body,
  workspace,
  openNote,
  openLink,
  executeQueries = true,
  openTag,
}: NotePreviewProps) {
  const navigateTag = useContext(TagNavigation);
  const previewBody = useMemo(() => separateListParagraphs(body), [body]);
  return (
    <div className="markdown-preview">
      <PreviewContext
        value={{ workspace, openNote, openLink, executeQueries, openTag: openTag ?? navigateTag }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkTags, remarkWikiLinks, remarkBreaks, remarkListSpacing]}
          components={markdownComponents}
        >
          {previewBody || '*아직 작성한 내용이 없습니다.*'}
        </ReactMarkdown>
      </PreviewContext>
    </div>
  );
}
