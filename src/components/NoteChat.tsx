import '../styles/noteChat.css';
import { useContext, useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, Settings2, Trash2, Loader2, Plus, FilePenLine } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { call } from '../lib/api';
import { NoteChatHost, type ChatOwner, type NoteConversation, type ChatMessage } from '../lib/noteChat';
import { openExternalLink } from '../lib/openExternalLink';
import { NoteChatSettings } from './NoteChatSettings';

// A request may finish after its note's panel has been unmounted and reopened.
const conversationChanges = new EventTarget();

export function PluginNoteChat({
  pluginId,
  settingsOnly = false,
  disabled = false,
}: {
  pluginId?: string;
  settingsOnly?: boolean;
  disabled?: boolean;
}) {
  const host = useContext(NoteChatHost);
  const extension = host?.workspace.extensions.find((e) => e.id === pluginId);
  const status = host?.workspace.pluginStates?.find((s) => s.id === pluginId && s.enabled);
  if (
    !host ||
    !status ||
    disabled ||
    !['ai.chat', 'ui', 'notes.read'].every((p) =>
      extension?.runtime?.permissions.some((value) => value === p),
    )
  )
    return <p className="note-chat-hint">노트 채팅 확장을 활성화하세요.</p>;
  const owner = { path: host.workspace.path, pluginId: status.id, pluginDigest: status.digest };
  const key = `${owner.path}:${owner.pluginId}:${owner.pluginDigest}`;
  return settingsOnly ? (
    <NoteChatSettings key={key} owner={owner} />
  ) : (
    <NoteChatPanel key={`${key}:${host.noteId}`} owner={owner} noteId={host.noteId} />
  );
}
function NoteChatPanel({ owner, noteId }: { owner: ChatOwner; noteId: string | null }) {
  const host = useContext(NoteChatHost)!;
  const [conversation, setConversation] = useState<NoteConversation | null>(null);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'chat' | 'rewrite'>('chat');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(false);
  const [clearing, setClearing] = useState(false);
  const locked = useRef(false);
  const alive = useRef(true);
  const end = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const refocus = useRef(false);
  const args = { pluginId: owner.pluginId, pluginDigest: owner.pluginDigest, noteId };
  const conversationKey = JSON.stringify([owner.path, owner.pluginId, owner.pluginDigest, noteId]);
  useEffect(() => {
    let cancelled = false;
    let request = 0;
    alive.current = true;
    const load = () => {
      if (!noteId) return;
      const current = ++request;
      void call<NoteConversation>(owner.path, 'chat.history', args).then(
        (value) => {
          if (!cancelled && current === request) setConversation(value);
        },
        (e) => {
          if (!cancelled && current === request) setError(e.message);
        },
      );
    };
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail === conversationKey) load();
    };
    load();
    conversationChanges.addEventListener('changed', changed);
    return () => {
      cancelled = true;
      alive.current = false;
      conversationChanges.removeEventListener('changed', changed);
    };
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
    if (!busy && refocus.current) {
      refocus.current = false;
      textarea.current?.focus();
    }
  }, [conversation?.revision, busy]);
  const run = async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const send = () =>
    run(async () => {
      if (!noteId || !conversation || !input.trim()) return;
      if (!(await host.save())) throw Error('노트를 먼저 저장해야 합니다. 저장 오류를 확인하세요.');
      if (!alive.current) return;
      const result = await call<NoteConversation>(owner.path, 'chat.send', {
        ...args,
        message: input,
        mode,
        expectedRevision: conversation.revision,
      });
      if (!alive.current)
        conversationChanges.dispatchEvent(new CustomEvent('changed', { detail: conversationKey }));
      if (alive.current) {
        setConversation(result);
        setInput('');
        refocus.current = true;
      }
    });
  const apply = (message: ChatMessage) =>
    run(async () => {
      if (!conversation || !(await host.save())) throw Error('노트를 먼저 저장해야 합니다.');
      if (!alive.current) return;
      const result = await call<NoteConversation>(owner.path, 'chat.apply', {
        ...args,
        messageId: message.id,
        expectedRevision: conversation.note.revision,
      });
      if (!alive.current) return;
      await host.refresh();
      if (alive.current) {
        setConversation(result);
        host.notify(
          message.mode === 'rewrite' ? '수정안을 노트에 적용했습니다.' : '답변을 노트 끝에 추가했습니다.',
        );
      }
    });
  const clear = () =>
    run(async () => {
      if (!conversation) return;
      const result = await call<NoteConversation>(owner.path, 'chat.clear', {
        ...args,
        expectedRevision: conversation.revision,
      });
      if (alive.current) {
        setConversation(result);
        setClearing(false);
      }
    });
  const current = host.workspace.notes.find((n) => n.id === noteId);
  return (
    <section className="note-chat" aria-label="현재 노트 채팅">
      <header className="note-chat-header">
        <div>
          <MessageSquare size={15} />
          <strong>노트 채팅</strong>
        </div>
        <div>
          <button
            className="icon-button"
            aria-label="채팅 Provider 설정"
            aria-expanded={settings}
            disabled={busy}
            onClick={() => setSettings(!settings)}
          >
            <Settings2 size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="이 노트의 대화 비우기"
            disabled={busy || !conversation?.messages.length}
            onClick={() => setClearing(!clearing)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </header>
      {settings ? (
        <NoteChatSettings owner={owner} saved={() => setSettings(false)} />
      ) : !noteId ? (
        <p className="note-chat-hint">노트를 열면 해당 노트와 대화를 시작할 수 있습니다.</p>
      ) : (
        <>
          <p className="note-chat-note" title={current?.title}>
            {current?.title ?? conversation?.note.title ?? '노트 불러오는 중…'}
          </p>
          {clearing && (
            <div className="note-chat-confirm">
              <span>이 노트의 대화를 비울까요?</span>
              <button disabled={busy} onClick={() => void clear()}>
                비우기
              </button>
              <button disabled={busy} onClick={() => setClearing(false)}>
                취소
              </button>
            </div>
          )}
          <div className="note-chat-messages" aria-label="대화 기록" tabIndex={0}>
            {!conversation?.messages.length && (
              <div className="note-chat-empty">
                <MessageSquare size={22} />
                <p>이 노트를 함께 다듬어 보세요.</p>
                <small>질문하거나, 원하는 변경을 적고 수정안을 받아보세요.</small>
              </div>
            )}
            {conversation?.messages.map((message) => (
              <article className={`note-chat-message is-${message.role}`} key={message.id}>
                <span className="note-chat-role">
                  {message.role === 'user' ? '나' : message.mode === 'rewrite' ? '수정 제안' : '답변'}
                </span>
                <div className="note-chat-markdown">
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      img: ({ alt }) => <span>{alt ?? '이미지'}</span>,
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          onClick={(e) => {
                            e.preventDefault();
                            if (href)
                              void openExternalLink(href).catch(() => setError('링크를 열지 못했습니다.'));
                          }}
                        >
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {message.content}
                  </Markdown>
                </div>
                {message.role === 'assistant' && (
                  <button
                    className="note-chat-apply"
                    disabled={busy || !extensionCanWrite(host.workspace.extensions, owner.pluginId)}
                    onClick={() => void apply(message)}
                  >
                    {message.mode === 'rewrite' ? <FilePenLine size={12} /> : <Plus size={12} />}{' '}
                    {message.mode === 'rewrite' ? '수정안 적용' : '노트 끝에 추가'}
                  </button>
                )}
              </article>
            ))}
            {busy && (
              <p className="note-chat-wait" role="status">
                <Loader2 size={13} className="note-chat-spinner" /> 작업 중…
              </p>
            )}
            <div ref={end} />
          </div>
          {error && (
            <div className="note-chat-error" role="alert">
              <p>{error}</p>
              <button
                disabled={busy}
                onClick={() =>
                  void call<NoteConversation>(owner.path, 'chat.history', args).then(
                    (value) => {
                      if (alive.current) {
                        setConversation(value);
                        setError('');
                      }
                    },
                    (e) => {
                      if (alive.current) setError(e.message);
                    },
                  )
                }
              >
                현재 상태 다시 읽기
              </button>
            </div>
          )}
          <form
            className="note-chat-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <div className="note-chat-modes" role="group" aria-label="채팅 작업">
              <button
                type="button"
                aria-pressed={mode === 'chat'}
                disabled={busy}
                onClick={() => setMode('chat')}
              >
                질문
              </button>
              <button
                type="button"
                aria-pressed={mode === 'rewrite'}
                disabled={busy}
                onClick={() => setMode('rewrite')}
              >
                수정 제안
              </button>
            </div>
            <textarea
              ref={textarea}
              aria-label="노트에 대해 요청하기"
              placeholder={mode === 'rewrite' ? '어떻게 수정할까요?' : '이 노트에서 궁금한 점을 적으세요…'}
              value={input}
              disabled={busy || !conversation}
              rows={3}
              maxLength={16000}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  e.nativeEvent.keyCode !== 229
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="note-chat-send">
              <small>현재 노트 · 최근 대화 포함</small>
              <button
                type="submit"
                aria-label="메시지 보내기"
                disabled={busy || !conversation || !input.trim()}
              >
                <Send size={14} />
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
function extensionCanWrite(
  extensions: NonNullable<React.ContextType<typeof NoteChatHost>>['workspace']['extensions'],
  id: string,
) {
  return extensions.find((e) => e.id === id)?.runtime?.permissions.includes('notes.write');
}
