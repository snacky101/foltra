// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call } from '../lib/api';
import { defaultTopicOptions } from '../lib/useTopics';
import type { Settings, TopicBlock, TopicBlocks, TopicSort, Workspace } from '../lib/types';
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
const updateSettings = vi.fn<(patch: Partial<Settings>) => Promise<boolean>>();
function App() {
  const [options, onChange] = useState(defaultTopicOptions);
  const [, refresh] = useState(0);
  return (
    <TopicsView
      workspace={workspace}
      options={options}
      refresh={async () => {}}
      onChange={onChange}
      toggleSources={() => onChange({ ...options, showSources: !options.showSources })}
      openNote={openNote}
      openLink={() => {}}
      updateSettings={async (patch) => {
        const saved = await updateSettings(patch);
        if (saved) refresh((value) => value + 1);
        return saved;
      }}
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
  workspace = {
    path: '/topic-qa',
    notes: [],
    folders: [
      { id: 'work', name: 'Work', parentId: null, revision: 'w1' },
      { id: 'child', name: 'Ideas', parentId: 'work', revision: 'i1' },
      { id: 'archive', name: 'Archive', parentId: null, revision: 'a1' },
    ],
    settings: { topicFolders: { include: [], exclude: [] } },
    topicOrderRevision: 'file1',
  } as unknown as Workspace;
  updateSettings.mockImplementation(async (patch) => {
    workspace = { ...workspace, settings: { ...workspace.settings, ...patch } };
    return true;
  });
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
    folders: { include: [], exclude: [] },
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

const folderCheckbox = (name: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
async function toggleFolder(name: string) {
  await act(async () => folderCheckbox(name).click());
}
const lastArgs = (command: string) =>
  vi
    .mocked(call)
    .mock.calls.filter(([, name]) => name === command)
    .at(-1)?.[2];

test('folder include and exclude settings reach catalog, page and reorder requests, including root-only selection', async () => {
  await act(async () => button('폴더 필터').click());
  expect(host.textContent).toContain('하위 폴더도 적용');
  expect(folderCheckbox('Work / Ideas 포함')).not.toBeNull();
  await toggleFolder('Work 포함');
  await toggleFolder('Archive 제외');
  await toggleFolder('최상위 노트 포함');
  const folders = { include: ['work', ''], exclude: ['archive'] };
  expect(updateSettings).toHaveBeenLastCalledWith({ topicFolders: folders });
  expect(lastArgs('topics.list')).toEqual({ folders });
  expect(lastArgs('topics.blocks')).toMatchObject({ folders, offset: 0 });
  await act(async () => dragEvent(handle('c2'), 'dragstart'));
  await act(async () => dragEvent(elements()[0], 'drop', -1));
  expect(lastArgs('topics.reorder')).toMatchObject({ folders, source: 'c2', target: 'c0' });
  await toggleFolder('Work 제외');
  expect(workspace.settings.topicFolders).toEqual({ ...folders, exclude: ['archive', 'work'] });
  expect(folderCheckbox('Work 포함').checked).toBe(true);
  expect(folderCheckbox('Work 제외').checked).toBe(true);
});

test('folder scope changes reset pagination and drag state; note moves and reparented folders refresh the catalog', async () => {
  cards = Array.from({ length: 55 }, (_, i) => ({ ...cards[0], id: `c${i}`, line: i + 1 }));
  workspace = {
    ...workspace,
    notes: [
      { id: 'note', title: 'Source', folderId: 'work', revision: 'same', createdAt: '', updatedAt: '' },
    ],
  };
  await act(async () => root.render(<App />));
  await act(async () => button('다음').click());
  expect(lastArgs('topics.blocks')).toMatchObject({ offset: 50 });
  await act(async () => dragEvent(handle('c50'), 'dragstart'));
  await toggleFolder('Work 포함');
  expect(lastArgs('topics.blocks')).toMatchObject({ offset: 0, folders: { include: ['work'], exclude: [] } });
  expect(host.querySelector('.dragging,.drag-off-page')).toBeNull();
  for (const change of [
    () => {
      workspace = { ...workspace, notes: [{ ...workspace.notes[0], folderId: 'child' }] };
    },
    () => {
      workspace = {
        ...workspace,
        folders: workspace.folders.map((folder) =>
          folder.id === 'child' ? { ...folder, parentId: 'archive' } : folder,
        ),
      };
    },
  ]) {
    const count = vi.mocked(call).mock.calls.filter(([, name]) => name === 'topics.list').length;
    change();
    await act(async () => root.render(<App />));
    expect(vi.mocked(call).mock.calls.filter(([, name]) => name === 'topics.list')).toHaveLength(count + 1);
  }
});

test('missing selected folders stay removable and empty results keep filter recovery available', async () => {
  const implementation = vi.mocked(call).getMockImplementation()!;
  vi.mocked(call).mockImplementation(async (path, command, args) => {
    if (
      command === 'topics.list' &&
      (args as { folders: Settings['topicFolders'] }).folders.include.includes('deleted')
    )
      return [];
    return implementation(path, command, args);
  });
  workspace = {
    ...workspace,
    settings: { ...workspace.settings, topicFolders: { include: ['deleted'], exclude: [] } },
  };
  await act(async () => root.render(<App />));
  expect(host.textContent).toContain('선택한 폴더에 주제가 없습니다.');
  expect(lastArgs('topics.list')).toEqual({ folders: { include: ['deleted'], exclude: [] } });
  await act(async () => button('폴더 필터').click());
  expect(folderCheckbox('없는 폴더 (deleted) 포함').checked).toBe(true);
  expect(folderCheckbox('없는 폴더 (deleted) 제외').disabled).toBe(true);
  await toggleFolder('없는 폴더 (deleted) 포함');
  expect(ids()).toHaveLength(3);
  expect(host.textContent).not.toContain('없는 폴더');
  await toggleFolder('Archive 제외');
  await act(async () => button('필터 해제').click());
  expect(workspace.settings.topicFolders).toEqual({ include: [], exclude: [] });
});

test('reordering workspace summaries after an ordinary note edit does not reset the selected page', async () => {
  cards = Array.from({ length: 55 }, (_, i) => ({ ...cards[0], id: `c${i}`, line: i + 1 }));
  workspace = {
    ...workspace,
    notes: ['a', 'b'].map((id) => ({
      id,
      title: id,
      folderId: 'work',
      revision: 'same',
      createdAt: '',
      updatedAt: '',
    })),
  };
  await act(async () => root.render(<App />));
  await act(async () => button('다음').click());
  workspace = {
    ...workspace,
    notes: [...workspace.notes].reverse().map((note) => ({ ...note, revision: 'updated' })),
    folders: [...workspace.folders].reverse(),
  };
  await act(async () => root.render(<App />));
  expect(lastArgs('topics.blocks')).toMatchObject({ offset: 50 });
  expect(ids()).toEqual(['c50', 'c51', 'c52', 'c53', 'c54']);
});

test('pending folder saves block additional toggles and failed saves preserve the original selection', async () => {
  let finish!: (saved: boolean) => void;
  updateSettings.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => button('폴더 필터').click());
  await toggleFolder('Work 포함');
  expect(folderCheckbox('Work 포함').checked).toBe(false);
  expect(folderCheckbox('Archive 제외').matches(':disabled')).toBe(true);
  await toggleFolder('Archive 제외');
  expect(updateSettings).toHaveBeenCalledTimes(1);
  await act(async () => finish(false));
  expect(folderCheckbox('Work 포함').matches(':disabled')).toBe(false);
  expect(workspace.settings.topicFolders).toEqual({ include: [], exclude: [] });
});

test('a completed move from the previous folder scope does not change sorting in the current scope', async () => {
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
  await toggleFolder('Work 포함');
  await act(async () => finish());
  expect(button('주제 카드 정렬').textContent).toContain('최신순');
  expect(ids()).toEqual(['c0', 'c1', 'c2']);
});

test.each(['topics.list', 'topics.blocks'])(
  'a late %s response cannot replace the current folder selection',
  async (delayedCommand) => {
    const implementation = vi.mocked(call).getMockImplementation()!;
    let finish!: () => void;
    vi.mocked(call).mockImplementation(async (path, command, args) => {
      const folders = (args as { folders: Settings['topicFolders'] }).folders;
      if (command === delayedCommand && folders.include.includes('work') && folders.exclude.length === 0) {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        if (command === 'topics.list')
          return [{ id: 'name:Old', title: 'Old scope', noteId: null, blockCount: 1, noteCount: 1 }];
        const page = (await implementation(path, command, args)) as TopicBlocks;
        return { ...page, blocks: [{ ...cards[0], id: 'old', body: 'Old scope' }] };
      }
      return implementation(path, command, args);
    });
    await toggleFolder('Work 포함');
    await toggleFolder('Archive 제외');
    expect(ids()).toEqual(['c0', 'c1', 'c2']);
    await act(async () => finish());
    expect(host.textContent).not.toContain('Old scope');
    expect(ids()).toEqual(['c0', 'c1', 'c2']);
  },
);

test('completed filter reaches catalog, pagination and reorder; toggling resets the page and can recover empty results', async () => {
  const implementation = vi.mocked(call).getMockImplementation()!;
  let empty = false;
  vi.mocked(call).mockImplementation(async (path, command, args) => {
    if (command === 'topics.list' && (args as { hideCompleted?: boolean }).hideCompleted && empty) return [];
    return implementation(path, command, args);
  });
  cards = Array.from({ length: 55 }, (_, i) => ({ ...cards[0], id: `c${i}`, line: i + 1 }));
  workspace = { ...workspace, topicOrderRevision: 'more' };
  await act(async () => root.render(<App />));
  await act(async () => button('다음').click());
  expect(lastArgs('topics.blocks')).toMatchObject({ offset: 50 });
  await act(async () => button('완료된 항목 숨기기').click());
  expect(button('완료된 항목 숨기기').getAttribute('aria-pressed')).toBe('true');
  expect(lastArgs('topics.list')).toMatchObject({ hideCompleted: true });
  expect(lastArgs('topics.blocks')).toMatchObject({ hideCompleted: true, offset: 0 });
  await act(async () => dragEvent(handle('c2'), 'dragstart'));
  expect(button('완료된 항목 숨기기').disabled).toBe(true);
  await act(async () => dragEvent(elements()[0], 'drop', -1));
  expect(lastArgs('topics.reorder')).toMatchObject({ hideCompleted: true });
  empty = true;
  workspace = { ...workspace, topicOrderRevision: 'empty' };
  await act(async () => root.render(<App />));
  expect(host.textContent).toContain('표시할 항목이 없습니다.');
  await act(async () => button('완료된 항목 숨기기').click());
  expect(lastArgs('topics.list')).not.toHaveProperty('hideCompleted');
  expect(ids()).toHaveLength(50);
  expect(button('완료된 항목 숨기기').getAttribute('aria-pressed')).toBe('false');
});

test('a click following card drag does not open the source; the next pointer click does', async () => {
  await act(async () => dragEvent(handle('c2'), 'dragstart'));
  await act(async () => dragEvent(handle('c2'), 'dragend'));
  await act(async () => elements()[0].click());
  expect(openNote).not.toHaveBeenCalled();
  await act(async () => elements()[0].dispatchEvent(new Event('pointerdown', { bubbles: true })));
  await act(async () => elements()[0].click());
  expect(openNote).toHaveBeenCalledWith('note', 1);
});
