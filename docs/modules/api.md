# packages/api

The REST and WebSocket front door. It validates requests, serves the catalog and history, and enqueues jobs.
It never runs a plugin's `generate()`, `slice()` or `submit()`: those run only in the worker
([ADR 0001](../adr/0001-plugin-isolation.md)).

The routes on this page are the api's own paths. Browsers and scripts reach them through Caddy under `/api`, which
Caddy strips: `GET /jobs/active` here is `https://<host>/api/jobs/active` from outside.

## Boot order (`index.ts`)

`index.ts` registers `GET /health`, the Origin guard, the auth guard, the login routes, `GET /health/deep` (`routes/health.ts`,
which needs a session), then the generator, upload and catalog routes, the printer-hold route, the job routes
and `GET /metrics`. It listens on `CONVEYOR_HOST`, which defaults to `127.0.0.1`. Both guards are global `onRequest` hooks: they apply to every route, whatever order routes are
registered in. The Origin guard (`registerOriginGuard`) runs first, with auth on or off. It answers a
`req.host` (the `Host` header, or `X-Forwarded-Host` from a trusted proxy) that isn't on the allowlist
(`allowed-hosts.ts`: `localhost`, `127.0.0.1`, `[::1]`, `CONVEYOR_DOMAIN` and `CONVEYOR_ALLOWED_HOSTS`,
compared by host name, without the port) with `421` and an error that names `CONVEYOR_ALLOWED_HOSTS`,
against DNS rebinding. `index.ts` parses the list at startup. Both variables take Caddy's forms: an
`http://` or `https://` prefix and a port are dropped, `:80` or `:443` adds no name, and `*.example.com`
allows any name that ends in `.example.com` (at least one label in front), unless `example.com` is a public or shared zone (`public-suffix.ts`: any single label, a `co`/`com`/`net`/`org`-style second level under a two-letter country code such as `co.uk`, and a built-in list of hosting and dynamic-DNS zones such as `duckdns.org` and `github.io`), which stops startup. An entry that is none of these
stops startup with a message naming the variable and the fix. The guard then refuses a
cross-origin write (`origin.ts`, `isCrossOriginWrite`) with `403 cross-origin request refused`, public
routes included: a method other than `GET`, `HEAD` or `OPTIONS`, or a WebSocket upgrade, whose
`Sec-Fetch-Site` is neither `same-origin` nor `none`, or whose `Origin` is opaque, unparseable, not
`http` or `https`, or has another host and port than `req.host`. A write with no `Origin` and no
`Sec-Fetch-Site` is not a browser's and goes on. The auth guard (`registerAuthGuard`) is registered only
with auth on. A route is public only when it opts in with `PUBLIC_ROUTE` (`{ config: { public: true } }`),
read from the matched route's config: today `/health`, `/auth/status`, `/auth/login` and `/auth/logout`.
Everything else needs a valid session, including a path no route matches and any new route under `/auth/`
that does not opt in. A 401 for an upload body (multipart, chunked, or over 1 MiB) carries
`Connection: close`, and the api closes the socket once it is sent, so an unauthenticated client can't keep
trickling one (`routes/close-after.ts`). A 401 for a small JSON body keeps the connection for reuse.
`routes/auth-guard.test.ts` boots the real `index.ts` with auth on and checks that every mutating route
answers `401` without a session. `routes/auth-guard-sqlite.test.ts` does the same in `CONVEYOR_QUEUE=sqlite`
mode for every job route, the WebSocket upgrade and the history routes.

The job routes depend on the queue. `index.ts` reads `CONVEYOR_QUEUE` through `queueMode` from
`@conveyor/shared`, exits with code 1 on a bad value, and imports `routes/jobs.ts` (Redis) or
`routes/jobs-sqlite.ts` (SQLite). Both register the same paths. The import is dynamic, so in `sqlite` mode
`queue.ts` is never loaded and the api opens no Redis connection.

### Stopping (`shutdown.ts`)

`closeOnSignals` handles SIGTERM and SIGINT: it calls `app.close()` and exits `0` once that finishes, or `1`
if it fails or is still running after `CLOSE_DEADLINE_MS` (3 s). A second signal while closing exits `1` at once.
The api runs as PID 1 in its container, and PID 1 gets no default signal handling, so without this handler
`docker compose stop` waited its full 10 s and then killed it. Closing runs `closeSocketsRestarting`, the
WebSocket plugin's `preClose`: every open job socket is sent a close with `1012`
(`JOB_STREAM_CLOSE.restarting`). It does not wait for clients to answer the close, and nothing else waits on
them: a client that never answers doesn't hold the shutdown. It uses `1012`, not `1001`, because Bun sends a
server's `1001` as `1000`, which a client would read as `job finished`. `shutdown-boot.test.ts` boots
`index.ts` and checks SIGTERM exits `0` within 2 s, both with a browser-style job socket (which gets `1012`)
and with a raw upgraded socket that never answers.

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
| `1012` | `server restarting` | the api got SIGTERM or SIGINT and is shutting down; reconnect later |

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
  the print together. `withEstimates` looks this up once per generator and printer pair, not once per job.
- `startsAt` (epoch ms), for a `queued` job: when it should start printing, that is, take the printer. Each
  printer's queue is walked in `createdAt` order. The printer is free when its printing job's `print.secondsLeft`
  runs out (from the event's `at`), or after a running job's remaining model, slicing and typical `transport`.
  A queued job's model and slicing run meanwhile, but only once the job ahead of it has taken the
  printer, so it starts at the later of the printer being free and its own preparation being done. Each job ahead then holds the printer for its typical
  `transport`. Once a step is unknown, the jobs behind it get no `startsAt`, and a held printer
  (`printers.hold_job_id`, read by `heldPrinterIds` in both queue modes) gives none to its whole queue.
- On Redis the printer and generator come from the BullMQ job; if that read fails, estimates are left out.

## Job routes on the Redis queue (`routes/jobs.ts`)

`GET /jobs/active` reads the `jobs:active` set and returns each member's snapshot, newest event first. The
set is only an index and the snapshot is the truth: a member whose snapshot is gone or already terminal (a
worker that died mid-job) is left out of the answer and removed from the set, so the set heals itself. A
failed removal never fails the read. Fastify's router matches the literal `/jobs/active` before the
parametric `/jobs/:id` regardless of registration order, so a literal `/jobs/<word>` route needs no special
ordering, and `/jobs/:id` answers `404` for any id that is not a UUID.

`GET /jobs/:id` returns the job's current snapshot. The PWA reads it when it opens a job's status, next to
the WebSocket, and again before it reopens a closed one.

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
`retryOf:`, and nothing is queued. `routes/submit.ts` then claims the failure in one `UPDATE` that sets
`retried_by` only while it is `failed` and unclaimed (`dbClaimRetry`). A lost claim answers `409
{ error, retriedBy }` and queues nothing, so a double-clicked Retry prints once. `error` is
`retryOf: job <id> was already retried`, and `retriedBy` is the id of the retry that holds the claim
(`dbRetriedBy`), or `null` if it can't be read. On Make, `sendJob` turns the 409 into `AlreadyRetried` ("This job
was already retried."), and Make links to that retry with "See the retry" at `/jobs/<retriedBy>`. A claimed
failure leaves `GET /jobs/needs-you` at once, without a dismissal.

What happens to a claim when queueing the retry fails depends on the queue:

| Queue | Function | A queueing error |
| --- | --- | --- |
| SQLite | `submitJobInTransaction` | Claim and enqueue run in one `IMMEDIATE` transaction, so the error rolls the claim back and the failure stays in Needs-you. |
| Redis | `submitJob` | The claim is kept. BullMQ's `add` can fail after it stored the job, so releasing on any error could let a second retry print twice. The worker's reaper releases the claim only once the retry is missing from both SQLite and BullMQ on two sweeps in a row (#383, see [worker.md](worker.md#redis-reaperts)). |

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

The job page (`followJob` in `packages/web/src/lib/job-live.ts`) reconnects after a `1013`, and after any
other close but `1000` or `4404`, backing off from 0.5 s to 30 s (`RETRY_MS`); each new socket starts from a
fresh snapshot, so nothing is missed. `GET /jobs/active` skips, and logs, a row that does not parse, so one bad
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
- `script-src` never allows `'unsafe-eval'`. Zod probes `new Function` once to decide whether to JIT its
  parsers, and the CSP logs that probe as a violation, so Settings and the profile editor import only
  `@conveyor/shared/profile`, which has no Zod in it.
- Failed logins are limited per client (`login-limit.ts`): after 5 wrong passwords within a minute, every
  login, the right password included, answers `429` with `Retry-After` until that minute has passed. A
  successful login clears the client's count. On top of that, 100 failures within a minute from all clients
  together make every login answer `429` until that minute has passed; a successful login does not clear
  that count. The limiter is in memory, keeps at most 10,000 clients (the oldest is dropped first), and
  resets when the api restarts.
- The client is `clientKey(req.ip)` (`trusted-proxies.ts`): an IPv4 address as is, an IPv4-mapped IPv6
  address as its IPv4, and any other IPv6 address as its /64. `req.ip` is the socket peer, unless the peer is
  in `CONVEYOR_TRUSTED_PROXIES`, which `index.ts` passes to Fastify's `trustProxy`; then it is the client
  that proxy reports in `X-Forwarded-For`. The setting is parsed strictly at boot (IPs or CIDRs, an invalid
  entry exits 1), and unset trusts nothing. Compose trusts Caddy's fixed address only.

## Catalog and history (`routes/catalog.ts`, `routes/catalog-content.ts`)

- These routes are the whole configuration surface: printers, profiles and the job history. A job names a
  printer and a profile directly, so there is no saved pairing to curate.
- Printer `secrets` are accepted on write and never returned on read; reads return `hasSecrets` instead,
  and a write answers only `{ ok: true }`.
- A write's `secrets` is a patch, merged per key into what is stored (`dbUpsertPrinter`): a string sets that
  key, `null` removes it, and keys it leaves out are kept. Omitting `secrets`, or sending `{}`, keeps them
  all. So the printer form can save an API key without erasing an Elegoo `mainboardId` (#412).
  - `secrets: null` clears every stored secret, including keys whose names you don't know (reads never
    return names). The printer form's **Clear saved secrets** sends it (#417).
  - A write that changes the `address` or `transportId` of a printer with stored secrets answers `409`
    unless it sends the secrets again or `secrets: null`, and nothing in it is saved. Secrets sent with
    such a move replace the stored set instead of merging into it, so no stored key reaches the new host
    (#663).
  - A refused write's body is `{ error, field? }`. `field` names the input to fix: `id`, `name`, `address`,
    `transport` or `secrets` (schema issues by their first path, a refused address as `address`, and every
    secrets refusal, the `409`s included, as `secrets`). A schema issue on `allowedGenerators` has none. The
    printer form moves focus to that input, or to the error message when there is no `field` (#669).
  - The 16-secret limit counts the merged result. A write that would pass it answers `400`, and nothing in it
    is stored.
  - A printer whose stored secrets don't decrypt can't be patched: the write answers `409` and changes
    nothing. `secrets: null` still works, so clear them and enter them again. Deleting the printer and adding
    it again works too, but a delete answers `409` while the printer has queued or running jobs.
  - Merging happens inside one `IMMEDIATE` transaction, so concurrent writes to the same printer each keep
    their keys; `printer-secrets-concurrency.test.ts` runs eight writer processes against one database.
- `allowedGenerators`: omit it for no restriction; `[]` allows nothing.
- Every catalog write is parsed by the schemas in `catalog-validation.ts` and the content schemas in
  `routes/catalog-content.ts`. A rejected write answers `400 { error }` naming each field, e.g.
  `gcodeFlavor: unknown gcode flavor` or `allowedGenerators.1: unknown generator`. Profiles: `slicerId` must be
  a registered slicer and `gcodeFlavor` one a registered transport accepts. Printers: `transportId` must be a
  registered transport, every `allowedGenerators` entry a registered generator, and `secrets` at most 16
  entries with names up to 64 and values up to 4096 characters (each value may be `null`), or `null` itself.
- `DELETE /catalog/printers/:id` and `DELETE /catalog/profiles/:id` answer `404` for an unknown id, and `409`
  while a queued or running job names the row or when the profile is bundled ([DATA-MODEL.md](../DATA-MODEL.md)).
  `index.ts` hands the catalog routes the queue mode's `countLiveJobs` (`routes/jobs.ts` scans BullMQ,
  `routes/jobs-sqlite.ts` counts `jobs` rows), so both modes refuse the same deletes.
- `GET /jobs-history` and `GET /jobs-history/:id` show finished jobs only (done, failed, canceled); the detail
  route returns 404 for an in-flight or unknown id. On the Redis queue only finished jobs have a row; on the
  SQLite queue every job has one from the moment it is enqueued, so both routes filter by state.
- A job whose stored params, error or timings don't parse, or have the wrong shape, is still answered, without that field and with
  `unreadable` naming it (`"unreadable": ["params"]`), instead of failing the whole list with a 500 (#400; see
  [shared.md](shared.md#jobs)).
- `GET /jobs-history` lists newest-finished first (`updatedAt`, then `id`, both descending). Its query is
  parsed with zod (`history-query.ts`), and a bad value is a 400 naming the field:
  - `limit`: 1 to 200, default 50. A value that is not a positive whole number reads as 50, and a larger one as
    200, as before.
  - `before=<updatedAt>:<id>`: the cursor, built from the last job of the previous page. A page holds only jobs
    ordered before it by `(updatedAt, id)`, so a job that finishes while someone pages back normally goes to the
    front. Two cases can still land in a later page: a job that finishes in the same millisecond as the cursor's
    `updatedAt` with a smaller id, and a job stamped after the host's clock stepped backwards.
  - `state` (`done`, `failed` or `canceled`), `printerId`, and `since` / `until` in epoch ms on `updatedAt`
    (`since` inclusive, `until` exclusive).
- `GET /jobs-history/counts` takes `printerId`, `since` and `until` and answers `{ done, failed, canceled }`
  for the filter pills. Both modes share these routes, since both keep finished jobs in the SQLite `jobs` table.
  The static `counts` path wins over `/jobs-history/:id`; job ids are UUIDs, so none is called `counts`.
- `GET /catalog/printers/:id/reachable` returns 404 for an unknown printer, 400 when `checkPrinterAddress`
  refuses its address (as `PUT /catalog/printers` does), otherwise 200 with the probe result. The probe
  (`printer-probe.ts`) reads the host and port with `hostPortOf` from `@conveyor/shared/address`. That is the
  same step the save-time address check and both transports use. So every documented form (`host:port`,
  `http(s)://…`, `//host/path`, `user:pass@host[/path]`) is probed at the host the worker would connect to.
  `reachable: false` is a successful probe of an offline printer, not an error. Every probe stamps the printer's
  `lastCheckedAt`, and a reachable one also stamps `lastSeenAt`. `GET /catalog/printers` returns both, so a
  printer that was seen and then failed a probe shows how long it has been offline. Probing stays on demand:
  nothing probes on a timer.
- A busy printer's time left is not a printer field. It is `print.secondsLeft` on the printer's active job's
  latest `printing` event.
- `GET /catalog/transports` feeds the printer form's transport picker; Settings also reads each transport's
  `acceptsFlavors` for the profile form's firmware picker.
- `GET /catalog/slicers` lists the registered slicers as `{ id, name }` for the profile form.
- `GET /catalog/profiles` marks each profile `bundled: true` when it ships in `DEFAULT_PROFILES`; those are the
  ones `DELETE` refuses with `409`, so Settings offers no Delete for them. `PUT /catalog/profiles` also answers
  `409` when it would change a bundled profile's `name`, `slicerId`, `path` or `gcodeFlavor`; sending the same
  values back is a no-op `200`.
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
`GET /jobs/:id/artifact/:kind`, described below. `logSubmitted` and `logCancel` (`routes/submit.ts`) log
`job queued` and `job cancel requested` with the `jobId`, in both queue modes, so a job can be followed from
the api's log into the worker's.

## Artifact downloads (`artifact-download.ts`)

- The worker writes each job's artifacts under `${DATA_DIR}/<jobId>/`. The API resolves the same root, read
  on each request; both default to `/data` and are overridden together with `DATA_DIR`.
- The artifact path comes from the job's own durable record, never from the request: the request supplies only
  the job id and the fixed `model | gcode | log` kind. `log` is the job's `engine.log`, at the fixed name
  `${DATA_DIR}/<jobId>/engine.log` (`engineLogPath`), and is served as `text/plain` only once the job has
  settled; a running job's log answers 404. `GET /jobs-history/:id`
  adds `artifacts.log` when that file exists, which is how the job page knows to offer it.
- After `realpath` (of the root too, so a symlinked `DATA_DIR` compares correctly), the file must sit under
  the job's own directory and still exist. A recorded file that is gone, or a reaped work directory, is 410;
  an unknown job, a missing record or an escaping path is 404.

## Uploads (`routes/uploads.ts`)

- `POST /uploads` stores STL bytes at `${UPLOAD_DIR}/<uploadId>.stl` (default `${DATA_DIR}/uploads`) on the
  shared volume, where the worker's passthrough generator reads them. The client submits the returned
  `uploadId` as the passthrough generator's `params.uploadId`.
- The bytes are never treated as code; they go to the slicer as-is. The upload is streamed straight to
  `<uploadId>.stl.part`, never held in memory whole; only its first 4 KiB and its length are kept for the
  checks below. Anything that fails a check is removed before the reply:
  - **Size cap:** `MAX_UPLOAD_BYTES`, default 100 MiB. Only the multipart size-limit error is a 413.
  - **Folder cap:** with `CONVEYOR_UPLOADS_MAX_BYTES` set, the stored and in-progress files the API created
    (`<uuid>.stl` and `<uuid>.stl.part`, `routes/uploads-folder.ts`) may total at most that many bytes. An upload
    whose bytes would pass it gets `507` and `the uploads folder is full (CONVEYOR_UPLOADS_MAX_BYTES)…`: at once
    when the folder is already full, while streaming once its own bytes pass the room left (with
    `Connection: close`), and in a last check of the whole folder, other uploads' parts included, just before the
    rename. So concurrent uploads can't store more than the cap; when two finish together over it, both may be
    refused. Other files in the folder don't count. Unset, there is no folder cap.
  - **Extension:** the file must end in `.stl`, otherwise 415.
  - **Complete body:** a multipart body that breaks off is a 400: "the upload didn't finish. Try again."
  - **Time limits:** an upload that sends no bytes for `UPLOAD_IDLE_TIMEOUT_MS` (default 30 s), or isn't
    finished within `UPLOAD_TIMEOUT_MS`, is cut off with a 408: "the upload took too long. Try again on a
    faster connection." The reply carries `Connection: close`, and the api closes the socket once it is sent,
    so a client trickling a byte at a time can't hold a connection or a `.part` file. The overall default is
    one minute plus `MAX_UPLOAD_BYTES` at 64 KiB a second, about 27 minutes for 100 MiB. One per-request
    timer covers both the wait for the file part and the file's bytes, and is cleared when the request ends
    (`routes/upload-timer.ts`). Behind Caddy, a client on plain HTTP/1.1 sees the 408 (or a 401) only
    after about 60 s, because Caddy holds the response while the client is still sending. The api has
    already closed its side by then. Over HTTP/2, which the shipped TLS site and browsers use, the reply
    arrives at once.
  - **Not empty:** an empty file is a 400: "the file is empty."
  - **Looks like an STL** (`routes/stl-check.ts`): either binary, with at least one triangle and exactly
    `84 + 50 × triangles` bytes, or ASCII, starting with `solid` (after an optional UTF-8 byte-order mark) and
    naming a `facet` in its first 4 KiB. Anything else is a 400: "the file
    isn't an STL model."
  - **Server faults:** a failed write, or any read error that isn't the client's, goes to the error handler
    as a 500.
- Once every check passes, the `.part` file is renamed to `<uploadId>.stl` in the same folder. A
  write that fails, for example on a full disk, removes the `.part` file, so no partial upload is ever left
  under an id. The default writer opens the `.part` before reading any bytes and writes through that open
  file, so a client that drops before the open finishes can't leave an empty `.part` behind the clean-up.
  If removing the `.part` fails too, the 500 is thrown with the write's own error as its `cause`.
  A `.part` left by a crash is removed by the worker's retention reaper once it is over an hour old.
- `uploadSettings` in `@conveyor/shared/uploads` parses `UPLOAD_DIR`, `DATA_DIR`, `MAX_UPLOAD_BYTES`,
  `UPLOAD_IDLE_TIMEOUT_MS` and `UPLOAD_TIMEOUT_MS` for the api, the worker and passthrough. The last three
  must be positive integers: the api and worker exit 1 at boot on anything else. `POST /jobs` reports an upload it cannot read as `upload <id> could not be read`
  and logs the cause on the server only.

## Registry (`registry.ts`, `validate.ts`, `routes/generators.ts`)

- `apiRegistry` is `buildRegistry()` from `@conveyor/plugin-registry`, the same plugin objects the worker
  runs. The api reads their capabilities, schemas and metadata, and never calls `generate`, `slice`,
  `submit`, `status` or `cancel`; the engines those would spawn are only in the worker image.
- `GET /generators` serves each generator's `paramSchema`, UI hints and preview module so the web app can
  render its form.
- `validateJobRequest` runs the shared capability check against this view.
- `printerSchema` (`catalog-validation.ts`) rejects an unknown `transportId` when a printer is written, so a
  typo cannot persist and fail much later, at job submit, as an unrelated-looking compatibility error.

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

`POST /catalog/printers/:id/release` clears a printer hold. A hold is set whenever the printer may still have a
job Conveyor lost track of: a submit that may have started, a stop the printer didn't confirm, a resume that
failed, a job settled during upload, or a worker that stopped between the submit intent and the submit marker
(see [shared.md](shared.md#queueholdts)). No job is
prepared for a held printer until someone checks the printer and releases it. `POST /jobs` refuses a new job for
a held printer with a `409`; a job that passed that check before the hold was set waits queued in either queue
mode until the release ([worker.md](worker.md#indexts)).

- It sits under `/catalog`, beside the other printer routes. The browser calls it as `/api/catalog/…`, like
  every API route.
- The body must be exactly `{ "confirm": true }`. Anything else is a `400`, so a stray or replayed request
  cannot release a hold.
- `404` for an unknown printer, `409` when the printer has no hold, and `{ ok: true, printerId }` once the hold
  is cleared.
- It is a mutating route behind the same global auth guard as every other non-public route. It is not a
  public path, so without a session it gets `401`; `routes/auth-guard.test.ts` checks this on a booted api.

## Redis (`queue.ts`)

Three clients. `connection` backs the BullMQ `Queue`, and `redis` serves snapshot reads and cancel writes.
Both fail fast: no offline queue, no retries, and nothing re-sent after a reconnect (`enableOfflineQueue: false`,
`maxRetriesPerRequest: 0`, `autoResendUnfulfilledCommands: false`), so a command written while Redis is down is
refused at once instead of being sent later. Both also have `socketTimeout: SOCKET_TIMEOUT_MS` (3 s): a socket
that has a command waiting and receives nothing for 3 s is torn down and reconnected. Without it, a reconnect
that lands while Redis is shutting down can be accepted and then never answered, and the client sits in its
handshake for good, so every submit is 503 until the api restarts. `routes/redis-restart-boot.test.ts`
reproduces that with a proxy that drops every connection, then accepts and ignores the next ones for 0.5 s,
and checks submits are accepted again after each of three restarts. `redis` also has
`commandTimeout: QUEUE_DEADLINE_MS` (2 s). The
api never blocks on the queue, so `connection` doesn't need BullMQ's `maxRetriesPerRequest: null`, which is
for workers. `createSubscriber` makes the status hub's subscriber, which keeps ioredis' defaults so it
resubscribes after a reconnect.

### When Redis can't be reached (`queue-reach.ts`, `error-replies.ts`)

Every BullMQ call a request makes (`add`, `getJob`, `getJobs`, and the whole cancel) runs under
`withinDeadline(..., QUEUE_DEADLINE_MS)`, which rejects with `QueueUnavailableError` when the queue gives no
answer in time. BullMQ calls can't take `commandTimeout`: a timeout during BullMQ's first-connect version
check would leave the `Queue` broken until a restart. `registerErrorReplies`, registered before any route,
maps `QueueUnavailableError`, ioredis' `MaxRetriesPerRequestError` (matched by name, since ioredis doesn't
export it) and its three can't-reach messages (`Command timed out`,
`Connection is closed.`, the offline-queue refusal) to `503 { "error": "queue unavailable" }`. Any other 5xx
becomes `500 { "error": "internal error" }` and the error is logged, never sent. A 4xx keeps Fastify's own
reply.

A `POST /jobs` whose `add` failed or ran out of time may still reach Redis later: a paused Redis runs the
command once it resumes. So the route answers 503 and, once the queue is up, removes the job and sets its
`job:<id>:cancel` flag on the same connection. The removal usually lands right after the `add`. The flag
covers a worker that took the job in between: the worker checks it before every stage and settles the job
`canceled` without making or printing anything. A retry's claim on the failed job is kept, and the worker's
reaper releases it if the retry never lands (see the table above). `routes/redis-down-boot.test.ts` boots the api with Redis refused, and
`routes/jobs-paused-redis.test.ts` pauses a real Redis across a submit (`CLIENT PAUSE WRITE`) and across
the job reads (`CLIENT PAUSE ALL`, which `commandTimeout` answers). `routes/jobs-queue-deadline.test.ts` gives
the routes a BullMQ queue that never answers and checks `GET /jobs/active`, `GET /jobs/:id`, cancel and
deleting a printer all answer within the deadline. When `connection` isn't `ready`, the cleanup waits for it
(`untilReady`, up to `DROP_WITHIN_MS`, 5 minutes) instead of skipping: an `add` whose reply was lost when the
socket dropped may already have run, and `autoResendUnfulfilledCommands: false` only rules out a second copy
being sent after the reconnect. A dropped command rejects with `MaxRetriesPerRequestError`, which is also a
503. `routes/redis-restart-boot.test.ts` passes an `add` through a proxy, drops Redis' reply and the
connection, and checks the job is gone and flagged once Redis is back. Each cleanup step that fails is
logged with the job id (`abandoned job remove failed`, `abandoned job cancel flag failed`), and so is a
connection that ends or stays down past the bound (`queue never came up to drop the job`), since that job may
still run. Known limit: if the api stops before the connection comes back, a landed `add` survives with no
flag.

## Image (`Dockerfile`)

The API image carries no engines; bun runs the TypeScript entrypoint directly. `bun install --frozen-lockfile`
validates the whole workspace against `bun.lock`, so the deps stage copies every workspace member's
`package.json`, including ones the API never imports, or bun reports "lockfile had changes" and aborts.
The image sets `CONVEYOR_HOST=0.0.0.0` so caddy can reach it over the compose network. The api's own default
is loopback, and the image publishes no port: caddy's publish, on `CONVEYOR_BIND`, is the boundary.

## Metrics (`routes/metrics.ts`, `metrics.ts`)

`GET /metrics` renders Prometheus text (`text/plain; version=0.0.4; charset=utf-8`, `cache-control: no-store`).
It does not opt in with `PUBLIC_ROUTE`, so it needs a session like every other route but `/health`,
`/auth/status`, `/auth/login` and `/auth/logout`. `renderMetrics` takes only counts and durations: `dbCountJobs`, `dbFailuresByStage`, the queue's
live counts (`liveJobCounts` from `routes/jobs.ts`, BullMQ `getJobCounts`, or from `routes/jobs-sqlite.ts`,
`dbLiveJobCounts`), the fresh heartbeats (`workerFresh`, the same rule `/health/deep` uses) and
`dbRecentStageDurations` (the timings of the last 500 done jobs). Those are a moving window, so they are
rendered as gauges, not a histogram: `conveyor_recent_stage_duration_seconds` at `percentile` 50 and 95
(nearest rank, `quantile`) and `conveyor_recent_stage_samples`. A label value that isn't a plain lowercase state or stage name renders as `unknown`, so
nothing read from a row can break the format. A failing live count answers 503.
