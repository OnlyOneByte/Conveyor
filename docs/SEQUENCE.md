# Conveyor — Job Sequence

How one job travels `Generate → Slice → Transport`, and how live status flows back to the PWA.

These diagrams show the default queue, `CONVEYOR_QUEUE=redis`. In SQLite mode the Redis lane is the `jobs` and
`job_events` tables: the worker claims a leased row, cancel sets `cancel_requested_at`, and the api polls
`job_events` for the WebSocket. See [architecture.md](architecture.md#queue-modes).

## Participants

- **PWA** — SvelteKit client on the user's phone/browser.
- **API** — REST + WebSocket front door (Fastify).
- **Redis** — BullMQ job queue + pub/sub status bus.
- **Worker** — pulls jobs, drives the three stages.
- **Generator / Slicer / Transport** — in-process plugin adapters (see `adr/0001-plugin-isolation.md`).
- **Engine** — the external tool each adapter wraps (OpenSCAD, Orca CLI, Moonraker HTTP).
- **Printer** — the physical device.

## Happy path

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant PWA
    participant API
    participant R as Redis (BullMQ)
    participant W as Worker
    participant G as Generator (OpenSCAD)
    participant S as Slicer (Orca+xvfb)
    participant T as Transport (Moonraker)
    participant P as Printer

    Note over PWA: Live preview is 100% client-side —<br/>procedural Three.js, no server round-trip
    U->>PWA: tweak params (grid, height, dividers…)
    PWA-->>PWA: rebuild preview geometry (sub-ms)

    U->>PWA: Print
    PWA->>API: POST /api/jobs {generator,params,printerId,profileId}
    API->>API: resolve pair → {transport,slicer,profile,printer}
    API->>API: validateJob() capability check
    API->>R: enqueue job
    API-->>PWA: 202 {jobId}
    PWA->>API: WS subscribe /api/jobs/{jobId}/ws
    Note over API,R: API relays Redis pub/sub → WS frames

    R->>W: deliver job
    W->>R: publish state=generating
    R-->>API-->>PWA: generating
    W->>G: generate(params)
    G->>G: openscad -o model.stl -D '…'
    G-->>W: ModelArtifact (/data/{jobId}/model.stl)

    W->>R: publish state=slicing
    R-->>API-->>PWA: slicing
    W->>S: slice(model, profileRef)
    S->>S: xvfb-run -a orca-slicer --slice 0 --outputdir … (plate_1.gcode → model.gcode)
    S-->>W: GcodeArtifact (/data/{jobId}/model.gcode)
    Note over PWA: optional: swap EXACT stl into viewport

    W->>R: publish state=transferring
    R-->>API-->>PWA: transferring
    W->>T: submit(gcode, printerTarget)
    T->>P: upload gcode + start
    T-->>W: reportUpload(bytesSent, bytesTotal), at most 4 a second
    W->>R: publish state=transferring, bytesSent, bytesTotal
    T-->>W: PrintHandle

    W->>T: status(handle)
    loop until terminal
        P-->>T: progress
        T-->>W: PrintStatus{printing, progress, print?}
        W->>R: publish state=printing, progress, print?
        R-->>API-->>PWA: printing 0.0 → 1.0
    end
    W->>R: publish state=done
    R-->>API-->>PWA: done ✅
```

## Failure / cancel

```mermaid
sequenceDiagram
    autonumber
    participant PWA
    participant API
    participant R as Redis
    participant W as Worker
    participant X as Stage plugin

    rect rgb(245,225,225)
    Note over W,X: Any stage throws
    W->>X: generate / slice / submit
    X-->>W: throw StageError(stage, reason)
    W->>W: remove /data/{jobId}, then record the failed job in SQLite
    W->>R: publish state=failed {stage,reason}
    R-->>API-->>PWA: failed ❌ (which stage + why)
    end

    rect rgb(225,235,245)
    Note over PWA,W: User cancels
    PWA->>API: POST /api/jobs/{id}/cancel
    alt already done / failed / canceled
        API-->>PWA: 200 {state} (no-op, terminal states are final)
    else job waiting / delayed / prioritized / waiting-children
        API->>R: SET job:{id}:cancel (durable) + PUBLISH job:{id}:control
        API->>R: remove from queue
        API->>R: publish state=canceled
        API-->>PWA: 200 {state: canceled}
    else job active
        API->>R: SET job:{id}:cancel (durable) + PUBLISH job:{id}:control
        API-->>PWA: 202 {state: canceling}
        R->>W: control message, or the flag at the next checkpoint
        W->>X: abort signal (kills engines, aborts upload and status polling)
        W->>X: transport.cancel(handle) when the job reached the transport stage
        W->>R: publish state=canceled
    end
    R-->>API-->>PWA: canceled
    end
```

### Cancel rules

- The cancel flag `job:<id>:cancel` is a Redis key with a 7-day TTL. The worker checks it right after it subscribes to the control channel, between stages, right after `submit()`, after every status event and every 2 s while printing. A cancel whose pub/sub message was lost still takes effect. Pub/sub is only the fast path.
- Completion wins. If the printer reports `done` before the cancel is processed, the job settles `done` and no stop is sent to the idle printer.
- Unknown ids return 404. Cancelling twice returns the same answer and does nothing more.
- If the printer refuses, times out or drops the stop request without acknowledging it, the job settles as `failed` with a reason that says the stop was not confirmed. That includes a cancel that interrupted `submit()`, because the start command may already have reached the printer. It is never recorded as `canceled` while the printer may still be printing.
- A print cancelled on the printer itself settles as `canceled`.
- A status stream that ends without `done`, `failed` or `canceled` settles `failed` with `connection lost before completion`. A dropped connection never looks like a finished print.
- A cancel that lands during the upload stops the transport before it sends the start command. The transport throws `PrintNotStartedError`, no stop is sent, and the job settles `canceled`.
- A `printing` event may carry `print: { layer?, layers?, secondsLeft? }`, copied from the transport's `PrintStatus.print`. Each field is there only when the printer reported it; nothing is estimated in the worker. The browser derives the finish time from the event's `at` plus `secondsLeft`. Other states never carry `print`. `parseStatusEvent` refuses an event whose `print` has a negative or fractional `layer`, a `layers` below 1, or a negative `secondsLeft`.
- Every status write goes through one Lua script (`PUBLISH_STATUS_SCRIPT` in `packages/shared/src/status.ts`) that refuses to replace a `done`, `failed` or `canceled` snapshot. A late progress event or a racing writer cannot reopen a finished job.

## Notes

- **State is the contract.** Every transition from `generating` on (`generating → slicing → transferring → printing → done|failed|canceled`) is one Redis pub/sub message the API forwards verbatim to the WS. A queued job has no snapshot until the worker publishes `generating`. The PWA is a pure projection of job state — refresh-safe and reconnect-safe (it re-fetches `GET /api/jobs/{id}` on reconnect).
- **Artifacts live on the shared `/data` volume.** Stages pass `Artifact{path,format}` handles, not bytes, so nothing large crosses a process boundary.
- **Secrets never reach the client.** Printer API keys live in `PrinterTarget.secrets`, resolved server-side from the printer row; the PWA only ever knows a `printerId`, and reads of the catalog strip secrets to a `hasSecrets` flag.
- **Capability check is pre-flight.** `validateJob()` runs in the API before enqueue, so an incompatible generator/slicer/transport combo fails fast with a 4xx instead of dying mid-pipeline.
