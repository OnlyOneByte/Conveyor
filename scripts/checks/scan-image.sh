#!/usr/bin/env bash
set -euo pipefail

image=${1:?usage: scan-image.sh <image> [title]}
title=${2:-$image}
TRIVY=aquasec/trivy@sha256:bcc376de8d77cfe086a917230e818dc9f8528e3c852f7b1aff648949b6258d1c
allowlist="$(cd "$(dirname "$0")/../.." && pwd)/.github/image-scan-allowlist.yaml"
[ -f "$allowlist" ] || { echo "scan-image.sh: no allowlist at $allowlist" >&2; exit 1; }
cache=${TRIVY_CACHE:-$HOME/.cache/trivy}
case "$cache" in /*) ;; *) cache="$PWD/$cache" ;; esac
mkdir -p "$cache"

trivy() {
  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$cache:/root/.cache/trivy" \
    -v "$allowlist:/allowlist.yaml:ro" "$TRIVY" image --quiet "$@"
}

for attempt in 1 2 3; do
  if trivy --download-db-only && trivy --download-java-db-only; then break; fi
  if [ "$attempt" = 3 ]; then exit 1; fi
  sleep $((attempt * 20))
done

set +e
trivy --skip-db-update --skip-java-db-update --scanners vuln --ignore-unfixed \
  --severity CRITICAL,HIGH --ignorefile /allowlist.yaml --show-suppressed \
  --exit-code 1 --format table "$image" > image-scan.txt
status=$?
set -e

cat image-scan.txt
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### $title: fixed critical and high vulnerabilities"
    echo '```'
    cat image-scan.txt
    echo '```'
  } >> "$GITHUB_STEP_SUMMARY"
fi
if [ "$status" != 0 ]; then
  echo "$title has a fixed high or critical vulnerability that .github/image-scan-allowlist.yaml doesn't accept" >&2
fi
exit "$status"
