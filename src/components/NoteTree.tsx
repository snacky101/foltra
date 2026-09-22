import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder as FolderIcon, FolderPlus, Plus } from 'lucide-react';
import type { Folder, NoteSummary, Workspace } from '../lib/types';
import type { NoteMenuTarget } from './NoteContextMenu';
import type { FolderAction, useTreeEditing } from '../lib/useTreeEditing';
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
}: {
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
  };
  const startDrag = (event: DragEvent, kind: TreeDrag['kind'], id: string) => {
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
      if (!drag || !event.dataTransfer.types.includes(dragTypes[drag.kind])) return;
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
  const branch = (parentId: string | null): React.ReactNode => (
    <>
      {workspace.folders
        .filter((f) => f.parentId === parentId)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((folder) => (
          <div
            className={`folder-branch${dropTarget === folder.id ? ' note-drop-branch' : ''}${dragging?.kind === 'folder' && dragging.id === folder.id ? ' note-dragging' : ''}`}
            key={folder.id}
            {...dropEvents(folder.id)}
          >
            <div
              className={`note-navigation-row${dropTarget === folder.id ? ' note-drop-target' : ''}`}
              data-folder-id={folder.id}
            >
              {editing?.kind === 'folder' && editing.id === folder.id ? (
                <InlineTreeName
                  key={editing.id}
                  target={editing}
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
                  <FolderIcon size={15} />
                  <span>{folder.name}</span>
                </button>
              )}
            </div>
            {!collapsed.has(folder.id) && <div className="folder-children">{branch(folder.id)}</div>}
          </div>
        ))}
      {workspace.notes
        .filter(
          (n) =>
            (n.folderId ?? null) === parentId ||
            (parentId === null && n.folderId && !workspace.folders.some((f) => f.id === n.folderId)),
        )
        .map((note) => (
          <div
            className={`note-navigation-row${dragging?.kind === 'note' && dragging.id === note.id ? ' note-dragging' : ''}`}
            key={note.id}
            data-note-id={note.id}
          >
            {editing?.kind === 'note' && editing.id === note.id ? (
              <InlineTreeName key={editing.id} target={editing} commit={commit} cancel={cancel} />
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
                <FileText size={15} />
                <span>{note.title}</span>
              </button>
            )}
          </div>
        ))}
    </>
  );
  return (
    <div
      className="note-tree"
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
