import { call } from './api';
import type { Database, Note, Row } from './types';

// Only runs after an explicit choice to create a new vault with examples.
export async function seedVault(vault: string) {
  const database = await call<Database>(vault, 'database.create', { name: 'Reading room' });
  const rows: Row[] = [];
  for (const [title, status, date] of [
    ['나만의 지식 시스템 설계하기', 'In progress', '2026-09-15'],
    ['기록을 연결하는 습관', 'To do', '2026-09-18'],
    ['생각을 정리하는 공간', 'Done', '2026-09-12'],
  ]) {
    rows.push(
      await call<Row>(vault, 'record.create', { databaseId: database.id, values: { title, status, date } }),
    );
  }
  const starters = [
    {
      title: '연결하는 기록',
      body: '# 기록은 연결될 때 자랍니다\n\n한 문장으로 시작해도 충분합니다. 떠오른 생각을 적고, 관련된 노트에 연결해 보세요.\n\n## 나만의 원칙\n\n- 작은 생각을 놓치지 않기\n- 이미 있는 기록을 다시 읽기\n- 정답보다 질문을 남기기\n\n이 문단을 다른 노트에서 참조할 수 있어요. ^principle\n',
    },
    {
      title: '키보드로 흐름 이어가기',
      body: '# 손끝에서 이어지는 생각\n\n기본 편집은 일반 입력 모드입니다. 설정에서 Vim을 켜면 **i**로 입력하고 **Esc**로 돌아올 수 있어요.\n\n| 하고 싶은 일 | 단축키 |\n| --- | --- |\n| 명령 찾기 | Mod+k |\n| 새 노트 | Space n n |\n| 그래프 열기 | Space v g |\n| 저장 | Mod+s 또는 :w |\n| 현재 노트 닫기 | :q |\n| 저장 후 닫기 | :wq |\n\n설정에서 leader 키와 모든 명령의 단축키를 바꿀 수 있습니다.\n',
    },
    {
      title: '생각의 씨앗',
      body: '# 다음에 탐구하고 싶은 것\n\n- 좋은 질문은 어디서 시작될까?\n- 지식을 정리하는 일과 연결하는 일의 차이\n- 일주일 전에 쓴 기록을 오늘 다시 읽는 이유\n\n[[연결하는 기록]]에서 생각을 이어가 봅시다.\n',
    },
    {
      title: '폴트라에 오신 것을 환영해요',
      body:
        '# A place for connected thought.\n\n**작은 기록이 모여, 나만의 지형이 됩니다.**\n\nFoltra는 노트와 데이터를 함께 다루는 로컬 지식 공간입니다. 이 노트들은 시작을 돕는 예제이며 자유롭게 수정하거나 삭제할 수 있어요.\n\n## 한 곳에서, 자연스럽게\n\n[[연결하는 기록]]에서 생각을 확장하고, [[키보드로 흐름 이어가기]]에서 나만의 조작법을 찾아보세요. 아직 정리되지 않은 생각은 [[생각의 씨앗]]에 남겨도 좋아요.\n\n## Reading room\n\n아래는 DB의 실제 데이터를 보여주는 쿼리입니다. 왼쪽 Reading room에서 값을 바꾸면 이 결과에도 반영됩니다.\n\n```foltra-query\n' +
        JSON.stringify({ databaseId: database.id, limit: 10 }, null, 2) +
        '\n```\n\n> 기록을 따라, 생각을 잇다.\n',
    },
  ];
  for (const item of starters.slice(0, -1)) await call<Note>(vault, 'note.create', item);
  const bodies = [
    '# 나만의 지식 시스템 설계하기\n\n## 목표\n\n노트, 데이터, 연결을 한 공간에서 관리합니다.\n\n## 시작하기\n\n- 관심 주제를 [[생각의 씨앗]]에 기록하기\n- 관련 내용을 [[연결하는 기록]]으로 이어가기\n',
    '# 기록을 연결하는 습관\n\n매일 한 기록을 읽고 관련된 노트에 링크를 추가해 보세요.\n\n## 오늘의 질문\n\n이 기록은 어떤 생각과 이어지나요? [[연결하는 기록]]에서 예시를 볼 수 있습니다.\n',
    '# 생각을 정리하는 공간\n\n완료한 항목에도 본문을 남겨, 결정의 이유와 배운 점을 돌아볼 수 있습니다.\n\n## 다음 기록\n\n[[키보드로 흐름 이어가기]]에서 나에게 맞는 편집 방법을 찾아보세요.\n',
  ];
  for (const [index, row] of rows.entries()) {
    await call<Note>(vault, 'record.body', {
      id: row.id,
      expectedRevision: row.revision,
      body: bodies[index],
    });
  }
  await call<Note>(vault, 'note.create', starters.at(-1)!);
}
