import type { Api, Plugin, TreeIcons, TreeIconName, ViewNode } from '../../../packages/plugin-sdk';
const choices: Record<TreeIconName, string> = {
  'file-text': '문서',
  folder: '폴더',
  table: '테이블',
  'book-open': '펼친 책',
  notebook: '노트북',
  bookmark: '북마크',
  star: '별',
  heart: '하트',
  lightbulb: '아이디어',
  code: '코드',
  calendar: '달력',
  'check-square': '할 일',
  briefcase: '업무',
  'graduation-cap': '학습',
  music: '음악',
  image: '이미지',
  globe: '지구',
  coffee: '커피',
  archive: '보관함',
  inbox: '수신함',
};
const names = Object.keys(choices) as TreeIconName[];
const defaults: TreeIcons = { note: 'notebook', folder: 'folder', database: 'table' };
const defaultChoice = '기본 아이콘 사용';
function read(api: Api) {
  const saved = api.storage.read<TreeIcons>();
  return { ...saved, value: { ...defaults, ...saved.value } };
}
function iconSelect(
  label: string,
  icon: TreeIconName | undefined,
  action: string,
  payload?: unknown,
): ViewNode {
  return {
    type: 'select',
    label,
    value: icon ? choices[icon] : defaultChoice,
    options: [defaultChoice, ...Object.values(choices)],
    action,
    payload,
  };
}
function targets(api: Api) {
  const kind = api.state.kind === '폴더' ? 'folder' : api.state.kind === '데이터베이스' ? 'database' : 'note';
  const items = api.call<{ id: string; title?: string; name?: string }[]>(`${kind}.list`);
  const query = String(api.state.query ?? '').toLocaleLowerCase();
  const titles = items.map((item) =>
    Array.from(item.title ?? item.name ?? '')
      .slice(0, 45)
      .join(''),
  );
  return items
    .map((item, index) => ({
      id: item.id,
      label:
        titles.filter((title) => title === titles[index]).length > 1
          ? `${titles[index]} · ${item.id.slice(0, 8)}`
          : titles[index],
    }))
    .filter((item) => item.label.toLocaleLowerCase().includes(query))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, 50);
}
export default {
  commands: {
    settings(api) {
      api.openView('settings');
    },
  },
  treeIcons(api) {
    return read(api).value;
  },
  views: {
    settings: {
      render(api) {
        const config = read(api).value;
        const entries = targets(api);
        const target = entries.find((item) => item.id === api.state.target) ?? entries[0];
        return {
          type: 'stack',
          children: [
            { type: 'heading', text: '기본 아이콘' },
            {
              type: 'text',
              text: '모든 아이콘은 현재 테마 색을 따릅니다. 확장을 끄면 원래 아이콘으로 돌아갑니다.',
              tone: 'muted',
            },
            ...(['note', 'folder', 'database'] as const).map((kind) =>
              iconSelect(
                { note: '노트', folder: '폴더', database: '데이터베이스' }[kind],
                config[kind],
                'default',
                kind,
              ),
            ),
            { type: 'heading', text: '파일별 아이콘' },
            {
              type: 'select',
              label: '종류',
              value: String(api.state.kind ?? '노트'),
              options: ['노트', '폴더', '데이터베이스'],
              action: 'kind',
            },
            {
              type: 'input',
              label: '이름 검색',
              value: String(api.state.query ?? ''),
              placeholder: '파일이나 폴더 이름',
              action: 'query',
            },
            {
              type: 'text',
              text: '검색 결과에서 최대 50개를 표시합니다. 이름을 바꿔도 지정한 아이콘은 유지됩니다.',
              tone: 'muted',
            },
            ...(target
              ? [
                  {
                    type: 'select',
                    label: '대상',
                    value: target.label,
                    options: entries.map((item) => item.label),
                    action: 'target',
                  } as ViewNode,
                  iconSelect('아이콘', config.items?.[target.id], 'item', target.id),
                ]
              : [{ type: 'text', text: '일치하는 항목이 없습니다.', tone: 'muted' } as ViewNode]),
            { type: 'button', text: '아이콘 모두 초기화', action: 'reset' },
          ],
        };
      },
      onAction(api, action) {
        if (action.id === 'kind' || action.id === 'query') {
          api.state[action.id] = action.value;
          delete api.state.target;
          return;
        }
        if (action.id === 'target') {
          api.state.target = targets(api).find((item) => item.label === action.value)?.id;
          return;
        }
        const saved = read(api);
        const icon = names.find((name) => choices[name] === action.value);
        if (action.id === 'default' && ['note', 'folder', 'database'].includes(String(action.payload))) {
          const kind = action.payload as 'note' | 'folder' | 'database';
          saved.value[kind] =
            icon ?? ({ note: 'file-text', folder: 'folder', database: 'table' }[kind] as TreeIconName);
        } else if (
          action.id === 'item' &&
          typeof action.payload === 'string' &&
          targets(api).some((item) => item.id === action.payload)
        ) {
          const items = { ...saved.value.items };
          if (icon) items[action.payload] = icon;
          else delete items[action.payload];
          if (Object.keys(items).length > 5000) {
            api.notify('파일별 아이콘은 최대 5,000개까지 지정할 수 있습니다.');
            return;
          }
          saved.value.items = items;
        } else if (action.id === 'reset') {
          api.storage.write(defaults, saved.revision);
          return;
        } else return;
        api.storage.write(saved.value, saved.revision);
      },
    },
  },
} satisfies Plugin;
