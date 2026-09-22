import { useEffect, useRef, useState } from 'react';
import { KeyRound, Loader2, Check } from 'lucide-react';
import { call } from '../lib/api';
import type { ChatOwner, ChatSettings } from '../lib/noteChat';

export function NoteChatSettings({ owner, saved }: { owner: ChatOwner; saved?: () => void }) {
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const alive = useRef(true);
  const locked = useRef(false);
  useEffect(() => {
    let cancelled = false;
    alive.current = true;
    void call<ChatSettings>(owner.path, 'chat.settings', {
      pluginId: owner.pluginId,
      pluginDigest: owner.pluginDigest,
    }).then(
      (value) => {
        if (cancelled) return;
        setSettings(value);
        setBaseUrl(value.baseUrl);
        setModel(value.model);
      },
      (e) => {
        if (!cancelled) setError(e.message);
      },
    );
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, []);
  const submit = async () => {
    if (!settings || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setSuccess(false);
    try {
      const value = await call<ChatSettings>(owner.path, 'chat.configure', {
        pluginId: owner.pluginId,
        pluginDigest: owner.pluginDigest,
        baseUrl,
        model,
        expectedRevision: settings.revision,
        ...(key || removeKey ? { apiKey: removeKey ? '' : key } : {}),
      });
      if (!alive.current) return;
      setSettings(value);
      setKey('');
      setRemoveKey(false);
      setSuccess(true);
      saved?.();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <form
      className="note-chat-settings"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="note-chat-settings-heading">
        <KeyRound size={17} />
        <strong>Provider 연결</strong>
      </div>
      <p className="note-chat-hint">
        OpenAI 호환 API에 연결합니다. 요청할 때 현재 노트와 최근 대화가 전송됩니다.
      </p>
      <label>
        <span>API Base URL</span>
        <input
          aria-label="API Base URL"
          value={baseUrl}
          placeholder="https://api.openai.com/v1"
          autoComplete="off"
          onChange={(e) => {
            setBaseUrl(e.target.value);
            setSuccess(false);
          }}
          disabled={!settings || busy}
        />
      </label>
      <label>
        <span>모델</span>
        <input
          aria-label="AI 모델"
          value={model}
          placeholder="Provider의 모델 ID"
          autoComplete="off"
          onChange={(e) => {
            setModel(e.target.value);
            setSuccess(false);
          }}
          disabled={!settings || busy}
        />
      </label>
      <label>
        <span>API 키 {settings?.hasApiKey && !removeKey && <small>저장됨</small>}</span>
        <input
          aria-label="API 키"
          type="password"
          value={key}
          autoComplete="new-password"
          spellCheck={false}
          placeholder={
            settings?.hasApiKey && !removeKey ? '비워두면 저장된 키 유지' : '인증 없는 로컬 서버는 생략 가능'
          }
          onChange={(e) => {
            setKey(e.target.value);
            setRemoveKey(false);
            setSuccess(false);
          }}
          disabled={!settings || busy}
        />
      </label>
      <p className="note-chat-hint">
        키는 이 기기에만 저장되며 vault 내보내기·Git에 포함되지 않습니다. 다른 API 주소로 바꾸면 키를 다시
        입력하세요.
      </p>
      {settings?.hasApiKey && (
        <button
          type="button"
          className="note-chat-text-button"
          disabled={busy}
          onClick={() => {
            setRemoveKey(true);
            setKey('');
            setSuccess(false);
          }}
        >
          {removeKey ? '저장하면 키가 삭제됩니다' : '저장된 키 삭제'}
        </button>
      )}
      {error && (
        <p className="note-chat-error" role="alert">
          {error}
        </p>
      )}
      <div className="note-chat-settings-footer">
        <span role="status">
          {success && (
            <>
              <Check size={13} /> 연결 설정 저장됨
            </>
          )}
        </span>
        <button className="primary-button" disabled={!settings || busy || !baseUrl.trim() || !model.trim()}>
          {busy ? <Loader2 size={14} className="note-chat-spinner" /> : '저장'}
        </button>
      </div>
    </form>
  );
}
