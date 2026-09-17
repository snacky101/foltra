// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call, CoreError } from '../lib/api';
import type { Database, Property } from '../lib/types';
import { PropertyEditor } from './PropertyEditor';

vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  call: vi.fn(),
}));
const database: Database = { id: 'db', name: 'Tasks', createdAt: '', properties: [] };
const title: Property = { id: 'title', name: 'Name', type: 'text' };
const status: Property = { id: 'status', name: 'Status', type: 'status', options: ['Todo', 'Done'] };
function preview(property: Property, extra = {}) {
  return {
    revision: `snapshot:${property.name}`,
    property,
    rowCount: 2,
    changedRows: 0,
    errorCount: 0,
    errors: [],
    changedNotes: 1,
    changedQueries: 2,
    queryErrors: [],
    canApply: true,
    ...extra,
  };
}
let host: HTMLDivElement, root: Root;
let close = vi.fn(),
  refresh = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  close = vi.fn();
  refresh = vi.fn().mockResolvedValue(undefined);
  vi.mocked(call)
    .mockReset()
    .mockImplementation(async (_vault, command, args) =>
      command === 'database.property.preview' ? preview((args as { property: Property }).property) : {},
    );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
async function settle() {
  await act(async () => vi.advanceTimersByTimeAsync(160));
}
async function render(property = status) {
  await act(async () =>
    root.render(
      <PropertyEditor
        vault="/disposable"
        database={database}
        property={property}
        close={close}
        refresh={refresh}
      />,
    ),
  );
  await settle();
}
const input = () => host.querySelector<HTMLInputElement>('[aria-label="컬럼 이름"]')!;
const button = (text: string) =>
  [...host.querySelectorAll('button')].find((item) => item.textContent === text)!;
const calls = (command: string) => vi.mocked(call).mock.calls.filter(([, name]) => name === command);
const updates = () => calls('database.property.update');
async function edit(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function key(key: string, extra: KeyboardEventInit = {}) {
  await act(async () =>
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })),
  );
}
async function click(text: string) {
  await act(async () => button(text).click());
}

test.each([title, status])(
  'renames $id using a trimmed label while preserving ID, type and options',
  async (property) => {
    await render(property);
    await edit('  작업 이름  ');
    expect(button('변경 적용').disabled).toBe(true);
    await settle();
    expect(host.textContent).toContain('1개 노트의 쿼리 2개 이름 참조 변경');
    expect(host.textContent).not.toContain('개 값 변환');
    await click('변경 적용');
    expect(updates()).toEqual([
      [
        '/disposable',
        'database.property.update',
        {
          databaseId: 'db',
          property: { ...property, name: '작업 이름' },
          expectedRevision: 'snapshot:작업 이름',
        },
      ],
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  },
);

test('title permits renaming but explains its body role and keeps type immutable', async () => {
  await render(title);
  expect(input().value).toBe('Name');
  expect(host.querySelector('[aria-label="컬럼 타입"]')).toBeNull();
  expect(host.textContent).toContain('각 행의 노트를 만들거나 여는 컬럼입니다.');
  expect(host.textContent).toContain('타입은 텍스트로 유지됩니다.');
});

test('blank name never requests inspection or update and gives validation feedback', async () => {
  await render();
  const count = calls('database.property.preview').length;
  await edit('   ');
  await settle();
  await key('Enter');
  expect(calls('database.property.preview')).toHaveLength(count);
  expect(updates()).toHaveLength(0);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('컬럼 이름을 입력하세요.');
  expect(button('변경 적용').disabled).toBe(true);
});

test('composition Enter and legacy 229 preserve the name draft; ordinary Enter applies', async () => {
  await render(title);
  await edit('한글 이름');
  await settle();
  await key('Enter', { isComposing: true });
  await key('Enter', { keyCode: 229 });
  expect(updates()).toHaveLength(0);
  expect(input().value).toBe('한글 이름');
  await key('Enter');
  expect(updates()).toHaveLength(1);
});

test('a stale inspection response cannot enable saving a newer draft', async () => {
  await render();
  let resolve!: (value: unknown) => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await edit('Earlier');
  await settle();
  await edit('Latest');
  await act(async () => resolve(preview({ ...status, name: 'Earlier' })));
  expect(button('변경 적용').disabled).toBe(true);
  await settle();
  await click('변경 적용');
  expect(updates()[0][2]).toMatchObject({
    property: { name: 'Latest' },
    expectedRevision: 'snapshot:Latest',
  });
});

test('query rewrite errors identify the affected note and prevent updates', async () => {
  vi.mocked(call).mockResolvedValue(
    preview(status, {
      canApply: false,
      queryErrors: [{ noteId: 'n', title: 'Weekly report', message: 'Ambiguous column reference' }],
    }),
  );
  await render();
  await edit('Stage');
  await settle();
  expect(host.textContent).toContain('Weekly report');
  expect(host.textContent).toContain('Ambiguous column reference');
  expect(host.textContent).not.toContain('0개 값을 변환할 수 없습니다');
  expect(button('변경 적용').disabled).toBe(true);
  await key('Enter');
  expect(updates()).toHaveLength(0);
});

test('a preview error retains the name draft and permits an explicit recheck', async () => {
  await render();
  vi.mocked(call).mockRejectedValueOnce(new Error('Name already exists'));
  await edit('Stage');
  await settle();
  expect(input().value).toBe('Stage');
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Name already exists');
  expect(button('변경 적용').disabled).toBe(true);
  await click('다시 검사');
  await settle();
  expect(button('변경 적용').disabled).toBe(false);
});

test('conflict preserves the draft and requires explicit fresh inspection without retrying writes', async () => {
  await render();
  await edit('Stage');
  await settle();
  vi.mocked(call).mockRejectedValueOnce(new CoreError('conflict', 'Changed elsewhere'));
  await click('변경 적용');
  await settle();
  await key('Enter');
  expect(input().value).toBe('Stage');
  expect(updates()).toHaveLength(1);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('다시 검사');
  expect(close).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  await click('다시 검사');
  await settle();
  await click('변경 적용');
  expect(updates()).toHaveLength(2);
});

test('pending save prevents edits, duplicate submission and modal dismissal until refresh finishes', async () => {
  await render(title);
  await edit('New name');
  await settle();
  let resolve!: (value: unknown) => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await click('변경 적용');
  await key('Enter');
  await key('Escape');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="닫기"]')!.click());
  expect(host.querySelector('fieldset')?.disabled).toBe(true);
  expect(updates()).toHaveLength(1);
  expect(close).not.toHaveBeenCalled();
  let finish!: () => void;
  refresh.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        finish = done;
      }),
  );
  await act(async () => resolve({}));
  expect(close).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(close).toHaveBeenCalledTimes(1);
});
