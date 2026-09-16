// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call } from '../lib/api';
import { defaultTopicOptions } from '../lib/useTopics';
import type { TopicBlock, TopicBlocks, TopicSort, Workspace } from '../lib/types';
import { TopicsView } from './TopicsView';

vi.mock('../lib/api', () => ({ call: vi.fn() }));
vi.mock('./NotePreview', () => ({ NotePreview: ({ body }: { body: string }) => <p>{body}</p> }));
let host: HTMLDivElement;
let root: Root;
let cards: TopicBlock[];
let custom: string[] | null;
let revision: string;
let rejectMove: boolean;
let workspace: Workspace;
const openNote = vi.fn();
function App() {
  const [options, onChange] = useState(defaultTopicOptions);
  return (
    <TopicsView
      workspace={workspace}
      options={options}
      onChange={onChange}
      toggleSources={() => onChange({ ...options, showSources: !options.showSources })}
      openNote={openNote}
      openLink={() => {}}
    />
  );
}
const elements = () => [...host.querySelectorAll<HTMLElement>('.topic-card:not(.drag-off-page)')];
const ids = () => elements().map((e) => e.dataset.cardId);
const handle = (id: string) =>
  host.querySelector<HTMLButtonElement>(`[data-card-id="${id}"] .topic-drag-handle`)!;
const transfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), setDragImage: vi.fn() };
function dragEvent(node: Element, type: string, y = 1) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { dataTransfer: transfer, clientY: y, relatedTarget: null });
  node.dispatchEvent(e);
}
const button = (name: string) =>
  [...host.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name,
  )!;
const choose = async (sort: string) => {
  await act(async () => button('주제 카드 정렬').click());
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role=option]')]
      .find((b) => b.textContent?.includes(sort))!
      .click(),
  );
};
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  cards = Array.from({ length: 3 }, (_, i) => ({
    id: `c${i}`,
    noteId: 'note',
    noteTitle: 'Source',
    revision: 'r1',
    createdAt: '2026-09-16',
    updatedAt: '2026-09-16',
    line: i * 2 + 1,
    endLine: i * 2 + 1,
    body: `Card ${i} [[Foo]]`,
  }));
  custom = null;
  revision = 'v1';
  rejectMove = false;
  workspace = { path: '/topic-qa', notes: [], topicOrderRevision: 'file1' } as unknown as Workspace;
  vi.mocked(call).mockImplementation(async (_path, command, args) => {
    const a = args as Record<string, unknown>;
    if (command === 'topics.list')
      return [{ id: 'name:Foo', title: 'Foo', noteId: null, blockCount: cards.length, noteCount: 1 }];
    if (command === 'topics.blocks') {
      const sort = (a.sort ?? (custom ? 'custom' : 'newest')) as TopicSort;
      const ordered =
        sort === 'custom' && custom ? custom.map((id) => cards.find((c) => c.id === id)!) : cards;
      const offset = Number(a.offset ?? 0),
        limit = 50;
      return {
        topic: null,
        blocks: ordered.slice(offset, offset + limit),
        offset,
        limit,
        total: cards.length,
        sort,
        orderRevision: revision,
      } satisfies TopicBlocks;
    }
    if (command === 'topics.reorder') {
      if (rejectMove) throw new Error('순서를 저장하지 못했습니다.');
      expect(a.expectedRevision).toBe(revision);
      const order = a.sort === 'custom' && custom ? [...custom] : cards.map((c) => c.id);
      order.splice(order.indexOf(a.source as string), 1);
      order.splice(
        order.indexOf(a.target as string) + (a.placement === 'after' ? 1 : 0),
        0,
        a.source as string,
      );
      custom = order;
      revision += 'x';
      return { saved: true };
    }
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<App />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

test('dragging a handle shows the insertion edge, saves once and selects custom order', async () => {
  await act(async () => dragEvent(handle('c2'), 'dragstart'));
  await act(async () => dragEvent(elements()[0], 'dragover', -1));
  expect(elements()[0].classList.contains('drop-before')).toBe(true);
  await act(async () => dragEvent(elements()[0], 'drop', -1));
  expect(ids()).toEqual(['c2', 'c0', 'c1']);
  expect(button('주제 카드 정렬').textContent).toContain('사용자 지정');
  expect(call).toHaveBeenCalledWith('/topic-qa', 'topics.reorder', {
    topic: 'name:Foo',
    source: 'c2',
    target: 'c0',
    placement: 'before',
    sort: 'newest',
    expectedRevision: 'v1',
  });
  await choose('노트 생성일 최신순');
  expect(ids()).toEqual(['c0', 'c1', 'c2']);
  await choose('사용자 지정');
  expect(ids()).toEqual(['c2', 'c0', 'c1']);
  await act(async () => root.render(<App key="reopened" />));
  expect(ids()).toEqual(['c2', 'c0', 'c1']);
});

test('body selections and external drops do not reorder; drag cancellation preserves order', async () => {
  await act(async () => dragEvent(elements()[0], 'drop'));
  expect(vi.mocked(call).mock.calls.some(([, c]) => c === 'topics.reorder')).toBe(false);
  expect(elements()[0].hasAttribute('draggable')).toBe(false);
  await act(async () => dragEvent(handle('c0'), 'dragstart'));
  await act(async () => dragEvent(elements()[2], 'dragover'));
  await act(async () => dragEvent(handle('c0'), 'dragend'));
  expect(host.querySelector('.dragging,.drop-after,.drop-before')).toBeNull();
  expect(ids()).toEqual(['c0', 'c1', 'c2']);
});

test('failed saves preserve visible order, expose retry and do not switch sorting', async () => {
  rejectMove = true;
  await act(async () => dragEvent(handle('c2'), 'dragstart'));
  await act(async () => dragEvent(elements()[0], 'drop', -1));
  expect(ids()).toEqual(['c0', 'c1', 'c2']);
  expect(host.querySelector('[role=alert]')?.textContent).toContain('순서를 저장하지 못했습니다.');
  expect(button('주제 카드 정렬').textContent).toContain('최신순');
  rejectMove = false;
  await act(async () => button('다시 시도').click());
  expect(host.querySelector('[role=alert]')).toBeNull();
});

test('keyboard alternative preserves focus and source navigation still opens the original line', async () => {
  await act(async () => {
    handle('c1').focus();
    handle('c1').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true }),
    );
  });
  expect(ids()).toEqual(['c1', 'c0', 'c2']);
  expect(document.activeElement).toBe(handle('c1'));
  await act(async () => button('Source 3행 원본 열기').click());
  expect(openNote).toHaveBeenCalledWith('note', 3);
});

test('a stale drag cancels when a workspace update changes source revisions', async () => {
  await act(async () => dragEvent(handle('c2'), 'dragstart'));
  revision = 'new-source';
  workspace = { ...workspace, topicOrderRevision: 'file2' };
  await act(async () => root.render(<App />));
  await act(async () => dragEvent(elements()[0], 'drop', -1));
  expect(vi.mocked(call).mock.calls.some(([, c]) => c === 'topics.reorder')).toBe(false);
});

test('page hover retains the drag source DOM until dropping onto another page', async () => {
  cards = Array.from({ length: 55 }, (_, i) => ({
    ...cards[0],
    id: `c${i}`,
    line: i + 1,
    body: `Card ${i}`,
  }));
  workspace = { ...workspace, topicOrderRevision: 'more' };
  await act(async () => root.render(<App />));
  const original = handle('c0');
  await act(async () => dragEvent(original, 'dragstart'));
  vi.useFakeTimers();
  await act(async () => dragEvent(button('다음'), 'dragover'));
  await act(async () => vi.advanceTimersByTimeAsync(700));
  vi.useRealTimers();
  expect(ids()).toEqual(['c50', 'c51', 'c52', 'c53', 'c54']);
  expect(handle('c0')).toBe(original);
  expect(original.isConnected).toBe(true);
  await act(async () => dragEvent(elements()[0], 'drop', -1));
  expect(custom?.indexOf('c0')).toBe(49);
  expect(custom?.[50]).toBe('c50');
});

test('pending writes block duplicate moves and retain display preferences changed while saving', async () => {
  const implementation = vi.mocked(call).getMockImplementation()!;
  let finish!: () => void;
  vi.mocked(call).mockImplementation(async (path, command, args) => {
    if (command === 'topics.reorder')
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return implementation(path, command, args);
  });
  await act(async () => dragEvent(handle('c2'), 'dragstart'));
  await act(async () => dragEvent(elements()[0], 'drop', -1));
  expect(handle('c1').disabled).toBe(true);
  await act(async () => {
    handle('c1').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }));
    button('원본 노트 정보 표시').click();
  });
  expect(vi.mocked(call).mock.calls.filter(([, c]) => c === 'topics.reorder')).toHaveLength(1);
  await act(async () => finish());
  expect(ids()).toEqual(['c2', 'c0', 'c1']);
  expect(button('원본 노트 정보 표시').getAttribute('aria-pressed')).toBe('true');
});
