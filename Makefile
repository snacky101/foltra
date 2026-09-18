.DEFAULT_GOAL := help
SHELL := /bin/sh

# npm, Tauri and Cargo share the same build directory, even with make -j.
.NOTPARALLEL:
.PHONY: help install dev dev-web build build-web build-cli test check verify format release release-check release-publish

export CARGO_BUILD_JOBS ?= 4
export TAG

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

dev: ## 데스크톱 개발 모드 실행
	npm run tauri -- dev

dev-web: ## 브라우저 개발 서버 실행 (127.0.0.1:1420)
	npm run dev

build: ## 독립 실행 가능한 개발용 데스크톱 앱 빌드
	npm run tauri -- build --debug -- --locked

build-web: ## 프론트엔드 프로덕션 번들 빌드
	npm run build

build-cli: ## 개발용 CLI 빌드
	cargo build --locked -p foltra-cli

test: ## core·CLI·프론트엔드·배포·native 테스트
	npm test
	cargo test --locked -p foltra-desktop

check: ## 타입·번들·포맷·Clippy 검사
	npm run check

verify: test check ## 전체 테스트와 정적 검사를 순서대로 실행

format: ## 소스 코드 포맷
	npm run format

release: ## macOS arm64 앱·DMG·서명된 업데이트 파일·CLI 생성 (로컬)
	@test "$$(uname -s)-$$(uname -m)" = Darwin-arm64 || { echo 'release는 Apple Silicon Mac에서 실행하세요.' >&2; exit 1; }
	@set -eu; \
	if [ -z "$${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then \
		export TAURI_SIGNING_PRIVATE_KEY="$$HOME/.config/foltra/release/updater.key"; \
		test -r "$$TAURI_SIGNING_PRIVATE_KEY" || { echo 'TAURI_SIGNING_PRIVATE_KEY에 업데이트 서명 키 또는 키 파일 경로를 지정하세요.' >&2; exit 1; }; \
	fi; \
	export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$${TAURI_SIGNING_PRIVATE_KEY_PASSWORD-}"; \
	npm run release:mac
	cargo build --release --locked -p foltra-cli

release-check: ## TAG=vVERSION 의 소스·원격 태그·배포 순서 검사 (읽기 전용)
	@test -n "$$TAG" || { echo '사용법: make release-check TAG=vVERSION' >&2; exit 1; }
	node scripts/release-update.mjs preflight "$$TAG"

release-publish: ## TAG=vVERSION 의 빌드 파일을 GitHub에 게시하고 업데이트 피드 갱신
	@test -n "$$TAG" || { echo '사용법: make release-publish TAG=vVERSION' >&2; exit 1; }
	node scripts/release-update.mjs publish "$$TAG"
