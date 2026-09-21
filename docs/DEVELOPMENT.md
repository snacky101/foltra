# 개발 환경과 빌드

Node.js 24와 Rust stable, 운영체제의 [Tauri 개발 요구사항](https://v2.tauri.app/start/prerequisites/)이 필요합니다. 현재 macOS에서 빌드했습니다.

```sh
make install
make dev
```

첫 화면에서 빈 폴더를 선택해 vault를 만들거나 기존 Foltra vault를 엽니다. 예제 데이터는 “예제 노트와 DB를 담아 시작하기”를 선택한 경우에만 생성됩니다. 앱 이름은 Foltra, vault 이름과 위치는 사용자 지정입니다.

새 Vault는 현재/최근 Vault의 상위 위치에 이름과 같은 폴더를 제안합니다. 경로 입력창 오른쪽의 폴더 선택으로 상위 위치를 바꿀 수 있으며, 전체 경로를 직접 입력하면 그 경로를 유지합니다. Vim·Leader·단축키·편집 모드·테마와 설치한 확장은 현재 Vault별로 관리합니다. 사이드바 너비와 최근 Vault 목록은 기기별로 유지됩니다.

```sh
# macOS에서 독립 실행 가능한 개발용 앱 빌드
make build
open target/debug/bundle/macos/Foltra.app

# Apple Silicon용 앱·DMG·서명된 업데이트 파일·CLI 생성
make release

# 브라우저로 UI 개발: 실제 파일 코어를 연결하는 로컬 개발 서버
make dev-web
```

`make` 또는 `make help`로 전체 명령을 봅니다. `make build-web`은 프론트엔드 번들, `make build-cli`는 개발용 CLI만 빌드합니다. `make release`는 로컬 파일을 만들며 서명 키 설정은 [업데이트 안내](UPDATES.md)를 참고하세요.

검사·빌드·로컬 게시 명령은 성공 여부·소요 시간·로그 경로만 출력합니다. 전체 로그는 `test-results/tasks/명령.log`에 최근 실행 하나를 보관하며, 실패하면 마지막 40줄을 함께 표시합니다. 기존 배포 검증 자료는 덮어쓰지 않습니다.

macOS 기본 Make 3.81을 지원합니다. 빌드 작업 수는 `CARGO_BUILD_JOBS=4`, macOS 최소 버전은 `11.0`을 기본값으로 사용합니다. standalone Command Line Tools가 있으면 이를 사용하며, `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer make build`처럼 개발 도구를 직접 지정할 수 있습니다. 시스템의 Xcode 선택 설정은 바꾸지 않습니다. 한 번의 `make -j` 호출 안에서도 타깃은 순서대로 실행합니다.

### 개발 빌드 용량 관리

개발·테스트 빌드는 기본적으로 디버그 정보를 생성하지 않고 증분 컴파일 캐시를 사용하지 않습니다. 테스트 프로필은 개발 프로필을 상속합니다. Rust의 assertion·overflow 검사는 유지되지만, 내장 DuckDB는 이 설정에서 C++ 디버그 assertion도 끕니다. 상세 디버깅이 필요하면 `CARGO_PROFILE_DEV_DEBUG=2 make build` 또는 `CARGO_PROFILE_TEST_DEBUG=2 make test`로 일시적으로 켤 수 있습니다. 이 경우 큰 캐시가 다시 생길 수 있습니다.

`.cargo/config.toml`에도 macOS 최소 버전 `11.0`을 지정해 직접 실행하는 Cargo/npm과 Make의 빌드 환경을 맞춥니다. 명시적인 환경변수는 여전히 우선합니다.

```sh
make storage        # 실제 빌드/검증 자료 용량 확인
make check-storage  # target 15 GiB, test-results 1 GiB 초과 시 실패
make clean-cache    # 다시 만들 수 있는 개발용 의존성·core 캐시 정리
```

표준 Make/npm 빌드·검사 명령은 시작과 완료 시 용량을 확인하며, 개발 서버는 시작 시 확인합니다. 기준을 넘으면 후속 작업을 중단하고 정리 방법을 안내합니다. 한 번의 빌드 중 증가량까지 제한하는 디스크 할당량은 아니며, 직접 Cargo를 실행할 때는 `make check-storage`를 함께 실행해야 합니다. `CARGO_TARGET_DIR`를 지정했다면 해당 경로를 검사합니다.

`clean-cache`는 Cargo로 의존성·core의 개발 캐시만 지웁니다. 앱 번들·공용 CLI/앱 실행 파일·release 산출물·vault·검증 기록은 보존합니다. 다음 개발 빌드는 의존성을 다시 컴파일하므로 더 오래 걸립니다. 빌드·테스트와 동시에 실행하지 마세요. 검증용 CLI는 새로 빌드한 `target/debug/foltra`를 공유하고, 별도 작업 폴더마다 실행 파일이나 전체 소스를 복제해 남기지 않습니다. 릴리스 백업과 검증 증거는 자동 삭제하지 않습니다.

브라우저 개발 주소는 `http://127.0.0.1:1420`입니다. 이 서버는 개발 전용이며 네트워크 공유나 호스팅용이 아닙니다. 빌드한 데스크톱 앱은 이 서버 없이 실행됩니다.

## 검사와 코드 구조

```sh
make verify  # 테스트 → 타입·번들·포맷·Clippy 검사
make format
```

GUI와 CLI는 같은 Rust 코어를 사용합니다. 저장 규칙은 `crates/core`, 명령행 입력·출력은 `crates/cli`, 화면은 `src`, macOS 앱 연결은 `src-tauri`에 있습니다. 기능을 추가하기 전 [AGENTS.md](../AGENTS.md)와 [구조 안내](ARCHITECTURE.md)를 읽어주세요.

- [개발 현황](STATUS.md): 구현한 기능, 검사 결과, 아직 확인하지 못한 범위.
- [전체 설계](DESIGN.md): 장기 목표와 설계 가설. 현재 동작과 구분합니다.
- [업데이트·릴리스](UPDATES.md): 버전, 태그, 서명 키, Actions와 피드 복구.
- [플러그인 SDK](../packages/plugin-sdk/README.md): 확장 작성과 패키징.

[README로 돌아가기](../README.md)
