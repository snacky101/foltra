// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call, CoreError } from '../lib/api';
import type { DatabaseInspection } from '../lib/useDatabaseActions';
import { DeletePropertyDialog } from './DeletePropertyDialog';

vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  call: vi.fn(),
}));
let host: HTMLDivElement, root: Root;
const snapshot: DatabaseInspection = {
  database: {
    id: 'db',
    name: 'Projects',
    createdAt: '',
    properties: [
      { id: 'title', name: 'Name', type: 'text' },
      { id: 'score', name: 'Score', type: 'number' },
    ],
  },
  revision: 'inspected-revision',
  recordCount: 5,
};
const close = vi.fn();
const refresh = vi.fn<() => Promise<void>>();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  close.mockReset();
  refresh.mockReset().mockResolvedValue(undefined);
  vi.mocked(call).mockReset().mockResolvedValue(snapshot);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render(propertyId = 'score') {
  await act(async () =>
    root.render(
      <DeletePropertyDialog
        vault="/disposable"
        databaseId="db"
        propertyId={propertyId}
        refresh={refresh}
        close={close}
      />,
    ),
  );
}
async function submit() {
  await act(async () =>
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}
const writes = () =>
  vi.mocked(call).mock.calls.filter(([, command]) => command === 'database.property.delete');
const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === label)!;

test('confirmation shows inspected names and row count, then deletes once using the displayed snapshot', async () => {
  await render();
  expect(host.textContent).toContain('“Projects”의 “Score”');
  expect(host.textContent).toContain('전체 5개 행');
  expect(writes()).toHaveLength(0);
  await submit();
  expect(writes()).toEqual([
    [
      '/disposable',
      'database.property.delete',
      {
        databaseId: 'db',
        propertyId: 'score',
        expectedRevision: 'inspected-revision',
      },
    ],
  ]);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
});

test('cancel closes without writes, and inspection failure keeps confirmation disabled', async () => {
  vi.mocked(call).mockRejectedValue(new Error('Cannot inspect'));
  await render();
  expect(button('컬럼 삭제').disabled).toBe(true);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Cannot inspect');
  await act(async () => button('취소').click());
  expect(writes()).toHaveLength(0);
  expect(close).toHaveBeenCalledOnce();
});

test('revision conflict preserves the dialog and never re-inspects or automatically retries', async () => {
  await render();
  vi.mocked(call).mockRejectedValue(new CoreError('conflict', 'stale'));
  await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('취소한 뒤 최신 내용');
  expect(close).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  expect(writes()).toHaveLength(1);
  await submit();
  expect(vi.mocked(call).mock.calls.filter(([, command]) => command === 'database.inspect')).toHaveLength(1);
  expect(writes().map(([, , args]) => args)).toEqual(
    Array(2).fill({ databaseId: 'db', propertyId: 'score', expectedRevision: 'inspected-revision' }),
  );
});

test('pending inspection and deletion disable confirmation and block duplicate writes or dismissal', async () => {
  let inspect!: (value: DatabaseInspection) => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise<DatabaseInspection>((resolve) => {
        inspect = resolve;
      }),
  );
  await render();
  expect(button('컬럼 삭제').disabled).toBe(true);
  await submit();
  expect(writes()).toHaveLength(0);
  await act(async () => inspect(snapshot));
  let deleted!: () => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        deleted = resolve;
      }),
  );
  await submit();
  expect(button('삭제 중…').disabled).toBe(true);
  await submit();
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(writes()).toHaveLength(1);
  expect(close).not.toHaveBeenCalled();
  await act(async () => deleted());
  expect(close).toHaveBeenCalledOnce();
});

test('a refresh completing after the dialog unmounts cannot dismiss a later dialog', async () => {
  let finish!: () => void;
  refresh.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await submit();
  expect(writes()).toHaveLength(1);
  await act(async () => root.render(<p>Different context</p>));
  await act(async () => finish());
  expect(close).not.toHaveBeenCalled();
});

test.each(['title', 'last', 'missing'])(
  'a protected or missing %s column cannot be deleted',
  async (kind) => {
    if (kind === 'last')
      vi.mocked(call).mockResolvedValue({
        ...snapshot,
        database: { ...snapshot.database, properties: [snapshot.database.properties[1]] },
      });
    await render(kind === 'last' ? 'score' : kind);
    expect(button('컬럼 삭제').disabled).toBe(true);
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await submit();
    expect(writes()).toHaveLength(0);
  },
);
