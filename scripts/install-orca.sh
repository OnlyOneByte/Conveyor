#!/usr/bin/env bash
# Download + extract the OrcaSlicer AppImage into /opt/orca.
#
# OrcaSlicer publishes x86_64 Linux AppImages only. On arm64 (or when disabled)
# this is a no-op and the worker runs the slicer stage in CONVEYOR_ENGINE_STUB
# mode. Extraction (not direct execution) avoids needing FUSE at runtime.
#
# Usage: install-orca.sh <version> <enable: auto|1|0>
set -euo pipefail

VERSION="${1:?orca version required}"
ENABLE="${2:-auto}"
ARCH="$(uname -m)"

if [[ "$ENABLE" == "0" ]]; then
  echo "[install-orca] disabled explicitly — skipping (slicer runs in stub mode)"
  exit 0
fi

if [[ "$ARCH" != "x86_64" ]]; then
  if [[ "$ENABLE" == "1" ]]; then
    echo "[install-orca] ERROR: ORCA_ENABLE=1 but arch=$ARCH has no OrcaSlicer AppImage" >&2
    exit 1
  fi
  echo "[install-orca] arch=$ARCH unsupported by OrcaSlicer AppImage — skipping (stub mode)"
  exit 0
fi

# Asset name has varied across releases; try the known patterns.
BASE="https://github.com/SoftFever/OrcaSlicer/releases/download/v${VERSION}"
CANDIDATES=(
  "OrcaSlicer_Linux_AppImage_Ubuntu2404_V${VERSION}.AppImage"
  "OrcaSlicer_Linux_AppImage_V${VERSION}.AppImage"
  "OrcaSlicer_Linux_V${VERSION}.AppImage"
)

mkdir -p /opt/orca && cd /opt/orca
img="orca.AppImage"
ok=0
for name in "${CANDIDATES[@]}"; do
  echo "[install-orca] trying ${BASE}/${name}"
  if curl -fSL "${BASE}/${name}" -o "$img"; then ok=1; break; fi
done
if [[ "$ok" != "1" ]]; then
  echo "[install-orca] ERROR: no known AppImage asset matched for v${VERSION}." >&2
  echo "[install-orca] Check https://github.com/SoftFever/OrcaSlicer/releases and update CANDIDATES." >&2
  exit 1
fi

chmod +x "$img"
./"$img" --appimage-extract >/dev/null
# squashfs-root/AppRun is the entrypoint; expose it at a stable path.
ln -sf /opt/orca/squashfs-root/AppRun /opt/orca/AppRun
rm -f "$img"
echo "[install-orca] extracted OrcaSlicer v${VERSION} → /opt/orca/AppRun"
