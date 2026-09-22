import { NoteChatHost } from './lib/noteChat';
import { TagNavigation } from './lib/tagNavigation';
import { PluginCompletionContext } from './lib/pluginCompletionContext';
import { usePlugins } from './lib/usePlugins';
import { GitConnectionDialog } from './components/GitConnectionDialog';
import { PluginView } from './components/PluginView';
import { PluginSidebarViews } from './components/PluginSidebarViews';
import { useSettingsNavigation, settingsGroups, type SettingsGroup } from './lib/settingsNavigation';
import { leaderLabel } from './lib/leaderKey';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Loader2,
  PanelRight,
  PanelLeft,
  Save,
  Table2,
  X,
  Command as CommandIcon,
} from 'lucide-react';
import { call } from './lib/api';
import { useWorkspace } from './lib/useWorkspace';
import { useNote } from './lib/useNote';
import { useNoteActions, type NoteAction } from './lib/useNoteActions';
import { useDatabaseActions, type DatabaseAction } from './lib/useDatabaseActions';
import { focusSidebarTree, moveWorkspaceFocus, rememberWorkspaceFocus } from './lib/workspaceFocus';
import { useCommandKeys } from './lib/useCommandKeys';
import { useCloseGuard } from './lib/useCloseGuard';
import { useDesktopOpenPaths, type DesktopOpenTarget } from './lib/useDesktopOpenPaths';
import { leaderCandidates, sequenceKeys } from './lib/commands';
import { createBuiltinCommands } from './lib/builtinCommands';
import { applyTheme } from './lib/theme';
import { defaultNoteListOptions } from './lib/noteList';
import { defaultTopicOptions } from './lib/useTopics';
import { runNoteCommand, type NoteCommand } from './lib/noteCommands';
import type { Note, Row, Settings, View, Query, Folder, Database, Property } from './lib/types';
import { Welcome } from './components/Welcome';
import { VaultPicker } from './components/VaultPicker';
import { Sidebar } from './components/Sidebar';
import { NoteContextMenu, type NoteMenuTarget } from './components/NoteContextMenu';
import { FolderDialog } from './components/FolderDialog';
import { DeleteDatabaseDialog } from './components/DeleteDatabaseDialog';
import { useTreeEditing, type FolderAction } from './lib/useTreeEditing';
import type { EditorHandle } from './components/Editor';
import type { MarkdownFormat } from './lib/markdownFormatting';
import type { EditorLocation } from './lib/editorLocation';
import { moveNoteHistory, recordNoteVisit, type NoteHistory } from './lib/noteHistory';

import { NotePane } from './components/NotePane';
import { AllNotesView } from './components/AllNotesView';
import { Palette } from './components/Palette';
import { AppDialogs, type Dialog } from './components/AppDialogs';
import { DatabaseView } from './components/DatabaseView';
import { TimelineView } from './components/KnowledgeViews';
import { TopicsView } from './components/TopicsView';
import { GraphView } from './components/GraphView';
import { useOpenWikiLink } from './lib/useOpenWikiLink';
import { SettingsView } from './components/SettingsView';
import { TrashView } from './components/TrashView';
import { useAppUpdates } from './lib/useAppUpdates';
import { prepareAppUpdate } from './lib/appUpdateSave';
import { AppUpdateDialogs } from './components/AppUpdatesPanel';

export default function App() {
  const vault = useWorkspace();
  const workspace = vault.workspace;
  const [workView, setWorkView] = useState<View>('notes');
  const settingsNavigation = useSettingsNavigation(vault.path);
  const view = settingsNavigation.opened ? 'settings' : workView;
  const setView = (target: View) => {
    if (target === 'notes') pendingEditorFocus.current = true;
    settingsNavigation.close(false);
    setWorkView(target);
  };
  const [noteListOptions, setNoteListOptions] = useState(defaultNoteListOptions);
  const [topicOptions, setTopicOptions] = useState(() => ({
    ...defaultTopicOptions,
    showSources: localStorage.getItem('foltra:topics:sources') === 'true',
  }));
  useEffect(() => {
    localStorage.setItem('foltra:topics:sources', String(topicOptions.showSources));
  }, [topicOptions.showSources]);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [databaseId, setDatabaseId] = useState<string | null>(null);
  const editorMode = workspace?.settings.editorMode ?? 'live';
  const preview = editorMode === 'read';
  const [backlinks, setBacklinks] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('foltra:sidebar-collapsed:left') === 'true',
  );
  const [compactNavigation, setCompactNavigation] = useState(
    () => localStorage.getItem('foltra:sidebar-navigation:compact') === 'true',
  );
  const sidebarHidden = sidebarCollapsed && !settingsNavigation.opened;
  const sidebarToggle = useRef<HTMLButtonElement>(null);
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
  const [history, setHistory] = useState<NoteHistory>({ back: [], forward: [] });
  const returning = useRef(false);
  const editor = useRef<EditorHandle>(null);
  const commandLineHost = useRef<HTMLDivElement>(null);
  const selectedVault = useRef('');
  const pendingInsert = useRef<string | null>(null);
  const pendingFrontmatter = useRef<{ action: 'edit' | 'add'; noteId: string; vault: string } | null>(null);
  const pendingLine = useRef<number | null>(null);
  const pendingLocation = useRef<EditorLocation | null>(null);
  const pendingEditorFocus = useRef(true);
  const pathOpening = useRef(false);
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
  const updates = useAppUpdates({ prepare: () => prepareAppUpdate(note.save), notify: setToast });
  useCloseGuard(
    () => updates.isBlocking() || note.isDirty(),
    () => (updates.isBlocking() ? Promise.resolve(false) : note.save()),
    onError,
  );
  const closeDialog = useCallback(() => setDialog(null), []);
  const closePalette = useCallback(() => setPalette(false), []);
  const closeVaultPicker = useCallback(() => setVaultPicker(false), []);
  const closeFolderDialog = useCallback(() => setFolderDialog(null), []);
  const closeNoteMenu = useCallback(() => setNoteMenu(null), []);
  useEffect(closeNoteMenu, [vault.path, settingsNavigation.opened, closeNoteMenu]);

  useEffect(() => {
    localStorage.setItem('foltra:sidebar-collapsed:left', String(sidebarCollapsed));
  }, [sidebarCollapsed]);
  useEffect(() => {
    localStorage.setItem('foltra:sidebar-navigation:compact', String(compactNavigation));
  }, [compactNavigation]);

  useEffect(() => {
    if (workspace) applyTheme(workspace);
  }, [workspace?.settings.theme, workspace?.extensions]);
  useEffect(() => {
    if (
      workspace &&
      (selectedVault.current !== workspace.path ||
        (noteId && !workspace.notes.some((n) => n.id === noteId) && !note.isDirty()))
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
    if (pathOpening.current) return;
    if (pendingEditorFocus.current && editor.current) {
      // A double-click can start inline naming while the first click is still loading the note.
      if (!document.querySelector('[data-inline-rename]')) editor.current.focus();
      pendingEditorFocus.current = false;
    }
    if (pendingInsert.current !== null && editor.current) {
      editor.current.insert(pendingInsert.current);
      pendingInsert.current = null;
    }
    if (pendingLine.current !== null && editor.current) {
      editor.current.jump(pendingLine.current);
      pendingLine.current = null;
    }
    if (pendingLocation.current && editor.current) {
      editor.current.restoreLocation(pendingLocation.current);
      pendingLocation.current = null;
    }
    if (pendingFrontmatter.current && editor.current) {
      const pending = pendingFrontmatter.current;
      pendingFrontmatter.current = null;
      if (pending.noteId === noteId && pending.vault === vault.path) {
        if (pending.action === 'add') editor.current.addFrontmatterProperty();
        else editor.current.editFrontmatter();
      }
    }
  };
  useEffect(() => {
    if (
      openingPath ||
      !preview ||
      settingsNavigation.opened ||
      note.status === 'loading' ||
      !pendingEditorFocus.current
    )
      return;
    if (note.note?.id !== noteId || view !== 'notes') return;
    const frame = requestAnimationFrame(() => {
      if (pathOpening.current) return;
      if (pendingLocation.current && editor.current) {
        editor.current.restoreLocation(pendingLocation.current);
        pendingLocation.current = null;
      }
      if (!document.querySelector('[data-inline-rename]'))
        document.querySelector<HTMLElement>('.note-scroll')?.focus({ preventScroll: true });
      pendingEditorFocus.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [preview, settingsNavigation.opened, note.status, note.note?.id, noteId, view]);
  const openNote = async (id: string, line?: number) => {
    if (returning.current) return;
    pendingFrontmatter.current = null;
    if (!(await note.save())) return;
    pendingEditorFocus.current = !preview || !!line;
    if (noteId && (id !== noteId || line)) {
      const location = editor.current?.getLocation() ?? null;
      setHistory((old) => recordNoteVisit(old, { id: noteId, location }));
    }
    pendingLocation.current = null;
    setNoteId(id);
    setView('notes');
    setPalette(false);
    if (line) {
      pendingLine.current = line;
      void updateSettings({ editorMode: 'live' });
    } else pendingLine.current = null;
    if (id === noteId && workView === 'notes' && !preview) {
      requestAnimationFrame(editorReady);
    }
  };
  const navigateHistory = async (direction: 'back' | 'forward') => {
    if (returning.current || note.status === 'loading' || !workspace) return;
    returning.current = true;
    try {
      if (!(await note.save()) || selectedVault.current !== workspace.path) return;
      const result = moveNoteHistory(
        history,
        direction,
        noteId ? { id: noteId, location: editor.current?.getLocation() ?? null } : null,
        (id) => workspace.notes.some((item) => item.id === id),
      );
      setHistory(result.history);
      if (!result.target) return;
      pendingLine.current = null;
      pendingLocation.current = result.target.location;
      setNoteId(result.target.id);
      setView('notes');
      setPalette(false);
      if (result.target.id === noteId && workView === 'notes') requestAnimationFrame(editorReady);
    } finally {
      returning.current = false;
    }
  };
  const openSettings = async (group?: SettingsGroup) => {
    if (await note.save()) settingsNavigation.open(group);
  };
  const navigate = async (target: View, dbId?: string) => {
    if (target === 'settings') return openSettings();
    if (!(await note.save()) || selectedVault.current !== vault.path) return;
    setView(target);
    if (dbId) {
      setDatabaseId(dbId);
      setQuery(undefined);
    }
  };
  const openLink = useOpenWikiLink(vault.path, workspace, note.save, vault.refresh, openNote, onError);
  const editProperty = async (database: Database, property: Property) => {
    if (!(await note.save()) || selectedVault.current !== vault.path) return;
    setDialog({ kind: 'property-edit', database, property });
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
    const focused = document.activeElement?.closest<HTMLElement>('[data-database-id]')?.dataset.databaseId;
    const db = workspace?.databases.find((d) => d.id === (focused ?? databaseId));
    if (!db) {
      setDialog({ kind: 'new-database' });
      return;
    }
    await databaseActions.run('new-record', db);
  };
  const treeEditing = useTreeEditing(vault.path, workspace, note.save, vault.refresh, async (id) => {
    await openNote(id);
    // Sidebar creation immediately starts inline naming; it owns focus until committed.
    pendingEditorFocus.current = false;
  });
  useEffect(() => {
    if (treeEditing.editing) {
      setSidebarCollapsed(false);
      pendingEditorFocus.current = false;
    }
  }, [treeEditing.editing?.id]);
  const noteActions = useNoteActions(
    vault.path,
    note,
    vault.refresh,
    openNote,
    setToast,
    treeEditing.renameNote,
  );
  const databaseActions = useDatabaseActions(
    vault.path,
    note.save,
    vault.refresh,
    (id) => navigate('database', id),
    (id) => {
      if (databaseId === id) {
        setDatabaseId(null);
        setQuery(undefined);
      }
      requestAnimationFrame(focusSidebarTree);
    },
    setToast,
    !settingsNavigation.opened,
  );
  useEffect(() => {
    if (databaseActions.renaming) setSidebarCollapsed(false);
  }, [databaseActions.renaming?.database.id]);
  const currentDatabaseAction = (action: DatabaseAction) => {
    const focused = document.activeElement?.closest<HTMLElement>('[data-database-id]')?.dataset.databaseId;
    const database = workspace?.databases.find((db) => db.id === (focused ?? databaseId));
    if (database) return databaseActions.run(action, database);
  };
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
        pendingLocation.current = null;
      },
      notify: setToast,
    });
  const changeEditorMode = async (mode: Settings['editorMode']) => {
    pendingEditorFocus.current = mode !== 'read';
    if (await updateSettings({ editorMode: mode })) {
      if (mode !== 'read') requestAnimationFrame(editorReady);
    } else pendingEditorFocus.current = false;
  };
  const openFrontmatter = async (action: 'edit' | 'add') => {
    if (!noteId) return;
    if (workspace?.settings.editorMode !== 'live' && !(await updateSettings({ editorMode: 'live' }))) return;
    if (selectedVault.current !== vault.path || note.currentNote()?.id !== noteId) return;
    pendingFrontmatter.current = { action, noteId, vault: vault.path };
    setView('notes');
    requestAnimationFrame(editorReady);
  };
  const plugins = usePlugins({
    visible: workView === 'plugin' && !settingsNavigation.opened,
    workspace,
    editor,
    noteId,
    save: note.save,
    refresh: vault.refresh,
    openNote,
    openView: () => setView('plugin'),
    openSidebar: () => {
      setBacklinks(true);
      setView('notes');
    },
    onError,
    notify: setToast,
  });
  const selectVault = async (action: () => Promise<void>, target?: DesktopOpenTarget) => {
    if (!(await note.save())) throw new Error('현재 노트의 저장 문제를 해결한 뒤 vault를 전환하세요.');
    await action();
    setNoteId(target?.noteId ?? null);
    setDatabaseId(null);
    setHistory({ back: [], forward: [] });
    pendingInsert.current = null;
    pendingLine.current = null;
    pendingLocation.current = null;
    pendingFrontmatter.current = null;
    setNoteListOptions(defaultNoteListOptions);
    setTopicOptions((current) => ({ ...defaultTopicOptions, showSources: current.showSources }));
    setQuery(undefined);
    setView('notes');
    selectedVault.current = target?.noteId ? target.vaultPath : '';
  };
  const openingPath = useDesktopOpenPaths({
    save: note.save,
    blocked: () => {
      if (updates.isBlocking()) return '앱 업데이트가 끝난 뒤 다시 열어주세요.';
      if (
        dialog ||
        folderDialog ||
        noteActions.moving ||
        noteActions.busy ||
        treeEditing.editing ||
        databaseActions.renaming ||
        databaseActions.deleting ||
        databaseActions.busy ||
        plugins.git.connection ||
        plugins.git.busy ||
        plugins.busy ||
        updates.opened ||
        returning.current
      )
        return '현재 편집 중인 창이나 작업을 마치거나 취소한 뒤 다시 열어주세요.';
    },
    open: async (target) => {
      if (workspace?.path === target.vaultPath) {
        if (target.noteId) await openNote(target.noteId);
        else setView('notes');
      } else await selectVault(() => vault.open(target.vaultPath), target);
      setVaultPicker(false);
      setPalette(false);
    },
    onError,
  });
  pathOpening.current = openingPath;
  useEffect(() => {
    if (!openingPath && pendingEditorFocus.current) {
      const frame = requestAnimationFrame(() => {
        if (preview && note.note?.id === noteId && view === 'notes') {
          document.querySelector<HTMLElement>('.note-scroll')?.focus({ preventScroll: true });
          pendingEditorFocus.current = false;
        } else editorReady();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [openingPath]);
  function formatNote(format: MarkdownFormat) {
    if (view !== 'notes' || preview || !noteId) return;
    if (palette) editor.current?.focus();
    editor.current?.format(format);
  }
  const commands = createBuiltinCommands({
    'command.palette': () => setPalette(true),
    'vault.switch': () => setVaultPicker(true),
    'app.update': updates.open,
    'app.cli': () => openSettings('cli'),
    'note.create': () => setDialog({ kind: 'new-note' }),
    'note.find': () => setPalette(true),
    search: () => setDialog({ kind: 'search' }),
    'note.save': () => noteCommand('write'),
    'note.close': () => {
      if (view === 'notes' && noteId) return noteCommand('writequit');
    },
    'note.save-close': () => noteCommand('writequit'),
    'note.preview': () => changeEditorMode(preview ? 'live' : 'read'),
    'note.mode.live': () => changeEditorMode('live'),
    'note.mode.source': () => changeEditorMode('source'),
    'note.mode.read': () => changeEditorMode('read'),
    'note.link': () => setDialog({ kind: 'link' }),
    'note.format.bold': () => formatNote('bold'),
    'note.format.italic': () => formatNote('italic'),
    'note.format.underline': () => formatNote('underline'),
    'note.format.strike': () => formatNote('strike'),
    'note.format.code': () => formatNote('code'),
    'note.frontmatter.edit': () => openFrontmatter('edit'),
    'note.frontmatter.add': () => openFrontmatter('add'),
    'note.task.cycle': () => {
      if (view === 'notes' && !preview && noteId) {
        if (palette) editor.current?.focus();
        editor.current?.cycleTask();
      }
    },
    'note.follow-link': () => editor.current?.followLink(),
    'note.follow-existing-link': () => editor.current?.followLink(false),
    'note.back': () => navigateHistory('back'),
    'note.forward': () => navigateHistory('forward'),
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
      if (document.activeElement?.closest('[data-database-id]')) return currentDatabaseAction('rename');
      const id = document.activeElement?.closest<HTMLElement>('[data-folder-id]')?.dataset.folderId;
      const folder = workspace?.folders.find((f) => f.id === id);
      if (folder) treeEditing.renameFolder(folder);
      else return currentNoteAction('rename');
    },
    'note.duplicate': () => currentNoteAction('duplicate'),
    'note.copy-link': () => currentNoteAction('copy-link'),
    'backlinks.open': () => setBacklinks((p) => !p),
    'sidebar.toggle': () => {
      if (settingsNavigation.opened) return;
      const restoreFocus =
        document.activeElement?.closest('#primary-sidebar') ||
        document.activeElement === sidebarToggle.current;
      setSidebarCollapsed((p) => !p);
      if (restoreFocus) requestAnimationFrame(() => sidebarToggle.current?.focus());
    },
    'sidebar.navigation.compact': () => setCompactNavigation((p) => !p),
    'database.create': () => setDialog({ kind: 'new-database' }),
    'database.open': () => currentDatabaseAction('open'),
    'database.rename': () => currentDatabaseAction('rename'),
    'database.delete': () => currentDatabaseAction('delete'),
    'database.property.edit': () => {
      const database = workspace?.databases.find((db) => db.id === databaseId);
      const id = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-property-id]')
        ?.dataset.propertyId;
      const property =
        database?.properties.find((p) => p.id === id) ??
        database?.properties.find((p) => p.id === 'title') ??
        database?.properties[0];
      if (database && property) return editProperty(database, property);
    },
    'database.property.delete': () => {
      const database = workspace?.databases.find((db) => db.id === databaseId);
      const id = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-property-id]')
        ?.dataset.propertyId;
      const property =
        database?.properties.find((p) => p.id === id) ?? database?.properties.find((p) => p.id !== 'title');
      if (database && property && property.id !== 'title' && database.properties.length > 1)
        setDialog({ kind: 'property-delete', database, property });
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
    'topics.sources.toggle': () =>
      setTopicOptions((current) => ({ ...current, showSources: !current.showSources })),
    'view.database': () =>
      databaseId ? navigate('database', databaseId) : setDialog({ kind: 'new-database' }),
    'settings.open': () => navigate('settings'),
    'extensions.open': () => openSettings('extensions'),
    'vim.toggle': async () => {
      await updateSettings({ vim: !workspace?.settings.vim });
    },
    'slash.toggle': async () => {
      await updateSettings({ slash: !workspace?.settings.slash });
    },
    'trash.open': () => navigate('trash'),
  });
  commands.push(...plugins.commands);
  for (const extension of workspace?.extensions ?? [])
    for (const contribution of extension.commands ?? []) {
      if (contribution.action.type === 'script') continue;
      commands.push({
        id: `plugin.${extension.id}.${contribution.id}`,
        title: contribution.title,
        group: extension.name,
        bindings: contribution.bindings,
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
    openingPath ||
      palette ||
      !!dialog ||
      vaultPicker ||
      !!noteMenu ||
      !!noteActions.moving ||
      !!folderDialog ||
      !!databaseActions.deleting ||
      !!plugins.git.connection ||
      updates.opened ||
      updates.blocking ||
      noteActions.busy,
    onError,
  );
  const activeDatabase = workspace?.databases.find((db) => db.id === databaseId);
  if (!workspace)
    return (
      <>
        <div inert={updates.blocking || openingPath}>
          <Welcome
            open={vault.open}
            create={vault.create}
            error={vault.error}
            previousPath={vault.recentVaults[0]?.path ?? ''}
            checkUpdates={updates.open}
          />
        </div>
        <AppUpdateDialogs updates={updates} />
        {toast && (
          <div className="toast" role="status">
            <span>{toast}</span>
            <button aria-label="알림 닫기" onClick={() => setToast('')}>
              <X size={15} />
            </button>
          </div>
        )}
      </>
    );

  const titles: Record<View, string> = {
    plugin: plugins.active?.title ?? '플러그인',
    notes: '노트',
    'all-notes': '모든 노트',
    database: activeDatabase?.name ?? '데이터베이스',
    graph: '지식 그래프',
    timeline: '타임라인',
    topics: '주제 모음',
    settings: '설정',
    trash: '휴지통',
  };
  const content = (
    <TagNavigation value={(tag) => setDialog({ kind: 'search', query: `tag:${tag}` })}>
      <div
        className={`app-shell${sidebarHidden ? ' sidebar-collapsed' : ''}`}
        inert={noteActions.busy || updates.blocking || openingPath}
        onKeyDown={settingsNavigation.onKeyDown}
        onFocusCapture={(e) => rememberWorkspaceFocus(e.target)}
      >
        <Sidebar
          workspace={workspace}
          settingsOpen={settingsNavigation.opened}
          settingsGroup={settingsNavigation.group}
          selectSettingsGroup={settingsNavigation.setGroup}
          closeSettings={() => settingsNavigation.close()}
          collapsed={sidebarHidden}
          collapse={() => dispatch('sidebar.toggle')}
          collapseButtonRef={sidebarHidden ? undefined : sidebarToggle}
          compactNavigation={compactNavigation}
          toggleCompactNavigation={() => dispatch('sidebar.navigation.compact')}
          view={settingsNavigation.opened ? 'settings' : view}
          noteId={noteId}
          databaseId={databaseId}
          openNote={(id) => void openNote(id)}
          renameNote={(target) => void noteActions.run('rename', target).catch(onError)}
          navigate={(v, id) => void navigate(v, id)}
          search={() => dispatch('search')}
          createNote={(folderId) => void treeEditing.create('note', folderId).catch(onError)}
          folderDialog={folderAction}
          treeEditing={treeEditing}
          createDatabase={() => dispatch('database.create')}
          databaseAction={(action, database) => void databaseActions.run(action, database).catch(onError)}
          databaseEditing={
            databaseActions.renaming
              ? {
                  target: {
                    kind: 'database',
                    id: databaseActions.renaming.database.id,
                    name: databaseActions.renaming.database.name,
                  },
                  commit: databaseActions.rename,
                  cancel: databaseActions.cancelRename,
                }
              : null
          }
          switchVault={() => dispatch('vault.switch')}
          noteMenu={setNoteMenu}
          noteMenuOpen={!!noteMenu}
          closeNoteMenu={closeNoteMenu}
          moveNote={noteActions.moveTo}
          onError={onError}
        />
        <div className="main-shell">
          <header className="topbar" data-tauri-drag-region data-focus-region="main-toolbar" tabIndex={-1}>
            {sidebarHidden && (
              <button
                ref={sidebarToggle}
                className="icon-button sidebar-toggle"
                aria-label="왼쪽 사이드바 펼치기"
                title="왼쪽 사이드바 펼치기"
                aria-expanded="false"
                aria-controls="primary-sidebar"
                onClick={() => dispatch('sidebar.toggle')}
              >
                <PanelLeft size={17} />
              </button>
            )}
            <button
              className="icon-button"
              aria-label={settingsNavigation.opened ? '작업으로 돌아가기' : '이전 노트'}
              disabled={!settingsNavigation.opened && !history.back.length}
              onClick={() => {
                if (settingsNavigation.opened) {
                  settingsNavigation.close();
                  return;
                }
                dispatch('note.back');
              }}
            >
              <ArrowLeft size={17} />
            </button>
            <span className="breadcrumb-vault" data-tauri-drag-region>
              {workspace.vault.name}
            </span>
            <ChevronRight size={13} />
            <span data-tauri-drag-region>
              {settingsNavigation.opened
                ? `설정 · ${settingsGroups.find((g) => g.id === settingsNavigation.group)!.title}`
                : titles[view]}
            </span>
            {!settingsNavigation.opened && view === 'notes' && note.note && (
              <>
                <ChevronRight size={13} />
                <span className="breadcrumb-note" data-tauri-drag-region>
                  {note.draft.title}
                </span>
              </>
            )}
            <div className="topbar-actions">
              {!settingsNavigation.opened && view === 'notes' && noteId && (
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
              {!settingsNavigation.opened &&
                view === 'notes' &&
                !noteId &&
                plugins.sidebarViews.length > 0 && (
                  <button
                    className="icon-button"
                    aria-label="백링크 패널"
                    aria-expanded={backlinks}
                    onClick={() => dispatch('backlinks.open')}
                  >
                    <PanelRight size={17} />
                  </button>
                )}
            </div>
          </header>
          {vault.error && (
            <div className="workspace-error" role="alert">
              {vault.error}
              <button onClick={() => void vault.refresh()}>다시 확인</button>
            </div>
          )}
          <div className={`workspace-switch${settingsNavigation.opened ? ' settings-open' : ''}`}>
            <div
              className="workspace-content workspace-work-content"
              data-focus-region={settingsNavigation.opened ? undefined : 'main'}
              tabIndex={-1}
              inert={settingsNavigation.opened}
              aria-hidden={settingsNavigation.opened}
            >
              {workView === 'all-notes' && (
                <AllNotesView
                  workspace={workspace}
                  options={noteListOptions}
                  onChange={setNoteListOptions}
                  openNote={(id) => void openNote(id)}
                  createNote={(folderId) => setDialog({ kind: 'new-note', folderId })}
                  noteMenu={setNoteMenu}
                />
              )}
              {workView === 'notes' && (
                <PluginCompletionContext value={plugins.complete}>
                  <NotePane
                    commands={commands}
                    workspace={workspace}
                    noteId={noteId}
                    note={note}
                    preview={preview}
                    backlinks={backlinks}
                    sidebar={
                      plugins.sidebarViews.length ? (
                        <PluginSidebarViews
                          views={plugins.sidebarViews}
                          revision={plugins.sidebarRevision}
                          invoke={plugins.invokeSidebar}
                          errors={plugins.errors}
                        />
                      ) : undefined
                    }
                    editor={editor}
                    dispatch={dispatch}
                    openNote={openNote}
                    openLink={openLink}
                    setNoteId={setNoteId}
                    setMode={setMode}
                    setDialog={setDialog}
                    onError={onError}
                    onEditorReady={editorReady}
                    commandLineHost={commandLineHost}
                    onNoteCommand={noteCommand}
                  />
                </PluginCompletionContext>
              )}
              {workView === 'database' &&
                (activeDatabase ? (
                  <DatabaseView
                    key={`${workspace.vault.id}:${activeDatabase.id}`}
                    vault={vault.path}
                    workspace={workspace}
                    database={activeDatabase}
                    refresh={vault.refresh}
                    openBody={openBody}
                    addProperty={() => setDialog({ kind: 'property', database: activeDatabase })}
                    editProperty={(property) => void editProperty(activeDatabase, property).catch(onError)}
                    deleteProperty={(property) =>
                      setDialog({ kind: 'property-delete', database: activeDatabase, property })
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
              {workView === 'graph' && (
                <GraphView
                  key={workspace.vault.id}
                  workspace={workspace}
                  openNote={(id) => void openNote(id)}
                  openLink={openLink}
                />
              )}
              {workView === 'timeline' && (
                <TimelineView workspace={workspace} openNote={(id) => void openNote(id)} />
              )}
              {workView === 'topics' && (
                <TopicsView
                  key={workspace.vault.id}
                  workspace={workspace}
                  options={topicOptions}
                  refresh={vault.refresh}
                  updateSettings={updateSettings}
                  toggleSources={() => dispatch('topics.sources.toggle')}
                  onChange={setTopicOptions}
                  openNote={(id, line) => void openNote(id, line)}
                  openLink={openLink}
                />
              )}
              {workView === 'plugin' && (
                <PluginView
                  pluginId={plugins.active?.pluginId}
                  title={plugins.active?.title ?? '플러그인'}
                  tree={plugins.tree}
                  busy={plugins.busy}
                  error={plugins.active ? plugins.errors[plugins.active.pluginId] : undefined}
                  action={plugins.action}
                  refresh={() => void plugins.renderView()}
                />
              )}
              {workView === 'trash' && (
                <TrashView
                  items={workspace.trash}
                  vault={vault.path}
                  refresh={vault.refresh}
                  onError={onError}
                />
              )}
            </div>
            <div
              className="workspace-content workspace-settings-content"
              data-focus-region={settingsNavigation.opened ? 'main' : undefined}
              tabIndex={-1}
              inert={!settingsNavigation.opened}
              aria-hidden={!settingsNavigation.opened}
            >
              <SettingsView
                pluginErrors={plugins.errors}
                beforeDisablePlugin={plugins.stop}
                invokePluginSettings={plugins.invokeSettings}
                pluginViewRevision={plugins.viewRevision}
                active={settingsNavigation.opened}
                group={settingsNavigation.group}
                workspace={workspace}
                commands={commands}
                update={updateSettings}
                refresh={vault.refresh}
                onError={onError}
                updates={updates}
              />
            </div>
          </div>
          <div className="vim-command-dock" ref={commandLineHost} hidden={settingsNavigation.opened} />
          <footer className="statusbar">
            <span className={`mode-badge ${mode.toLowerCase()}`}>
              {!settingsNavigation.opened && view === 'notes' && noteId && !preview ? mode : 'NAVIGATE'}
            </span>
            <span className="vim-status">{workspace.settings.vim ? 'VIM ON' : 'VIM OFF'}</span>
            <span className="status-hint">
              <kbd>{leaderLabel(workspace.settings.leader)}</kbd>명령 시작
            </span>
            <span className="status-right">
              {!settingsNavigation.opened && view === 'notes' && noteId && (
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
            forget={async (path) => {
              if (path === vault.path) await selectVault(async () => vault.forget(path));
              else vault.forget(path);
            }}
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
        {plugins.git.connection && (
          <GitConnectionDialog
            connection={plugins.git.connection}
            busy={plugins.git.busy}
            error={plugins.git.error}
            confirm={plugins.git.confirm}
            close={plugins.git.close}
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
            save={note.save}
            close={closeFolderDialog}
            refresh={vault.refresh}
            onDeleted={() => requestAnimationFrame(focusSidebarTree)}
          />
        )}
        {databaseActions.deleting && (
          <DeleteDatabaseDialog
            key={`${vault.path}:${databaseActions.deleting.database.id}`}
            snapshot={databaseActions.deleting}
            busy={databaseActions.busy}
            confirm={databaseActions.confirmDelete}
            close={databaseActions.closeDelete}
          />
        )}
        {noteActions.moving && (
          <FolderDialog
            target={{ kind: 'move', note: noteActions.moving, submit: noteActions.move }}
            vault={vault.path}
            folders={workspace.folders}
            save={note.save}
            close={noteActions.closeMove}
            refresh={vault.refresh}
          />
        )}
        {pending !== null && (
          <div className="leader-guide" role="status">
            <div>
              <CommandIcon size={15} />
              <strong>
                {leaderLabel(workspace.settings.leader)} {pending}
              </strong>
              <small>다음 키를 입력하세요 · Esc 취소</small>
            </div>
            <section>
              {leaderCandidates(commands, workspace.settings, pending).map(({ command, binding }) => (
                <span key={`${command.id}:${binding.keys}`}>
                  <kbd>{sequenceKeys(binding) ?? binding.keys}</kbd>
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
      <AppUpdateDialogs updates={updates} />
      {noteActions.busy && (
        <div className="note-action-progress" role="status">
          <Loader2 size={18} />
          노트를 처리하고 있습니다…
        </div>
      )}
    </TagNavigation>
  );
  return (
    <NoteChatHost
      value={{
        workspace,
        noteId: workView === 'notes' ? noteId : null,
        save: note.save,
        refresh: vault.refresh,
        notify: setToast,
      }}
    >
      {content}
    </NoteChatHost>
  );
}
