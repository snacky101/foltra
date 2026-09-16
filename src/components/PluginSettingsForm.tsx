import { useEffect, useRef, useState } from 'react';
import { call } from '../lib/api';
import type { Extension } from '../lib/types';
import { Select } from './Select';

interface SavedSettings {
  values: Record<string, string | number | boolean>;
  revision: string;
}
export function PluginSettingsForm({
  extension,
  vault,
  refresh,
}: {
  extension: Extension;
  vault: string;
  refresh: () => Promise<void>;
}) {
  const [saved, setSaved] = useState<SavedSettings | null>(null);
  const [values, setValues] = useState<SavedSettings['values']>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void call<SavedSettings>(vault, 'extension.settings.get', { id: extension.id })
      .then((next) => {
        if (cancelled) return;
        setSaved(next);
        setValues(next.values);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [vault, extension.id]);
  const run = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <div className="plugin-settings-form">
      {error && (
        <p className="plugin-error" role="alert">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!saved) return;
          void run(async () => {
            const next = await call<SavedSettings>(vault, 'extension.settings.update', {
              id: extension.id,
              values,
              expectedRevision: saved.revision,
            });
            if (!mounted.current) return;
            setSaved(next);
            setValues(next.values);
            setMessage('설정을 저장했습니다.');
            await refresh();
          });
        }}
      >
        {extension.runtime!.settings!.map((setting) =>
          setting.type === 'select' ? (
            <div className="plugin-field" key={setting.id}>
              <span>{setting.label}</span>
              <Select
                aria-label={setting.label}
                disabled={!saved || busy}
                value={String(values[setting.id] ?? setting.default)}
                onValueChange={(value) => setValues((v) => ({ ...v, [setting.id]: value }))}
              >
                {setting.options?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <label
              className={setting.type === 'checkbox' ? 'plugin-checkbox' : 'plugin-field'}
              key={setting.id}
            >
              <span>{setting.label}</span>
              <input
                aria-label={setting.label}
                type={
                  setting.type === 'checkbox' ? 'checkbox' : setting.type === 'number' ? 'number' : 'text'
                }
                disabled={!saved || busy}
                {...(setting.type === 'checkbox'
                  ? { checked: Boolean(values[setting.id] ?? setting.default) }
                  : { value: String(values[setting.id] ?? setting.default) })}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    [setting.id]:
                      setting.type === 'checkbox'
                        ? e.target.checked
                        : setting.type === 'number'
                          ? Number(e.target.value)
                          : e.target.value,
                  }))
                }
              />
            </label>
          ),
        )}
        <div className="plugin-row">
          <button className="secondary-button" type="submit" disabled={!saved || busy}>
            설정 저장
          </button>
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const next = await call<SavedSettings>(vault, 'extension.settings.get', {
                  id: extension.id,
                });
                if (!mounted.current) return;
                setSaved(next);
                setValues(next.values);
              })
            }
          >
            다시 불러오기
          </button>
        </div>
        <span role="status">{message}</span>
      </form>
    </div>
  );
}
