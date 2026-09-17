import type { Api, Database, Plugin, ViewNode } from '../../../packages/plugin-sdk';
import { sources, withNoteBody, type Config } from './sources';
import { read, sync, connection, needsSync } from './sync';
const text = (value: string, tone?: 'muted' | 'danger'): ViewNode => ({ type: 'text', text: value, tone });
const button = (label: string, action: string, payload?: unknown): ViewNode => ({
  type: 'button',
  text: label,
  action,
  payload,
});
const choice = (label: string, action: string, value: string, options: string[]): ViewNode => ({
  type: 'select',
  label,
  action,
  value,
  options,
});
const name = (db: Database, all: Database[]) =>
  all.filter((d) => d.name === db.name).length > 1 ? `${db.name} (${db.id.slice(0, 6)})` : db.name;
const column = (p: Database['properties'][number], db: Database) =>
  db.properties.filter((v) => v.name === p.name).length > 1 ? `${p.name} (${p.id})` : p.name;
const draft = (api: Api): Config => (api.state.draft as Config) ?? read(api).data.config;
const databases = (api: Api) => api.call<Database[]>('database.list');
function save(api: Api, config: Config) {
  if (!config.deck.trim() || !/^[\p{L}\p{N}_][\p{L}\p{N}\p{M}_/-]*$/u.test(config.tag))
    throw new Error('덱 이름과 공백 없는 태그를 입력하세요.');
  const saved = read(api);
  saved.data.config = {
    ...config,
    deck: config.deck.trim(),
    tag: config.tag.replace(/^#/, '').toLowerCase(),
  };
  api.storage.write(saved.data, saved.revision);
  delete api.state.draft;
  api.state.notice = '설정을 저장했습니다.';
}
const plugin = {
  commands: {
    open(api) {
      api.openView('sync');
    },
    status(api) {
      return read(api).data;
    },
    sync(api, args) {
      return sync(api, args.automatic === true);
    },
  },
  views: {
    sync: {
      render(api, settingsOnly = false) {
        const data = read(api).data,
          config = draft(api),
          all = databases(api),
          db = all.find((d) => d.id === config.database),
          backColumn = db?.properties.find((p) => p.id === config.back);
        let cards: ReturnType<typeof sources> = [],
          problem = '';
        try {
          if (!settingsOnly)
            cards = sources(api, data.config).map((card, index) =>
              index < 40 || (api.state.review as { key?: string } | undefined)?.key === card.key
                ? withNoteBody(api, card)
                : card,
            );
        } catch (e) {
          problem = String(e);
        }
        const connectionInfo = api.state.connection as { profile: string; decks: string[] } | undefined;
        const children: ViewNode[] = [
          {
            type: 'row',
            children: [
              button('연결 확인', 'connect'),
              ...(!settingsOnly ? [button('지금 동기화', 'sync')] : []),
              text(
                connectionInfo ? `Anki · ${connectionInfo.profile}` : 'Anki와 AnkiConnect를 켜세요.',
                'muted',
              ),
            ],
          },
          ...(api.state.notice ? [text(String(api.state.notice))] : []),
          ...(api.state.error ? [text(String(api.state.error), 'danger')] : []),
          {
            type: 'card',
            children: [
              { type: 'heading', text: '동기화 대상' },
              {
                type: 'input',
                label: 'Anki 덱 이름',
                action: 'deck',
                value: config.deck,
                placeholder: 'Foltra 또는 언어::한국어',
              },
              ...(connectionInfo?.decks.length
                ? [
                    choice(
                      '기존 덱에서 선택',
                      'deck-choice',
                      connectionInfo.decks.includes(config.deck) ? config.deck : '직접 입력',
                      ['직접 입력', ...connectionInfo.decks],
                    ),
                  ]
                : []),
              choice('데이터베이스', 'database', db ? name(db, all) : '사용 안 함', [
                '사용 안 함',
                ...all.map((d) => name(d, all)),
              ]),
              ...(db
                ? [
                    choice(
                      '앞면 컬럼',
                      'front',
                      column(db.properties.find((p) => p.id === config.front) ?? db.properties[0], db),
                      db.properties.map((p) => column(p, db)),
                    ),
                    choice(
                      '뒷면',
                      'back',
                      config.backSource === 'note'
                        ? '연결된 노트 본문'
                        : backColumn
                          ? `컬럼 · ${column(backColumn, db)}`
                          : '컬럼 선택',
                      [
                        ...(!backColumn && config.backSource === 'column' ? ['컬럼 선택'] : []),
                        ...db.properties.map((p) => `컬럼 · ${column(p, db)}`),
                        '연결된 노트 본문',
                      ],
                    ),
                    text(
                      '뒷면은 선택한 컬럼 또는 연결된 노트 본문 중 하나만 사용합니다. 본문의 첨부 이미지도 전송합니다.',
                      'muted',
                    ),
                  ]
                : []),
              {
                type: 'checkbox',
                label: '태그가 있는 블록도 동기화',
                action: 'blocks',
                checked: config.blocks,
              },
              { type: 'input', label: '블록 태그 (# 제외)', action: 'tag', value: config.tag },
              text('태그가 붙은 줄은 앞면, 하위 bullet과 이어지는 문장은 뒷면이 됩니다.', 'muted'),
              { type: 'checkbox', label: '저장 후 자동 동기화', action: 'auto', checked: config.auto },
              button('설정 저장', 'save'),
              text(
                '자동 동기화는 Foltra가 실행 중일 때 작동합니다. 카드 삭제와 Anki의 학습 일정은 변경하지 않습니다.',
                'muted',
              ),
            ],
          },
        ];
        if (settingsOnly) return { type: 'stack', children };
        children.push(
          { type: 'heading', text: `카드 원본 · ${cards.length}` },
          text(
            data.message || '원본을 확인한 뒤 동기화를 시작하세요.',
            Object.keys(data.errors).length ? 'danger' : undefined,
          ),
          ...(data.lastSync
            ? [text(`마지막 처리 · ${new Date(data.lastSync).toLocaleString()}`, 'muted')]
            : []),
          ...(problem ? [text(problem, 'danger')] : []),
        );
        const review = api.state.review as
          { key: string; digest: string; front: string; back: string } | undefined;
        if (review) {
          const source = cards.find((c) => c.key === review.key);
          children.push({
            type: 'card',
            children: [
              { type: 'heading', text: '충돌 내용 확인' },
              text(`Foltra 앞면: ${source?.front ?? ''}\n뒷면: ${source?.back ?? ''}`),
              text(`Anki 앞면: ${review.front}\n뒷면: ${review.back}`),
              button('Foltra 내용으로 덮어쓰기', 'overwrite', review.key),
              button('취소', 'cancel-review'),
            ],
          });
        }
        for (const card of cards.slice(0, 40)) {
          const error = data.errors[card.key],
            sent = data.sent[card.key];
          children.push({
            type: 'card',
            children: [
              text(card.front || '(앞면이 비어 있습니다)'),
              text(
                card.problem || card.back.slice(0, 220) || '(뒷면이 비어 있습니다)',
                card.problem ? 'danger' : 'muted',
              ),
              text(
                `${card.label} · ${error || card.problem ? '확인 필요' : !needsSync(data, card) ? '동기화됨' : '동기화 대기'}`,
                'muted',
              ),
              ...(error && error.message !== card.problem ? [text(error.message, 'danger')] : []),
              {
                type: 'row',
                children: [
                  ...(card.noteId ? [button('원본 노트 열기', 'source', card.noteId)] : []),
                  ...(sent ? [button('Anki에서 보기', 'browse', card.key)] : []),
                  ...(error && sent ? [button('충돌 확인', 'review', card.key)] : []),
                ],
              },
            ],
          });
        }
        if (cards.length > 40)
          children.push(
            text(`처음 40개 표시 · 동기화는 전체 ${cards.length}개를 순서대로 처리합니다.`, 'muted'),
          );
        const orphaned = Object.keys(data.sent).filter((key) => !cards.some((c) => c.key === key)).length;
        if (orphaned)
          children.push(
            text(`원본에서 제외된 ${orphaned}개의 Anki 카드는 학습 기록과 함께 유지합니다.`, 'muted'),
          );
        return { type: 'stack', children };
      },
      onAction(api, action) {
        delete api.state.error;
        try {
          const config = { ...draft(api) },
            all = databases(api),
            db = all.find((d) => d.id === config.database);
          if (action.id === 'connect') api.state.connection = connection(api);
          else if (action.id === 'save') save(api, config);
          else if (action.id === 'sync') {
            api.state.syncRequested = true;
            return sync(api);
          } else if (action.id === 'source') api.openNote(String(action.payload));
          else if (action.id === 'browse')
            api.anki('guiBrowse', { query: `tag:foltra::${api.vaultId}::${String(action.payload)}` });
          else if (action.id === 'review') {
            const key = String(action.payload),
              saved = read(api),
              id = saved.data.sent[key]?.id;
            if (!id) throw new Error('연결된 카드가 없습니다.');
            const remote = api.anki<{ fields: Record<string, { value: string }> }[]>('notesInfo', {
              notes: [id],
            })[0];
            if (!remote?.fields)
              throw new Error(
                'Anki에서 카드가 삭제되었습니다. 학습 기록 보호를 위해 자동 재생성하지 않습니다.',
              );
            const fields = {
              Front: remote.fields.Front?.value,
              Back: remote.fields.Back?.value,
              Source: remote.fields.Source?.value,
            };
            api.state.review = {
              key,
              digest: api.hash(JSON.stringify(fields)),
              front: fields.Front,
              back: fields.Back,
            };
          } else if (action.id === 'overwrite') {
            const review = api.state.review as { key: string; digest: string } | undefined;
            if (!review || review.key !== action.payload) throw new Error('먼저 충돌 내용을 확인하세요.');
            api.state.force = { [review.key]: review.digest };
            delete api.state.review;
            api.state.syncRequested = true;
            return sync(api);
          } else if (action.id === 'cancel-review') delete api.state.review;
          else {
            if (action.id === 'database') {
              const selected = all.find((d) => name(d, all) === action.value);
              config.database = selected?.id ?? '';
              config.front = selected?.properties[0]?.id ?? '';
              config.back = selected?.properties[1]?.id ?? selected?.properties[0]?.id ?? '';
            } else if (action.id === 'front' && db)
              config.front = db.properties.find((p) => column(p, db) === action.value)?.id ?? '';
            else if (action.id === 'back' && db) {
              if (action.value === '연결된 노트 본문') config.backSource = 'note';
              else {
                const selected = db.properties.find((p) => `컬럼 · ${column(p, db)}` === action.value);
                if (selected) {
                  config.backSource = 'column';
                  config.back = selected.id;
                }
              }
            } else if (action.id === 'blocks' || action.id === 'auto')
              config[action.id] = action.value === true;
            else if (action.id === 'deck-choice') {
              if (action.value !== '직접 입력') config.deck = String(action.value);
            } else if (action.id === 'deck' || action.id === 'tag') config[action.id] = String(action.value);
            api.state.draft = config;
          }
        } catch (e) {
          api.state.error = e instanceof Error ? e.message : String(e);
        }
      },
    },
  },
} satisfies Plugin;

export default {
  ...plugin,
  views: {
    ...plugin.views,
    settings: {
      render: (api) => plugin.views.sync.render(api, true),
      onAction: plugin.views.sync.onAction,
    },
  },
} satisfies Plugin;
