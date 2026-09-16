import { CalendarDays, Files, Layers3, List, ListCollapse, Network, Search } from 'lucide-react';
import type { View } from '../lib/types';

export function SidebarNavigation({
  view,
  noteCount,
  compact,
  toggleCompact,
  navigate,
  search,
}: {
  view: View;
  noteCount: number;
  compact: boolean;
  toggleCompact: () => void;
  navigate: (view: View) => void;
  search: () => void;
}) {
  const items = [
    { view: 'all-notes', label: '모든 노트', icon: Files },
    { view: null, label: '내용 검색', icon: Search },
    { view: 'graph', label: '지식 그래프', icon: Network },
    { view: 'timeline', label: '타임라인', icon: CalendarDays },
    { view: 'topics', label: '주제 모음', icon: Layers3 },
  ] as const;
  return (
    <nav
      className={`main-navigation${compact ? ' is-compact' : ''}`}
      aria-label="탐색 메뉴"
      data-focus-region="sidebar-navigation"
      tabIndex={-1}
    >
      <div className="navigation-items">
        {items.map(({ view: target, label, icon: Icon }) => (
          <button
            key={label}
            data-sidebar-item
            className={view === target ? 'active' : ''}
            aria-label={label}
            aria-current={view === target ? 'page' : undefined}
            title={target === 'all-notes' ? `${label} · ${noteCount}개` : label}
            onClick={() => (target ? navigate(target) : search())}
          >
            <Icon size={17} />
            <span>{label}</span>
            {target === 'all-notes' && <small>{noteCount}</small>}
          </button>
        ))}
      </div>
      <button
        className="navigation-density-toggle"
        aria-label="탐색 메뉴 컴팩트 모드"
        aria-pressed={compact}
        title={compact ? '탐색 메뉴 목록으로 보기' : '탐색 메뉴 아이콘으로 보기'}
        onClick={toggleCompact}
      >
        {compact ? <List size={15} /> : <ListCollapse size={15} />}
      </button>
    </nav>
  );
}
