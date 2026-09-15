import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, Layers3, Search } from 'lucide-react';
import { useTopics, type TopicOptions } from '../lib/useTopics';
import type { Workspace } from '../lib/types';
import { Select } from './Select';

const NotePreview = lazy(() => import('./NotePreview').then((module) => ({ default: module.NotePreview })));

export function TopicsView({
  workspace,
  options,
  onChange,
  openNote,
}: {
  workspace: Workspace;
  options: TopicOptions;
  onChange: (options: TopicOptions) => void;
  openNote: (id: string, line?: number) => void;
}) {
  const { topics, topic, data, error, reload } = useTopics(workspace, options);
  const [search, setSearch] = useState('');
  const visible = topics?.filter((t) =>
    t.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  useEffect(() => {
    if (topic && options.topicId !== topic.id) onChange({ ...options, topicId: topic.id, offset: 0 });
    else if (data && data.total > 0 && data.offset >= data.total) onChange({ ...options, offset: 0 });
  }, [topic, data, options, onChange]);
  return (
    <section className="page-view topics-view" aria-label="주제 모음">
      <div className="page-heading">
        <h1>주제 모음</h1>
      </div>
      <p className="topics-description">
        목록의 <code>[[주제]]</code> 링크를 따라, 하위 항목까지 한곳에 모아 봅니다.
      </p>
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
      {topics?.length === 0 && (
        <div className="topics-empty">
          <Layers3 size={28} />
          <h2>하나의 주제, 여러 날의 기록</h2>
          <p>
            노트에 아래처럼 적으면 Foo의 항목과 하위 목록이 하나의 카드로 모입니다.
            <br />
            주제 노트를 미리 만들 필요는 없습니다.
          </p>
          <pre>{'- 오늘 떠오른 아이디어 [[Foo]]\n  - 살펴볼 자료\n  - 다음에 해볼 일'}</pre>
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
                  onClick={() => onChange({ ...options, topicId: item.id, offset: 0 })}
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
              <Select
                aria-label="주제 카드 정렬"
                value={options.descending ? 'newest' : 'oldest'}
                onValueChange={(value) =>
                  onChange({
                    ...options,
                    topicId: topic?.id ?? null,
                    offset: 0,
                    descending: value === 'newest',
                  })
                }
              >
                <option value="newest">노트 생성일 최신순</option>
                <option value="oldest">노트 생성일 오래된순</option>
              </Select>
            </div>
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
            {data?.blocks.map((block) => (
              <article className="topic-card" key={`${block.noteId}:${block.line}`}>
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
                <Suspense fallback={<p className="empty-small">내용을 불러오는 중…</p>}>
                  <NotePreview
                    body={block.body}
                    workspace={workspace}
                    openNote={openNote}
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
