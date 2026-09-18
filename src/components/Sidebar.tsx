import { SettingsNavigation } from './SettingsNavigation';
import type { SettingsGroup } from '../lib/settingsNavigation';
import { NoteTree } from './NoteTree';
import { useCallback, useLayoutEffect, useState, type Ref } from 'react';
import type { FolderAction, useTreeEditing } from '../lib/useTreeEditing';
import {
  ChevronDown,
  Plus,
  Table2,
  Settings2,
  Trash2,
  ChevronsUpDown,
  FolderOpen,
  PanelLeft,
} from 'lucide-react';
import type { Workspace, View, NoteSummary, Database } from '../lib/types';
import { ResizableSidebar } from './ResizableSidebar';
import { SidebarNavigation } from './SidebarNavigation';
import type { NoteMenuTarget } from './NoteContextMenu';
import type { DatabaseAction } from './DatabaseContextMenu';
import { InlineTreeName } from './InlineTreeName';
import { SidebarTreeContextMenu, type SidebarMenuTarget } from './SidebarTreeContextMenu';

interface Props {
  settingsOpen: boolean;
  settingsGroup: SettingsGroup;
  selectSettingsGroup: (group: SettingsGroup) => void;
  closeSettings: () => void;
  workspace: Workspace;
  collapsed: boolean;
  collapse: () => void;
  collapseButtonRef?: Ref<HTMLButtonElement>;
  compactNavigation: boolean;
  toggleCompactNavigation: () => void;
  view: View;
  noteId: string | null;
  databaseId: string | null;
  openNote: (id: string) => void;
  renameNote: (note: NoteSummary) => void;
  navigate: (view: View, databaseId?: string) => void;
  search: () => void;
  createNote: (folderId?: string) => void;
  folderDialog: (target: FolderAction) => void;
  createDatabase: () => void;
  databaseAction: (action: DatabaseAction, database: Database) => void;
  databaseEditing: {
    target: { kind: 'database'; id: string; name: string };
    commit: (name: string) => Promise<void>;
    cancel: () => void;
  } | null;
  switchVault: () => void;
  noteMenu: (target: NoteMenuTarget) => void;
  noteMenuOpen: boolean;
  closeNoteMenu: () => void;
  moveNote: (note: NoteSummary, folderId: string) => Promise<void>;
  onError: (error: unknown) => void;
  treeEditing: ReturnType<typeof useTreeEditing>;
}
export function Sidebar({
  settingsOpen,
  settingsGroup,
  selectSettingsGroup,
  closeSettings,
  workspace,
  collapsed,
  collapse,
  collapseButtonRef,
  compactNavigation,
  toggleCompactNavigation,
  view,
  noteId,
  databaseId,
  openNote,
  renameNote,
  navigate,
  search,
  createNote,
  createDatabase,
  databaseAction,
  databaseEditing,
  switchVault,
  noteMenu,
  noteMenuOpen,
  closeNoteMenu,
  folderDialog,
  moveNote,
  onError,
  treeEditing,
}: Props) {
  const [menu, setMenu] = useState<SidebarMenuTarget | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useLayoutEffect(closeMenu, [workspace.vault.id, settingsOpen, collapsed, closeMenu]);
  useLayoutEffect(() => {
    if (noteMenuOpen) closeMenu();
  }, [noteMenuOpen, closeMenu]);
  const showMenu = (target: SidebarMenuTarget) => {
    closeNoteMenu();
    setMenu(target);
  };
  return (
    <ResizableSidebar side="left" collapsed={collapsed}>
      <aside
        id="primary-sidebar"
        aria-label="왼쪽 사이드바"
        className="sidebar"
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          target.closest<HTMLButtonElement>('button[data-sidebar-item]')?.focus();
        }}
      >
        <div className="sidebar-window-controls" data-tauri-drag-region>
          {!settingsOpen && (
            <button
              ref={collapseButtonRef}
              className="icon-button sidebar-collapse-button"
              aria-label="왼쪽 사이드바 접기"
              aria-expanded="true"
              aria-controls="primary-sidebar"
              title="왼쪽 사이드바 접기"
              onClick={collapse}
            >
              <PanelLeft size={17} />
            </button>
          )}
        </div>
        <div className={`sidebar-content-switch${settingsOpen ? ' settings-open' : ''}`}>
          <div className="sidebar-work-content" inert={settingsOpen} aria-hidden={settingsOpen}>
            <SidebarNavigation
              view={view}
              noteCount={workspace.notes.length}
              compact={compactNavigation}
              toggleCompact={toggleCompactNavigation}
              navigate={navigate}
              search={search}
            />
            <div className="sidebar-tree" data-focus-region="sidebar-tree" tabIndex={-1}>
              <div
                className="database-tree"
                aria-label="데이터베이스 영역"
                onContextMenu={(event) => {
                  if ((event.target as HTMLElement).closest('[data-inline-rename]')) return;
                  event.preventDefault();
                  event.stopPropagation();
                  showMenu({ kind: 'databases', x: event.clientX, y: event.clientY });
                }}
              >
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
                    <div className="database-navigation-row" data-database-id={db.id} key={db.id}>
                      {databaseEditing?.target.id === db.id ? (
                        <InlineTreeName
                          key={db.id}
                          target={databaseEditing.target}
                          commit={databaseEditing.commit}
                          cancel={databaseEditing.cancel}
                        />
                      ) : (
                        <button
                          data-sidebar-item
                          data-tree-item
                          data-database-id={db.id}
                          className={view === 'database' && databaseId === db.id ? 'active' : ''}
                          onClick={() => navigate('database', db.id)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            event.currentTarget.focus();
                            showMenu({ kind: 'database', database: db, x: event.clientX, y: event.clientY });
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                              event.preventDefault();
                              event.stopPropagation();
                              const rect = event.currentTarget.getBoundingClientRect();
                              showMenu({ kind: 'database', database: db, x: rect.left, y: rect.bottom });
                            }
                          }}
                        >
                          <Table2 size={16} />
                          <span>{db.name}</span>
                          <small>{workspace.records.filter((r) => r.databaseId === db.id).length}</small>
                        </button>
                      )}
                    </div>
                  ))}
                  {!workspace.databases.length && (
                    <button data-sidebar-item onClick={createDatabase}>
                      <Plus size={14} />
                      <span>데이터베이스 만들기</span>
                    </button>
                  )}
                </div>
              </div>
              <NoteTree
                key={workspace.vault.id}
                workspace={workspace}
                activeId={view === 'notes' ? noteId : null}
                openNote={openNote}
                renameNote={renameNote}
                noteMenu={(target) => {
                  closeMenu();
                  noteMenu(target);
                }}
                folderMenu={(target) => showMenu({ kind: 'folder', ...target })}
                rootMenu={(position) => showMenu({ kind: 'notes', ...position })}
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
            </div>
          </div>
          <div className="sidebar-settings-content" inert={!settingsOpen} aria-hidden={!settingsOpen}>
            <SettingsNavigation group={settingsGroup} select={selectSettingsGroup} close={closeSettings} />
          </div>
        </div>
        <div className="sidebar-bottom sidebar-vault-footer">
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
        {menu && !settingsOpen && !collapsed && (
          <SidebarTreeContextMenu
            target={menu}
            close={closeMenu}
            createNote={createNote}
            createDatabase={createDatabase}
            folderAction={folderDialog}
            databaseAction={databaseAction}
          />
        )}
      </aside>
    </ResizableSidebar>
  );
}
