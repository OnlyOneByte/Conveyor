# packages/api

The REST and WebSocket front door. It validates requests, serves the catalog and history, and enqueues jobs.
It never runs a plugin's `generate()`, `slice()` or `submit()`: those run only in the worker
([ADR 0001](../adr/0001-plugin-isolation.md)).

## Boot order (`index.ts`)

`index.ts` registers `GET /health` first, then the auth guard (a root `onRequest` hook), then the login routes it
lets through, then the generator, upload, catalog and job routes. The guard covers every route registered after
it. `/health` comes before it and is public by design: it is also in `PUBLIC_PREFIXES`.

## Auth (`auth.ts`, `routes/auth.ts`)

- One tier only: the password grants the whole app, catalog included. Session cookies minted by the former
  two-tier scheme still carry a role field; verification ignores it rather than invalidating the cookie.
- The session token is `base64url(payload).hmac`. The payload's only claim is `exp`, epoch milliseconds.
- Password and signature checks compare fixed-length SHA-256 digests with `timingSafeEqual`, so a length
  mismatch cannot short-circuit the comparison.
- The cookie is read from the `Cookie` header by hand; there is no cookie-parser dependency.
- The public paths live in one list, `PUBLIC_PREFIXES` (`/health`, `/auth/*`), so a new route cannot fall
  outside the protected tree by accident. Everything else needs a valid session.
- With auth disabled there is no gate (a warning is logged at boot), and `POST /auth/login` answers `ok`.
- `GET /auth/status` tells the client whether to show a login screen.
- A successful login sets `cache-control: private, no-store` so the gated response is never cached or
  cross-served.

## Catalog and history (`routes/catalog.ts`)

- These routes are the whole configuration surface: printers, profiles and the job history. A job names a
  printer and a profile directly, so there is no saved pairing to curate.
- Printer `secrets` are accepted on write and never returned on read; reads return `hasSecrets` instead.
  Omitting `secrets` on a write keeps the stored value (see `dbUpsertPrinter`).
- `allowedGenerators`: omit it for no restriction; `[]` allows nothing.
- `GET /jobs-history/:id` returns 404 for an in-flight or unknown id: only terminal jobs have a durable row.
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

## Artifact downloads (`artifact-download.ts`)

- The worker writes each job's artifacts under `${DATA_DIR}/<jobId>/`. The API resolves the same root;
  both default to `/data` and are overridden together with `DATA_DIR`.
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
- Accepted addresses: `http(s)://host:port/path`, `host:port`, `[ipv6]:port` and a bare host. Without a port,
  an `https` URL uses 443; otherwise the transport default applies (Moonraker 80 for its HTTP API, Elegoo
  3030 for SDCP), then 80.
- `parseAddress` returns `null` instead of throwing; `probePrinter` then reports `unparseable address`.
  `probePrinter` always resolves, with `latencyMs` on success and the socket error code or `timeout` as
  `reason` on failure.

## Redis (`queue.ts`)

Two connections: `connection`, with `maxRetriesPerRequest: null` as BullMQ requires for blocking commands,
and `redis`, a plain client for snapshot reads and pub/sub fan-out.

## Image (`Dockerfile`)

The API image carries no engines; bun runs the TypeScript entrypoint directly. `bun install --frozen-lockfile`
validates the whole workspace against `bun.lock`, so the deps stage copies every workspace member's
`package.json`, including ones the API never imports, or bun reports "lockfile had changes" and aborts.
