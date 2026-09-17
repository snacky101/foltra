import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { frontmatterEntries, parseFrontmatter, updateFrontmatter } from '../lib/frontmatter';

function composing(event: KeyboardEvent) {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}

export function FrontmatterPanel({
  source,
  onChange,
  onEditSource,
}: {
  source: string;
  onChange?: (yaml: string) => void;
  onEditSource?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const parsed = useMemo(() => {
    try {
      return { entries: frontmatterEntries(parseFrontmatter(source)), error: '' };
    } catch (reason) {
      return { entries: [], error: (reason as Error).message };
    }
  }, [source]);
  useEffect(() => setError(''), [source]);
  const update = (key: string, value: string | null, insert = false) => {
    onChange?.(updateFrontmatter(source, key, value, insert));
  };
  return (
    <details
      className="frontmatter-panel"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="frontmatter-heading">
        <ChevronRight size={13} aria-hidden="true" />
        <span>속성</span>
        {!parsed.error && <span className="frontmatter-count">{parsed.entries.length}</span>}
        {onEditSource && (
          <button
            type="button"
            className="frontmatter-source"
            aria-label="YAML 원문 편집"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onEditSource();
            }}
          >
            YAML
          </button>
        )}
      </summary>
      <div className="frontmatter-content">
        {parsed.error ? (
          <>
            <p className="frontmatter-error" role="alert">
              {parsed.error}
            </p>
            <pre className="frontmatter-raw">{source}</pre>
          </>
        ) : (
          <>
            <div className="frontmatter-properties" role="table" aria-label="노트 속성">
              {parsed.entries.map((entry) => (
                <div className="frontmatter-row" role="row" key={entry.key}>
                  <div className="frontmatter-key" role="rowheader" title={entry.key}>
                    {entry.key}
                  </div>
                  <div className="frontmatter-cell" role="cell">
                    {onChange ? (
                      <PropertyValue
                        name={entry.key}
                        value={entry.value}
                        commit={(value) => update(entry.key, value)}
                      />
                    ) : (
                      <span className="frontmatter-value">{entry.value}</span>
                    )}
                  </div>
                  {onChange && (
                    <div role="cell">
                      <button
                        type="button"
                        className="icon-button frontmatter-delete"
                        aria-label={`${entry.key} 속성 삭제`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          try {
                            update(entry.key, null);
                          } catch (reason) {
                            setError((reason as Error).message);
                          }
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {!parsed.entries.length && <p className="frontmatter-empty">속성이 없습니다.</p>}
            {error && (
              <p className="frontmatter-error" role="alert">
                {error}
              </p>
            )}
            {onChange &&
              (adding ? (
                <NewProperty
                  add={(key, value) => {
                    update(key, value, true);
                    setAdding(false);
                  }}
                  cancel={() => setAdding(false)}
                />
              ) : (
                <button type="button" className="frontmatter-add" onClick={() => setAdding(true)}>
                  <Plus size={13} /> 속성 추가
                </button>
              ))}
          </>
        )}
      </div>
    </details>
  );
}

function PropertyValue({
  name,
  value,
  commit,
}: {
  name: string;
  value: string;
  commit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  const submitted = useRef<string | null>(null);
  const skipBlur = useRef(false);
  useEffect(() => {
    setDraft(value);
    setError('');
    submitted.current = null;
  }, [value]);
  const save = () => {
    if (draft === value || draft === submitted.current) return true;
    try {
      commit(draft);
      submitted.current = draft;
      setError('');
      return true;
    } catch (reason) {
      setError((reason as Error).message);
      return false;
    }
  };
  return (
    <>
      <textarea
        className="frontmatter-input"
        aria-label={`${name} 값`}
        aria-invalid={!!error}
        value={draft}
        rows={Math.min(4, Math.max(1, draft.split('\n').length))}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (skipBlur.current) skipBlur.current = false;
          else save();
        }}
        onKeyDown={(event) => {
          if (composing(event)) return;
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            if (save()) event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            skipBlur.current = true;
            setDraft(value);
            setError('');
            event.currentTarget.blur();
          }
        }}
      />
      {error && (
        <p className="frontmatter-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function NewProperty({ add, cancel }: { add: (key: string, value: string) => void; cancel: () => void }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  const isComposing = useRef(false);
  useEffect(() => nameInput.current?.focus(), []);
  return (
    <form
      className="frontmatter-new"
      aria-label="속성 추가"
      onCompositionStart={() => {
        isComposing.current = true;
      }}
      onCompositionEnd={() => {
        isComposing.current = false;
      }}
      onKeyDown={(event) => {
        if (composing(event)) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (isComposing.current) return;
        try {
          add(name, value);
        } catch (reason) {
          setError((reason as Error).message);
        }
      }}
    >
      <input
        ref={nameInput}
        className="frontmatter-input"
        aria-label="새 속성 이름"
        placeholder="이름"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <input
        className="frontmatter-input"
        aria-label="새 속성 값"
        placeholder="값"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" className="frontmatter-add" aria-label="속성 추가 확인">
        <Plus size={14} />
      </button>
      <button type="button" className="icon-button" aria-label="속성 추가 취소" onClick={cancel}>
        <X size={13} />
      </button>
      {error && (
        <p className="frontmatter-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
