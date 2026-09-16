# Foltra · 폴트라

기록을 따라, 생각을 잇다.

선택 가능한 Vim 모드와 leader 단축키로 노트·데이터베이스·연결을 다루는 local-first 앱입니다. `snack-note`와 코드·저장소·데이터 형식을 공유하지 않는 독립 프로젝트입니다.

**현재는 0.1 개발 프리뷰입니다.** 원래 제품 요구사항 전체의 완성을 의미하지 않습니다. 구현 여부와 검증 범위는 [개발 현황](docs/STATUS.md)에 구분했습니다.

![Foltra 개발 화면](docs/preview.png)

## macOS 설치

[v0.1.0-preview.1 프리릴리스](https://github.com/snacky101/foltra/releases/tag/v0.1.0-preview.1)에서 Apple Silicon용 `.dmg`를 다운로드해 엽니다. `Foltra.app`을 `Applications`로 옮긴 후 응용 프로그램에서 실행합니다. 앱 실행에는 Node.js·Rust·개발 서버가 필요하지 않습니다. 비공개 저장소이므로 다운로드하려면 접근 가능한 GitHub 계정으로 로그인해야 합니다.

앱 무결성을 위한 ad-hoc 서명을 적용한 개인용 프리뷰이며 Apple Developer ID 서명·공증은 없습니다. 첫 실행이 차단되면 [Apple 안내](https://support.apple.com/guide/mac-help/mh40616/mac)에 따라 시스템 설정 → 개인정보 보호 및 보안에서 해당 앱의 ‘확인 없이 열기’를 선택합니다. 현재 설치 파일은 Apple Silicon용이며 Intel Mac용은 제공하지 않습니다.

## 실행

Node.js 24와 Rust stable, 운영체제의 [Tauri 개발 요구사항](https://v2.tauri.app/start/prerequisites/)이 필요합니다. 현재 macOS에서 빌드했습니다.

```sh
npm ci
npm run tauri dev
```

첫 화면에서 빈 폴더를 선택해 vault를 만들거나 기존 Foltra vault를 엽니다. 예제 데이터는 “예제 노트와 DB를 담아 시작하기”를 선택한 경우에만 생성됩니다. 앱 이름은 Foltra, vault 이름과 위치는 사용자 지정입니다.

새 Vault는 현재/최근 Vault의 상위 위치에 이름과 같은 폴더를 제안합니다. 경로 입력창 오른쪽의 폴더 선택으로 상위 위치를 바꿀 수 있으며, 전체 경로를 직접 입력하면 그 경로를 유지합니다. Vim·Leader·단축키·편집 모드·테마와 설치한 확장은 현재 Vault별로 관리합니다. 사이드바 너비와 최근 Vault 목록은 기기별로 유지됩니다.

```sh
# macOS에서 독립 실행 가능한 개발용 앱 빌드
npm run tauri -- build --debug
open target/debug/bundle/macos/Foltra.app

# 현재 Mac 아키텍처의 최적화된 앱과 DMG 생성
npm run release:mac

# 브라우저로 UI 개발: 실제 파일 코어를 연결하는 로컬 개발 서버
npm run dev
```

브라우저 개발 주소는 `http://127.0.0.1:1420`입니다. 이 서버는 개발 전용이며 네트워크 공유나 호스팅용이 아닙니다. 빌드한 데스크톱 앱은 이 서버 없이 실행됩니다.

## 써볼 수 있는 것

- Markdown Live Preview·원문·읽기와 자동 저장. 코드 울타리(```` ```go ````) 뒤 Enter로 닫는 울타리 자동 생성과 언어별 문법 강조. Vim은 기본 OFF, 설정에서 켤 수 있고 슬래시 메뉴도 독립적으로 on/off.
- 사이드바 최하단 Vault 메뉴, 최근 vault 선택 팝업, 새 vault 생성, 좌우 사이드바 너비 드래그와 복원.
- 내용 검색의 ↑/↓ 결과 선택과 Enter 열기.
- 모든 노트 목록의 제목 검색·폴더 필터·수정일/생성일/제목 정렬, 목록에서 노트 열기와 우클릭 관리.
- 명령 팔레트와 leader/일반 단축키 설정, Leader 키·조합 기록. 기본 leader는 Space, 일반 단축키의 Mod는 Cmd 또는 Ctrl.
- `[[노트 제목]]` 원문 저장과 `[[노트 제목|표시 이름]]` alias, 이름 변경 시 참조 갱신([링크 규칙](docs/LINKS.md)), 문맥 백링크, 힘 기반 노트 그래프(겹침 방지·연결 강조·확대·이동)와 생성/수정 타임라인.
- [주제 모음](docs/TOPICS.md): 같은 `[[주제]]`를 적은 문단·제목·인용문과 bullet/하위 목록을 여러 노트에서 카드로 모아 보기. 주제 검색·페이지·날짜/드래그 사용자 지정 정렬·원본 위치 이동, CLI 조회.
- 노트 파일 없이 만드는 DB와 행. 표·보드·날짜 타임라인, 컬럼 타입 변경·너비 조절·필터·정렬, 이름 셀에서 본문 노트 열기/생성/연결.
- 노트 안의 `foltra-query` 코드 블록으로 실제 DB 조회.
- 설정의 확장 탭에서 Anki 설치·사용자 확장 파일 관리·단축키 지정. 테마 탭에서 Paper & Pine/Midnight 선택, Catppuccin Mocha·Rosé Pine·Tokyo Night·Darcula 설치와 사용자 테마 파일 추가·삭제.
- 기본 확장 카탈로그는 Anki 연결을 제공합니다. 코드 플러그인 SDK v1의 독립 뷰·설정·변경 이벤트, 노트/DB API와 편집기 선택 변환으로 별도 확장을 만들어 파일로 설치할 수 있습니다. 코드 패키지는 권한 확인 후 기기별로 활성화하며 일반 네트워크·외부 파일·앱 DOM 직접 접근은 제공하지 않습니다.
- 앱을 열지 않아도 같은 vault를 다루는 JSON CLI, 휴지통, 백업 내보내기/복원.

| 동작 | 기본 키 |
| --- | --- |
| 명령 팔레트 | Mod+k |
| 새 노트 | Mod+n / Space n n |
| 저장 | Mod+s / Space n s / Vim `:w` |
| 현재 노트 닫기 / 저장 후 닫기 | Vim `:q` / `:wq` 또는 `:x` |
| 읽기·편집 전환 | Mod+e / Space n p |
| 모든 노트 목록 | Space v n |
| 그래프 / 타임라인 | Space v g / Space v t |
| 주제 모음 | Space v c |
| 새 DB / 새 행 | Space d c / Space d n |
| 컬럼 타입 변경 | Space d t |
| 설정 | Mod+, / Space s s |

Vim 명령 입력줄은 화면 하단에 표시합니다. `:q`는 현재 노트를 닫으며 미저장 변경이 있으면 중단합니다. `:q!`는 미저장 초안만 버리고, 이미 자동 저장된 내용은 되돌리지 않습니다.

본문 입력 모드에서는 leader를 시작하지 않습니다. Leader와 중간 조합은 시간 제한 없이 다음 키를 기다립니다. Esc, 명령 실행, 일치하지 않는 조합, 창 포커스 이탈로 종료합니다. 초기 키 설정은 설정 화면에서 바꿀 수 있습니다. 브라우저의 자체 Vim 확장과 단축키가 겹칠 수 있어 데스크톱 입력 검증은 별도로 진행해야 합니다.

## CLI와 agent 연동

```sh
cargo build -p foltra-cli
./target/debug/foltra --vault /absolute/path/to/vault vault init --name Personal
./target/debug/foltra --vault /absolute/path/to/vault note create --title "첫 기록" --body "본문"
./target/debug/foltra --vault /absolute/path/to/vault commands list
./target/debug/foltra --vault /absolute/path/to/vault database create --name Tasks
```

위 `vault init`은 새 빈 폴더에서 한 번만 실행합니다. `commands list`는 명령 ID·인자 스키마·읽기 전용 여부·headless 실행 가능 여부를 반환하며 해당 vault에 설치한 확장 명령도 포함합니다.

```sh
./target/debug/foltra --vault /absolute/path/to/vault record create --database DATABASE_UUID --values '{"title":"노트 없이 저장한 행","status":"To do"}'
./target/debug/foltra --vault /absolute/path/to/vault query run --args '{"databaseId":"DATABASE_UUID","limit":100}'
./target/debug/foltra --vault /absolute/path/to/vault note read --id NOTE_UUID
./target/debug/foltra --vault /absolute/path/to/vault note update --id NOTE_UUID --expected-revision REVISION_FROM_READ --body-file ./draft.md
./target/debug/foltra --vault /absolute/path/to/vault extension install --manifest-file examples/plugins/anki.json
./target/debug/foltra --vault /absolute/path/to/vault extension status
```

`DATABASE_UUID`, `NOTE_UUID`, `REVISION_FROM_READ`를 이전 명령의 실제 반환값으로 대체합니다. 코드 확장은 설치 후 앱에서 권한을 확인하고 활성화합니다. 수정과 삭제는 읽을 때 받은 revision을 사용합니다. 충돌이 나면 최신 내용을 읽고 병합한 뒤 다시 요청해야 합니다.

출력은 JSON입니다. 결과는 stdout, 오류는 stderr에 기록합니다. 성공은 exit 0, revision 충돌은 exit 3, 나머지 실패는 exit 1입니다. `FOLTRA_VAULT` 환경변수로 기본 vault를 지정할 수도 있습니다. `--args`는 전체 인자 객체, `--body-file`은 본문 파일, `query run --file`은 쿼리 JSON 파일을 받습니다.

```sh
./target/debug/foltra --vault /absolute/path/to/vault vault export > snapshot.json
./target/debug/foltra --vault /absolute/path/to/new-empty-folder vault import --snapshot-file snapshot.json
```

백업 복원은 비어 있는 새 폴더에만 허용됩니다. 캐시와 복구 journal은 내보내거나 복원하지 않습니다.

## 개발과 구조

```sh
npm test       # 코어 계약, 실제 CLI 프로세스, 키 라우팅 테스트
npm run check # TS/프로덕션 번들, Rust 포맷, 전체 workspace Clippy
npm run format
```

- [구조와 실행 흐름](docs/ARCHITECTURE.md): 모듈 책임, 저장 계약, 기능 추가 위치.
- [개발 현황과 남은 작업](docs/STATUS.md): 원래 요구사항별 구현·검증 구분.
- [전체 제품 설계](docs/DESIGN.md): 장기 요구사항과 설계 가설. 현재 구현의 사실은 위 두 문서를 기준으로 합니다.
- [코드 플러그인 SDK](packages/plugin-sdk/README.md), [SDK 계약·제한](docs/PLUGIN_SDK.md), [Anki 확장 소스](examples/code/anki/), [테마 팔레트·출처](docs/THEMES.md).

아직 공개 플러그인 실행 환경, Git 동기화, 모바일, 관계·수식 DB, 대규모 vault 품질 기준을 완료하지 않았습니다. 저장 포맷은 버전을 포함하지만 범용 포맷 마이그레이션은 구현 전입니다.

컬럼 타입 변경은 모든 행을 먼저 검사합니다. CLI에서도 `database.property.preview`에 `databaseId`와 `property`를 보내 결과를 확인한 뒤, 그 `revision`을 `expectedRevision`으로 붙여 `database.property.update`를 호출합니다. 검사 이후 데이터가 바뀌면 다시 검사해야 하며, 변환 불가 값은 삭제하거나 강제로 변환하지 않습니다. 이름 컬럼은 텍스트로 유지됩니다.

노트 목록의 새 폴더 버튼은 Vault 최상위에, 폴더 우클릭 메뉴는 해당 폴더 안에 새 노트·하위 폴더를 즉시 만들고 인라인 이름 입력을 시작합니다. 이름 변경은 Enter/포커스 이동으로 저장하고 Esc로 취소합니다. 새 항목은 취소해도 기본 이름으로 남습니다. 노트 우클릭 메뉴는 이름 변경·이동·복제·내부 링크 복사·휴지통 이동을 제공합니다. 폴더는 이름 변경과 빈 폴더 삭제를 지원합니다. `leader r n` 또는 `F2`로 포커스된 노트·폴더의 이름을 사이드바에서 바꾸고 `leader n m`으로 이동합니다.

`Ctrl+h/j/k/l`은 왼쪽/아래/위/오른쪽 영역으로 포커스를 옮깁니다. Vim을 켜면 사이드바 `j/k`는 노트·폴더·데이터베이스 사이에서 포커스 표시와 함께 이동하며 생성·설정 버튼은 건너뜁니다. `h/l`은 폴더 접기·펼치기/부모·자식 이동/노트 열기입니다. 오른쪽 패널의 j/k는 열 수 있는 백링크·outgoing link만 순회하며 선택한 항목을 배경과 테두리로 표시합니다. h는 선택을 유지하고 l은 링크를 엽니다. 목록 갱신 중 선택을 보존하고, 대상이 사라지면 인접 링크 또는 본문 영역으로 이동합니다. 설정에서 일반 단축키와 leader 조합을 변경할 수 있습니다. Leader 시작 키는 **키 기록**으로 지정하며 기존 단축키와 겹치면 저장을 막습니다. macOS의 Mod는 Command, Windows/Linux의 Mod는 Ctrl이며 Ctrl·Meta는 해당 키 자체입니다. 기본 명령 팔레트는 macOS `Mod+k`, 다른 플랫폼은 `Mod+shift+P`입니다.

DB 표는 헤더와 데이터에 같은 세로선을 사용합니다. 별도 삭제 열 없이 행 번호 위치의 메뉴 또는 행 우클릭에서 휴지통으로 옮깁니다. 휴지통은 앱의 쓰기 직후 갱신되고 CLI 외부 변경은 최대 약 3초 뒤 반영됩니다.

```sh
foltra --vault ./my-vault folder create --name Projects
foltra --vault ./my-vault folder create --name Drafts --parent-id FOLDER_UUID
foltra --vault ./my-vault folder list
foltra --vault ./my-vault note update --id NOTE_UUID --expected-revision REVISION --folder-id FOLDER_UUID
```

최상위로 이동할 때는 `--folder-id ''`를 사용합니다. 폴더 변경도 `expectedRevision`을 요구하며 모든 명령은 `commands list`에 포함됩니다.

사이드바는 로고·검색 헤더 없이 탐색 메뉴부터 표시합니다. 파일 행의 별도 더보기 버튼 없이 우클릭 또는 Shift+F10으로 관리 메뉴를 엽니다. 로고는 시작 화면에 남기고, 내용 검색 메뉴와 명령 팔레트 단축키를 유지합니다. 노트를 폴더에 드래그하면 해당 폴더로 이동하고, **NOTES** 제목에 드롭하면 Vault 최상위로 꺼낼 수 있습니다. 접힌 대상 폴더는 이동 후 펼쳐집니다.

일반 단축키는 대소문자를 구분합니다. `Ctrl+h`와 `Ctrl+H`는 다르며 `Ctrl+H`는 `Ctrl+Shift+h`와 같습니다. Leader 뒤의 `r`과 `R`도 구분합니다. 예전 설정은 기존 동작을 유지하도록 읽고 다음 설정 저장 시 `shortcutVersion: 2`로 기록합니다. 이 필드가 없는 구버전 앱으로 되돌리는 것은 지원하지 않습니다.

한글 입력 소스에서 명령 키가 한글이나 `Process`/`Unidentified`로 전달되면 물리 키 위치와 Shift를 사용합니다. 영역 이동과 Vim Normal/Visual 명령에 적용하며, Insert 모드의 본문 입력과 `f`/`r` 뒤의 문자 인수는 기존 입력 경로를 유지합니다. 실제 macOS 입력기를 통한 검증 범위는 [개발 현황](docs/STATUS.md)을 참고하세요.

AnkiConnect 연동과 태그 블록/DB 카드 동기화 사용법은 [Anki 연결](docs/ANKI.md)을 참고하세요.
