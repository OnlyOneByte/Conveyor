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
| [SEQUENCE.md](SEQUENCE.md) | A job's trip through the pipeline, with failure paths |
| [DATA-MODEL.md](DATA-MODEL.md) | SQLite, Redis and filesystem storage |
| [M1-WORKER-ENGINES.md](M1-WORKER-ENGINES.md) | Engines baked into the worker image |
| [M2-TRANSPORTS.md](M2-TRANSPORTS.md) | Moonraker and Elegoo transports |
| [ui-mockup.html](ui-mockup.html) | The original UI mockup |
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

## Keeping docs true

[audit.md](audit.md) defines the doc audit: when it runs, the checklist, and where reports go.

## Planned sections

Pages here get created by the PR that first needs them, then linked above:

- `modules/<module>.md`: what used to be code comments (invariants, why, gotchas), one page per package.
- `design/`: design tokens, principles, mockups and screenshots for the UI rewrite.
- `audits/YYYY-MM-DD.md`: doc audit reports.
