import { settingsGroups, type SettingsGroup } from '../lib/settingsNavigation';
import { AppUpdatesPanel } from './AppUpdatesPanel';
import type { AppUpdates } from '../lib/useAppUpdates';
import { CursorSettings } from './CursorSettings';
import { TaskMarkerHelp } from './TaskMarkerHelp';
import { FontFamilySetting } from './FontFamilySetting';
import { ExtensionsView } from './ExtensionsView';
import { ThemeSettings } from './ThemeSettings';
import { Select } from './Select';
import { LeaderKeyRecorder } from './LeaderKeyRecorder';
import { memo, useLayoutEffect, useRef, useState } from 'react';
import { Keyboard, Check, RotateCcw, Plus, X } from 'lucide-react';
import {
  bindingsFor,
  bindingConflict,
  bindingText,
  parseBindingText,
  isRegularShortcut,
  type Command,
} from '../lib/commands';
import type { Binding, Settings, Workspace } from '../lib/types';

function bindingDraft(bindings: readonly Binding[]) {
  const sequences = bindings.filter((binding) => !isRegularShortcut(binding)).map(bindingText);
  const shortcuts = bindings.filter(isRegularShortcut).map(bindingText);
  return { sequences: sequences.length ? sequences : [''], shortcuts: shortcuts.length ? shortcuts : [''] };
}

function KeybindingRow({
  command,
  settings,
  commands,
  update,
}: {
  command: Command;
  settings: Settings;
  commands: Command[];
  update: (patch: Partial<Settings>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(() => bindingDraft(bindingsFor(command, settings)));
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const bindings: Binding[] = [];
    for (const field of ['shortcuts', 'sequences'] as const) {
      for (const text of draft[field]) {
        if (!text.trim()) continue;
        const binding = parseBindingText(text);
        if (!binding || isRegularShortcut(binding) !== (field === 'shortcuts')) {
          setMessage(
            field === 'shortcuts'
              ? '일반 단축키는 Mod+Enter, Ctrl+h 또는 F2처럼 입력하세요.'
              : '키 조합은 gd 또는 <leader>f처럼 입력하세요. Mod+Enter는 일반 단축키에 입력하세요.',
          );
          return;
        }
        bindings.push(binding);
      }
    }
    const error = bindingConflict(commands, settings, command.id, bindings);
    if (error) {
      setMessage(error);
      return;
    }
    setSaving(true);
    try {
      const saved = await update({ keybindings: { ...settings.keybindings, [command.id]: bindings } });
      if (saved) setDraft(bindingDraft(bindings));
      setMessage(saved ? '저장됨' : '저장하지 못했습니다. 다시 시도하세요.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="keybinding-row">
      <div className="keybinding-title">
        <strong>{command.title}</strong>
        <code>{command.id}</code>
      </div>
      {(
        [
          ['sequences', '키 조합', 'gd / <leader>f'],
          ['shortcuts', '일반 단축키', 'Mod+Enter'],
        ] as const
      ).map(([field, label, placeholder]) => (
        <div className="keybinding-list" key={field}>
          {draft[field].map((value, index) => (
            <div className="keybinding-entry" key={index}>
              <input
                type="text"
                aria-label={`${command.title} ${label} ${index + 1}`}
                placeholder={placeholder}
                value={value}
                onChange={(e) => {
                  setDraft((rows) => ({
                    ...rows,
                    [field]: rows[field].map((text, i) => (i === index ? e.target.value : text)),
                  }));
                  setMessage('');
                }}
              />
              {index === 0 ? (
                <button
                  className="icon-button"
                  aria-label={`${command.title} ${label} 추가`}
                  title={`${label} 추가`}
                  onClick={() => {
                    setDraft((rows) => ({ ...rows, [field]: [...rows[field], ''] }));
                    setMessage('');
                  }}
                >
                  <Plus size={13} />
                </button>
              ) : (
                <button
                  className="icon-button"
                  aria-label={`${command.title} ${label} ${index + 1} 삭제`}
                  title="조합 삭제"
                  onClick={() => {
                    setDraft((rows) => ({ ...rows, [field]: rows[field].filter((_, i) => i !== index) }));
                    setMessage('');
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
      <button
        className="icon-button"
        aria-label={`${command.title} 단축키 저장`}
        title="단축키 저장"
        disabled={saving}
        onClick={() => void save()}
      >
        <Check size={16} />
      </button>
      {message && (
        <small role="status" className={message === '저장됨' ? 'binding-saved' : 'binding-error'}>
          {message}
        </small>
      )}
    </div>
  );
}

export const SettingsView = memo(
  function SettingsView({
    group,
    workspace,
    commands,
    update,
    refresh,
    onError,
    pluginErrors,
    beforeDisablePlugin,
    invokePluginSettings,
    pluginViewRevision,
    active,
    updates,
  }: {
    updates?: AppUpdates;
    pluginViewRevision?: number;
    invokePluginSettings?: import('../lib/pluginTypes').PluginSettingsInvoke;
    beforeDisablePlugin?: (id: string) => Promise<void>;
    pluginErrors?: Record<string, string>;
    active: boolean;
    group: SettingsGroup;
    workspace: Workspace;
    commands: Command[];
    update: (patch: Partial<Settings>) => Promise<boolean>;
    refresh: () => Promise<void>;
    onError: (error: unknown) => void;
  }) {
    const [search, setSearch] = useState('');
    const page = useRef<HTMLElement>(null);
    useLayoutEffect(() => {
      if (page.current) page.current.scrollTop = 0;
    }, [group]);
    const settings = workspace.settings;
    const currentGroup = settingsGroups.find((item) => item.id === group)!;
    return (
      <section className="page-view settings-view" ref={page}>
        <div className="eyebrow">PREFERENCES</div>
        <h1>{currentGroup.title}</h1>
        <p className="page-description">{currentGroup.description}</p>
        <div className="settings-group" hidden={group !== 'updates'}>
          {updates && <AppUpdatesPanel updates={updates} />}
        </div>
        <div className="settings-group" hidden={group !== 'extensions'}>
          <ExtensionsView
            key={`${workspace.path}:${workspace.vault.id}`}
            kind="plugin"
            pluginErrors={pluginErrors}
            beforeDisable={beforeDisablePlugin}
            invokeSettings={invokePluginSettings}
            pluginViewRevision={pluginViewRevision}
            active={active && group === 'extensions'}
            workspace={workspace}
            refresh={refresh}
            onError={onError}
          />
        </div>
        <div className="settings-group" hidden={group !== 'editor'}>
          <section className="settings-section">
            <FontFamilySetting
              key={workspace.vault.id}
              label="편집기"
              value={settings.editorFontFamily ?? ''}
              onChange={(editorFontFamily) => update({ editorFontFamily })}
            />
            <div className="setting-row">
              <span>
                <strong>노트 보기 모드</strong>
                <small>Live Preview에서는 편집하는 부분만 Markdown 문법을 표시합니다.</small>
              </span>
              <Select
                aria-label="기본 노트 보기 모드"
                value={settings.editorMode}
                onValueChange={(value) => void update({ editorMode: value as Settings['editorMode'] })}
              >
                <option value="live">Live Preview</option>
                <option value="source">Markdown 원문</option>
                <option value="read">읽기</option>
              </Select>
            </div>
            <div className="setting-row">
              <span>
                <strong>라인 번호</strong>
                <small>Live Preview와 원문에 표시합니다. 상대 번호는 현재 줄만 실제 번호로 표시합니다.</small>
              </span>
              <Select
                aria-label="라인 번호"
                value={settings.lineNumbers}
                onValueChange={(value) => void update({ lineNumbers: value as Settings['lineNumbers'] })}
              >
                <option value="none">없음</option>
                <option value="absolute">일반 번호</option>
                <option value="relative">상대 번호</option>
              </Select>
            </div>
            <label className="setting-row">
              <span>
                <strong>슬래시 메뉴</strong>
                <small>입력 모드에서 빈 줄의 /로 삽입 메뉴를 엽니다. Vim의 / 검색과 독립적입니다.</small>
              </span>
              <input
                className="switch"
                type="checkbox"
                checked={settings.slash}
                onChange={(e) => void update({ slash: e.target.checked })}
              />
            </label>
            <label className="setting-row">
              <span>
                <strong>미생성 노트 표시</strong>
                <small>
                  그래프·연결 목록·자동완성에 아직 만들지 않은 링크 대상을 표시합니다. 노트는 링크를 열 때
                  생성됩니다.
                </small>
              </span>
              <input
                className="switch"
                type="checkbox"
                checked={settings.showUnresolvedLinks}
                onChange={(e) => void update({ showUnresolvedLinks: e.target.checked })}
              />
            </label>
          </section>
          <TaskMarkerHelp />
        </div>
        <div className="settings-group" hidden={group !== 'database'}>
          <section className="settings-section">
            <FontFamilySetting
              key={workspace.vault.id}
              label="데이터베이스"
              value={settings.databaseFontFamily ?? ''}
              onChange={(databaseFontFamily) => update({ databaseFontFamily })}
            />
            <div className="setting-row">
              <span>
                <strong>글자 크기</strong>
                <small>표·보드·타임라인에 적용합니다. 현재 vault에 저장됩니다.</small>
              </span>
              <Select
                aria-label="데이터베이스 글자 크기"
                value={String(settings.databaseFontSize ?? 14)}
                onValueChange={(value) => void update({ databaseFontSize: Number(value) })}
              >
                {Array.from({ length: 9 }, (_, index) => index + 12).map((size) => (
                  <option key={size} value={String(size)}>
                    {size} px{size === 14 ? ' · 기본' : ''}
                  </option>
                ))}
              </Select>
            </div>
          </section>
        </div>
        <div className="settings-group" hidden={group !== 'cursor'}>
          <section className="settings-section">
            <CursorSettings settings={settings} update={update} />
          </section>
        </div>
        <div className="settings-group" hidden={group !== 'theme'}>
          <ThemeSettings
            key={workspace.vault.id}
            workspace={workspace}
            update={update}
            refresh={refresh}
            onError={onError}
          />
        </div>
        <div className="settings-group" hidden={group !== 'keyboard'}>
          <section className="settings-section">
            <label className="setting-row">
              <span>
                <strong>Vim 모드</strong>
                <small>
                  기본값은 꺼짐입니다. 켜면 normal · insert · visual 모드와 :w · :q · :wq를 사용합니다.
                </small>
              </span>
              <input
                className="switch"
                type="checkbox"
                checked={settings.vim}
                onChange={(e) => void update({ vim: e.target.checked })}
              />
            </label>
            <div className="setting-row">
              <span>
                <strong>Leader 키</strong>
                <small>
                  키 기록을 누르고 원하는 키나 조합을 입력하세요. 노트 입력 중에는 시작하지 않습니다.
                </small>
              </span>
              <LeaderKeyRecorder settings={settings} commands={commands} update={update} />
            </div>
          </section>
          <section className="settings-section">
            <div className="section-heading">
              <h2>
                <Keyboard size={18} />
                단축키
              </h2>
              <button className="text-button" onClick={() => void update({ keybindings: {} })}>
                <RotateCcw size={14} />
                기본값 복원
              </button>
            </div>
            <p className="muted">
              키 조합은 <code>gd</code>처럼 입력하고, Leader 키로 시작하려면 <code>{'<leader>f'}</code> 또는{' '}
              <code>{'<leader>rn'}</code>처럼 적으세요. 일반 단축키는 오른쪽에 입력합니다. +로 조합을 추가할
              수 있고, 입력을 비우고 저장하면 해제됩니다.
            </p>
            <p className="muted">
              Leader 없는 연속 키는 Vim Normal의 노트 본문에서 동작합니다. 대소문자를 구분하며, Mod는
              macOS에서 Cmd, 다른 운영체제에서 Ctrl입니다. Ctrl+H는 Ctrl+Shift+h와 같습니다.
            </p>
            <input
              className="settings-search"
              aria-label="단축키 검색"
              placeholder="기능 또는 명령 ID 검색…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="keybinding-labels">
              <span>기능</span>
              <span>키 조합</span>
              <span>일반 단축키</span>
            </div>
            {commands
              .filter((c) => `${c.title} ${c.id}`.toLowerCase().includes(search.toLowerCase()))
              .map((command) => (
                <KeybindingRow
                  key={`${command.id}:${JSON.stringify(settings.keybindings[command.id])}`}
                  command={command}
                  commands={commands}
                  settings={settings}
                  update={update}
                />
              ))}
          </section>
        </div>
      </section>
    );
  },
  (previous, next) => !previous.active && !next.active && previous.workspace.path === next.workspace.path,
);
