import { ContextMenu } from './ContextMenu';
import { ArrowUpRight, Copy, Link, Pencil, Trash2, FolderInput } from 'lucide-react';
import type { NoteAction } from '../lib/useNoteActions';
import type { NoteSummary } from '../lib/types';

export interface NoteMenuTarget {
  note: NoteSummary;
  x: number;
  y: number;
}
const items = [
  { action: 'open', label: '열기', Icon: ArrowUpRight },
  { action: 'rename', label: '이름 변경', Icon: Pencil },
  { action: 'move', label: '폴더로 이동', Icon: FolderInput },
  { action: 'duplicate', label: '복제', Icon: Copy },
  { action: 'copy-link', label: '내부 링크 복사', Icon: Link },
  { action: 'delete', label: '휴지통으로 이동', Icon: Trash2 },
] as const;

export function NoteContextMenu({
  target,
  close,
  run,
}: {
  target: NoteMenuTarget;
  close: () => void;
  run: (action: NoteAction, note: NoteSummary) => void;
}) {
  return (
    <ContextMenu
      position={target}
      title={target.note.title}
      close={close}
      items={items.map(({ action, label, Icon }) => ({
        id: action,
        label,
        Icon,
        danger: action === 'delete',
        run: () => run(action, target.note),
      }))}
    />
  );
}
