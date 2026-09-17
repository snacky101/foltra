// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call } from '../lib/api';
import type { SqlCatalog } from '../lib/sqlQuery';
import type { Workspace } from '../lib/types';
import { AppDialogs } from './AppDialogs';

vi.mock('../lib/api', () => ({ call: vi.fn() }));
const workspace = { path: '/query-picker-vault', databases: [], notes: [] } as unknown as Workspace;
const catalog: SqlCatalog = {
  tables: [
    {
      databaseId: 'db',
      name: 'Reading room',
      columns: [
        { name: '이름', propertyId: 'title', type: 'text' },
        { name: '__id', propertyId: null, type: 'text' },
      ],
      sql: 'SELECT "이름" FROM "Reading room" LIMIT 25;',
    },
  ],
};
let host: HTMLDivElement;
let root: Root;
const insert = vi.fn();
const close = vi.fn();
const render = (next = workspace) =>
  act(async () => {
    root.render(
      <AppDialogs
        dialog={{ kind: 'query' }}
        workspace={next}
        close={close}
        insert={insert}
        openNote={() => {}}
        openDatabase={() => {}}
        refresh={async () => {}}
        onError={() => {}}
      />,
    );
  });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(call).mockReset().mockResolvedValue(catalog);
  insert.mockReset();
  close.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

test('query insertion uses named catalog SQL rather than an opaque database ID', async () => {
  await render();
  expect(call).toHaveBeenCalledWith(workspace.path, 'query.catalog');
  const choice = host.querySelector<HTMLButtonElement>('.choice-list button')!;
  expect(choice.textContent).toContain('Reading room');
  expect(choice.textContent).toContain('이름');
  expect(choice.textContent).not.toContain('__id');
  await act(async () => choice.click());
  expect(insert).toHaveBeenCalledWith(
    '\n\n```foltra-sql\nSELECT "이름" FROM "Reading room" LIMIT 25;\n```\n',
  );
  expect(close).toHaveBeenCalledOnce();
});

test('switching vaults removes the old picker choices and ignores a late catalog', async () => {
  let finishOld!: (value: SqlCatalog) => void;
  let finishNew!: (value: SqlCatalog) => void;
  vi.mocked(call)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNew = resolve;
        }),
    );
  await render();
  await render({ ...workspace, path: '/new-vault' });
  await act(async () => finishOld(catalog));
  expect(host.querySelector('.choice-list button')).toBeNull();
  await act(async () => finishNew({ tables: [] }));
  expect(host.textContent).toContain('먼저 데이터베이스를 만들어 주세요.');
});

test('catalog failures remain visible without inserting an invalid query', async () => {
  vi.mocked(call).mockRejectedValueOnce(new Error('Vault unavailable'));
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Vault unavailable');
  expect(insert).not.toHaveBeenCalled();
});
