# 노트 속성 · frontmatter

노트 제목 아래의 속성 아이콘 또는 명령 팔레트의 **노트 속성 · frontmatter 편집**으로 시작합니다. 속성이 없는 노트에는 `tags: []`가 들어 있는 영역을 맨 위에 추가합니다. 설정에서 이 명령에 일반 단축키와 leader 조합을 지정할 수 있습니다.

```markdown
---
tags: [project, 공부]
status: 진행 중
priority: 2
done: false
date: 2026-09-17
reference: "001"
---

# 본문

이 아래부터 일반 Markdown을 작성합니다.
```

Live Preview에서는 커서가 속성 영역 밖에 있을 때 접을 수 있는 속성표로 표시합니다. 값은 YAML 형식으로 편집하고 Enter 또는 포커스 이동으로 반영합니다. Shift+Enter는 값의 줄바꿈, Escape는 해당 입력 취소입니다. 속성을 추가·삭제할 수도 있습니다. **YAML** 버튼이나 커서 이동으로 원문에 들어가면 직접 편집할 수 있으며, 원문 모드에서는 항상 YAML이 보입니다. 읽기 모드는 속성표를 읽기 전용으로 표시합니다.

문자열·숫자·참/거짓·null·목록·중첩 객체를 지원합니다. `"true"`, `"001"`처럼 문자열로 유지할 값은 따옴표로 감쌉니다. 일반 날짜는 문자열로 보관합니다. 패널의 속성 수정은 YAML 주석과 다른 속성을 유지하며, 노트 본문과 같은 자동 저장·revision 충돌 검사·실행 취소를 사용합니다.

`tags`는 태그 이름 하나 또는 문자열 목록입니다. 기존 태그 검색과 자동완성 후보에 포함되지만, frontmatter 자체를 Anki 카드나 주제 모음의 본문 블록으로 수집하지 않습니다. 그 외의 속성은 사용자 데이터입니다. `title`, `aliases`, `createdAt` 같은 사용자 속성이 앱의 제목·링크 별칭·생성일을 자동 변경하지 않습니다.

속성 영역은 노트 본문 첫 줄의 `---`와 이를 닫는 단독 `---` 줄로 구분합니다. CRLF와 BOM도 읽습니다. 닫는 구분선이 없거나 문서 중간에 나오는 구분선은 일반 Markdown입니다. YAML 오류가 있어도 원문 저장은 유지하고 패널/CLI 조회에서 오류를 표시합니다. 이름 중복·문자열이 아닌 키·alias·사용자 정의 YAML tag는 허용하지 않습니다. 표시/조회 한도는 UTF-8 64 KiB, 중첩 16단계, 유한한 수와 ±9,007,199,254,740,991 이내 정수입니다. 더 큰 정수는 문자열로 적을 수 있습니다.

기존 vault 형식은 유지합니다. 디스크의 첫 JSON 관리 헤더는 Foltra의 노트 ID·제목·시각·폴더 정보를 보관하고, 사용자 YAML은 그 뒤 **편집 가능한 노트 본문**의 시작에 저장합니다. 이 기능은 임의 Markdown 폴더 가져오기나 외부 앱의 단일 frontmatter 파일 형식으로의 변환을 포함하지 않습니다.

CLI에서도 저장된 속성을 조회할 수 있습니다.

```sh
foltra --vault ./my-vault note frontmatter --id NOTE_UUID
# {"properties":{"tags":["project","공부"],"status":"진행 중",...},"error":null}
```

frontmatter가 없으면 `properties`와 `error`가 모두 null입니다. 잘못된 YAML이면 `properties`는 null이고 `error`에 이유가 나옵니다. 조회는 파일을 변경하지 않습니다. 수정할 때는 기존 `note update --body-file ... --expected-revision ...` 경로로 전체 본문을 저장합니다.
