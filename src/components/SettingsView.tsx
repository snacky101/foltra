import { Select } from './Select';
import { LeaderKeyRecorder } from './LeaderKeyRecorder';
import { useState } from 'react';
import { Keyboard, Terminal, Palette as PaletteIcon, Check, RotateCcw } from 'lucide-react';
import { bindingsFor, bindingConflict, type Command } from '../lib/commands';
import type { Binding, Settings, Workspace } from '../lib/types';

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
  const current = bindingsFor(command, settings);
  const [draft, setDraft] = useState<Binding>(current);
  const [message, setMessage] = useState('');
  const save = async () => {
    const error = bindingConflict(commands, settings, command.id, draft);
    if (error) {
      setMessage(error);
      return;
    }
    try {
      const saved = await update({ keybindings: { ...settings.keybindings, [command.id]: draft } });
      setMessage(saved ? '저장됨' : '저장하지 못했습니다. 다시 시도하세요.');
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  return (
    <div className="keybinding-row">
      <div>
        <strong>{command.title}</strong>
        <code>{command.id}</code>
      </div>
      <input
        aria-label={`${command.title} leader`}
        placeholder="예: v g"
        value={draft.leader ?? ''}
        onChange={(e) => {
          setDraft((d) => ({ ...d, leader: e.target.value }));
          setMessage('');
        }}
      />
      <input
        aria-label={`${command.title} shortcut`}
        placeholder="예: Mod+g"
        value={draft.shortcut ?? ''}
        onChange={(e) => {
          setDraft((d) => ({ ...d, shortcut: e.target.value }));
          setMessage('');
        }}
      />
      <button className="icon-button" aria-label={`${command.title} 단축키 저장`} onClick={() => void save()}>
        <Check size={16} />
      </button>
      {message && (
        <small className={message === '저장됨' ? 'binding-saved' : 'binding-error'}>{message}</small>
      )}
    </div>
  );
}

export function SettingsView({
  workspace,
  commands,
  update,
}: {
  workspace: Workspace;
  commands: Command[];
  update: (patch: Partial<Settings>) => Promise<boolean>;
}) {
  const [search, setSearch] = useState('');
  const settings = workspace.settings;
  return (
    <section className="page-view settings-view">
      <div className="eyebrow">MAKE IT YOURS</div>
      <h1>나의 작업 방식</h1>
      <p className="page-description">
        도구가 생각의 속도를 따라오도록. <small>Foltra 0.1 · Preview</small>
      </p>
      <section className="settings-section">
        <h2>
          <Terminal size={18} />
          편집
        </h2>
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
        <div className="setting-row">
          <span>
            <strong>Leader 키</strong>
            <small>키 기록을 누르고 원하는 키나 조합을 입력하세요. 노트 입력 중에는 시작하지 않습니다.</small>
          </span>
          <LeaderKeyRecorder settings={settings} commands={commands} update={update} />
        </div>
      </section>
      <section className="settings-section">
        <h2>
          <PaletteIcon size={18} />
          테마
        </h2>
        <div className="theme-choices">
          {[
            { id: 'paper', name: 'Paper & Pine', colors: ['#f8f7f3', '#213d35', '#bc8a55'] },
            { id: 'night', name: 'Midnight', colors: ['#202827', '#17211f', '#b3c7a3'] },
            ...workspace.extensions
              .filter((e) => e.kind === 'theme')
              .map((e) => ({
                id: e.id,
                name: e.name,
                colors: [
                  e.tokens?.paper ?? '#f8f7f3',
                  e.tokens?.sidebar ?? '#213d35',
                  e.tokens?.accent ?? '#bc8a55',
                ],
              })),
          ].map((theme) => (
            <button
              key={theme.id}
              className={`theme-choice ${settings.theme === theme.id ? 'active' : ''}`}
              onClick={() => void update({ theme: theme.id })}
            >
              <div>
                {theme.colors.map((color, i) => (
                  <i key={i} style={{ background: color }} />
                ))}
              </div>
              <span>
                {theme.name}
                {settings.theme === theme.id && <Check size={14} />}
              </span>
            </button>
          ))}
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
          한 기능에 leader 조합과 일반 단축키를 함께 지정할 수 있습니다. Mod는 macOS에서 Cmd, 다른
          운영체제에서 Ctrl입니다. Ctrl과 Meta는 플랫폼과 관계없이 각각 Control과 Command 키를 뜻합니다. 영역
          이동은 기본 Ctrl+h/j/k/l, 노트 이름 변경은 leader r n 또는 F2입니다. 대소문자를 구분하며 Ctrl+H는
          Ctrl+Shift+h와 같습니다. Leader 다음 키도 r과 R을 구분합니다.
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
          <span>Leader 다음 키</span>
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
    </section>
  );
}
