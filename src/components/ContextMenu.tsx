import { useLayoutEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
export interface MenuItem {
  id: string;
  label: string;
  Icon: LucideIcon;
  danger?: boolean;
  run: () => void;
}
export function ContextMenu({
  position,
  title,
  close,
  items,
}: {
  position: { x: number; y: number };
  title: string;
  close: () => void;
  items: MenuItem[];
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = menu.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.style.left = `${Math.max(8, Math.min(position.x, innerWidth - element.offsetWidth - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(position.y, innerHeight - element.offsetHeight - 8))}px`;
    element.querySelector('button')?.focus();
    const outside = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) close();
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', close);
      if (element.contains(document.activeElement) || document.activeElement === document.body)
        previous?.focus();
    };
  }, [position.x, position.y, close]);
  return (
    <div
      ref={menu}
      className="note-context-menu"
      role="menu"
      aria-label={`${title} 메뉴`}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        e.stopPropagation();
        if (e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault();
          close();
          return;
        }
        const buttons = [...(menu.current?.querySelectorAll('button') ?? [])];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? buttons.length - 1
              : e.key === 'ArrowDown'
                ? (index + 1) % buttons.length
                : e.key === 'ArrowUp'
                  ? (index + buttons.length - 1) % buttons.length
                  : null;
        if (next !== null) {
          e.preventDefault();
          buttons[next]?.focus();
        }
      }}
    >
      <div className="note-menu-title">{title}</div>
      {items.map(({ id, label, Icon, danger, run }) => (
        <button
          key={id}
          type="button"
          role="menuitem"
          className={danger ? 'note-menu-delete' : ''}
          onClick={() => {
            close();
            run();
          }}
        >
          <Icon size={15} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
