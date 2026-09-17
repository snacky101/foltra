import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, FileText, Pencil, Trash2 } from 'lucide-react';
import { ContextMenu } from './ContextMenu';
import type { Property } from '../lib/types';
import { clampColumnWidth, defaultColumnWidth } from '../lib/columnWidths';
import type { ColumnReorder } from '../lib/useColumnOrder';

export function ColumnHeader({
  property,
  width,
  resize,
  edit,
  direction,
  sort,
  remove,
  bodyColumn = false,
  reorder,
}: {
  property: Property;
  width: number;
  resize: (width: number) => void;
  edit: () => void;
  direction: 'ascending' | 'descending' | null;
  sort: () => void;
  remove?: () => void;
  bodyColumn?: boolean;
  reorder?: ColumnReorder;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const suppressSort = useRef(false);
  const heading = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useLayoutEffect(() => {
    if (restoreFocus.current) {
      heading.current?.focus();
      restoreFocus.current = false;
    }
  });
  const moveFromMenu = (move: () => void) => () => {
    restoreFocus.current = true;
    move();
  };
  const nextSort =
    direction === 'ascending' ? '내림차순 정렬' : direction === 'descending' ? '정렬 해제' : '오름차순 정렬';
  return (
    <th
      scope="col"
      aria-sort={direction ?? 'none'}
      className={dragging ? 'column-resizing' : reorder?.dragging ? 'column-dragging' : ''}
      data-property-id={property.id}
      data-drop-placement={reorder?.placement}
      onDragOver={reorder?.over}
      onDragLeave={reorder?.leave}
      onDrop={reorder?.drop}
    >
      <button
        ref={heading}
        type="button"
        className="column-heading"
        draggable={!!reorder && !dragging}
        aria-label={`${property.name} 정렬`}
        aria-description={bodyColumn ? '각 행의 노트를 만들거나 여는 컬럼입니다.' : undefined}
        title={`클릭: ${nextSort}${reorder ? ' · 드래그: 위치 변경' : ''} · 우클릭: 컬럼 메뉴`}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        onPointerDown={() => {
          suppressSort.current = false;
        }}
        onDragStart={(event) => {
          if (!reorder || start.current) {
            event.preventDefault();
            return;
          }
          suppressSort.current = true;
          reorder.start(event);
        }}
        onDragEnd={reorder?.end}
        onClick={() => {
          if (suppressSort.current) {
            suppressSort.current = false;
            return;
          }
          sort();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.currentTarget.focus();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter' || event.key === ' ') suppressSort.current = false;
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({ x: rect.left, y: rect.bottom });
          }
        }}
      >
        <span className="property-kind">
          {property.type === 'number'
            ? '#'
            : property.type === 'date'
              ? '◷'
              : property.type === 'checkbox'
                ? '☑'
                : property.type === 'status'
                  ? '◉'
                  : 'Aa'}
        </span>
        <span>{property.name}</span>
        {direction === 'ascending' && <ArrowUp className="column-sort-arrow" size={14} aria-hidden="true" />}
        {direction === 'descending' && (
          <ArrowDown className="column-sort-arrow" size={14} aria-hidden="true" />
        )}
        {bodyColumn && (
          <span className="column-role" title="각 행의 노트를 만들거나 여는 컬럼입니다.">
            <FileText size={11} aria-hidden="true" />
            노트
          </span>
        )}
      </button>
      <div
        className="column-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label={`${property.name} 컬럼 너비`}
        aria-valuemin={property.id === 'title' ? 180 : 100}
        aria-valuemax={800}
        aria-valuenow={width}
        tabIndex={0}
        title="드래그하여 너비 조절 · 두 번 클릭하여 초기화"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.focus();
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = { x: e.clientX, width };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (start.current)
            resize(clampColumnWidth(start.current.width + e.clientX - start.current.x, property));
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
          start.current = null;
          setDragging(false);
        }}
        onLostPointerCapture={() => {
          start.current = null;
          setDragging(false);
        }}
        onDoubleClick={() => resize(defaultColumnWidth(property))}
        onKeyDown={(e) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) return;
          e.preventDefault();
          e.stopPropagation();
          resize(
            e.key === 'Home'
              ? defaultColumnWidth(property)
              : clampColumnWidth(width + (e.key === 'ArrowRight' ? 10 : -10), property),
          );
        }}
      />
      {menu && (
        <ContextMenu
          title={property.name}
          position={menu}
          close={closeMenu}
          items={[
            { id: 'edit', label: '속성 편집', Icon: Pencil, run: edit },
            ...(reorder?.left
              ? [
                  {
                    id: 'move-left',
                    label: '왼쪽으로 이동',
                    Icon: ArrowLeft,
                    run: moveFromMenu(reorder.left),
                  },
                ]
              : []),
            ...(reorder?.right
              ? [
                  {
                    id: 'move-right',
                    label: '오른쪽으로 이동',
                    Icon: ArrowRight,
                    run: moveFromMenu(reorder.right),
                  },
                ]
              : []),
            ...(remove
              ? [{ id: 'delete', label: '컬럼 삭제', Icon: Trash2, danger: true, run: remove }]
              : []),
          ]}
        />
      )}
    </th>
  );
}
