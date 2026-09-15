import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Search } from 'lucide-react';
import { Modal } from './Modal';
import { call } from '../lib/api';

export function SearchDialog({
  vault,
  close,
  openNote,
}: {
  vault: string;
  close: () => void;
  openNote: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; title: string; excerpt: string }[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    let active = true;
    const timeout = setTimeout(() => {
      void call<typeof results>(vault, 'search', { query })
        .then((items) => {
          if (active) {
            setResults(items);
            setSelected(0);
            setLoading(false);
          }
        })
        .catch((e) => {
          if (active) {
            setError((e as Error).message);
            setLoading(false);
          }
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [query, vault]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected, results]);
  const choose = (noteId: string) => {
    close();
    openNote(noteId);
  };
  return (
    <Modal title="기록 속에서 찾기" close={close} className="palette">
      <div className="palette-search">
        <Search size={17} />
        <input
          aria-label="노트 내용 검색"
          placeholder="제목과 본문에서 검색…"
          value={query}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={id}
          aria-activedescendant={results[selected] ? `${id}-${results[selected].id}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setResults([]);
            setSelected(0);
            setLoading(true);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected((s) =>
                Math.max(0, Math.min(results.length - 1, s + (e.key === 'ArrowDown' ? 1 : -1))),
              );
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (results[selected]) choose(results[selected].id);
            }
          }}
        />
        <kbd>esc</kbd>
      </div>
      <div
        ref={list}
        id={id}
        className="search-results"
        role="listbox"
        aria-label="내용 검색 결과"
        aria-busy={loading}
      >
        {results.map((result, index) => (
          <button
            key={result.id}
            id={`${id}-${result.id}`}
            role="option"
            aria-selected={selected === index}
            className={selected === index ? 'selected' : ''}
            tabIndex={-1}
            onMouseEnter={() => setSelected(index)}
            onClick={() => choose(result.id)}
          >
            <strong>
              {result.title}
              <ArrowUpRight size={14} />
            </strong>
            <p>{result.excerpt}</p>
          </button>
        ))}
        {loading ? (
          <p className="empty-small" role="status">
            검색 중…
          </p>
        ) : (
          !error && !results.length && <p className="empty-small">검색 결과가 없습니다.</p>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="palette-footer">
        <span>↑ ↓ 이동</span>
        <span>↵ 노트 열기</span>
      </div>
    </Modal>
  );
}
