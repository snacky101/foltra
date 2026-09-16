import type { Note, Plugin, ViewNode } from '../../../../packages/plugin-sdk';
function monthNow() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
function localDate(value: string) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const button = (text: string, action: string, payload?: unknown): ViewNode => ({
  type: 'button',
  text,
  action,
  payload,
});
export default {
  onLoad(api) {
    api.state.month = monthNow();
  },
  onEvent(api) {
    api.state.updated = Date.now();
  },
  commands: {
    open(api) {
      api.openView('calendar');
    },
  },
  views: {
    calendar: {
      render(api) {
        const month = String(api.state.month || monthNow());
        const [year, index] = month.split('-').map(Number);
        const notes = api.call<Note[]>('note.list');
        const monday = api.settings['week-start'] === '월요일';
        const start = (new Date(year, index - 1, 1).getDay() + (monday ? 6 : 0)) % 7;
        const length = new Date(year, index, 0).getDate();
        const cells: ViewNode[] = (
          monday ? ['월', '화', '수', '목', '금', '토', '일'] : ['일', '월', '화', '수', '목', '금', '토']
        ).map((text) => ({ type: 'text', text, tone: 'muted' }));
        for (let offset = 0; offset < Math.ceil((start + length) / 7) * 7; offset++) {
          const day = offset - start + 1;
          if (day < 1 || day > length) {
            cells.push({ type: 'card', children: [] });
            continue;
          }
          const date = `${month}-${String(day).padStart(2, '0')}`;
          const matches = notes.filter(
            (n) => localDate(api.settings['date-field'] === '수정일' ? n.updatedAt : n.createdAt) === date,
          );
          cells.push({
            type: 'card',
            children: [
              button(String(day), 'date', date),
              ...matches.slice(0, 8).map((n) => button(n.title, 'note', n.id)),
              ...(matches.length > 8
                ? [{ type: 'text', text: `+${matches.length - 8}개`, tone: 'muted' } as ViewNode]
                : []),
            ],
          });
        }
        return {
          type: 'stack',
          children: [
            {
              type: 'row',
              children: [
                button('이전 달', 'month', -1),
                { type: 'heading', text: `${year}년 ${index}월` },
                button('다음 달', 'month', 1),
                button('이번 달', 'today'),
              ],
            },
            { type: 'text', tone: 'muted', text: '날짜를 누르면 그 날짜의 노트를 열거나 새로 만듭니다.' },
            { type: 'grid', columns: 7, children: cells },
          ],
        };
      },
      onAction(api, action) {
        if (action.id === 'today') api.state.month = monthNow();
        if (action.id === 'month') {
          const [y, m] = String(api.state.month || monthNow())
            .split('-')
            .map(Number);
          const date = new Date(y, m - 1 + Number(action.payload), 1);
          api.state.month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        }
        if (action.id === 'note') api.openNote(String(action.payload));
        if (action.id === 'date') {
          const title = String(action.payload);
          const found = api.call<Note[]>('note.list').find((n) => n.title === title);
          const note = found || api.call<Note>('note.create', { title, body: `# ${title}\n\n` });
          api.openNote(note.id);
        }
      },
    },
  },
} satisfies Plugin;
