import { PluginControls, PluginToggle, PluginDetails } from './PluginControls';
import { PluginPolicyControls } from './PluginPolicyControls';
import { PluginSettingsForm } from './PluginSettingsForm';
import { PluginSettingsView } from './PluginSettingsView';
import type { PluginSettingsInvoke } from '../lib/pluginTypes';
import { pluginSettingsView } from '../lib/pluginSettings';
import { useEffect, useRef, useState } from 'react';
import {
  Puzzle,
  Palette,
  Upload,
  Trash2,
  ArrowUpRight,
  Search,
  Download,
  Check,
  Loader2,
  Settings2,
  ArrowLeft,
} from 'lucide-react';
import { call } from '../lib/api';
import { extensionCatalog } from '../lib/extensionCatalog';
import type { Extension, Workspace } from '../lib/types';

function isNewerVersion(candidate: string, current: string) {
  if (![candidate, current].every((version) => /^\d+\.\d+\.\d+$/.test(version))) return false;
  const next = candidate.split('.').map(Number),
    previous = current.split('.').map(Number);
  if (![...next, ...previous].every(Number.isSafeInteger)) return false;
  return next.some(
    (value, index) =>
      value > previous[index] && next.slice(0, index).every((part, at) => part === previous[at]),
  );
}

export function ExtensionsView({
  kind,
  workspace,
  refresh,
  onError,
  pluginErrors = {},
  beforeDisable,
  invokeSettings,
  pluginViewRevision,
  active = true,
}: {
  active?: boolean;
  pluginViewRevision?: number;
  invokeSettings?: PluginSettingsInvoke;
  beforeDisable?: (id: string) => Promise<void>;
  pluginErrors?: Record<string, string>;
  kind: Extension['kind'];
  workspace: Workspace;
  refresh: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [installedOnly, setInstalledOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!settingsId || !active) return;
    heading.current?.focus({ preventScroll: true });
    heading.current?.closest('.settings-view')?.scrollTo?.({ top: 0 });
  }, [settingsId, active]);
  const label = kind === 'theme' ? '테마' : '확장';
  const installedExtensions = workspace.extensions.filter((extension) => extension.kind === kind);
  const run = async (id: string, action: () => Promise<string>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(id);
    setNotice('');
    try {
      const message = await action();
      if (mounted.current) await refresh();
      if (mounted.current) setNotice(message);
    } catch (e) {
      if (mounted.current) onError(e);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(null);
    }
  };
  const install = (extension: Extension) =>
    run(extension.id, async () => {
      await call(workspace.path, 'extension.install', { manifest: extension });
      return `${extension.name} 설치 완료`;
    });
  const update = (extension: Extension, digest: string) =>
    run(`update:${extension.id}`, async () => {
      await call(workspace.path, 'extension.update', { manifest: extension, expectedDigest: digest });
      if (mounted.current) await beforeDisable?.(extension.id);
      return '업데이트 완료 · 활성화 상태가 유지됩니다';
    });
  const installFile = (file: File) =>
    run('file:', async () => {
      try {
        if (file.size > 256_000) throw new Error('확장 파일은 256 KB 이하여야 합니다.');
        const manifest = JSON.parse(await file.text());
        if (manifest?.kind === (kind === 'theme' ? 'plugin' : 'theme')) {
          throw new Error(
            kind === 'theme'
              ? '플러그인 파일은 설정 → 확장에서 설치하세요.'
              : '테마 파일은 설정 → 테마에서 설치하세요.',
          );
        }
        const installed = await call<Extension>(workspace.path, 'extension.install', { manifest });
        if (mounted.current) {
          setInstalledOnly(true);
          setQuery('');
        }
        return `${installed.name} 설치 완료`;
      } finally {
        if (input.current) input.current.value = '';
      }
    });
  const remove = (extension: Extension) =>
    run(extension.id, async () => {
      if (extension.runtime) await beforeDisable?.(extension.id);
      await call(workspace.path, 'extension.remove', { id: extension.id });
      return `${extension.name} 제거 완료`;
    });
  const search = query.trim().toLocaleLowerCase();
  const installedById = new Map(workspace.extensions.map((extension) => [extension.id, extension]));
  const available = new Map(
    [...extensionCatalog, ...workspace.extensions].map((extension) => [extension.id, extension]),
  );
  const extensions = [...available.values()].filter(
    (extension) =>
      extension.kind === kind &&
      (!installedOnly || installedById.has(extension.id)) &&
      [
        extension.name,
        extension.id,
        extension.description,
        ...(extension.commands?.map((c) => c.title) ?? []),
      ]
        .join(' ')
        .toLocaleLowerCase()
        .includes(search),
  );
  const selected = installedExtensions.find((e) => e.id === settingsId && e.runtime);
  if (selected) {
    const status = workspace.pluginStates?.find((s) => s.id === selected.id);
    const runtime = selected.runtime!;
    const settingsView = pluginSettingsView(selected);
    const revision = JSON.stringify([
      workspace.notes,
      workspace.databases,
      workspace.records,
      status,
      pluginViewRevision,
    ]);
    return (
      <section className="settings-section extension-settings-page" aria-label={`${selected.name} 설정`}>
        <button
          className="text-button extension-settings-back"
          onClick={() => {
            setSettingsId(null);
            requestAnimationFrame(() =>
              document.getElementById(`extension-settings-${selected.id}`)?.focus(),
            );
          }}
        >
          <ArrowLeft size={15} />
          확장 목록으로
        </button>
        <header className="extension-settings-header">
          <div className="extension-icon">
            <Puzzle size={24} />
          </div>
          <div>
            <h2 ref={heading} tabIndex={-1}>
              {selected.name}
            </h2>
            <p>{selected.description}</p>
          </div>
          <span className="version">v{selected.version}</span>
        </header>
        <PluginControls
          pluginsEnabled={workspace.pluginPolicy?.enabled ?? false}
          extension={selected}
          status={status}
          vault={workspace.path}
          refresh={refresh}
          onError={onError}
          error={pluginErrors[selected.id]}
          beforeDisable={beforeDisable}
        />
        {active && !!runtime.settings?.length && (
          <PluginSettingsForm
            key={`${workspace.path}:${selected.id}:${status?.digest}`}
            extension={selected}
            vault={workspace.path}
            refresh={refresh}
          />
        )}
        {settingsView &&
          (status?.enabled && invokeSettings ? (
            active && (
              <PluginSettingsView
                key={`${workspace.path}:${selected.id}:${status.digest}`}
                pluginId={selected.id}
                viewId={settingsView}
                revision={revision}
                invoke={invokeSettings}
                error={pluginErrors[selected.id]}
              />
            )
          ) : (
            <p className="extension-settings-hint">확장을 활성화하면 설정을 불러옵니다.</p>
          ))}
      </section>
    );
  }
  return (
    <section className="settings-section extension-manager">
      {kind === 'theme' && <h2>테마 설치</h2>}
      {kind === 'plugin' && (
        <PluginPolicyControls
          key={workspace.path}
          policy={workspace.pluginPolicy}
          vault={workspace.path}
          refresh={refresh}
          onError={onError}
          beforeDisable={async () => {
            for (const status of workspace.pluginStates ?? []) {
              if (status.enabled) await beforeDisable?.(status.id);
            }
          }}
        />
      )}
      <div className="extension-toolbar">
        <label className="extension-installed-filter">
          <input
            type="checkbox"
            role="switch"
            className="switch"
            aria-label="설치된 것만"
            checked={installedOnly}
            onChange={(e) => setInstalledOnly(e.target.checked)}
          />
          설치된 것만
          <span className="extension-installed-count">{installedExtensions.length}</span>
        </label>
        <button className="secondary-button" disabled={busy !== null} onClick={() => input.current?.click()}>
          {busy === 'file:' ? <Loader2 size={15} /> : <Upload size={15} />}
          파일로 설치
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="visually-hidden"
        aria-label={`${label} 패키지 파일`}
        onChange={(e) => {
          if (e.target.files?.[0]) void installFile(e.target.files[0]);
        }}
      />
      <p className="extension-intro">
        {installedOnly
          ? `현재 vault에 설치된 ${label}입니다. 파일로 추가한 ${label}도 함께 관리하세요.`
          : `Foltra가 제공하는 ${label}을 인터넷 연결 없이 설치하세요. 파일로 추가한 ${label}도 함께 표시됩니다.`}
      </p>
      <label className="extension-search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          aria-label={`${label} 검색`}
          placeholder={kind === 'theme' ? '테마 이름, 설명 검색…' : '이름, 설명, 명령 검색…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="extension-results-heading">
        <span>
          {extensions.length}개 {installedOnly ? '설치됨' : label}
        </span>
        <span role="status">{notice}</span>
      </div>
      <div className="extension-grid">
        {extensions.map((extension) => {
          const installed = installedById.has(extension.id);
          const working = busy === extension.id;
          const status = workspace.pluginStates?.find((s) => s.id === extension.id);
          const upgrade =
            installed && extension.kind === 'plugin' && extension.runtime
              ? extensionCatalog.find(
                  (candidate) =>
                    candidate.id === extension.id &&
                    candidate.kind === extension.kind &&
                    candidate.runtime &&
                    isNewerVersion(candidate.version, extension.version),
                )
              : undefined;
          const updating = busy === `update:${extension.id}`;
          return (
            <article className="extension-card" key={extension.id} aria-label={extension.name}>
              <div className="extension-card-top">
                {extension.kind === 'theme' ? (
                  <div className="extension-swatches" aria-label="테마 색상 미리보기">
                    {['paper', 'sidebar', 'accent'].map((token) => {
                      const color = extension.tokens?.[token] ?? '';
                      return (
                        <i
                          key={token}
                          style={{ background: /^#[0-9a-f]{6}$/i.test(color) ? color : 'var(--line)' }}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <span className="extension-icon">
                    <Puzzle size={24} />
                  </span>
                )}
                {installed && extension.runtime ? (
                  <PluginToggle
                    pluginsEnabled={workspace.pluginPolicy?.enabled ?? false}
                    beforeDisable={beforeDisable}
                    extension={extension}
                    status={status}
                    vault={workspace.path}
                    refresh={refresh}
                    onError={onError}
                  />
                ) : (
                  <span className="version">v{extension.version}</span>
                )}
              </div>
              <h2>
                {extension.name}
                {installed && extension.runtime && <span className="version">v{extension.version}</span>}
              </h2>
              <p>
                {extension.description ||
                  (extension.kind === 'theme' ? '나만의 색상 테마' : '작업을 연결하는 확장')}
              </p>
              {extension.kind === 'plugin' && (
                <ul className="extension-commands" aria-label="추가되는 명령">
                  {extension.commands?.map((command) => (
                    <li key={command.id}>{command.title}</li>
                  ))}
                </ul>
              )}
              {installed && extension.runtime && (
                <PluginDetails
                  pluginsEnabled={workspace.pluginPolicy?.enabled ?? false}
                  extension={extension}
                  error={pluginErrors[extension.id]}
                />
              )}
              <div className="extension-bottom">
                <span className={installed ? 'extension-installed' : undefined}>
                  {installed ? (
                    <Check size={13} />
                  ) : extension.kind === 'theme' ? (
                    <Palette size={13} />
                  ) : (
                    <Puzzle size={13} />
                  )}
                  {installed ? '설치됨' : extension.kind === 'theme' ? '테마' : '플러그인'}
                </span>
                <div className="extension-actions">
                  {installed && (extension.runtime?.settings?.length || pluginSettingsView(extension)) ? (
                    <button
                      className="text-button"
                      id={`extension-settings-${extension.id}`}
                      aria-label={`${extension.name} 설정`}
                      disabled={busy !== null}
                      onClick={() => setSettingsId(extension.id)}
                    >
                      <Settings2 size={14} />
                      설정
                    </button>
                  ) : null}
                  {upgrade && (
                    <button
                      className="text-button"
                      disabled={busy !== null || !status?.digest}
                      aria-label={`${extension.name} 업데이트`}
                      onClick={() => status && void update(upgrade, status.digest)}
                    >
                      {updating ? <Loader2 size={13} /> : <Download size={13} />}
                      {updating ? '업데이트 중…' : `v${upgrade.version} 업데이트`}
                    </button>
                  )}
                  {installed ? (
                    <button
                      className="text-button"
                      disabled={busy !== null}
                      onClick={() => void remove(extension)}
                      aria-label={`${extension.name} 제거`}
                    >
                      {working ? <Loader2 size={13} /> : <Trash2 size={13} />}
                      {working ? '제거 중…' : '제거'}
                    </button>
                  ) : (
                    <button
                      className="secondary-button"
                      disabled={busy !== null}
                      onClick={() => void install(extension)}
                      aria-label={`${extension.name} 설치`}
                    >
                      {working ? <Loader2 size={13} /> : <Download size={13} />}
                      {working ? '설치 중…' : '설치'}
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {!extensions.length && (
        <div className="extension-empty">
          {kind === 'theme' ? <Palette size={28} /> : <Puzzle size={28} />}
          <h2>
            {installedOnly && !installedExtensions.length
              ? kind === 'theme'
                ? '아직 설치된 테마가 없어요'
                : '아직 설치된 확장이 없어요'
              : '검색 결과가 없어요'}
          </h2>
          <p>
            {installedOnly && !installedExtensions.length
              ? '설치된 것만 보기를 끄고 골라 설치하거나 파일로 추가해 보세요.'
              : '다른 검색어를 입력해 보세요.'}
          </p>
        </div>
      )}
      <div className="extension-tip">
        <ArrowUpRight size={16} />
        <p>
          {kind === 'theme'
            ? '설치한 테마는 위의 사용할 테마 목록에서 선택하세요.'
            : '설치한 명령은 명령 팔레트와 설정 → Vim 및 단축키에서 사용할 수 있습니다.'}
        </p>
      </div>
    </section>
  );
}
