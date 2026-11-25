#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")"
run() {
  if command -v timeout > /dev/null; then
    timeout -k 10 120 bun test "$1"
  else
    bun test "$1"
  fi
}
failed=()
for file in ./*.test.ts; do
  run "$file" || failed+=("$file")
done
if ((${#failed[@]})); then
  printf 'failed: %s\n' "${failed[@]}"
  exit 1
fi
