import { useEffect, useRef, useState, type DragEvent } from 'react';
import { moveColumn, orderedColumns, readColumnOrder } from './columnOrder';
import type { Property } from './types';

const dragType = 'application/x-foltra-column';
type Placement = 'before' | 'after';
export interface ColumnReorder {
  dragging: boolean;
  placement?: Placement;
  start: (event: DragEvent) => void;
  over: (event: DragEvent<HTMLTableCellElement>) => void;
  leave: (event: DragEvent<HTMLTableCellElement>) => void;
  drop: (event: DragEvent<HTMLTableCellElement>) => void;
  end: () => void;
  left?: () => void;
  right?: () => void;
}

function readOrder(key: string) {
  try {
    return { key, ids: readColumnOrder(localStorage.getItem(key)) };
  } catch {
    return { key, ids: [] as string[] };
  }
}

export function useColumnOrder(key: string, properties: Property[], onError: (error: unknown) => void) {
  const [saved, setSaved] = useState(() => readOrder(key));
  // Read the destination layout before rendering it; only explicit moves write to storage.
  let current = saved;
  if (current.key !== key) {
    current = readOrder(key);
    setSaved(current);
  }
  const columns = orderedColumns(properties, current.ids);
  const ids = columns.map((property) => property.id);
  const scope = JSON.stringify([key, properties.map((property) => property.id)]);
  const source = useRef<{ id: string; scope: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<{ id: string; placement: Placement } | null>(null);
  const end = () => {
    source.current = null;
    setDragging(null);
    setTarget(null);
  };
  useEffect(() => {
    source.current = null;
    setDragging(null);
    setTarget(null);
  }, [scope]);

  const move = (from: string, to: string, placement: Placement) => {
    const next = moveColumn(ids, from, to, placement);
    if (next.every((id, index) => id === ids[index])) return;
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setSaved({ key, ids: next });
    } catch (error) {
      onError(error);
    }
  };
  const placementAt = (event: DragEvent<HTMLTableCellElement>): Placement => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
  };
  const header = (id: string): ColumnReorder => {
    const index = ids.indexOf(id);
    return {
      dragging: dragging === id,
      placement: target?.id === id ? target.placement : undefined,
      start: (event) => {
        event.dataTransfer.setData(dragType, `${key}:${id}`);
        event.dataTransfer.effectAllowed = 'move';
        source.current = { id, scope };
        setDragging(id);
        setTarget(null);
      },
      over: (event) => {
        if (source.current?.scope !== scope) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const placement = placementAt(event);
        setTarget((previous) =>
          source.current?.id === id
            ? null
            : previous?.id === id && previous.placement === placement
              ? previous
              : { id, placement },
        );
      },
      leave: (event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setTarget((previous) => (previous?.id === id ? null : previous));
      },
      drop: (event) => {
        const active = source.current;
        if (active?.scope !== scope || event.dataTransfer.getData(dragType) !== `${key}:${active.id}`) return;
        event.preventDefault();
        move(active.id, id, placementAt(event));
        end();
      },
      end,
      left: index > 0 ? () => move(id, ids[index - 1], 'before') : undefined,
      right: index < ids.length - 1 ? () => move(id, ids[index + 1], 'after') : undefined,
    };
  };
  return { columns, header };
}
