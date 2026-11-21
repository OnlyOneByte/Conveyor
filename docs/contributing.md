# Contributing

The rules are in [AGENTS.md](../AGENTS.md). This page is the how: setup, local checks and the PR flow.

## Setup

```bash
mise install                 # pins bun and Node from mise.toml
git submodule update --init  # scad/ (gridfinity-rebuilt-openscad)
bun install
```

Run the whole stack with `docker compose up --build`. To run without engines (no OpenSCAD or slicer), start
a local Redis and use stub mode:

```bash
CONVEYOR_ENGINE_STUB=1 bun run dev:worker
CONVEYOR_ENGINE_STUB=1 bun run dev:api
```

## Before you push

Each command matches a required CI check of the same name.

```bash
bun run lint
bun run format:check
bun run typecheck
(cd packages/web && bunx svelte-kit sync && bunx svelte-check)
bun test --coverage
bun run check:comments
```

If `check:comments` says the baseline is stale, you removed comments: run `bun run check:comments:update` and
commit `scripts/checks/comments-baseline.json`. If it says `added:`, delete the comment you added.

## The PR flow

1. **Issue.** Find or open the issue the change answers.
2. **Branch** from fresh `main`: `<type>/<slug>`, for example `fix/cancel-during-slice`.
3. **Change** one concern, at most 400 changed lines. Update the docs the change touches, in the same PR.
4. **Open the PR** with a Conventional-Commit title and every section of the template filled in. The body
   names the issue (`Closes #N` or `Part of #N`). Agent PRs carry the `agent` label and one `area/*` label.
5. **UI changes** attach before and after screenshots (and a GIF for motion) under `## Visuals`, with the
   head sha on the `Provenance:` line.
6. **CI** runs `lint`, `format`, `typecheck`, `test`, `no-comments` and the three Docker builds.
7. **Review.** A separate reviewer agent posts `conveyor/adversarial-review`, following
   [review-rubric.md](review-rubric.md). It may start before CI finishes. Fix or rebut every `[S0]` and
   `[S1]` finding, then push; the reviewer re-reviews the new head.
8. **Merge.** The merge tooling squash-merges once every required check and the review status are green on
   the same head. `do-not-merge` stops it; `large-ok` (owner only) allows a diff over 800 lines.

## Changing the rules

Guardrail paths (`.github/**`, `scripts/checks/**`, `CODEOWNERS`, `AGENTS.md`, `CLAUDE.md`, `biome.json`,
`biome.jsonc`, `tsconfig*.json`, `bunfig.toml`) change in their own PR. A guardrail-path PR needs a passing
adversarial review from a second, independent reviewer session that saw none of the earlier rounds. The merge
tooling refuses guardrail-path PRs unless the conductor sets `CONVEYOR_GUARDRAIL_OK=1`, which it does only
after that independent pass.
