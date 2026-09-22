// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call, CoreError } from '../lib/api';
import type { TrashItem } from '../lib/types';
import { TrashView } from './TrashView';

vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  call: vi.fn(),
}));
let host: HTMLDivElement, root: Root;
const items: TrashItem[] = [
  {
    id: 'note',
    title: 'Alpha 기록',
    kind: 'note',
    deletedAt: '2026-09-18T00:00:00Z',
    revision: 'note-before',
  },
  {
    id: 'folder',
    title: '연구 자료',
    kind: 'folder',
    deletedAt: '2026-09-18T00:00:00Z',
    revision: 'folder-before',
    noteCount: 2,
    folderCount: 1,
  },
  {
    id: 'database',
    title: 'Projects',
    kind: 'database',
    deletedAt: '2026-09-18T00:00:00Z',
    revision: 'database-before',
    recordCount: 3,
  },
  {
    id: 'record',
    title: 'Beta',
    kind: 'record',
    deletedAt: '2026-09-18T00:00:00Z',
    revision: 'record-before',
  },
];
const refresh = vi.fn<() => Promise<void>>();
const onError = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(call).mockReset().mockResolvedValue({});
  refresh.mockReset().mockResolvedValue(undefined);
  onError.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render(next = items) {
  await act(async () =>
    root.render(<TrashView vault="/disposable" items={next} refresh={refresh} onError={onError} />),
  );
}
const rows = () => [...host.querySelectorAll<HTMLElement>('.trash-row')];
const button = (scope: Element, label: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === label)!;
async function click(scope: Element, label: string) {
  await act(async () => button(scope, label).click());
}
async function search(value: string) {
  const input = host.querySelector<HTMLInputElement>('[aria-label="휴지통 검색"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}

test('search filters Korean/English names without writes and row icons identify their types', async () => {
  await render();
  expect(rows()).toHaveLength(4);
  expect(rows().map((row) => row.querySelector('[role="img"]')?.getAttribute('aria-label'))).toEqual([
    '노트',
    '폴더',
    '데이터베이스',
    'DB 항목',
  ]);
  expect(rows().every((row) => !row.querySelector('.lucide-trash-2'))).toBe(true);
  await search('  ALPHA ');
  expect(rows()).toHaveLength(1);
  expect(rows()[0].textContent).toContain('Alpha 기록');
  await search('자료');
  expect(rows()).toHaveLength(1);
  expect(rows()[0].textContent).toContain('연구 자료');
  await search('없는 제목');
  expect(rows()).toHaveLength(0);
  expect(host.textContent).toContain('검색 결과가 없어요');
  expect(host.textContent).not.toContain('휴지통이 비어 있어요');
  await search('');
  expect(rows()).toHaveLength(4);
  expect(call).not.toHaveBeenCalled();
});

test('permanent delete requires confirmation, cancellation is pure, and successful delete immediately removes the row', async () => {
  await render();
  await click(rows()[0], '영구 삭제');
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Alpha 기록');
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('복원할 수 없습니다');
  expect(call).not.toHaveBeenCalled();
  await click(host.querySelector('[role="dialog"]')!, '취소');
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await click(rows()[0], '영구 삭제');
  let finish!: () => void;
  refresh.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await submit();
  expect(call).toHaveBeenCalledExactlyOnceWith('/disposable', 'trash.delete', {
    id: 'note',
    expectedRevision: 'note-before',
  });
  expect(rows()).toHaveLength(3);
  expect(rows().some((row) => row.textContent?.includes('Alpha 기록'))).toBe(false);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => finish());
});

test('folder and database confirmation describe included children and rows', async () => {
  await render();
  await click(rows()[1], '영구 삭제');
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('하위 폴더 1개와 노트 2개');
  await click(host.querySelector('[role="dialog"]')!, '취소');
  await click(rows()[2], '영구 삭제');
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('DB 항목 3개');
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('연결된 노트는 유지');
});

test('restoration uses listed revision and updates immediately without leaving the page', async () => {
  await render();
  await click(rows()[3], '복원');
  expect(call).toHaveBeenCalledExactlyOnceWith('/disposable', 'trash.restore', {
    id: 'record',
    expectedRevision: 'record-before',
  });
  expect(rows()).toHaveLength(3);
  expect(refresh).toHaveBeenCalledOnce();
});

test('a changed confirmation snapshot is never replaced or retried after a revision conflict', async () => {
  await render();
  await click(rows()[0], '영구 삭제');
  await render([{ ...items[0], revision: 'note-after', title: 'Updated' }, ...items.slice(1)]);
  vi.mocked(call).mockRejectedValue(new CoreError('conflict', 'stale'));
  await submit();
  expect(call).toHaveBeenCalledExactlyOnceWith('/disposable', 'trash.delete', {
    id: 'note',
    expectedRevision: 'note-before',
  });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('취소한 뒤');
  expect(rows()).toHaveLength(4);
  expect(refresh).not.toHaveBeenCalled();
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
});

test('pending deletion blocks duplicate submits, restore, and dismissal', async () => {
  let finish!: () => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await click(rows()[0], '영구 삭제');
  await submit();
  await submit();
  expect(button(rows()[1], '복원').disabled).toBe(true);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  expect(call).toHaveBeenCalledOnce();
  await act(async () => finish());
  expect(rows()).toHaveLength(3);
});

test('restore failure retains item and reports once; refresh failure after deletion cannot offer a duplicate delete', async () => {
  await render();
  const error = new Error('Restore failed');
  vi.mocked(call).mockRejectedValueOnce(error);
  await click(rows()[0], '복원');
  expect(rows()).toHaveLength(4);
  expect(onError).toHaveBeenCalledWith(error);
  refresh.mockRejectedValueOnce(new Error('Refresh failed'));
  await click(rows()[0], '영구 삭제');
  await submit();
  expect(rows()).toHaveLength(3);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(onError).toHaveBeenCalledTimes(2);
});

test.each(['single', 'all'])('vault switch ignores an older in-flight %s deletion', async (kind) => {
  let finish!: () => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await search('Alpha');
  if (kind === 'all') await click(host, '전체 영구 삭제');
  else await click(rows()[0], '영구 삭제');
  await submit();
  const otherRefresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  await act(async () =>
    root.render(
      <TrashView vault="/other-disposable" items={items} refresh={otherRefresh} onError={onError} />,
    ),
  );
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('');
  await act(async () => finish());
  expect(rows()).toHaveLength(4);
  expect(refresh).not.toHaveBeenCalled();
  expect(otherRefresh).not.toHaveBeenCalled();
});

test('a later restored trash snapshot can appear again after the list observed deletion', async () => {
  await render();
  await click(rows()[0], '영구 삭제');
  await submit();
  await render(items.slice(1));
  await render(items);
  expect(rows()).toHaveLength(4);
});

test('emptying trash confirms every item including search-hidden rows and allows pure cancellation', async () => {
  await render();
  await search('Alpha');
  await click(host, '전체 영구 삭제');
  const dialog = host.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain('모든 항목 4개');
  expect(dialog.textContent).toContain('검색으로 숨겨진 항목도');
  expect(dialog.textContent).toContain('하위 폴더·노트');
  expect(dialog.textContent).toContain('복원할 수 없습니다');
  expect(call).not.toHaveBeenCalled();
  await click(dialog, '취소');
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(rows()).toHaveLength(1);
  expect(call).not.toHaveBeenCalled();
  await click(host, '전체 영구 삭제');
  let finish!: () => void;
  refresh.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await submit();
  expect(call).toHaveBeenCalledExactlyOnceWith('/disposable', 'trash.empty', {
    items: items.map(({ id, revision }) => ({ id, expectedRevision: revision })),
  });
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(rows()).toHaveLength(0);
  await search('');
  expect(rows()).toHaveLength(0);
  expect(host.textContent).toContain('휴지통이 비어 있어요');
  await act(async () => finish());
  expect(button(host, '전체 영구 삭제').disabled).toBe(true);
});

test('emptying trash retains the confirmation snapshot on conflict and never retries or partially removes rows', async () => {
  await render();
  await click(host, '전체 영구 삭제');
  await render([{ ...items[0], revision: 'changed' }, ...items.slice(1), { ...items[0], id: 'new-note' }]);
  vi.mocked(call).mockRejectedValueOnce(new CoreError('conflict', 'changed'));
  await submit();
  expect(call).toHaveBeenCalledExactlyOnceWith('/disposable', 'trash.empty', {
    items: items.map(({ id, revision }) => ({ id, expectedRevision: revision })),
  });
  expect(rows()).toHaveLength(5);
  expect(refresh).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('취소한 뒤');
});

test('pending empty blocks duplicate requests; successful removal survives refresh failure and preserves later items', async () => {
  let finish!: () => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await click(host, '전체 영구 삭제');
  await submit();
  await submit();
  expect(button(rows()[0], '복원').disabled).toBe(true);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  refresh.mockRejectedValueOnce(new Error('Refresh failed'));
  await act(async () => finish());
  expect(call).toHaveBeenCalledOnce();
  expect(onError).toHaveBeenCalledOnce();
  expect(rows()).toHaveLength(0);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(button(host, '전체 영구 삭제').disabled).toBe(true);
  await render([{ ...items[0], id: 'new-note' }]);
  expect(rows()).toHaveLength(1);
  expect(button(host, '전체 영구 삭제').disabled).toBe(false);
});
