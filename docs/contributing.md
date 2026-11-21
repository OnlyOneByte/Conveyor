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
bun run test:coverage && bun run check:coverage
bun run check:comments
```

If `check:comments` says the baseline is stale, you removed comments: run `bun run check:comments:update` and
commit `scripts/checks/comments-baseline.json`. If it says `added:`, delete the comment you added.

If `check:coverage` says a package is 0.5 or more above the committed baseline, you raised coverage: run
`bun run check:coverage:update` and commit `scripts/checks/coverage/baseline.json`. If it says `dropped below
base`, add the tests that cover what you changed.

The coverage denominator is every `.ts`/`.js` file in `packages/api`, `worker`, `shared` and `plugins/*/*`.
Only real tests leave it: a `*.test.*` or `*.spec.*` file whose text imports from `bun:test` and contains a
bare `test(`, `it(` or `describe(` (a text match, not a parse), and the declared helper folder
`packages/shared/test/helpers/`. Any other module named `*.spec.ts` or kept in a `test/` folder is mapped by
bun and counts; `bunfig.toml` sets `coverageSkipTestFiles = false` and ignores only that helper folder so it
can. The sweep that maps never-imported files fails an import that hangs for 30 s; set
`CONVEYOR_COVERAGE_SWEEP_TIMEOUT_MS` to change that.

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

Guardrail paths (`.github/**`, `scripts/checks/**`, `AGENTS.md`, `CLAUDE.md`, and `CODEOWNERS`,
`biome.json`, `biome.jsonc`, `tsconfig*.json`, `bunfig.toml` at any depth) change in their own PR. A PR that
only lowers `scripts/checks/comments-baseline.json` or `scripts/checks/coverage/baseline.json` is exempt. A guardrail-path PR needs a passing
adversarial review from a second, independent reviewer session that saw none of the earlier rounds. The merge
tooling refuses guardrail-path PRs unless the conductor sets `CONVEYOR_GUARDRAIL_OK=1`, which it does only
after that independent pass.

## Toolchain notes

`mise.toml` pins Bun, which is both the package manager and the runtime: it runs TypeScript directly, so there is no build step. Node 20 is pinned as a compatibility fallback for the API's Fastify and BullMQ. `bunfig.toml` points installs at the public npm registry, so a machine whose global config names a private mirror still resolves the same packages.

## Releases

Pushing a `v*` tag, or running `.github/workflows/release.yml` by hand, builds the `api`, `web` and `worker` images and publishes multi-arch (amd64 and arm64) manifests to GHCR, authenticated with the built-in `GITHUB_TOKEN`. The image path is `ghcr.io/<owner>/conveyor-<service>` with the owner lowercased, because GHCR requires a lowercase path and the owner (`OnlyOneByte`) is mixed-case. Each image and architecture builds on a native runner, because the worker's engine downloads are too heavy to emulate. Each build pushes an untagged image by digest; a per-service job joins the two digests into one tag set: `x.y.z`, `x.y`, `latest` (tag runs only) and `sha-<short>`. A manual run on a branch therefore never moves `latest`. Release builds keep `ORCA_ENABLE` at its `auto` default, unlike CI, which disables Orca. The build cache uses `mode=min`: exporting every intermediate layer of the multi-gigabyte worker image was the likely cause of the v0.1.0 arm64 failure. A newer run for the same ref cancels the older one.
