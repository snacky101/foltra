import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export function ResizableSidebar({
  side,
  children,
  collapsed = false,
}: {
  side: 'left' | 'right';
  children: ReactNode;
  collapsed?: boolean;
}) {
  const initialWidth = side === 'left' ? 242 : 254;
  const minimum = side === 'left' ? 200 : 220;
  const storageKey = `foltra:sidebar-width:${side}`;
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored >= minimum ? Math.min(480, stored) : initialWidth;
  });
  const [actualWidth, setActualWidth] = useState(width);
  const [dragging, setDragging] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    localStorage.setItem(storageKey, String(width));
  }, [storageKey, width]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setActualWidth(Math.round(entry.contentRect.width)));
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const resize = (value: number) => {
    const panel = container.current!;
    const shell = panel.closest('.app-shell')!;
    const other = shell.querySelector<HTMLElement>(
      `.resizable-sidebar-${side === 'left' ? 'right' : 'left'}`,
    );
    const maximum = Math.min(480, shell.clientWidth - (other?.getBoundingClientRect().width ?? 0) - 400);
    setWidth(Math.round(Math.max(minimum, Math.min(maximum, value))));
  };
  return (
    <div
      ref={container}
      hidden={collapsed}
      className={`resizable-sidebar resizable-sidebar-${side}${dragging ? ' is-resizing' : ''}`}
      style={{ '--sidebar-width': `${width}px` } as CSSProperties}
    >
      {children}
      <div
        className="sidebar-resize-handle"
        role="separator"
        aria-label={side === 'left' ? '왼쪽 사이드바 너비' : '오른쪽 사이드바 너비'}
        aria-orientation="vertical"
        aria-valuemin={minimum}
        aria-valuemax={480}
        aria-valuenow={actualWidth}
        tabIndex={0}
        title="드래그하여 너비 조절 · 두 번 클릭하여 초기화"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          start.current = { x: event.clientX, width: actualWidth };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!start.current) return;
          resize(start.current.width + (event.clientX - start.current.x) * (side === 'left' ? 1 : -1));
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => {
          start.current = null;
          setDragging(false);
        }}
        onDoubleClick={() => setWidth(initialWidth)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home') return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === 'Home') setWidth(initialWidth);
          else resize(actualWidth + (event.key === 'ArrowRight' ? 10 : -10) * (side === 'left' ? 1 : -1));
        }}
      />
    </div>
  );
}
