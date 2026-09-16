import type { Api, Database, Note, QueryResult, Plugin, ViewNode } from '../../../../packages/plugin-sdk';
const button = (text: string, action: string, payload?: unknown): ViewNode => ({
  type: 'button',
  text,
  action,
  payload,
});
const databases = (api: Api) =>
  api
    .call<Database[]>('database.list')
    .filter((d) => d.properties.some((p) => p.type === 'status' || p.type === 'select'));
function current(api: Api) {
  const all = databases(api);
  return all.find((d) => d.id === api.state.databaseId) || all[0];
}
function status(db: Database) {
  return db.properties.find((p) => p.type === 'status' || p.type === 'select')!;
}
export default {
  onEvent(api) {
    api.state.updated = Date.now();
  },
  commands: {
    open(api) {
      api.openView('board');
    },
    summary(api) {
      return databases(api).map((d) => ({
        id: d.id,
        name: d.name,
        total: api.call<QueryResult>('query.run', { databaseId: d.id, limit: 1 }).total,
      }));
    },
  },
  views: {
    board: {
      render(api) {
        const all = databases(api),
          db = current(api);
        if (!db)
          return {
            type: 'stack',
            children: [
              { type: 'text', text: '상태 컬럼이 있는 데이터베이스를 만들면 칸반으로 관리할 수 있습니다.' },
              button('새 보드 만들기', 'create'),
            ],
          };
        const property = status(db),
          title = db.properties.find((p) => p.type === 'text');
        const result = api.call<QueryResult>('query.run', { databaseId: db.id, limit: 200 });
        const states = [
          ...new Set([
            ...(property.options || []),
            ...result.rows.map((r) => String(r.values[property.id] ?? '미지정')),
          ]),
        ];
        if (!states.length) states.push('미지정');
        return {
          type: 'stack',
          children: [
            {
              type: 'row',
              children: [
                ...all.map((d) => button(d.name, 'database', d.id)),
                button('새 보드 만들기', 'create'),
              ],
            },
            {
              type: 'row',
              children: [
                {
                  type: 'input',
                  label: '새 카드 제목',
                  action: 'draft',
                  value: String(api.state.draft ?? ''),
                  placeholder: '할 일을 입력하고 Enter',
                },
                button('카드 추가', 'add', db.id),
              ],
            },
            {
              type: 'text',
              tone: 'muted',
              text: `${result.total}개 카드${result.total > 200 ? ' · 처음 200개 표시' : ''}`,
            },
            {
              type: 'grid',
              columns: Math.min(states.length, 7),
              children: states.map((state) => ({
                type: 'stack',
                children: [
                  {
                    type: 'heading',
                    text: `${state} · ${result.rows.filter((r) => String(r.values[property.id] ?? '미지정') === state).length}`,
                  },
                  ...result.rows
                    .filter((r) => String(r.values[property.id] ?? '미지정') === state)
                    .map(
                      (row) =>
                        ({
                          type: 'card',
                          children: [
                            {
                              type: 'text',
                              text: String(title ? row.values[title.id] || '제목 없음' : row.id),
                            },
                            {
                              type: 'select',
                              label: '카드 상태',
                              action: 'status',
                              value: state,
                              options: states,
                              payload: { id: row.id, revision: row.revision, property: property.id },
                            },
                            button(row.bodyNoteId ? '본문 열기' : '본문 만들기', 'body', {
                              id: row.id,
                              revision: row.revision,
                            }),
                          ],
                        }) as ViewNode,
                    ),
                ],
              })),
            },
          ],
        };
      },
      onAction(api, action) {
        if (action.id === 'create') {
          const db = api.call<Database>('database.create', {
            name: String(api.settings['board-name']),
            properties: [
              { id: 'title', name: '이름', type: 'text' },
              { id: 'status', name: '상태', type: 'status', options: ['할 일', '진행 중', '완료'] },
            ],
          });
          api.state.databaseId = db.id;
        }
        if (action.id === 'database') api.state.databaseId = String(action.payload);
        if (action.id === 'draft') api.state.draft = String(action.value);
        if (action.id === 'add') {
          const db = current(api);
          if (!db) return;
          const title = db.properties.find((p) => p.type === 'text');
          if (!title) {
            api.notify('텍스트 컬럼을 먼저 추가하세요.');
            return;
          }
          const text = String(api.state.draft ?? '').trim();
          if (!text) return;
          const property = status(db);
          api.call('record.create', {
            databaseId: db.id,
            values: {
              [title.id]: text,
              ...(property.options?.length ? { [property.id]: property.options[0] } : {}),
            },
          });
          api.state.draft = '';
        }
        if (action.id === 'status') {
          const p = action.payload as { id: string; revision: string; property: string };
          api.call('record.update', {
            id: p.id,
            expectedRevision: p.revision,
            values: { [p.property]: String(action.value) },
          });
        }
        if (action.id === 'body') {
          const p = action.payload as { id: string; revision: string };
          const result = api.call<Note>('record.body', { id: p.id, expectedRevision: p.revision, body: '' });
          api.openNote(result.id);
        }
      },
    },
  },
} satisfies Plugin;
