// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PluginView } from './PluginView';
import type { PluginNode } from '../lib/pluginTypes';
import { calendarMonth } from '../lib/calendar';
import { moveSidebarFocus, moveWorkspaceFocus, rememberWorkspaceFocus } from '../lib/workspaceFocus';

const calendar: PluginNode = {
  type: 'calendar',
  month: '2026-09',
  today: '2026-09-17',
  markedDates: ['2026-09-03', '2026-09-17'],
  action: 'select-date',
  previousAction: 'previous-month',
  nextAction: 'next-month',
  todayAction: 'today',
};
let root: Root, host: HTMLElement;
let action: ReturnType<typeof vi.fn<(id: string, value?: string | boolean) => Promise<void>>>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([
    new DOMRect(0, 0, 200, 250),
  ] as unknown as DOMRectList);
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement('aside');
  host.dataset.focusRegion = 'backlinks';
  document.body.append(host);
  root = createRoot(host);
  action = vi.fn().mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
const render = (node = calendar) =>
  act(async () =>
    root.render(
      <PluginView embedded title="일지 캘린더" tree={node} busy={false} action={action} refresh={() => {}} />,
    ),
  );
const day = (date: string) => host.querySelector<HTMLButtonElement>(`[data-calendar-date="${date}"]`)!;

test.each([
  ['2024-02', 29, 4],
  ['1900-02', 28, 4],
  ['2000-02', 29, 2],
  ['0001-01', 31, 1],
  ['2026-08', 31, 6],
] as const)(
  'calendar grid follows Gregorian dates including century and year boundaries: %s',
  (month, count, offset) => {
    const { cells } = calendarMonth(month);
    expect(cells.filter(Boolean)).toHaveLength(count);
    expect(cells.indexOf(`${month}-01`)).toBe(offset);
    expect(cells.filter(Boolean).at(-1)).toBe(`${month}-${count}`);
    expect(cells.length % 7).toBe(0);
  },
);

test('today and note dots are separate, and refresh keeps the focused date while updating markers', async () => {
  await render();
  expect(host.querySelectorAll('[data-calendar-date]')).toHaveLength(30);
  expect(host.querySelectorAll('.plugin-calendar-dot')).toHaveLength(2);
  expect(day('2026-09-17').getAttribute('aria-current')).toBe('date');
  expect(day('2026-09-03').getAttribute('aria-label')).toContain('노트 있음');
  expect(day('2026-09-17').tabIndex).toBe(0);
  await act(async () => day('2026-09-03').focus());
  await render({ ...calendar, markedDates: ['2026-09-18'] });
  expect(document.activeElement).toBe(day('2026-09-03'));
  expect(day('2026-09-03').tabIndex).toBe(0);
  expect(day('2026-09-03').querySelector('.plugin-calendar-dot')).toBeNull();
  expect(day('2026-09-18').querySelector('.plugin-calendar-dot')).not.toBeNull();
  await render({ ...calendar, month: '2026-10', markedDates: [] });
  expect(day('2026-10-01').tabIndex).toBe(0);
  expect(host.querySelector('[aria-current=date]')).toBeNull();
});

test('day and month actions use the declared handlers and suppress repeated pending activation', async () => {
  let complete!: () => void;
  action.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  await render();
  await act(async () => {
    day('2026-09-17').click();
    day('2026-09-17').click();
  });
  expect(action.mock.calls).toEqual([['select-date', '2026-09-17']]);
  expect(day('2026-09-18').disabled).toBe(true);
  await act(async () => complete());
  for (const label of ['이전 달', '다음 달']) {
    await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
  }
  await act(async () => host.querySelector<HTMLButtonElement>('.plugin-calendar-today')!.click());
  expect(action.mock.calls.slice(1)).toEqual([
    ['previous-month', undefined],
    ['next-month', undefined],
    ['today', undefined],
  ]);
  await render({ ...calendar, month: '0001-01', markedDates: [] });
  expect(host.querySelector<HTMLButtonElement>('[aria-label="이전 달"]')!.disabled).toBe(true);
  await render({ ...calendar, month: '9999-12', markedDates: [] });
  expect(host.querySelector<HTMLButtonElement>('[aria-label="다음 달"]')!.disabled).toBe(true);
});

test('arrow navigation and Vim sidebar routing stay in the calendar, including an otherwise empty right pane', async () => {
  await render();
  const main = document.createElement('button');
  main.dataset.focusRegion = 'main';
  document.body.append(main);
  main.focus();
  await act(async () => moveWorkspaceFocus('right'));
  expect(document.activeElement).toBe(day('2026-09-17'));
  await act(async () =>
    day('2026-09-17').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
  );
  expect(document.activeElement).toBe(day('2026-09-24'));
  await act(async () => expect(moveSidebarFocus(day('2026-09-24'), 'h')).toBe(true));
  expect(document.activeElement).toBe(day('2026-09-23'));
  await act(async () => expect(moveSidebarFocus(day('2026-09-23'), 'k')).toBe(true));
  expect(document.activeElement).toBe(day('2026-09-16'));
  await act(async () =>
    day('2026-09-16').dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true })),
  );
  expect(document.activeElement).toBe(day('2026-09-16')); // Ordinary h is owned by the Vim command router.
  rememberWorkspaceFocus(day('2026-09-16'));
  main.focus();
  await act(async () => moveWorkspaceFocus('right'));
  expect(document.activeElement).toBe(day('2026-09-16'));
  expect(action).not.toHaveBeenCalled();
});
