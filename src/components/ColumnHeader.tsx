import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Property } from '../lib/types';
import { clampColumnWidth, defaultColumnWidth } from '../lib/columnWidths';

export function ColumnHeader({
  property,
  width,
  resize,
  edit,
}: {
  property: Property;
  width: number;
  resize: (width: number) => void;
  edit: () => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <th className={dragging ? 'column-resizing' : ''} data-property-id={property.id}>
      <button
        type="button"
        className="column-heading"
        aria-label={`${property.name} 컬럼 설정`}
        aria-haspopup="dialog"
        onClick={edit}
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
        <ChevronDown size={12} />
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
    </th>
  );
}
