#!/usr/bin/env bash
set -euo pipefail

FINGERPRINT="E2EBDADD336FF516ADD51A78F3E12CCC22164A0F"
file="$1"
signature="$2"
key="${3:-$(cd "$(dirname "$0")" && pwd)/openscad-release-key.asc}"

fail() {
  echo "[install-openscad] ERROR: $1" >&2
  exit 1
}

[[ -s "$signature" ]] || fail "no signature for ${file}"

keyring="$(mktemp)"
trap 'rm -f "$keyring"' EXIT
sed -e '1,/^\s*$/d' -e '/^=/,$d' "$key" | base64 -d > "$keyring"

status="$(gpgv --keyring "$keyring" --status-fd 1 "$signature" "$file" 2>/dev/null || true)"
primary="$(printf '%s\n' "$status" | awk '$2 == "VALIDSIG" {print $NF}')"
grep -q '^\[GNUPG:\] GOODSIG ' <<<"$status" || fail "${file} has no good signature from the OpenSCAD release key"
[[ "$primary" == "$FINGERPRINT" ]] || fail "${file} is signed by ${primary:-an unknown key}, not the OpenSCAD release key ${FINGERPRINT}"
echo "[install-openscad] signature verified: OpenSCAD release key ${FINGERPRINT}"
