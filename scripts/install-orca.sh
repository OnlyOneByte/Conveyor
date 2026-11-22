#!/usr/bin/env bash
set -euo pipefail

RELEASE="${1:-${ORCA_RELEASE:-latest}}"
ENABLE="${2:-auto}"
ARCH="$(uname -m)"
REPO="SoftFever/OrcaSlicer"

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

case "$ARCH" in
  x86_64)        ARCH_RE='(amd64|x86_64|Ubuntu24[0-9]+_V)'; EXCLUDE_RE='(aarch64|arm64|armhf)' ;;
  aarch64|arm64) ARCH_RE='(aarch64|arm64)';                EXCLUDE_RE='__never__' ;;
  *) give_up "arch=$ARCH has no OrcaSlicer AppImage" ;;
esac

if [[ "$RELEASE" == "latest" ]]; then
  API="https://api.github.com/repos/${REPO}/releases/latest"
else
  API="https://api.github.com/repos/${REPO}/releases/tags/v${RELEASE#v}"
fi

echo "[install-orca] resolving ${RELEASE} release assets from ${API}"
JSON=""
fetch_api() { JSON="$(curl -fsSL -H "Accept: application/vnd.github+json" "$API")"; }
retry 4 fetch_api || give_up "failed to query the GitHub releases API ($API)"

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
ln -sf /opt/orca/squashfs-root/AppRun /opt/orca/AppRun
chmod -R a+rX /opt/orca
rm -f "$img" /opt/orca/NOT_INSTALLED
echo "[install-orca] extracted ${URL##*/} (arch=$ARCH) → /opt/orca/AppRun"
