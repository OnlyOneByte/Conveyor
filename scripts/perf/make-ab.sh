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
lighthouse="${LIGHTHOUSE:-lighthouse@12.8.2}"
mkdir -p "$out"
data=$(mktemp -d)
pids=()

cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  docker rm -f conveyor-perf-caddy > /dev/null 2>&1 || true
  rm -rf "$data"
}
trap cleanup EXIT

(cd "$head/packages/api" && exec env CONVEYOR_AUTH=disabled CONVEYOR_QUEUE=sqlite CONVEYOR_QUEUE_UNSTABLE=1 \
  CONVEYOR_HOST=127.0.0.1 PORT=3000 DATA_DIR="$data" DB_PATH="$data/conveyor.db" \
  CONVEYOR_PROFILES_ROOT="$head/profiles" bun src/index.ts) > "$out/api.log" 2>&1 &
pids+=("$!")
(cd "$base/packages/web" && exec env HOST=127.0.0.1 PORT=3001 node build/index.js) > "$out/web-base.log" 2>&1 &
pids+=("$!")
(cd "$head/packages/web" && exec env HOST=127.0.0.1 PORT=3002 node build/index.js) > "$out/web-head.log" 2>&1 &
pids+=("$!")
docker run -d --name conveyor-perf-caddy --network host \
  -v "$here/Caddyfile:/etc/caddy/Caddyfile:ro" "$caddy_image" > /dev/null

ready() {
  for _ in $(seq 1 60); do
    if curl -skf -o /dev/null "$1"; then return 0; fi
    sleep 1
  done
  echo "$1 never answered" >&2
  return 1
}
for port in 8443 8444; do
  ready "https://localhost:$port/"
  ready "https://localhost:$port/api/health"
done

measure() {
  npx --yes "$lighthouse" "$1" --quiet --only-categories=performance \
    --output=json --output-path="$2" \
    --chrome-flags="--headless=new --ignore-certificate-errors --no-sandbox"
}
port_of() { if [ "$1" = base ]; then echo 8443; else echo 8444; fi; }

for variant in base head; do measure "https://localhost:$(port_of "$variant")/" "$out/warmup-$variant.json"; done
for i in $(seq 1 "$runs"); do
  if [ $((i % 2)) -eq 1 ]; then order="base head"; else order="head base"; fi
  for variant in $order; do
    measure "https://localhost:$(port_of "$variant")/" "$out/$variant-$i.json"
    echo "run $i $variant done"
  done
done
