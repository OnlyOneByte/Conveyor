#!/usr/bin/env bash
# Download + extract the latest OpenSCAD nightly AppImage into /opt/openscad.
#
# The distro-stable openscad (2021.01) cannot parse the current gridfinity-rebuilt
# lib — it needs a 2023+ development snapshot (verified 2026-06-29, see
# docs/M1-WORKER-ENGINES.md). OpenSCAD publishes multi-arch nightly AppImages at
# files.openscad.org/snapshots/.
#
# Tracks the LATEST snapshot for the host arch by default — we scrape the snapshots
# directory and pick the newest date-stamped AppImage (handling both the historical
# `OpenSCAD-YYYY.MM.DD.ai-<arch>.AppImage` and current `OpenSCAD-YYYY.MM.DD-<arch>.AppImage`
# naming). NOTE: upstream currently ships aarch64 nightlies only up to 2023.09.11
# (the verified-working build); x86_64 gets ongoing nightlies.
#
# Overrides:
#   OPENSCAD_APPIMAGE_URL=<full url>   — use an exact asset (highest precedence)
#   OPENSCAD_RELEASE=YYYY.MM.DD        — pick a specific snapshot date
# Extraction (not FUSE-mount) so no FUSE is needed at runtime.
set -euo pipefail

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)        ASSET_ARCH="x86_64" ;;
  aarch64|arm64) ASSET_ARCH="aarch64" ;;
  *) echo "[install-openscad] ERROR: unsupported arch $ARCH" >&2; exit 1 ;;
esac

SNAP="https://files.openscad.org/snapshots"

resolve_url() {
  # Explicit full-URL override wins.
  if [[ -n "${OPENSCAD_APPIMAGE_URL:-}" ]]; then
    echo "$OPENSCAD_APPIMAGE_URL"; return 0
  fi
  echo "[install-openscad] listing ${SNAP}/ to resolve latest ${ASSET_ARCH} nightly" >&2
  local listing
  listing="$(curl -fsSL "${SNAP}/")" || return 1
  # Match both naming patterns for this arch; ignore .asc/.sha256/.sig/.N sidecars.
  local names
  names="$(printf '%s' "$listing" \
    | grep -oE "OpenSCAD-[0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.ai-|-)${ASSET_ARCH}\.AppImage" \
    | sort -u)"
  if [[ -n "${OPENSCAD_RELEASE:-}" ]]; then
    # Pin to a specific date if asked.
    local pick
    pick="$(printf '%s\n' "$names" | grep -E "OpenSCAD-${OPENSCAD_RELEASE}(\.ai-|-)${ASSET_ARCH}\.AppImage" | head -1)"
    [[ -n "$pick" ]] || { echo "[install-openscad] ERROR: no ${ASSET_ARCH} snapshot for ${OPENSCAD_RELEASE}" >&2; return 1; }
    echo "${SNAP}/${pick}"; return 0
  fi
  # Newest = lexically-greatest date-stamped name (YYYY.MM.DD sorts correctly).
  local latest
  latest="$(printf '%s\n' "$names" | sort -t- -k2 | tail -1)"
  [[ -n "$latest" ]] || { echo "[install-openscad] ERROR: no ${ASSET_ARCH} AppImage found in listing" >&2; return 1; }
  echo "${SNAP}/${latest}"
}

URL="$(resolve_url)" || { echo "[install-openscad] ERROR: could not resolve an OpenSCAD AppImage URL" >&2; exit 1; }

mkdir -p /opt/openscad && cd /opt/openscad
echo "[install-openscad] downloading ${URL##*/}"
curl -fSL "$URL" -o openscad.AppImage
chmod +x openscad.AppImage
./openscad.AppImage --appimage-extract >/dev/null
# Flatten squashfs-root → /opt/openscad/usr (binary at /opt/openscad/usr/bin/openscad).
mv squashfs-root/* . 2>/dev/null || true
rm -f openscad.AppImage

# Wrapper that scopes the AppImage's bundled libs to ONLY the openscad process.
# CRITICAL: do NOT export LD_LIBRARY_PATH=/opt/openscad/usr/lib globally — those
# bundled libs (e.g. an older libgnutls) shadow the system libs and break other
# binaries in the image (prusa-slicer, bun's HTTP stack). Verified 2026-06-30:
# a global LD_LIBRARY_PATH made prusa-slicer fail with "GNUTLS_3_7_2 not found".
mkdir -p /opt/openscad/bin
cat > /opt/openscad/bin/openscad <<'WRAP'
#!/bin/sh
exec env LD_LIBRARY_PATH=/opt/openscad/usr/lib /opt/openscad/usr/bin/openscad "$@"
WRAP
chmod +x /opt/openscad/bin/openscad
echo "[install-openscad] extracted ${URL##*/} → wrapper at /opt/openscad/bin/openscad"
