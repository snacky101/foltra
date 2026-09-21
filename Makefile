.DEFAULT_GOAL := help
SHELL := /bin/sh

# npm, Tauri and Cargo share the same build directory, even with make -j.
.NOTPARALLEL:
.PHONY: help install dev dev-web build build-web build-cli test check verify format release release-check release-publish release-status release-wait release-logs require-run storage check-storage clean-cache

export CARGO_BUILD_JOBS ?= 4
export TAG RUN

ifeq ($(shell uname -s),Darwin)
export MACOSX_DEPLOYMENT_TARGET ?= 11.0
# Use the standalone tools when available; an explicit Xcode selection wins.
ifneq ($(wildcard /Library/Developer/CommandLineTools/usr/bin/clang),)
export DEVELOPER_DIR ?= /Library/Developer/CommandLineTools
endif
endif

help: ## 사용 가능한 명령 보기 (기본값)
	@awk 'BEGIN { FS = ":.*## " } /^[a-z][a-z-]*:.*## / { printf "  make %-22s %s\n", $$1, $$2 }' Makefile

install: ## 프론트엔드 의존성 설치
	npm ci

dev: check-storage ## 데스크톱 개발 모드 실행
	npm run tauri -- dev

dev-web: check-storage ## 브라우저 개발 서버 실행 (127.0.0.1:1420)
	npm run dev

build: check-storage ## 독립 실행 가능한 개발용 데스크톱 앱 빌드
	@sh scripts/run-task.sh build npm run tauri -- build --debug -- --locked --workspace
	$(MAKE) check-storage

build-web: check-storage ## 프론트엔드 프로덕션 번들 빌드
	@sh scripts/run-task.sh build-web npm run build

build-cli: check-storage ## 개발용 CLI 빌드
	@sh scripts/run-task.sh build-cli cargo build --locked -p foltra-cli
	$(MAKE) check-storage

test: check-storage ## core·CLI·프론트엔드·배포·native 테스트
	@sh scripts/run-task.sh test npm test
	$(MAKE) check-storage

check: check-storage ## 타입·번들·포맷·Clippy 검사
	@sh scripts/run-task.sh check npm run check

verify: test check ## 전체 테스트와 정적 검사를 순서대로 실행

format: ## 소스 코드 포맷
	npm run format

release: check-storage ## macOS arm64 앱·DMG·서명된 업데이트 파일·CLI 생성 (로컬)
	@test "$$(uname -s)-$$(uname -m)" = Darwin-arm64 || { echo 'release는 Apple Silicon Mac에서 실행하세요.' >&2; exit 1; }
	@set -eu; \
	if [ -z "$${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then \
		export TAURI_SIGNING_PRIVATE_KEY="$$HOME/.config/foltra/release/updater.key"; \
		test -r "$$TAURI_SIGNING_PRIVATE_KEY" || { echo 'TAURI_SIGNING_PRIVATE_KEY에 업데이트 서명 키 또는 키 파일 경로를 지정하세요.' >&2; exit 1; }; \
	fi; \
	export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$${TAURI_SIGNING_PRIVATE_KEY_PASSWORD-}"; \
	sh scripts/run-task.sh release npm run release:mac -- -- --locked --workspace
	$(MAKE) check-storage

storage: ## 빌드 캐시와 검증 자료의 용량 보기
	node scripts/build-storage.mjs report

check-storage: ## 빌드 캐시 15 GiB·검증 자료 1 GiB 초과 시 중단
	node scripts/build-storage.mjs check

clean-cache: ## 개발용 의존성·core 캐시 정리 (앱 번들·CLI·릴리스 보존)
	node scripts/clean-build-cache.mjs
	$(MAKE) storage

release-check: ## TAG=vVERSION 의 소스·원격 태그·배포 순서 검사 (읽기 전용)
	@test -n "$$TAG" || { echo '사용법: make release-check TAG=vVERSION' >&2; exit 1; }
	node scripts/release-update.mjs preflight "$$TAG"

release-publish: ## TAG=vVERSION 의 빌드 파일을 GitHub에 게시하고 업데이트 피드 갱신
	@test -n "$$TAG" || { echo '사용법: make release-publish TAG=vVERSION' >&2; exit 1; }
	@sh scripts/run-task.sh release-publish node scripts/release-update.mjs publish "$$TAG"

require-run:
	@case "$$RUN" in ''|*[!0-9]*) echo 'RUN에 GitHub Actions 실행 번호를 지정하세요.' >&2; exit 2 ;; esac

release-status: require-run ## RUN=실행번호 의 배포 상태·job 결과 요약 (읽기 전용)
	@gh run view "$$RUN" --repo snacky101/foltra --json displayTitle,status,conclusion,jobs,url --jq '"\(.displayTitle): \(if .conclusion == "" then .status else .conclusion end)\n\(.url)", (.jobs[] | "  \(.name): \(if .conclusion == "" then .status else .conclusion end)")'

release-wait: require-run ## RUN=실행번호 의 완료까지 60초 간격으로 대기 (실패 시 실패 반환)
	@sh scripts/run-task.sh release-wait gh run watch "$$RUN" --repo snacky101/foltra --interval 60 --compact --exit-status

release-logs: require-run ## RUN=실행번호 의 실패 로그를 파일로 저장 (읽기 전용)
	@sh scripts/run-task.sh release-failed gh run view "$$RUN" --repo snacky101/foltra --log-failed
