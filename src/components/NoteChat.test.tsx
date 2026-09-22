// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PluginView } from './PluginView';
import { NoteChatHost, type NoteConversation } from '../lib/noteChat';
import type { Workspace } from '../lib/types';
import manifest from '../../examples/plugins/note-chat.json';
import { call } from '../lib/api';
vi.mock('../lib/api', () => ({ call: vi.fn() }));
const request = vi.mocked(call);
const conversation = (id: string, content?: string): NoteConversation => ({
  note: { id, title: id, revision: `note-${id}` },
  revision: content ? `chat-${id}` : 'empty',
  messages: content
    ? [
        {
          id: 'answer',
          role: 'assistant',
          content,
          mode: 'chat',
          sourceRevision: `note-${id}`,
          createdAt: '',
        },
      ]
    : [],
});
const workspace = {
  path: '/disposable',
  notes: [
    { id: 'A', title: '노트 A' },
    { id: 'B', title: '노트 B' },
  ],
  extensions: [manifest],
  pluginStates: [{ id: 'note-chat', enabled: true, digest: 'digest' }],
} as unknown as Workspace;
let element: HTMLDivElement, root: Root;
const save = vi.fn(),
  refresh = vi.fn(),
  notify = vi.fn();
const render = async (noteId: string | null = 'A', settingsOnly = false, strict = false) => {
  const view = (
    <NoteChatHost value={{ workspace, noteId, save, refresh, notify }}>
      <PluginView
        title="노트 채팅"
        tree={{ type: settingsOnly ? 'ai-settings' : 'note-chat' }}
        pluginId="note-chat"
        busy={false}
        action={async () => {}}
        refresh={() => {}}
        embedded
      />
    </NoteChatHost>
  );
  await act(async () => root.render(strict ? <StrictMode>{view}</StrictMode> : view));
};
const fill = async (selector: string, value: string) => {
  const input = element.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const click = async (selector: string) =>
  act(async () => element.querySelector<HTMLButtonElement>(selector)!.click());
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollIntoView = vi.fn();
  save.mockResolvedValue(true);
  refresh.mockResolvedValue(undefined);
  request.mockImplementation(async (_path, command, args) => {
    if (command === 'chat.history') return conversation((args as { noteId: string }).noteId);
    if (command === 'chat.settings')
      return { baseUrl: 'https://example.com/v1', model: 'test', hasApiKey: true, revision: 'config' };
    throw Error(`Unexpected command ${command}`);
  });
  element = document.createElement('div');
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
});

test.each([{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }])(
  'IME confirmation and Shift+Enter do not send (%j)',
  async (init) => {
    await render();
    await fill('textarea', '한글 질문');
    await act(async () =>
      element
        .querySelector('textarea')!
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }),
        ),
    );
    expect(request.mock.calls.map((c) => c[1])).toEqual(['chat.history']);
    expect(save).not.toHaveBeenCalled();
  },
);
test('saves before sending, blocks duplicate requests, and applies only on explicit action', async () => {
  await render();
  await fill('textarea', '요약해 줘');
  let finish!: (value: NoteConversation) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    element.querySelector<HTMLButtonElement>('[aria-label="메시지 보내기"]')!.click();
    element.querySelector<HTMLButtonElement>('[aria-label="메시지 보내기"]')!.click();
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenLastCalledWith('/disposable', 'chat.send', {
    pluginId: 'note-chat',
    pluginDigest: 'digest',
    noteId: 'A',
    message: '요약해 줘',
    mode: 'chat',
    expectedRevision: 'empty',
  });
  expect(request.mock.calls.some((c) => c[1] === 'chat.apply')).toBe(false);
  await act(async () => finish(conversation('A', '요약입니다')));
  expect(element.querySelector('textarea')!.value).toBe('');
  expect(document.activeElement).toBe(element.querySelector('textarea'));
  request.mockResolvedValueOnce(conversation('A', '요약입니다'));
  await click('.note-chat-apply');
  expect(request).toHaveBeenLastCalledWith(
    '/disposable',
    'chat.apply',
    expect.objectContaining({ noteId: 'A', messageId: 'answer', expectedRevision: 'note-A' }),
  );
  expect(refresh).toHaveBeenCalledOnce();
  expect(notify).toHaveBeenCalledWith('답변을 노트 끝에 추가했습니다.');
});
test('switching notes discards a late UI reply and reopening loads the saved conversation', async () => {
  await render();
  await fill('textarea', 'A 질문');
  let finish!: (value: NoteConversation) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await click('[aria-label="메시지 보내기"]');
  await render('B');
  await act(async () => finish(conversation('A', 'A에만 보이는 답변')));
  expect(element.textContent).not.toContain('A에만 보이는 답변');
  expect(element.querySelector('.note-chat-note')?.textContent).toBe('노트 B');
  request.mockResolvedValueOnce(conversation('A', 'A에만 보이는 답변'));
  await render('A');
  expect(element.textContent).toContain('A에만 보이는 답변');
});
test('failed saves and provider errors preserve the draft and never apply anything', async () => {
  await render();
  await fill('textarea', '보존할 질문');
  save.mockResolvedValueOnce(false);
  await click('[aria-label="메시지 보내기"]');
  expect(request.mock.calls).toHaveLength(1);
  request.mockRejectedValueOnce(Error('Provider 연결 실패'));
  await click('[aria-label="메시지 보내기"]');
  expect(element.querySelector('textarea')!.value).toBe('보존할 질문');
  expect(element.querySelector('[role=alert]')?.textContent).toContain('Provider 연결 실패');
  expect(request.mock.calls.some((c) => c[1] === 'chat.apply')).toBe(false);
});
test('replacement proposal is a distinct request and clearing needs confirmation', async () => {
  await render();
  await act(async () =>
    [...element.querySelectorAll('button')].find((b) => b.textContent === '수정 제안')!.click(),
  );
  await fill('textarea', '간결하게');
  const result = conversation('A', '# 간결한 노트');
  result.messages[0].mode = 'rewrite';
  request.mockResolvedValueOnce(result);
  await click('[aria-label="메시지 보내기"]');
  expect(request).toHaveBeenLastCalledWith(
    '/disposable',
    'chat.send',
    expect.objectContaining({ mode: 'rewrite' }),
  );
  expect(element.querySelector('.note-chat-apply')?.textContent).toContain('수정안 적용');
  await click('[aria-label="이 노트의 대화 비우기"]');
  expect(request.mock.calls.some((c) => c[1] === 'chat.clear')).toBe(false);
  request.mockResolvedValueOnce(conversation('A'));
  await click('.note-chat-confirm button');
  expect(request).toHaveBeenLastCalledWith(
    '/disposable',
    'chat.clear',
    expect.objectContaining({ expectedRevision: 'chat-A' }),
  );
  expect(element.querySelector('.note-chat-message')).toBeNull();
});
test('settings never display a stored key or send it back unless changed', async () => {
  await render(null, true);
  const key = element.querySelector<HTMLInputElement>('[aria-label="API 키"]')!;
  expect(key.type).toBe('password');
  expect(key.value).toBe('');
  await fill('[aria-label="AI 모델"]', 'new-model');
  request.mockResolvedValueOnce({
    baseUrl: 'https://example.com/v1',
    model: 'new-model',
    hasApiKey: true,
    revision: 'next',
  });
  await click('button.primary-button');
  expect(request).toHaveBeenLastCalledWith('/disposable', 'chat.configure', {
    pluginId: 'note-chat',
    pluginDigest: 'digest',
    baseUrl: 'https://example.com/v1',
    model: 'new-model',
    expectedRevision: 'config',
  });
  await click('.note-chat-text-button');
  request.mockResolvedValueOnce({
    baseUrl: 'https://example.com/v1',
    model: 'new-model',
    hasApiKey: false,
    revision: 'deleted',
  });
  await click('button.primary-button');
  expect(request).toHaveBeenLastCalledWith(
    '/disposable',
    'chat.configure',
    expect.objectContaining({ apiKey: '', expectedRevision: 'next' }),
  );
});
test('StrictMode discarded settings load cannot overwrite a newer draft', async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(null, true, true);
  await fill('[aria-label="AI 모델"]', '내 모델');
  await act(async () =>
    finish({ baseUrl: 'https://stale.example/v1', model: 'old', hasApiKey: false, revision: 'old' }),
  );
  expect(element.querySelector<HTMLInputElement>('[aria-label="AI 모델"]')!.value).toBe('내 모델');
});
test('without an open note only the setup affordance is shown', async () => {
  await render(null);
  expect(element.querySelector('textarea')).toBeNull();
  expect(element.textContent).toContain('노트를 열면');
  expect(request).not.toHaveBeenCalled();
});

test('returning to a note before its pending response finishes refreshes that conversation', async () => {
  await render();
  await fill('textarea', '기다리는 질문');
  let finish!: (value: NoteConversation) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await click('[aria-label="메시지 보내기"]');
  await render('B');
  await render('A');
  request.mockResolvedValueOnce(conversation('A', '돌아온 뒤 도착한 답변'));
  await act(async () => finish(conversation('A', '돌아온 뒤 도착한 답변')));
  expect(element.textContent).toContain('돌아온 뒤 도착한 답변');
});
