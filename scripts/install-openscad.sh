#!/usr/bin/env bash
set -euo pipefail

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)
    ASSET="OpenSCAD-2026.11.21-x86_64.AppImage"
    SHA256="f27009b27ed56a39f057370e4c2e63d5a72ece90173ec6b4264d379ad553e84f" ;;
  aarch64|arm64)
    ASSET="OpenSCAD-2023.09.11.ai-aarch64.AppImage"
    SHA256="84d7bb1c71e14b4e248a84fbe0a4b02f58bcbf5326f0ee81c8a4de3653a3b568" ;;
  *) echo "[install-openscad] ERROR: unsupported arch $ARCH" >&2; exit 1 ;;
esac

URL="https://files.openscad.org/snapshots/${ASSET}"

mkdir -p /opt/openscad && cd /opt/openscad
echo "[install-openscad] downloading ${ASSET}"
curl --proto '=https' --proto-redir '=https' -fSL "$URL" -o openscad.AppImage
if ! printf '%s  %s\n' "$SHA256" openscad.AppImage | sha256sum -c - >/dev/null; then
  echo "[install-openscad] ERROR: sha256 of ${ASSET} does not match the pinned $SHA256" >&2
  rm -f openscad.AppImage
  exit 1
fi
chmod +x openscad.AppImage
./openscad.AppImage --appimage-extract >/dev/null
mv squashfs-root/* . 2>/dev/null || true
rm -f openscad.AppImage

mkdir -p /opt/openscad/bin
printf '%s\n' '#!/bin/sh' 'exec env LD_LIBRARY_PATH=/opt/openscad/usr/lib /opt/openscad/usr/bin/openscad "$@"' > /opt/openscad/bin/openscad
chmod +x /opt/openscad/bin/openscad
chmod -R a+rX /opt/openscad
echo "[install-openscad] extracted ${ASSET} → wrapper at /opt/openscad/bin/openscad"
