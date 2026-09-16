import { createRoot } from 'react-dom/client';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import { ContextMenu, type MenuItem } from '../components/ContextMenu';

export function showTableContextMenu(
  position: { x: number; y: number },
  row: number,
  column: number,
  columns: number,
  actions: {
    edit: () => void;
    insertRow: (above: boolean) => void;
    insertColumn: (column: number) => void;
    deleteRow: () => void;
    deleteColumn: () => void;
  },
) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    queueMicrotask(() => {
      root.unmount();
      host.remove();
    });
  };
  const items: MenuItem[] = [
    { id: 'edit', label: '셀 편집', Icon: Pencil, run: actions.edit },
    ...(row > 0
      ? [{ id: 'above', label: '위에 행 추가', Icon: ArrowUp, run: () => actions.insertRow(true) }]
      : []),
    { id: 'below', label: '아래에 행 추가', Icon: ArrowDown, run: () => actions.insertRow(false) },
    { id: 'left', label: '왼쪽에 열 추가', Icon: ArrowLeft, run: () => actions.insertColumn(column) },
    { id: 'right', label: '오른쪽에 열 추가', Icon: ArrowRight, run: () => actions.insertColumn(column + 1) },
    ...(row > 0
      ? [{ id: 'delete-row', label: '행 삭제', Icon: Trash2, danger: true, run: actions.deleteRow }]
      : []),
    ...(columns > 1
      ? [{ id: 'delete-column', label: '열 삭제', Icon: Trash2, danger: true, run: actions.deleteColumn }]
      : []),
  ];
  root.render(
    <ContextMenu
      position={position}
      title={`표 · ${row + 1}행 ${column + 1}열`}
      items={items}
      close={close}
    />,
  );
  return close;
}
