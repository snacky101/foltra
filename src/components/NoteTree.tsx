import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder as FolderIcon, FolderPlus, Plus } from 'lucide-react';
import type { Folder, NoteSummary, Workspace } from '../lib/types';
import type { NoteMenuTarget } from './NoteContextMenu';
import type { FolderAction, useTreeEditing } from '../lib/useTreeEditing';
import { InlineTreeName } from './InlineTreeName';

const noteDragType = 'application/x-foltra-note';

export function NoteTree({
  workspace,
  activeId,
  openNote,
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
  const dragSource = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const endDrag = () => {
    dragSource.current = null;
    setDragging(null);
    setDropTarget(null);
  };
  const dropEvents = (folderId: string) => {
    const source = (event: DragEvent) => {
      // Only a drag started in this vault's tree can move a note. Never read external payloads.
      if (!event.dataTransfer.types.includes(noteDragType)) return;
      const note = workspace.notes.find((n) => n.id === dragSource.current);
      if (note && (note.folderId ?? '') !== folderId) return note;
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
        const note = source(event);
        event.preventDefault();
        event.stopPropagation();
        endDrag();
        if (!note) return;
        void moveNote(note, folderId)
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
          <div className="folder-branch" key={folder.id}>
            <div
              className={`note-navigation-row${dropTarget === folder.id ? ' note-drop-target' : ''}`}
              data-folder-id={folder.id}
              {...dropEvents(folder.id)}
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
                  data-sidebar-item
                  data-tree-item
                  data-parent-folder={parentId ?? ''}
                  aria-expanded={!collapsed.has(folder.id)}
                  title={folder.name}
                  onClick={() => toggle(folder.id)}
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
            className={`note-navigation-row${dragging === note.id ? ' note-dragging' : ''}`}
            key={note.id}
            data-note-id={note.id}
          >
            {editing?.kind === 'note' && editing.id === note.id ? (
              <InlineTreeName key={editing.id} target={editing} commit={commit} cancel={cancel} />
            ) : (
              <button
                draggable
                onDragStart={(event) => {
                  event.stopPropagation();
                  event.dataTransfer.setData(noteDragType, note.id);
                  event.dataTransfer.effectAllowed = 'move';
                  dragSource.current = note.id;
                  setDragging(note.id);
                }}
                onDragEnd={endDrag}
                data-sidebar-item
                data-tree-item
                data-parent-folder={note.folderId ?? ''}
                className={activeId === note.id ? 'active' : ''}
                title={note.title}
                onClick={() => openNote(note.id)}
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
          <ChevronDown size={12} /> NOTES {dragging && <small>최상위로 이동</small>}
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
      <div
        className="note-navigation"
        aria-label="노트와 폴더"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'none';
        }}
        onDrop={(event) => {
          event.preventDefault();
          endDrag();
        }}
      >
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
