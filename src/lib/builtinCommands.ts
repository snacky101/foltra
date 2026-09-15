import type { Command } from './commands';
import { platformModifier } from './commands';

const definitions = [
  {
    id: 'command.palette',
    title: '명령 팔레트',
    group: '탐색',
    binding: { shortcut: platformModifier() === 'meta' ? 'Mod+k' : 'Mod+Shift+p' },
  },
  { id: 'vault.switch', title: 'Vault 선택', group: '앱', binding: { leader: 'v v' } },
  { id: 'note.create', title: '새 노트', group: '노트', binding: { shortcut: 'Mod+n', leader: 'n n' } },
  { id: 'note.find', title: '노트 찾기', group: '탐색', binding: { shortcut: 'Mod+p', leader: 'f f' } },
  { id: 'search', title: '내용 검색', group: '탐색', binding: { shortcut: 'Mod+Shift+f', leader: 'f g' } },
  { id: 'note.save', title: '현재 노트 저장', group: '노트', binding: { shortcut: 'Mod+s', leader: 'n s' } },
  { id: 'note.close', title: '현재 노트 닫기', group: '노트' },
  { id: 'note.save-close', title: '저장 후 노트 닫기', group: '노트' },
  { id: 'note.mode.live', title: 'Live Preview 모드', group: '노트' },
  { id: 'note.mode.source', title: 'Markdown 원문 모드', group: '노트' },
  { id: 'note.mode.read', title: '읽기 모드', group: '노트' },
  {
    id: 'note.preview',
    title: '편집 / 읽기 전환',
    group: '노트',
    binding: { shortcut: 'Mod+e', leader: 'n p' },
  },
  { id: 'note.link', title: '노트 연결 삽입', group: '노트', binding: { leader: 'l l' } },
  { id: 'note.query', title: 'DB 쿼리 삽입', group: '노트', binding: { leader: 'n q' } },
  { id: 'note.delete', title: '현재 노트를 휴지통으로', group: '노트' },
  { id: 'note.move', title: '노트를 폴더로 이동', group: '노트', binding: { leader: 'n m' } },
  { id: 'folder.create', title: '새 폴더', group: '폴더' },
  { id: 'folder.rename', title: '선택한 폴더 이름 변경', group: '폴더' },
  { id: 'folder.delete', title: '선택한 빈 폴더 삭제', group: '폴더' },
  { id: 'note.rename', title: '노트 이름 변경', group: '노트', binding: { shortcut: 'F2', leader: 'r n' } },
  { id: 'note.duplicate', title: '노트 복제', group: '노트', binding: { leader: 'n y' } },
  { id: 'note.copy-link', title: '노트 내부 링크 복사', group: '노트', binding: { leader: 'n l' } },
  { id: 'backlinks.open', title: '백링크 패널 전환', group: '탐색', binding: { leader: 'l b' } },
  { id: 'database.create', title: '새 데이터베이스', group: '데이터베이스', binding: { leader: 'd c' } },
  {
    id: 'database.property.edit',
    title: '컬럼 타입 변경',
    group: '데이터베이스',
    binding: { leader: 'd t' },
  },
  { id: 'record.create', title: 'DB에 새 항목', group: '데이터베이스', binding: { leader: 'd n' } },
  { id: 'view.notes', title: '모든 노트 열기', group: '뷰', binding: { leader: 'v n' } },
  { id: 'focus.left', title: '왼쪽 영역으로 포커스 이동', group: '탐색', binding: { shortcut: 'Ctrl+h' } },
  { id: 'focus.down', title: '아래 영역으로 포커스 이동', group: '탐색', binding: { shortcut: 'Ctrl+j' } },
  { id: 'focus.up', title: '위 영역으로 포커스 이동', group: '탐색', binding: { shortcut: 'Ctrl+k' } },
  { id: 'focus.right', title: '오른쪽 영역으로 포커스 이동', group: '탐색', binding: { shortcut: 'Ctrl+l' } },
  { id: 'view.graph.open', title: '지식 그래프 열기', group: '뷰', binding: { leader: 'v g' } },
  { id: 'view.timeline.open', title: '타임라인 열기', group: '뷰', binding: { leader: 'v t' } },
  { id: 'view.topics.open', title: '주제 모음 열기', group: '뷰', binding: { leader: 'v c' } },
  { id: 'view.database', title: '데이터베이스 열기', group: '뷰', binding: { leader: 'v d' } },
  { id: 'settings.open', title: '설정과 단축키', group: '앱', binding: { shortcut: 'Mod+,', leader: 's s' } },
  { id: 'extensions.open', title: '확장 관리', group: '앱', binding: { leader: 's e' } },
  { id: 'vim.toggle', title: 'Vim 모드 전환', group: '앱', binding: { leader: 's v' } },
  { id: 'slash.toggle', title: '슬래시 메뉴 전환', group: '앱' },
  { id: 'trash.open', title: '휴지통 열기', group: '앱' },
] as const satisfies readonly Omit<Command, 'run'>[];

export type BuiltinCommandId = (typeof definitions)[number]['id'];
export function createBuiltinCommands(handlers: Record<BuiltinCommandId, Command['run']>): Command[] {
  return definitions.map((definition) => ({ ...definition, run: handlers[definition.id] }));
}
