#!/usr/bin/env bash
# Download + extract the OrcaSlicer AppImage into /opt/orca.
#
# As of OrcaSlicer v2.4.1, SoftFever ships BOTH x86_64 and aarch64 Linux AppImages
# (the macOS .dmg is Mach-O and can't run in a Linux container — irrelevant here).
# So Orca is installable on arm64 too. Verified 2026-06-30: the aarch64 AppImage
# slices an STL → gcode headless in this exact base image (see docs/M1-WORKER-ENGINES.md).
#
# Tracks the LATEST release by default — we discover the real AppImage asset URL
# from GitHub's release API rather than pinning a version/checksum or guessing the
# asset filename. Pass a specific version (e.g. "2.4.1") to override, or set
# ORCA_RELEASE=latest|<version>.
#
# Extraction (not direct execution) avoids needing FUSE at runtime. The extracted
# binary is GUI-linked, so the worker invokes it under xvfb-run.
#
# ENABLE semantics — this is the part that matters for CI:
#   1     required. Any failure fails the build.
#   auto  best effort. A transient failure (GitHub API rate limit from a shared CI
#         runner IP, a network blip, a release with no asset for this arch) logs
#         loudly, drops a marker at /opt/orca/NOT_INSTALLED, and exits 0 — the image
#         still ships with PrusaSlicer, which is multi-arch and headless-verified.
#   0     skip entirely.
# `auto` used to hard-fail on those paths for any arch with a case entry below, which
# meant it behaved identically to `1` on both x86_64 and aarch64 — a single API blip
# failed the whole release build. That is what broke the v0.1.0 arm64 worker job.
#
# Usage: install-orca.sh <release: latest|x.y.z> <enable: auto|1|0>
set -euo pipefail

RELEASE="${1:-${ORCA_RELEASE:-latest}}"
ENABLE="${2:-auto}"
ARCH="$(uname -m)"
REPO="SoftFever/OrcaSlicer"

# Fail when Orca is required; degrade visibly when it is merely wanted.
give_up() {
  local reason="$1"
  if [[ "$ENABLE" == "1" ]]; then
    echo "[install-orca] ERROR: ORCA_ENABLE=1 and $reason" >&2
    exit 1
  fi
  echo "[install-orca] WARNING: $reason" >&2
  echo "[install-orca] ORCA_ENABLE=$ENABLE — continuing WITHOUT OrcaSlicer." >&2
  echo "[install-orca] This image can still slice via PrusaSlicer; Orca-profile" >&2
  echo "[install-orca] jobs will fail at the slice stage." >&2
  mkdir -p /opt/orca
  printf 'OrcaSlicer was NOT installed.\narch=%s release=%s enable=%s\nreason=%s\n' \
    "$ARCH" "$RELEASE" "$ENABLE" "$reason" > /opt/orca/NOT_INSTALLED
  exit 0
}

# Retry transient network/API failures. Rate limiting is the expected case: these
# calls are unauthenticated and CI runners share outbound IPs.
retry() {
  local tries="$1"; shift
  local n=1
  until "$@"; do
    if (( n >= tries )); then return 1; fi
    echo "[install-orca] attempt $n/$tries failed; retrying in $((n * 5))s" >&2
    sleep $((n * 5))
    n=$((n + 1))
  done
  return 0
}

if [[ "$ENABLE" == "0" ]]; then
  echo "[install-orca] disabled explicitly — skipping (slicer runs in stub mode)"
  exit 0
fi

# Match the Linux AppImage asset for this arch:
#   aarch64 → name contains "aarch64"
#   x86_64  → Linux AppImage that is NOT an arm build
case "$ARCH" in
  x86_64)        ARCH_RE='(amd64|x86_64|Ubuntu24[0-9]+_V)'; EXCLUDE_RE='(aarch64|arm64|armhf)' ;;
  aarch64|arm64) ARCH_RE='(aarch64|arm64)';                EXCLUDE_RE='__never__' ;;
  *) give_up "arch=$ARCH has no OrcaSlicer AppImage" ;;
esac

# Resolve the GitHub API endpoint for the requested release.
if [[ "$RELEASE" == "latest" ]]; then
  API="https://api.github.com/repos/${REPO}/releases/latest"
else
  API="https://api.github.com/repos/${REPO}/releases/tags/v${RELEASE#v}"
fi

echo "[install-orca] resolving ${RELEASE} release assets from ${API}"
JSON=""
fetch_api() { JSON="$(curl -fsSL -H "Accept: application/vnd.github+json" "$API")"; }
retry 4 fetch_api || give_up "failed to query the GitHub releases API ($API)"

# Pull every asset download URL, then pick the Linux .AppImage for this arch.
# (grep/sed only — no jq dependency in the base image.)
mapfile -t URLS < <(printf '%s' "$JSON" \
  | grep -oE '"browser_download_url":[[:space:]]*"[^"]+"' \
  | sed -E 's/.*"(https[^"]+)"/\1/')

URL=""
for u in "${URLS[@]}"; do
  base="${u##*/}"
  [[ "$base" == *.AppImage ]] || continue
  [[ "$base" == *[Ll]inux* ]] || continue
  [[ "$base" =~ $EXCLUDE_RE ]] && continue
  if [[ "$base" =~ $ARCH_RE ]]; then URL="$u"; break; fi
done

if [[ -z "$URL" ]]; then
  echo "[install-orca] assets seen in the ${RELEASE} release:" >&2
  printf '  %s\n' "${URLS[@]##*/}" >&2
  give_up "no Linux AppImage asset for arch=$ARCH in the ${RELEASE} release"
fi

echo "[install-orca] downloading ${URL##*/}"
mkdir -p /opt/orca && cd /opt/orca
img="orca.AppImage"
download() { curl -fSL "$URL" -o "$img"; }
retry 3 download || give_up "failed to download ${URL##*/}"

chmod +x "$img"
./"$img" --appimage-extract >/dev/null || give_up "failed to extract ${URL##*/}"
# squashfs-root/AppRun is the entrypoint; expose it at a stable path.
ln -sf /opt/orca/squashfs-root/AppRun /opt/orca/AppRun
rm -f "$img" /opt/orca/NOT_INSTALLED
echo "[install-orca] extracted ${URL##*/} (arch=$ARCH) → /opt/orca/AppRun"
