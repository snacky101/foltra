import { leaderLabel } from './lib/leaderKey';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Loader2,
  PanelRight,
  Save,
  Table2,
  X,
  Command as CommandIcon,
} from 'lucide-react';
import { call } from './lib/api';
import { useWorkspace } from './lib/useWorkspace';
import { useNote } from './lib/useNote';
import { useNoteActions, type NoteAction } from './lib/useNoteActions';
import { moveWorkspaceFocus, rememberWorkspaceFocus } from './lib/workspaceFocus';
import { useCommandKeys } from './lib/useCommandKeys';
import { useCloseGuard } from './lib/useCloseGuard';
import { bindingsFor } from './lib/commands';
import { createBuiltinCommands } from './lib/builtinCommands';
import { applyTheme } from './lib/theme';
import { defaultNoteListOptions } from './lib/noteList';
import { defaultTopicOptions } from './lib/useTopics';
import { runNoteCommand, type NoteCommand } from './lib/noteCommands';
import type { Note, Row, Settings, View, Query, Folder } from './lib/types';
import { Welcome } from './components/Welcome';
import { VaultPicker } from './components/VaultPicker';
import { Sidebar } from './components/Sidebar';
import { NoteContextMenu, type NoteMenuTarget } from './components/NoteContextMenu';
import { FolderDialog } from './components/FolderDialog';
import { useTreeEditing, type FolderAction } from './lib/useTreeEditing';
import type { EditorHandle } from './components/Editor';

import { NotePane } from './components/NotePane';
import { AllNotesView } from './components/AllNotesView';
import { Palette } from './components/Palette';
import { AppDialogs, type Dialog } from './components/AppDialogs';
import { DatabaseView } from './components/DatabaseView';
import { TimelineView } from './components/KnowledgeViews';
import { TopicsView } from './components/TopicsView';
import { GraphView } from './components/GraphView';
import { SettingsView } from './components/SettingsView';
import { ExtensionsView } from './components/ExtensionsView';
import { TrashView } from './components/TrashView';

export default function App() {
  const vault = useWorkspace();
  const workspace = vault.workspace;
  const [view, setView] = useState<View>('notes');
  const [noteListOptions, setNoteListOptions] = useState(defaultNoteListOptions);
  const [topicOptions, setTopicOptions] = useState(defaultTopicOptions);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [databaseId, setDatabaseId] = useState<string | null>(null);
  const editorMode = workspace?.settings.editorMode ?? 'live';
  const preview = editorMode === 'read';
  const [backlinks, setBacklinks] = useState(true);
  const [mode, setMode] = useState('EDIT');
  const [palette, setPalette] = useState(false);
  const [vaultPicker, setVaultPicker] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [folderDialog, setFolderDialog] = useState<{
    kind: 'delete';
    folder: Folder;
  } | null>(null);
  const [noteMenu, setNoteMenu] = useState<NoteMenuTarget | null>(null);
  const [toast, setToast] = useState('');
  const [query, setQuery] = useState<Query | undefined>();
  const [history, setHistory] = useState<string[]>([]);
  const editor = useRef<EditorHandle>(null);
  const commandLineHost = useRef<HTMLDivElement>(null);
  const selectedVault = useRef('');
  const pendingInsert = useRef<string | null>(null);
  const pendingLine = useRef<number | null>(null);
  const note = useNote(
    vault.path,
    noteId,
    workspace?.notes.find((n) => n.id === noteId)?.revision,
    vault.refresh,
  );
  const onError = useCallback(
    (error: unknown) => setToast(error instanceof Error ? error.message : String(error)),
    [],
  );
  useCloseGuard(note.isDirty, note.save, onError);
  const closeDialog = useCallback(() => setDialog(null), []);
  const closePalette = useCallback(() => setPalette(false), []);
  const closeVaultPicker = useCallback(() => setVaultPicker(false), []);
  const closeFolderDialog = useCallback(() => setFolderDialog(null), []);
  const closeNoteMenu = useCallback(() => setNoteMenu(null), []);

  useEffect(() => {
    if (workspace) applyTheme(workspace);
  }, [workspace?.settings.theme, workspace?.extensions]);
  useEffect(() => {
    if (
      workspace &&
      (selectedVault.current !== workspace.path || (noteId && !workspace.notes.some((n) => n.id === noteId)))
    ) {
      setNoteId(workspace.notes[0]?.id ?? null);
      selectedVault.current = workspace.path;
    }
    if (workspace && (!databaseId || !workspace.databases.some((db) => db.id === databaseId)))
      setDatabaseId(workspace.databases[0]?.id ?? null);
  }, [workspace?.path, workspace?.notes, workspace?.databases]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 7000);
    return () => clearTimeout(timeout);
  }, [toast]);
  const editorReady = () => {
    if (pendingInsert.current !== null && editor.current) {
      editor.current.insert(pendingInsert.current);
      pendingInsert.current = null;
    }
    if (pendingLine.current !== null && editor.current) {
      editor.current.jump(pendingLine.current);
      pendingLine.current = null;
    }
  };
  const openNote = async (id: string, line?: number) => {
    if (!(await note.save())) return;
    if (noteId && id !== noteId) setHistory((old) => [...old.slice(-49), noteId]);
    setNoteId(id);
    setView('notes');
    setPalette(false);
    if (line) {
      pendingLine.current = line;
      if (id === noteId && view === 'notes' && !preview) editorReady();
      void updateSettings({ editorMode: 'live' });
    } else pendingLine.current = null;
  };
  const navigate = async (target: View, dbId?: string) => {
    if (!(await note.save())) return;
    setView(target);
    if (dbId) {
      setDatabaseId(dbId);
      setQuery(undefined);
    }
  };
  const openBody = (row: Row) => {
    if (row.bodyNoteId && workspace?.notes.some((n) => n.id === row.bodyNoteId))
      void openNote(row.bodyNoteId);
    else setDialog({ kind: 'body', row });
  };
  const insert = (text: string) => {
    pendingInsert.current = text;
    setView('notes');
    if (!preview && editor.current) {
      editor.current.insert(text);
      pendingInsert.current = null;
    }
    if (preview) void updateSettings({ editorMode: 'live' });
  };
  const updateSettings = async (patch: Partial<Settings>) => {
    try {
      await call(vault.path, 'settings.update', patch);
      await vault.refresh();
      return true;
    } catch (e) {
      onError(e);
      return false;
    }
  };
  const newRow = async () => {
    if (!databaseId) {
      setDialog({ kind: 'new-database' });
      return;
    }
    const db = workspace?.databases.find((d) => d.id === databaseId);
    const title = db?.properties.find((p) => p.id === 'title');
    await call(vault.path, 'record.create', { databaseId, values: title ? { title: 'Untitled' } : {} });
    await vault.refresh();
    setView('database');
  };
  const treeEditing = useTreeEditing(vault.path, workspace, note.save, vault.refresh, openNote);
  const noteActions = useNoteActions(
    vault.path,
    note,
    vault.refresh,
    openNote,
    setToast,
    treeEditing.renameNote,
  );
  const folderAction = (target: FolderAction) => {
    if (target.kind === 'create') void treeEditing.create('folder', target.parentId).catch(onError);
    else if (target.kind === 'rename') treeEditing.renameFolder(target.folder);
    else setFolderDialog({ kind: 'delete', folder: target.folder });
  };
  const currentNoteAction = (action: NoteAction) => {
    const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-note-id]')
      ?.dataset.noteId;
    const target = workspace?.notes.find((n) => n.id === (focused ?? noteId));
    if (target) return noteActions.run(action, target);
  };
  const noteCommand = (command: NoteCommand, force = false) =>
    runNoteCommand(command, force, {
      save: note.save,
      isDirty: note.isDirty,
      discard: note.discard,
      close: () => {
        setNoteId((current) => (current === noteId ? null : current));
        setView('notes');
        pendingInsert.current = null;
        pendingLine.current = null;
      },
      notify: setToast,
    });
  const changeEditorMode = async (mode: Settings['editorMode']) => {
    await updateSettings({ editorMode: mode });
  };
  const commands = createBuiltinCommands({
    'command.palette': () => setPalette(true),
    'vault.switch': () => setVaultPicker(true),
    'note.create': () => setDialog({ kind: 'new-note' }),
    'note.find': () => setPalette(true),
    search: () => setDialog({ kind: 'search' }),
    'note.save': () => noteCommand('write'),
    'note.close': () => noteCommand('quit'),
    'note.save-close': () => noteCommand('writequit'),
    'note.preview': () => changeEditorMode(preview ? 'live' : 'read'),
    'note.mode.live': () => changeEditorMode('live'),
    'note.mode.source': () => changeEditorMode('source'),
    'note.mode.read': () => changeEditorMode('read'),
    'note.link': () => setDialog({ kind: 'link' }),
    'note.query': () => setDialog({ kind: 'query' }),
    'note.delete': () => currentNoteAction('delete'),
    'note.move': () => currentNoteAction('move'),
    'folder.create': () =>
      folderAction({
        kind: 'create',
        parentId: (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-folder-id]')
          ?.dataset.folderId,
      }),
    'folder.rename': () => {
      const id = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-folder-id]')
        ?.dataset.folderId;
      const folder = workspace?.folders.find((f) => f.id === id);
      if (folder) treeEditing.renameFolder(folder);
    },
    'folder.delete': () => {
      const id = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-folder-id]')
        ?.dataset.folderId;
      const folder = workspace?.folders.find((f) => f.id === id);
      if (folder) setFolderDialog({ kind: 'delete', folder });
    },
    'note.rename': () => {
      const id = document.activeElement?.closest<HTMLElement>('[data-folder-id]')?.dataset.folderId;
      const folder = workspace?.folders.find((f) => f.id === id);
      if (folder) treeEditing.renameFolder(folder);
      else return currentNoteAction('rename');
    },
    'note.duplicate': () => currentNoteAction('duplicate'),
    'note.copy-link': () => currentNoteAction('copy-link'),
    'backlinks.open': () => setBacklinks((p) => !p),
    'database.create': () => setDialog({ kind: 'new-database' }),
    'database.property.edit': () => {
      const database = workspace?.databases.find((db) => db.id === databaseId);
      const id = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-property-id]')
        ?.dataset.propertyId;
      const property =
        database?.properties.find((p) => p.id === id) ?? database?.properties.find((p) => p.id !== 'title');
      if (database && property) setDialog({ kind: 'property-edit', database, property });
    },
    'record.create': newRow,
    'view.notes': () => navigate('all-notes'),
    'focus.left': () => moveWorkspaceFocus('left'),
    'focus.down': () => moveWorkspaceFocus('down'),
    'focus.up': () => moveWorkspaceFocus('up'),
    'focus.right': () => moveWorkspaceFocus('right'),
    'view.graph.open': () => navigate('graph'),
    'view.timeline.open': () => navigate('timeline'),
    'view.topics.open': () => navigate('topics'),
    'view.database': () =>
      databaseId ? navigate('database', databaseId) : setDialog({ kind: 'new-database' }),
    'settings.open': () => navigate('settings'),
    'extensions.open': () => navigate('extensions'),
    'vim.toggle': async () => {
      await updateSettings({ vim: !workspace?.settings.vim });
    },
    'slash.toggle': async () => {
      await updateSettings({ slash: !workspace?.settings.slash });
    },
    'trash.open': () => navigate('trash'),
  });
  for (const extension of workspace?.extensions ?? [])
    for (const contribution of extension.commands ?? []) {
      commands.push({
        id: `plugin.${extension.id}.${contribution.id}`,
        title: contribution.title,
        group: extension.name,
        run: async () => {
          const action = contribution.action;
          if (action.type === 'template') {
            if (!(await note.save())) return;
            const item = await call<Note>(vault.path, `plugin.${extension.id}.${contribution.id}`);
            await vault.refresh();
            await changeEditorMode('live');
            await openNote(item.id);
          }
          if (action.type === 'view') {
            await navigate(action.view === 'databases' ? 'database' : (action.view as View));
          }
          if (action.type === 'query') {
            await navigate('database', action.query.databaseId);
            setQuery(action.query);
          }
        },
      });
    }
  const dispatch = (id: string) => {
    const command = commands.find((c) => c.id === id);
    if (command) void Promise.resolve().then(command.run).catch(onError);
  };
  const pending = useCommandKeys(
    commands,
    workspace?.settings,
    mode,
    palette ||
      !!dialog ||
      vaultPicker ||
      !!noteMenu ||
      !!noteActions.moving ||
      !!folderDialog ||
      noteActions.busy,
    onError,
  );
  const activeDatabase = workspace?.databases.find((db) => db.id === databaseId);
  const selectVault = async (action: () => Promise<void>) => {
    if (!(await note.save())) throw new Error('현재 노트의 저장 문제를 해결한 뒤 vault를 전환하세요.');
    await action();
    setNoteId(null);
    setDatabaseId(null);
    setHistory([]);
    setNoteListOptions(defaultNoteListOptions);
    setTopicOptions(defaultTopicOptions);
    setQuery(undefined);
    setView('notes');
    selectedVault.current = '';
  };
  if (!workspace)
    return (
      <Welcome
        open={vault.open}
        create={vault.create}
        error={vault.error}
        previousPath={vault.recentVaults[0]?.path ?? ''}
      />
    );

  const titles: Record<View, string> = {
    notes: '노트',
    'all-notes': '모든 노트',
    database: activeDatabase?.name ?? '데이터베이스',
    graph: '지식 그래프',
    timeline: '타임라인',
    topics: '주제 모음',
    settings: '설정',
    extensions: '확장',
    trash: '휴지통',
  };
  return (
    <>
      <div
        className="app-shell"
        inert={noteActions.busy}
        onFocusCapture={(e) => rememberWorkspaceFocus(e.target)}
      >
        <Sidebar
          workspace={workspace}
          view={view}
          noteId={noteId}
          databaseId={databaseId}
          openNote={(id) => void openNote(id)}
          navigate={(v, id) => void navigate(v, id)}
          search={() => dispatch('search')}
          createNote={(folderId) => void treeEditing.create('note', folderId).catch(onError)}
          folderDialog={folderAction}
          treeEditing={treeEditing}
          createDatabase={() => dispatch('database.create')}
          switchVault={() => dispatch('vault.switch')}
          noteMenu={setNoteMenu}
          moveNote={noteActions.moveTo}
          onError={onError}
        />
        <div className="main-shell">
          <header className="topbar" data-tauri-drag-region data-focus-region="main-toolbar" tabIndex={-1}>
            <button
              className="icon-button"
              aria-label="이전 노트"
              disabled={!history.length}
              onClick={() => {
                const id = history.at(-1);
                if (id)
                  void note.save().then((ok) => {
                    if (ok) {
                      setHistory((h) => h.slice(0, -1));
                      setNoteId(id);
                      setView('notes');
                    }
                  });
              }}
            >
              <ArrowLeft size={17} />
            </button>
            <span className="breadcrumb-vault" data-tauri-drag-region>
              {workspace.vault.name}
            </span>
            <ChevronRight size={13} />
            <span data-tauri-drag-region>{titles[view]}</span>
            {view === 'notes' && note.note && (
              <>
                <ChevronRight size={13} />
                <span className="breadcrumb-note" data-tauri-drag-region>
                  {note.draft.title}
                </span>
              </>
            )}
            <div className="topbar-actions">
              {view === 'notes' && noteId && (
                <>
                  <div className="editor-mode-switch" role="group" aria-label="노트 보기 모드">
                    {(
                      [
                        ['live', 'Live Preview'],
                        ['source', '원문'],
                        ['read', '읽기'],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        aria-pressed={editorMode === mode}
                        onClick={() => dispatch(`note.mode.${mode}`)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button
                    className="icon-button"
                    aria-label="노트 저장"
                    onClick={() => dispatch('note.save')}
                  >
                    <Save size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="백링크 패널"
                    onClick={() => dispatch('backlinks.open')}
                  >
                    <PanelRight size={17} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="현재 노트 닫기"
                    onClick={() => dispatch('note.close')}
                  >
                    <X size={16} />
                  </button>
                </>
              )}
            </div>
          </header>
          {vault.error && (
            <div className="workspace-error" role="alert">
              {vault.error}
              <button onClick={() => void vault.refresh()}>다시 확인</button>
            </div>
          )}
          <div className="workspace-content" data-focus-region="main" tabIndex={-1}>
            {view === 'all-notes' && (
              <AllNotesView
                workspace={workspace}
                options={noteListOptions}
                onChange={setNoteListOptions}
                openNote={(id) => void openNote(id)}
                createNote={(folderId) => setDialog({ kind: 'new-note', folderId })}
                noteMenu={setNoteMenu}
              />
            )}
            {view === 'notes' && (
              <NotePane
                workspace={workspace}
                noteId={noteId}
                note={note}
                preview={preview}
                backlinks={backlinks}
                editor={editor}
                dispatch={dispatch}
                openNote={openNote}
                setNoteId={setNoteId}
                setMode={setMode}
                setDialog={setDialog}
                onError={onError}
                onEditorReady={editorReady}
                commandLineHost={commandLineHost}
                onNoteCommand={noteCommand}
              />
            )}
            {view === 'database' &&
              (activeDatabase ? (
                <DatabaseView
                  key={`${workspace.vault.id}:${activeDatabase.id}`}
                  vault={vault.path}
                  workspace={workspace}
                  database={activeDatabase}
                  refresh={vault.refresh}
                  openBody={openBody}
                  addProperty={() => setDialog({ kind: 'property', database: activeDatabase })}
                  editProperty={(property) =>
                    setDialog({ kind: 'property-edit', database: activeDatabase, property })
                  }
                  onError={onError}
                  initialQuery={query}
                />
              ) : (
                <div className="empty-notes">
                  <Table2 size={36} />
                  <h1>데이터부터 시작하세요.</h1>
                  <button className="primary-button" onClick={() => dispatch('database.create')}>
                    데이터베이스 만들기
                  </button>
                </div>
              ))}
            {view === 'graph' && (
              <GraphView
                key={workspace.vault.id}
                workspace={workspace}
                openNote={(id) => void openNote(id)}
              />
            )}
            {view === 'timeline' && (
              <TimelineView workspace={workspace} openNote={(id) => void openNote(id)} />
            )}
            {view === 'topics' && (
              <TopicsView
                key={workspace.vault.id}
                workspace={workspace}
                options={topicOptions}
                onChange={setTopicOptions}
                openNote={(id, line) => void openNote(id, line)}
              />
            )}
            {view === 'settings' && (
              <SettingsView workspace={workspace} commands={commands} update={updateSettings} />
            )}
            {view === 'extensions' && (
              <ExtensionsView workspace={workspace} refresh={vault.refresh} onError={onError} />
            )}
            {view === 'trash' && (
              <TrashView
                items={workspace.trash}
                vault={vault.path}
                refresh={vault.refresh}
                onError={onError}
              />
            )}
          </div>
          <div className="vim-command-dock" ref={commandLineHost} />
          <footer className="statusbar">
            <span className={`mode-badge ${mode.toLowerCase()}`}>
              {view === 'notes' && noteId && !preview ? mode : 'NAVIGATE'}
            </span>
            <span className="vim-status">{workspace.settings.vim ? 'VIM ON' : 'VIM OFF'}</span>
            <span className="status-hint">
              <kbd>{leaderLabel(workspace.settings.leader)}</kbd>명령 시작
            </span>
            <span className="status-right">
              {view === 'notes' && noteId && (
                <span>{note.draft.body.trim().split(/\s+/).filter(Boolean).length} words</span>
              )}
              {note.status === 'saving' ? (
                <>
                  <Loader2 size={12} className="spin" />
                  저장 중
                </>
              ) : note.status === 'dirty' ? (
                '변경됨'
              ) : note.status === 'error' ? (
                '저장 확인 필요'
              ) : (
                <>
                  <Check size={13} />
                  로컬에 저장됨
                </>
              )}
            </span>
          </footer>
        </div>
        {vaultPicker && (
          <VaultPicker
            current={vault.path}
            recent={vault.recentVaults}
            close={closeVaultPicker}
            open={(path) => selectVault(() => vault.open(path))}
            create={(path, name, demo) => selectVault(() => vault.create(path, name, demo))}
          />
        )}
        {palette && (
          <Palette
            commands={commands}
            notes={workspace.notes}
            settings={workspace.settings}
            close={closePalette}
            run={(command) => {
              closePalette();
              void Promise.resolve().then(command.run).catch(onError);
            }}
            openNote={(id) => {
              closePalette();
              void openNote(id);
            }}
          />
        )}
        {dialog && (
          <AppDialogs
            key={dialog.kind}
            dialog={dialog}
            workspace={workspace}
            close={closeDialog}
            refresh={vault.refresh}
            openNote={(id) => {
              void changeEditorMode('live');
              void openNote(id);
            }}
            openDatabase={(id) => void navigate('database', id)}
            insert={insert}
            onError={onError}
          />
        )}
        {noteMenu && (
          <NoteContextMenu
            target={noteMenu}
            close={closeNoteMenu}
            run={(action, target) => {
              void noteActions.run(action, target).catch(onError);
            }}
          />
        )}
        {folderDialog && (
          <FolderDialog
            target={folderDialog}
            vault={vault.path}
            folders={workspace.folders}
            close={closeFolderDialog}
            refresh={vault.refresh}
          />
        )}
        {noteActions.moving && (
          <FolderDialog
            target={{ kind: 'move', note: noteActions.moving, submit: noteActions.move }}
            vault={vault.path}
            folders={workspace.folders}
            close={noteActions.closeMove}
            refresh={vault.refresh}
          />
        )}
        {pending !== null && (
          <div className="leader-guide" role="status">
            <div>
              <CommandIcon size={15} />
              <strong>
                {leaderLabel(workspace.settings.leader)} {pending.split('').join(' ')}
              </strong>
              <small>다음 키를 입력하세요 · Esc 취소</small>
            </div>
            <section>
              {commands
                .filter((c) =>
                  bindingsFor(c, workspace.settings).leader?.replaceAll(' ', '').startsWith(pending),
                )
                .map((command) => (
                  <span key={command.id}>
                    <kbd>{bindingsFor(command, workspace.settings).leader}</kbd>
                    {command.title}
                  </span>
                ))}
            </section>
          </div>
        )}
        {toast && (
          <div className="toast" role="status">
            <span>{toast}</span>
            <button aria-label="알림 닫기" onClick={() => setToast('')}>
              <X size={15} />
            </button>
          </div>
        )}
      </div>
      {noteActions.busy && (
        <div className="note-action-progress" role="status">
          <Loader2 size={18} />
          노트를 처리하고 있습니다…
        </div>
      )}
    </>
  );
}
