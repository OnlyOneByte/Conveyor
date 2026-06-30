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
# Usage: install-orca.sh <release: latest|x.y.z> <enable: auto|1|0>
set -euo pipefail

RELEASE="${1:-${ORCA_RELEASE:-latest}}"
ENABLE="${2:-auto}"
ARCH="$(uname -m)"
REPO="SoftFever/OrcaSlicer"

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
  *)
    if [[ "$ENABLE" == "1" ]]; then
      echo "[install-orca] ERROR: ORCA_ENABLE=1 but arch=$ARCH has no OrcaSlicer AppImage" >&2
      exit 1
    fi
    echo "[install-orca] arch=$ARCH unsupported by OrcaSlicer AppImage — skipping (stub mode)"
    exit 0
    ;;
esac

# Resolve the GitHub API endpoint for the requested release.
if [[ "$RELEASE" == "latest" ]]; then
  API="https://api.github.com/repos/${REPO}/releases/latest"
else
  API="https://api.github.com/repos/${REPO}/releases/tags/v${RELEASE#v}"
fi

echo "[install-orca] resolving ${RELEASE} release assets from ${API}"
JSON="$(curl -fsSL -H "Accept: application/vnd.github+json" "$API")" || {
  echo "[install-orca] ERROR: failed to query GitHub releases API ($API)" >&2
  exit 1
}

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
  echo "[install-orca] ERROR: no Linux AppImage asset for arch=$ARCH in ${RELEASE} release." >&2
  echo "[install-orca] Assets seen:" >&2
  printf '  %s\n' "${URLS[@]##*/}" >&2
  exit 1
fi

echo "[install-orca] downloading ${URL##*/}"
mkdir -p /opt/orca && cd /opt/orca
img="orca.AppImage"
curl -fSL "$URL" -o "$img"

chmod +x "$img"
./"$img" --appimage-extract >/dev/null
# squashfs-root/AppRun is the entrypoint; expose it at a stable path.
ln -sf /opt/orca/squashfs-root/AppRun /opt/orca/AppRun
rm -f "$img"
echo "[install-orca] extracted ${URL##*/} (arch=$ARCH) → /opt/orca/AppRun"
