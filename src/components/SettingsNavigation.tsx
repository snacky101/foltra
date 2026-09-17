import { ArrowLeft, Keyboard, MousePointer2, Palette, Puzzle, Table2, Type } from 'lucide-react';
import { settingsGroups, type SettingsGroup } from '../lib/settingsNavigation';

const icons = {
  editor: Type,
  database: Table2,
  cursor: MousePointer2,
  keyboard: Keyboard,
  theme: Palette,
  extensions: Puzzle,
};

export function SettingsNavigation({
  group,
  select,
  close,
}: {
  group: SettingsGroup;
  select: (group: SettingsGroup) => void;
  close: () => void;
}) {
  return (
    <div className="settings-navigation" data-focus-region="settings-navigation" tabIndex={-1}>
      <button className="settings-return" onClick={close}>
        <ArrowLeft size={16} />
        <span>작업으로 돌아가기</span>
      </button>
      <div className="settings-navigation-title">설정</div>
      <nav aria-label="설정 그룹">
        {settingsGroups.map(({ id, title }) => {
          const Icon = icons[id];
          return (
            <button
              key={id}
              data-settings-group={id}
              className={group === id ? 'active' : ''}
              aria-current={group === id ? 'page' : undefined}
              onClick={() => select(id)}
            >
              <Icon size={16} />
              <span>{title}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
