import { platformModifier } from '../lib/commands';
import { taskMarkers } from '../lib/markdownTasks';
import { TaskIcon } from './TaskIcon';

export function TaskMarkerHelp() {
  return (
    <section className="settings-section task-marker-help">
      <h2>작업 항목과 아이콘</h2>
      <p>
        <code>- [ ] 할 일</code>처럼 마커 뒤에 공백을 입력하면 아이콘으로 표시합니다. Live Preview에서
        체크박스는 클릭하여 완료·해제할 수 있고 읽기 모드와 주제 모음에서도 같습니다. 커서를 불릿·마커 안으로
        옮기면 <code>- [ ]</code> 전체가 펼쳐집니다. 다른 상태 아이콘은 클릭해 편집할 수 있습니다. 모든
        상태에서 불릿 기호와 상태 문자를 직접 수정할 수 있습니다. 커서가 벗어나면 다시 아이콘으로 표시합니다.
        Vim에서는 Insert 모드로 문자를 수정합니다.
      </p>
      <ul className="task-marker-legend">
        {taskMarkers.map(({ marker, status, label }) => (
          <li key={status}>
            <span aria-hidden="true">
              <TaskIcon status={status} />
            </span>
            <code>{`[${marker}]`}</code>
            <span>{label}</span>
          </li>
        ))}
      </ul>
      <p>
        기본 단축키 <kbd>{platformModifier() === 'meta' ? 'Cmd+L' : 'Ctrl+L'}</kbd>은{' '}
        <code>[ ] → [/] → [x] → [ ]</code> 순서로 전환합니다. 단축키는 Vim 및 단축키 설정의 ‘작업 상태
        순환’에서 바꿀 수 있습니다. 영문 마커는 대문자도 사용할 수 있습니다.
      </p>
    </section>
  );
}
