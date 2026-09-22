# Foltra의 구조와 기능 추가 방법

이 문서는 0.1 프리뷰의 **실제 코드**를 설명합니다. 전체 제품의 목표는 DESIGN.md, 진행 상황은 STATUS.md에 있습니다. 현재 선택은 Rust + Tauri 2 + React/TypeScript + CodeMirror 6입니다. Tauri와 Electron의 성능 비교 실험을 완료한 선택은 아닙니다.

CLI의 사용 계약은 [CLI.md](CLI.md)에 있습니다. `crates/cli/src/catalog.rs`는 코어 스키마 기반 도움말·별칭·쉘 자동완성, `arguments.rs`는 타입별 옵션·파일 입력, `output.rs`는 출력 형식을 담당합니다. 저장 변환은 `core/src/note_actions.rs`(본문 추가·일지), `markdown_query.rs`(할 일·아웃라인·문맥 검색), `frontmatter.rs`(속성 소스 편집)에 두며 어댑터에 별도 저장 규칙을 만들지 않습니다.

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

macOS의 `foltra PATH`/`foltra open PATH`는 코어의 `path.resolve`로 기존 볼트 또는 관리되는 노트 경로를 검증한 뒤 Launch Services에 앱 열기를 요청합니다. 일반 데이터 명령과 RPC는 headless 실행을 유지합니다. Native `RunEvent::Opened`의 파일 경로는 `open_paths` 큐에 보관하고, 프론트엔드가 이벤트를 구독한 뒤 `take_open_paths`로 받습니다. `useDesktopOpenPaths`는 요청을 직렬 처리하며 경로 재검증·현재 초안 저장·업데이트 상태 확인을 거쳐 기존 workspace/note 탐색에 전달합니다. 이 경로는 일반 Markdown을 가져오거나 새 볼트를 만들지 않습니다.

| 위치 | 책임 | 넣지 않을 것 |
| --- | --- | --- |
| `crates/core/src/lib.rs` | 명령 입력 계약과 분기, 공통 오류 | UI 상태, 직접 키 처리 |
| `crates/core/src/storage.rs` | vault 경로 제한, 잠금, 파일 읽기/쓰기, journal 복구 | 노트·DB의 제품 규칙 |
| `database_schema.rs` | 컬럼 변경 검사·변환 계획·snapshot revision·일괄 적용 | GUI 변환 로직, 데이터 삭제에 의한 타입 변경 |
| `folders.rs` | 가상 폴더 계층, 이름·부모 검증, revision 기반 이름 변경 | 실제 디렉터리 이동/노트 본문 변환 |
| `notes.rs`, `databases.rs` | 각 객체의 생성/수정/삭제, revision과 값 검증 | UI별 저장 로직 |
| `query.rs` | 링크 인덱스, 기존 JSON 쿼리, 재생성 가능한 검색 인덱스 | 사용자 SQL 실행·JS 실행 |
| `sql_query.rs` | 이름 기반 쿼리 catalog, 읽기 전용 SQL 검증, 임시 DuckDB 테이블·결과 제한 | 원본 수정, 외부 DB 연결·파일·네트워크 접근 |
| `sql_rename.rs` | 컬럼 이름 변경에 따른 저장된 SQL 식별자 참조 분석·원문 범위 갱신 | 문자열 일괄 치환, 확장 코드 변경, 모호한 참조 추측 |
| `SqlQuery`, `SqlQueryDialog`, `src/lib/sqlQuery.ts` | SQL 삽입·표 표시, 요청 수명과 DB 변경 갱신, 쿼리 fence 구분 | UI별 SQL 평가·저장 규칙 |
| `wiki.rs` | 제목/UUID 대상 해석, alias 보존, Markdown 소스 범위 기반 참조 갱신 | UI별 링크 저장 규칙 |
| `topics.rs`, `topic_order.rs` | Markdown 문단·목록 경계·주제 식별·카드 조회·revision 기반 표시 순서와 내용 대응 | 원문 복제·UI 상태·임의 코드 실행 |
| `extensions.rs`, `plugin_manifest.rs` | 선언형/코드 manifest·SDK 버전·뷰 스키마 검증, 설치·공통 명령 | 앱 DOM에 커뮤니티 코드 주입 |
| `plugin_runtime.rs`, `plugin_sdk.js` | 제한된 QuickJS 실행, 선언 권한·기기별 최초 동의와 실행 상태, 코어 API, 전용 데이터 revision | 임의 파일/네트워크/시스템 API·UI thread 실행 |
| `usePlugins`, `pluginSession`, `PluginView`, `pluginEditor` | 플러그인 세션·이벤트·뷰 렌더링·늦은 편집 결과 검사 | 독자 노트/DB 저장 규칙 |
| `PluginSettingsForm`, `PluginSettingsView`, `ExtensionsView` | 확장별 설정 페이지, 선언형 입력·revision 저장, 같은 세션의 동적 설정 뷰 | 별도 플러그인 실행 엔진·권한 우회·동기화 데이터 복제 |
| `anki_bridge.rs`, `examples/code/anki` | 제한된 로컬 AnkiConnect 전송 / 별도 코드 패키지의 원본 매핑·충돌·동기화 화면 | 일반 네트워크 접근·카드 삭제·개인 덱 자동 선택 |
| `attachments.rs`, `imagePaste.ts`, `AttachmentImage` | 이미지 형식·크기·경로 검증과 파일 저장 / 비동기 붙여넣기 위치 추적 / 로컬 이미지 표시 | 클립보드 상시 감시, 외부 이미지 자동 다운로드, 임의 파일 경로 읽기 |
| `tags.rs`, `noteTags.ts`, `remarkTags.ts` | Markdown 태그 식별·블록 조회·칩 표시·정확한 태그 검색, 공유 fixture | 노트 원문 태그 변환·코드/URL 속 태그 인식 |
| `vault.rs`, `backup.rs` | vault 구성, 설정, 휴지통, snapshot | 클라우드 인증/동기화 가정 |
| `src/lib/useNote.ts` | 편집 초안, 직렬 자동 저장, 충돌 보존 | 전역 탐색과 DB 처리 |
| `src/lib/useNoteActions.ts` | 노트 관리 전 저장, 선택 revision 유지, 이름 변경·복제·삭제 UI 흐름 | core 검증 복제, 충돌 자동 재시도 |
| `database_lifecycle.rs`, `src/lib/useDatabaseActions.ts` | DB 이름 변경·전체 행 휴지통/복원 검증과 UI 확인·갱신 연결 | 연결된 노트 삭제, 충돌 자동 재시도 |
| `folder_lifecycle.rs`, `DeleteFolderDialog` | 하위 트리 revision·개수 검사, 초안 저장 후 폴더 묶음 삭제·복원 | 확인 이후 새로 생긴 내용을 묵시적으로 삭제 |
| `frontmatter.rs`, `src/lib/frontmatter.ts`, `FrontmatterPanel` | 사용자 YAML 속성의 제한된 파싱, 태그 조회, 원문/속성표 편집 | 앱 관리 헤더 변경, YAML을 실행하거나 본문 링크로 수집 |
| `src/lib/useTreeEditing.ts`, `InlineTreeName` | 생성 후 인라인 입력, 선택 revision으로 이름 저장, 초안/포커스 복원 | 파일 직접 접근, 충돌 자동 재시도 |
| `GraphView`, `graphLayout.worker.ts`, `graphLayout.ts` | SVG 탐색, worker 생명주기, 복제한 객체의 힘 기반 배치 | vault 원본 수정, 무한 시뮬레이션 |
| `src/lib/useWorkspace.ts` | snapshot 로딩, 외부 변경 갱신, vault 선택·등록 목록 제거 | 본문 편집 초안, 실제 vault 파일 삭제 |
| `src/lib/useTopics.ts`, `TopicsView` | 주제·페이지 요청 수명, 카드 표시, 원본 위치 탐색 | 파일 접근·Markdown 블록 경계 재구현 |
| `src/lib/builtinCommands.ts` | UI 명령 ID·제목·기본 단축키 | 이벤트 리스너 |
| `src/lib/useCommandKeys.ts` | 시간 제한 없는 leader/일반 키 이벤트 라우팅, 조합 입력 보호 | 특정 기능의 데이터 변경 |
| `src/lib/vimKeybindings.ts` | 설정의 Normal 조합과 서식 명령의 Visual 조합을 Vim 엔진에 등록·해제하고 공통 명령으로 전달 | 별도 전역 키 리스너, Insert 입력 처리 |
| `markdownFormatting.ts`, `vimTextObjectRanges.ts`, `vimTextObjects.ts`, `markdownUnderline.ts`, `remarkUnderline.ts` | 서식 transaction·순수 text object 범위 탐색과 Vim 매핑·정확한 밑줄 태그의 안전한 표시 | 별도 저장/undo 엔진, 임의 HTML 실행 |
| `src/lib/commandKey.ts`, `vimInput.ts` | 명령 문맥의 물리 키 보정, CodeMirror Vim API 연결 | Insert 본문·literal 인수 변환, OS 입력 소스 변경 |
| `src/lib/noteLinks.ts` | UI 백링크·연결 수에서 DB 본문 소속 관계 제외 | 원본 bodyNoteId 수정, 코어 관계 조회 계약 변경 |
| `Backlinks`, `workspaceFocus.ts` | 열 수 있는 링크만 탐색, 갱신 중 포커스 유지 | 노트 원본 변경 |
| `src/lib/leaderKey.ts`, `LeaderKeyRecorder` | Leader 값 파싱/기록, 키 충돌 안내, 기록 중 전역 명령 격리 | 개별 기능 실행, 파일 직접 저장 |
| `src/lib/livePreview.tsx`, `livePreviewLayout.ts`, `styles/typography.css` | CM decoration, 활성 줄 원문, 읽기/편집 공통 서체·블록 간격 | Markdown 원본 수정·별도 저장 |
| `src/lib/markdownTables.ts`, `livePreviewTable.tsx`, `tableContextMenu.tsx` | GFM 구문 트리의 셀 범위, 표의 키보드·마우스 탐색/편집, CM transaction으로 셀·행·열 수정, 공통 ContextMenu 재사용 | 별도 저장/undo 엔진, React 렌더링 중 조합 입력 DOM 교체 |
| `src/lib/markdownEditing.ts` | Markdown Enter의 한 줄 목록 이어쓰기, 원래 번호/들여쓰기 처리 유지 | 저장 본문 일괄 변환, 독자 Markdown parser |
| `src/lib/editorCursor.ts`, `cursorAppearance.ts`, `cursorMotion.ts` | 커서 좌표 측정·모드별 모양·점멸·이동 효과와 수명 관리 | 문서·선택 변경, 전역 키 처리, 프레임별 React 상태 갱신 |
| `src/lib/wikiCompletion.ts`, `wikiLinkNavigation.ts` | 편집기 자동완성·괄호/alias 보존, 클릭·커서 위치의 링크 대상 해석 | 노트 직접 생성, 전역 키 처리 |
| `src/lib/useOpenWikiLink.ts` | 초안 저장 후 링크 열기, core 생성 결과와 화면 연결 | 도메인 생성 규칙·충돌 우회 |
| `src/lib/openExternalLink.ts` | HTTP(S)/mailto 검증, Tauri OS opener 또는 개발 브라우저 열기 | 임의 파일·프로토콜 실행, 노트 생성 |
| `src/lib/vimCommands.ts`, `noteCommands.ts` | 호출한 편집기로 Ex 라우팅, 저장·닫기 계약 | revision 우회 |
| `SearchDialog`, `Select`, `DateField`, `ResizableSidebar` | 검색 키 탐색, 테마 공통 입력과 패널 너비 | core 데이터 규칙 |
| `src/components/*` | 노트·DB·뷰·설정 등의 표시와 입력 | 파일시스템 접근 |
| `src/App.tsx` | 화면 전환, 선택 객체, 명령과 기능 연결 | 도메인 검증·저장 엔진 |
| `useAppUpdates`, `appUpdateSave`, `coreRequestBarrier`, `AppUpdatesPanel`, `src-tauri/src/updates.rs` | 앱 업데이트 상태·설치 전 저장과 요청 정착·설치 중 종료 보호, Tauri의 서명 검증·다운로드·번들 교체 연결 | vault 설정에 기기 업데이트 상태 저장, 확장에 앱 설치 권한 부여, 자동 설치 |

`src/lib/types.ts`의 프런트엔드 타입은 현재 수동 관리입니다. Rust에서 자동 생성된 스키마가 아닙니다. API 필드를 바꾸면 Rust 모델, 명령 스키마, TS 타입, 계약 테스트를 같이 수정합니다. 이를 자동 생성하는 작업은 별도 후속 과제입니다.

## 저장 원본

```text
vault/
  .foltra/
    vault.json             # vault UUID, name, formatVersion
    settings.json          # Vim, slash, leader, theme, bindings
    topic-order.json       # 주제별 사용자 지정 카드 순서와 내용 해시
    local/write.lock       # 동기화 대상 제외
    local/pending.json     # 다중 파일 변경 복구용; 정상 완료 시 제거
    cache/index.sqlite     # 검색용 파생 데이터; 삭제 후 재생성 가능
  notes/<uuid>.md          # JSON 형식 metadata header + Markdown body
  attachments/<sha256>.*   # 클립보드 이미지 원본 (PNG/JPEG/GIF/WebP)
  databases/<uuid>.json    # DB schema
  records/<uuid>.json      # 독립된 DB row, optional bodyNoteId
  extensions/<id>.json     # 검증된 선언형/코드 plugin/theme
  plugin-data/<id>.json    # 플러그인 전용 설정·데이터, revision 및 백업 대상
  trash/<uuid>.json        # 삭제된 note/row, DB+행 또는 폴더+하위 트리 묶음의 원본·경로
```

원래 설계의 DB 하위 폴더별 행 배치 대신, 프리뷰에서는 `records/<uuid>.json`에 행을 모으고 `databaseId`로 연결합니다. 노트 제목을 파일명으로 사용하지 않으므로 이름 변경 시 파일 경로가 바뀌지 않습니다. 현재는 Foltra metadata가 있는 관리 파일만 읽습니다. 임의 Markdown 폴더의 즉시 가져오기는 지원하지 않습니다.

DB 행 생성은 JSON 파일 한 개만 만듭니다. `record.body`를 명시적으로 실행할 때 새 노트 생성과 `bodyNoteId` 변경을 같은 journal로 기록합니다. 기존 노트 연결도 가능하며, 행을 삭제해도 본문 노트를 함께 삭제하지 않습니다. 본문 노트를 삭제한 행에는 새 본문을 연결할 수 있습니다.

`database.inspect`는 스키마·소속 행의 원본으로 revision과 행 수를 반환합니다. `database.rename`과 `database.delete`는 이 revision을 요구합니다. DB 삭제는 스키마와 소속 행을 하나의 휴지통 항목으로 journal 처리하며, 복원은 모든 경로·행 소유권·대상 충돌을 확인한 뒤 함께 수행합니다. 연결된 노트는 유지합니다. 휴지통 파일 제한인 16 MiB를 넘는 묶음은 삭제 전 거절하며, 먼저 개별 삭제한 행은 DB를 복원한 뒤 복원할 수 있습니다.

`folder.inspect`는 하위 폴더·노트까지 포함한 revision을 반환하고 `folder.delete`가 이를 확인합니다. 휴지통에는 원본 트리와 노트를 한 묶음으로 보관합니다. 복원 위치 충돌은 덮어쓰지 않으며 원래 부모 폴더가 없으면 최상위로 복원합니다. 여러 노트의 링크와 주제 정체성 변경은 단일 `plan_note_batch`로 계산해 중복 쓰기를 피합니다. 사용자 frontmatter는 관리 JSON 헤더 뒤의 `Note.body`에 그대로 보관하며 기존 파일 형식은 변환하지 않습니다([계약과 사용법](FRONTMATTER.md)).

노트 수정·삭제와 행 수정·삭제·본문 연결은 `expectedRevision`이 필수입니다. revision은 원본 파일 전체의 SHA-256입니다. 서로 다른 Foltra 프로세스는 같은 vault 잠금으로 직렬화합니다. 쓰기는 복구 journal → 임시 파일 write/fsync → rename → 디렉터리 fsync → journal 제거 순서입니다. 복구 시 원본이 journal의 before/after 어느 쪽에도 일치하지 않으면 외부 내용을 덮어쓰지 않고 중단합니다.

**한계:** OS 잠금을 무시하고 직접 파일을 쓰는 외부 편집기와의 모든 경쟁 상태를 방지하지는 않습니다. 현재 symlink 검사는 검사 직후 경로를 바꾸는 악성 로컬 프로세스에 대한 완전한 방어가 아닙니다. 강제 종료·전원 장애·다른 파일시스템의 내구성 검증은 별도로 필요합니다. journal 회복 테스트는 중간 상태 fixture로 수행했습니다.

### 이미지 첨부

`attachment.import {data}`는 base64 이미지 바이트의 실제 형식과 크기를 확인하고 `attachments/<sha256>.<확장자>`에 저장합니다. 같은 바이트는 파일을 재사용하고, 기존 해시 경로의 내용이 다르면 덮어쓰지 않습니다. PNG/JPEG/GIF/WebP, 파일당 10 MiB, 4천만 픽셀 이하이며 각 변은 16384px 이하입니다. `attachment.read {path}`는 관리되는 해시 경로와 내용이 일치하는 이미지만 반환합니다. 확장 SDK에는 새 파일 읽기 권한을 자동으로 부여하지 않습니다.

편집기는 이미지 저장이 완료된 뒤 `![이미지](../attachments/…)`를 한 번의 실행 취소가 가능한 변경으로 삽입합니다. 노트 Markdown 파일을 기준으로 한 상대 경로이므로 vault 폴더를 옮겨도 연결됩니다. 비동기 작업 중 다른 편집은 삽입 위치에 반영하고, 노트 전환·영역 교체·실행 취소 시 취소합니다. 이미지 저장을 기다리는 동안 한글 조합을 시작했으면 조합 완료 후 삽입합니다. 읽기 모드와 Live Preview는 코어에서 읽은 이미지 데이터만 표시하며 원격 URL·SVG·임의 로컬 경로는 자동 로드하지 않습니다.

이미지 저장은 바이너리 항목을 지원하는 복구 journal v2를 사용합니다. 텍스트만 저장할 때는 v1을 유지하고 두 버전을 복구할 수 있습니다. 이미지가 있는 `vault.export`는 base64 `attachments` 맵을 포함하는 snapshot v2를 반환하며, v1 백업도 계속 가져올 수 있습니다. 복원은 모든 경로·해시·이미지 데이터를 검증한 뒤 텍스트와 바이너리를 같은 journal로 처리합니다. 백업 파일의 기존 CLI 입력 제한(16 MiB, RPC 18 MiB)은 유지되므로 큰 vault는 폴더 전체를 복사하거나 Git으로 보관할 수 있습니다. 링크 삭제나 실행 취소로 파일을 자동 삭제하지 않습니다. 다른 노트·휴지통·편집 이력의 참조를 보존하기 위한 동작이며 첨부파일 정리 UI는 아직 없습니다.

## 실제 실행 흐름

### 노트 저장

1. `Editor.tsx`의 변경을 `useNote.edit()`가 초안으로 보관합니다.
2. 650ms 후 또는 저장 명령으로 `useNote.save()`가 읽어둔 revision과 초안을 보냅니다. 한 편집기에서 저장 요청은 직렬화됩니다.
3. core의 `note.update`는 인자와 revision을 검사하고 [제목 링크/alias 규칙](LINKS.md)으로 저장합니다. 제목 변경은 `notes::plan_note_write`가 영향을 받는 참조 갱신과 묶어 하나의 Store journal로 commit합니다.
4. 성공하면 base revision과 화면 snapshot을 갱신합니다. 저장 중 새 입력이 있었다면 초안은 유지하고 다음 저장 대상으로 남깁니다.
5. 충돌이면 초안을 유지하며 사본 저장 또는 다시 읽기를 제공합니다. 새 revision을 몰래 가져와 덮어쓰지 않습니다.

### 노트의 SQL 조회

`query.catalog`는 활성 DB와 컬럼의 표시 이름을 SQL 식별자로 제공하고, 이스케이프한 `SELECT` 예제를 함께 반환합니다. ASCII 대소문자를 무시한 중복 이름이나 컬럼의 예약 메타데이터 이름 충돌은 ID 접미사로 구분합니다. `query.sql {sql}`은 GUI와 CLI가 공유하는 읽기 전용 명령입니다. 기존 `query.run`의 JSON 계약은 유지합니다.

`sql_query.rs`는 PostgreSQL 문법 parser로 단일 조회를 검사하고 다시 직렬화한 뒤, 요청마다 새 in-memory DuckDB에 활성 DB/행의 사본을 적재해 평가합니다. 테이블은 엔진 내장 테이블 이름과 충돌하지 않도록 `vault` schema에 만들고 `search_path`를 지정하므로 사용자는 DB 이름만으로 조회할 수 있습니다. 원본 Markdown·JSON과 기존 SQLite 검색 인덱스를 대체하지 않습니다. 컬럼 이름 변경은 별도 `sql_rename.rs`에서 노트 속 SQL 참조를 갱신하며, DB 자체의 이름 변경은 아직 자동 갱신하지 않습니다. 숫자는 `DOUBLE`, 체크박스는 `BOOLEAN`, 날짜는 `DATE`, 나머지는 `VARCHAR`로 조회하고 빈 날짜는 `NULL`로 투영합니다. `__id`, `__note`, `__created_at`, `__updated_at` 메타데이터도 제공하며 조회는 원본 값과 revision을 바꾸지 않습니다.

쓰기·외부 I/O·확장 로딩·재귀 조회를 차단하고 함수를 허용 목록으로 제한합니다. 배열·튜플·맵·구조체 생성, `overlay`와 사용자 지정 연산자는 거절하며 `CAST`와 타입 지정 문자열은 허용된 scalar 타입만 받습니다. 암묵적인 행 표현식 등을 통한 중첩 타입 결과도 결과 스키마 검사에서 거절합니다. SQL 크기/파서 깊이, 원본 DB·행·적재량, 결과 행·열·셀·문자열 크기를 제한합니다. SQL 평가에는 3초 후 interrupt를 요청하며, 적재 시간까지 포함한 전체 요청 시간 제한은 아닙니다. DuckDB의 128 MB 메모리 예산·단일 스레드·디스크 spill 비활성 설정은 별도 OS 프로세스 격리나 앱 전체 메모리 상한을 보장하지 않습니다. 현재 수치와 `CURRENT_DATE`·날짜 간격을 포함한 지원 문법은 [SQL.md](SQL.md)에 기록합니다.

`SqlQueryDialog`는 `query.catalog`의 이름과 예제로 `foltra-sql` Markdown을 삽입합니다. `NotePreview`는 이 fence와 SQL 내용의 `foltra-query`를 `SqlQuery`로 표시합니다. 기존 `foltra-query`에서 공백을 제외한 첫 글자가 `{`이면 JSON 경로를 사용하며 일반 `sql`/`postgresql` fence는 실행하지 않습니다. 주제 카드처럼 쿼리 실행을 끈 문맥은 두 Foltra fence 모두 코드로 남깁니다.

`SqlQuery`는 vault·SQL·DB/행 snapshot 변경에 따라 다시 요청하고 이전 요청의 늦은 응답은 버립니다. `{columns:[{name,type}],rows,truncated,limit}` 결과의 행은 문자열/`null` 배열이며 React 텍스트로 표시합니다. 표는 읽기 전용이고 결과를 노트 원문에 저장하지 않습니다.

### 노트 채팅

`ai_chat.rs`는 선택 설치 확장의 `ai.chat` 권한과 활성 digest를 확인하고 OpenAI 호환 Chat Completions를 호출합니다. `chat.send`는 현재 노트·설정·대화 revision을 캡처한 뒤 vault 잠금을 놓고 HTTP를 수행하며, 응답 저장 전에 권한과 설정·대화 revision을 다시 확인합니다. 동일 노트 요청은 별도 파일 잠금으로 중복 실행을 차단합니다. 실제 본문 변경은 사용자가 `chat.apply`를 요청해야 하며, 수정안은 생성 기준 노트 revision도 일치해야 합니다.

Provider 키는 vault 밖 기기 앱 데이터에, 대화는 Git·내보내기 제외 대상인 `.foltra/local/ai-chat/`에 저장합니다. QuickJS에는 HTTP·키 조회 API를 주지 않고, `note-chat`·`ai-settings` 호스트 UI primitive가 소유 확장과 현재 노트를 React context에서 받습니다. UI·CLI가 같은 `chat.*` 명령을 사용합니다. 상세 사용법과 한도는 [NOTE_CHAT.md](NOTE_CHAT.md)에 있습니다.

### 확장 명령과 단축키

플러그인 관리 UI는 설정의 `extensions` 그룹에, 테마 설치·제거·선택은 `theme` 그룹에 있습니다. `extensions.open` 명령은 현재 작업을 저장한 뒤 확장 그룹을 직접 열며, 기존 작업 뷰는 유지합니다. 플러그인은 `ExtensionsView`, 테마는 `ThemeSettings`에서 관리합니다. 테마 기본 선택지는 Paper & Pine과 Midnight이고, 카탈로그와 파일로 추가한 테마는 선택 카드에서 바로 삭제합니다. 사용 중인 테마 삭제와 Paper 복귀는 코어의 한 저장 트랜잭션입니다. 파일 종류가 다른 경우 올바른 설정 그룹을 안내합니다.

`src/lib/extensionCatalog.ts`는 `examples/`의 JSON manifest를 가져와 앱에 포함되는 카탈로그를 구성합니다. 둘러보기의 설치 버튼과 사용자 파일 설치는 모두 기존 `extension.install` 경로를 사용하며 설치 상태는 현재 vault snapshot의 ID로 판단합니다. 같은 ID가 있으면 버전·내용이 달라도 덮어쓰지 않습니다. 기본 플러그인은 Anki·일지 캘린더·날짜 자동완성·Git 동기화·노트 채팅을 제공하며 기본 테마는 Paper & Pine·Midnight 두 가지입니다. 설치형 Catppuccin Mocha·Rosé Pine·Tokyo Night·Darcula는 `examples/themes/`와 `themeCatalog.ts`를 통해 테마 탭에서 제공합니다. 새 기본 확장을 추가하려면 검증 가능한 manifest를 `examples/`에 넣고 카탈로그 목록에 등록합니다. SDK 검증용 패키지는 `tests/fixtures/plugins/`에 두고 배포 번들에 포함하지 않습니다. 코어 계약 테스트는 테마 및 검증용 확장의 설치·명령 실행·제거와 생성된 노트 보존을 확인합니다. 카탈로그 자체는 서버·계정·네트워크 요청 없이 동작하며 앱 업데이트로 갱신합니다. 공개 업로드·온라인 검색·자동 업데이트는 아직 구현하지 않았습니다.

1. JSON 설치 시 `extensions.rs`가 허용 필드, command/action, theme token을 검사합니다. 읽을 때도 다시 검사합니다.
2. core `commands.list`가 `plugin.<extension-id>.<command-id>`를 반환합니다. UI도 같은 ID를 팔레트와 단축키 설정에 등록합니다.
3. 확장 명령의 선택적 `bindings`는 최대 10개의 기본 `{ keys, leader }` 조합을 선언하고 기존 설정 validator로 검사합니다. `commands.list`와 GUI 명령에 같은 기본값을 전달하며 설치/활성화가 사용자 설정을 쓰지 않습니다. 명령별 저장 값이 있으면 기본값보다 우선하고 빈 배열은 명시적인 해제입니다. 명령마다 `{ keys, leader }` 배열을 저장합니다. 각 조합의 `leader`는 Leader 포함 여부이며 별도 Vim/일반 단축키 필드가 없습니다. `useCommandKeys`는 Leader/일반 조합을, `vimKeybindings`는 노트 본문 Normal 조합을 기존 Vim 엔진을 통해 공통 명령으로 전달합니다. 키 목록은 각 화면에 흩어 두지 않습니다.
4. template 명령은 GUI/CLI 모두 core에서 노트를 생성합니다. query 명령은 CLI에서 결과를, UI에서는 DB 뷰를 제공합니다. view 명령은 UI에서 화면을 전환하며 CLI에서는 `requires_ui`를 반환합니다.
5. 제거 시 확장 manifest만 제거합니다. 만들어진 사용자 노트·DB를 삭제하지 않습니다.

카탈로그와 파일로 설치한 패키지를 하나의 목록으로 보여 주고, ‘설치된 것만’ 스위치로 현재 vault에 설치된 항목을 거릅니다. 필터를 바꿔도 검색어는 유지합니다. 같은 ID의 카탈로그 항목보다 실제 설치된 manifest의 이름·버전·내용을 우선하며, 설치 상태와 제거 버튼은 필터와 관계없이 표시합니다.

기존 `template`, `query`, 내장 `view` 외에 SDK v1 `script` 명령을 지원합니다. `runtime`에 담긴 번들 JS 모듈은 core의 QuickJS에서 호출마다 새 문맥으로 실행됩니다. TypeScript 패키징은 `scripts/pack-plugin.mjs`, 작성 타입은 `packages/plugin-sdk/`에 있습니다. 새 화면의 구조/동작을 플러그인 코드가 계산하고 `PluginView`가 검증된 tree를 React로 표시합니다. 배포 확장 소스는 `examples/code/anki/`, `examples/code/calendar/`, `examples/code/date-mentions/`에 있습니다. 칸반·편집 도구 등의 SDK 회귀 패키지는 fixture로만 유지하며 `npm test`에서 빌드합니다.

`extension.update {manifest,expectedDigest}`는 설치된 패키지의 semantic digest와 ID·kind를 확인하고 manifest만 원자적으로 교체합니다. 플러그인 설정·카드 연결 데이터·사용자 문서는 유지합니다. 카탈로그의 더 높은 정식 버전에만 업데이트 버튼을 표시하며, 바뀐 코드의 기존 승인은 유효하지 않아 사용자가 다시 활성화합니다. 파일 설치는 여전히 같은 ID를 덮어쓰지 않습니다.

`runtime.views[].placement`는 기본 `main` 또는 `right-sidebar`를 선언합니다. 우측 뷰도 공통 직렬 세션·승인·오류 격리·갱신 경로를 사용하며 `PluginSidebarViews`가 연결 목록 아래에 표시합니다. `calendar` 노드는 실제 날짜·월과 최대 31개 점 표시 날짜, 선언된 action만 허용합니다. 일지 캘린더는 지역 날짜의 현재 월로 시작하며 `YYYY-MM-DD` 제목의 노트를 읽고 생성·이름 변경·삭제를 반영합니다. 키보드 이동은 기존 workspace 명령 라우터를 사용합니다. 우측 확장의 실행 오류는 앱 토스트로 알리고 기존 화면을 비활성 상태로 유지해 오류 블록이 레이아웃을 밀지 않도록 합니다. 설정과 주 화면의 진단 표시는 유지합니다.

일지 캘린더의 `plugin.daily-calendar.open-today`는 실행할 때 지역 날짜의 `YYYY-MM-DD`를 계산하고 없으면 기존 `note.open-link`로 원자적으로 조회/생성한 뒤 `openNote` 효과를 반환합니다. 기존 제목이면 본문·폴더·revision을 유지하며 중복 제목은 캘린더의 기존 선택 목록을 엽니다. 빈 날짜 클릭의 생성 여부는 `create-missing-notes` 설정으로 정하고 기본값은 false입니다. 생성하지 않을 때는 `notify` 효과로 토스트를 보내며 렌더링과 시작 과정은 노트를 생성하지 않습니다. 기본 조합은 `Mod+Shift+d`와 `<leader>nd`이며 팔레트·설정·일반/Leader 라우터를 공유합니다. 현재 초안 저장과 노트 열기/편집기 포커스는 기존 `usePlugins` 및 앱의 경로를 사용합니다.

`runtime.completions`는 `editor.write` 권한 아래 토큰 시작 기호와 후보 제공자 ID를 선언합니다. `usePlugins.complete`는 기존 직렬 세션에 검색어만 보내며 편집기 snapshot·명령 효과·저장·workspace 갱신을 실행하지 않습니다. 코어는 후보 호출에서 쓰기·UI 효과·편집기 읽기·Anki 연결을 거절하고 제한된 평문 후보만 허용합니다. `pluginCompletion`은 활성 패키지·digest·vault·현재 토큰·조합 상태를 다시 확인한 명시적 선택에만 CodeMirror transaction을 적용합니다. 코드·일반 Markdown 링크·이메일·이스케이프 안에서는 호출하지 않습니다. 위키링크 시작 직후의 `[[@`에서는 날짜 후보로 전환하며 기존 닫는 괄호·alias를 보존합니다. 선택하지 않거나 Esc로 취소한 원문은 유지합니다. 날짜 자동완성은 기기 현지 날짜를 계산해 `@Today`·`@Yesterday`·`@Tomorrow`를 `YYYY-MM-DD`로 대치하며 노트는 생성하지 않습니다.

`usePlugins`는 활성 패키지별 직렬 세션, JSON 상태, load/unload, 변경 이벤트와 오류 중단을 담당합니다. `pluginSession`은 vault나 패키지가 바뀌면 대기 요청을 취소하고 늦은 응답을 버립니다. Core invocation은 최대 500ms/32MiB JS heap/512KiB stack/64 host calls/512KiB output으로 제한하며, DOM·Node·파일·네트워크는 노출하지 않습니다. 권한을 가진 명령/뷰 action만 데이터를 쓸 수 있습니다. 렌더링과 변경 이벤트는 읽기 전용이며 UI 결과는 고유한 패키지의 화면/허용된 노트/편집기 동작만 전달합니다. CodeMirror 선택 수정은 원래 노트·본문·선택·조합 상태를 다시 확인한 일반 transaction이므로 undo/자동저장을 유지합니다.

활성화는 설치와 분리됩니다. `extension.enable`은 사용자가 확인한 digest가 현재 manifest와 같은지 확인하고, 기기의 앱 데이터 폴더 `app.foltra.desktop/plugin-grants/<vault-path-hash>/<id>.json`에 승인을 저장합니다. Vault 안에 승인 정보를 두지 않으며 코드/권한 변경과 복원한 다른 경로의 vault는 다시 활성화해야 합니다. `plugin-data`는 백업에 포함하지만 실행 승인은 포함하지 않습니다. Core의 `Store` 복제는 동일한 잠금 파일의 `Arc`를 공유해 JS callback의 소유 수명 동안에도 vault 잠금을 유지합니다. 플러그인 API도 공통 `dispatch`의 명령/인자/revision 검사를 거칩니다. 개별 데이터 명령은 원자적이지만 여러 호출을 하나의 transaction으로 묶지는 않습니다.

이 API는 임의 DOM/CSS·CodeMirror 내부 확장이나 새 DB property type을 허용하지 않습니다. 일반 네트워크·외부 파일 API, OS 프로세스 격리, 공개 marketplace/자동 업데이트, 기존 Obsidian 플러그인 호환은 미구현입니다. 테마는 계속 지정된 색상 token을 사용합니다. 자세한 계약과 제한은 [PLUGIN_SDK.md](PLUGIN_SDK.md)에 있습니다.

## 새 기능을 추가할 때

**데이터 기능**은 해당 core 모듈 → `commands.json`의 인자 계약 → `lib.rs`의 분기 → 임시 vault를 사용하는 계약 테스트 순서로 추가합니다. 수정 기능은 revision 조건과 중간 실패 시 남는 파일을 먼저 정합니다. generic CLI 경로를 통해 새 명령을 실행할 수 있으므로 CLI에 저장 로직을 또 작성하지 않습니다.

**UI 기능**은 해당 component/hook에 구현하고, 키로 호출할 동작은 `builtinCommands.ts`에 등록한 뒤 App의 typed handler map에 연결합니다. handler 누락은 TypeScript가 검사합니다. 설정의 단축키 목록과 팔레트는 이 목록을 공유합니다. 모든 내부 API를 사용자 단축키로 노출하는 것은 아닙니다.

**새 뷰 종류**를 추가하려면 현재 `KnowledgeViews` 또는 별도 component를 만들고 View 타입·navigation·명령을 연결합니다. 커뮤니티 뷰 SDK를 열기 전에는 접근 가능한 데이터, command 전달, UI 격리, 실행 중단과 자원 제한을 별도로 설계해야 합니다.

**새 속성 종류**는 Rust 값 검증, 쿼리 의미, TS 타입, Cell 편집기, export/import 호환성을 함께 추가합니다. 단지 UI selector에 항목을 넣는 것으로 완료하지 않습니다.

**동기화**를 넣을 때는 현재 파일 포맷과 journal/local/cache 경계를 유지하되, 원격 병합을 즉시 원본에 적용하지 않습니다. revision 비교, schema·ID 검증, 사용자에게 보여줄 충돌 해결 결과가 필요합니다. Git 동기화는 선택 설치 확장과 코어의 제한된 Git 전송 API로 제공합니다. QuickJS는 host effect만 요청하고 별도 CLI/Tauri 요청이 네트워크 작업을 실행합니다. `.foltra/local/git/`의 bare 저장소에서 원본을 비교하고, vault 잠금을 놓은 동안 fetch한 결과는 전체 검증과 snapshot revision 비교 후 journal로 적용합니다. 기기 설정·확장 패키지·실행 승인은 동기화하지 않습니다. 상세 범위·한도는 `GIT.md`에 있습니다.

## 성능과 보안의 현재 경계

그래프는 노트 ID·제목·연결로 구성한 입력이 바뀔 때만 worker에서 d3-force를 실행합니다. 반발력·연결력·충돌 반경과 약한 중심력을 300 tick 적용하고 worker를 종료합니다. 중복·역방향 링크는 한 선으로 합치고 보이지 않는 대상과 자기 연결은 배치에서 제외합니다. 전체 범위를 맞춘 뒤 UI에서 pan/zoom·강조·제목 겹침 회피를 처리합니다. 120개 상한을 유지하며, 입력 변경과 unmount 시 이전 worker를 종료합니다. 모든 교차선을 없애는 알고리즘이나 대형 graph 벤치마크는 아닙니다.

화면은 편집기와 읽기 renderer를 지연 로딩합니다. DB 결과 페이지는 100행, 쿼리 응답 상한은 500행, 그래프는 120개 노트입니다. 그러나 snapshot은 3초마다 원본을 스캔하고 모든 행 요약을 반환하며, 기존 JSON DB 쿼리는 메모리에서 필터링합니다. SQL은 조회마다 임시 DuckDB 테이블을 다시 구성합니다. 이것은 대용량 최종 구조가 아닙니다. 증분 인덱스와 구독 API 도입 여부는 규모별 측정 후 결정합니다.

Markdown의 raw HTML과 원격 이미지 자동 로딩을 사용하지 않습니다. 테마에 외부 URL·CSS를 허용하지 않고, core의 경로와 인자를 검증합니다. native IPC는 설치된 앱과 같은 사용자 권한을 가진 신뢰 경계입니다. vault 자체 암호화, 공격자에 의한 로컬 파일 변조 방지, 커뮤니티 코드 sandbox는 제공하지 않습니다.

유지보수 기준은 계층 수를 늘리는 것이 아니라 규칙의 소유자를 한 곳으로 모으는 것입니다. 실제 두 번째 구현이 생기기 전에는 별도 저장소 추상화, sync framework, 범용 plugin VM을 추가하지 않습니다.

## 편집기와 화면 상태

`lineNumbers`(`none`/`absolute`/`relative`)는 Vault 설정이며 기본 `none`입니다. `src/lib/lineNumbers.ts`는 CodeMirror gutter를 구성하고 상대 번호를 현재 주 선택의 head 기준으로 계산합니다. 현재 줄은 실제 줄 번호를 표시합니다. gutter는 본문 flex 배치에서 제외해 기존 왼쪽 여백에 절대 배치하고, CodeMirror의 고정 gutter를 끕니다. 번호 유무와 자릿수가 본문 너비·줄바꿈에 영향을 주지 않으며 노트 스크롤을 함께 따릅니다. 선택 줄이 바뀌거나 문서가 바뀌면 표시를 갱신하며 화면 밖 줄 전체의 DOM을 만들지 않습니다. 독립 compartment로 적용해 문서·선택·undo history를 유지합니다. Live Preview/원문에는 원본 줄 번호를, 읽기 화면에는 번호를 표시하지 않습니다.

`cursorShape`(`bar`/`block`/`underline`), `cursorFollowVim`, `cursorBlink`(`steady`/`blink`/`breath`), `cursorBlinkRate`(200–2000ms 정수), `cursorAnimation`(`none`/`smooth`/`smear`)은 Vault 설정입니다. 기본값은 세로선·Vim 모드별 모양 사용·Blink·600ms·이동 효과 없음입니다. Vim 자체는 기본 OFF입니다. `cursorFollowVim`은 Normal/Visual을 블록, Replace를 밑줄로 바꾸고 Insert에서는 선택한 모양을 사용합니다. 기존 `auto` 값은 세로선+모드별 모양으로, 기존의 명시적 모양은 모드별 모양 OFF로 읽어 동작을 유지하며 읽기만으로 파일을 수정하지 않습니다. 구 CLI의 `auto` patch도 새 설정으로 정규화합니다.

`CursorSettings`는 모양·제자리 애니메이션·점멸 간격·이동 효과를 구분하고 실제 CSS를 공유하는 미리보기를 표시합니다. 점멸 간격은 밝음/어두움 한 단계의 시간이며 전체 주기는 두 배입니다. Steady에서는 간격 입력을 비활성화합니다. Blink는 단계적으로, Breath는 ease-in-out으로 밝기가 변합니다. 점멸은 CSS로 실행하고 입력·선택 이동 시 밝은 상태에서 다시 시작합니다.

선택한 모양·효과는 별도 compartment로 갱신해 문서와 undo history를 유지합니다. `editorCursor`는 `requestMeasure`에서 좌표를 읽고 본문 위의 입력을 받지 않는 레이어만 그립니다. Vim 모드 이벤트와 스크롤도 재측정을 요청합니다. 순수 `cursorAppearance`는 모드별 모양을, `cursorMotion`은 경과 시간에 따른 위치와 잔상을 계산합니다. 이동이 끝나면 animation frame을 중단하고, blur/조합 입력/multiple selection에서는 기본 커서로 복귀하며 unmount 시 리스너와 레이어를 제거합니다. 시스템의 `prefers-reduced-motion`이 켜지면 점멸과 이동 효과를 모두 생략합니다. 이 레이어는 제목·Ex 입력창·읽기 모드에는 적용하지 않습니다.

주제 모음은 [TOPICS.md](TOPICS.md)의 블록 범위/그룹 계약을 사용합니다. 코어의 `topics.list`/`topics.blocks`와 `topics.reorder`는 CLI에서도 사용할 수 있습니다. 순서는 별도 vault 메타데이터에 저장하고 노트 본문을 바꾸지 않습니다. 원본/순서 snapshot revision을 함께 검사하며, 순서 키의 이름→UUID 이전은 노트 변경 transaction에 포함합니다. 백업/복원은 이 메타데이터를 검증하고 보존합니다. 원본 정보 표시는 기기별 localStorage에 저장하고 공통 `topics.sources.toggle` 명령으로 전환하며, 조회 조건·원본 데이터와 분리합니다. 카드의 원본 버튼은 노트 본문의 1-based 행을 기존 `openNote` 경로에 전달합니다. 편집기는 mount effect가 안정된 다음 프레임에 준비 완료를 알리고, cleanup은 이전 알림을 취소합니다. 개발 StrictMode의 편집기 재생성이 대기 중인 커서 이동을 먼저 소비하지 않도록 한 규칙입니다.

체크박스의 `[ ]`·`[/]`·`[x]` 마우스 전환은 Live Preview에서 CodeMirror transaction, 읽기 모드에서 기존 note draft/자동 저장, 주제 모음에서 revision을 포함한 `task.update`를 사용합니다. `previewListSource`의 원본 행 매핑은 프론트매터 제거와 표시용 목록 구분 줄 삽입을 거친 `remarkTasks`의 위치를 실제 본문 행으로 복원합니다. 주제 카드 빈 공간 클릭은 원본 버튼과 같은 `openNote(id,line)`을 호출하되 컨트롤·선택·드래그 클릭을 제외합니다.


새 vault는 `vim: false`, `editorMode: live`로 시작합니다. 기존의 명시적 Vim 설정은 유지합니다. live/source 전환은 CodeMirror compartment를 재설정하며 같은 문서와 undo history를 사용합니다. 읽기 모드는 별도 renderer입니다. Live Preview의 decoration은 편집기 focus effect와 선택 범위를 따라 활성 줄/블록만 원문으로 드러내고, 본문을 떠나면 미리보기로 복귀합니다. 선택 끝이 다음 줄 시작과 일치하면 선택되지 않은 다음 줄은 제외합니다. 보기 모드 버튼/명령은 편집기 mount 완료 시 대기 중인 focus를 적용합니다. 표·쿼리는 기존 NotePreview를 재사용합니다. 위키링크와 웹 링크는 편집 중 Ctrl/Cmd+클릭으로 열 수 있습니다.

수평 구분선(`HorizontalRule`)은 block replacement 대신 실제 CodeMirror 줄을 유지합니다. 비활성 줄은 원문 텍스트의 크기를 유지한 채 숨기고 테마의 선 색으로 표시하며, 커서/선택이 닿으면 원문을 드러냅니다. 방향키·Vim 이동·마우스 위치 지정은 기본 편집기 경로를 사용합니다. 구문 트리를 기준으로 처리하므로 YAML 경계나 Setext 헤딩 밑줄을 수평 구분선으로 오인하지 않습니다.

Setext 제목은 구문 트리가 포함한 모든 내용 줄에 동일한 제목 스타일을 적용합니다. 마지막 밑줄 문법 줄은 제목 서체 적용에서 제외하고 기존 원문 표시/접기 규칙을 따릅니다. gutter 높이도 각 내용 줄의 제목 클래스로부터 계산해 여러 줄 제목과 번호의 정렬을 유지합니다.

`[[` 자동완성은 CodeMirror autocomplete의 로컬 keymap과 IME 처리를 사용합니다. 후보 선택은 본문만 변경하며, 실제 생성은 [LINKS.md](LINKS.md)의 `note.open-link` 경로에서만 실행합니다. core는 같은 vault 잠금 안에서 먼저 UUID/제목을 해석하고 생성 여부를 결정합니다. `Link.name`은 alias와 분리한 파생 대상 필드입니다. `showUnresolvedLinks`는 기존 설정에도 기본 true를 병합하고, `graphDocuments`는 표시용 가상 노드를 만들며 원본 노트를 쓰지 않습니다.

Vim의 전역 Ex 등록과 설정 기반 Normal action은 WeakMap으로 호출한 편집기 handler에 연결합니다. 현재 단일 활성 편집기의 매핑만 유지하며 설정 변경·편집기 해제 시 자신이 등록한 매핑을 제거해 기존 Vim 동작을 복원합니다. 키 조합은 `gd` 같은 연속 입력 또는 `Mod+Enter` 같은 수정 키 조합입니다. 연속 입력은 영문·숫자 최대 12개이며 공백은 구분자이고 대소문자를 구분합니다. Leader 없이 입력하는 연속 조합은 영문으로 시작하며 Vim Normal 본문에 등록됩니다. UI는 명령 간 중복·접두어 충돌과 Leader 첫 키 충돌을 검사하고, core는 저장 형식을 검증합니다. 명령의 배열을 비우면 모든 조합이 해제되며 키 자체를 제거하면 기본 바인딩으로 돌아갑니다. UI는 빈 입력을 저장 목록에서 제외합니다. 설정 UI는 키 조합과 일반 단축키 입력란을 분리합니다. 키 조합의 `<leader>f` 표기를 기존 `{ keys: "f", leader: true }`로 파싱하며, 체크박스는 사용하지 않습니다. 이 표기 변환은 저장 포맷과 기존 라우팅을 바꾸지 않습니다. 기본 `gd`는 `note.follow-existing-link`, Mod+Enter는 `note.follow-link` 명령으로 편집기 handle의 현재 커서 위치를 해석합니다. 둘 다 `useOpenWikiLink`의 저장·열기 흐름을 사용하며, `gd`는 기존 노트만 열고 없는 대상에서는 저장·생성·이동 기록을 변경하지 않습니다. Mod+Enter는 기존 atomic `note.open-link`로 열기/생성을 유지합니다. 별도 전역 키 리스너나 원본 쓰기 경로를 만들지 않습니다. `:w`는 저장, `:q`는 현재 노트 닫기, `:wq`/`:x`는 저장 후 닫기입니다. 저장 실패/충돌은 강제 저장으로 우회하지 않습니다. `:q!`는 진행 중 저장이 끝나기를 기다린 뒤 미저장 초안만 버리며, 이미 자동 저장한 내용을 되돌리지는 않습니다. 현재 노트 외 파일 경로와 범위 저장은 거절합니다.

최근 vault 목록과 사이드바 너비·왼쪽 접기 상태·탐색 메뉴 컴팩트 모드는 앱의 기기별 localStorage에 보관합니다. vault 설정이나 Git 동기화 원본에는 넣지 않습니다. Vault 전환은 현재 초안을 저장하고 대상 workspace를 성공적으로 읽은 뒤 화면을 바꾸므로, 실패한 경로 선택이 현재 workspace를 비우지 않습니다. 최근 목록은 이 앱에서 열었던 경로이며 디스크 전체를 자동 탐색하지 않습니다.

`useVaultLocation`은 Welcome과 VaultPicker의 생성 경로 초안을 공유합니다. 현재/최근 vault의 상위 폴더, 없으면 core `vault.default`의 상위 폴더를 기준으로 이름을 붙입니다. `vaultLocation`은 경로 구분자와 폴더명 제안을 계산하며 파일을 만들지 않습니다. 폴더 선택은 생성할 상위 위치를 바꾸고 이름 자동 반영을 유지합니다. 전체 경로를 직접 수정하면 그 경로를 우선하며 늦게 도착한 기본 위치 응답으로 덮어쓰지 않습니다. `VaultPathField`는 경로 입력과 우측 폴더 버튼의 공통 배치만 담당합니다. 기존 vault 열기의 폴더 선택은 선택한 경로를 그대로 사용하며, 생성 초안과 별도입니다. 실제 생성은 기존 `useWorkspace.create` → core `vault.init`을 유지합니다.

내용 검색은 query별 응답 수명을 관리해 이전 검색 응답을 무시하고, 검색어가 바뀌는 즉시 이전 선택을 비웁니다. 입력칸의 focus를 유지하면서 결과의 aria-activedescendant와 스크롤을 갱신합니다. 목록이 비었거나 한글 조합 중이면 Enter로 노트를 열지 않습니다.

## 데이터베이스 컬럼 변경

`database.property.preview`는 원본 스키마와 DB 전체 행을 읽어 변경 계획을 만듭니다. 반환값은 `revision`, `property`, `rowCount`, `changedRows`, `errorCount`, `errors`, `changedNotes`, `changedQueries`, `queryErrors`, `canApply`입니다. revision은 스키마 원문과 행 ID/revision 목록을 묶은 SHA-256이며, 컬럼 이름 변경 때에는 SQL 참조 분석에 사용한 catalog와 노트 revision도 포함합니다. 일반 행의 revision과는 다른 변경 범위를 가집니다. 조회는 파일을 변경하지 않습니다.

`database.property.update`에는 같은 `databaseId`/`property`와 미리보기의 `expectedRevision`을 보냅니다. 코어가 잠금 안에서 다시 계산한 revision이 다르면 충돌을 반환합니다. 변환 불가 값 또는 안전하게 갱신할 수 없는 쿼리가 있으면 전체 적용을 거절합니다. 성공 시 스키마·실제로 값이 달라진 행·SQL 참조를 바꾼 노트를 하나의 journal로 commit합니다. 컬럼과 행 ID, 본문 연결을 유지하므로 ID 기반 JSON 쿼리·정렬·너비·Anki 매핑은 변경할 필요가 없습니다. persisted Database/Record 포맷은 바꾸지 않습니다. 코어는 GUI와 CLI에서 같은 경로를 사용합니다.

`PropertyEditor`는 제목을 포함한 컬럼 이름을 수정하고, 변경할 쿼리 수와 검사 실패 예시를 표시합니다. 검사 이후 충돌은 자동 재시도로 우회하지 않습니다. 열기 전에 현재 노트의 미저장 초안을 저장합니다. `ColumnHeader`가 크기 조절 입력을 받고 `DatabaseView`는 property ID로 너비를 저장합니다. 본문 컬럼의 헤더 오른쪽 끝에는 문서 아이콘과 `노트` 배지를 표시하고, 호버·접근성 설명으로 각 행의 노트를 만들거나 여는 역할을 안내합니다. 실제 PK는 자동 생성되는 행 ID(`__id`)이며 제목 값은 중복될 수 있지만, 일반 DB 화면에 별도 PK 안내는 표시하지 않습니다. 이름 셀의 본문 버튼은 기존 `openBody` 경로를 호출하므로, 본문을 열기 전까지 새 노트가 필요 없는 모델을 유지합니다.

컬럼 헤더 드래그 또는 우클릭 메뉴의 좌우 이동은 표의 표시 순서만 바꿉니다. `useColumnOrder`는 property ID 배열을 `foltra:column-order:<vaultId>:<databaseId>` localStorage에 저장하며 기기별 배치로 취급합니다. 헤더·셀·너비를 함께 재배치하지만 canonical `database.properties`, SQL/JSON 쿼리, 제목/본문 역할과 상태 필터 기준은 바꾸지 않습니다. 삭제된 ID는 무시하고 새 컬럼은 뒤에 추가하며 이름·타입 변경에는 현재 속성 객체를 사용합니다. DB/vault 전환 시 대상 배치를 먼저 읽고 명시적인 이동에만 저장합니다. 드래그의 출처와 현재 DB/schema 범위를 검사해 다른 창이나 오래된 드래그로 순서가 변경되지 않게 합니다.

## 폴더와 휴지통 갱신

폴더는 `folders/<uuid>.json`의 `{id,name,parentId}`로 저장합니다. 노트 metadata의 선택적 `folderId`가 소속을 나타내며 기존 노트는 그대로 최상위에 표시됩니다. 제목·폴더 변경은 UUID 파일 경로를 바꾸지 않습니다. 폴더 이동은 본문 참조를 바꿀 필요가 없으며, 제목 변경은 연결된 본문의 대상을 함께 갱신합니다. 폴더 삭제는 `folder_lifecycle.rs`가 하위 폴더·노트를 묶어 휴지통으로 이동하며, subtree revision으로 동시 변경을 검사합니다. 복원은 원래 ID·내용·구조를 유지하고 충돌 시 덮어쓰기를 거절합니다. 휴지통의 노트가 참조하던 폴더가 없어졌다면 최상위로 복원합니다. 백업은 폴더 파일을 포함하고, import는 누락된 부모/노트 폴더·순환 계층을 쓰기 전에 거절합니다. 예전 백업은 폴더 없이 그대로 읽힙니다. 이전 앱 버전으로의 downgrade 보존은 아직 보장하지 않습니다.

`workspace.get`은 노트·DB·폴더·휴지통 요약을 같은 잠금 아래에서 반환합니다. `TrashView`는 이 snapshot을 바로 렌더링하며 별도 목록 캐시를 갖지 않습니다. 앱 내부 쓰기는 완료 직후 `refresh()`하고, CLI 등 외부 변경은 기존 3초 주기의 workspace 갱신에 반영됩니다. 휴지통 본문은 snapshot에 넣지 않습니다. `trash.empty`는 확인창을 연 시점의 전체 `{id, expectedRevision}` 목록을 받습니다. 현재 파일 목록과 모든 revision·종류를 검증한 뒤 한 번의 journal commit으로 휴지통 묶음만 지우며, 중간 변경 시 전체 요청을 거절합니다. UI 검색 필터와 관계없이 전체 항목 수를 확인하고, 성공 직후 목록에서 제거합니다.

`NoteTree`는 트리 표시와 접기 상태, `FolderDialog`는 폴더 수정과 노트 이동 입력을 담당합니다. 노트 이동 전 미저장 초안 저장과 revision 확인은 `useNoteActions`가 담당합니다. 노트·폴더·DB 행 메뉴는 `ContextMenu`의 포커스/키보드 동작을 공유합니다. `workspaceFocus`가 영역 이동과 sidebar 탐색을 처리하며 모든 단축키는 기존 공통 command router를 거칩니다.

사이드바 노트·폴더 버튼의 더블클릭도 기존 인라인 이름 변경 경로를 사용합니다. 노트는 `useNoteActions.run('rename')`로 초안을 저장한 뒤 선택한 revision을 전달하며 두 번째 클릭은 노트를 다시 열지 않습니다. 폴더는 기존 클릭 토글 뒤 이름 변경으로 들어가므로 두 번 클릭한 후의 펼침 상태는 유지됩니다. 첫 클릭의 노트 로딩이 늦게 끝나도 `editorReady`와 읽기 화면의 포커스 요청은 인라인 이름 입력을 우선합니다.

### 노트·폴더 드래그 이동

`NoteTree`는 현재 트리에서 시작한 노트/폴더의 종류와 ID를 ref에 보관합니다. drop payload는 노트 정보로 역직렬화하지 않습니다. 폴더 제목뿐 아니라 해당 폴더의 파일 행·행 사이·들여쓰기 여백도 드롭 대상으로 처리합니다. 중첩 폴더는 포인터가 포함된 가장 안쪽의 표시된 폴더 영역을 사용하며, 같은 위치 드롭도 이벤트 전파를 중단해 상위 폴더로 잘못 이동하지 않습니다. 최상위 노트·배경과 NOTES 제목에서는 최상위로 이동합니다. 대상 폴더 제목·하위 영역과 NOTES 안내에 목적지를 표시하고 취소·실패 시 강조를 해제합니다. 드롭 시점의 workspace note snapshot을 `useNoteActions.moveTo`에 전달하면 공통 busy guard가 중복 실행을 막고 `moveNoteToFolder`가 편집 초안 저장 후 `expectedRevision`과 `folderId`만 core로 보냅니다. 성공 전 트리를 임의로 옮기지 않습니다. 대상 폴더 유효성 및 충돌 검사는 기존 core가 담당합니다. 컨텍스트 메뉴의 이동도 같은 함수로 처리합니다. 폴더 드롭은 `useTreeEditing.moveFolder`에서 `folder.update`에 기존 name/revision과 새 parentId만 전달합니다. 자기 자신·자손·현재 부모는 드롭 대상으로 받지 않으며 core에서도 순환·누락된 부모·동명 폴더·revision 충돌을 검증합니다. 하위 폴더/노트 파일을 다시 쓰지 않습니다.

키 바인딩 설정은 `shortcutVersion: 4`에서 `keybindings[commandId]: [{ keys: string, leader: boolean }]` 형식을 사용합니다. Core는 기존 `leader`/`shortcut`/`vimNormal` 객체를 배열로 변환합니다. 버전 1의 대문자 일반 단축키는 이전 의미대로 소문자로 정규화하고, 버전 2 이상의 대소문자는 유지합니다. 이전 `note.follow-link`의 Normal 필드 누락은 기본 `gd`를 유지하며 명시적 빈 값은 해제로 보존합니다. 버전 1–3의 `note.follow-link`에 저장된 Leader 없는 소문자 `gd`만 `note.follow-existing-link`로 옮깁니다. 다른 조합과 명시적 해제는 보존하고, 새 명령을 이미 설정했다면 덮어쓰지 않습니다. 버전 4에서 사용자가 다시 지정한 조합은 이 변환을 적용하지 않습니다. 읽기는 원본 파일을 변경하지 않으며 다음 명시적 설정 저장 때 버전 4로 기록합니다. CLI도 새 배열을 조회·저장하며 이전 객체 형식의 입력은 호환 변환합니다. 버전 4를 모르는 구버전 앱으로의 downgrade는 지원하지 않습니다.

### 설정과 기기별 탐색 상태

`settingsNavigation.ts`는 설정 진입/복귀 포커스와 선택 그룹을 관리합니다. App은 작업 뷰와 설정 표시 여부를 따로 보관하며, 설정 동안 작업 뷰를 inert 상태로 유지합니다. `SettingsNavigation`과 `SettingsView`는 같은 그룹 정의를 사용하고, 이동은 기존 `useCommandKeys`/`workspaceFocus`를 거칩니다. `settings.css`의 CSS 전환에는 별도의 애니메이션 라이브러리나 프레임별 React 상태 갱신이 없습니다.

`editorLocation.ts`는 편집기의 선택·스크롤을 Vault/노트별 기기 저장소로 연결합니다. `Editor` 생성 시 선택을 읽고 준비 프레임에서 스크롤을 복원한 다음 App에 준비 완료를 알립니다. App은 명시적인 파일 열기 요청의 포커스를 이 경계에서 처리합니다. 창의 크기와 위치는 네이티브 window-state 플러그인이 앱 설정 디렉터리에 보관합니다. 두 상태 모두 Vault 동기화·노트 revision과 분리됩니다.

Cmd+W(macOS)/Ctrl+W(그 외)는 공통 `note.close` 명령으로 현재 노트를 저장한 뒤 닫고 사이드바와 앱 창을 유지합니다. 열린 노트가 없거나 다른 뷰·설정·대화상자를 사용 중이면 노트를 닫지 않습니다. 저장 실패 시 노트를 열어 두며, 단축키는 기존 설정에서 변경·해제할 수 있습니다. Vim `:q`의 미저장 변경 거절 규칙은 유지합니다. macOS의 `src-tauri/src/menu.rs`는 기본 메뉴의 Cmd+W 창 닫기 예약을 제거하고 편집기 명령 라우터가 키를 받게 합니다. File → Close Window 메뉴와 빨간 닫기 버튼은 네이티브 창을 닫습니다. `useCloseGuard`의 초안 저장/실패 시 닫기 중단 흐름을 거친 후, Rust event loop는 마지막 창 닫기로 발생하는 `ExitRequested { code: None }`의 앱 종료만 막습니다. Dock/Finder의 `Reopen`은 기존 main 창을 복원·포커스하거나 동일한 설정으로 다시 만들고 window-state 플러그인으로 크기/위치를 복원합니다. 네이티브 Cmd+Q 및 명시적 종료 코드는 그대로 종료하며, 이 정책은 macOS에서만 적용합니다.

노트 탐색 기록은 `noteHistory.ts`에서 출발 노트 ID와 선택·스크롤의 snapshot을 최대 50개 메모리에 보관합니다. `note.back`(기본 `Ctrl+o`), `note.forward`(기본 `Ctrl+i`), 상단 이전 버튼이 같은 기록을 사용합니다. 뒤로·앞으로 이동할 때 현재 위치를 반대 방향 기록에 보관하며, 뒤로 간 후 새 노트를 열면 기존 앞으로 기록을 비웁니다. 현재 초안 저장에 성공한 뒤 목적 위치를 편집기 준비 경계에서 복원하므로 저장 실패 시 양쪽 기록을 소비하지 않습니다. 같은 노트 재방문으로 기기 저장소의 최신 위치가 바뀌어도 각 출발 위치는 유지됩니다. 삭제된 노트는 양방향으로 건너뛰고 Vault 전환 시 양쪽 기록을 비웁니다. 노트 안의 모든 Vim 이동을 추적하는 jumplist는 아닙니다.

### 플러그인 사용 동의

`extension.policy`와 `extension.policy.update`는 기기의 앱 데이터에 vault 경로별 최초 동의·전체 사용 여부를 저장합니다. vault 원본·Git·백업으로 전파하지 않습니다. 전체 사용을 꺼도 개별 digest 활성화 기록은 보존하고 `pluginStates.enabled`를 false로 반환하므로 UI 세션·명령·자동완성·백그라운드 실행이 함께 중단됩니다. 코어 invoke와 Git 재검증도 같은 정책을 확인합니다. `extension.update`를 통한 명시적 로컬 업데이트만 기존 활성화 digest를 갱신하며 외부 파일 변경은 자동 활성화하지 않습니다. 기존 사용자는 첫 전체 동의 후 보존된 개별 상태로 복귀합니다.

주제 모음의 `hideCompleted`는 `markdown_query::tasks`의 실제 작업 파싱을 재사용해 블록 범위 내 작업이 하나 이상이며 모두 done일 때 숨깁니다. catalog 수·페이지·드래그 대상에 동일하게 적용하며, 전체 카드 anchors는 보존해 필터 중 재정렬이 숨긴 카드를 잃지 않게 합니다. 필터는 orderRevision에도 포함됩니다.
