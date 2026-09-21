# Foltra CLI

CLI는 앱을 켜지 않아도 볼트의 노트·DB·확장·설정을 읽고 수정합니다. 앱과 같은 저장 코어, 볼트 잠금, revision 검사와 복구 journal을 사용합니다. 설치는 macOS 앱의 **설정 → CLI → CLI 설치**에서 합니다. 개발 중에는 `make build-cli`로 빌드한 `./target/debug/foltra`를 사용합니다.

## 시작하기

```sh
foltra help
foltra help all
foltra read --help
foltra help database property update
foltra commands list --json
```

`commands.list`는 인자 스키마와 읽기 전용 여부를 반환하며 볼트를 지정하면 설치한 확장 명령도 포함합니다. `note read`, `note.read`, `note:read`는 같은 명령입니다. `db`는 `database`의 별칭이며 `db record create`도 지원합니다.

볼트는 `--vault PATH` → `FOLTRA_VAULT` → 현재 디렉터리의 상위 Foltra 볼트 순서로 찾습니다. 최근 사용한 앱 볼트를 추측해 선택하지 않습니다. `--vault`는 명령 앞이나 뒤에 둘 수 있습니다.

```sh
export FOLTRA_VAULT="$HOME/Foltra/Personal"
foltra files
foltra read --note '프로젝트 메모'
foltra --vault /path/to/vault read --note '프로젝트 메모'
```

`--note`는 정확한 제목 또는 UUID를 받습니다. 같은 제목이 둘 이상이면 오류를 반환하므로 UUID를 지정하세요. `--note-path /path/to/vault/notes/UUID.md`로 관리되는 노트 파일도 선택할 수 있습니다. 명시한 볼트와 파일의 볼트가 다르면 거절합니다. 표시용 폴더 구조와 `notes/UUID.md` 저장 경로는 서로 다릅니다.

`foltra PATH` / `foltra open PATH`는 기존처럼 macOS 앱에서 볼트·노트를 엽니다. 데이터 명령은 앱을 실행하지 않습니다. 명령과 같은 이름의 파일 경로는 `./` 또는 `open`으로 구분합니다.

## 노트 작성·관리

```sh
foltra create --title '프로젝트 메모' --content '# 프로젝트'
printf '\n- 다음 할 일\n' | foltra append --note '프로젝트 메모' --content-file -
foltra prepend --note '프로젝트 메모' --content '맨 앞에 추가'
foltra append --note '프로젝트 메모' --content '!' --inline
foltra rename --note '프로젝트 메모' --title '프로젝트 계획'
foltra folder create --name Projects
foltra move --note '프로젝트 계획' --folder Projects
foltra move --note '프로젝트 계획' --folder /
foltra delete --note '프로젝트 계획'
foltra trash list
foltra trash restore --id TRASH_UUID
```

- `read`는 Markdown 본문을 그대로 출력합니다. `read --json` 또는 `note.read`는 ID·제목·본문·revision을 포함합니다.
- `append`와 `prepend`는 기본적으로 기존 본문과 추가 내용 사이에 필요한 줄바꿈 하나를 넣습니다. `--inline`이면 줄바꿈을 보충하지 않습니다. 이미 있는 공백·줄바꿈을 삭제하지 않으며 `prepend`는 사용자 frontmatter 다음에 삽입합니다.
- `--content-file` / `--body-file`은 UTF-8 파일을 읽고 `-`이면 표준입력을 읽습니다. 본문은 16 MiB 입력 한도를 적용합니다. 문자열 인자는 일반적으로 `--인자-file` 형태도 지원합니다.
- `--folder`는 정확한 폴더 이름 또는 ID를 받으며 `/`는 볼트 루트입니다. 중복 이름은 ID로 구분합니다. 새 노트의 폴더 또는 `folder.create`의 부모 폴더에도 사용할 수 있습니다.
- `delete`는 휴지통으로 이동합니다. 영구 삭제는 별도의 `trash.delete --help`에 나온 ID·revision 계약을 따릅니다.

## 일지·할 일

```sh
foltra daily                     # 오늘 일지 읽기 (없으면 오류)
foltra daily create              # 오늘 일지가 없으면 생성
foltra daily append --content '- [ ] 검토하기'
foltra daily prepend --date 2026-09-21 --content '오늘의 계획'
foltra tasks --status todo
foltra tasks --note '2026-09-21'
foltra task --note '2026-09-21' --line 5 --status done
foltra task --note '2026-09-21' --line 5 --toggle
```

기본 날짜는 실행하는 기기의 현지 날짜이며 `YYYY-MM-DD` 제목을 사용합니다. 일지 캘린더와 같은 날짜 제목을 찾지만 확장 설치가 필요하지 않습니다. 읽기는 누락된 노트를 만들지 않고, 생성은 기존 본문을 덮어쓰지 않습니다. 추가·앞에 넣기는 누락된 일지를 생성하며 `--folder`로 생성 위치를 지정할 수 있습니다. 이미 있는 일지의 폴더는 바꾸지 않습니다. 같은 날짜의 제목이 여러 개면 일반 노트 명령과 ID로 선택하세요.

할 일의 `line`은 관리용 파일 헤더를 제외한 **본문의 1부터 시작하는 행 번호**입니다. 사용자 frontmatter 줄은 포함합니다. 목록 안의 실제 작업만 수집하며 코드 블록·일반 문장·YAML 예제는 제외합니다. `--toggle`은 완료 ↔ 할 일, `--status`는 특정 상태로 변경합니다. 두 옵션은 동시에 쓰지 않습니다.

| 상태 | 원문 |
| --- | --- |
| `todo` | `[ ]` |
| `doing` | `[/]` |
| `done` | `[x]` |
| `bookmark` | `[b]` |
| `cancelled` | `[-]` |
| `deferred` | `[>]` |
| `question` | `[?]` |
| `important` | `[!]` |
| `star` | `[*]` |
| `info` | `[i]` |
| `pin` | `[p]` |

에이전트가 목록을 조회한 뒤 작업을 변경할 때는 조회 결과의 `revision`을 `--expected-revision`에 넣으세요. 그 사이 다른 편집으로 행이 이동했으면 실패하여 엉뚱한 작업을 수정하지 않습니다.

## 사용자 frontmatter 속성

```sh
foltra properties --note '프로젝트 계획'
foltra property set --note '프로젝트 계획' --name status --value draft
foltra property set --note '프로젝트 계획' --name priority --value 2 --type number
foltra property set --note '프로젝트 계획' --name published --value false --type boolean
foltra property set --note '프로젝트 계획' --name tags --value '["work","idea"]' --type json
foltra property remove --note '프로젝트 계획' --name priority
```

기본 타입은 문자열이며 숫자처럼 보이는 값도 그대로 문자열로 저장합니다. `json`은 배열·객체·null도 지원합니다. 앞부분에 사용자 frontmatter가 없으면 만듭니다. 선택한 속성의 값과 해당 속성에 붙은 공백/주석은 변경될 수 있으며 나머지 YAML 소스, 본문과 관리용 ID·생성일은 보존합니다.

잘못된 YAML·중복 키·지원하지 않는 YAML 태그는 거절합니다. `{key: value}` 형태의 최상위 flow mapping과 명시적인 complex key는 소스 편집을 요구합니다. 지원하지 않는 구조를 통째로 재직렬화하여 주석을 잃게 하지 않습니다.

## 검색·연결 조회

```sh
foltra search --query '프로젝트'
foltra find --query '프로젝트' --limit 50
foltra find --note '계획' --query TODO --case-sensitive
foltra find --query todo --no-case-sensitive
foltra tags
foltra tags blocks --tag study
foltra links --note '프로젝트 계획'
foltra backlinks --note '프로젝트 계획'
foltra unresolved
foltra orphans
foltra deadends
foltra outline --note '프로젝트 계획'
foltra wordcount --note '프로젝트 계획'
```

`search`는 기존 제목·본문 검색과 `tag:study` 검색을 유지합니다. `find` (`search.context`)는 본문에서 문자열이 일치하는 행과 앞뒤 한 행, 제목·ID·revision을 반환합니다. 기본적으로 대소문자를 구분하지 않으며 결과는 최대 200행입니다. 정규식이나 Obsidian 검색식 파서는 제공하지 않습니다.

연결 조회는 Foltra의 `[[위키 링크]]` 인덱스를 사용합니다. `links.list`는 전체 연결(레코드 본문 연결 포함), `links`는 지정 노트의 outgoing 연결, `unresolved`는 미해결 링크입니다. `orphans`는 다른 노트/레코드에서 들어오는 연결이 없는 노트, `deadends`는 outgoing 위키 링크가 없는 노트입니다. 일반 외부 Markdown URL은 이 지식 연결 조회에 포함되지 않습니다. `wordcount`는 frontmatter를 제외한 원문에 대해 공백으로 나눈 단어 수·Unicode 문자 수·줄 수·UTF-8 바이트 수를 반환합니다.

## DB·SQL·확장·설정

전체 코어 명령의 인자를 일반 옵션으로 쓸 수 있습니다. `databaseId`는 `--database-id`, `expectedRevision`은 `--expected-revision`처럼 camelCase를 kebab-case로 바꿉니다. 객체/배열은 JSON, 정수/불리언은 해당 타입으로 전달합니다. 불리언은 값 없이 켜거나 `--no-옵션`으로 끌 수 있습니다.

```sh
foltra databases
foltra database create --name Tasks
foltra record create --database Tasks --values '{"title":"정리하기"}'
foltra query catalog
foltra sql --sql 'SELECT * FROM "Tasks"' --format csv
cat query.sql | foltra sql --sql-file -
foltra database property update --help
foltra plugins
foltra extension install --manifest-file ./plugin.json
foltra extension status
foltra extension settings get --id PLUGIN_ID
foltra extension settings update --help
foltra settings get
foltra git status
foltra git sync --help
```

`--database`는 `databaseId` 인자를 받는 명령에서 정확한 DB 이름 또는 ID를 선택합니다. 변경/삭제에 필요한 revision은 `database.inspect` 등 해당 조회 명령에서 얻습니다. 확장의 활성화·권한·설정 규칙, Git 충돌 처리 계약은 GUI와 같은 코어에서 검증합니다. 설치한 확장 명령의 인자는 `foltra help plugin.확장ID.명령ID`와 `commands.list`로 확인하세요. 테마 패키지 역시 기존 extension 데이터 명령으로 관리하며 화면의 테마 선택은 `settings` 계약을 따릅니다.

## 출력과 에이전트 연동

`read`, `daily` 단축 명령만 Markdown 기본 출력이며 **기존 데이터 명령과 RPC의 기본 출력은 JSON을 유지**합니다.

| 옵션 | 출력 |
| --- | --- |
| `--json` / `--format json` | 전체 JSON 결과, SQL 컬럼 메타데이터 포함 |
| `--format jsonl` | 배열/SQL 결과의 각 행을 JSON 한 줄로 출력 |
| `--format text` | 노트 본문 또는 간단한 목록, SQL은 TSV |
| `--format csv` | 헤더와 CSV, SQL 컬럼 순서·중복 컬럼명 보존 |
| `--format tsv` | 헤더와 TSV, 셀의 탭/줄바꿈/역슬래시는 이스케이프 |

결과는 stdout, 오류 JSON은 stderr입니다. 성공 exit 0, revision 충돌 exit 3, 나머지 실패 exit 1입니다. 파일 쓰기 전 출력 형식을 검증하므로 형식 오타로 변경을 실행한 뒤 실패하지 않습니다.

```sh
printf '%s' '{"command":"note.read","args":{"id":"NOTE_UUID"}}' | foltra rpc
foltra note update --id NOTE_UUID --expected-revision REVISION --body-file ./draft.md
foltra query run --args '{"databaseId":"DATABASE_UUID","limit":100}'
foltra vault export > snapshot.json
foltra --vault /new/empty/folder vault import --snapshot-file snapshot.json
```

`--args`는 전체 인자 객체, `--file`은 그 객체가 들어 있는 JSON 파일입니다. RPC는 `{command,args}` 요청 하나를 표준입력에서 읽으며 18 MiB를 넘으면 실패합니다. 본문/JSON 파일 입력은 16 MiB 제한입니다.

일반 수정·삭제 명령은 기존처럼 `expectedRevision`을 요구합니다. `--note`/`--note-path`로 바로 실행할 때 생략하면 방금 선택한 노트 snapshot의 revision을 한 번 사용합니다. 명시한 revision을 대신하거나 충돌 후 자동 재시도하지 않습니다. 에이전트의 read → 판단 → write 작업은 **처음 읽은 revision을 명시**해야 합니다. `append`/`prepend`는 볼트 잠금 안에서 현재 본문을 읽고 추가하는 원자적 작업이며 선택적으로 revision 조건을 붙일 수도 있습니다.

## 쉘 자동완성

```sh
# Bash
source <(foltra completions bash)

# Zsh: compinit을 사용하는 ~/.zshrc에서
source <(foltra completions zsh)

# Fish
foltra completions fish | source
```

명령 이름과 옵션을 완성하고 파일 인자는 쉘의 경로 완성을 사용합니다. 데이터 명령은 점 표기(`note.append`)로 완성합니다. 명령/옵션 후보는 스키마에서 생성하며 동적인 노트 제목 후보나 TUI는 아직 제공하지 않습니다.

## 현재 범위

Obsidian CLI는 실행 중인 앱의 현재 파일·탭·명령 팔레트·개발자 도구까지 제어합니다([공식 문서](https://help.obsidian.md/cli)). 이번 Foltra CLI는 앱 없이 실행되는 데이터 작업을 확장합니다. 앱 경로 열기는 기존 기능을 유지하지만 현재 선택 영역·커서·탭·UI 명령 실행, TUI, 임의 JavaScript 실행, Obsidian Sync/Publish에 해당하는 기능은 포함하지 않습니다.
