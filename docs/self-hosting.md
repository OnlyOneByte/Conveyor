# Self-hosting Conveyor

Conveyor runs as a Docker Compose stack: Caddy (TLS and routing), `web` (the PWA), `api` (REST and WebSocket), `worker` (generators, slicers, transports) and `redis` (queue and live status). Durable data lives in SQLite under `./data`; see [DATA-MODEL.md](DATA-MODEL.md).

## First run

1. Clone the repository with its submodule. `./scad` holds the gridfinity library the worker renders bins with:

   ```sh
   git clone --recurse-submodules https://github.com/OnlyOneByte/Conveyor.git
   cd Conveyor
   ```

   In a clone made without `--recurse-submodules`, run `git submodule update --init` once. Without it every gridfinity job fails at the generator stage with `the gridfinity library is missing at …`.

2. Copy the example environment file:

   ```sh
   cp .env.example .env
   ```

3. Set a password and a signing secret in `.env`:

   ```sh
   CONVEYOR_PASSWORD='choose-a-long-passphrase'
   CONVEYOR_AUTH_SECRET='paste-the-output-of-openssl-rand-hex-32'
   ```

   Generate the secret with `openssl rand -hex 32` and paste the output; `.env` does not run commands.

   - `CONVEYOR_PASSWORD` must be 12 to 512 characters. 512 is also the longest password the login form accepts.
   - `CONVEYOR_AUTH_SECRET` must be at least 32 characters, not counting leading or trailing whitespace. Keep it the same across restarts: it signs session cookies, so changing it logs everyone out. Changing `CONVEYOR_PASSWORD` logs everyone out too, and **Log out** ends that session on the server, not just in the browser.
   - Wrap each value in single quotes. Compose interpolates `$` in unquoted and double-quoted `.env` values, so `pa$$w$ord` would reach the API as `pa$w`: `$$` becomes `$` and `$ord` becomes an empty variable. Inside single quotes every character is literal. A value that itself contains a single quote cannot be single-quoted; pick another value.

4. Start the stack and wait until every service is healthy:

   ```sh
   docker compose up -d --build --wait
   ```

   `--wait` returns once the api and web pass their health checks. If it fails, `docker compose ps` shows which service is not healthy and `docker compose logs <service>` says why: an api missing `CONVEYOR_PASSWORD` stays `unhealthy` and names the variable.

5. Open <https://localhost> on the host machine and sign in with `CONVEYOR_PASSWORD`. Caddy serves `localhost` with its internal CA, so the browser asks you to trust the certificate once.

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

An install from v0.1.4 or earlier must run `docker compose down` once before `docker compose up -d`, because those releases had no fixed network and Docker cannot change the subnet of a network that already exists, so `up` alone fails on the old network. `down` keeps your data, because named volumes and `./data` stay; do not add `-v`, which deletes the volumes. [Upgrading from v0.1.x](#upgrading-from-v01x) has this step in order.

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
- Set `CONVEYOR_DOMAIN` to the name clients use (see [The name Caddy serves](#the-name-caddy-serves)). The `Caddyfile` reads it, so you never edit that tracked file.
- Do not forward ports to the internet unless you need remote access. A VPN such as WireGuard or Tailscale is a safer way to reach a home install.

`CONVEYOR_BIND` decides who can connect; `CONVEYOR_DOMAIN` only decides which name and certificate Caddy answers with. Changing the domain never publishes anything.

### The name Caddy serves

`CONVEYOR_DOMAIN` in `.env` is the site address in the `Caddyfile`. Compose passes it to Caddy, and unset or empty means `localhost`. After changing it, run `docker compose up -d caddy`. Caddy then serves only that name: `https://localhost` on the host stops answering (the TLS handshake fails), so use the new name on the host too.

Which certificate Caddy uses depends on the name:

| `CONVEYOR_DOMAIN` | Certificate |
| --- | --- |
| `localhost` (default) | Caddy's local CA |
| A LAN IP address, such as `192.168.1.20` | Caddy's local CA |
| A name under `home.arpa` or `internal`, such as `conveyor.home.arpa` | Caddy's local CA |
| A public domain you own, such as `conveyor.example.com` | Let's Encrypt, once ports 80 and 443 are reachable from the internet |

Do not use a made-up suffix such as `.lan` or `.home`: Caddy treats it as public, asks Let's Encrypt for it and fails. A `home.arpa` name needs a DNS record on your router or DNS server pointing at the host.

Once the name is not `localhost`, Caddy also sends `Strict-Transport-Security: max-age=31536000`; on `localhost` it doesn't, so a browser never pins HTTPS for every other local app. On every response it sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`.

### HTTPS on the LAN: trusting Caddy's local CA

Phones and other computers on the LAN don't trust Caddy's local CA until you install its root certificate on them. The PWA needs a trusted certificate to install and to work offline.

1. Set `CONVEYOR_BIND` to the host's LAN address and `CONVEYOR_DOMAIN` to that address or a `home.arpa` name, then run `docker compose up -d caddy`.
2. Copy the root certificate out of the `caddy_data` volume:

   ```sh
   docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./conveyor-root.crt
   ```

3. Install it on each device:
   - **iOS / iPadOS:** send the file to the device (AirDrop or mail), open it, install the profile in **Settings → General → VPN & Device Management**, then turn it on in **Settings → General → About → Certificate Trust Settings**.
   - **Android:** **Settings → Security → More security settings → Encryption & credentials → Install a certificate → CA certificate**, and pick the file. The menu names vary by maker.
   - **macOS:** open it in Keychain Access, add it to the **System** keychain and set it to **Always Trust**.
   - **Windows:** open it, **Install Certificate → Local Machine → Trusted Root Certification Authorities**.

The root certificate is valid for 10 years and stays the same as long as the `caddy_data` volume is kept, so back that volume up too ([Backup and restore](#backup-and-restore)). A device that trusts it accepts any certificate this CA signs, for any name, so keep the volume and its backups private.

## Environment reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `CONVEYOR_PASSWORD` | none, required | Shared login password, 12 to 512 characters. |
| `CONVEYOR_AUTH_SECRET` | none, required | HMAC key for session cookies, 32 characters or more after trimming whitespace. |
| `CONVEYOR_SECRETS_KEY` | unset: generated into `./data/secrets.key` | Key that encrypts printer secrets, 32 bytes in base64 (`openssl rand -base64 32`). |
| `CONVEYOR_AUTH` | `enabled` | Set to `disabled` to run without a login. |
| `CONVEYOR_BIND` | `127.0.0.1` | Host address Caddy publishes ports 80 and 443 on. |
| `CONVEYOR_DOMAIN` | `localhost` | Name Caddy serves and gets a certificate for ([The name Caddy serves](#the-name-caddy-serves)). Unset or empty means `localhost`. |
| `CONVEYOR_TRUSTED_PROXIES` | none (compose: `172.31.250.2`) | Proxies whose `X-Forwarded-For` the API trusts, as IPs or CIDRs. |
| `CONVEYOR_HOST` | `127.0.0.1` (the api image sets `0.0.0.0`) | Address the api listens on. Outside Docker it stays on loopback unless you set it. |
| `CONVEYOR_SESSION_TTL_MS` | `43200000` (12 hours) | How long a login session lasts. |
| `CONVEYOR_COOKIE_INSECURE` | unset | `1` drops the cookie's `Secure` flag, for local development over plain HTTP only. |
| `CONVEYOR_QUEUE` | `redis` | Job queue: `redis`, or `sqlite` for the experimental SQLite queue ([design](design/sqlite-queue.md)). Compose passes one value to both the api and the worker. |
| `CONVEYOR_QUEUE_UNSTABLE` | unset | Must be `1` for `CONVEYOR_QUEUE=sqlite` to start, while that queue is experimental. |
| `CONVEYOR_UPLOAD_TIMEOUT_MS` | `600000` (10 minutes) | Longest the worker waits for one g-code upload to a printer before failing the job. 10 minutes covers about 600 MB at 1 MB/s, or about 180 MB at 300 KB/s. Raise it for very large prints on slow printers. Compose passes it to the worker; an unset or empty value uses the default. Any other value must be a positive integer of milliseconds: one that isn't, such as `0` or `soon`, fails each job's upload at the transport stage, naming the variable, rather than falling back to the default. |
| `PRINTER_ADDRESS_ALLOW` | none | Hosts and CIDRs the api and worker may reach even though they fall in a refused range ([Printer addresses](#printer-addresses)), separated by commas or spaces, for example `169.254.10.0/24, printer.example`. An entry that isn't a valid CIDR stops the api at startup and fails a job's transport stage, naming the variable. |
| `MOONRAKER_STATUS_TIMEOUT_MS` | `30000` | Longest the worker waits for one Moonraker status reply. Unset or empty uses the default; any other value must be a whole number above 0, or the job's transport stage fails naming the variable. |
| `MOONRAKER_STATUS_FAILURES` | `5` | Status polls in a row that may fail (a timeout, a refused connection or an error reply) before the worker gives up on a running print. A successful poll resets the count. Same rules as above. |

## Printer addresses

Conveyor connects only where a self-hosted printer can be:

| Address | Result |
| --- | --- |
| Private LAN ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fd00::/8`), `.local` names, public names | Allowed |
| Loopback (`localhost`, `127.0.0.0/8`, `::1`), for a printer proxy on the same host | Allowed. The api logs the printers that use it once at startup |
| The documented forms: `host:port`, `http(s)://…`, `//host/path`, `user:pass@host[/path]` | Allowed; the host inside them is what gets checked |
| Link-local `169.254.0.0/16` (including `169.254.169.254`) and `fe80::/10`, the AWS (`fd00:ec2::254`), Google Cloud (`fd20:ce::254`, `metadata.google.internal`) and Alibaba (`100.100.100.200`) metadata addresses, and any of these embedded in an IPv6 address (`::ffff:a.b.c.d`, NAT64 `64:ff9b::a.b.c.d` and the local-use `64:ff9b:1::/48`, IPv4-compatible `::a.b.c.d`) | Refused |
| A name that doesn't resolve, or resolves to no address | Refused with `Conveyor couldn't resolve <name>`, since where it points can't be checked. Add the name to `PRINTER_ADDRESS_ALLOW` to save a printer whose name only resolves on the worker's network. During a Moonraker print, a name that stops resolving counts as one failed status poll (`MOONRAKER_STATUS_FAILURES`), so a DNS hiccup doesn't fail a print that is still running; a name that resolves to a refused address fails it at once |

The host is read with the same URL parser `fetch` and `WebSocket` use, so hex, decimal and octal forms such as `0xA9FEA9FE` are checked as the address they really are. It is checked when a printer is saved, before the reachability check, and before every request the worker sends to the printer: each Moonraker upload, status poll and cancel, and each Elegoo connection. A name is resolved and every address it resolves to is checked, so a name that points at a metadata address is refused too, including one that changes what it resolves to after it was saved. Conveyor doesn't follow redirects from a printer: a `3xx` reply fails the request, naming where it pointed.

**Known limit:** the check resolves a name, and the request then resolves it again. A name whose DNS answer changes in the instant between the two can still reach a refused address. Connecting to the checked address instead would break HTTPS printer URLs (the certificate names the host) and isn't possible for Elegoo's WebSocket. Give printers an IP address, or a name only your own DNS answers, where this matters.

A refused address gets a plain error, for example `Conveyor won't connect to 169.254.169.254: it is a link-local address, where cloud metadata services listen, not a printer on your network. If it really is your printer, add 169.254.169.254 to PRINTER_ADDRESS_ALLOW.` Saving answers `400` with it, and a job fails at the transport stage with it. To let a printer through, set `PRINTER_ADDRESS_ALLOW` on both the api and the worker (compose passes it to both).

## Health checks, logs and stopping

Compose checks the `api` (`GET /health`) and `web` (`GET /`) every 10 seconds from inside each container. `docker compose ps` shows them `healthy` or `unhealthy`, and `docker compose up -d --wait` waits for both. `web` starts once the api is healthy, and Caddy once both are, so Caddy never answers `502` while the stack boots. An api that can't start, such as one missing `CONVEYOR_PASSWORD`, never turns healthy, and `docker compose logs api` names the problem.

Every service logs through Docker's `json-file` driver capped at 3 files of 10 MB, so logs can't fill a small SD card. `docker compose logs <service>` reads them.

`docker compose stop` and `docker compose down` send SIGTERM. The api then stops taking requests, tells every open job page "server restarting" (WebSocket close code `1012`, so the page knows to reconnect and doesn't treat it as the job finishing), and exits within about a second. If it has not finished closing after 3 seconds, it exits anyway. The `web` container also stops in under a second. The `worker` stops taking jobs and exits as soon as no job is running. On the default Redis queue it waits for a running job to finish, for up to its 60 s grace period (`stop_grace_period`); then Docker kills it. That job is not run again: within a couple of minutes of the worker coming back, it's recorded as failed and shows in **Needs you**. BullMQ's stalled check fails it within about 30 seconds, and the reaper records it on its next sweep, which runs every minute. Its reason reads "the worker stopped before recording how this job ended; check the printer before you retry". Look at the printer before you retry it, since the print may already be on the bed. So the whole stack stops in about 3 seconds when idle, and in up to a minute mid-job.

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

A local `--build` reuses Docker's build cache, including the worker's OS-package layer from your last build. To pick up Debian's security fixes since then, rebuild that layer with `docker compose build --build-arg OS_REFRESH="$(date -u +%G-W%V)"`, then `docker compose up -d`.

Older images cannot read the encrypted column either: the printer list answers `500`. To go back to a version from before encryption, stop the stack, run the same `sqlite3` command as for a lost key, start the older images, and enter each printer's credentials again. Restoring a `conveyor.db` backup taken before the upgrade works too.

## Backup and restore

What holds state, and what a backup needs:

| What | Where | Matters because |
| --- | --- | --- |
| The database | `./data/conveyor.db` (with `-wal` and `-shm` beside it while running) | Printers, profiles, job history and logins. Lose it and you set Conveyor up again. |
| The secrets key | `./data/secrets.key`, or `CONVEYOR_SECRETS_KEY` in `.env` | Decrypts printer credentials in the database. Keep it apart from database backups ([Printer secrets](#printer-secrets-and-backups)). |
| `.env` | the checkout | The password, the signing secret and every setting. |
| Uploads and job files | `./data/uploads`, `./data/<job id>/` | Uploaded STLs and each job's model and G-code. A job can be run again without them. |
| The queue | the `conveyor_redis_data` volume | Jobs waiting or running right now. Finished jobs are in the database. |
| Caddy's state | the `conveyor_caddy_data` volume | Its local CA, certificates and Let's Encrypt account. Lose it and every device has to trust a new CA ([HTTPS on the LAN](#https-on-the-lan-trusting-caddys-local-ca)). |

Never copy `conveyor.db` while the stack runs: the database is in WAL mode, so recent writes sit in `conveyor.db-wal` and a plain copy of the main file can be inconsistent.

### Back up the database while it runs

SQLite's `VACUUM INTO` writes a consistent copy of a live database. Run it in the api container, which has `bun` and the database, as the container's own user, then stream the copy out:

```sh
(
  umask 077
  mkdir -p backups
  docker compose exec -T --user 10001:10001 api rm -f /data/backup.db
  docker compose exec -T --user 10001:10001 api sh -c 'umask 077 && bun -e '\''const { Database } = require("bun:sqlite"); new Database("/data/conveyor.db").query("VACUUM INTO ?").run("/data/backup.db")'\'
  docker compose exec -T --user 10001:10001 api cat /data/backup.db > "backups/conveyor-$(date +%F).db"
  docker compose exec -T --user 10001:10001 api rm /data/backup.db
)
```

`umask 077` makes the folder `0700` and the backup `0600`, readable only by you. The `umask 077` inside the container does the same for the temporary `/data/backup.db`, so the full copy is never readable by other users while the backup runs. The parentheses run it in a subshell, so your shell's own umask is left alone. Keep it that way: the database holds the printer credentials, encrypted with the secrets key. Back up `.env` and the secrets key (if you didn't set `CONVEYOR_SECRETS_KEY`) separately, somewhere the database backups are not, the same way: `( umask 077; docker compose exec -T --user 10001:10001 api cat /data/secrets.key > secrets.key.backup )`. `.gitignore` lists `backups/` and `secrets.key.backup`, so neither can be committed by accident; move them out of the checkout to keep them.

### Restore the database

```sh
docker compose stop api worker
docker compose run --rm -T --no-deps --user 10001:10001 --entrypoint sh api \
  -c 'umask 077 && cat > /data/restore.db && rm -f /data/conveyor.db-wal /data/conveyor.db-shm && mv /data/restore.db /data/conveyor.db' \
  < backups/conveyor-2026-11-24.db
docker compose up -d --wait
```

Use the name of the backup you want. The old `-wal` and `-shm` files must go with the old database: SQLite would apply them to the restored one. The secrets key in use must be the one the backup was encrypted with, or the api and worker refuse to start with `[secrets] refusing to start`.

### Back up and restore everything

A full backup takes `./data` and both volumes at once, with the stack stopped:

```sh
(
  umask 077
  mkdir -p backups
  docker compose stop
  docker run --rm -v conveyor_redis_data:/v/redis_data:ro -v conveyor_caddy_data:/v/caddy_data:ro \
    -v "$PWD/data:/v/data:ro" alpine tar -C /v --numeric-owner -czf - . > "backups/conveyor-full-$(date +%F).tgz"
  docker compose start
  cp .env backups/
)
```

`docker compose stop` takes about 3 seconds when no job is running, and up to a minute while one is ([Health checks, logs and stopping](#health-checks-logs-and-stopping)). Take full backups when the printers are idle. The tarball is created `0600`: it holds Caddy's CA private key and the secrets key next to the database, so anyone who can read it can sign certificates your devices trust and decrypt the printer credentials.

To restore it, on the same host or a new one with the same checkout and `.env`:

```sh
docker compose down
docker compose up --no-start
docker run --rm -i -v conveyor_redis_data:/v/redis_data -v conveyor_caddy_data:/v/caddy_data \
  -v "$PWD/data:/v/data" alpine \
  sh -c 'find /v/redis_data /v/caddy_data /v/data -mindepth 1 -delete && tar -C /v --numeric-owner -xzpf -' \
  < backups/conveyor-full-2026-11-24.tgz
docker compose up -d --wait
```

`up --no-start` creates the volumes as Compose's own, so a new host doesn't warn about them. `--numeric-owner` keeps every file's owner (`10001` for `./data`, `999:1000` for Redis, `10002` for Caddy), so nothing needs a `chown` afterwards; `caddy-init` hands the volumes' top folders, which `up --no-start` made, back to Caddy on the next `up`.

## Containers run as uid 10001

The api, worker and web processes run as the unprivileged user `conveyor`, uid and gid `10001`, not as root. The web image starts as that user. The api and worker images start in a small entrypoint (`scripts/docker-entrypoint.sh`) that does one thing as root: if `/data` is not owned by `10001:10001`, it changes the owner of `/data` and everything in it, then drops to `10001` with `setpriv --no-new-privs` before the app starts. `secrets.key` keeps its `0600` mode, now for uid `10001`.

Everything in `./data` is readable only by uid `10001`. The entrypoint sets `umask 077`, so the database, job files and uploads are created `0600` and their folders `0700`. If `/data` itself is readable by other users (Docker creates it `0755`), the entrypoint makes it `0700` and logs `conveyor: /data is readable by other users, making it owner-only once`. When the api or worker opens the database, it creates a missing `conveyor.db` as `0600`, and an existing `conveyor.db`, `-wal` or `-shm` that other users can read is tightened to `0600`. So an existing install is tightened once, on its first start after the upgrade. Other files that older versions created `0644` (job files, uploads) keep their mode, but other users can't reach them through the `0700` folder.

- **New installs** need no step. Docker creates `./data` owned by root on the first `up`, and the entrypoint hands it over.
- **Upgrading an install whose `./data` is owned by root** needs no step either. The first start after the upgrade logs `conveyor: /data is not owned by 10001:10001, changing its owner once`. On the host, `./data` then belongs to uid `10001`, so use `sudo` to read it or to take a backup.
- **A file that is root-owned later**, for example one restored from a backup as root, is not fixed automatically, because the entrypoint only checks `/data` itself. Fix it with `sudo chown -R 10001:10001 data`, then start the stack.
- `chown` runs with `-P -h`, so it changes symlinks in `./data` themselves and never the files they point to.
- **With a `user:` override** on the api or worker in a compose override file, the entrypoint doesn't start as root, so it changes neither the owner nor the mode of `/data`. New files are still created owner-only, but `./data` itself keeps the mode Docker gave it. Run `chmod 700 ./data` yourself, as the user that owns it.

Compose also locks every container down:

| Service | Capabilities | Root filesystem | Writable paths |
| --- | --- | --- | --- |
| `api` | all dropped, then `CHOWN`, `SETUID`, `SETGID`, `DAC_READ_SEARCH` added back for the entrypoint | read-only | `/data` |
| `worker` | same as `api` | read-only | `/data`, and a tmpfs `/tmp` for `xvfb-run`, OrcaSlicer, PrusaSlicer and OpenSCAD |
| `web` | all dropped | read-only | none |
| `caddy` | all dropped, runs as `10002:10002` | read-only | the `caddy_data` and `caddy_config` volumes |
| `caddy-init` | all dropped, then `CHOWN` and `DAC_READ_SEARCH`; runs once as `0:0` with no network, then exits | read-only | the `caddy_data` and `caddy_config` volumes |
| `redis` | all dropped, runs as the image's `redis` user (`999:1000`) | read-only | the `redis_data` volume |

The four capabilities are the entrypoint's minimum: `CHOWN` and `DAC_READ_SEARCH` let the one-time `chown -R` change and walk a root-owned `./data` that already holds `0700` job directories, and `SETUID` and `SETGID` let `setpriv` switch to `10001`. The app itself has no effective capabilities, and `no-new-privileges` stops it gaining any. If you add a tool to the worker that writes outside `/data` and `/tmp`, it fails with `Read-only file system`: give it a `tmpfs` entry in `docker-compose.yml` rather than turning `read_only` off.

Caddy runs as `10002:10002` with no capabilities. It binds `:80` and `:443` because compose sets `net.ipv4.ip_unprivileged_port_start=0` in its own network namespace. `skip_install_trust` in the `Caddyfile` stops Caddy trying to add its local CA to the container's own trust store, which the read-only root would refuse. Redis needs no capability: its data volume is already owned by `redis`, so its entrypoint skips the `chown` and the user switch it does when started as root.

Before Caddy starts with `docker compose up`, the one-shot `caddy-init` service hands `caddy_data` and `caddy_config` to `10002:10002` and exits; Caddy waits for it to succeed. It lets an install whose volumes an earlier root Caddy wrote keep its local CA, its certificates and any ACME account: the first start logs `caddy-init: <n> paths handed to 10002:10002`, and every later start logs `0 paths`. It runs as root with only `CHOWN` (to change owners) and `DAC_READ_SEARCH` (to walk the `0700` directories it has already handed over), a read-only root, `no-new-privileges` and no network. If it fails, Caddy does not start; `docker compose logs caddy-init` says why.

`caddy-init` runs only on `docker compose up`. After a host reboot, Docker restarts Caddy from its `unless-stopped` policy without it, so a file made root-owned since the last `up` (a backup restored as root, say) stays unreadable to Caddy until you run `docker compose up -d` again, which re-runs the handover. What that does depends on the file. A root-owned certificate leaves Caddy running but unable to serve that site over HTTPS. A root-owned file of the local CA (`pki/authorities/local/`) makes Caddy exit at start (`provisioning CA 'local': loading root cert`), so Docker restarts it in a loop.

To go back to a root Caddy, set `caddy`'s `user` to `"0:0"`, remove the `caddy-init` service and the `caddy-init` entry under `caddy`'s `depends_on` (Compose rejects a file that depends on a service it doesn't define), then hand the volumes back to root once before starting it:

```sh
docker compose run --rm --no-deps --cap-add CHOWN --cap-add DAC_READ_SEARCH --entrypoint chown caddy -R -h 0:0 /data /config
```

`-h` changes a symlink itself, never the file it points to, as `caddy-init` does.

A Redis volume holding a root-owned file, for example after a backup was restored as root, stops Redis from starting, and Compose restarts it in a loop. Its log ends in a `Permission denied` whose wording depends on which file is root-owned, for example:

- `Error moving temp append only file on the final destination: Permission denied`
- `Fatal error: can't open the AOF manifest file appendonlydir/appendonly.aof.manifest for reading: Permission denied`
- `Can't open or create append-only dir appendonlydir: Permission denied`

Hand the volume back to `redis` once, then start the stack:

```sh
docker compose run --rm --no-deps --user 0 --cap-add CHOWN --cap-add DAC_READ_SEARCH --entrypoint chown redis -R 999:1000 /data
```

`CHOWN` changes the owner, and `DAC_READ_SEARCH` lets it walk the `0700` directories `redis` already owns. Both exist only for that one container.

## Upgrading from v0.1.x

v0.1.4 is the last tagged release. Upgrading from it to the current release crosses every change below at once, so do them in this order:

1. **Resume a paused queue.** Run `docker compose exec redis redis-cli HGET bull:conveyor-jobs:meta paused`. If it prints `1`, resume the queue first ([Upgrading from BullMQ 5](#upgrading-from-bullmq-5-v014-and-earlier)).
2. **Take a full backup** while the stack is still on Redis 7 ([Back up and restore everything](#back-up-and-restore-everything)). It is the only way back: Redis 8 rewrites the queue volume in a form Redis 7 can't read.
3. **Update `.env`.** v0.1.4 had no login, and the api now refuses to start without one. Add `CONVEYOR_PASSWORD` and `CONVEYOR_AUTH_SECRET` ([First run](#first-run), step 3), and copy any new lines from `.env.example`.
4. **Keep LAN access if you had it.** v0.1.4 published ports 80 and 443 on every interface; now Caddy listens on `127.0.0.1` only. To reach Conveyor from other devices again, set `CONVEYOR_BIND` ([Network exposure](#network-exposure)).
5. **Move a custom hostname out of the `Caddyfile`.** If you replaced `localhost` in it, put that name in `CONVEYOR_DOMAIN` and run `git checkout Caddyfile`, or the next step stops on a conflict.
6. **Get the new code:** `git pull && git submodule update --init`.
7. **Recreate the network:** `docker compose down`. Never add `-v`, which deletes the volumes. The fixed network for Caddy's address can't be applied to the old one ([Failed logins](#failed-logins-and-the-client-address)).
8. **Start:** `docker compose up -d --build --wait`.
9. **Check the one-time steps in the logs:** `docker compose logs api worker caddy-init` should show `conveyor: /data is not owned by 10001:10001, changing its owner once`, `caddy-init: <n> paths handed to 10002:10002`, and `[secrets] generated a new key` if you didn't set `CONVEYOR_SECRETS_KEY`. Back that new `./data/secrets.key` up.
10. **Sign in** at your Conveyor address with `CONVEYOR_PASSWORD`, and check the printers and history are there.

**To roll back**, stop the stack, check out `v0.1.4`, restore the full backup from step 2, then `docker compose up -d --build`. The sections below say why each step exists: [encrypted printer secrets](#upgrading-and-rolling-back), [Redis 8](#upgrading-from-redis-7-v014-and-earlier), [uid 10001](#containers-run-as-uid-10001).

## Upgrading from BullMQ 5 (v0.1.4 and earlier)

This applies only to the default Redis queue, and only if the job queue was paused. Conveyor never pauses it itself, so a pause comes from someone running `pause()` or a BullMQ admin tool by hand.

Resume a paused queue before upgrading from v0.1.4 or earlier: the next release moves from BullMQ 5 to BullMQ 6 (#267). BullMQ 5 keeps the jobs of a paused queue in a separate list that BullMQ 6 no longer reads. So after the upgrade, every job that was waiting in that queue is invisible to the job lists until the queue is resumed, whether it was added before or during the pause. That means `/api/jobs/active` leaves those jobs out, and deleting a printer or profile doesn't count them as in use.

Check before upgrading. This prints `1` when the queue is paused and nothing when it isn't:

```bash
docker compose exec redis redis-cli HGET bull:conveyor-jobs:meta paused
```

If it prints `1`, resume it from the api container. The same command works on either side of the upgrade, and a queue resumed after the upgrade gets its jobs back:

```bash
docker compose exec -w /app/packages/api api bun -e 'const { Queue } = await import("bullmq"); const { Redis } = await import("ioredis"); const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null }); const q = new Queue("conveyor-jobs", { connection }); await q.resume(); console.log("paused:", await q.isPaused()); await q.close(); connection.disconnect();'
```

It prints `paused: false` when it's done.

## Upgrading from Redis 7 (v0.1.4 and earlier)

The release after v0.1.4 moves the compose `redis` service from `redis:7-alpine` to `redis:8-alpine`. The upgrade is one-way. Redis 8 reads the volume Redis 7 left, but once Redis 8 rewrites its append-only file, which it does on its own as the file grows, Redis 7 refuses the volume (`Can't handle RDB format version 15`) and the stack stays down. **You can't roll back to Redis 7 without a backup of `redis_data` taken before the upgrade.**

Back up the volume first, while the stack is still on Redis 7:

```bash
docker compose stop api worker redis
docker run --rm -v conveyor_redis_data:/data:ro -v "$PWD":/backup alpine \
  tar -C /data -czf /backup/redis_data-before-8.tgz .
```

Then upgrade as usual (`docker compose up -d --build`). Redis 8 starts on the same volume, and queued jobs are kept.

To go back to Redis 7, restore that backup and pin the old image. Stop the stack, empty the volume and unpack the backup:

```bash
docker compose stop api worker redis
docker run --rm -v conveyor_redis_data:/data -v "$PWD":/backup alpine \
  sh -c 'find /data -mindepth 1 -delete && tar -C /data -xzf /backup/redis_data-before-8.tgz'
```

Set the `redis` service's `image:` back to `redis:7-alpine` and run `docker compose up -d`. Anything queued after the backup is lost.

The volume is `conveyor_redis_data` because the compose project is named `conveyor`; `docker volume ls` shows it.

Redis 8's image loads four add-on modules on start (RedisBloom, RediSearch, RedisTimeSeries and RedisJSON), and Conveyor uses none of them. The compose service mounts an empty, read-only `tmpfs` over the image's module folder, `/usr/local/lib/redis/modules`, so none of them load. The vector-set type is built into Redis 8 itself and stays.

## Releasing a held printer

This applies only to the SQLite queue (`CONVEYOR_QUEUE=sqlite`); the default Redis queue never holds a
printer. When a worker stops while it is sending a job to a printer, the queue cannot know whether the printer got
the job. It fails that job with "check the printer before releasing it" and holds the printer, so no other
job is sent to it. Check the printer, stop or remove anything it should not be printing, then release the
hold. Until the UI has a button for it, release it from a shell. With authentication on (the default), log
in first; the session cookie goes in a private temporary file:

```sh
jar=$(mktemp)
read -rs CONVEYOR_PW
printf '{"password":"%s"}' "$CONVEYOR_PW" |
  curl -fsS -c "$jar" -H 'content-type: application/json' --data-binary @- https://localhost/api/auth/login
curl -fsS -b "$jar" -H 'content-type: application/json' -d '{"confirm":true}' \
  https://localhost/api/catalog/printers/<printer-id>/release
rm -f "$jar"; unset CONVEYOR_PW
```

`read -rs` keeps the password out of the shell history and the process list. A password containing `"` or
`\` must be JSON-escaped in the first command. With `CONVEYOR_AUTH=disabled`, only the second `curl` is
needed, without `-b "$jar"`. Replace `localhost` with your `CONVEYOR_DOMAIN` if you set one; for Caddy's local
certificate, add `-k` or trust its root ([HTTPS on the LAN](#https-on-the-lan-trusting-caddys-local-ca)).

## Local development without Docker

`bun run dev:api` reads the same variables from your shell. Export `CONVEYOR_PASSWORD` and `CONVEYOR_AUTH_SECRET`, or `CONVEYOR_AUTH=disabled`, before you start it. Over plain HTTP, also set `CONVEYOR_COOKIE_INSECURE=1` so the browser keeps the session cookie.

## Printers on the LAN

The worker talks to printers over your network from the Compose bridge network. Store each printer's IP address in its address field, and give the printer a DHCP reservation so the address doesn't change. mDNS names such as `printer.local` aren't supported in the containers: they resolve names through DNS only and have no mDNS resolver, so `network_mode: host` doesn't help either.

## Runtime directories

`./data` is mounted into both `api` and `worker`: uploaded STLs, job artifacts (`*.stl`, `*.gcode`), the SQLite database and, unless `CONVEYOR_SECRETS_KEY` is set, `secrets.key` live there. `./profiles` holds the locked slicer profiles (read-only) and is mounted into both `api` and `worker`: the worker slices with it, and the `api` reads it so the raw JSON editor can fall back to the bundled profile when the database has no edited copy. `./scad` is the gridfinity-rebuilt-openscad submodule.

## Routing in the Caddyfile

Caddy sends everything under `/api/` to `api` and strips the prefix (`handle_path`), so `/api/jobs/active` reaches the API's own `/jobs/active`. Everything else goes to `web`, so pages such as `/jobs` and `/jobs/<id>` load directly. `https://localhost/api/health` answering `{"ok":true}` means Caddy, its certificate and the API are all up; the `compose` CI job waits on it. Anything that calls the API through Caddy, such as a script or a health probe, adds `/api` in front of the path: `curl https://localhost/api/health`. The site address is `{$CONVEYOR_DOMAIN:localhost}`; set the name in `.env`, not here ([The name Caddy serves](#the-name-caddy-serves)). Let's Encrypt needs no email address.

## Slicer and CAD engines in the worker image

The worker Dockerfile's `openscad` stage builds OpenSCAD from source with `scripts/build-openscad.sh`, which fetches and checks it with `scripts/fetch-openscad-source.sh`, on `debian:trixie-slim`, for the host architecture. The distro release cannot parse the gridfinity library ([archive/M1-WORKER-ENGINES.md](archive/M1-WORKER-ENGINES.md)), so the script builds the upstream release candidate `openscad-2026.11-RC0` (commit `9ba0cee7c94785fac0ca8dfe040b965a12a25ed1`) from its source tarball, `openscad-2026.11-RC0.src.tar.gz` on the upstream GitHub release. Before building it checks three things, and any failing fails the build: the pinned sha256, the tarball's GnuPG signature (`.asc`), and that its `COMMIT.txt` names the pinned commit. The signature must be a good one from the OpenSCAD release key, `OpenSCAD <dev@openscad.org>`, fingerprint `E2EB DADD 336F F516 ADD5 1A78 F3E1 2CCC 2216 4A0F` (as listed on openscad.org/downloads). The key is vendored as `scripts/openscad-release-key.asc`, and `scripts/verify-openscad-signature.sh` checks it with `gpgv`. A missing or empty `.asc`, a bad signature, and a signature from any other key all fail. The build is headless (`NULLGL`, no GUI or OpenGL) and links only against Debian trixie's shared libraries, so the final image carries no bundled libraries and sets no `LD_LIBRARY_PATH`.

### OpenSCAD's corresponding source

OpenSCAD is GPL-2.0-or-later, so the worker image must come with its exact source. That source is the tarball above, which bundles every submodule (manifold, Clipper2, OpenCSG, mimalloc) and is byte-identical on both arches:

- **In the image:** `/opt/openscad/share/doc/openscad/SOURCE` names the version, commit, tarball URL and sha256, and `COPYING` sits next to it.
- **Upstream:** `https://github.com/openscad/openscad/releases/download/openscad-2026.11-RC0/openscad-2026.11-RC0.src.tar.gz`, or `git archive` of the commit with its submodules.
- **On each Conveyor release:** the release workflow attaches the same tarball, its `.asc` and its sha256 to the GitHub release, so the source stays available from Conveyor even if upstream moves it.
- **The libraries it links:** Debian trixie packages, whose source is the matching Debian source package (`apt-get source`, or <https://snapshot.debian.org>).

`scripts/install-orca.sh <x.y.z> <auto|1|0>` installs the OrcaSlicer AppImage for the host architecture from the pinned release, 2.4.1 by default, and checks it against a pinned sha256. A checksum mismatch fails the build in every mode. If the build is given an `orca-cache` build context (`--build-context orca-cache=<dir>`) holding the AppImage for its architecture, the script uses that file instead of asking GitHub's API, and checks it against the same pin. Without one, the Dockerfile's empty `orca-cache` stage is used and the script downloads as usual. The `ORCA_ENABLE` build argument picks the mode:

| `ORCA_ENABLE` | Behaviour |
| --- | --- |
| `1` | Required: any failure fails the build. |
| `auto` (default) | Best effort: API rate limits and network errors are retried; if Orca still cannot be installed, the build continues, writes `/opt/orca/NOT_INSTALLED` with the reason, and Orca-profile jobs fail at the slice stage. PrusaSlicer still works. |
| `0` | Skipped. |

Orca is GUI-linked, so the worker runs it under `xvfb-run`. After extracting the AppImage, the script deletes `squashfs-root/resources/web`. That folder holds the web pages of Orca's GUI onboarding, including an old `swiper` with a fixed critical CVE (CVE-2026-27212), and a headless `--slice` never reads it.

### Bumping the OpenSCAD pin

Pin only upstream releases or release candidates that publish a signed `openscad-<version>.src.tar.gz`; nightly snapshots have no matching source tarball.

1. Pick the release on `https://github.com/openscad/openscad/releases`, and download its `.src.tar.gz`, `.asc` and `.sha256`. Check the `.sha256` against `sha256sum` of your own download, and the signature with `scripts/verify-openscad-signature.sh <tarball> <tarball>.asc`.
2. In `scripts/fetch-openscad-source.sh`, set `VERSION`, `SHA256`, and `COMMIT` to the full commit the release tag points at (`gh api repos/openscad/openscad/git/ref/tags/openscad-<version>`). Its first eight characters must match the tarball's `COMMIT.txt`.
3. If the build needs new libraries, add the `-dev` packages to the `openscad` stage and their runtime packages to the final stage. Find them with `ldd /opt/openscad/bin/openscad` in the builder.
4. If upstream rotates its signing key, replace `scripts/openscad-release-key.asc` with the new key from `https://files.openscad.org/OpenSCAD_public_key.asc`, and `FINGERPRINT` in `scripts/verify-openscad-signature.sh` with the fingerprint openscad.org/downloads lists. Check that the two agree before committing.
5. Open the PR. CI's `orca slice` job builds OpenSCAD on x86_64, renders a cube and slices it. Run `bun scripts/gridfinity-smoke.ts` in the image to render and slice a real gridfinity bin. Nothing in CI builds on aarch64, so check it on an arm64 host.

### Bumping the OrcaSlicer pin

The bundled profile in `profiles/orca-klipper-pla-0.2/` only loads in the Orca release it was exported from. A newer release can reject it with "Preset was not found in the loaded bundle", so bump the release and the profile together:

1. In the new OrcaSlicer, re-export the three leaf presets (machine, process, filament) into `profiles/orca-klipper-pla-0.2/`, and update the version in its `README.md`.
2. Set the new version as the `ORCA_RELEASE` default in `packages/worker/Dockerfile` and `scripts/install-orca.sh`.
3. Replace the `pinned_sha256` entries in `scripts/install-orca.sh` with the new x86_64 and aarch64 AppImage names and their sha256. `gh api repos/OrcaSlicer/OrcaSlicer/releases/tags/v<x.y.z> --jq '.assets[] | "\(.name) \(.digest)"'` lists both, or run `sha256sum` on the downloads. Also update `ORCA_RELEASE`, `ORCA_ASSET` and `ORCA_SHA256` (the x86_64 AppImage) in the `orca slice` job of `.github/workflows/ci.yml`: that job downloads the AppImage itself, authenticated with the job's token, caches it by version and sha256, and hands it to the build.
4. Open the PR. CI's `orca slice` job builds the worker with `ORCA_ENABLE=1` and slices a cube with the bundled profile as uid 10001, so a profile the new release rejects fails there.
