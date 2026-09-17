import type { Api, Plugin, ViewNode } from '../../../packages/plugin-sdk';

type DailyNote = { id: string; title: string; createdAt: string };
const pageSize = 20;
const pad = (number: number, length = 2) => String(number).padStart(length, '0');

export function localDate(date = new Date()): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function month(api: Api): string {
  const value = api.state.month;
  return typeof value === 'string' && value.length === 7 && isDate(`${value}-01`)
    ? value
    : localDate().slice(0, 7);
}

function today(api: Api) {
  api.state.month = localDate().slice(0, 7);
  delete api.state.selectedDate;
  delete api.state.notePage;
}

function move(api: Api, delta: number) {
  const [year, currentMonth] = month(api).split('-').map(Number);
  const index = (year - 1) * 12 + currentMonth - 1 + delta;
  if (index < 0 || index >= 9999 * 12) return;
  api.state.month = `${pad(Math.floor(index / 12) + 1, 4)}-${pad((index % 12) + 1)}`;
  delete api.state.selectedDate;
  delete api.state.notePage;
}

function dailyNotes(api: Api): DailyNote[] {
  return api.call<DailyNote[]>('note.list').filter((note) => isDate(note.title));
}

function selectedNotes(api: Api, notes = dailyNotes(api)): DailyNote[] {
  return notes
    .filter((note) => note.title === api.state.selectedDate)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

const plugin = {
  onLoad: today,
  commands: {
    today(api) {
      today(api);
      api.openView('calendar');
    },
    'previous-month'(api) {
      move(api, -1);
      api.openView('calendar');
    },
    'next-month'(api) {
      move(api, 1);
      api.openView('calendar');
    },
  },
  views: {
    calendar: {
      render(api) {
        const visibleMonth = month(api),
          notes = dailyNotes(api);
        const children: ViewNode[] = [
          {
            type: 'calendar',
            month: visibleMonth,
            today: localDate(),
            label: '일지 캘린더',
            markedDates: [
              ...new Set(
                notes.filter((note) => note.title.startsWith(visibleMonth)).map((note) => note.title),
              ),
            ].sort(),
            action: 'select-date',
            ...(visibleMonth !== '0001-01' ? { previousAction: 'previous-month' } : {}),
            ...(visibleMonth !== '9999-12' ? { nextAction: 'next-month' } : {}),
            todayAction: 'today',
          },
        ];
        if (isDate(api.state.selectedDate) && api.state.selectedDate.startsWith(visibleMonth)) {
          const matching = selectedNotes(api, notes);
          if (!matching.length)
            children.push({
              type: 'text',
              tone: 'muted',
              text: `${api.state.selectedDate} · 노트가 없습니다.`,
            });
          else if (matching.length > 1) {
            const maxPage = Math.floor((matching.length - 1) / pageSize);
            const requestedPage = Number(api.state.notePage) || 0;
            const page = Math.max(0, Math.min(maxPage, Math.floor(requestedPage)));
            children.push({
              type: 'text',
              tone: 'muted',
              text: `${api.state.selectedDate} · ${matching.length}개 노트`,
            });
            for (const note of matching.slice(page * pageSize, (page + 1) * pageSize)) {
              children.push({
                type: 'button',
                text: `${note.title} · ${note.createdAt.slice(0, 10)} · ${note.id.slice(0, 8)}`,
                action: 'open-note',
                payload: note.id,
              });
            }
            if (maxPage)
              children.push({
                type: 'row',
                children: [
                  { type: 'button', text: '이전', action: 'previous-notes', disabled: page === 0 },
                  { type: 'text', text: `${page + 1} / ${maxPage + 1}`, tone: 'muted' },
                  { type: 'button', text: '다음', action: 'next-notes', disabled: page === maxPage },
                ],
              });
          }
        }
        return { type: 'stack', children };
      },
      onAction(api, action) {
        if (action.id === 'today') today(api);
        else if (action.id === 'previous-month') move(api, -1);
        else if (action.id === 'next-month') move(api, 1);
        else if (action.id === 'select-date' && isDate(action.value) && action.value.startsWith(month(api))) {
          api.state.selectedDate = action.value;
          api.state.notePage = 0;
          const notes = selectedNotes(api);
          if (notes.length === 1) api.openNote(notes[0].id);
        } else if (action.id === 'open-note') {
          const note = selectedNotes(api).find((note) => note.id === action.payload);
          if (note) api.openNote(note.id);
        } else if (action.id === 'previous-notes' || action.id === 'next-notes') {
          const maxPage = Math.max(0, Math.ceil(selectedNotes(api).length / pageSize) - 1);
          api.state.notePage = Math.max(
            0,
            Math.min(maxPage, (Number(api.state.notePage) || 0) + (action.id === 'next-notes' ? 1 : -1)),
          );
        }
      },
    },
  },
} satisfies Plugin;
export default plugin;
