#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")"
PER_FILE=120
BUDGET=${TEST_EACH_BUDGET:-480}
run() {
  if command -v timeout > /dev/null; then
    timeout -k 10 "$2" bun test "$1"
  else
    bun test "$1"
  fi
}
mapfile -t files < <(find . -path ./node_modules -prune -o -name '*.test.ts' -print | sort)
failed=()
for file in "${files[@]}"; do
  left=$((BUDGET - SECONDS))
  if ((left < 15)); then
    failed+=("$file (not run: the ${BUDGET} s budget ran out)")
    continue
  fi
  run "$file" $((left < PER_FILE ? left : PER_FILE)) || failed+=("$file")
done
if ((${#failed[@]})); then
  printf 'failed: %s\n' "${failed[@]}"
  exit 1
fi
