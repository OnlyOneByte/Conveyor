#!/usr/bin/env bash
set -euo pipefail

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
VERSION="2026.11-RC0"
COMMIT="9ba0cee7c94785fac0ca8dfe040b965a12a25ed1"
SHA256="9e64122961b3bafadfb7a4581498a3e7efd50f61316806fc7a137fd699ffc9d2"
TARBALL="openscad-${VERSION}.src.tar.gz"
URL="https://github.com/openscad/openscad/releases/download/openscad-${VERSION}/${TARBALL}"
mkdir -p "${1:?usage: fetch-openscad-source.sh <dir>}"
dir="$(cd "$1" && pwd)"
cd "$dir"
echo "[openscad-source] downloading ${TARBALL}" >&2
curl --proto '=https' --proto-redir '=https' -fSL "$URL" -o "$TARBALL"
curl --proto '=https' --proto-redir '=https' -fsSL "${URL}.asc" -o "${TARBALL}.asc"
printf '%s  %s\n' "$SHA256" "$TARBALL" > "${TARBALL}.sha256"
sha256sum -c "${TARBALL}.sha256" >/dev/null \
  || { echo "[openscad-source] ERROR: sha256 of ${TARBALL} does not match the pinned $SHA256" >&2; exit 1; }
"$SCRIPTS/verify-openscad-signature.sh" "$TARBALL" "${TARBALL}.asc" >&2
[[ "$(tar -xzOf "$TARBALL" "openscad-${VERSION}/COMMIT.txt")" == "${COMMIT:0:8}" ]] \
  || { echo "[openscad-source] ERROR: ${TARBALL} is not commit ${COMMIT}" >&2; exit 1; }
printf '%s\n' "OpenSCAD ${VERSION}, built from commit ${COMMIT}" \
  "Source: ${URL}" "sha256: ${SHA256}" > SOURCE
echo "$dir/$TARBALL"
