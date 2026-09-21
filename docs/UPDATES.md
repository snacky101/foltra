# 앱 업데이트와 릴리스 배포

Foltra의 앱 업데이트는 GitHub의 **배포된 릴리스**를 사용합니다. 소스 커밋을 `main`에 푸시하는 것만으로 설치된 앱을 교체하지 않습니다. 버전을 올리고 해당 버전 태그를 푸시하면 GitHub Actions가 검사·빌드·배포를 수행하고, 사용자가 앱에서 업데이트를 확인하고 설치할 수 있습니다.

업데이트 기능이 없던 `0.1.0-preview.1` 사용자는 이 기능이 포함된 버전을 **처음 한 번 DMG로 설치**해야 합니다. 이후 업데이트는 새 DMG를 직접 받을 필요 없이 앱에서 진행합니다. 현재 배포 대상은 macOS Apple Silicon입니다.

## 배포 파일과 피드

소스와 배포 저장소는 공개 저장소 `snacky101/foltra`입니다. 업데이트 조회에 사용자 GitHub 로그인이나 token은 필요하지 않습니다.

앱은 다음 고정 주소에서 업데이트 정보를 확인합니다.

```text
https://github.com/snacky101/foltra/releases/download/updater/latest.json
```

`updater`는 메타데이터를 담는 전용 prerelease입니다. 이곳의 `latest.json`이 버전별 릴리스의 서명된 앱 파일을 가리킵니다. 실제 설치 파일은 `v0.1.0-preview.2`와 같은 **버전별 태그**에 보관하며, 한번 게시한 버전의 파일을 교체하지 않습니다. GitHub의 `/releases/latest`는 prerelease를 제외하므로 사용하지 않습니다.

버전별 릴리스에는 다음 여섯 파일이 모두 있어야 합니다.

| 파일 | 용도 |
| --- | --- |
| `Foltra_VERSION_aarch64.dmg` | 처음 설치하거나 수동 업데이트 |
| `Foltra.app.tar.gz` | 앱 내부 업데이트용 번들 |
| `Foltra.app.tar.gz.sig` | Tauri updater 서명 |
| `foltra-cli_VERSION_macos-aarch64.tar.gz` | 독립 실행 CLI |
| `latest.json` | 이 버전의 업데이트 정보와 서명 |
| `SHA256SUMS.txt` | 위 다섯 파일의 SHA-256 |

CLI는 앱 업데이트에 의해 별도로 교체되지 않습니다. CLI를 사용한다면 해당 릴리스의 CLI 파일을 내려받습니다.

## 릴리스 만드는 순서

1. npm의 `package.json`과 `package-lock.json`, workspace `Cargo.toml`과 `Cargo.lock`의 Foltra 패키지 세 개, `src-tauri/tauri.conf.json` 버전을 동일하게 올립니다. 프리뷰도 `preview.2` → `preview.3`처럼 증가시킵니다. `+build` 부분만 바꾸는 것은 업데이트로 인정하지 않습니다.
2. 변경을 커밋하고 `vVERSION` 태그가 정확히 그 커밋을 가리키도록 만듭니다.
3. 소스와 태그를 푸시합니다. 예를 들어 다음 버전이 `0.1.0-preview.3`인 경우:

```sh
git tag v0.1.0-preview.3
git push origin main v0.1.0-preview.3
```

`.github/workflows/release.yml`이 태그 푸시를 받아 실행됩니다. GitHub Actions의 **Release macOS update → Run workflow**에서 이미 존재하는 버전 태그를 지정해 실행할 수도 있습니다.

워크플로는 macOS 15 arm64 runner, Node.js 24, Rust stable을 사용합니다. 버전·원격 태그·소스 커밋과 현재 피드보다 높은 버전인지 먼저 확인합니다. 이후 `npm ci`, `npm test`(core·CLI·프론트엔드·배포 스크립트), `cargo test --locked -p foltra-desktop`, `npm run check`, 앱·DMG·CLI 빌드를 순서대로 수행합니다. 검사 뒤에는 재생성 가능한 개발 의존성 캐시를 정리해 release 캐시와 합쳐 용량 제한을 넘지 않도록 하고, native 테스트·CLI 빌드 뒤에도 용량을 검사합니다. 전체 빌드는 네이티브 의존성 때문에 시간이 걸릴 수 있으며 Rust 캐시를 재사용합니다.

```sh
# 로컬 검사 후 배포용 앱·DMG·업데이트 번들·CLI 생성
make verify release
```

`make release`는 Apple Silicon Mac에서 로컬 파일만 생성합니다. 앱과 업데이트 파일은 `target/release/bundle/macos/`, DMG는 `target/release/bundle/dmg/`, CLI는 `target/release/foltra`에 생성됩니다. `make build`는 서명 키가 필요 없는 개발용 앱을 `target/debug/bundle/macos/`에 만듭니다.

서명 키를 지정하지 않으면 `~/.config/foltra/release/updater.key`를 사용합니다. 다른 키 파일이나 CI의 키 본문은 `TAURI_SIGNING_PRIVATE_KEY`, 키 암호는 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 환경변수로 전달합니다. Makefile은 키 값을 명령에 출력하지 않으며 파일이 없다고 새 키를 생성하지 않습니다.

기본 배포 경로는 위의 태그 push와 GitHub Actions입니다. 로컬에서 수동 배포하거나 피드 게시를 재시도해야 한다면, 버전과 일치하는 **커밋·로컬 태그·원격 태그**가 준비된 상태에서 다음 명령을 사용합니다. 예시 태그는 실제 버전에 맞게 바꿉니다.

```sh
make release-check TAG=v0.1.0-preview.2   # 읽기 전용 사전 검사
make release-publish TAG=v0.1.0-preview.2 # 실제 GitHub 게시 및 피드 갱신
```

수동 게시 전에는 같은 커밋에서 `make verify release`를 완료해야 합니다. `release-publish`는 빌드나 커밋·태그 생성·push를 수행하지 않으며, 이미 게시된 버전의 피드 재시도에는 재빌드가 필요하지 않습니다. GitHub Actions와 수동 게시를 동시에 실행하지 마세요. 여섯 배포 파일을 모은 최종 폴더는 `target/release/update-assets/`입니다. `release-check`와 `release-publish`는 `gh` 로그인 또는 `GH_TOKEN`이 필요합니다.

배포 스크립트는 앱 버전·bundle ID·arm64 실행 파일·macOS 코드 서명을 검사합니다. 업데이트 압축을 열어 경로·파일 종류·필수 앱 파일을 확인하고, 별도 임시 폴더에 추출한 앱도 동일하게 검사합니다. Minisign의 파일 서명·키 ID·서명된 설명을 앱의 공개키로 검증하며, 모든 배포 파일의 체크섬을 생성합니다.

릴리스는 먼저 **draft**로 만들고 파일 여섯 개를 올립니다. GitHub에서 파일을 다시 받아 체크섬·업데이트 서명·추출한 앱을 검증한 다음 게시합니다. 마지막에만 `updater/latest.json`을 새 버전으로 교체합니다. 그 전까지 기존 피드는 유지됩니다. 워크플로를 직렬 실행하고, 피드가 가리키는 버전보다 낮거나 같은 버전으로 교체하지 않습니다.

## 실패와 재실행

GitHub에서 쓰기 성공 직후 새 상태가 조회되지 않으면 생성된 초안·게시 상태·피드를 잠시 재조회합니다. 생성·업로드·게시 요청 자체를 반복하지 않으며, 조회 한도를 넘거나 API 오류가 발생하면 중단합니다.

- 게시 전 실패하면 draft는 남습니다. 같은 태그로 재실행하면 같은 소스 커밋의 draft에 한해서 파일을 다시 올리고 검증합니다. 알 수 없는 추가 파일이 있는 draft는 자동 게시하지 않습니다.
- 버전 릴리스 게시 후 피드 갱신만 실패했다면 같은 태그로 재실행합니다. 앱을 다시 빌드하거나 게시된 파일을 덮어쓰지 않고, 기존 배포 파일을 검증한 뒤 피드를 갱신합니다.
- 이미 피드까지 갱신된 버전의 재실행은 거절합니다. 수정할 내용이 있으면 버전을 올립니다.
- 태그를 강제로 이동하거나 게시된 릴리스 파일을 수동으로 교체하지 않습니다. 이 워크플로는 force push를 사용하지 않습니다.

전용 `updater` 릴리스의 `latest.json`을 수동 삭제하지 마세요. 존재하는 피드가 손상되거나 파일이 사라진 경우 새 배포는 이를 무시하지 않고 중단합니다.

GitHub의 동일 이름 파일 교체는 삭제 후 업로드이므로, 마지막 피드 업로드 중 네트워크 단절이나 작업 취소가 발생하면 피드 파일이 없어질 수 있습니다. 이 경우 **이미 전체 검증을 마치고 게시된 버전**의 `latest.json`으로 복구합니다. 아래 태그는 마지막 정상 버전 또는 방금 검증·게시를 마친 버전으로 바꿉니다. Draft나 파일 일부만 올린 릴리스는 사용하지 않습니다.

```sh
foltra_feed_repair_dir=$(mktemp -d)
gh release download v0.1.0-preview.2 --repo snacky101/foltra \
  --pattern latest.json --dir "$foltra_feed_repair_dir"
gh release upload updater "$foltra_feed_repair_dir/latest.json" \
  --repo snacky101/foltra --clobber
```

복구한 피드가 새 버전을 이미 가리키면 해당 배포는 완료 상태입니다. 이전 버전으로 복구한 경우 실패했던 새 버전 태그의 워크플로를 재실행할 수 있습니다. 업데이트 JSON을 직접 편집하거나 서명을 새로 붙이지 않습니다.

## 서명 키

앱 설정에 포함되는 것은 **공개키**입니다. 개인키는 저장소·릴리스·앱 번들에 포함하지 않습니다. 현재 로컬 개인키 보관 경로는 다음과 같습니다.

```text
~/.config/foltra/release/updater.key
```

GitHub Actions의 `TAURI_SIGNING_PRIVATE_KEY` repository secret에 이 개인키를 저장합니다. 현재 키의 암호는 비어 있으며, 암호를 사용하는 키로 구성할 때만 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret을 함께 설정합니다. 워크플로는 서명 빌드 단계에만 이 값을 전달하며, 배포 권한은 해당 저장소의 `contents: write`를 가진 `GITHUB_TOKEN`을 사용합니다.

개인키를 별도 안전한 장소에 백업해야 합니다. 설치된 앱은 내장된 공개키와 일치하는 서명만 허용하므로 개인키를 잃어버리고 새 키로 바꾸는 것으로 기존 사용자의 업데이트를 이어갈 수 없습니다.

Tauri updater 서명은 **Apple Developer ID 서명·공증과 별개**입니다. 현재 앱의 ad-hoc 서명과 Gatekeeper 조건은 자동 업데이트 기능을 넣었다고 달라지지 않습니다.

## 검증 범위

`node --test scripts/release-update.test.mjs`는 버전 정렬, 태그·버전 일치, 피드 역행 거절, manifest URL, 파일 누락·변조, 압축 경로와 Minisign 검증을 검사합니다. 실제 Tauri CLI로 임시 키를 생성해 서명한 파일의 양성·변조 음성 테스트와 GitHub 조회 지연·재시도 한도·권한 오류 검사도 포함합니다. 테스트 키는 종료할 때 지웁니다.

로컬 테스트 통과가 GitHub hosted runner 실행이나 실제 사용자 앱 교체의 성공을 대신하지 않습니다. 최초 태그 배포 시 Actions 로그와 게시된 파일, 설치된 이전 버전의 업데이트 흐름을 함께 확인해야 합니다.

참고: [Tauri updater](https://v2.tauri.app/plugin/updater/), [GitHub 릴리스 API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release), [GitHub hosted runner 사양](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
