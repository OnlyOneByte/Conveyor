# 0005: The Belt UI with a Track rail

Status: accepted, 2026-11-23.

## Context

The UX audit ([#49](https://github.com/OnlyOneByte/Conveyor/issues/49)) found that one job lives in three places
(#46), History splits into two lists (#38) and Job detail is a data dump (#39). It asked for a ground-up redesign
with a global job tray. Three directions were mocked: a canvas-first workbench, the Belt, and a keyboard-first
switchboard. The owner picked the Belt, then compared three belt shapes: five slotted stations on one shared belt,
one belt per printer, and one continuous rail.

## Decision

Build the Belt direction with the continuous rail, called the Track. Every unfinished job is a chip placed by real
progress; chips that collide merge into a group; waiting jobs sit in a Queue box; finished and failed jobs leave into
two bins. The rail collapses to a 40 px bar on scroll and on dense pages, and to a summary chip on mobile. From the
switchboard direction it keeps the `⌘K` command menu and `J`/`K` in Jobs. The full spec is
[design/track-ui.md](../design/track-ui.md).

## Consequences

- The UI keeps SvelteKit 3 and Svelte 5. The tokens are plain CSS custom properties with a light and a dark theme,
  and primitives are native elements (`<dialog>`, popover) rather than a component library.
- The rail is the global job tray, so Monitor and the localStorage job list are removed.
- Until the backend has one stream of job events, the rail polls `GET /jobs/active` and opens a socket per chip.
- The rewrite lands as nine PRs of at most 400 changed lines, each with visuals.
