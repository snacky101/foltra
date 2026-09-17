import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  FileText,
  GripVertical,
  Layers3,
  Search,
} from 'lucide-react';
import { useTopics, type TopicOptions } from '../lib/useTopics';
import type { Settings, TopicBlock, TopicSort, Workspace } from '../lib/types';
import { Select } from './Select';
import { TopicFolderFilter } from './TopicFolderFilter';

const NotePreview = lazy(() => import('./NotePreview').then((module) => ({ default: module.NotePreview })));

export function TopicsView({
  workspace,
  options,
  onChange,
  toggleSources,
  openNote,
  openLink,
  updateSettings,
}: {
  workspace: Workspace;
  options: TopicOptions;
  onChange: (options: TopicOptions) => void;
  toggleSources: () => void;
  openNote: (id: string, line?: number) => void;
  openLink: (target: string) => void;
  updateSettings: (patch: Partial<Settings>) => Promise<boolean>;
}) {
  const { topics, topic, data, error, reload, saving, move, scopeKey } = useTopics(workspace, options);
  const folderFilter = workspace.settings.topicFolders ?? { include: [], exclude: [] };
  const filtered = folderFilter.include.length + folderFilter.exclude.length > 0;
  const previousScope = useRef(scopeKey);
  const [search, setSearch] = useState('');
  const [drag, setDrag] = useState<{
    source: string;
    block: TopicBlock;
    revision: string;
    sort: TopicSort;
  } | null>(null);
  const [drop, setDrop] = useState<{ target: string; placement: 'before' | 'after' } | null>(null);
  const pageHover = useRef<ReturnType<typeof setTimeout> | null>(null);
  const root = useRef<HTMLElement>(null);
  const focusCard = useRef<string | null>(null);
  const currentOptions = useRef(options);
  currentOptions.current = options;
  const cards = data?.blocks ?? [];
  // Keep the native drag source mounted while a different page is loading.
  const visibleCards = drag && !cards.some((b) => b.id === drag.source) ? [...cards, drag.block] : cards;
  const cancelPageHover = () => {
    if (pageHover.current) clearTimeout(pageHover.current);
    pageHover.current = null;
  };
  const endDrag = () => {
    setDrag(null);
    setDrop(null);
    cancelPageHover();
  };
  useEffect(() => {
    endDrag();
    return cancelPageHover;
  }, [workspace.path, topic?.id]);
  useEffect(() => {
    if (previousScope.current === scopeKey) return;
    previousScope.current = scopeKey;
    endDrag();
    focusCard.current = null;
    if (currentOptions.current.offset !== 0) onChange({ ...currentOptions.current, offset: 0 });
  }, [scopeKey, onChange]);
  useEffect(() => {
    if (drag && data && drag.revision !== data.orderRevision) endDrag();
  }, [data?.orderRevision, drag]);
  useEffect(() => {
    if (!data || !focusCard.current) return;
    const card = [...(root.current?.querySelectorAll<HTMLElement>('[data-card-id]') ?? [])].find(
      (el) => el.dataset.cardId === focusCard.current,
    );
    card?.querySelector<HTMLButtonElement>('.topic-drag-handle')?.focus();
    focusCard.current = null;
  }, [data]);
  const reorder = async (
    source: string,
    target: string,
    placement: 'before' | 'after',
    revision: string,
    sort: TopicSort,
  ) => {
    endDrag();
    if (await move(source, target, placement, revision, sort)) {
      onChange({ ...currentOptions.current, sort: 'custom' });
    } else {
      focusCard.current = null;
    }
  };
  const hoverPage = (offset: number) => {
    if (!drag || saving || pageHover.current || !data) return;
    pageHover.current = setTimeout(() => {
      pageHover.current = null;
      setDrop(null);
      onChange({ ...options, offset });
    }, 650);
  };
  const visible = topics?.filter((t) =>
    t.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  useEffect(() => {
    if (topic && options.topicId !== topic.id) onChange({ ...options, topicId: topic.id, offset: 0 });
    else if (data && data.total > 0 && data.offset >= data.total) onChange({ ...options, offset: 0 });
  }, [topic, data, options, onChange]);
  return (
    <section ref={root} className="page-view topics-view" aria-label="주제 모음">
      <div className="page-heading">
        <h1>주제 모음</h1>
      </div>
      <p className="topics-description">
        <code>[[주제]]</code>가 담긴 문단과 목록을 모아 봅니다. 목록은 하위 항목까지 포함합니다.
      </p>
      <TopicFolderFilter folders={workspace.folders} value={folderFilter} updateSettings={updateSettings} />
      {error && (
        <div className="topics-error" role="alert">
          {error}
          <button className="secondary-button" onClick={reload}>
            다시 시도
          </button>
        </div>
      )}
      {!topics && !error && (
        <p className="empty-small" role="status">
          주제를 불러오는 중…
        </p>
      )}
      {topics?.length === 0 && filtered && (
        <div className="topics-empty">
          <Layers3 size={28} />
          <h2>선택한 폴더에 주제가 없습니다.</h2>
          <p>폴더 선택을 바꾸거나 필터를 해제해 다른 노트의 주제를 볼 수 있습니다.</p>
        </div>
      )}
      {topics?.length === 0 && !filtered && (
        <div className="topics-empty">
          <Layers3 size={28} />
          <h2>하나의 주제, 여러 날의 기록</h2>
          <p>
            문단이나 목록에 [[Foo]]를 적으면 같은 주제의 기록이 카드로 모입니다.
            <br />
            주제 노트를 미리 만들 필요는 없습니다.
          </p>
          <pre>{'오늘 떠오른 아이디어 [[Foo]]\n\n- 더 알아볼 내용 [[Foo]]\n  - 살펴볼 자료'}</pre>
        </div>
      )}
      {!!topics?.length && (
        <div className="topics-layout">
          <nav className="topic-navigation" aria-label="주제 선택">
            <label className="topic-search">
              <Search size={14} />
              <input
                aria-label="주제 찾기"
                placeholder="주제 찾기"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div className="topic-options">
              {visible?.map((item) => (
                <button
                  key={item.id}
                  aria-pressed={item.id === topic?.id}
                  title={item.title}
                  onClick={() => onChange({ ...options, topicId: item.id, offset: 0, sort: null })}
                >
                  <span>{item.title}</span>
                  <small>{item.blockCount}</small>
                </button>
              ))}
              {visible?.length === 0 && <p className="empty-small">일치하는 주제가 없습니다.</p>}
            </div>
          </nav>
          <div className="topic-content" aria-busy={!data && !error}>
            <div className="topic-heading">
              <div>
                <h2>{topic?.title}</h2>
                <p>
                  {topic?.noteCount}개 노트 · {data?.total ?? topic?.blockCount}개 카드
                </p>
              </div>
              <button
                className="icon-button topic-source-toggle"
                aria-label="원본 노트 정보 표시"
                aria-pressed={options.showSources}
                title={options.showSources ? '파일명·날짜 숨기기' : '파일명·날짜 표시'}
                onClick={toggleSources}
              >
                <FileText size={16} />
              </button>
              <Select
                aria-label="주제 카드 정렬"
                value={options.sort ?? data?.sort ?? 'newest'}
                disabled={saving || !!drag}
                onValueChange={(value) =>
                  onChange({
                    ...options,
                    topicId: topic?.id ?? null,
                    offset: 0,
                    sort: value as TopicSort,
                  })
                }
              >
                <option value="newest">노트 생성일 최신순</option>
                <option value="oldest">노트 생성일 오래된순</option>
                <option value="custom">사용자 지정</option>
              </Select>
            </div>
            <p className="topic-order-hint" role="status">
              {saving
                ? '순서 저장 중…'
                : drag
                  ? '원하는 위치에 놓으세요. 이전·다음 버튼 위에서 페이지를 넘길 수 있습니다.'
                  : '손잡이를 드래그하여 순서를 바꿀 수 있습니다.'}
            </p>
            {topic?.noteId && (
              <button className="topic-note-link" onClick={() => openNote(topic.noteId!)}>
                주제 노트 열기 <ArrowUpRight size={13} />
              </button>
            )}
            {!data && !error && (
              <p className="empty-small" role="status">
                카드를 모으는 중…
              </p>
            )}
            {visibleCards.map((block, index) => (
              <article
                className={`topic-card${options.showSources ? '' : ' blocks-only'}${drag?.source === block.id ? ' dragging' : ''}${!cards.includes(block) ? ' drag-off-page' : ''}${drop?.target === block.id ? ` drop-${drop.placement}` : ''}`}
                key={block.id}
                data-card-id={block.id}
                aria-hidden={!cards.includes(block) || undefined}
                onDragOver={(event) => {
                  if (!drag || saving || drag.source === block.id) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  const rect = event.currentTarget.getBoundingClientRect();
                  const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                  setDrop((current) =>
                    current?.target === block.id && current.placement === placement
                      ? current
                      : { target: block.id, placement },
                  );
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null);
                }}
                onDrop={(event) => {
                  if (!drag || saving || drag.source === block.id) return;
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  void reorder(
                    drag.source,
                    block.id,
                    event.clientY < rect.top + rect.height / 2 ? 'before' : 'after',
                    drag.revision,
                    drag.sort,
                  );
                }}
              >
                <button
                  className="icon-button topic-drag-handle"
                  aria-label={`${block.noteTitle} ${block.line}행 카드 순서 이동`}
                  title="드래그하여 순서 변경 · Alt+↑/↓로 이동"
                  draggable={!saving}
                  tabIndex={cards.includes(block) ? 0 : -1}
                  disabled={saving}
                  onDragStart={(event) => {
                    if (!data) {
                      event.preventDefault();
                      return;
                    }
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('application/x-foltra-topic-card', block.id);
                    event.dataTransfer.setDragImage(event.currentTarget.closest('article')!, 20, 20);
                    setDrag({ source: block.id, block, revision: data.orderRevision, sort: data.sort });
                  }}
                  onDragEnd={endDrag}
                  onKeyDown={(event) => {
                    if (!data || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
                    event.preventDefault();
                    const target = data.blocks[index + (event.key === 'ArrowUp' ? -1 : 1)];
                    if (target) {
                      focusCard.current = block.id;
                      void reorder(
                        block.id,
                        target.id,
                        event.key === 'ArrowUp' ? 'before' : 'after',
                        data.orderRevision,
                        data.sort,
                      );
                    }
                  }}
                >
                  <GripVertical size={15} />
                </button>
                {options.showSources ? (
                  <header>
                    <button
                      className="topic-source"
                      onClick={() => openNote(block.noteId, block.line)}
                      aria-label={`${block.noteTitle} ${block.line}행 원본 열기`}
                    >
                      <span>{block.noteTitle}</span>
                      <small>{block.line}행</small>
                      <ArrowUpRight size={14} />
                    </button>
                    <time dateTime={block.createdAt} title="원본 노트 생성일">
                      {new Date(block.createdAt).toLocaleDateString('ko-KR')}
                    </time>
                  </header>
                ) : (
                  <button
                    className="icon-button topic-origin-action"
                    aria-label={`${block.noteTitle} ${block.line}행 원본 열기`}
                    title={`${block.noteTitle} · ${block.line}행 원본 열기`}
                    onClick={() => openNote(block.noteId, block.line)}
                  >
                    <ArrowUpRight size={14} />
                  </button>
                )}
                <Suspense fallback={<p className="empty-small">내용을 불러오는 중…</p>}>
                  <NotePreview
                    body={block.body}
                    workspace={workspace}
                    openNote={openNote}
                    openLink={openLink}
                    executeQueries={false}
                  />
                </Suspense>
              </article>
            ))}
            {data && data.blocks.length === 0 && <p className="empty-small">표시할 카드가 없습니다.</p>}
            {data && (data.total > data.limit || data.offset > 0) && (
              <div className="topic-pagination">
                <button
                  className="secondary-button"
                  disabled={data.offset === 0}
                  onDragOver={(event) => {
                    if (drag) {
                      event.preventDefault();
                      hoverPage(Math.max(0, data.offset - data.limit));
                    }
                  }}
                  onDragLeave={cancelPageHover}
                  onClick={() =>
                    onChange({
                      ...options,
                      topicId: topic!.id,
                      offset: Math.max(0, data.offset - data.limit),
                    })
                  }
                >
                  <ChevronLeft size={14} /> 이전
                </button>
                <span>
                  {data.total ? data.offset + 1 : 0}–{Math.min(data.offset + data.blocks.length, data.total)}{' '}
                  / {data.total}
                </span>
                <button
                  className="secondary-button"
                  disabled={data.offset + data.limit >= data.total}
                  onDragOver={(event) => {
                    if (drag) {
                      event.preventDefault();
                      hoverPage(data.offset + data.limit);
                    }
                  }}
                  onDragLeave={cancelPageHover}
                  onClick={() =>
                    onChange({ ...options, topicId: topic!.id, offset: data.offset + data.limit })
                  }
                >
                  다음 <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
