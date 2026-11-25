#!/bin/sh
set -eu
umask 077

app_uid=10001
app_gid=10001
data_dir=/data

if [ "$(id -u)" != 0 ]; then
  exec "$@"
fi

if [ -d "$data_dir" ] && [ "$(stat -c %u:%g "$data_dir")" != "$app_uid:$app_gid" ]; then
  echo "conveyor: $data_dir is not owned by $app_uid:$app_gid, changing its owner once" >&2
  chown -R -P -h "$app_uid:$app_gid" "$data_dir"
fi

if [ -d "$data_dir" ] && [ "$(stat -c %a "$data_dir")" != 700 ]; then
  echo "conveyor: $data_dir is readable by other users, making it owner-only once" >&2
  chmod 700 "$data_dir"
fi

exec setpriv --reuid="$app_uid" --regid="$app_gid" --clear-groups --no-new-privs -- "$@"
