# Foltra의 구조와 기능 추가 방법

이 문서는 0.1 프리뷰의 **실제 코드**를 설명합니다. 전체 제품의 목표는 DESIGN.md, 진행 상황은 STATUS.md에 있습니다. 현재 선택은 Rust + Tauri 2 + React/TypeScript + CodeMirror 6입니다. Tauri와 Electron의 성능 비교 실험을 완료한 선택은 아닙니다.

## 모듈 경계

```text
React UI ── src/lib/api.ts ── Tauri execute ──┐
                                           ├─ foltra_core::execute
CLI ───── crates/cli/src/main.rs ────────────┘        │
                                  argument validation + vault lock
                                                    │
                           notes / databases / query / extensions / vault / backup
                                                    │
                                             storage::Store
                                                    │
                                  Markdown + JSON originals / derived SQLite
```

GUI와 CLI는 같은 `foltra_core::execute(path, command, args)`를 호출합니다. Tauri는 blocking 작업을 별도 작업 스레드로 옮기는 얇은 adapter입니다. CLI에는 저장 규칙을 복제하지 않습니다. 브라우저 개발 중에는 Vite adapter가 실제 CLI 프로세스를 호출하며 프로덕션 앱에 HTTP API를 포함하지 않습니다.

| 위치 | 책임 | 넣지 않을 것 |
| --- | --- | --- |
| `crates/core/src/lib.rs` | 명령 입력 계약과 분기, 공통 오류 | UI 상태, 직접 키 처리 |
| `crates/core/src/storage.rs` | vault 경로 제한, 잠금, 파일 읽기/쓰기, journal 복구 | 노트·DB의 제품 규칙 |
| `database_schema.rs` | 컬럼 변경 검사·변환 계획·snapshot revision·일괄 적용 | GUI 변환 로직, 데이터 삭제에 의한 타입 변경 |
| `folders.rs` | 가상 폴더 계층, 이름·부모 검증, revision 기반 이름 변경과 빈 폴더 삭제 | 실제 디렉터리 이동/노트 본문 변환 |
| `notes.rs`, `databases.rs` | 각 객체의 생성/수정/삭제, revision과 값 검증 | UI별 저장 로직 |
| `query.rs` | 링크 인덱스, 구조화된 쿼리, 재생성 가능한 검색 인덱스 | 임의 SQL/JS 실행 |
| `wiki.rs` | 제목/UUID 대상 해석, alias 보존, Markdown 소스 범위 기반 참조 갱신 | UI별 링크 저장 규칙 |
| `topics.rs` | Markdown 목록 경계·주제 식별·읽기 전용 카드 조회 | 원문 복제·UI 상태·임의 코드 실행 |
| `extensions.rs` | 선언형 manifest 검증·설치·명령 실행 | 커뮤니티 JS를 host에서 실행 |
| `vault.rs`, `backup.rs` | vault 구성, 설정, 휴지통, snapshot | 클라우드 인증/동기화 가정 |
| `src/lib/useNote.ts` | 편집 초안, 직렬 자동 저장, 충돌 보존 | 전역 탐색과 DB 처리 |
| `src/lib/useNoteActions.ts` | 노트 관리 전 저장, 선택 revision 유지, 이름 변경·복제·삭제 UI 흐름 | core 검증 복제, 충돌 자동 재시도 |
| `src/lib/useTreeEditing.ts`, `InlineTreeName` | 생성 후 인라인 입력, 선택 revision으로 이름 저장, 초안/포커스 복원 | 파일 직접 접근, 충돌 자동 재시도 |
| `GraphView`, `graphLayout.worker.ts`, `graphLayout.ts` | SVG 탐색, worker 생명주기, 복제한 객체의 힘 기반 배치 | vault 원본 수정, 무한 시뮬레이션 |
| `src/lib/useWorkspace.ts` | snapshot 로딩, 외부 변경 갱신, vault 선택 | 본문 편집 초안 |
| `src/lib/useTopics.ts`, `TopicsView` | 주제·페이지 요청 수명, 카드 표시, 원본 위치 탐색 | 파일 접근·Markdown 목록 경계 재구현 |
| `src/lib/builtinCommands.ts` | UI 명령 ID·제목·기본 단축키 | 이벤트 리스너 |
| `src/lib/useCommandKeys.ts` | 시간 제한 없는 leader/일반 키 이벤트 라우팅, 조합 입력 보호 | 특정 기능의 데이터 변경 |
| `src/lib/commandKey.ts`, `vimInput.ts` | 명령 문맥의 물리 키 보정, CodeMirror Vim API 연결 | Insert 본문·literal 인수 변환, OS 입력 소스 변경 |
| `src/lib/noteLinks.ts` | UI 백링크·연결 수에서 DB 본문 소속 관계 제외 | 원본 bodyNoteId 수정, 코어 관계 조회 계약 변경 |
| `Backlinks`, `workspaceFocus.ts` | 열 수 있는 링크만 탐색, 갱신 중 포커스 유지 | 노트 원본 변경 |
| `src/lib/leaderKey.ts`, `LeaderKeyRecorder` | Leader 값 파싱/기록, 키 충돌 안내, 기록 중 전역 명령 격리 | 개별 기능 실행, 파일 직접 저장 |
| `src/lib/livePreview.tsx` | CM decoration과 편집 위치별 원문 표시 | Markdown 원본 수정·별도 저장 |
| `src/lib/vimCommands.ts`, `noteCommands.ts` | 호출한 편집기로 Ex 라우팅, 저장·닫기 계약 | revision 우회 |
| `SearchDialog`, `Select`, `DateField`, `ResizableSidebar` | 검색 키 탐색, 테마 공통 입력과 패널 너비 | core 데이터 규칙 |
| `src/components/*` | 노트·DB·뷰·설정 등의 표시와 입력 | 파일시스템 접근 |
| `src/App.tsx` | 화면 전환, 선택 객체, 명령과 기능 연결 | 도메인 검증·저장 엔진 |

`src/lib/types.ts`의 프런트엔드 타입은 현재 수동 관리입니다. Rust에서 자동 생성된 스키마가 아닙니다. API 필드를 바꾸면 Rust 모델, 명령 스키마, TS 타입, 계약 테스트를 같이 수정합니다. 이를 자동 생성하는 작업은 별도 후속 과제입니다.

## 저장 원본

```text
vault/
  .foltra/
    vault.json             # vault UUID, name, formatVersion
    settings.json          # Vim, slash, leader, theme, bindings
    local/write.lock       # 동기화 대상 제외
    local/pending.json     # 다중 파일 변경 복구용; 정상 완료 시 제거
    cache/index.sqlite     # 검색용 파생 데이터; 삭제 후 재생성 가능
  notes/<uuid>.md          # JSON 형식 metadata header + Markdown body
  databases/<uuid>.json    # DB schema
  records/<uuid>.json      # 독립된 DB row, optional bodyNoteId
  extensions/<id>.json     # 검증된 선언형 plugin/theme
  trash/<uuid>.json        # 삭제된 note/row 원본과 원래 경로
```

원래 설계의 DB 하위 폴더별 행 배치 대신, 프리뷰에서는 `records/<uuid>.json`에 행을 모으고 `databaseId`로 연결합니다. 노트 제목을 파일명으로 사용하지 않으므로 이름 변경 시 파일 경로가 바뀌지 않습니다. 현재는 Foltra metadata가 있는 관리 파일만 읽습니다. 임의 Markdown 폴더의 즉시 가져오기는 지원하지 않습니다.

DB 행 생성은 JSON 파일 한 개만 만듭니다. `record.body`를 명시적으로 실행할 때 새 노트 생성과 `bodyNoteId` 변경을 같은 journal로 기록합니다. 기존 노트 연결도 가능하며, 행을 삭제해도 본문 노트를 함께 삭제하지 않습니다. 본문 노트를 삭제한 행에는 새 본문을 연결할 수 있습니다.

노트 수정·삭제와 행 수정·삭제·본문 연결은 `expectedRevision`이 필수입니다. revision은 원본 파일 전체의 SHA-256입니다. 서로 다른 Foltra 프로세스는 같은 vault 잠금으로 직렬화합니다. 쓰기는 복구 journal → 임시 파일 write/fsync → rename → 디렉터리 fsync → journal 제거 순서입니다. 복구 시 원본이 journal의 before/after 어느 쪽에도 일치하지 않으면 외부 내용을 덮어쓰지 않고 중단합니다.

**한계:** OS 잠금을 무시하고 직접 파일을 쓰는 외부 편집기와의 모든 경쟁 상태를 방지하지는 않습니다. 현재 symlink 검사는 검사 직후 경로를 바꾸는 악성 로컬 프로세스에 대한 완전한 방어가 아닙니다. 강제 종료·전원 장애·다른 파일시스템의 내구성 검증은 별도로 필요합니다. journal 회복 테스트는 중간 상태 fixture로 수행했습니다.

## 실제 실행 흐름

### 노트 저장

1. `Editor.tsx`의 변경을 `useNote.edit()`가 초안으로 보관합니다.
2. 650ms 후 또는 저장 명령으로 `useNote.save()`가 읽어둔 revision과 초안을 보냅니다. 한 편집기에서 저장 요청은 직렬화됩니다.
3. core의 `note.update`는 인자와 revision을 검사하고 [제목 링크/alias 규칙](LINKS.md)으로 저장합니다. 제목 변경은 `notes::plan_note_write`가 영향을 받는 참조 갱신과 묶어 하나의 Store journal로 commit합니다.
4. 성공하면 base revision과 화면 snapshot을 갱신합니다. 저장 중 새 입력이 있었다면 초안은 유지하고 다음 저장 대상으로 남깁니다.
5. 충돌이면 초안을 유지하며 사본 저장 또는 다시 읽기를 제공합니다. 새 revision을 몰래 가져와 덮어쓰지 않습니다.

### 확장 명령과 단축키

1. JSON 설치 시 `extensions.rs`가 허용 필드, command/action, theme token을 검사합니다. 읽을 때도 다시 검사합니다.
2. core `commands.list`가 `plugin.<extension-id>.<command-id>`를 반환합니다. UI도 같은 ID를 팔레트와 단축키 설정에 등록합니다.
3. `useCommandKeys`는 조합 입력·편집 모드·modal 상태를 고려해 명령 하나를 실행합니다. 키 목록은 각 화면에 흩어 두지 않습니다.
4. template 명령은 GUI/CLI 모두 core에서 노트를 생성합니다. query 명령은 CLI에서 결과를, UI에서는 DB 뷰를 제공합니다. view 명령은 UI에서 화면을 전환하며 CLI에서는 `requires_ui`를 반환합니다.
5. 제거 시 확장 manifest만 제거합니다. 만들어진 사용자 노트·DB를 삭제하지 않습니다.

프리뷰의 plugin action은 `template`, `query`, 내장 `view`입니다. 외부 코드로 새 renderer나 property type을 등록하는 SDK는 아직 없습니다. 테마는 지정된 색상 token만 바꿀 수 있습니다. 이것을 임의 코드를 안전하게 실행하는 sandbox로 설명해서는 안 됩니다.

## 새 기능을 추가할 때

**데이터 기능**은 해당 core 모듈 → `commands.json`의 인자 계약 → `lib.rs`의 분기 → 임시 vault를 사용하는 계약 테스트 순서로 추가합니다. 수정 기능은 revision 조건과 중간 실패 시 남는 파일을 먼저 정합니다. generic CLI 경로를 통해 새 명령을 실행할 수 있으므로 CLI에 저장 로직을 또 작성하지 않습니다.

**UI 기능**은 해당 component/hook에 구현하고, 키로 호출할 동작은 `builtinCommands.ts`에 등록한 뒤 App의 typed handler map에 연결합니다. handler 누락은 TypeScript가 검사합니다. 설정의 단축키 목록과 팔레트는 이 목록을 공유합니다. 모든 내부 API를 사용자 단축키로 노출하는 것은 아닙니다.

**새 뷰 종류**를 추가하려면 현재 `KnowledgeViews` 또는 별도 component를 만들고 View 타입·navigation·명령을 연결합니다. 커뮤니티 뷰 SDK를 열기 전에는 접근 가능한 데이터, command 전달, UI 격리, 실행 중단과 자원 제한을 별도로 설계해야 합니다.

**새 속성 종류**는 Rust 값 검증, 쿼리 의미, TS 타입, Cell 편집기, export/import 호환성을 함께 추가합니다. 단지 UI selector에 항목을 넣는 것으로 완료하지 않습니다.

**동기화**를 넣을 때는 현재 파일 포맷과 journal/local/cache 경계를 유지하되, 원격 병합을 즉시 원본에 적용하지 않습니다. revision 비교, schema·ID 검증, 사용자에게 보여줄 충돌 해결 결과가 필요합니다. 현재는 Git 저장에 적합한 텍스트 원본과 제외 규칙만 있으며 sync adapter는 없습니다.

## 성능과 보안의 현재 경계

그래프는 노트 ID·제목·연결로 구성한 입력이 바뀔 때만 worker에서 d3-force를 실행합니다. 반발력·연결력·충돌 반경과 약한 중심력을 300 tick 적용하고 worker를 종료합니다. 중복·역방향 링크는 한 선으로 합치고 보이지 않는 대상과 자기 연결은 배치에서 제외합니다. 전체 범위를 맞춘 뒤 UI에서 pan/zoom·강조·제목 겹침 회피를 처리합니다. 120개 상한을 유지하며, 입력 변경과 unmount 시 이전 worker를 종료합니다. 모든 교차선을 없애는 알고리즘이나 대형 graph 벤치마크는 아닙니다.

화면은 편집기와 읽기 renderer를 지연 로딩합니다. DB 결과 페이지는 100행, 쿼리 응답 상한은 500행, 그래프는 120개 노트입니다. 그러나 snapshot은 3초마다 원본을 스캔하고 모든 행 요약을 반환하며, DB 쿼리는 메모리에서 필터링합니다. 이것은 대용량 최종 구조가 아닙니다. 증분 인덱스와 구독 API 도입 여부는 규모별 측정 후 결정합니다.

Markdown의 raw HTML과 원격 이미지 자동 로딩을 사용하지 않습니다. 테마에 외부 URL·CSS를 허용하지 않고, core의 경로와 인자를 검증합니다. native IPC는 설치된 앱과 같은 사용자 권한을 가진 신뢰 경계입니다. vault 자체 암호화, 공격자에 의한 로컬 파일 변조 방지, 커뮤니티 코드 sandbox는 제공하지 않습니다.

유지보수 기준은 계층 수를 늘리는 것이 아니라 규칙의 소유자를 한 곳으로 모으는 것입니다. 실제 두 번째 구현이 생기기 전에는 별도 저장소 추상화, sync framework, 범용 plugin VM을 추가하지 않습니다.

## 편집기와 화면 상태

주제 모음은 [TOPICS.md](TOPICS.md)의 목록 범위/그룹 계약을 사용합니다. 코어의 `topics.list`/`topics.blocks`는 CLI에서도 사용할 수 있습니다. 카드의 원본 버튼은 노트 본문의 1-based 행을 기존 `openNote` 경로에 전달합니다. 편집기는 mount effect가 안정된 다음 프레임에 준비 완료를 알리고, cleanup은 이전 알림을 취소합니다. 개발 StrictMode의 편집기 재생성이 대기 중인 커서 이동을 먼저 소비하지 않도록 한 규칙입니다.

새 vault는 `vim: false`, `editorMode: live`로 시작합니다. 기존의 명시적 Vim 설정은 유지합니다. live/source 전환은 CodeMirror compartment를 재설정하며 같은 문서와 undo history를 사용합니다. 읽기 모드는 별도 renderer입니다. Live Preview의 decoration은 원문을 변경하지 않고 활성 줄/블록 및 선택 범위를 원문으로 드러냅니다. 표·쿼리는 기존 NotePreview를 재사용합니다. 위키링크와 웹 링크는 편집 중 Ctrl/Cmd+클릭으로 열 수 있습니다.

Vim의 전역 Ex 등록은 WeakMap으로 호출한 편집기 handler에 연결합니다. `:w`는 저장, `:q`는 현재 노트 닫기, `:wq`/`:x`는 저장 후 닫기입니다. 저장 실패/충돌은 강제 저장으로 우회하지 않습니다. `:q!`는 진행 중 저장이 끝나기를 기다린 뒤 미저장 초안만 버리며, 이미 자동 저장한 내용을 되돌리지는 않습니다. 현재 노트 외 파일 경로와 범위 저장은 거절합니다.

최근 vault 목록과 사이드바 너비는 앱의 기기별 localStorage에 보관합니다. vault 설정이나 Git 동기화 원본에는 넣지 않습니다. Vault 전환은 현재 초안을 저장하고 대상 workspace를 성공적으로 읽은 뒤 화면을 바꾸므로, 실패한 경로 선택이 현재 workspace를 비우지 않습니다. 최근 목록은 이 앱에서 열었던 경로이며 디스크 전체를 자동 탐색하지 않습니다.

`useVaultLocation`은 Welcome과 VaultPicker의 생성 경로 초안을 공유합니다. 현재/최근 vault의 상위 폴더, 없으면 core `vault.default`의 상위 폴더를 기준으로 이름을 붙입니다. `vaultLocation`은 경로 구분자와 폴더명 제안을 계산하며 파일을 만들지 않습니다. 폴더 선택은 생성할 상위 위치를 바꾸고 이름 자동 반영을 유지합니다. 전체 경로를 직접 수정하면 그 경로를 우선하며 늦게 도착한 기본 위치 응답으로 덮어쓰지 않습니다. `VaultPathField`는 경로 입력과 우측 폴더 버튼의 공통 배치만 담당합니다. 기존 vault 열기의 폴더 선택은 선택한 경로를 그대로 사용하며, 생성 초안과 별도입니다. 실제 생성은 기존 `useWorkspace.create` → core `vault.init`을 유지합니다.

내용 검색은 query별 응답 수명을 관리해 이전 검색 응답을 무시하고, 검색어가 바뀌는 즉시 이전 선택을 비웁니다. 입력칸의 focus를 유지하면서 결과의 aria-activedescendant와 스크롤을 갱신합니다. 목록이 비었거나 한글 조합 중이면 Enter로 노트를 열지 않습니다.

## 데이터베이스 컬럼 변경

`database.property.preview`는 원본 스키마와 DB 전체 행을 읽어 변환 계획을 만듭니다. 반환값은 `revision`, `property`, `rowCount`, `changedRows`, `errorCount`, `errors`, `canApply`입니다. revision은 스키마 원문과 행 ID/revision 목록을 묶은 SHA-256이며, 일반 행의 revision과는 다른 변경 범위를 가집니다. 조회는 파일을 변경하지 않습니다.

`database.property.update`에는 같은 `databaseId`/`property`와 미리보기의 `expectedRevision`을 보냅니다. 코어가 잠금 안에서 다시 계산한 revision이 다르면 충돌을 반환합니다. 변환 불가 값이 하나라도 있으면 전체 적용을 거절합니다. 성공 시 스키마와 값이 실제로 달라진 행을 하나의 journal로 commit하며, 본문 링크와 Markdown 파일은 유지합니다. persisted Database/Record 포맷은 바꾸지 않습니다. 코어는 GUI와 CLI에서 같은 경로를 사용합니다.

`PropertyEditor`는 검사 결과와 실패 예시를 표시합니다. 검사 이후 충돌은 자동 재시도로 우회하지 않습니다. `ColumnHeader`가 크기 조절 입력을 받고 `DatabaseView`는 property ID로 너비를 저장합니다. 이름 셀의 본문 버튼은 기존 `openBody` 경로를 호출하므로, 본문을 열기 전까지 새 노트가 필요 없는 모델을 유지합니다.

## 폴더와 휴지통 갱신

폴더는 `folders/<uuid>.json`의 `{id,name,parentId}`로 저장합니다. 노트 metadata의 선택적 `folderId`가 소속을 나타내며 기존 노트는 그대로 최상위에 표시됩니다. 제목·폴더 변경은 UUID 파일 경로를 바꾸지 않습니다. 폴더 이동은 본문 참조를 바꿀 필요가 없으며, 제목 변경은 연결된 본문의 대상을 함께 갱신합니다. 폴더 삭제는 활성 노트와 하위 폴더가 없는 경우만 허용합니다. 휴지통의 노트가 참조하던 폴더가 없어졌다면 최상위로 복원합니다. 백업은 폴더 파일을 포함하고, import는 누락된 부모/노트 폴더·순환 계층을 쓰기 전에 거절합니다. 예전 백업은 폴더 없이 그대로 읽힙니다. 이전 앱 버전으로의 downgrade 보존은 아직 보장하지 않습니다.

`workspace.get`은 노트·DB·폴더·휴지통 요약을 같은 잠금 아래에서 반환합니다. `TrashView`는 이 snapshot을 바로 렌더링하며 별도 목록 캐시를 갖지 않습니다. 앱 내부 쓰기는 완료 직후 `refresh()`하고, CLI 등 외부 변경은 기존 3초 주기의 workspace 갱신에 반영됩니다. 휴지통 본문은 snapshot에 넣지 않습니다.

`NoteTree`는 트리 표시와 접기 상태, `FolderDialog`는 폴더 수정과 노트 이동 입력을 담당합니다. 노트 이동 전 미저장 초안 저장과 revision 확인은 `useNoteActions`가 담당합니다. 노트·폴더·DB 행 메뉴는 `ContextMenu`의 포커스/키보드 동작을 공유합니다. `workspaceFocus`가 영역 이동과 sidebar 탐색을 처리하며 모든 단축키는 기존 공통 command router를 거칩니다.

### 노트 드래그 이동

`NoteTree`는 현재 트리에서 시작한 note ID를 ref에 보관합니다. drop payload는 노트 정보로 역직렬화하지 않습니다. 폴더 행 또는 NOTES 루트 영역에서만 이동할 수 있고, 같은 위치는 제외합니다. 드롭 시점의 workspace note snapshot을 `useNoteActions.moveTo`에 전달하면 공통 busy guard가 중복 실행을 막고 `moveNoteToFolder`가 편집 초안 저장 후 `expectedRevision`과 `folderId`만 core로 보냅니다. 성공 전 트리를 임의로 옮기지 않습니다. 대상 폴더 유효성 및 충돌 검사는 기존 core가 담당합니다. 컨텍스트 메뉴의 이동도 같은 함수로 처리합니다.

키 바인딩 설정은 `shortcutVersion: 2`에서 대문자를 Shift 조합으로 해석합니다. Core는 버전 필드가 없거나 1인 설정의 단축키 마지막 알파벳만 소문자로 정규화해 기존 의미를 보존합니다. 읽기는 원본 파일을 변경하지 않으며 다음 `settings.update`에서만 새 버전으로 저장합니다. 새 버전 설정의 대소문자는 그대로 보존하고 알 수 없는 버전은 거절합니다. 버전 2를 모르는 구버전 앱으로의 downgrade는 지원하지 않습니다.
