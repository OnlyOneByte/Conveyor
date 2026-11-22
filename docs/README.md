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
| [modules/plugins.md](modules/plugins.md) | Why the bundled plugins work the way they do: engine flags, protocol quirks, unverified hardware paths |
| [SEQUENCE.md](SEQUENCE.md) | A job's trip through the pipeline, with failure paths |
| [DATA-MODEL.md](DATA-MODEL.md) | SQLite, Redis and filesystem storage |
| [M1-WORKER-ENGINES.md](M1-WORKER-ENGINES.md) | Engines baked into the worker image |
| [M2-TRANSPORTS.md](M2-TRANSPORTS.md) | Moonraker and Elegoo transports |
| [SLICER-PROFILES.md](SLICER-PROFILES.md) | How edited slicer profiles are validated |
| [modules/shared.md](modules/shared.md) | `packages/shared`: the why behind its types, validation and SQLite store |
| [modules/api.md](modules/api.md) | `packages/api`: auth, catalog, profile files, artifacts, uploads, probe |
| [modules/worker.md](modules/worker.md) | `packages/worker`: the worker image's engines, profile materialization and status bus |
| [archive/ui-mockup.html](archive/ui-mockup.html) | Historical: the pre-M4 UI mockup, kept for reference. It shows Stations and an Admin page, which no longer exist |
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

## Design docs

Proposals reviewed before any code lands. Once accepted, a design's decision is recorded as an ADR.

| Design | Status |
|---|---|
| [design/sqlite-queue.md](design/sqlite-queue.md) | Proposed: replace BullMQ and Redis with a job queue in SQLite (#5) |

## Keeping docs true

[audit.md](audit.md) defines the doc audit: when it runs, the checklist, and where reports go.

## Planned sections

Pages here get created by the PR that first needs them, then linked above:

- `modules/<module>.md`: what used to be code comments (invariants, why, gotchas), one page per package.
- `design/`: design tokens, principles, mockups and screenshots for the UI rewrite, alongside the design docs
  listed above.
- `audits/YYYY-MM-DD.md`: doc audit reports.
