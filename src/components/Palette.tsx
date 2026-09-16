import { useState } from 'react';
import { Search, ArrowUpRight } from 'lucide-react';
import { leaderLabel } from '../lib/leaderKey';
import { Modal } from './Modal';
import { bindingsFor, sequenceKeys, type Command } from '../lib/commands';
import type { Binding, NoteSummary, Settings } from '../lib/types';

export function Palette({
  commands,
  notes,
  settings,
  close,
  run,
  openNote,
}: {
  commands: Command[];
  notes: NoteSummary[];
  settings: Settings;
  close: () => void;
  run: (command: Command) => void;
  openNote: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const filtered = commands.filter((c) => `${c.title} ${c.id}`.toLowerCase().includes(query.toLowerCase()));
  const matchingNotes = notes.filter((n) => n.title.toLowerCase().includes(query.toLowerCase())).slice(0, 8);
  const results = [
    ...filtered.map((command) => ({
      id: command.id,
      title: command.title,
      section: command.group,
      binding: bindingsFor(command, settings),
      action: () => run(command),
    })),
    ...matchingNotes.map((note) => ({
      id: note.id,
      title: note.title,
      section: '노트',
      binding: [] as Binding[],
      action: () => openNote(note.id),
    })),
  ].slice(0, 30);
  return (
    <Modal title="어디로 이어갈까요?" close={close} className="palette">
      <div className="palette-search">
        <Search size={19} />
        <input
          aria-label="명령 또는 노트 검색"
          placeholder="명령이나 노트를 검색하세요…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, results.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected((s) => Math.max(0, s - 1));
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              results[selected]?.action();
            }
          }}
        />
        <kbd>esc</kbd>
      </div>
      <div className="palette-results">
        {results.map((result, index) => (
          <button
            key={result.id}
            className={index === selected ? 'selected' : ''}
            onMouseEnter={() => setSelected(index)}
            onClick={result.action}
          >
            <ArrowUpRight size={16} />
            <span>
              {result.title}
              <small>{result.section}</small>
            </span>
            <kbd>
              {result.binding[0] &&
                `${result.binding[0].leader ? `${leaderLabel(settings.leader)} ` : ''}${sequenceKeys(result.binding[0]) ?? result.binding[0].keys}`}
            </kbd>
          </button>
        ))}
        {!results.length && <p className="empty-small">검색 결과가 없습니다.</p>}
      </div>
      <div className="palette-footer">
        <span>↑ ↓ 이동</span>
        <span>↵ 실행</span>
        <span>모든 명령은 단축키로 연결할 수 있어요</span>
      </div>
    </Modal>
  );
}
