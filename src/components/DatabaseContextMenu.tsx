import { ArrowUpRight, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Database } from '../lib/types';
import type { DatabaseAction } from '../lib/useDatabaseActions';
import { ContextMenu } from './ContextMenu';

export type { DatabaseAction } from '../lib/useDatabaseActions';
const items = [
  { action: 'open', label: '열기', Icon: ArrowUpRight },
  { action: 'rename', label: '이름 변경', Icon: Pencil },
  { action: 'new-record', label: '새 행 추가', Icon: Plus },
  { action: 'delete', label: '휴지통으로 이동', Icon: Trash2 },
] as const;

export function DatabaseContextMenu({
  target,
  close,
  run,
}: {
  target: { database: Database; x: number; y: number };
  close: () => void;
  run: (action: DatabaseAction, database: Database) => void;
}) {
  return (
    <ContextMenu
      position={target}
      title={target.database.name}
      close={close}
      items={items.map(({ action, label, Icon }) => ({
        id: action,
        label,
        Icon,
        danger: action === 'delete',
        run: () => run(action, target.database),
      }))}
    />
  );
}
