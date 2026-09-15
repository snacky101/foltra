import { NoteTree } from './NoteTree';
import type { FolderAction, useTreeEditing } from '../lib/useTreeEditing';
import {
  ChevronDown,
  Search,
  Plus,
  Files,
  Network,
  CalendarDays,
  Layers3,
  Table2,
  Settings2,
  Puzzle,
  Trash2,
  ArrowUpRight,
  ChevronsUpDown,
  FolderOpen,
} from 'lucide-react';
import type { Workspace, View, NoteSummary } from '../lib/types';
import { ResizableSidebar } from './ResizableSidebar';
import type { NoteMenuTarget } from './NoteContextMenu';

interface Props {
  workspace: Workspace;
  view: View;
  noteId: string | null;
  databaseId: string | null;
  openNote: (id: string) => void;
  navigate: (view: View, databaseId?: string) => void;
  search: () => void;
  createNote: (folderId?: string) => void;
  folderDialog: (target: FolderAction) => void;
  createDatabase: () => void;
  switchVault: () => void;
  noteMenu: (target: NoteMenuTarget) => void;
  moveNote: (note: NoteSummary, folderId: string) => Promise<void>;
  onError: (error: unknown) => void;
  treeEditing: ReturnType<typeof useTreeEditing>;
}
export function Sidebar({
  workspace,
  view,
  noteId,
  databaseId,
  openNote,
  navigate,
  search,
  createNote,
  createDatabase,
  switchVault,
  noteMenu,
  folderDialog,
  moveNote,
  onError,
  treeEditing,
}: Props) {
  return (
    <ResizableSidebar side="left">
      <aside
        className="sidebar"
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          target.closest<HTMLButtonElement>('button[data-sidebar-item]')?.focus();
        }}
      >
        <div className="sidebar-window-controls" data-tauri-drag-region aria-hidden="true" />
        <nav className="main-navigation" data-focus-region="sidebar-navigation" tabIndex={-1}>
          <button
            data-sidebar-item
            className={view === 'all-notes' ? 'active' : ''}
            onClick={() => navigate('all-notes')}
          >
            <Files size={17} />
            <span>모든 노트</span>
            <small>{workspace.notes.length}</small>
          </button>
          <button data-sidebar-item onClick={search}>
            <Search size={17} />
            <span>내용 검색</span>
          </button>
          <button
            data-sidebar-item
            className={view === 'graph' ? 'active' : ''}
            onClick={() => navigate('graph')}
          >
            <Network size={17} />
            <span>지식 그래프</span>
          </button>
          <button
            data-sidebar-item
            className={view === 'timeline' ? 'active' : ''}
            onClick={() => navigate('timeline')}
          >
            <CalendarDays size={17} />
            <span>타임라인</span>
          </button>
          <button
            data-sidebar-item
            className={view === 'topics' ? 'active' : ''}
            onClick={() => navigate('topics')}
          >
            <Layers3 size={17} />
            <span>주제 모음</span>
          </button>
        </nav>
        <div className="sidebar-tree" data-focus-region="sidebar-tree" tabIndex={-1}>
          <div className="sidebar-section-title">
            <span>
              <ChevronDown size={12} /> DATABASES
            </span>
            <button data-sidebar-item aria-label="새 데이터베이스" onClick={createDatabase}>
              <Plus size={14} />
            </button>
          </div>
          <div className="database-navigation">
            {workspace.databases.map((db) => (
              <button
                data-sidebar-item
                data-tree-item
                data-database-id={db.id}
                key={db.id}
                className={view === 'database' && databaseId === db.id ? 'active' : ''}
                onClick={() => navigate('database', db.id)}
              >
                <Table2 size={16} />
                <span>{db.name}</span>
                <small>{workspace.records.filter((r) => r.databaseId === db.id).length}</small>
              </button>
            ))}
            {!workspace.databases.length && (
              <button data-sidebar-item onClick={createDatabase}>
                <Plus size={14} />
                <span>데이터베이스 만들기</span>
              </button>
            )}
          </div>
          <NoteTree
            key={workspace.vault.id}
            workspace={workspace}
            activeId={view === 'notes' ? noteId : null}
            openNote={openNote}
            noteMenu={noteMenu}
            folderDialog={folderDialog}
            createNote={createNote}
            moveNote={moveNote}
            treeEditing={treeEditing}
            onError={onError}
          />
        </div>
        <div className="sidebar-bottom" data-focus-region="sidebar-footer" tabIndex={-1}>
          <button
            data-sidebar-item
            className={view === 'extensions' ? 'active' : ''}
            onClick={() => navigate('extensions')}
          >
            <Puzzle size={16} />
            <span>확장</span>
            <ArrowUpRight size={13} />
          </button>
          <button
            data-sidebar-item
            className={view === 'settings' ? 'active' : ''}
            onClick={() => navigate('settings')}
          >
            <Settings2 size={16} />
            <span>설정과 단축키</span>
          </button>
          <button
            data-sidebar-item
            className={view === 'trash' ? 'active' : ''}
            onClick={() => navigate('trash')}
          >
            <Trash2 size={16} />
            <span>휴지통</span>
          </button>
          <div className="local-status">
            <i />
            <span>내 기기에 저장</span>
            <span>v0.1</span>
          </div>
          <button
            data-sidebar-item
            className="vault-switch"
            aria-label="Vault 선택"
            aria-haspopup="dialog"
            title={`${workspace.vault.name} · Vault 선택`}
            onClick={switchVault}
          >
            <FolderOpen size={17} />
            <span>{workspace.vault.name}</span>
            <ChevronsUpDown size={14} />
          </button>
        </div>
      </aside>
    </ResizableSidebar>
  );
}
