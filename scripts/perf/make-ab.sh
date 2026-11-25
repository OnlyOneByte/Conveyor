#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: scripts/perf/make-ab.sh <base checkout> <head checkout> <out dir>" >&2
  exit 64
fi
here=$(cd "$(dirname "$0")" && pwd)
base=$(cd "$1" && pwd)
head=$(cd "$2" && pwd)
out="$3"
runs="${RUNS:-10}"
caddy_image="${CADDY_IMAGE:-caddy:2@sha256:4851e54a46b206517c574821bb5cc67f170d2156041e9fbc4c9193b45e84a75b}"
lighthouse="${LIGHTHOUSE:-$here/node_modules/.bin/lighthouse}"
if [ ! -x "$lighthouse" ]; then
  echo "$lighthouse is missing: run bun install --frozen-lockfile in $here" >&2
  exit 1
fi
mkdir -p "$out"
data=$(mktemp -d)
caddy="conveyor-perf-caddy-$$"
pids=()

cleanup() {
  for pid in ${pids[@]+"${pids[@]}"}; do kill "$pid" 2>/dev/null || true; done
  docker rm -f "$caddy" > /dev/null 2>&1 || true
  rm -rf "$data"
}
trap cleanup EXIT

free_port() {
  bun -e 'const s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } }); console.log(s.port); s.stop(true);'
}
API_PORT=$(free_port)
WEB_BASE_PORT=$(free_port)
WEB_HEAD_PORT=$(free_port)
BASE_PORT=$(free_port)
HEAD_PORT=$(free_port)
export API_PORT WEB_BASE_PORT WEB_HEAD_PORT BASE_PORT HEAD_PORT

(cd "$head/packages/api" && exec env CONVEYOR_AUTH=disabled CONVEYOR_QUEUE=sqlite CONVEYOR_QUEUE_UNSTABLE=1 \
  CONVEYOR_HOST=127.0.0.1 PORT="$API_PORT" DATA_DIR="$data" DB_PATH="$data/conveyor.db" \
  CONVEYOR_PROFILES_ROOT="$head/profiles" bun src/index.ts) > "$out/api.log" 2>&1 &
pids+=("$!")
(cd "$base/packages/web" && exec env HOST=127.0.0.1 PORT="$WEB_BASE_PORT" node build/index.js) > "$out/web-base.log" 2>&1 &
pids+=("$!")
(cd "$head/packages/web" && exec env HOST=127.0.0.1 PORT="$WEB_HEAD_PORT" node build/index.js) > "$out/web-head.log" 2>&1 &
pids+=("$!")
docker run -d --name "$caddy" --network host \
  -e API_PORT -e WEB_BASE_PORT -e WEB_HEAD_PORT -e BASE_PORT -e HEAD_PORT \
  -v "$here/Caddyfile:/etc/caddy/Caddyfile:ro" "$caddy_image" > /dev/null

ready() {
  for _ in $(seq 1 60); do
    if curl -skf -o /dev/null "$1"; then return 0; fi
    sleep 1
  done
  echo "$1 never answered" >&2
  return 1
}
for port in "$BASE_PORT" "$HEAD_PORT"; do
  ready "https://localhost:$port/"
  ready "https://localhost:$port/api/health"
done

measure() {
  if ! "$lighthouse" "$1" --quiet --only-categories=performance \
    --output=json --output-path="$out/$2.json" \
    --chrome-flags="--headless=new --ignore-certificate-errors --no-sandbox"; then
    if [ -f "$out/$2.json" ]; then mv "$out/$2.json" "$out/failed-$2.json"; fi
    return 1
  fi
}
port_of() { if [ "$1" = base ]; then echo "$BASE_PORT"; else echo "$HEAD_PORT"; fi; }

for variant in base head; do
  measure "https://localhost:$(port_of "$variant")/" "warmup-$variant" || echo "warm-up $variant failed"
done
for i in $(seq 1 "$runs"); do
  if [ $((i % 2)) -eq 1 ]; then order="base head"; else order="head base"; fi
  for variant in $order; do
    if measure "https://localhost:$(port_of "$variant")/" "$variant-$i"; then
      echo "run $i $variant done"
    else
      echo "run $i $variant failed; left out"
    fi
  done
done
