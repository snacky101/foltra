import { Select } from './Select';
import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { TopicFolderFilter } from './TopicFolderFilter';
import { filterFolderNotes } from '../lib/folderFilter';
import type { Settings, Workspace } from '../lib/types';
import { noteLinks } from '../lib/noteLinks';

export function TimelineView({
  workspace,
  openNote,
  updateSettings,
}: {
  workspace: Workspace;
  updateSettings: (patch: Partial<Settings>) => Promise<boolean>;
  openNote: (id: string) => void;
}) {
  const [basis, setBasis] = useState<'createdAt' | 'updatedAt'>('updatedAt');
  const filter = workspace.settings.timelineFolders ?? { include: [], exclude: [] };
  const notes = filterFolderNotes(workspace.notes, workspace.folders, filter).sort((a, b) =>
    b[basis].localeCompare(a[basis]),
  );
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
      <TopicFolderFilter
        folders={workspace.folders}
        value={filter}
        setting="timelineFolders"
        label="기록의 흐름 폴더 범위"
        updateSettings={updateSettings}
      />
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
      {!notes.length && (
        <p className="empty-small">표시할 노트가 없습니다. 노트를 만들거나 폴더 필터를 확인하세요.</p>
      )}
    </section>
  );
}
