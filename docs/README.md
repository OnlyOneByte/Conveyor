# Conveyor docs

Every doc page is linked from here. Code carries no comments, so the why lives in these pages.

## Start here

| Page | For |
|---|---|
| [../AGENTS.md](../AGENTS.md) | Engineering rules for every contributor, human or agent |
| [contributing.md](contributing.md) | Setup, local checks and the PR flow |
| [review-rubric.md](review-rubric.md) | The adversarial reviewer's rubric and severity levels |
| [architecture.md](architecture.md) | The system as built today: services, packages, a job's trip |
| [self-hosting.md](self-hosting.md) | Install, upgrade, backup and troubleshooting |

## Reference

| Page | Covers |
|---|---|
| [../SPEC.md](../SPEC.md) | Product spec, vocabulary and milestones |
| [PLUGINS.md](PLUGINS.md) | Generator, Slicer and Transport contracts |
| [modules/plugins.md](modules/plugins.md) | Why the bundled plugins work the way they do: engine flags, protocol quirks, and the hardware runbooks for the unverified transports |
| [SEQUENCE.md](SEQUENCE.md) | A job's trip through the pipeline, with failure paths |
| [DATA-MODEL.md](DATA-MODEL.md) | SQLite, Redis and filesystem storage |
| [SLICER-PROFILES.md](SLICER-PROFILES.md) | How edited slicer profiles are validated |
| [modules/shared.md](modules/shared.md) | `packages/shared`: the why behind its types, validation and SQLite store |
| [modules/api.md](modules/api.md) | `packages/api`: auth, catalog, profile files, artifacts, uploads, probe |
| [modules/worker.md](modules/worker.md) | `packages/worker`: the worker image's engines, profile materialization and status bus |
| [archive/M1-WORKER-ENGINES.md](archive/M1-WORKER-ENGINES.md) | Historical: the M1 worker-engine verification log (2026-06-30), kept for reference |
| [archive/M2-TRANSPORTS.md](archive/M2-TRANSPORTS.md) | Historical: the M2 transport notes (2026-06-29); the runbooks now live in modules/plugins.md |
| [archive/ui-mockup.html](archive/ui-mockup.html) | Historical: the pre-M4 UI mockup, kept for reference. It links to an Admin screen for preset uploads, which never shipped |
| [../tools/visual/README.md](../tools/visual/README.md) | Screenshot and GIF capture for UI PRs |

## Decisions

Architecture decision records live in [adr/](adr/), numbered `NNNN-title.md`, each with context, decision and
consequences. A decision with real alternatives (a new dependency, a new pattern, a major upgrade, an
experiment) gets one. Take the next free number.

| ADR | Decision |
|---|---|
| [0001](adr/0001-plugin-isolation.md) | Plugins are in-process adapters; engines run out of process |
| [0002](adr/0002-dual-model-preview.md) | Procedural client preview plus an exact server model |
| [0003](adr/0003-visual-evidence.md) | Visual evidence captured automatically for UI pull requests |
| [0004](adr/0004-sqlite-job-queue.md) | A job queue in SQLite instead of BullMQ and Redis |
| [0005](adr/0005-belt-ui-track-rail.md) | The Belt UI: a Track rail of job chips on every page |

## Design docs

Proposals reviewed before any code lands. Once accepted, a design's decision is recorded as an ADR.

| Design | Status |
|---|---|
| [design/sqlite-queue.md](design/sqlite-queue.md) | Accepted, in progress: a job queue in SQLite behind `CONVEYOR_QUEUE=sqlite`; Redis is still the default (#5) |
| [design/track-ui.md](design/track-ui.md) | Accepted, not started: the UI rewrite's tokens, IA and Track rail, with [a mockup](design/track-mockup.html) (#49) |

## Keeping docs true

[audit.md](audit.md) defines the doc audit: when it runs, the checklist, and where reports go.

## Planned sections

Pages here get created by the PR that first needs them, then linked above:

- `modules/web.md`: the web package's page, written with the UI rewrite. The other packages already have one.
- `audits/YYYY-MM-DD.md`: doc audit reports.
