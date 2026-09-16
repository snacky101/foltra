// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call } from '../lib/api';
import type { Database, QueryResult, Row, Workspace } from '../lib/types';
import { NotePreview } from './NotePreview';

vi.mock('../lib/api', () => ({ call: vi.fn() }));
const database: Database = {
  id: 'db',
  name: 'Projects',
  createdAt: '2026-09-16',
  properties: [{ id: 'title', name: 'Name', type: 'text' }],
};
const row: Row = {
  id: 'row',
  databaseId: 'db',
  values: { title: 'Original' },
  bodyNoteId: 'body',
  createdAt: '2026-09-16',
  updatedAt: '2026-09-16',
  revision: 'r1',
};
const workspace = {
  path: '/temporary-vault',
  notes: [],
  databases: [database],
  records: [row],
} as unknown as Workspace;
const result: QueryResult = { database, rows: [row], total: 1, offset: 0, limit: 100 };
const body =
  'Before\n\n| Name |\n| --- |\n| [[Missing]] |\n\n```foltra-query\n{"databaseId":"db"}\n```\n\nAfter';
let root: Root;
let host: HTMLDivElement;
const render = (props: Partial<Parameters<typeof NotePreview>[0]> = {}) =>
  act(async () => {
    root.render(
      <NotePreview workspace={workspace} body={body} openNote={() => {}} openLink={() => {}} {...props} />,
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

test('unrelated edits and saved workspace snapshots retain tables and do not rerun queries', async () => {
  await render();
  const tables = [...host.querySelectorAll('table')];
  const link = host.querySelector('table .wiki-link')!;
  const openLink = vi.fn();
  const openNote = vi.fn();
  await render({ body: body.replace('Before', 'Edited before'), openLink, openNote });
  await render({ workspace: structuredClone(workspace), openLink, openNote });
  expect(call).toHaveBeenCalledTimes(1);
  expect(host.querySelectorAll('table')[0]).toBe(tables[0]);
  expect(host.querySelectorAll('table')[1]).toBe(tables[1]);
  expect(host.querySelector('table .wiki-link')).toBe(link);
  await act(async () => {
    (link as HTMLButtonElement).click();
    host.querySelector<HTMLButtonElement>('.embedded-query button')!.click();
  });
  expect(openLink).toHaveBeenCalledWith('Missing');
  expect(openNote).toHaveBeenCalledWith('body');
});

test.each(['record', 'schema'] as const)(
  '%s changes refresh query data without removing the visible table',
  async (change) => {
    await render();
    const table = host.querySelector('.embedded-query table');
    let finish!: (value: QueryResult) => void;
    vi.mocked(call).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const next = structuredClone(workspace);
    if (change === 'record') {
      next.records[0].values.title = 'Updated';
      next.records[0].revision = 'r2';
    } else {
      next.databases[0].properties[0].name = 'Project name';
    }
    await render({ workspace: next });
    expect(call).toHaveBeenCalledTimes(2);
    expect(host.querySelector('.embedded-query table')).toBe(table);
    expect(host.textContent).not.toContain('쿼리 불러오는 중');
    await act(async () => finish({ ...result, database: next.databases[0], rows: next.records }));
    expect(host.querySelector('.embedded-query table')).toBe(table);
    expect(table?.textContent).toContain(change === 'record' ? 'Updated' : 'Project name');
  },
);

test('a different query does not show the previous result or accept its late response', async () => {
  await render();
  expect(host.querySelector('.embedded-query table')).not.toBeNull();
  let finishOld!: (value: QueryResult) => void;
  let finishNew!: (value: QueryResult) => void;
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
  await render({ body: body.replace('"db"', '"other"') });
  expect(host.querySelector('.embedded-query table')).toBeNull();
  await render({ body: body.replace('"db"', '"third"') });
  await act(async () => finishOld(result));
  expect(host.querySelector('.embedded-query')?.textContent).toBe('쿼리 불러오는 중…');
  await act(async () => finishNew({ ...result, database: { ...database, id: 'third', name: 'Third' } }));
  expect(host.querySelector('.embedded-query')?.textContent).toContain('Third');
});

test('vault images load in reading mode and retain their element across unrelated edits', async () => {
  const path = `attachments/${'a'.repeat(64)}.png`;
  vi.mocked(call).mockResolvedValue({ path, mimeType: 'image/png', data: 'YWJj', width: 8, height: 4 });
  await render({ body: `![그림](../${path})\n\nText` });
  const image = host.querySelector('img')!;
  expect(image.alt).toBe('그림');
  expect(image.src).toBe('data:image/png;base64,YWJj');
  expect(call).toHaveBeenCalledWith(workspace.path, 'attachment.read', { path });
  await render({ body: `![그림](../${path})\n\nEdited text` });
  expect(host.querySelector('img')).toBe(image);
  expect(call).toHaveBeenCalledTimes(1);
});

test('missing local images have a readable fallback, remote and traversal images do not load', async () => {
  vi.mocked(call).mockRejectedValue(new Error('not found'));
  await render({
    body: `![missing](../attachments/${'b'.repeat(64)}.png)\n\n![remote](https://example.com/image.png)\n\n![escape](../../secret.png)`,
  });
  expect(host.querySelector('img')).toBeNull();
  expect(host.textContent).toContain('첨부 이미지를 찾거나 읽을 수 없습니다.');
  expect(host.querySelectorAll('.blocked-image')).toHaveLength(2);
  expect(call).toHaveBeenCalledTimes(1);
});
