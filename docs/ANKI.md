# Anki integration

The Anki plugin syncs Foltra database rows and tagged Markdown blocks to AnkiConnect v6 on `127.0.0.1:8765`. It is a code package built with the Foltra SDK. Source discovery, mapping, conflict detection and UI belong to the plugin; the core only exposes a restricted local AnkiConnect transport.

## 사용법

1. Anki와 AnkiConnect를 실행합니다. 기본 주소는 `127.0.0.1:8765`입니다.
2. Foltra 설정 → 확장에서 **Anki 연결**을 설치하고 권한을 확인해 활성화합니다.
3. 확장 카드의 **설정**에서 연결 확인, 덱, 데이터베이스, **앞면 컬럼**과 **뒷면**을 선택하고 설정을 저장합니다. 뒷면 메뉴는 **컬럼 · 컬럼 이름** 또는 **연결된 노트 본문** 중 하나를 선택합니다. DB 없이 태그 블록만 사용할 수도 있습니다.
4. 명령 팔레트의 **Anki 동기화 열기** → **지금 동기화**로 확인한 뒤 설정에서 **저장 후 자동 동기화**를 켭니다. 두 화면은 같은 설정을 사용합니다. 자동 동기화는 Foltra와 Anki가 실행 중일 때 동작하며 작은 묶음으로 이어 처리합니다.

Anki 1.0.0도 재설치 없이 확장 카드의 **설정**에서 기존 동기화/설정 화면을 열 수 있습니다. 1.0.1부터는 설정 전용 화면을 제공합니다. 설치된 코드, 설정과 카드 연결 기록은 그대로 사용합니다.

1.3.0의 **뒷면** 메뉴에서 컬럼을 선택하면 그 컬럼 값만, **연결된 노트 본문**을 선택하면 해당 행에 연결된 노트 본문만 보냅니다. 본문을 선택했을 때 컬럼 값을 덧붙이거나 대체 값으로 사용하지 않습니다. 노트 제목·YAML 속성·Anki 식별 주석·출처 문구는 답에 추가하지 않습니다. 연결된 노트가 없거나 삭제되었거나 본문이 비어 있으면 해당 행에 해결 방법을 표시하고 기존 Anki 카드를 유지합니다. 다른 정상 행은 이어서 동기화합니다.

본문만 수정하거나 뒷면의 선택을 바꿔도 다음 동기화에서 같은 카드가 갱신됩니다. 본문의 vault 관리 이미지는 기존 이미지 전송을 사용하며, 그 외 Markdown은 글과 줄바꿈으로 보냅니다. 이전 뒷면 컬럼이 삭제되어도 본문을 선택한 동기화에는 영향을 주지 않습니다. 기존 Anki 수정 충돌 검사를 지키고 카드 ID·학습 일정을 유지합니다.

이전 Anki 패키지가 설치되어 있으면 **설정 → 확장 → Anki 연결 → v1.3.0 업데이트**를 누릅니다. 설정과 카드 연결 기록을 그대로 유지하며 패키지만 교체합니다. 코드가 바뀌므로 권한을 다시 확인하고 활성화해야 새 설정을 사용할 수 있습니다. 설치된 것만 보기에서도 업데이트할 수 있으며, 앱이 기존 패키지를 자동 교체하거나 더 낮은 버전으로 바꾸지는 않습니다.

이전의 본문 포함 옵션을 켰다면 **연결된 노트 본문**, 껐거나 설정이 없었다면 기존 **컬럼**을 선택한 상태로 엽니다. 설정을 여는 것만으로 저장된 데이터를 바꾸지는 않으며, 다음 저장 때 새 `backSource` 선택을 기록하고 옛 `includeNoteBody` 플래그를 제거합니다. 이미 새 선택이 저장되어 있으면 그 값을 우선합니다. 기존에 컬럼과 본문이 합쳐진 카드도 다음 동기화에서 선택한 한 가지 내용으로 갱신합니다.

```markdown
- Rust의 소유권이란? #anki
  - 값마다 소유자가 하나 있습니다.
  - 소유자가 범위를 벗어나면 값이 해제됩니다.
```

첫 줄이 앞면, 하위 내용이 뒷면입니다. 태그는 설정에서 바꿀 수 있습니다. 첫 동기화 때 원본 줄에 `<!-- foltra-anki:UUID -->` 식별 주석이 붙습니다. 읽기 화면과 편집 중이 아닌 Live Preview에서는 숨기며, 원문에는 남겨 수정·위치 변경에도 같은 Anki 카드를 찾습니다.

Anki에서도 내용을 고쳤다면 충돌 확인에서 양쪽을 비교하고 **Foltra 내용으로 덮어쓰기**를 명시적으로 선택할 수 있습니다. 검토 이후 Anki 내용이 다시 바뀌면 덮어쓰기를 거절합니다. AnkiConnect에는 서버 측 compare-and-swap 기능이 없어 동시 편집의 극히 짧은 검사/쓰기 사이를 완전히 원자적으로 만들지는 못합니다.

1.1.0부터 노트에 붙여넣은 이미지도 함께 전송합니다. 태그 블록 또는 DB의 앞면·뒷면에 있는 `![이미지](../attachments/…)`를 Anki 미디어에 저장하고 카드에서 이미지로 표시합니다. 같은 이미지는 재사용하며 기존 버전에서 텍스트로 전송한 이미지도 다음 동기화 때 같은 카드에서 갱신합니다. 이미지가 없거나 전송에 실패하면 해당 카드의 이전 내용을 유지합니다. Anki에서도 수정한 카드는 기존 충돌 확인을 따릅니다.

이번 버전은 **기본 앞면/뒷면 카드, Foltra → Anki 단방향**입니다. Cloze, 오디오·영상 첨부, Anki 수정/학습 일정의 역방향 가져오기는 지원하지 않습니다. PNG/JPEG/GIF/WebP의 vault 관리 이미지(파일당 최대 10 MiB, 카드당 서로 다른 이미지 20개)만 전송하며, 외부 URL·임의 파일·원시 HTML·코드 예시 속 이미지 문법은 로드하지 않습니다. 그 외 Markdown 원문의 글과 줄바꿈을 보냅니다. 덱 설정은 새 카드의 목적지이며 기존 카드의 덱·학습 일정은 유지합니다.

## Approved SDK contract extension

`anki.connect` grants `api.anki(action, params)` to commands/actions. It permits only card/deck/model operations used by this integration and the host action `storeVaultImage({path, profile})`, which additionally requires `notes.read`. The host validates managed attachment paths, hashes, formats and sizes, checks the active Anki profile, then uploads the bytes as `foltra-<sha256>.<ext>` without deleting existing media. It returns the media filename; binary data never enters the plugin JS heap. Raw `storeMediaFile`, media downloads, arbitrary URLs/files, SQL and deletion remain unavailable. Card HTML permits only exact managed image tags without additional attributes. No redirects or environment proxies; bounded request/response bodies and a short HTTP timeout. It does not grant general network access. `api.vaultId` and `api.createId()` provide stable provenance without exposing filesystem paths. HTTP wait time is excluded from the 500ms JS budget but invocation wall time is capped at 8s. Core calls keep existing revision and locking rules. Image cards are processed individually within that budget; an interrupted multi-image upload may leave unused media, which is not deleted automatically.

An optional manifest `backgroundCommand` names a declared script command. It requires the `automation` permission. Desktop dispatches it after workspace data changes settle, through the same serialized plugin session; disable/vault change cancels queued delivery. It receives `{automatic:true}`. Existing lifecycle/render/event handlers remain read-only. Plugins must make automatic actions idempotent; the Anki plugin additionally requires its auto-sync setting. CLI sync is explicit.

## Data model

The plugin owns a basic `Foltra` note type with Front, Back and Source fields. Users choose a deck, a database front column, and either one back column or the linked note body. Source revisions include this mapping and the linked note revision when applicable; changing the mapping or body updates the same row-based card identity. A tagged block uses the tagged first line as Front and descendant bullets/remaining paragraph as Back. First synchronization appends an invisible `<!-- foltra-anki:UUID -->` marker to the source line with a revision-checked note update. This preserves identity across edits and reorderings. Database row UUIDs need no marker.

From plugin 1.0.2, the card face shows the question and answer only. Source remains a separate metadata field; the `Foltra · …` source label is no longer appended to the visible answer. The host also normalizes the exact default model-creation request from installed 1.0.0/1.0.1 packages, without replacing their code, grants, or sync records.

Existing Anki note types retain their saved templates. For the old unmodified Foltra default, the answer template can be changed from `{{FrontSide}}<hr>{{Back}}<br><small>{{Source}}</small>` to `{{FrontSide}}<hr>{{Back}}`. This changes presentation, not card IDs, fields, or review schedules. Preserve any user-customized template rather than replacing it wholesale.

Each Anki note carries a unique source tag with vault and source identity. On retry, the plugin resolves this tag before adding anything. Stored last-sent fields allow detection of edits made in Anki. Conflicts, duplicate source identities, unavailable profiles, missing/deleted Anki notes and partial failures are reported; nothing is silently overwritten or deleted. Removing a source/tag retains Anki cards and review history. Foltra sends content to Anki; review schedules and Anki edits are not imported.

## Verification scope

Use temporary Foltra vaults and a uniquely named disposable Anki deck. Never modify existing user cards. Verify database/block creation, re-sync without duplicates, source edits, source reorder, manual Anki-edit conflicts, missing connection and permission checks. The normal suite must not depend on a running personal Anki instance.

AnkiConnect upstream: https://git.sr.ht/~foosoft/anki-connect (the former FooSoft GitHub repository points here). The locally installed AnkiConnect implementation is also inspected for the actual v6 action signatures.
