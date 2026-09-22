import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ChevronDown, ChevronRight, FolderPlus, Plus, ListCollapse, ListOrdered } from 'lucide-react';
import type { Folder, NoteSummary, Workspace, Settings } from '../lib/types';
import type { NoteMenuTarget } from './NoteContextMenu';
import type { FolderAction, useTreeEditing } from '../lib/useTreeEditing';
import { treeChildren, reorderTree } from '../lib/treeOrder';
import { TreeIcon, type TreeIcons } from './TreeIcon';
import { InlineTreeName } from './InlineTreeName';

const dragTypes = { note: 'application/x-foltra-note', folder: 'application/x-foltra-folder' };
type TreeDrag = { kind: 'note' | 'folder'; id: string };
type DragItem = { kind: 'note'; item: NoteSummary } | { kind: 'folder'; item: Folder };

export function NoteTree({
  workspace,
  activeId,
  openNote,
  renameNote,
  noteMenu,
  folderMenu,
  rootMenu,
  folderDialog,
  createNote,
  moveNote,
  onError,
  treeEditing,
  collapseVersion = 0,
  collapseAll,
  toggleCustomSort,
  updateSettings,
  icons,
}: {
  collapseVersion?: number;
  collapseAll?: () => void;
  toggleCustomSort?: () => void;
  updateSettings?: (patch: Partial<Settings>) => Promise<boolean>;
  icons?: TreeIcons;
  workspace: Workspace;
  activeId: string | null;
  openNote: (id: string) => void;
  renameNote: (note: NoteSummary) => void;
  noteMenu: (target: NoteMenuTarget) => void;
  folderMenu: (target: { folder: Folder; x: number; y: number }) => void;
  rootMenu: (position: { x: number; y: number }) => void;
  folderDialog: (target: FolderAction) => void;
  createNote: (folderId?: string) => void;
  moveNote: (note: NoteSummary, folderId: string) => Promise<void>;
  onError: (error: unknown) => void;
  treeEditing: ReturnType<typeof useTreeEditing>;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (collapseVersion) setCollapsed(new Set(workspace.folders.map((folder) => folder.id)));
  }, [collapseVersion]);
  const [insertion, setInsertion] = useState<{ id: string; after: boolean } | null>(null);
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const custom = workspace.settings?.treeCustomSort ?? false;
  const { editing, commit, cancel } = treeEditing;
  useEffect(() => {
    if (!editing) return;
    const parents = new Set<string>();
    let parent = editing.parentId;
    while (parent && !parents.has(parent)) {
      parents.add(parent);
      parent = workspace.folders.find((f) => f.id === parent)?.parentId ?? null;
    }
    setCollapsed((old) => new Set([...old].filter((id) => !parents.has(id))));
  }, [editing?.id]);
  const dragSource = useRef<TreeDrag | null>(null);
  const [dragging, setDragging] = useState<TreeDrag | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const destinationName =
    dropTarget === null
      ? '폴더로 이동'
      : dropTarget === ''
        ? '최상위로 이동'
        : `${workspace.folders.find((folder) => folder.id === dropTarget)?.name ?? ''} 폴더로 이동`;
  const endDrag = () => {
    dragSource.current = null;
    setDragging(null);
    setDropTarget(null);
    setInsertion(null);
  };
  const startDrag = (event: DragEvent, kind: TreeDrag['kind'], id: string) => {
    if (pending.current) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    event.dataTransfer.setData(dragTypes[kind], id);
    event.dataTransfer.effectAllowed = 'move';
    dragSource.current = { kind, id };
    setDragging(dragSource.current);
  };
  const dropEvents = (folderId: string) => {
    const source = (event: DragEvent): DragItem | undefined => {
      // Only drags started in this vault's tree are accepted, never external payloads.
      const drag = dragSource.current;
      if (pending.current || !drag || !event.dataTransfer.types.includes(dragTypes[drag.kind])) return;
      if (drag.kind === 'note') {
        const note = workspace.notes.find((n) => n.id === drag.id);
        if (note && (note.folderId ?? '') !== folderId) return { kind: 'note', item: note };
      } else {
        const folder = workspace.folders.find((f) => f.id === drag.id);
        if (!folder || (folder.parentId ?? '') === folderId) return;
        const ancestors = new Set([folder.id]);
        let parent = folderId;
        while (parent) {
          if (ancestors.has(parent)) return;
          ancestors.add(parent);
          const destination = workspace.folders.find((f) => f.id === parent);
          if (!destination) return;
          parent = destination.parentId ?? '';
        }
        return { kind: 'folder', item: folder };
      }
    };
    return {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (!source(event)) {
          event.dataTransfer.dropEffect = 'none';
          setDropTarget(null);
          return;
        }
        event.dataTransfer.dropEffect = 'move';
        setInsertion(null);
        setDropTarget(folderId);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        const target = source(event);
        event.preventDefault();
        event.stopPropagation();
        endDrag();
        if (!target) return;
        const move =
          target.kind === 'note'
            ? moveNote(target.item, folderId)
            : treeEditing.moveFolder(target.item, folderId);
        void move
          .then(() => {
            setCollapsed((old) => {
              const next = new Set(old);
              next.delete(folderId);
              return next;
            });
          })
          .catch(onError);
      },
    };
  };
  const toggle = (id: string) =>
    setCollapsed((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const insertionEvents = (id: string, parent: string | null) => {
    const placement = (event: DragEvent<HTMLElement>) => {
      const source = dragSource.current;
      if (
        !custom ||
        pending.current ||
        !source ||
        source.id === id ||
        !event.dataTransfer.types.includes(dragTypes[source.kind])
      )
        return null;
      if (
        source.kind === 'note'
          ? !workspace.notes.some((note) => note.id === source.id)
          : !workspace.folders.some((folder) => folder.id === source.id)
      )
        return null;
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = (event.clientY - rect.top) / rect.height;
      if (ratio >= 0.25 && ratio <= 0.75) return null;
      const folder =
        source.kind === 'folder' ? workspace.folders.find((folder) => folder.id === source.id) : null;
      const seen = new Set<string>();
      let ancestor = parent;
      while (ancestor && !seen.has(ancestor)) {
        if (ancestor === folder?.id) return null;
        seen.add(ancestor);
        ancestor = workspace.folders.find((item) => item.id === ancestor)?.parentId ?? null;
      }
      return { source, after: ratio > 0.5 };
    };
    return {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        const destination = placement(event);
        if (!destination) {
          setInsertion(null);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setDropTarget(null);
        setInsertion({ id, after: destination.after });
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInsertion(null);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        const destination = placement(event);
        if (!destination || !updateSettings) return;
        event.preventDefault();
        event.stopPropagation();
        endDrag();
        pending.current = true;
        setSaving(true);
        const { source, after } = destination;
        void (async () => {
          if (source.kind === 'note') {
            const note = workspace.notes.find((note) => note.id === source.id)!;
            if ((note.folderId ?? null) !== parent) await moveNote(note, parent ?? '');
          } else {
            const folder = workspace.folders.find((folder) => folder.id === source.id)!;
            if (folder.parentId !== parent) await treeEditing.moveFolder(folder, parent ?? '');
          }
          await updateSettings({ treeOrder: reorderTree(workspace, source.id, id, after) });
        })()
          .catch(onError)
          .finally(() => {
            pending.current = false;
            setSaving(false);
          });
      },
    };
  };
  const branch = (parentId: string | null): React.ReactNode =>
    treeChildren(workspace, parentId).map((entry) => {
      if (entry.kind === 'folder') {
        const folder = entry.item;
        return (
          <div
            className={`folder-branch${dropTarget === folder.id ? ' note-drop-branch' : ''}${dragging?.kind === 'folder' && dragging.id === folder.id ? ' note-dragging' : ''}`}
            key={folder.id}
            {...dropEvents(folder.id)}
          >
            <div
              className={`note-navigation-row${dropTarget === folder.id ? ' note-drop-target' : ''}`}
              data-folder-id={folder.id}
              {...insertionEvents(folder.id, parentId)}
              data-drop-position={
                insertion?.id === folder.id ? (insertion.after ? 'after' : 'before') : undefined
              }
            >
              {editing?.kind === 'folder' && editing.id === folder.id ? (
                <InlineTreeName
                  key={editing.id}
                  target={editing}
                  icons={icons}
                  expanded={!collapsed.has(folder.id)}
                  commit={commit}
                  cancel={cancel}
                />
              ) : (
                <button
                  draggable
                  onDragStart={(event) => startDrag(event, 'folder', folder.id)}
                  onDragEnd={endDrag}
                  data-sidebar-item
                  data-tree-item
                  data-parent-folder={parentId ?? ''}
                  aria-expanded={!collapsed.has(folder.id)}
                  title={folder.name}
                  onClick={() => toggle(folder.id)}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    folderDialog({ kind: 'rename', folder });
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.focus();
                    folderMenu({ folder, x: e.clientX, y: e.clientY });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                      e.preventDefault();
                      e.stopPropagation();
                      const r = e.currentTarget.getBoundingClientRect();
                      folderMenu({ folder, x: r.left, y: r.bottom });
                    }
                  }}
                >
                  {collapsed.has(folder.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  <TreeIcon kind="folder" id={folder.id} icons={icons} />
                  <span>{folder.name}</span>
                </button>
              )}
            </div>
            {!collapsed.has(folder.id) && <div className="folder-children">{branch(folder.id)}</div>}
          </div>
        );
      }
      const note = entry.item;
      return (
        <div
          className={`note-navigation-row${dragging?.kind === 'note' && dragging.id === note.id ? ' note-dragging' : ''}`}
          key={note.id}
          data-note-id={note.id}
          {...insertionEvents(note.id, parentId)}
          data-drop-position={insertion?.id === note.id ? (insertion.after ? 'after' : 'before') : undefined}
        >
          {editing?.kind === 'note' && editing.id === note.id ? (
            <InlineTreeName icons={icons} key={editing.id} target={editing} commit={commit} cancel={cancel} />
          ) : (
            <button
              draggable
              onDragStart={(event) => startDrag(event, 'note', note.id)}
              onDragEnd={endDrag}
              data-sidebar-item
              data-tree-item
              data-parent-folder={note.folderId ?? ''}
              className={activeId === note.id ? 'active' : ''}
              title={note.title}
              onClick={(event) => {
                if (event.detail < 2) openNote(note.id);
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                renameNote(note);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.focus();
                noteMenu({ note, x: e.clientX, y: e.clientY });
              }}
              onKeyDown={(e) => {
                if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                  e.preventDefault();
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  noteMenu({ note, x: r.left + 12, y: r.bottom });
                }
              }}
            >
              <TreeIcon kind="note" id={note.id} icons={icons} />
              <span>{note.title}</span>
            </button>
          )}
        </div>
      );
    });
  return (
    <div
      className="note-tree"
      aria-busy={saving}
      aria-label="노트 영역"
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest('[data-inline-rename]')) return;
        event.preventDefault();
        event.stopPropagation();
        rootMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <div
        className={`sidebar-section-title notes-root${dragging ? ' note-drag-active' : ''}${dropTarget === '' ? ' note-drop-target' : ''}`}
        aria-label="노트 최상위 폴더"
        {...dropEvents('')}
      >
        <span>
          <ChevronDown size={12} /> NOTES{' '}
          {dragging && <small title={destinationName}>{destinationName}</small>}
        </span>
        <div className="sidebar-section-actions">
          <button
            aria-label="폴더 모두 접기"
            title="폴더 모두 접기"
            onClick={
              collapseAll ?? (() => setCollapsed(new Set(workspace.folders.map((folder) => folder.id))))
            }
          >
            <ListCollapse size={14} />
          </button>
          <button
            aria-label="커스텀 정렬"
            title={
              custom
                ? '커스텀 정렬 사용 중 · 끄면 기본 정렬'
                : '커스텀 정렬 · 행 가장자리로 드래그하여 순서 변경'
            }
            aria-pressed={custom}
            disabled={saving}
            onClick={toggleCustomSort}
          >
            <ListOrdered size={14} />
          </button>
          <button
            data-sidebar-item
            aria-label="새 폴더"
            title="새 폴더"
            onClick={() => folderDialog({ kind: 'create' })}
          >
            <FolderPlus size={14} />
          </button>
          <button data-sidebar-item aria-label="새 노트" onClick={() => createNote()}>
            <Plus size={14} />
          </button>
        </div>
      </div>
      <div className="note-navigation" aria-label="노트와 폴더" {...dropEvents('')}>
        {branch(null)}
        {!workspace.notes.length && !workspace.folders.length && (
          <button data-sidebar-item onClick={() => createNote()}>
            <Plus size={14} />
            <span>첫 노트 작성하기</span>
          </button>
        )}
      </div>
    </div>
  );
}
