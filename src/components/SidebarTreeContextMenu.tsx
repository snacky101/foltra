import { FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Database, Folder } from '../lib/types';
import type { FolderAction } from '../lib/useTreeEditing';
import { ContextMenu } from './ContextMenu';
import { DatabaseContextMenu, type DatabaseAction } from './DatabaseContextMenu';

export type SidebarMenuTarget = { x: number; y: number } & (
  | { kind: 'notes' | 'databases' }
  | { kind: 'folder'; folder: Folder }
  | { kind: 'database'; database: Database }
);

export function SidebarTreeContextMenu({
  target,
  close,
  createNote,
  createDatabase,
  folderAction,
  databaseAction,
}: {
  target: SidebarMenuTarget;
  close: () => void;
  createNote: (folderId?: string) => void;
  createDatabase: () => void;
  folderAction: (action: FolderAction) => void;
  databaseAction: (action: DatabaseAction, database: Database) => void;
}) {
  if (target.kind === 'database')
    return <DatabaseContextMenu target={target} close={close} run={databaseAction} />;
  const folder = target.kind === 'folder' ? target.folder : null;
  return (
    <ContextMenu
      position={target}
      title={folder?.name ?? (target.kind === 'databases' ? '데이터베이스' : '노트')}
      close={close}
      items={
        target.kind === 'databases'
          ? [{ id: 'database', label: '새 데이터베이스', Icon: Plus, run: createDatabase }]
          : [
              {
                id: 'note',
                label: folder ? '여기에 새 노트' : '새 노트',
                Icon: Plus,
                run: () => createNote(folder?.id),
              },
              {
                id: 'folder',
                label: folder ? '하위 폴더 만들기' : '새 폴더',
                Icon: FolderPlus,
                run: () =>
                  folderAction(folder ? { kind: 'create', parentId: folder.id } : { kind: 'create' }),
              },
              ...(folder
                ? [
                    {
                      id: 'rename',
                      label: '이름 변경',
                      Icon: Pencil,
                      run: () => folderAction({ kind: 'rename', folder }),
                    },
                    {
                      id: 'delete',
                      label: '휴지통으로 이동',
                      Icon: Trash2,
                      danger: true,
                      run: () => folderAction({ kind: 'delete', folder }),
                    },
                  ]
                : []),
            ]
      }
    />
  );
}
