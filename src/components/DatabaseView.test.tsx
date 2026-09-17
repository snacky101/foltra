// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call } from '../lib/api';
import { fontFamilyStack } from '../lib/fontFamily';
import type { Database, Row, Workspace } from '../lib/types';
import { DatabaseView } from './DatabaseView';
import { createBuiltinCommands, type BuiltinCommandId } from '../lib/builtinCommands';
import { useCommandKeys } from '../lib/useCommandKeys';
import { moveWorkspaceFocus, rememberWorkspaceFocus } from '../lib/workspaceFocus';

vi.mock('../lib/api', () => ({ call: vi.fn() }));
const database: Database = {
  id: 'db',
  name: 'Tasks',
  createdAt: '',
  properties: [
    { id: 'title', name: 'Name', type: 'text' },
    { id: 'score', name: 'Score', type: 'number' },
    { id: 'status', name: 'Status', type: 'status', options: ['Todo', 'Done'] },
  ],
};
const rows: Row[] = ['Bravo', 'Alpha', 'Charlie'].map((title, index) => ({
  id: `r${index}`,
  databaseId: database.id,
  values: { title, score: index, status: 'Todo' },
  bodyNoteId: null,
  createdAt: '',
  updatedAt: '',
  revision: `rev${index}`,
}));
type Props = ComponentProps<typeof DatabaseView>;
let host: HTMLDivElement, root: Root, props: Props;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.mocked(call).mockReset().mockResolvedValue({ database, rows, total: 205, limit: 100, offset: 0 });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  props = {
    vault: '/disposable',
    database,
    workspace: { vault: { id: 'vault' }, records: rows, settings: { vim: true } } as Workspace,
    refresh: vi.fn().mockResolvedValue(undefined),
    openBody: vi.fn(),
    addProperty: vi.fn(),
    editProperty: vi.fn(),
    deleteProperty: vi.fn(),
    onError: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function settle() {
  await act(async () => {
    await vi.runOnlyPendingTimersAsync();
  });
}
async function render() {
  await act(async () => root.render(<DatabaseView {...props} />));
  await settle();
}
const header = (id: string) =>
  host.querySelector<HTMLButtonElement>(`th[data-property-id="${id}"] .column-heading`)!;
const query = () =>
  vi
    .mocked(call)
    .mock.calls.filter(([, command]) => command === 'query.run')
    .at(-1)![2];
const row = (index: number) => host.querySelectorAll<HTMLTableRowElement>('tbody tr')[index];
const orderKey = 'foltra:column-order:vault:db';
const headerOrder = () =>
  [...host.querySelectorAll<HTMLElement>('thead th[data-property-id]')].map(
    (item) => item.dataset.propertyId,
  );
function storedLayout(entries: Record<string, string> = {}) {
  const storage = new Map(Object.entries(entries));
  vi.mocked(localStorage.getItem).mockImplementation((key) => storage.get(key) ?? null);
  vi.mocked(localStorage.setItem).mockImplementation((key, value) => void storage.set(key, value));
  return storage;
}
function columnDragData() {
  const values = new Map<string, string>();
  return {
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    get types() {
      return [...values.keys()];
    },
    getData: (type: string) => values.get(type) ?? '',
    setData: (type: string, value: string) => void values.set(type, value),
    setDragImage: vi.fn(),
  };
}
async function dragEvent(
  target: HTMLElement,
  type: string,
  data: ReturnType<typeof columnDragData>,
  x = 150,
) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 20 });
  Object.defineProperty(event, 'dataTransfer', { value: data });
  await act(async () => target.dispatchEvent(event));
  return event;
}
async function dragColumn(source: string, target: string, placement: 'before' | 'after') {
  const data = columnDragData();
  const button = header(source);
  const th = header(target).closest('th')!;
  vi.spyOn(th, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    right: 300,
    width: 200,
    top: 0,
    bottom: 40,
    height: 40,
    x: 100,
    y: 0,
    toJSON: () => ({}),
  });
  const x = placement === 'before' ? 150 : 250;
  await dragEvent(button, 'dragstart', data);
  await dragEvent(th, 'dragover', data, x);
  await dragEvent(th, 'drop', data, x);
  await dragEvent(button, 'dragend', data, x);
  await settle();
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
  await settle();
}
async function key(element: HTMLElement, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  await act(async () => element.dispatchEvent(event));
  return event;
}
async function chooseSort(value: string) {
  await click(host.querySelector<HTMLElement>('[aria-label="정렬 기준"]')!);
  const option = [...host.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (item) => item.textContent === value,
  )!;
  await click(option);
}

function PaneHarness() {
  const commands = createBuiltinCommands({} as Record<BuiltinCommandId, () => void>);
  commands.find((command) => command.id === 'focus.right')!.run = () => moveWorkspaceFocus('right');
  commands.find((command) => command.id === 'focus.left')!.run = () => moveWorkspaceFocus('left');
  useCommandKeys(
    commands,
    { ...props.workspace.settings, leader: ' ', keybindings: {} },
    'NORMAL',
    false,
    props.onError,
  );
  return (
    <div onFocusCapture={(event) => rememberWorkspaceFocus(event.target)}>
      <aside data-focus-region="sidebar-tree">
        <button data-tree-item aria-label="Sidebar database">
          Database
        </button>
      </aside>
      <div data-focus-region="main">
        <DatabaseView {...props} />
      </div>
    </div>
  );
}
async function panes() {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  await act(async () => root.render(<PaneHarness />));
  await settle();
}
async function enterDatabase() {
  const sidebar = host.querySelector<HTMLButtonElement>('[data-tree-item]')!;
  await act(async () => sidebar.focus());
  await key(sidebar, 'ㅣ', { ctrlKey: true, code: 'KeyL', keyCode: 229 });
}

test.each([null, '.database-title', '[aria-label="DB 항목 검색"]'])(
  'pane entry prefers the first database row over previous %s',
  async (previous) => {
    await panes();
    if (previous) await act(async () => host.querySelector<HTMLElement>(previous)!.focus());
    await enterDatabase();
    expect(document.activeElement).toBe(row(0));
    await key(row(0), 'ㅓ', { code: 'KeyJ', keyCode: 229 });
    expect(document.activeElement).toBe(row(1));
    await key(row(1), 'Enter');
    expect(props.openBody).toHaveBeenCalledWith(rows[1]);
    expect(
      vi
        .mocked(call)
        .mock.calls.some(([, command]) => command === 'record.create' || command === 'record.update'),
    ).toBe(false);
  },
);

test.each(['', 'input', '.row-menu-button'])(
  'pane return restores the previous database row rather than its %s control',
  async (control) => {
    await panes();
    const target = control ? row(1).querySelector<HTMLElement>(control)! : row(1);
    await act(async () => target.focus());
    await key(target, 'h', { ctrlKey: true, code: 'KeyH' });
    await enterDatabase();
    expect(document.activeElement).toBe(row(1));
  },
);

test('empty database pane entry focuses add-row without creating a record or editing its title', async () => {
  vi.mocked(call).mockResolvedValue({ database, rows: [], total: 0, limit: 100, offset: 0 });
  await panes();
  await enterDatabase();
  expect(document.activeElement).toBe(host.querySelector('.new-row'));
  expect(
    vi
      .mocked(call)
      .mock.calls.some(([, command]) => command === 'record.create' || command === 'database.inspect'),
  ).toBe(false);
});

test('pane return falls back to the first row when the remembered row leaves the result', async () => {
  await panes();
  await act(async () => row(1).querySelector('input')!.focus());
  await act(async () => host.querySelector<HTMLButtonElement>('[data-tree-item]')!.focus());
  const remaining = [rows[0], rows[2]];
  vi.mocked(call).mockResolvedValue({ database, rows: remaining, total: 2, limit: 100, offset: 0 });
  props.workspace = { ...props.workspace, records: remaining };
  await act(async () => root.render(<PaneHarness />));
  await settle();
  await enterDatabase();
  expect(document.activeElement).toBe(row(0));
});

test('pane entry and row arrow navigation also work with Vim disabled', async () => {
  props.workspace.settings.vim = false;
  await panes();
  await enterDatabase();
  expect(document.activeElement).toBe(row(0));
  await key(row(0), 'ArrowDown');
  expect(document.activeElement).toBe(row(1));
});

test('database typography follows settings across views without changing the query or records', async () => {
  await render();
  const fontSize = () =>
    host.querySelector<HTMLElement>('.database-view')!.style.getPropertyValue('--database-font-size');
  expect(fontSize()).toBe('14px');
  await click(header('score'));
  const calls = vi.mocked(call).mock.calls.length;
  props.workspace = {
    ...props.workspace,
    settings: { ...props.workspace.settings, databaseFontSize: 20, databaseFontFamily: 'Noto Sans KR' },
  };
  await render();
  expect(fontSize()).toBe('20px');
  expect(
    host.querySelector<HTMLElement>('.database-view')!.style.getPropertyValue('--database-font-family'),
  ).toBe(fontFamilyStack('Noto Sans KR'));
  expect(header('score').closest('th')?.getAttribute('aria-sort')).toBe('ascending');
  for (const [label, selector] of [
    ['보드', '.board-card'],
    ['타임라인', '.timeline-entry'],
  ]) {
    await click(
      [...host.querySelectorAll<HTMLElement>('.view-tabs button')].find((tab) => tab.textContent === label)!,
    );
    expect(fontSize()).toBe('20px');
    expect(host.querySelectorAll(selector)).toHaveLength(rows.length);
  }
  props.workspace = {
    ...props.workspace,
    settings: { ...props.workspace.settings, databaseFontSize: 12, databaseFontFamily: '' },
  };
  await render();
  expect(fontSize()).toBe('12px');
  expect(
    host.querySelector<HTMLElement>('.database-view')!.style.getPropertyValue('--database-font-family'),
  ).toBe('');
  expect(vi.mocked(call).mock.calls).toHaveLength(calls);
});

test('header sorting cycles ascending, descending and creation order without opening the property editor', async () => {
  props.initialQuery = { databaseId: 'db', filters: [{ property: 'status', op: 'eq', value: 'Todo' }] };
  await render();
  expect(query()).not.toHaveProperty('sort');
  for (const [direction, descending] of [
    ['ascending', false],
    ['descending', true],
  ] as const) {
    await click(header('score'));
    expect(query()).toMatchObject({
      sort: 'score',
      descending,
      offset: 0,
      filters: props.initialQuery.filters,
    });
    expect(header('score').closest('th')?.getAttribute('aria-sort')).toBe(direction);
    expect(host.querySelector('[aria-label="정렬 기준"]')?.textContent).toContain('Score 순');
    expect(header('score').querySelector('.column-sort-arrow')).not.toBeNull();
  }
  await click(header('score'));
  expect(query()).not.toHaveProperty('sort');
  expect(query()).not.toHaveProperty('descending');
  expect(header('score').closest('th')?.getAttribute('aria-sort')).toBe('none');
  expect(host.querySelector('[aria-label="정렬 기준"]')?.textContent).toContain('생성 순서');
  expect(props.editProperty).not.toHaveBeenCalled();
});

test('database marks the body column with a note badge', async () => {
  await render();
  expect(header('title').querySelector('.column-role')?.textContent).toBe('노트');
  expect(header('score').querySelector('.column-role')).toBeNull();
  expect(header('status').querySelector('.column-role')).toBeNull();
  expect(host.querySelector('.database-primary-key')).toBeNull();
  expect(host.querySelector('th.row-index')?.textContent).toBe('#');
  expect(header('title').getAttribute('aria-description')).toBe('각 행의 노트를 만들거나 여는 컬럼입니다.');
});

test('renamed title retains its body role and sorts by its unchanged property ID', async () => {
  props.database = {
    ...database,
    properties: database.properties.map((property) =>
      property.id === 'title' ? { ...property, name: '새 제목' } : property,
    ),
  };
  await render();
  expect(header('title').getAttribute('aria-label')).toBe('새 제목 정렬');
  expect(header('title').querySelector('.column-role')?.textContent).toBe('노트');
  await click(header('title'));
  expect(query()).toMatchObject({ sort: 'title' });
  await click(row(0).querySelector<HTMLElement>('[data-property-id="title"] .body-link')!);
  expect(props.openBody).toHaveBeenCalledExactlyOnceWith(rows[0]);
  await key(header('title'), 'ContextMenu');
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  expect(items.some((item) => item.textContent === '컬럼 삭제')).toBe(false);
  await click(items.find((item) => item.textContent === '속성 편집')!);
  expect(props.editProperty).toHaveBeenCalledExactlyOnceWith(props.database.properties[0]);
});

test.each([
  [{ id: 'text', name: 'Description', type: 'text' as const }, database.properties[1]],
  [database.properties[1], database.properties[2]],
])(
  'legacy databases mark the actual fallback body column without claiming it is a title or primary key',
  async (...properties) => {
    props.database = { ...database, properties };
    await render();
    expect(header(properties[0].id).querySelector('.column-role')?.textContent).toBe('노트');
    expect(header(properties[1].id).querySelector('.column-role')).toBeNull();
    expect(row(0).querySelector('.body-link')?.closest('td')?.dataset.propertyId).toBe(properties[0].id);
  },
);

test('column context menus request deletion while protecting title and the last remaining property', async () => {
  await render();
  const deletion = () =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.textContent === '컬럼 삭제',
    );
  await key(header('score'), 'F10', { shiftKey: true });
  expect(deletion()?.classList.contains('note-menu-delete')).toBe(true);
  await click(deletion()!);
  expect(props.deleteProperty).toHaveBeenCalledExactlyOnceWith(database.properties[1]);
  expect(props.editProperty).not.toHaveBeenCalled();
  expect(query()).not.toHaveProperty('sort');
  await key(header('title'), 'F10', { shiftKey: true });
  expect(deletion()).toBeUndefined();
  await key(document.querySelector<HTMLElement>('[role="menu"]')!, 'Escape');
  props.database = { ...database, properties: [database.properties[1]] };
  await render();
  await key(header('score'), 'F10', { shiftKey: true });
  expect(deletion()).toBeUndefined();
});

test('toolbar and header share sort direction and reset pagination for every sort change', async () => {
  await render();
  const next = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent === '다음',
  )!;
  await click(next);
  expect(query()).toMatchObject({ offset: 100 });
  await click(header('score'));
  expect(query()).toMatchObject({ sort: 'score', descending: false, offset: 0 });
  await click(next);
  await click(host.querySelector<HTMLElement>('[aria-label="정렬 방향: 오름차순"]')!);
  expect(query()).toMatchObject({ sort: 'score', descending: true, offset: 0 });
  expect(header('score').closest('th')?.getAttribute('aria-sort')).toBe('descending');
  await click(next);
  await chooseSort('Name 순');
  expect(query()).toMatchObject({ sort: 'title', descending: false, offset: 0 });
  expect(header('score').closest('th')?.getAttribute('aria-sort')).toBe('none');
  expect(header('title').closest('th')?.getAttribute('aria-sort')).toBe('ascending');
  await chooseSort('생성 순서');
  expect(query()).not.toHaveProperty('sort');
});

test('context and keyboard menus edit the chosen current property without sorting', async () => {
  await render();
  const button = header('score');
  const calls = vi.mocked(call).mock.calls.length;
  await act(async () =>
    button.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 70, clientY: 40 }),
    ),
  );
  expect(document.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('Score 메뉴');
  expect(props.editProperty).not.toHaveBeenCalled();
  await key(document.activeElement as HTMLElement, 'Escape');
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(button);
  expect((await key(button, 'F10', { shiftKey: true })).defaultPrevented).toBe(true);
  props.database = {
    ...database,
    properties: database.properties.map((property) =>
      property.id === 'score' ? { ...property, name: 'Updated score' } : property,
    ),
  };
  await act(async () => root.render(<DatabaseView {...props} />));
  await click(document.querySelector<HTMLElement>('[role="menuitem"]')!);
  expect(props.editProperty).toHaveBeenCalledExactlyOnceWith(props.database.properties[1]);
  expect(query()).not.toHaveProperty('sort');
  expect(
    vi
      .mocked(call)
      .mock.calls.slice(calls)
      .every(([, command]) => command === 'query.run'),
  ).toBe(true);
});

test('removing the sorted column closes its menu and never queries a deleted property', async () => {
  await render();
  await click(header('score'));
  await key(header('score'), 'ContextMenu');
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  vi.mocked(call).mockClear();
  props.database = {
    ...database,
    properties: database.properties.filter((property) => property.id !== 'score'),
  };
  await render();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(host.querySelector('[data-property-id="score"]')).toBeNull();
  expect(
    vi
      .mocked(call)
      .mock.calls.every(([, command, args]) => command !== 'query.run' || !('sort' in (args ?? {}))),
  ).toBe(true);
  expect(props.editProperty).not.toHaveBeenCalled();
});

test('a database switch dismisses the old column menu and starts with unsorted first-page rows', async () => {
  await render();
  await click(header('score'));
  await key(header('score'), 'ContextMenu');
  vi.mocked(call).mockClear();
  props.database = { ...database, id: 'other-db', name: 'Other database' };
  await render();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(query()).toMatchObject({ databaseId: 'other-db', offset: 0 });
  expect(query()).not.toHaveProperty('sort');
  expect(props.editProperty).not.toHaveBeenCalled();
});

test('column resize, reset and keyboard resizing neither sort nor edit a property', async () => {
  await render();
  const handle = host.querySelector<HTMLElement>('[aria-label="Score 컬럼 너비"]')!;
  handle.setPointerCapture = vi.fn();
  handle.hasPointerCapture = vi.fn(() => true);
  handle.releasePointerCapture = vi.fn();
  const pointer = (type: string, x: number) =>
    handle.dispatchEvent(new MouseEvent(type, { button: 0, clientX: x, bubbles: true, cancelable: true }));
  const calls = vi.mocked(call).mock.calls.length;
  await act(async () => {
    pointer('pointerdown', 200);
    pointer('pointermove', 260);
    pointer('pointerup', 260);
    handle.click();
  });
  expect(handle.getAttribute('aria-valuenow')).toBe('230');
  expect(host.querySelector('.column-resizing')).toBeNull();
  await key(handle, 'ArrowLeft');
  expect(handle.getAttribute('aria-valuenow')).toBe('220');
  await act(async () => handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(handle.getAttribute('aria-valuenow')).toBe('170');
  expect(vi.mocked(call).mock.calls.length).toBe(calls);
  expect(props.editProperty).not.toHaveBeenCalled();
  expect(header('score').closest('th')?.getAttribute('aria-sort')).toBe('none');
});

test('dragging the title column moves matching cells and widths, preserves body links, and survives remount', async () => {
  const storage = storedLayout({
    'foltra:column-widths:vault:db': JSON.stringify({ title: 315, score: 185, status: 210 }),
  });
  const original = JSON.stringify(database);
  await render();
  expect(header('title').draggable).toBe(true);
  await dragColumn('title', 'status', 'after');
  expect(headerOrder()).toEqual(['score', 'status', 'title']);
  expect(
    [...row(0).querySelectorAll<HTMLElement>('td[data-property-id]')].map((cell) => cell.dataset.propertyId),
  ).toEqual(['score', 'status', 'title']);
  expect([...host.querySelectorAll<HTMLTableColElement>('col')].map((col) => col.style.width)).toEqual([
    '34px',
    '185px',
    '210px',
    '315px',
  ]);
  expect(header('title').querySelector('.column-role')?.textContent).toBe('노트');
  await click(row(0).querySelector<HTMLElement>('[data-property-id="title"] .body-link')!);
  expect(props.openBody).toHaveBeenCalledExactlyOnceWith(rows[0]);
  expect(JSON.parse(storage.get(orderKey)!)).toEqual(['score', 'status', 'title']);
  expect(JSON.stringify(database)).toBe(original);
  expect(vi.mocked(call).mock.calls.every(([, command]) => command === 'query.run')).toBe(true);
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  expect(headerOrder()).toEqual(['score', 'status', 'title']);
  await dragColumn('title', 'score', 'before');
  expect(headerOrder()).toEqual(['title', 'score', 'status']);
});

test('column display order changes preserve search, filter, sorting and the current page', async () => {
  storedLayout();
  await render();
  await click(host.querySelector<HTMLElement>('[aria-label="상태 필터"]')!);
  await click(
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (item) => item.textContent === 'Todo',
    )!,
  );
  const search = host.querySelector<HTMLInputElement>('[aria-label="DB 항목 검색"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'Bravo');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  await click(header('score'));
  await click(
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === '다음')!,
  );
  const before = query();
  expect(before).toMatchObject({
    sort: 'score',
    descending: false,
    offset: 100,
    filters: [
      { property: 'status', op: 'eq', value: 'Todo' },
      { property: 'title', op: 'contains', value: 'Bravo' },
    ],
  });
  await dragColumn('score', 'title', 'before');
  expect(headerOrder()).toEqual(['score', 'title', 'status']);
  expect(query()).toEqual(before);
  expect(search.value).toBe('Bravo');
  expect(header('score').closest('th')?.getAttribute('aria-sort')).toBe('ascending');
  expect(host.querySelector('[aria-label="상태 필터"]')?.textContent).toBe('Todo');
});

test('switching databases and vaults reads their own saved column order without overwriting either layout', async () => {
  const secondKey = 'foltra:column-order:vault:other';
  const thirdKey = 'foltra:column-order:other-vault:other';
  const storage = storedLayout({
    [orderKey]: '["status","title","score"]',
    [secondKey]: '["score","status","title"]',
    [thirdKey]: '["title","status","score"]',
  });
  await render();
  expect(headerOrder()).toEqual(['status', 'title', 'score']);
  props.database = { ...database, id: 'other' };
  await render();
  expect(headerOrder()).toEqual(['score', 'status', 'title']);
  props.vault = '/other-disposable';
  props.workspace = { ...props.workspace, vault: { ...props.workspace.vault, id: 'other-vault' } };
  await render();
  expect(headerOrder()).toEqual(['title', 'status', 'score']);
  expect(JSON.parse(storage.get(orderKey)!)).toEqual(['status', 'title', 'score']);
  expect(JSON.parse(storage.get(secondKey)!)).toEqual(['score', 'status', 'title']);
  expect(JSON.parse(storage.get(thirdKey)!)).toEqual(['title', 'status', 'score']);
});

test('saved layout reconciles schema changes while keeping renamed properties and canonical fallback roles', async () => {
  storedLayout({ [orderKey]: '["score","title","status"]' });
  await render();
  props.database = {
    ...database,
    properties: [
      { ...database.properties[0], name: 'Renamed' },
      database.properties[2],
      { id: 'added', name: 'Added', type: 'text' },
    ],
  };
  await render();
  expect(headerOrder()).toEqual(['title', 'status', 'added']);
  expect(header('title').getAttribute('aria-label')).toBe('Renamed 정렬');
  expect(header('title').querySelector('.column-role')?.textContent).toBe('노트');
  props.database = {
    ...database,
    id: 'legacy',
    properties: [
      { id: 'first', name: 'First', type: 'text' },
      { id: 'second', name: 'Second', type: 'text' },
      database.properties[2],
      { id: 'otherStatus', name: 'Other state', type: 'status', options: ['Other'] },
    ],
  };
  await render();
  await dragColumn('first', 'otherStatus', 'after');
  await dragColumn('status', 'first', 'after');
  expect(header('first').querySelector('.column-role')?.textContent).toBe('노트');
  expect(row(0).querySelector('.body-link')?.closest('td')?.dataset.propertyId).toBe('first');
  await click(host.querySelector<HTMLElement>('[aria-label="상태 필터"]')!);
  const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')].map(
    (item) => item.textContent,
  );
  expect(options).toContain('Todo');
  expect(options).not.toContain('Other');
});

test('foreign, cancelled and self drops leave the column layout untouched', async () => {
  const storage = storedLayout();
  await render();
  const data = columnDragData();
  data.setData('application/x-foltra-column', `${orderKey}:title`);
  await dragEvent(header('status').closest('th')!, 'dragover', data);
  await dragEvent(header('status').closest('th')!, 'drop', data);
  expect(headerOrder()).toEqual(['title', 'score', 'status']);
  await dragEvent(header('title'), 'dragstart', data);
  await dragEvent(header('status').closest('th')!, 'dragover', data);
  await dragEvent(header('title'), 'dragend', data);
  await dragEvent(header('status').closest('th')!, 'drop', data);
  expect(headerOrder()).toEqual(['title', 'score', 'status']);
  await dragColumn('score', 'score', 'after');
  expect(headerOrder()).toEqual(['title', 'score', 'status']);
  expect(
    storage.get(orderKey) === undefined ||
      JSON.parse(storage.get(orderKey)!).join(',') === 'title,score,status',
  ).toBe(true);
  expect(query()).not.toHaveProperty('sort');
  expect(props.editProperty).not.toHaveBeenCalled();
});

test('reordering neither sorts on drag nor prevents a later header click or column resize', async () => {
  storedLayout();
  await render();
  await dragColumn('score', 'status', 'after');
  expect(query()).not.toHaveProperty('sort');
  await act(async () =>
    header('score').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })),
  );
  await click(header('score'));
  expect(query()).toMatchObject({ sort: 'score', descending: false });
  const handle = host.querySelector<HTMLElement>('[aria-label="Score 컬럼 너비"]')!;
  await key(handle, 'ArrowRight');
  expect(handle.getAttribute('aria-valuenow')).toBe('180');
  expect(headerOrder()).toEqual(['title', 'status', 'score']);
  expect(header('score').closest('th')?.getAttribute('aria-sort')).toBe('ascending');
});

test('an in-flight drag cannot reorder another database or accept a mismatched payload', async () => {
  storedLayout();
  await render();
  const data = columnDragData();
  await dragEvent(header('title'), 'dragstart', data);
  data.setData('application/x-foltra-column', 'other-vault:other-column');
  await dragEvent(header('status').closest('th')!, 'drop', data);
  expect(headerOrder()).toEqual(['title', 'score', 'status']);
  await dragEvent(header('title'), 'dragend', data);
  await dragEvent(header('title'), 'dragstart', data);
  props.database = { ...database, id: 'other' };
  await render();
  await dragEvent(header('status').closest('th')!, 'dragover', data);
  await dragEvent(header('status').closest('th')!, 'drop', data);
  expect(headerOrder()).toEqual(['title', 'score', 'status']);
  expect(host.querySelector('.column-dragging')).toBeNull();
  expect(host.querySelector('[data-drop-placement]')).toBeNull();
});

test('a storage failure reports the error without applying an unsaved column layout', async () => {
  storedLayout();
  await render();
  const error = new Error('Storage is full');
  vi.mocked(localStorage.setItem).mockImplementation(() => {
    throw error;
  });
  await dragColumn('title', 'status', 'after');
  expect(headerOrder()).toEqual(['title', 'score', 'status']);
  expect(props.onError).toHaveBeenCalledExactlyOnceWith(error);
  expect(host.querySelector('.column-dragging')).toBeNull();
  expect(host.querySelector('[data-drop-placement]')).toBeNull();
});

test('column context-menu movement respects boundaries and keeps focus on the moved header', async () => {
  storedLayout();
  await render();
  header('title').focus();
  await key(header('title'), 'ContextMenu');
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  expect(items.some((item) => item.textContent === '왼쪽으로 이동')).toBe(false);
  await click(items.find((item) => item.textContent === '오른쪽으로 이동')!);
  expect(headerOrder()).toEqual(['score', 'title', 'status']);
  expect(document.activeElement).toBe(header('title'));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(query()).not.toHaveProperty('sort');
  header('status').focus();
  await key(header('status'), 'ContextMenu');
  const lastItems = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  expect(lastItems.some((item) => item.textContent === '오른쪽으로 이동')).toBe(false);
  await click(lastItems.find((item) => item.textContent === '왼쪽으로 이동')!);
  expect(headerOrder()).toEqual(['score', 'status', 'title']);
});

test.each([
  ['j', 'KeyJ', false, 1],
  ['ㅓ', 'KeyJ', false, 1],
  ['Process', 'KeyJ', true, 1],
  ['ㅏ', 'KeyK', true, -1],
  ['Unidentified', 'KeyK', false, -1],
  ['Dead', 'KeyJ', true, 1],
] as const)('Vim row navigation handles %s/%s/composing=%s', async (pressed, code, composing, direction) => {
  await render();
  row(1).focus();
  const event = await key(row(1), pressed, { code, isComposing: composing });
  expect(event.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(row(1 + direction));
  expect(props.openBody).not.toHaveBeenCalled();
});

test('modified keys, unknown composition and input fields retain their original behavior', async () => {
  await render();
  for (const options of [{ shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
    row(1).focus();
    expect((await key(row(1), 'ㅓ', { code: 'KeyJ', ...options })).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(row(1));
  }
  expect((await key(row(1), 'Process', { code: '', isComposing: true })).defaultPrevented).toBe(false);
  await key(row(1), 'Enter', { isComposing: true });
  expect(props.openBody).not.toHaveBeenCalled();
  const input = row(1).querySelector<HTMLInputElement>('input')!;
  input.focus();
  expect((await key(input, 'Process', { code: 'KeyJ', isComposing: true })).defaultPrevented).toBe(false);
  expect((await key(input, 'ㅏ', { code: 'KeyK' })).defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('Alpha');
});

test('Vim off leaves letters alone and arrow keys continue to navigate rows', async () => {
  props.workspace = { ...props.workspace, settings: { ...props.workspace.settings, vim: false } };
  await render();
  row(0).focus();
  expect((await key(row(0), 'ㅓ', { code: 'KeyJ' })).defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(row(0));
  expect((await key(row(0), 'ArrowDown')).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(row(1));
});

test.each([
  ['Enter', { isComposing: true }],
  ['Enter', { keyCode: 229 }],
  ['Escape', { isComposing: true }],
  ['Escape', { keyCode: 229 }],
] as const)(
  'cell %s with IME signal %j preserves the draft and focus until composition ends',
  async (pressed, signal) => {
    await render();
    const input = row(0).querySelector<HTMLInputElement>('[data-property-id="title"] input')!;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '작성 중');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await key(input, pressed, signal);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('작성 중');
    expect(vi.mocked(call).mock.calls.filter(([, command]) => command === 'record.update')).toEqual([]);
    await key(input, 'Enter');
    expect(document.activeElement).not.toBe(input);
    expect(vi.mocked(call).mock.calls.filter(([, command]) => command === 'record.update')).toEqual([
      ['/disposable', 'record.update', { id: 'r0', expectedRevision: 'rev0', values: { title: '작성 중' } }],
    ]);
  },
);

test.each([{ isComposing: true }, { keyCode: 229 }])(
  'date cell Enter with IME signal %j does not commit until composition ends',
  async (signal) => {
    props.database = {
      ...database,
      properties: [...database.properties, { id: 'date', name: 'Date', type: 'date' }],
    };
    await render();
    const input = row(0).querySelector<HTMLInputElement>('[data-property-id="date"] input')!;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2026-09-17');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await key(input, 'Enter', signal);
    expect(document.activeElement).toBe(input);
    expect(vi.mocked(call).mock.calls.filter(([, command]) => command === 'record.update')).toEqual([]);
    await key(input, 'Enter');
    expect(vi.mocked(call).mock.calls.filter(([, command]) => command === 'record.update')).toEqual([
      [
        '/disposable',
        'record.update',
        { id: 'r0', expectedRevision: 'rev0', values: { date: '2026-09-17' } },
      ],
    ]);
  },
);

test.each([{ isComposing: true }, { keyCode: 229 }])(
  'date cell Escape with IME signal %j keeps the calendar and input focus',
  async (signal) => {
    props.database = {
      ...database,
      properties: [...database.properties, { id: 'date', name: 'Date', type: 'date' }],
    };
    await render();
    await click(row(0).querySelector<HTMLElement>('[aria-label="Date Bravo 달력 열기"]')!);
    const input = row(0).querySelector<HTMLInputElement>('[data-property-id="date"] input')!;
    await act(async () => input.focus());
    await key(input, 'Escape', signal);
    expect(host.querySelector('.date-calendar')).not.toBeNull();
    expect(document.activeElement).toBe(input);
    await key(input, 'Escape');
    expect(host.querySelector('.date-calendar')).toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Date Bravo 달력 열기');
  },
);
