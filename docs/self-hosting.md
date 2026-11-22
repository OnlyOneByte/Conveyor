# Self-hosting Conveyor

Conveyor runs as a Docker Compose stack: Caddy (TLS and routing), `web` (the PWA), `api` (REST and WebSocket), `worker` (generators, slicers, transports) and `redis` (queue and live status). Durable data lives in SQLite under `./data`; see [DATA-MODEL.md](DATA-MODEL.md).

## First run

1. Copy the example environment file:

   ```sh
   cp .env.example .env
   ```

2. Set a password and a signing secret in `.env`:

   ```sh
   CONVEYOR_PASSWORD='choose-a-long-passphrase'
   CONVEYOR_AUTH_SECRET='paste-the-output-of-openssl-rand-hex-32'
   ```

   Generate the secret with `openssl rand -hex 32` and paste the output; `.env` does not run commands.

   - `CONVEYOR_PASSWORD` must be 12 to 512 characters. 512 is also the longest password the login form accepts.
   - `CONVEYOR_AUTH_SECRET` must be at least 32 characters, not counting leading or trailing whitespace. Keep it the same across restarts: it signs session cookies, so changing it logs everyone out.
   - Wrap each value in single quotes. Compose interpolates `$` in unquoted and double-quoted `.env` values, so `pa$$w$ord` would reach the API as `pa$w`: `$$` becomes `$` and `$ord` becomes an empty variable. Inside single quotes every character is literal. A value that itself contains a single quote cannot be single-quoted; pick another value.

3. Start the stack:

   ```sh
   docker compose up -d --build
   ```

4. Open <https://localhost> on the host machine and sign in with `CONVEYOR_PASSWORD`. Caddy serves `localhost` with its internal CA, so the browser asks you to trust the certificate once.

Keep `.env` out of version control. It is already in `.gitignore`.

## Authentication is on by default

The API refuses to start when `CONVEYOR_PASSWORD` or `CONVEYOR_AUTH_SECRET` is missing, and exits with an error that names the missing variable. Check it with:

```sh
docker compose logs api
```

### Running without a login

On a network you fully trust, you can turn authentication off:

```sh
CONVEYOR_AUTH=disabled
```

The API then starts with no login and prints a warning at every boot. Anyone who can reach it can start prints on your printers, read and edit printer and profile settings, and make the server call printer addresses. Do not combine `CONVEYOR_AUTH=disabled` with a published port that is reachable from outside your network.

`CONVEYOR_AUTH` accepts `enabled` (the default when unset) or `disabled`. Any other value stops the API at startup.

### Failed logins and the client address

After 5 wrong passwords from one client within a minute, the login answers `429 Too Many Requests` until that minute has passed, even for the right password. A successful login clears the count. An IPv6 client counts as its whole /64, since one host usually controls one.

The API tells clients apart by the address that connected to it, and trusts an `X-Forwarded-For` header only from the proxies in `CONVEYOR_TRUSTED_PROXIES`: a comma-separated list of IP addresses or CIDRs. An entry that is not one stops the API at startup. Unset, nothing is trusted, so a forged header gets no budget of its own.

Compose gives Caddy the fixed address `172.31.250.2` on a fixed network, `172.31.250.0/24`, and sets `CONVEYOR_TRUSTED_PROXIES=172.31.250.2` for the API, so each client behind Caddy gets its own count. The network's `ip_range`, `172.31.250.128/25`, keeps the addresses Docker hands the other containers above `.128`, so none of them can take Caddy's. If that network collides with one of yours, change the subnet, the `ip_range`, Caddy's `ipv4_address` and `CONVEYOR_TRUSTED_PROXIES` together in `docker-compose.yml`, keeping Caddy's address inside the subnet but outside the range.

An existing install must run `docker compose down` once before `docker compose up -d` after upgrading to this version: Docker cannot change the subnet of a network that already exists, so `up` alone fails on the old network. `down` keeps your data, because named volumes and `./data` stay; do not add `-v`, which deletes the volumes.

On some hosts Docker's userland proxy hands Caddy the Docker gateway's address instead of the client's. Every client then shares one count again, so a stranger's wrong guesses can lock you out for up to a minute. Check `docker compose logs caddy`: if every request shows the same remote address, turn the userland proxy off (`"userland-proxy": false` in Docker's `daemon.json`).

## Network exposure

Caddy publishes ports 80 and 443 on `127.0.0.1` by default, so a fresh install is reachable only from the host machine.

To expose Conveyor deliberately, set `CONVEYOR_BIND` in `.env` to the host address that should accept connections:

| Goal | Setting |
| --- | --- |
| This machine only (default) | `CONVEYOR_BIND=127.0.0.1` |
| One LAN interface | `CONVEYOR_BIND=192.168.1.20` (the host's LAN address) |
| One IPv6 interface | `CONVEYOR_BIND=[fd00::20]` (in square brackets) |
| Every IPv4 interface | `CONVEYOR_BIND=0.0.0.0` |

Write an IPv6 address in square brackets. The published port reads as `<host>:<port>:<container port>`, and brackets keep the address's own colons apart from those separators. It is the form Docker documents for IPv6 port publishing.

Then recreate the proxy:

```sh
docker compose up -d caddy
```

Before you expose Conveyor beyond the host:

- Keep authentication on and use a strong `CONVEYOR_PASSWORD`.
- Replace `localhost` in the `Caddyfile` with the hostname clients use, so Caddy issues a certificate for it. For a public domain, Caddy can obtain a Let's Encrypt certificate automatically once ports 80 and 443 are reachable.
- Set `PUBLIC_API_URL` in `.env` to the same `https://` origin.
- Do not forward ports to the internet unless you need remote access. A VPN such as WireGuard or Tailscale is a safer way to reach a home install.

## Environment reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `CONVEYOR_PASSWORD` | none, required | Shared login password, 12 to 512 characters. |
| `CONVEYOR_AUTH_SECRET` | none, required | HMAC key for session cookies, 32 characters or more after trimming whitespace. |
| `CONVEYOR_SECRETS_KEY` | unset: generated into `./data/secrets.key` | Key that encrypts printer secrets, 32 bytes in base64 (`openssl rand -base64 32`). |
| `CONVEYOR_AUTH` | `enabled` | Set to `disabled` to run without a login. |
| `CONVEYOR_BIND` | `127.0.0.1` | Host address Caddy publishes ports 80 and 443 on. |
| `CONVEYOR_TRUSTED_PROXIES` | none (compose: `172.31.250.2`) | Proxies whose `X-Forwarded-For` the API trusts, as IPs or CIDRs. |
| `PUBLIC_API_URL` | `https://localhost` | Origin the PWA calls. |
| `CONVEYOR_HOST` | `127.0.0.1` (the api image sets `0.0.0.0`) | Address the api listens on. Outside Docker it stays on loopback unless you set it. |

## Printer secrets and backups

Printer credentials (Moonraker API keys, Elegoo mainboard ids) are encrypted in the database with AES-256-GCM. With `CONVEYOR_SECRETS_KEY` unset, the first start writes a random key to `./data/secrets.key` (readable only by its owner), and the api and worker both use it, so an existing install needs no manual step. The first start also encrypts any credentials already stored, once.

To keep the key out of the data volume, set it in `.env` instead:

```sh
CONVEYOR_SECRETS_KEY='paste-the-output-of-openssl-rand-base64-32'
```

To move an install that already generated a key, paste the contents of `./data/secrets.key` into it, then delete the file.

- Back up the key separately from `conveyor.db`. A copy of the database alone does not reveal printer credentials; the database and the key together do. Encryption protects copies and backups of the database, not a host where someone can read both.
- A malformed key, or a key other than the one the database was encrypted with, stops the api and worker at startup with a `[secrets] refusing to start` error. Neither ever prints the key.
- If `secrets.key` is readable or writable by anyone but its owner, both services print a `[secrets]` warning at startup. Fix it with `chmod 600 data/secrets.key`.
- If the key is lost, the stored credentials cannot be recovered. Clear them and enter them again: stop the stack, run `sqlite3 data/conveyor.db "UPDATE printers SET secrets_json = NULL; DELETE FROM meta WHERE key = 'secrets_key_check';"`, start it, and save each printer's credentials again.

### Upgrading and rolling back

Upgrade the api and the worker together; `docker compose up -d --build` does both. An older worker cannot read encrypted credentials, and an older api writes plaintext that the new worker refuses.

Older images cannot read the encrypted column either: the printer list answers `500`. To go back to a version from before encryption, stop the stack, run the same `sqlite3` command as for a lost key, start the older images, and enter each printer's credentials again. Restoring a `conveyor.db` backup taken before the upgrade works too.

## Containers run as uid 10001

The api, worker and web processes run as the unprivileged user `conveyor`, uid and gid `10001`, not as root. The web image starts as that user. The api and worker images start in a small entrypoint (`scripts/docker-entrypoint.sh`) that does one thing as root: if `/data` is not owned by `10001:10001`, it changes the owner of `/data` and everything in it, then drops to `10001` with `setpriv --no-new-privs` before the app starts. `secrets.key` keeps its `0600` mode, now for uid `10001`.

- **New installs** need no step. Docker creates `./data` owned by root on the first `up`, and the entrypoint hands it over.
- **Upgrading an install whose `./data` is owned by root** needs no step either. The first start after the upgrade logs `conveyor: /data is not owned by 10001:10001, changing its owner once`. On the host, `./data` then belongs to uid `10001`, so use `sudo` to read it or to take a backup.
- **A file that is root-owned later**, for example one restored from a backup as root, is not fixed automatically, because the entrypoint only checks `/data` itself. Fix it with `sudo chown -R 10001:10001 data`, then start the stack.
- `chown` runs with `-P -h`, so it changes symlinks in `./data` themselves and never the files they point to.

Compose also locks the three app containers down:

| Service | Capabilities | Root filesystem | Writable paths |
| --- | --- | --- | --- |
| `api` | all dropped, then `CHOWN`, `SETUID`, `SETGID`, `DAC_READ_SEARCH` added back for the entrypoint | read-only | `/data` |
| `worker` | same as `api` | read-only | `/data`, and a tmpfs `/tmp` for `xvfb-run`, OrcaSlicer, PrusaSlicer and OpenSCAD |
| `web` | all dropped | read-only | none |

The four capabilities are the entrypoint's minimum: `CHOWN` and `DAC_READ_SEARCH` let the one-time `chown -R` change and walk a root-owned `./data` that already holds `0700` job directories, and `SETUID` and `SETGID` let `setpriv` switch to `10001`. The app itself has no effective capabilities, and `no-new-privileges` stops it gaining any. If you add a tool to the worker that writes outside `/data` and `/tmp`, it fails with `Read-only file system`: give it a `tmpfs` entry in `docker-compose.yml` rather than turning `read_only` off.

## Releasing a held printer

When a worker stops while it is sending a job to a printer, the queue cannot know whether the printer got
the job. It fails that job with "check the printer before releasing it" and holds the printer, so no other
job is sent to it. Check the printer, stop or remove anything it should not be printing, then release the
hold. Until the UI has a button for it, release it from a shell. With authentication on (the default), log
in first; the session cookie goes in a private temporary file:

```sh
jar=$(mktemp)
read -rs CONVEYOR_PW
printf '{"password":"%s"}' "$CONVEYOR_PW" |
  curl -fsS -c "$jar" -H 'content-type: application/json' --data-binary @- https://localhost/auth/login
curl -fsS -b "$jar" -H 'content-type: application/json' -d '{"confirm":true}' \
  https://localhost/catalog/printers/<printer-id>/release
rm -f "$jar"; unset CONVEYOR_PW
```

`read -rs` keeps the password out of the shell history and the process list. A password containing `"` or
`\` must be JSON-escaped in the first command. With `CONVEYOR_AUTH=disabled`, only the second `curl` is
needed, without `-b "$jar"`. Replace `localhost` with your domain if you changed the Caddyfile; for its local
certificate, add `-k` or trust Caddy's root.

## Local development without Docker

`bun run dev:api` reads the same variables from your shell. Export `CONVEYOR_PASSWORD` and `CONVEYOR_AUTH_SECRET`, or `CONVEYOR_AUTH=disabled`, before you start it. Over plain HTTP, also set `CONVEYOR_COOKIE_INSECURE=1` so the browser keeps the session cookie.

## Printers on the LAN

The worker talks to printers over your network. By default it runs on the Compose bridge network, so store each printer's explicit IP address in its address field. If a printer is only reachable by an mDNS name such as `printer.local`, add `network_mode: host` to the `worker` service instead.

`./data` is mounted into both `api` and `worker`: uploaded STLs, job artifacts (`*.stl`, `*.gcode`), the SQLite database and, unless `CONVEYOR_SECRETS_KEY` is set, `secrets.key` live there. `./profiles` holds the locked slicer profiles (read-only) and is mounted into both `api` and `worker`: the worker slices with it, and the `api` reads it so the raw JSON editor can fall back to the bundled profile when the database has no edited copy. `./scad` is the gridfinity-rebuilt-openscad submodule.

## Routing in the Caddyfile

Caddy sends the API namespaces (`/jobs*`, `/generators*`, `/uploads*`, `/auth*`, `/jobs-history*`, `/catalog*`) and the exact path `/health` to `api`, and everything else to `web`. `https://localhost/health` answering `{"ok":true}` means Caddy, its certificate and the API are all up; the `compose` CI job waits on it. A page route must never share a prefix with an API namespace: when `/admin` and `/jobs` pages did, loading them directly returned 404. To get a public certificate, replace `localhost` with your domain and add a global options block with your email at the top of the file:

```
{
	email you@example.com
}
```

## Slicer and CAD engines in the worker image

`scripts/install-openscad.sh` installs a pinned OpenSCAD nightly AppImage for the host architecture, because the distro release cannot parse the gridfinity library ([M1-WORKER-ENGINES.md](M1-WORKER-ENGINES.md)). Before making the download executable it checks two things, and either failing fails the build: the pinned sha256, and, on x86_64, the upstream GnuPG signature (`<asset>.asc`). The signature must be a good one from the OpenSCAD release key, `OpenSCAD <dev@openscad.org>`, fingerprint `E2EB DADD 336F F516 ADD5 1A78 F3E1 2CCC 2216 4A0F` (as listed on openscad.org/downloads). The key is vendored as `scripts/openscad-release-key.asc`, and `scripts/verify-openscad-signature.sh` checks it with `gpgv`. A missing or empty `.asc`, a bad signature, and a signature from any other key all fail. **aarch64 has no signature:** upstream publishes no `.asc` for `OpenSCAD-2023.09.11.ai-aarch64.AppImage`, the newest aarch64 build, so on that arch the script logs `WARNING: upstream publishes no signature …` and relies on the pinned sha256 alone. The AppImage is extracted, so no FUSE is needed, and `/opt/openscad/bin/openscad` is a wrapper that sets `LD_LIBRARY_PATH` for OpenSCAD alone; a global `LD_LIBRARY_PATH` breaks PrusaSlicer.

`scripts/install-orca.sh <x.y.z> <auto|1|0>` installs the OrcaSlicer AppImage for the host architecture from the pinned release, 2.4.1 by default, and checks it against a pinned sha256. A checksum mismatch fails the build in every mode. The `ORCA_ENABLE` build argument picks the mode:

| `ORCA_ENABLE` | Behaviour |
| --- | --- |
| `1` | Required: any failure fails the build. |
| `auto` (default) | Best effort: API rate limits and network errors are retried; if Orca still cannot be installed, the build continues, writes `/opt/orca/NOT_INSTALLED` with the reason, and Orca-profile jobs fail at the slice stage. PrusaSlicer still works. |
| `0` | Skipped. |

Orca is GUI-linked, so the worker runs it under `xvfb-run`.

### Bumping the OpenSCAD pin

Upstream deletes old nightly snapshots (the x86_64 listing keeps about ten months), so a pinned x86_64 snapshot eventually fails to download and has to be bumped:

1. Pick a snapshot from `https://files.openscad.org/snapshots/` for each arch, at least a day old: upstream rebuilds the current day's nightly under the same file name, so a same-day pin can stop matching its checksum within hours (2026.11.21 did). Upstream ships aarch64 nightlies only up to `OpenSCAD-2023.09.11.ai-aarch64.AppImage`.
2. Set the `ASSET`, `SHA256` and `SIGNED` values for that arch in `scripts/install-openscad.sh`. Upstream publishes `<asset>.sha256` next to each AppImage; check it against `sha256sum` of your own download. Set `SIGNED=yes` when `<asset>.asc` exists, and `SIGNED=no` only when it doesn't (today, aarch64).
3. If upstream rotates its signing key, replace `scripts/openscad-release-key.asc` with the new key from `https://files.openscad.org/OpenSCAD_public_key.asc`, and `FINGERPRINT` in `scripts/verify-openscad-signature.sh` with the fingerprint openscad.org/downloads lists. Check that the two agree before committing.
4. Open the PR. CI's `orca slice` job verifies the signature and renders a cube with the new OpenSCAD on x86_64. Nothing in CI exercises the aarch64 pin, so check it on an arm64 host.

### Bumping the OrcaSlicer pin

The bundled profile in `profiles/orca-klipper-pla-0.2/` only loads in the Orca release it was exported from. A newer release can reject it with "Preset was not found in the loaded bundle", so bump the release and the profile together:

1. In the new OrcaSlicer, re-export the three leaf presets (machine, process, filament) into `profiles/orca-klipper-pla-0.2/`, and update the version in its `README.md`.
2. Set the new version as the `ORCA_RELEASE` default in `packages/worker/Dockerfile` and `scripts/install-orca.sh`.
3. Replace the `pinned_sha256` entries in `scripts/install-orca.sh` with the new x86_64 and aarch64 AppImage names and their sha256. `gh api repos/OrcaSlicer/OrcaSlicer/releases/tags/v<x.y.z> --jq '.assets[] | "\(.name) \(.digest)"'` lists both, or run `sha256sum` on the downloads.
4. Open the PR. CI's `orca slice` job builds the worker with `ORCA_ENABLE=1` and slices a cube with the bundled profile as uid 10001, so a profile the new release rejects fails there.
