import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin, { isDate, localDate } from '../../examples/code/calendar/main';
import type { Api } from '../../packages/plugin-sdk';

function fixture(titles: string[] = []) {
  const notes = titles.map((title, index) => ({
    id: `note-${String(index).padStart(3, '0')}`,
    title,
    createdAt: '2026-09-17T12:00:00Z',
  }));
  const api = {
    state: {},
    call: vi.fn((command: string) => {
      if (command !== 'note.list') throw new Error(`Unexpected write or request: ${command}`);
      return notes;
    }),
    openNote: vi.fn(),
    openView: vi.fn(),
    storage: {
      read: vi.fn(() => {
        throw new Error('No persistent state');
      }),
      write: vi.fn(() => {
        throw new Error('No writes');
      }),
    },
  } as unknown as Api;
  const render = () => plugin.views.calendar.render(api);
  const calendar = () => render().children[0];
  const action = (id: string, value?: string, payload?: unknown) =>
    plugin.views.calendar.onAction(api, { id, value, payload });
  return { notes, api, render, calendar, action };
}

describe('daily calendar plugin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 17, 23, 50));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes a fresh session to the local current month and keeps browsing only in session state', () => {
    const f = fixture();
    f.api.state = { month: '2020-01', selectedDate: '2020-01-02', notePage: 3 };
    plugin.onLoad(f.api);
    expect(f.api.state).toEqual({ month: '2026-09' });
    expect(f.calendar()).toMatchObject({ month: '2026-09', today: '2026-09-17' });
    f.action('previous-month');
    expect(f.calendar().month).toBe('2026-08');
    expect(f.api.storage.read).not.toHaveBeenCalled();
    expect(f.api.storage.write).not.toHaveBeenCalled();
    plugin.onLoad(f.api);
    expect(f.calendar().month).toBe('2026-09');
    expect(localDate(new Date(2026, 8, 17, 0, 1))).toBe('2026-09-17');
  });

  it('marks only exact real date titles, deduplicates dots, and reflects create/rename/delete immediately', () => {
    const f = fixture([
      '2026-09-01',
      '2026-09-01',
      '2026-09-17',
      '2026-08-31',
      '2026-09-31',
      '2026-9-02',
      '2026-09-02 memo',
      'memo 2026-09-03',
    ]);
    expect(f.calendar().markedDates).toEqual(['2026-09-01', '2026-09-17']);
    f.notes[2].title = '2026-09-23';
    expect(f.calendar().markedDates).toEqual(['2026-09-01', '2026-09-23']);
    f.notes.splice(0, 3);
    expect(f.calendar().markedDates).toEqual([]);
    f.notes.push({ id: 'new', title: '2026-09-29', createdAt: '' });
    expect(f.calendar().markedDates).toEqual(['2026-09-29']);
  });

  it('opens one exact date note, leaves empty dates read-only, and ignores malformed/outside dates', () => {
    const f = fixture(['2026-09-17']);
    f.action('select-date', '2026-09-17');
    expect(f.api.openNote).toHaveBeenCalledExactlyOnceWith('note-000');
    expect(f.render().children).toHaveLength(1);
    f.action('select-date', '2026-09-18');
    expect(f.render().children.at(-1)).toMatchObject({ text: '2026-09-18 · 노트가 없습니다.' });
    f.action('select-date', '2026-09-31');
    f.action('select-date', '2026-08-17');
    expect(f.api.state.selectedDate).toBe('2026-09-18');
    expect(f.api.openNote).toHaveBeenCalledTimes(1);
    expect(f.api.call).toHaveBeenCalledWith('note.list');
  });

  it('offers every duplicate via bounded pages and revalidates note existence before opening', () => {
    const f = fixture(Array.from({ length: 43 }, () => '2026-09-17'));
    f.action('select-date', '2026-09-17');
    expect(f.api.openNote).not.toHaveBeenCalled();
    const buttons = () => f.render().children.filter((node) => node.type === 'button');
    expect(buttons()).toHaveLength(20);
    f.action('next-notes');
    expect(buttons()[0].payload).toBe('note-020');
    f.action('next-notes');
    expect(buttons()).toHaveLength(3);
    f.action('open-note', undefined, 'note-042');
    expect(f.api.openNote).toHaveBeenCalledExactlyOnceWith('note-042');
    f.notes.pop();
    f.action('open-note', undefined, 'note-042');
    f.action('open-note', undefined, 'unrelated');
    expect(f.api.openNote).toHaveBeenCalledTimes(1);
    f.action('previous-notes');
    expect(buttons()[0].payload).toBe('note-020');
  });

  it('handles leap centuries, year rollover, and valid year bounds', () => {
    for (const date of ['0001-01-01', '2000-02-29', '2024-02-29', '9999-12-31'])
      expect(isDate(date)).toBe(true);
    for (const date of ['0000-01-01', '1900-02-29', '2100-02-29', '2024-04-31', '2024-00-01', '10000-01-01'])
      expect(isDate(date)).toBe(false);
    const f = fixture();
    f.api.state.month = '2026-12';
    f.action('next-month');
    expect(f.calendar().month).toBe('2027-01');
    f.action('previous-month');
    expect(f.calendar().month).toBe('2026-12');
    f.api.state.month = '0001-01';
    f.action('previous-month');
    expect(f.calendar()).toMatchObject({ month: '0001-01' });
    expect(f.calendar().previousAction).toBeUndefined();
    f.api.state.month = '9999-12';
    f.action('next-month');
    expect(f.calendar().month).toBe('9999-12');
    expect(f.calendar().nextAction).toBeUndefined();
  });

  it('exposes command registry actions, resets via today, and refreshes the date when rerendered after midnight', () => {
    const f = fixture();
    plugin.commands['previous-month'](f.api);
    expect(f.calendar().month).toBe('2026-08');
    plugin.commands['next-month'](f.api);
    expect(f.calendar().month).toBe('2026-09');
    f.api.state.month = '2000-01';
    vi.setSystemTime(new Date(2026, 9, 1, 0, 1));
    expect(f.calendar().today).toBe('2026-10-01');
    plugin.commands.today(f.api);
    expect(f.calendar().month).toBe('2026-10');
    expect(f.api.openView).toHaveBeenCalledTimes(3);
    expect(f.api.openView).toHaveBeenLastCalledWith('calendar');
  });
});
