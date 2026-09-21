#!/bin/sh
# Keep routine output out of the terminal; retain the latest complete task log.
set -u
task=${1-}
case "$task" in
  ''|*[!a-z0-9-]*) echo 'Usage: run-task.sh task-name command [args...]' >&2; exit 2 ;;
esac
shift
[ "$#" -gt 0 ] || { echo 'A command is required.' >&2; exit 2; }
mkdir -p test-results/tasks || exit 1
log="test-results/tasks/$task.log"
started=$(date +%s)
printf '[%s] 시작 · 로그: %s\n' "$task" "$log"
if "$@" >"$log" 2>&1; then
  status=0
else
  status=$?
fi
elapsed=$(($(date +%s) - started))
if [ "$status" -eq 0 ]; then
  printf '[%s] 완료 · %ss · 로그: %s\n' "$task" "$elapsed" "$log"
else
  printf '[%s] 실패 · exit %s · %ss · 로그: %s\n' "$task" "$status" "$elapsed" "$log" >&2
  tail -n 40 "$log" >&2
fi
exit "$status"
