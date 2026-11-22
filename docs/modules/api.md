# packages/api

The REST and WebSocket front door. It validates requests, serves the catalog and history, and enqueues jobs.
It never runs a plugin's `generate()`, `slice()` or `submit()`: those run only in the worker
([ADR 0001](../adr/0001-plugin-isolation.md)).

## Boot order (`index.ts`)

`index.ts` registers `GET /health`, the auth guard, the login routes, then the generator, upload, catalog and job
routes, and the printer-hold route. It listens on `CONVEYOR_HOST`, which defaults to `127.0.0.1`. The auth guard is a global `onRequest` hook: it applies to every route, whatever order routes are
registered in. Requests whose path (query string removed) is exactly an entry in `PUBLIC_PATHS` (today `/health`) or
starts with an entry in `PUBLIC_PREFIXES` (today `/auth/`) skip it; everything else needs a valid session.
`/health` is an exact match so that a later route such as `/health-report` is not public by accident.
`routes/auth-guard.test.ts` boots the real `index.ts` with auth on and checks that every mutating route
answers `401` without a session. `routes/auth-guard-sqlite.test.ts` does the same in `CONVEYOR_QUEUE=sqlite`
mode for every job route, the WebSocket upgrade and the history routes.

The job routes depend on the queue. `index.ts` reads `CONVEYOR_QUEUE` through `queueMode` from
`@conveyor/shared`, exits with code 1 on a bad value, and imports `routes/jobs.ts` (Redis) or
`routes/jobs-sqlite.ts` (SQLite). Both register the same paths. The import is dynamic, so in `sqlite` mode
`queue.ts` is never loaded and the api opens no Redis connection.

## Job routes on the SQLite queue (`routes/jobs-sqlite.ts`)

| Route | On the SQLite queue |
| --- | --- |
| `POST /jobs` | `parseSubmission`, then `enqueueJob`; `202 { jobId }` |
| `GET /jobs/active` | every job not done, failed or canceled, newest update first, each as its snapshot |
| `GET /jobs/:id` | `readSnapshot`; 404 for an unknown id |
| `POST /jobs/:id/cancel` | `requestCancel`: `200` with the state of a finished job, `200 canceled` for a queued one, `202 canceling` for one in flight, `404` for an unknown id |
| `GET /jobs/:id/ws` | the snapshot as the first frame, then the event-log tail from the snapshot's cursor |

The WebSocket reads the snapshot and its cursor in one statement, so the tail that starts after the cursor
neither drops nor repeats an event. It polls `tailEvents` every 250 ms, backing off to 1 s after 5 s with no
new event, and closes after forwarding a terminal event. Each poll keeps reading 100-event pages until one
comes back short, so a backlog never lags. A job already finished sends its snapshot and closes; an unknown
job closes with no frame. A stored row or event that does not parse closes the socket and logs.

Polling is bounded by a cap: at most 64 job streams are open at once, across all sessions, and one more is
closed with code `1013`. There is no per-session cap, because every session shares the one password. A socket
stays open until its job finishes or a side closes it, so a long print keeps its live status; it stops
polling the moment it closes, and counts back against the cap exactly once.

The current web client does not reconnect. The UI rewrite must reconnect after a `1013` (with a backoff) and
after any other close of an unfinished job's stream; each new socket starts from a fresh snapshot, so nothing
is missed. `GET /jobs/active` skips, and logs, a row that does not parse, so one bad
row cannot turn the whole list into a 500. The limits are `DEFAULT_TAIL`; tests pass their own.

## Auth (`auth.ts`, `routes/auth.ts`)

- One tier only: the password grants the whole app, catalog included. Session cookies minted by the former
  two-tier scheme still carry a role field; verification ignores it rather than invalidating the cookie.
- The session token is `base64url(payload).hmac`. The payload's only claim is `exp`, epoch milliseconds.
- Password and signature checks compare fixed-length SHA-256 digests with `timingSafeEqual`, so a length
  mismatch cannot short-circuit the comparison.
- The cookie is read from the `Cookie` header by hand; there is no cookie-parser dependency.
- The public paths live in two short lists, `PUBLIC_PATHS` (exact, `/health`) and `PUBLIC_PREFIXES`
  (`/auth/`), so a new route cannot fall outside the protected tree by accident. Everything else needs a valid session.
- With auth disabled there is no gate (a warning is logged at boot), and `POST /auth/login` answers `ok`.
- `GET /auth/status` tells the client whether to show a login screen.
- A successful login sets `cache-control: private, no-store` so the gated response is never cached or
  cross-served.
- Failed logins are limited per client (`login-limit.ts`): after 5 wrong passwords within a minute, every
  login, the right password included, answers `429` with `Retry-After` until that minute has passed. A
  successful login clears the client's count. The limiter is in memory, keeps at most 10,000 clients (the
  oldest is dropped first), and resets when the api restarts.
- The client is `clientKey(req.ip)` (`trusted-proxies.ts`): an IPv4 address as is, an IPv4-mapped IPv6
  address as its IPv4, and any other IPv6 address as its /64. `req.ip` is the socket peer, unless the peer is
  in `CONVEYOR_TRUSTED_PROXIES`, which `index.ts` passes to Fastify's `trustProxy`; then it is the client
  that proxy reports in `X-Forwarded-For`. The setting is parsed strictly at boot (IPs or CIDRs, an invalid
  entry exits 1), and unset trusts nothing. Compose trusts Caddy's fixed address only.

## Catalog and history (`routes/catalog.ts`)

- These routes are the whole configuration surface: printers, profiles and the job history. A job names a
  printer and a profile directly, so there is no saved pairing to curate.
- Printer `secrets` are accepted on write and never returned on read; reads return `hasSecrets` instead.
  Omitting `secrets` on a write keeps the stored value (see `dbUpsertPrinter`).
- `allowedGenerators`: omit it for no restriction; `[]` allows nothing.
- `GET /jobs-history` and `GET /jobs-history/:id` show finished jobs only (done, failed, canceled); the detail
  route returns 404 for an in-flight or unknown id. On the Redis queue only finished jobs have a row; on the
  SQLite queue every job has one from the moment it is enqueued, so both routes filter by state.
- `GET /catalog/printers/:id/reachable` returns 404 for an unknown printer, otherwise 200 with the probe result.
  `reachable: false` is a successful probe of an offline printer, not an error.
- `GET /catalog/transports` feeds the Settings printer form's transport picker.
- Profile content (`/catalog/profiles/:id/content`) dispatches on the slicer format: Orca serves three JSON
  documents, Prusa one `config.ini`, and a slicer with no editable format answers 409.
  - `GET` returns the stored edit if there is one, otherwise the bundled profile.
  - `PUT` stores validated text verbatim. The zod schemas only check shape; byte limits and per-file messages
    come from `validateOrcaDocuments` and `validatePrusaContent`. The route's `bodyLimit` is twice the larger
    of Orca's post-parse content limit and Prusa's 512 KiB config, to allow for JSON string escaping.
  - `DELETE` clears the edit only after proving the bundled fallback is readable and valid.

## Bundled profile files (`profile-content.ts`)

- SQLite stores logical paths, `/profiles/<bundle>`, in every environment. The readable root is
  `CONVEYOR_PROFILES_ROOT`, defaulting to the repository's `profiles/` directory.
- A request never supplies a filename. Orca opens only `machine.json`, `process.json` and `filament.json`;
  Prusa opens a `.ini` found by listing the bundle directory, preferring `config.ini`, else the first
  alphabetically (the same preference as the slicer adapter's `loadConfigs`). A multi-`.ini` bundle is edited
  as one document.
- Every directory and file is `realpath`ed and checked for containment under the root, so a symlink cannot
  escape. Size is checked both from `stat` and after reading.
- Shared validation errors become a `ProfileContentError` with status 400.

## Job submission and artifact routes (`routes/job-common.ts`)

`parseSubmission` and `registerArtifactRoute` are shared by the job routes of each queue. `parseSubmission`
parses the body with `jobRequestSchema`, resolves the printer and profile pair (404 when either is unknown)
and checks compatibility with `validateJobRequest` (400). `registerArtifactRoute` serves
`GET /jobs/:id/artifact/:kind`, described below.

## Artifact downloads (`artifact-download.ts`)

- The worker writes each job's artifacts under `${DATA_DIR}/<jobId>/`. The API resolves the same root, read
  on each request; both default to `/data` and are overridden together with `DATA_DIR`.
- The artifact path comes from the job's own durable record, never from the request: the request supplies only
  the job id and the fixed `model | gcode` kind.
- After `realpath` (of the root too, so a symlinked `DATA_DIR` compares correctly), the file must sit under
  the job's own directory and still exist. A recorded file that is gone, or a reaped work directory, is 410;
  an unknown job, a missing record or an escaping path is 404.

## Uploads (`routes/uploads.ts`)

- `POST /uploads` stores STL bytes at `${UPLOAD_DIR}/<uploadId>.stl` (default `${DATA_DIR}/uploads`) on the
  shared volume, where the worker's passthrough generator reads them. The client submits the returned
  `uploadId` as the passthrough generator's `params.uploadId`.
- The bytes are never treated as code; they go to the slicer as-is. Only the size cap (`MAX_UPLOAD_BYTES`,
  default 100 MiB, 413 when exceeded) and the `.stl` extension (415 otherwise) are enforced.

## Registry view (`registry-view.ts`, `validate.ts`, `routes/generators.ts`)

- `apiRegistry` holds capabilities and metadata only. Generator plugins are imported for their pure-data
  schema, preview and outputs; slicer and transport capabilities are declared inline because their adapters
  live in the worker image with the engines. Their adapter methods throw here; the generators' `generate()` is
  wired but never called.
- Planned: hydrate the view from manifests the worker publishes over Redis at boot, instead of the inline copy.
- `GET /generators` serves each generator's `paramSchema`, UI hints and preview module so the web app can
  render its form.
- `validateJobRequest` runs the shared capability check against this view.
- `validatePrinterTransport` rejects an unknown `transportId` when a printer is written. `printerSchema` only
  checks for a non-empty string, so without it a typo would persist and fail much later, at job submit, as an
  unrelated-looking compatibility error.

## Printer probe (`printer-probe.ts`)

- Reachability is a TCP connect to `host:port`: the common denominator across transports, needing no
  transport-specific health call and no printer secret. It is a liveness signal, not "ready to print".
- `parseAddress(address, transportId)` is `parseHostPort` from `@conveyor/shared/address` with the transport's
  default port: Moonraker 80 for its HTTP API, Elegoo 3030 for SDCP, otherwise 80. The accepted forms and the
  rejection reasons are in [shared.md](shared.md#addressts). The transports parse addresses with the same
  function, so the probe and the plugins agree on the host.
- `probePrinter` reports an invalid address as `unparseable address "<address>": <why>`.
  `probePrinter` always resolves, with `latencyMs` on success and the socket error code or `timeout` as
  `reason` on failure.

## Printer holds (`routes/printer-holds.ts`)

`POST /catalog/printers/:id/release` clears a printer hold. The queue sets a hold when it cannot know whether a
printer received a job: a worker that stopped between the submit intent and the submit marker. No job is
prepared for a held printer until someone checks the printer and releases it.

- It sits under `/catalog`, beside the other printer routes, because the Caddyfile already sends that
  namespace to the api.
- The body must be exactly `{ "confirm": true }`. Anything else is a `400`, so a stray or replayed request
  cannot release a hold.
- `404` for an unknown printer, `409` when the printer has no hold, and `{ ok: true, printerId }` once the hold
  is cleared.
- It is a mutating route behind the same global auth guard as every other non-public route. It is not a
  public path, so without a session it gets `401`; `routes/auth-guard.test.ts` checks this on a booted api.

## Redis (`queue.ts`)

Two connections: `connection`, with `maxRetriesPerRequest: null` as BullMQ requires for blocking commands,
and `redis`, a plain client for snapshot reads and pub/sub fan-out.

## Image (`Dockerfile`)

The API image carries no engines; bun runs the TypeScript entrypoint directly. `bun install --frozen-lockfile`
validates the whole workspace against `bun.lock`, so the deps stage copies every workspace member's
`package.json`, including ones the API never imports, or bun reports "lockfile had changes" and aborts.
The image sets `CONVEYOR_HOST=0.0.0.0` so caddy can reach it over the compose network. The api's own default
is loopback, and the image publishes no port: caddy's publish, on `CONVEYOR_BIND`, is the boundary.
