import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin, { isDate, localDate } from '../../examples/code/calendar/main';
import type { Api } from '../../packages/plugin-sdk';

function fixture(titles: string[] = [], createMissingNotes = false) {
  const notes = titles.map((title, index) => ({
    id: `note-${String(index).padStart(3, '0')}`,
    title,
    createdAt: '2026-09-17T12:00:00Z',
  }));
  const api = {
    state: {},
    settings: { 'create-missing-notes': createMissingNotes },
    call: vi.fn((command: string, args?: { target?: string }) => {
      if (command === 'note.list') return notes;
      if (command === 'note.open-link' && args?.target) {
        const found = notes.filter((note) => note.title === args.target);
        if (found.length > 1) throw new Error('Ambiguous date title');
        if (found.length) return found[0];
        const note = { id: `new-${notes.length}`, title: args.target, createdAt: '' };
        notes.push(note);
        return note;
      }
      throw new Error(`Unexpected write or request: ${command}`);
    }),
    openNote: vi.fn(),
    openView: vi.fn(),
    notify: vi.fn(),
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

  it('opens one exact date note, notifies for empty dates by default, and ignores malformed/outside dates', () => {
    const f = fixture(['2026-09-17']);
    f.action('select-date', '2026-09-17');
    expect(f.api.openNote).toHaveBeenCalledExactlyOnceWith('note-000');
    expect(f.render().children).toHaveLength(1);
    f.action('select-date', '2026-09-18');
    expect(f.api.notify).toHaveBeenCalledExactlyOnceWith('2026-09-18 · 노트가 없습니다.');
    expect(f.render().children).toHaveLength(1);
    f.action('select-date', '2026-09-31');
    f.action('select-date', '2026-08-17');
    expect(f.api.state.selectedDate).toBe('2026-09-18');
    expect(f.api.openNote).toHaveBeenCalledTimes(1);
    expect(f.api.call).toHaveBeenCalledWith('note.list');
    expect(f.notes).toHaveLength(1);
    expect(vi.mocked(f.api.call).mock.calls.every(([command]) => command === 'note.list')).toBe(true);
  });

  it('creates an empty date only when enabled and reuses it on subsequent selection', () => {
    const f = fixture(['2026-09-17'], true);
    const existing = structuredClone(f.notes[0]);
    f.action('select-date', '2026-09-18');
    expect(f.api.call).toHaveBeenCalledWith('note.open-link', { target: '2026-09-18' });
    expect(f.api.openNote).toHaveBeenCalledExactlyOnceWith('new-1');
    f.action('select-date', '2026-09-18');
    expect(f.api.openNote).toHaveBeenLastCalledWith('new-1');
    expect(f.notes).toHaveLength(2);
    expect(f.notes[0]).toEqual(existing);
    expect(f.calendar().markedDates).toEqual(['2026-09-17', '2026-09-18']);
    expect(f.api.notify).not.toHaveBeenCalled();
    expect(vi.mocked(f.api.call).mock.calls.filter(([command]) => command === 'note.open-link')).toHaveLength(
      1,
    );
  });

  it('opens or creates the local current date explicitly even when click-to-create is disabled', () => {
    vi.setSystemTime(new Date(2027, 0, 1, 0, 1));
    const f = fixture();
    f.api.state = { month: '2020-01', selectedDate: '2020-01-02', notePage: 2 };
    plugin.commands['open-today'](f.api);
    expect(f.api.state).toEqual({ month: '2027-01', selectedDate: '2027-01-01', notePage: 0 });
    expect(f.api.call).toHaveBeenCalledWith('note.open-link', { target: '2027-01-01' });
    expect(f.api.openNote).toHaveBeenCalledExactlyOnceWith('new-0');
    const before = structuredClone(f.notes);
    plugin.commands['open-today'](f.api);
    expect(f.notes).toEqual(before);
    expect(f.api.openNote).toHaveBeenCalledTimes(2);
    expect(f.api.openNote).toHaveBeenLastCalledWith('new-0');
    expect(f.api.notify).not.toHaveBeenCalled();
  });

  it.each([false, true])('offers duplicate today notes without writing when creation is %s', (enabled) => {
    const f = fixture(['2026-09-17', '2026-09-17'], enabled);
    const before = structuredClone(f.notes);
    f.api.state.month = '2020-01';
    plugin.commands['open-today'](f.api);
    expect(f.api.state).toEqual({ month: '2026-09', selectedDate: '2026-09-17', notePage: 0 });
    expect(f.api.openView).toHaveBeenCalledExactlyOnceWith('calendar');
    expect(f.api.openNote).not.toHaveBeenCalled();
    expect(f.api.notify).not.toHaveBeenCalled();
    expect(f.render().children.filter((node) => node.type === 'button')).toHaveLength(2);
    expect(vi.mocked(f.api.call).mock.calls.every(([command]) => command === 'note.list')).toBe(true);
    f.action('open-note', undefined, 'note-001');
    expect(f.api.openNote).toHaveBeenCalledExactlyOnceWith('note-001');
    expect(f.notes).toEqual(before);
  });

  it('keeps loading, rendering, and month reset free of note creation or notifications', () => {
    const f = fixture([], true);
    plugin.onLoad(f.api);
    f.api.state.selectedDate = '2026-09-18';
    expect(f.render().children).toHaveLength(1);
    plugin.commands.today(f.api);
    f.action('today');
    expect(f.api.state).toEqual({ month: '2026-09' });
    expect(f.notes).toEqual([]);
    expect(f.api.notify).not.toHaveBeenCalled();
    expect(f.api.openNote).not.toHaveBeenCalled();
    expect(vi.mocked(f.api.call).mock.calls.every(([command]) => command === 'note.list')).toBe(true);
  });

  it.each(['select-date', 'open-today'])(
    'propagates create failures from %s without opening or a success notification',
    (action) => {
      const f = fixture([], true);
      const original = f.api.call;
      f.api.call = vi.fn((command, args) => {
        if (command === 'note.open-link') throw new Error('Write permission denied');
        return original(command, args);
      }) as Api['call'];
      const run = () =>
        action === 'select-date'
          ? f.action('select-date', '2026-09-17')
          : plugin.commands['open-today'](f.api);
      expect(run).toThrow('Write permission denied');
      expect(f.api.openNote).not.toHaveBeenCalled();
      expect(f.api.notify).not.toHaveBeenCalled();
      expect(f.notes).toEqual([]);
    },
  );

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
