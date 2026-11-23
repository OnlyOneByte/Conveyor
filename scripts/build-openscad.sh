#!/usr/bin/env bash
set -euo pipefail

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
PREFIX="${1:-/opt/openscad}"

work="$(mktemp -d)"
tarball="$("$SCRIPTS/fetch-openscad-source.sh" "$work")"
tar -xzf "$tarball" -C "$work"
src="$(find "$work" -mindepth 1 -maxdepth 1 -type d -name 'openscad-*')"

cmake -S "$src" -B "$work/build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DNULLGL=ON \
  -DENABLE_TESTS=OFF \
  -DUSE_CCACHE=OFF \
  -DCMAKE_REQUIRE_FIND_PACKAGE_Lib3MF=OFF
cmake --build "$work/build"
cmake --install "$work/build" --strip

mkdir -p "$PREFIX/share/doc/openscad"
cp "$src/COPYING" "$work/SOURCE" "$PREFIX/share/doc/openscad/"
rm -rf "$work"
echo "[build-openscad] installed $(head -1 "$PREFIX/share/doc/openscad/SOURCE") at ${PREFIX}/bin/openscad"
