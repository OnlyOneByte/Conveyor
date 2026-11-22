#!/usr/bin/env bash
set -euo pipefail

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)        ASSET_ARCH="x86_64" ;;
  aarch64|arm64) ASSET_ARCH="aarch64" ;;
  *) echo "[install-openscad] ERROR: unsupported arch $ARCH" >&2; exit 1 ;;
esac

SNAP="https://files.openscad.org/snapshots"

resolve_url() {
  if [[ -n "${OPENSCAD_APPIMAGE_URL:-}" ]]; then
    echo "$OPENSCAD_APPIMAGE_URL"; return 0
  fi
  echo "[install-openscad] listing ${SNAP}/ to resolve latest ${ASSET_ARCH} nightly" >&2
  local listing
  listing="$(curl -fsSL "${SNAP}/")" || return 1
  local names
  names="$(printf '%s' "$listing" \
    | grep -oE "OpenSCAD-[0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.ai-|-)${ASSET_ARCH}\.AppImage" \
    | sort -u)"
  if [[ -n "${OPENSCAD_RELEASE:-}" ]]; then
    local pick
    pick="$(printf '%s\n' "$names" | grep -E "OpenSCAD-${OPENSCAD_RELEASE}(\.ai-|-)${ASSET_ARCH}\.AppImage" | head -1)"
    [[ -n "$pick" ]] || { echo "[install-openscad] ERROR: no ${ASSET_ARCH} snapshot for ${OPENSCAD_RELEASE}" >&2; return 1; }
    echo "${SNAP}/${pick}"; return 0
  fi
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
mv squashfs-root/* . 2>/dev/null || true
rm -f openscad.AppImage

mkdir -p /opt/openscad/bin
printf '%s\n' '#!/bin/sh' 'exec env LD_LIBRARY_PATH=/opt/openscad/usr/lib /opt/openscad/usr/bin/openscad "$@"' > /opt/openscad/bin/openscad
chmod +x /opt/openscad/bin/openscad
chmod -R a+rX /opt/openscad
echo "[install-openscad] extracted ${URL##*/} → wrapper at /opt/openscad/bin/openscad"
