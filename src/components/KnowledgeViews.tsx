import { Select } from './Select';
import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { Workspace } from '../lib/types';
import { noteLinks } from '../lib/noteLinks';

export function TimelineView({
  workspace,
  openNote,
}: {
  workspace: Workspace;
  openNote: (id: string) => void;
}) {
  const [basis, setBasis] = useState<'createdAt' | 'updatedAt'>('updatedAt');
  const notes = [...workspace.notes].sort((a, b) => b[basis].localeCompare(a[basis]));
  const links = noteLinks(workspace);
  return (
    <section className="page-view">
      <div className="eyebrow">A TRAIL OF THOUGHT</div>
      <div className="page-heading">
        <h1>기록의 흐름</h1>
        <Select
          aria-label="타임라인 날짜 기준"
          value={basis}
          onValueChange={(value) => setBasis(value as typeof basis)}
        >
          <option value="updatedAt">수정한 날짜</option>
          <option value="createdAt">만든 날짜</option>
        </Select>
      </div>
      <p className="page-description">생각이 이어진 시간을 따라, 기록을 다시 만나보세요.</p>
      <div className="timeline-list">
        {notes.map((note) => (
          <button className="timeline-entry" key={note.id} onClick={() => openNote(note.id)}>
            <time>
              {new Date(note[basis]).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
              <small>
                {new Date(note[basis]).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
              </small>
            </time>
            <span className="timeline-marker" />
            <span>
              <strong>{note.title}</strong>
              <small>
                {links.filter((l) => l.source === note.id || l.target === note.id).length}개의 연결 ·{' '}
                {note.words ?? 0} words
              </small>
            </span>
            <ArrowUpRight size={15} />
          </button>
        ))}
      </div>
      {!notes.length && <p className="empty-small">첫 노트를 만들면 이곳에서 기록의 흐름을 볼 수 있어요.</p>}
    </section>
  );
}
