# packages/api

The REST and WebSocket front door. It validates requests, serves the catalog and history, and enqueues jobs.
It never runs a plugin's `generate()`, `slice()` or `submit()`: those run only in the worker
([ADR 0001](../adr/0001-plugin-isolation.md)).

The routes on this page are the api's own paths. Browsers and scripts reach them through Caddy under `/api`, which
Caddy strips: `GET /jobs/active` here is `https://<host>/api/jobs/active` from outside.

## Boot order (`index.ts`)

`index.ts` registers `GET /health`, the auth guard, the login routes, then the generator, upload, catalog and job
routes, and the printer-hold route. It listens on `CONVEYOR_HOST`, which defaults to `127.0.0.1`. The auth guard is a global `onRequest` hook: it applies to every route, whatever order routes are
registered in. A route is public only when it opts in with `PUBLIC_ROUTE` (`{ config: { public: true } }`),
read from the matched route's config: today `/health`, `/auth/status`, `/auth/login` and `/auth/logout`.
Everything else needs a valid session, including a path no route matches and any new route under `/auth/`
that does not opt in.
`routes/auth-guard.test.ts` boots the real `index.ts` with auth on and checks that every mutating route
answers `401` without a session. `routes/auth-guard-sqlite.test.ts` does the same in `CONVEYOR_QUEUE=sqlite`
mode for every job route, the WebSocket upgrade and the history routes.

The job routes depend on the queue. `index.ts` reads `CONVEYOR_QUEUE` through `queueMode` from
`@conveyor/shared`, exits with code 1 on a bad value, and imports `routes/jobs.ts` (Redis) or
`routes/jobs-sqlite.ts` (SQLite). Both register the same paths. The import is dynamic, so in `sqlite` mode
`queue.ts` is never loaded and the api opens no Redis connection.

## Job status stream (both queues)

`GET /jobs/:id/ws` behaves the same on both queues: the job's current snapshot is the first frame, every
later event follows once and in order, and the server closes the socket with a code from `JOB_STREAM_CLOSE`
(`@conveyor/shared`):

| Code | Reason | When |
| --- | --- | --- |
| `1000` | `job finished` | after the frame of a terminal event, including a job that had already finished when the socket opened |
| `4404` | `unknown job` | no such job; no frame is sent |
| `1011` | `job stream failed` | the snapshot, the event tail or the Redis subscribe failed |
| `1013` | `too many job streams` | SQLite only: the polling cap below |

Both queues ping every job socket every 30 s (`DEFAULT_HEARTBEAT` in `heartbeat.ts`). A socket that has
not answered the last 2 pings is terminated without a close frame, which runs the same release as any
other close: the SQLite cap slot is freed and the Redis viewer leaves the shared subscriber. A half-open
socket (a sleeping phone, a dropped link behind Caddy) is therefore reaped within about 90 s.

On Redis (`routes/job-stream.ts`) every socket in an api process shares one subscriber connection
(`status-hub.ts`): one `SUBSCRIBE` per job with viewers, fanned out in process, an `UNSUBSCRIBE` when a
job's last viewer leaves, and the connection closed when no viewer is left. A socket subscribes first and
reads the snapshot after, buffering what arrives meanwhile. `publishStatus` stamps each event with a per-job
`seq` (`INCR job:<id>:seq`) and writes the snapshot and publishes the same stamped string in one script, so a
buffered event is sent only when its `seq` is above the snapshot's; two identical events never hide the one
between them. An event with no `seq` (from a worker older than the stamping) is sent only if it is
terminal, so the socket still closes. The buffer holds at most 256 events and each read (the snapshot, then the BullMQ lookup) gets
5 s; past either, the socket closes with `1011`. An id that is not a UUID closes with `4404` before any
lookup, since `meta` or `<id>:cancel` would otherwise match BullMQ's or the cancel flag's keys;
`GET /jobs/:id` and `POST /jobs/:id/cancel` answer `404` for such ids on the same rule. A job with no
snapshot yet but still in BullMQ waits for its first event instead of closing as unknown. The subscriber is
created with `enableReadyCheck: false`: with the check on, two viewers arriving together on a fresh
subscriber made ioredis send its ready check after the first `SUBSCRIBE`, which failed one of them with
`1011`.

## Estimates on `GET /jobs/active` (`estimates.ts`)

In both modes an active job can carry `estimate: { typicalMs?, startsAt? }`; with neither, there is no `estimate`.

- `typicalMs`: the median `durationMs` of each stage over the last 20 `done` jobs with the same generator and
  printer (`dbTypicalStageMs`). A stage with fewer than 3 samples is left out. `transport` covers the upload and
  the print together.
- `startsAt` (epoch ms), for a `queued` job: when it should start printing, that is, take the printer. Each
  printer's queue is walked in `createdAt` order. The printer is free when its printing job's `print.secondsLeft`
  runs out (from the event's `at`), or after a running job's remaining model, slicing and typical `transport`.
  A queued job's model and slicing run meanwhile, but only once the job ahead of it has taken the
  printer, so it starts at the later of the printer being free and its own preparation being done. Each job ahead then holds the printer for its typical
  `transport`. Once a step is unknown, the jobs behind it get no `startsAt`, and a held printer
  (`printers.hold_job_id`, SQLite queue) gives none to its whole queue.
- On Redis the printer and generator come from the BullMQ job; if that read fails, estimates are left out.

## Job routes on the Redis queue (`routes/jobs.ts`)

`GET /jobs/active` reads the `jobs:active` set and returns each member's snapshot, newest event first. The
set is only an index and the snapshot is the truth: a member whose snapshot is gone or already terminal (a
worker that died mid-job) is left out of the answer and removed from the set, so the set heals itself. A
failed removal never fails the read. Fastify's router matches the literal `/jobs/active` before the
parametric `/jobs/:id` regardless of registration order, so a literal `/jobs/<word>` route needs no special
ordering, and `/jobs/:id` answers `404` for any id that is not a UUID.

`GET /jobs/:id` returns the job's current snapshot. The PWA reads it when it opens a job's status, next to
the WebSocket. The client does not reconnect a closed socket yet (#193).

Both routes add what the job is to each snapshot: `printerId`, `profileId`, `generator` (`id` and `params`;
an upload's `params` carry its `filename`) and `createdAt`, in epoch milliseconds. They come from the BullMQ
job's data and `timestamp`, and are checked by `jobFieldsSchema` in `@conveyor/shared`. A job BullMQ no longer
holds, a request that fails the schema, or a failed BullMQ read leaves those four fields out, logs, and still
answers the snapshot, so the UI can label the job by its stage (#342). The four fields do not depend on
estimates: `GET /jobs/active` adds them whether or not its estimates were left out.

## The Needs-you list (`registerNeedsYouRoutes` in `routes/job-common.ts`)

Both queue modes register these, behind the same session check as every other job route. Both read the SQLite
`jobs` table, which holds every settled job in either mode.

| Route | Answer |
| --- | --- |
| `GET /jobs/needs-you` | failed jobs that are neither dismissed nor retried, newest update first, at most 50, each as a history `Job` |
| `POST /jobs/:id/dismiss` | `200 { ok, jobId, dismissedAt }` for a failed job; `409` naming the state for any other; `404` for an unknown id |

Dismissing is idempotent: a second call answers with the first `dismissedAt`. A dismissed job stays `failed`
and stays in `GET /jobs-history`, which returns its `dismissedAt`.

A retry is a `POST /jobs` with `retryOf: <jobId>` naming the failure. `parseSubmission` checks it on both
queues (`dbRetryProblem`): an unknown job or one that isn't `failed` answers `400 { error }` starting with
`retryOf:`, and nothing is queued. `submitJob` (`routes/submit.ts`) then claims the failure in one `UPDATE`
that sets `retried_by` only while it is `failed` and unclaimed (`dbClaimRetry`); a lost claim answers `409
{ error }` naming `retryOf` and queues nothing, so a double-clicked Retry prints once. A queueing error clears
the claim (`dbReleaseRetry`). A claimed failure leaves `GET /jobs/needs-you` at once, without a dismissal.

## Job routes on the SQLite queue (`routes/jobs-sqlite.ts`)

| Route | On the SQLite queue |
| --- | --- |
| `POST /jobs` | `parseSubmission`, then `enqueueJob`; `202 { jobId }`. `parseSubmission` (shared with the Redis route) answers `400 { error }` naming the field, e.g. `generator.params.gridX: ...`, for params the generator's schema or `validateRequest` rejects |
| `GET /jobs/active` | every job not done, failed or canceled, newest update first, each as its snapshot plus `printerId`, `profileId`, `generator` and `createdAt` from the `jobs` row (`readJobFields`) |
| `GET /jobs/:id` | `readSnapshot` plus the same four fields; 404 for an unknown id. A row whose fields fail `jobFieldsSchema`, or whose `params_json` does not parse, answers the snapshot alone and logs |
| `POST /jobs/:id/cancel` | `requestCancel`: `200` with the state of a finished job, `200 canceled` for a queued one, `202 canceling` for one in flight, `404` for an unknown id |
| `GET /jobs/:id/ws` | the snapshot as the first frame, then the event-log tail from the snapshot's cursor |

The WebSocket reads the snapshot and its cursor in one statement, so the tail that starts after the cursor
neither drops nor repeats an event. It polls `tailEvents` every 250 ms, backing off to 1 s after 5 s with no
new event, and closes after forwarding a terminal event. Each poll keeps reading 100-event pages until one
comes back short, so a backlog never lags. A job already finished sends its snapshot and closes; an unknown
job closes with no frame. A stored row or event that does not parse closes the socket and logs. The close
codes are the ones in [Job status stream](#job-status-stream-both-queues).

Polling is bounded by a cap: at most 64 job streams are open at once, across all sessions, and one more is
closed with code `1013`. There is no per-session cap, because every session shares the one password. A socket
stays open until its job finishes or a side closes it, so a long print keeps its live status; it stops
polling the moment it closes, and counts back against the cap exactly once.

The current web client does not reconnect. The UI rewrite must reconnect after a `1013` (with a backoff) and
after any other close of an unfinished job's stream; each new socket starts from a fresh snapshot, so nothing
is missed. `GET /jobs/active` skips, and logs, a row that does not parse, so one bad
row cannot turn the whole list into a 500. The limits are `DEFAULT_TAIL`; tests pass their own.

## Auth (`auth.ts`, `routes/auth.ts`)

- One tier only: the password grants the whole app, catalog included.
- The session token is `base64url(payload).hmac`. The payload holds only `exp` (epoch milliseconds) and
  `sid` (16 random bytes). The `sessions` row for that `sid` stores the password version, an HMAC of the
  password keyed by the signing secret, so the cookie carries no fingerprint of the password. A token is valid
  only while its signature and `exp` check out, its `sid` still has an unexpired row, and that row's password
  version matches the current password's.
- Revocation is server-side. `POST /auth/logout` deletes that session's row, so the same cookie is refused
  afterwards even if a copy was kept; other sessions stay. Changing `CONVEYOR_PASSWORD` changes the password
  version, so every session issued under the old password is refused after the restart. Changing `CONVEYOR_AUTH_SECRET` does the
  same through the signature. A cookie from before sessions were stored (no `sid`) is refused, which logs
  everyone out once on upgrade. Sessions survive a restart with the same password and secret. Logging in
  prunes expired rows.
- Upgrading past #239 also logs everyone out once: the migration gives existing `sessions` rows an empty
  password version, which never matches, so those cookies are refused and users log in again.
- Password and signature checks compare fixed-length SHA-256 digests with `timingSafeEqual`, so a length
  mismatch cannot short-circuit the comparison.
- The cookie is read from the `Cookie` header by hand; there is no cookie-parser dependency.
- With auth disabled there is no gate (a warning is logged at boot), and `POST /auth/login` answers `ok`.
- `GET /auth/status` tells the client whether to show a login screen.
- Every `/auth/*` response, a successful login included, carries `cache-control: private, no-store`, so
  it is never cached or cross-served.
- Every API response, including the JSON `400` from `frameworkErrors` for a URL the router cannot decode (sent before any hook runs), carries `content-security-policy: default-src 'none'; frame-ancestors 'none'`,
  `x-content-type-options: nosniff`, `x-frame-options: DENY` and `referrer-policy: no-referrer`
  (`security-headers.ts`). The API serves JSON and file downloads (job artifacts), never a page, so its CSP allows nothing. The PWA's own CSP comes from
  SvelteKit (the `csp` option of the `sveltekit()` plugin in `packages/web/vite.config.ts`), with a nonce for its inline start-up script.
- The PWA's `handle` hook (`packages/web/src/hooks.server.ts`) adds `ws://<host> wss://<host>` for the
  request's own host to `connect-src`, so Safari before 15.4, which does not count a same-origin socket as
  `'self'`, can still open the job status socket. That `csp` option is fixed at build time and cannot name the host,
  hence the hook. A host that is not a plain name or IPv4 address with an optional port leaves the policy at
  `'self'`.
- Failed logins are limited per client (`login-limit.ts`): after 5 wrong passwords within a minute, every
  login, the right password included, answers `429` with `Retry-After` until that minute has passed. A
  successful login clears the client's count. The limiter is in memory, keeps at most 10,000 clients (the
  oldest is dropped first), and resets when the api restarts.
- The client is `clientKey(req.ip)` (`trusted-proxies.ts`): an IPv4 address as is, an IPv4-mapped IPv6
  address as its IPv4, and any other IPv6 address as its /64. `req.ip` is the socket peer, unless the peer is
  in `CONVEYOR_TRUSTED_PROXIES`, which `index.ts` passes to Fastify's `trustProxy`; then it is the client
  that proxy reports in `X-Forwarded-For`. The setting is parsed strictly at boot (IPs or CIDRs, an invalid
  entry exits 1), and unset trusts nothing. Compose trusts Caddy's fixed address only.

## Catalog and history (`routes/catalog.ts`, `routes/catalog-content.ts`)

- These routes are the whole configuration surface: printers, profiles and the job history. A job names a
  printer and a profile directly, so there is no saved pairing to curate.
- Printer `secrets` are accepted on write and never returned on read; reads return `hasSecrets` instead.
  Omitting `secrets` on a write keeps the stored value (see `dbUpsertPrinter`).
- `allowedGenerators`: omit it for no restriction; `[]` allows nothing.
- Every catalog write is parsed by the schemas in `catalog-validation.ts` and the content schemas in
  `routes/catalog-content.ts`. A rejected write answers `400 { error }` naming each field, e.g.
  `gcodeFlavor: unknown gcode flavor` or `allowedGenerators.1: unknown generator`. Profiles: `slicerId` must be
  a registered slicer and `gcodeFlavor` one a registered transport accepts. Printers: `transportId` must be a
  registered transport, every `allowedGenerators` entry a registered generator, and `secrets` at most 16
  entries with names up to 64 and values up to 4096 characters.
- `DELETE /catalog/printers/:id` and `DELETE /catalog/profiles/:id` answer `404` for an unknown id, and `409`
  while a queued or running job names the row or when the profile is bundled ([DATA-MODEL.md](../DATA-MODEL.md)).
  `index.ts` hands the catalog routes the queue mode's `countLiveJobs` (`routes/jobs.ts` scans BullMQ,
  `routes/jobs-sqlite.ts` counts `jobs` rows), so both modes refuse the same deletes.
- `GET /jobs-history` and `GET /jobs-history/:id` show finished jobs only (done, failed, canceled); the detail
  route returns 404 for an in-flight or unknown id. On the Redis queue only finished jobs have a row; on the
  SQLite queue every job has one from the moment it is enqueued, so both routes filter by state.
- `GET /jobs-history` lists newest-finished first (`updatedAt`, then `id`, both descending). Its query is
  parsed with zod (`history-query.ts`), and a bad value is a 400 naming the field:
  - `limit`: 1 to 200, default 50. A value that is not a positive whole number reads as 50, and a larger one as
    200, as before.
  - `before=<updatedAt>:<id>`: the cursor, built from the last job of the previous page. A page holds only jobs
    that finished before it, so jobs that finish while someone pages back go to the front, never into a later
    page.
  - `state` (`done`, `failed` or `canceled`), `printerId`, and `since` / `until` in epoch ms on `updatedAt`
    (`since` inclusive, `until` exclusive).
- `GET /jobs-history/counts` takes `printerId`, `since` and `until` and answers `{ done, failed, canceled }`
  for the filter pills. Both modes share these routes, since both keep finished jobs in the SQLite `jobs` table.
  The static `counts` path wins over `/jobs-history/:id`; job ids are UUIDs, so none is called `counts`.
- `GET /catalog/printers/:id/reachable` returns 404 for an unknown printer, otherwise 200 with the probe result.
  `reachable: false` is a successful probe of an offline printer, not an error. Every probe stamps the printer's
  `lastCheckedAt`, and a reachable one also stamps `lastSeenAt`. `GET /catalog/printers` returns both, so a
  printer that was seen and then failed a probe shows how long it has been offline. Probing stays on demand:
  nothing probes on a timer.
- A busy printer's time left is not a printer field. It is `print.secondsLeft` on the printer's active job's
  latest `printing` event.
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
- `uploadSettings` in `@conveyor/shared/uploads` parses `UPLOAD_DIR`, `DATA_DIR` and `MAX_UPLOAD_BYTES` for the api,
  the worker and passthrough. `MAX_UPLOAD_BYTES` must be a positive integer: the api and worker exit 1 at
  boot on anything else. `POST /jobs` reports an upload it cannot read as `upload <id> could not be read`
  and logs the cause on the server only.

## Registry (`registry.ts`, `validate.ts`, `routes/generators.ts`)

- `apiRegistry` is `buildRegistry()` from `@conveyor/plugin-registry`, the same plugin objects the worker
  runs. The api reads their capabilities, schemas and metadata, and never calls `generate`, `slice`,
  `submit`, `status` or `cancel`; the engines those would spawn are only in the worker image.
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

- It sits under `/catalog`, beside the other printer routes. The browser calls it as `/api/catalog/…`, like
  every API route.
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
