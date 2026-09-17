import type { Command } from './commands';
import { platformModifier } from './commands';

const definitions = [
  {
    id: 'command.palette',
    title: '명령 팔레트',
    group: '탐색',
    bindings: [{ keys: platformModifier() === 'meta' ? 'Mod+k' : 'Mod+Shift+p', leader: false }],
  },
  { id: 'vault.switch', title: 'Vault 선택', group: '앱', bindings: [{ keys: 'vv', leader: true }] },
  {
    id: 'note.create',
    title: '새 노트',
    group: '노트',
    bindings: [
      { keys: 'Mod+n', leader: false },
      { keys: 'nn', leader: true },
    ],
  },
  {
    id: 'note.find',
    title: '노트 찾기',
    group: '탐색',
    bindings: [
      { keys: 'Mod+p', leader: false },
      { keys: 'ff', leader: true },
    ],
  },
  {
    id: 'search',
    title: '내용 검색',
    group: '탐색',
    bindings: [
      { keys: 'Mod+Shift+f', leader: false },
      { keys: 'fg', leader: true },
    ],
  },
  {
    id: 'note.save',
    title: '현재 노트 저장',
    group: '노트',
    bindings: [
      { keys: 'Mod+s', leader: false },
      { keys: 'ns', leader: true },
    ],
  },
  {
    id: 'note.close',
    title: '현재 노트 닫기',
    group: '노트',
    bindings: [{ keys: 'Mod+w', leader: false }],
  },
  { id: 'note.save-close', title: '저장 후 노트 닫기', group: '노트' },
  { id: 'note.mode.live', title: 'Live Preview 모드', group: '노트' },
  { id: 'note.mode.source', title: 'Markdown 원문 모드', group: '노트' },
  { id: 'note.mode.read', title: '읽기 모드', group: '노트' },
  {
    id: 'note.preview',
    title: '편집 / 읽기 전환',
    group: '노트',
    bindings: [
      { keys: 'Mod+e', leader: false },
      { keys: 'np', leader: true },
    ],
  },
  { id: 'note.link', title: '노트 연결 삽입', group: '노트', bindings: [{ keys: 'll', leader: true }] },
  { id: 'note.frontmatter.edit', title: '노트 속성 · frontmatter 편집', group: '노트' },
  {
    id: 'note.task.cycle',
    title: '작업 상태 순환',
    group: '노트',
    bindings: [{ keys: 'Mod+l', leader: false }],
  },
  {
    id: 'note.frontmatter.add',
    title: '노트 속성 추가',
    group: '노트',
    bindings: [{ keys: 'Mod+;', leader: false }],
  },
  {
    id: 'note.back',
    title: '이전 노트 위치로 돌아가기',
    group: '탐색',
    bindings: [{ keys: 'Ctrl+o', leader: false }],
  },
  {
    id: 'note.forward',
    title: '다음 노트 위치로 나아가기',
    group: '탐색',
    bindings: [{ keys: 'Ctrl+i', leader: false }],
  },
  {
    id: 'note.follow-link',
    title: '커서 위치의 링크 열기 / 없는 노트 만들기',
    group: '노트',
    bindings: [{ keys: 'Mod+Enter', leader: false }],
  },
  {
    id: 'note.follow-existing-link',
    title: '커서 위치의 링크 열기 (노트 생성 안 함)',
    group: '노트',
    bindings: [{ keys: 'gd', leader: false }],
  },
  { id: 'note.query', title: 'DB SQL 쿼리 삽입', group: '노트', bindings: [{ keys: 'nq', leader: true }] },
  { id: 'note.delete', title: '현재 노트를 휴지통으로', group: '노트' },
  { id: 'note.move', title: '노트를 폴더로 이동', group: '노트', bindings: [{ keys: 'nm', leader: true }] },
  { id: 'folder.create', title: '새 폴더', group: '폴더' },
  { id: 'folder.rename', title: '선택한 폴더 이름 변경', group: '폴더' },
  { id: 'folder.delete', title: '선택한 폴더를 휴지통으로 이동', group: '폴더' },
  {
    id: 'note.rename',
    title: '노트 이름 변경',
    group: '노트',
    bindings: [
      { keys: 'F2', leader: false },
      { keys: 'rn', leader: true },
    ],
  },
  { id: 'note.duplicate', title: '노트 복제', group: '노트', bindings: [{ keys: 'ny', leader: true }] },
  {
    id: 'note.copy-link',
    title: '노트 내부 링크 복사',
    group: '노트',
    bindings: [{ keys: 'nl', leader: true }],
  },
  {
    id: 'backlinks.open',
    title: '백링크 패널 전환',
    group: '탐색',
    bindings: [{ keys: 'lb', leader: true }],
  },
  {
    id: 'sidebar.toggle',
    title: '왼쪽 사이드바 접기 / 펼치기',
    group: '탐색',
    bindings: [{ keys: 'sb', leader: true }],
  },
  { id: 'sidebar.navigation.compact', title: '탐색 메뉴 컴팩트 모드 전환', group: '탐색' },
  {
    id: 'database.create',
    title: '새 데이터베이스',
    group: '데이터베이스',
    bindings: [{ keys: 'dc', leader: true }],
  },
  { id: 'database.open', title: '선택한 데이터베이스 열기', group: '데이터베이스' },
  { id: 'database.rename', title: '데이터베이스 이름 변경', group: '데이터베이스' },
  { id: 'database.delete', title: '데이터베이스를 휴지통으로 이동', group: '데이터베이스' },
  {
    id: 'database.property.edit',
    title: '컬럼 속성 편집',
    group: '데이터베이스',
    bindings: [{ keys: 'dt', leader: true }],
  },
  { id: 'database.property.delete', title: '컬럼 삭제', group: '데이터베이스' },
  {
    id: 'record.create',
    title: 'DB에 새 항목',
    group: '데이터베이스',
    bindings: [{ keys: 'dn', leader: true }],
  },
  { id: 'view.notes', title: '모든 노트 열기', group: '뷰', bindings: [{ keys: 'vn', leader: true }] },
  {
    id: 'focus.left',
    title: '왼쪽 영역으로 포커스 이동',
    group: '탐색',
    bindings: [{ keys: 'Ctrl+h', leader: false }],
  },
  {
    id: 'focus.down',
    title: '아래 영역으로 포커스 이동',
    group: '탐색',
    bindings: [{ keys: 'Ctrl+j', leader: false }],
  },
  {
    id: 'focus.up',
    title: '위 영역으로 포커스 이동',
    group: '탐색',
    bindings: [{ keys: 'Ctrl+k', leader: false }],
  },
  {
    id: 'focus.right',
    title: '오른쪽 영역으로 포커스 이동',
    group: '탐색',
    bindings: [{ keys: 'Ctrl+l', leader: false }],
  },
  {
    id: 'view.graph.open',
    title: '지식 그래프 열기',
    group: '뷰',
    bindings: [{ keys: 'vg', leader: true }],
  },
  {
    id: 'view.timeline.open',
    title: '타임라인 열기',
    group: '뷰',
    bindings: [{ keys: 'vt', leader: true }],
  },
  { id: 'view.topics.open', title: '주제 모음 열기', group: '뷰', bindings: [{ keys: 'vc', leader: true }] },
  { id: 'topics.sources.toggle', title: '주제 모음 원본 정보 표시 전환', group: '뷰' },
  { id: 'view.database', title: '데이터베이스 열기', group: '뷰', bindings: [{ keys: 'vd', leader: true }] },
  {
    id: 'settings.open',
    title: '설정과 단축키',
    group: '앱',
    bindings: [
      { keys: 'Mod+,', leader: false },
      { keys: 'ss', leader: true },
    ],
  },
  { id: 'extensions.open', title: '확장 관리', group: '앱', bindings: [{ keys: 'se', leader: true }] },
  { id: 'vim.toggle', title: 'Vim 모드 전환', group: '앱', bindings: [{ keys: 'sv', leader: true }] },
  { id: 'slash.toggle', title: '슬래시 메뉴 전환', group: '앱' },
  { id: 'trash.open', title: '휴지통 열기', group: '앱' },
] as const satisfies readonly Omit<Command, 'run'>[];

export type BuiltinCommandId = (typeof definitions)[number]['id'];
export function createBuiltinCommands(handlers: Record<BuiltinCommandId, Command['run']>): Command[] {
  return definitions.map((definition) => ({ ...definition, run: handlers[definition.id] }));
}
