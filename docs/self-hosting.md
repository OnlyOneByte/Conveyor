# Self-hosting Conveyor

Conveyor runs as a Docker Compose stack: Caddy (TLS and routing), `web` (the PWA), `api` (REST and WebSocket), `worker` (generators, slicers, transports) and `redis` (queue and live status). Durable data lives in SQLite under `./data`; see [DATA-MODEL.md](DATA-MODEL.md).

## First run

1. Copy the example environment file:

   ```sh
   cp .env.example .env
   ```

2. Set a password and a signing secret in `.env`:

   ```sh
   CONVEYOR_PASSWORD=choose-a-long-passphrase
   CONVEYOR_AUTH_SECRET=$(openssl rand -hex 32)
   ```

   Paste the generated hex string into the file rather than the command. `CONVEYOR_AUTH_SECRET` must be at least 32 characters and should stay the same across restarts: it signs session cookies, so changing it logs everyone out.

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

## Network exposure

Caddy publishes ports 80 and 443 on `127.0.0.1` by default, so a fresh install is reachable only from the host machine.

To expose Conveyor deliberately, set `CONVEYOR_BIND` in `.env` to the host address that should accept connections:

| Goal | Setting |
| --- | --- |
| This machine only (default) | `CONVEYOR_BIND=127.0.0.1` |
| One LAN interface | `CONVEYOR_BIND=192.168.1.20` (the host's LAN address) |
| Every interface | `CONVEYOR_BIND=0.0.0.0` |

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
| `CONVEYOR_PASSWORD` | none, required | Shared login password. |
| `CONVEYOR_AUTH_SECRET` | none, required | HMAC key for session cookies, 32 characters or more. |
| `CONVEYOR_AUTH` | `enabled` | Set to `disabled` to run without a login. |
| `CONVEYOR_BIND` | `127.0.0.1` | Host address Caddy publishes ports 80 and 443 on. |
| `PUBLIC_API_URL` | `https://localhost` | Origin the PWA calls. |
| `ORCA_VERSION` | `2.1.1` | OrcaSlicer version baked into the worker image. |

## Local development without Docker

`bun run dev:api` reads the same variables from your shell. Export `CONVEYOR_PASSWORD` and `CONVEYOR_AUTH_SECRET`, or `CONVEYOR_AUTH=disabled`, before you start it. Over plain HTTP, also set `CONVEYOR_COOKIE_INSECURE=1` so the browser keeps the session cookie.
