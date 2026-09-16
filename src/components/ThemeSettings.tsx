import { useEffect, useRef, useState } from 'react';
import { Check, Download, Loader2, Trash2, Upload } from 'lucide-react';
import { call } from '../lib/api';
import { themeCatalog } from '../lib/themeCatalog';
import { themeChoices, themePalette } from '../lib/theme';
import type { Settings, Workspace } from '../lib/types';

export function ThemeSettings({
  workspace,
  update,
  refresh,
  onError,
}: {
  workspace: Workspace;
  update: (patch: Partial<Settings>) => Promise<boolean>;
  refresh: () => Promise<void>;
  onError: (error: unknown) => void;
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
  const [notice, setNotice] = useState('');
  const run = async (id: string, action: () => Promise<string>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(id);
    setNotice('');
    try {
      const message = await action();
      if (mounted.current) await refresh();
      if (mounted.current) setNotice(message);
    } catch (error) {
      if (mounted.current) onError(error);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(null);
    }
  };
  return (
    <section className="settings-section theme-settings">
      <div className="section-heading">
        <h2>사용할 테마</h2>
        <button className="secondary-button" disabled={busy !== null} onClick={() => input.current?.click()}>
          {busy === 'file:' ? <Loader2 size={15} /> : <Upload size={15} />} 파일로 추가
        </button>
      </div>
      <p className="theme-hint">
        기본 테마는 바로 선택할 수 있습니다. 추가한 테마는 휴지통 버튼으로 삭제하세요.
      </p>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="visually-hidden"
        aria-label="테마 패키지 파일"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          void run('file:', async () => {
            try {
              if (file.size > 256_000) throw new Error('테마 파일은 256 KB 이하여야 합니다.');
              const manifest = JSON.parse(await file.text());
              if (manifest?.kind !== 'theme')
                throw new Error('테마 파일을 선택하세요. 플러그인은 설정 → 확장에서 설치할 수 있습니다.');
              await call(workspace.path, 'extension.install', { manifest });
              return `${manifest.name} 추가 완료`;
            } finally {
              if (input.current) input.current.value = '';
            }
          });
        }}
      />
      <div className="theme-choices">
        {themeChoices(workspace.extensions).map((theme) => {
          const palette = themePalette(theme.id, workspace.extensions).tokens;
          const selected = workspace.settings.theme === theme.id;
          return (
            <div className="theme-option" key={theme.id}>
              <button
                className={`theme-choice${selected ? ' active' : ''}`}
                aria-label={`${theme.name} 사용`}
                aria-pressed={selected}
                disabled={busy !== null}
                onClick={() =>
                  void run(theme.id, async () =>
                    (await update({ theme: theme.id })) ? `${theme.name} 적용됨` : '',
                  )
                }
              >
                <div>
                  {[palette.paper, palette.sidebar, palette.accent].map((color, i) => (
                    <i key={i} style={{ background: color }} />
                  ))}
                </div>
                <span>
                  {theme.name}
                  {selected && <Check size={14} />}
                </span>
                <small>{theme.installed ? '추가한 테마' : '기본 제공'}</small>
              </button>
              {theme.installed && (
                <button
                  className="theme-remove"
                  aria-label={`${theme.name} 삭제`}
                  title={`${theme.name} 삭제`}
                  disabled={busy !== null}
                  onClick={() =>
                    void run(theme.id, async () => {
                      await call(workspace.path, 'extension.remove', { id: theme.id });
                      return `${theme.name} 삭제 완료`;
                    })
                  }
                >
                  {busy === theme.id ? <Loader2 size={14} /> : <Trash2 size={14} />}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="theme-catalog">
        <h2>테마 둘러보기</h2>
        <div className="theme-catalog-grid">
          {themeCatalog.map((theme) => {
            const palette = themePalette(theme.id, [theme]).tokens;
            const installed = workspace.extensions.some((item) => item.id === theme.id);
            return (
              <article className="theme-catalog-card" key={theme.id} aria-label={theme.name}>
                <div className="theme-swatch" aria-hidden="true">
                  {[palette.paper, palette.sidebar, palette.accent, palette['syntax-string']].map(
                    (color, i) => (
                      <i key={i} style={{ background: color }} />
                    ),
                  )}
                </div>
                <h3>{theme.name}</h3>
                <p>{theme.description}</p>
                <button
                  className="secondary-button"
                  aria-label={`${theme.name} 설치`}
                  disabled={installed || busy !== null}
                  onClick={() =>
                    void run(theme.id, async () => {
                      await call(workspace.path, 'extension.install', { manifest: theme });
                      return `${theme.name} 설치 완료`;
                    })
                  }
                >
                  {installed ? (
                    <Check size={14} />
                  ) : busy === theme.id ? (
                    <Loader2 size={14} />
                  ) : (
                    <Download size={14} />
                  )}
                  {installed ? '설치됨' : busy === theme.id ? '설치 중…' : '설치'}
                </button>
              </article>
            );
          })}
        </div>
      </div>
      <p className="theme-notice" role="status">
        {notice}
      </p>
    </section>
  );
}
