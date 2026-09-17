// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call } from '../lib/api';
import type { SqlResult } from '../lib/sqlQuery';
import type { Workspace } from '../lib/types';
import { NotePreview } from './NotePreview';

vi.mock('../lib/api', () => ({ call: vi.fn() }));
const workspace = {
  path: '/temporary-vault',
  notes: [],
  databases: [{ id: 'db', name: 'Projects', properties: [] }],
  records: [{ id: 'record', revision: '1', values: { title: 'First' } }],
} as unknown as Workspace;
const result: SqlResult = {
  columns: [
    { name: 'Name', type: 'text' },
    { name: 'Count', type: 'int8' },
    { name: 'Name', type: 'text' },
  ],
  rows: [['<script>alert(1)</script>', '4', null]],
  truncated: false,
  limit: 500,
};
const sql = 'SELECT "Name", COUNT(*) FROM "Projects" GROUP BY "Name";';
const body = `Before\n\n\`\`\`foltra-sql\n${sql}\n\`\`\`\n\nAfter`;
let host: HTMLDivElement;
let root: Root;
const render = (props: Partial<Parameters<typeof NotePreview>[0]> = {}) =>
  act(async () => {
    root.render(
      <NotePreview body={body} workspace={workspace} openNote={() => {}} openLink={() => {}} {...props} />,
    );
  });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(call).mockReset().mockResolvedValue(result);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

test.each(['foltra-sql', 'foltra-query'])(
  '%s executes raw SQL and renders arbitrary duplicate columns safely',
  async (language) => {
    await render({ body: body.replace('foltra-sql', language) });
    expect(call).toHaveBeenCalledWith(workspace.path, 'query.sql', { sql: `${sql}\n` });
    expect([...host.querySelectorAll('th')].map((cell) => cell.textContent)).toEqual([
      'Name',
      'Count',
      'Name',
    ]);
    expect([...host.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual([
      '<script>alert(1)</script>',
      '4',
      'NULL',
    ]);
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain('1개 행');
  },
);

test.each(['sql', 'postgresql', 'PostgreSQL'])('%s code examples never execute queries', async (language) => {
  await render({ body: body.replace('foltra-sql', language) });
  expect(call).not.toHaveBeenCalled();
  expect(host.querySelector('code')?.textContent).toBe(`${sql}\n`);
});

test.each(['foltra-sql', 'foltra-query'])(
  'executeQueries=false leaves %s snippets as source',
  async (language) => {
    await render({ body: body.replace('foltra-sql', language), executeQueries: false });
    expect(call).not.toHaveBeenCalled();
    expect(host.querySelector('code')?.textContent).toBe(`${sql}\n`);
  },
);

test('note edits and equal workspace snapshots keep the SQL result table and avoid refetching', async () => {
  await render();
  const table = host.querySelector('table');
  await render({ body: body.replace('Before', 'Edited before') });
  await render({
    workspace: { ...structuredClone(workspace), notes: [{ id: 'note', revision: '2' }] } as Workspace,
  });
  expect(call).toHaveBeenCalledTimes(1);
  expect(host.querySelector('table')).toBe(table);
});

test.each(['records', 'databases'] as const)(
  '%s changes refresh SQL while the table stays visible',
  async (field) => {
    await render();
    const table = host.querySelector('table');
    let finish!: (value: SqlResult) => void;
    vi.mocked(call).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const next = structuredClone(workspace);
    if (field === 'records') next.records[0].revision = '2';
    else next.databases[0].name = 'Renamed projects';
    await render({ workspace: next });
    expect(call).toHaveBeenCalledTimes(2);
    expect(host.querySelector('table')).toBe(table);
    await act(async () => finish({ ...result, rows: [['Updated', '5', '']] }));
    expect(host.querySelector('table')).toBe(table);
    expect(host.querySelector('td')?.textContent).toBe('Updated');
    expect(host.querySelectorAll('td')[2].textContent).toBe('');
  },
);

test.each(['source', 'vault'] as const)(
  'changing %s hides previous data and ignores late responses',
  async (change) => {
    await render();
    let finishOld!: (value: SqlResult) => void;
    let finishNew!: (value: SqlResult) => void;
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
    const changed = structuredClone(workspace);
    changed.records[0].revision = '2';
    await render({ workspace: changed });
    await render(
      change === 'source'
        ? { body: body.replace(sql, 'SELECT 123;'), workspace: changed }
        : { workspace: { ...changed, path: '/other-vault' } },
    );
    expect(host.querySelector('table')).toBeNull();
    await act(async () => finishOld(result));
    expect(host.querySelector('table')).toBeNull();
    await act(async () => finishNew({ ...result, rows: [['New result', '0', null]] }));
    expect(host.textContent).toContain('New result');
    expect(host.textContent).not.toContain('alert(1)');
  },
);

test('SQL errors are displayed and a corrected query can render empty or limited results', async () => {
  vi.mocked(call).mockRejectedValueOnce(new Error('Unknown column: Wrong'));
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Unknown column: Wrong');
  vi.mocked(call).mockResolvedValueOnce({ ...result, rows: [] });
  await render({ body: body.replace(sql, 'SELECT 1 WHERE false;') });
  expect(host.textContent).toContain('조건에 맞는 결과가 없습니다.');
  expect(host.querySelector('[role="alert"]')).toBeNull();
  vi.mocked(call).mockResolvedValueOnce({ ...result, truncated: true });
  await render({ body: body.replace(sql, 'SELECT 1;') });
  expect(host.textContent).toContain('처음 1개 행');
  expect(host.textContent).toContain('최대 500개 행');
});
