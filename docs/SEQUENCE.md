# Conveyor — Job Sequence

How one job travels `Generate → Slice → Transport`, and how live status flows back to the PWA.

## Participants

- **PWA** — SvelteKit client on the user's phone/browser.
- **API** — REST + WebSocket front door (Fastify/Hono).
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
    PWA->>API: POST /jobs {generator,params,stationId}
    API->>API: resolve Station → {slicer,profile,printer}
    API->>API: validateJob() capability check
    API->>R: enqueue job
    API-->>PWA: 202 {jobId}
    PWA->>API: WS subscribe /jobs/{jobId}
    Note over API,R: API relays Redis pub/sub → WS frames

    R->>W: deliver job
    W->>R: publish state=generating
    R-->>API-->>PWA: generating
    W->>G: generate(params)
    G->>G: openscad -o model.stl -D '…'
    G-->>W: ModelArtifact (/data/<job>.stl)

    W->>R: publish state=slicing
    R-->>API-->>PWA: slicing
    W->>S: slice(model, profileId)
    S->>S: xvfb-run orca-slicer --slice … --output gcode
    S-->>W: GcodeArtifact (/data/<job>.gcode)
    Note over PWA: optional: swap EXACT stl into viewport

    W->>R: publish state=transferring
    R-->>API-->>PWA: transferring
    W->>T: submit(gcode, printerTarget)
    T->>P: upload gcode + start
    T-->>W: PrintHandle

    W->>T: status(handle)
    loop until terminal
        P-->>T: progress
        T-->>W: PrintStatus{printing, progress}
        W->>R: publish state=printing, progress
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
    W->>R: publish state=failed {stage,reason}
    R-->>API-->>PWA: failed ❌ (which stage + why)
    W->>W: cleanup partial /data artifacts
    end

    rect rgb(225,235,245)
    Note over PWA,W: User cancels
    PWA->>API: POST /jobs/{id}/cancel
    API->>R: signal cancel
    alt job still queued
        R->>R: remove from queue
    else job running
        R->>W: cancel flag
        W->>X: transport.cancel(handle) / kill subprocess
        W->>R: publish state=canceled
    end
    R-->>API-->>PWA: canceled
    end
```

## Notes

- **State is the contract.** Every transition (`queued → generating → slicing → transferring → printing → done|failed|canceled`) is one Redis pub/sub message the API forwards verbatim to the WS. The PWA is a pure projection of job state — refresh-safe and reconnect-safe (it re-fetches `GET /jobs/{id}` on reconnect).
- **Artifacts live on the shared `/data` volume.** Stages pass `Artifact{path,format}` handles, not bytes, so nothing large crosses a process boundary.
- **Secrets never reach the client.** Printer API keys live in `PrinterTarget.secrets`, resolved server-side from the Station; the PWA only ever knows a `stationId`.
- **Capability check is pre-flight.** `validateJob()` runs in the API before enqueue, so an incompatible generator/slicer/transport combo fails fast with a 4xx instead of dying mid-pipeline.
