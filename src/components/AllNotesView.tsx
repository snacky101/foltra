import { useMemo, useRef, type KeyboardEvent } from 'react';
import { FileText, MoreHorizontal, Plus, Search } from 'lucide-react';
import type { Workspace } from '../lib/types';
import { filterNoteList, type NoteListOptions } from '../lib/noteList';
import { folderPath } from './FolderSelect';
import type { NoteMenuTarget } from './NoteContextMenu';
import { Select } from './Select';

export function AllNotesView({
  workspace,
  options,
  onChange,
  openNote,
  createNote,
  noteMenu,
}: {
  workspace: Workspace;
  options: NoteListOptions;
  onChange: (options: NoteListOptions) => void;
  openNote: (id: string) => void;
  createNote: (folderId?: string) => void;
  noteMenu: (target: NoteMenuTarget) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const folders = useMemo(
    () =>
      workspace.folders
        .map((folder) => ({ id: folder.id, name: folderPath(folder, workspace.folders) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [workspace.folders],
  );
  const folder =
    options.folder === 'all' || options.folder === '' || folders.some((f) => f.id === options.folder)
      ? options.folder
      : 'all';
  const notes = useMemo(
    () => filterNoteList(workspace.notes, { ...options, folder }),
    [workspace.notes, options, folder],
  );
  const location = (id?: string | null) => folders.find((f) => f.id === id)?.name ?? 'Vault 최상위';
  const filtered = !!options.search.trim() || folder !== 'all';
  const change = (patch: Partial<NoteListOptions>) => onChange({ ...options, folder, ...patch });
  const moveFocus = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
      return;
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('.note-list-open') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const key = workspace.settings.vim
      ? ({ j: 'ArrowDown', k: 'ArrowUp' }[event.key] ?? event.key)
      : event.key;
    const next =
      key === 'ArrowDown'
        ? index + 1
        : key === 'ArrowUp'
          ? index - 1
          : key === 'Home'
            ? 0
            : key === 'End'
              ? items.length - 1
              : null;
    if (next === null || !items.length) return;
    event.preventDefault();
    const target = items[Math.max(0, Math.min(items.length - 1, next))];
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'nearest' });
  };
  return (
    <section className="page-view all-notes-view" aria-label="모든 노트 목록">
      <div className="page-heading">
        <div className="note-list-heading">
          <h1>모든 노트</h1>
          <span>{workspace.notes.length}개</span>
        </div>
        <button className="primary-button" onClick={() => createNote(folder === 'all' ? undefined : folder)}>
          <Plus size={15} /> 새 노트
        </button>
      </div>
      <div className="note-list-toolbar">
        <label className="note-list-search">
          <Search size={15} />
          <input
            aria-label="노트 제목 검색"
            placeholder="제목으로 찾기"
            value={options.search}
            onChange={(e) => change({ search: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') moveFocus(e);
            }}
          />
        </label>
        <Select aria-label="노트 폴더 필터" value={folder} onValueChange={(folder) => change({ folder })}>
          <option value="all">모든 폴더</option>
          <option value="">Vault 최상위</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="노트 정렬"
          value={options.sort}
          onValueChange={(sort) => change({ sort: sort as NoteListOptions['sort'] })}
        >
          <option value="updatedAt">최근 수정순</option>
          <option value="createdAt">최근 생성순</option>
          <option value="title">제목순</option>
        </Select>
      </div>
      {filtered && (
        <p className="note-list-result" role="status">
          전체 {workspace.notes.length}개 중 {notes.length}개
        </p>
      )}
      {!!notes.length && (
        <>
          <div className="note-list-columns" aria-hidden="true">
            <span>제목</span>
            <span className="note-list-location">폴더</span>
            <span>{options.sort === 'createdAt' ? '생성일' : '수정일'}</span>
          </div>
          <ul className="note-list" ref={list} aria-label="노트">
            {notes.map((note) => {
              const path = location(note.folderId);
              const date = note[options.sort === 'createdAt' ? 'createdAt' : 'updatedAt'];
              return (
                <li className="note-list-row" key={note.id} data-note-id={note.id}>
                  <button
                    className="note-list-open"
                    onClick={() => openNote(note.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.currentTarget.focus();
                      noteMenu({ note, x: e.clientX, y: e.clientY });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                        e.preventDefault();
                        const r = e.currentTarget.getBoundingClientRect();
                        noteMenu({ note, x: r.left + 12, y: r.bottom });
                      } else moveFocus(e);
                    }}
                  >
                    <span className="note-list-title">
                      <FileText size={16} />
                      <span>
                        <strong title={note.title}>{note.title}</strong>
                        <small title={path}>{path}</small>
                      </span>
                    </span>
                    <span className="note-list-location" title={path}>
                      {path}
                    </span>
                    <time dateTime={date} title={new Date(date).toLocaleString('ko-KR')}>
                      {new Date(date).toLocaleDateString('ko-KR', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                      })}
                    </time>
                  </button>
                  <button
                    className="icon-button note-list-menu"
                    aria-label={`${note.title} 메뉴`}
                    aria-haspopup="menu"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      noteMenu({ note, x: r.left, y: r.bottom });
                    }}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {!notes.length && (
        <div className="note-list-empty">
          <p>{workspace.notes.length ? '조건에 맞는 노트가 없습니다.' : '아직 노트가 없습니다.'}</p>
          {filtered ? (
            <button className="secondary-button" onClick={() => change({ search: '', folder: 'all' })}>
              필터 초기화
            </button>
          ) : (
            <span>새 노트를 만들어 기록을 시작하세요.</span>
          )}
        </div>
      )}
    </section>
  );
}
