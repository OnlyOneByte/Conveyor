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

The web dev server (`vite dev` in `packages/web`) proxies the API paths (`/jobs` with its WebSocket,
`/generators`, `/uploads`, `/auth`, `/jobs-history` and `/catalog`) to the api, so the PWA only ever calls its
own origin. A page route never shares a prefix with an API path: `/admin` and `/jobs` pages both 404ed on a
direct load when they did. Two variables tune it:

| Variable | Default | What it does |
| --- | --- | --- |
| `CONVEYOR_API_TARGET` | `http://127.0.0.1:3000` | where the proxy sends API requests, for an api on another port |
| `CONVEYOR_DEV_ALLOWED_HOSTS` | empty | comma-separated extra `Host` names Vite accepts; a leading dot matches subdomains (`.example.dev`). Vite 5.4.12 and later refuse an unknown `Host` to block DNS rebinding, so set it when you reach the dev server through a tunnel or reverse proxy |

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

The Redis Lua-guard tests in `packages/worker/src/status.test.ts` run only when `REDIS_URL` is set, and CI
fails without it. To match CI locally, start a Redis (`docker run --rm -p 6379:6379 redis:7-alpine`) and
export `REDIS_URL=redis://127.0.0.1:6379` before `bun run test:coverage`.

How the comments baseline works, and what each `check:comments` message means, is in
[AGENTS.md §2](../AGENTS.md#2-no-comments). It is one file per area,
`scripts/checks/comments/baseline/<area>.json`, and `bun run check:comments:update` rewrites only the areas
whose counts changed.

The coverage baseline is one file per package, `scripts/checks/coverage/baseline/<package>.json`, each holding
a single line-coverage percent, so PRs that move different packages never touch the same file. If
`check:coverage` says a package is 0.5 or more above the committed baseline, you raised coverage: run
`bun run check:coverage:update` and commit the files it names; it rewrites only packages whose floor rose. If
it says `dropped below base`, add the tests that cover what you changed.

The coverage denominator is every code file (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.mjs`, but not `.d.ts`)
in `packages/api`, `worker`, `shared` and `plugins/*/*`. Only real tests leave it: a `*.test.*` or `*.spec.*`
file whose text imports `bun:test` in any form (named, aliased, namespace, side-effect, `require` or dynamic
`import`; a text match, not a parse), and the declared helper folder `packages/shared/test/helpers/`. Any
other module, including one named `*.spec.ts` or kept in a `test/` folder, is mapped by bun and counts;
`bunfig.toml` sets `coverageSkipTestFiles = false` and ignores only that helper folder and
`scripts/checks/coverage/sweep.ts` (the sweep runner itself) so it can. The sweep
that maps never-imported files fails when the whole sweep takes longer than 30 s; set
`CONVEYOR_COVERAGE_SWEEP_TIMEOUT_MS` to change that.

Lines that hold only types leave the denominator, so writing a type inline or as a named `interface` measures
the same. The checker parses each file with TypeScript and drops a line only when every token on it sits inside
a type (a type annotation, a type literal, an `interface` or a `type` alias), apart from bare `,` and `;`. A line
with any other token stays counted, and so do `extends`/`implements` clauses and `enum`s.

## The PR flow

1. **Issue.** Find or open the issue the change answers.
2. **Branch** from fresh `main`: `<type>/<slug>`, for example `fix/cancel-during-slice`.
3. **Change** one concern, at most 400 changed lines. Update the docs the change touches, in the same PR.
4. **Open the PR** with a Conventional-Commit title and every section of the template filled in. The body
   names the issue (`Closes #N` or `Part of #N`). Agent PRs carry the `agent` label and one `area/*` label.
5. **UI changes** attach before and after screenshots (and a GIF for motion) under `## Visuals`, with the
   head sha on the `Provenance:` line.
6. **CI** runs `lint`, `format`, `typecheck`, `test`, `no-comments`, the three Docker builds and `compose`, which
   brings the whole stack up and checks it through Caddy.
7. **Review.** A separate reviewer agent posts `conveyor/adversarial-review`, following
   [review-rubric.md](review-rubric.md). It may start before CI finishes. Fix or rebut every `[S0]` and
   `[S1]` finding, then push; the reviewer re-reviews the new head.
8. **Merge.** The merge tooling squash-merges once every required check and the review status are green on
   the same head. `do-not-merge` stops it; `large-ok` (owner only) allows a diff over 800 lines.

## Changing the rules

Changes to the rules themselves, the checkers, CI and the compiler and linter config are guardrail paths. They
change in their own PR and need a second, independent review; the list and the gate are in
[AGENTS.md §12](../AGENTS.md#12-guardrail-paths).

### Dependency audit

The `audit` CI job runs `bun audit --audit-level=high`, which reads `bun.lock` and fails on any high or critical
advisory. The job skips only the advisories listed in `.github/audit-baseline.json`, which maps bun's numeric
advisory id (the `--ignore` value) to its GHSA id. The baseline records the advisories present when the job
was added; #231 tracks fixing them. To see the current findings, run `bun audit --audit-level=high`.

Which baseline the job uses depends on the run. Each run picks one base commit, and uses it both to read the base's baseline and to compute the diff (`git diff --no-renames --name-only <base> HEAD`):

| Run | Base commit |
| --- | --- |
| A pull request | `HEAD^1`, the first parent of the merge commit GitHub checks out, so a re-run judges the same base even after `main` moves |
| A manual run on any branch except `main` | `git merge-base origin/main HEAD`, so a dispatch can't launder a PR's red `audit` |
| A push to `main`, or a manual run on `main` | none |

With a base, the job skips only the entries both the base's and the branch's baseline list. When the diff is `.github/audit-baseline.json` alone, it uses the branch's own file. Without a base, it uses the checked-out tree's file.

When there is a base, every id the branch's baseline adds over it must appear in `bun audit --json` on that tree, or the job fails naming the id. That stops a PR from pre-seeding an id for an advisory that doesn't exist yet. If the base can't be resolved, the job fails. If either baseline or the audit output is empty or isn't a JSON object, the job fails and says which.

- **Removing an entry:** delete it in the PR whose upgrade fixes the advisory. If the advisory is still
  present, that PR's `audit` fails.
- **Adding an entry:** a PR can't add a dependency and its entry together, because the base doesn't list the
  entry yet. An entry for an advisory already on `main` lands in a PR that changes only
  `.github/audit-baseline.json`. That PR's `audit` uses its own file and passes, and it can't add a
  dependency. It's a guardrail change, so it needs both reviews. After it merges, the push run on `main` uses
  the new file, so `main` stays green.

### Pinned actions

Every third-party action in `.github/workflows` is pinned to a full commit SHA. The YAML can't say which
release a SHA is, because the no-comments check covers YAML, so this table does. Each SHA is the commit the
release tag pointed to when it was pinned.

| Action | Release | Commit |
| --- | --- | --- |
| `actions/checkout` | `v4.4.0` | `11d5960a326750d5838078e36cf38b85af677262` |
| `actions/cache` | `v4.3.0` | `0057852bfaa89a56745cba8c7296529d2fc39830` |
| `actions/upload-artifact` | `v4.6.2` | `ea165f8d65b6e75b540449e92b4886f43607fa02` |
| `actions/download-artifact` | `v4.3.0` | `d3f86a106a0bac45b974a628896c90dbdf5c8093` |
| `oven-sh/setup-bun` | `v2.2.0` | `0c5077e51419868618aeaa5fe8019c62421857d6` |
| `docker/build-push-action` | `v6.19.2` | `10e90e3645eae34f1e60eeb005ba3a3d33f178e8` |
| `docker/login-action` | `v3.7.0` | `c94ce9fb468520275223c153574b00df6fe4bcc9` |
| `docker/metadata-action` | `v5.10.0` | `c299e40c65443455700f0fdfc63efafe5b349051` |
| `docker/setup-buildx-action` | `v3.12.0` | `8d2750c68a42422c14e847fe6c8ac0403b4cbd6f` |

To bump an action, resolve the new release tag to its commit and update the workflows and this table in the
same PR. For an annotated tag, follow the tag object to the commit it points to.

```bash
gh api repos/<owner>/<action>/git/ref/tags/<tag> --jq .object
```

### Dependency updates

`.github/dependabot.yml` opens update PRs every week, at most 5 open per ecosystem, with minor and patch
updates grouped into one PR (the `minor` group) and majors one per PR:

| Ecosystem | Covers | Title prefix |
| --- | --- | --- |
| `bun` | `bun.lock` and every workspace `package.json` | `fix(deps)`, or `chore(deps)` for dev dependencies |
| `github-actions` | the SHA pins in `.github/workflows` | `ci` |
| `docker` | the `FROM` lines in `packages/{api,web,worker}/Dockerfile` | `fix(deps)` |

Dependabot reads the text `bun.lock`; it does not support the old binary `bun.lockb`. The base images use
moving tags (`oven/bun:debian`, `node:lts-bookworm-slim`, `debian:trixie-slim`), which Dependabot has no
version to bump, so the `docker` entry opens PRs only once a `FROM` line pins a version or digest.

A `github-actions` PR changes the SHA but not the table above, so before it merges, push a commit that
updates the table's release and commit for each bumped action.

## Toolchain notes

`mise.toml` pins Bun, which is both the package manager and the runtime: it runs TypeScript directly, so there is no build step. Node 20 is pinned as a compatibility fallback for the API's Fastify and BullMQ. `bunfig.toml` points installs at the public npm registry, so a machine whose global config names a private mirror still resolves the same packages.

The web image builds the SvelteKit PWA with Bun and serves the `adapter-node` output with Node. Every Dockerfile copies the `package.json` of every workspace member before `bun install --frozen-lockfile`, even the members that image never imports (the web image copies the worker's and every plugin's). `--frozen-lockfile` checks the whole workspace graph against `bun.lock`, and a missing manifest makes bun report `lockfile had changes` and abort. A new workspace package needs a `COPY` line in all three Dockerfiles.

The PWA's service worker, `packages/web/src/service-worker/index.ts` (with its own `tsconfig.json` extending `$app/tsconfig/service-worker`), is a minimal offline app-shell cache. On install it precaches the build's immutable assets and the `static` files (`immutable` and `assets` from `$app/manifest`, under a cache named after `version` from `$app/env`), and answers those paths cache-first. It never caches API or websocket traffic. Only the precached paths are cached at all, but it also skips every API namespace (`/jobs`, which covers `/jobs-history` by prefix, `/catalog`, `/generators`, `/uploads` and `/auth`), so a catalog path added to the precache by mistake can't serve a stale catalog. Keep that list in step with the API's namespaces.

## Releases

Pushing a `v*` tag, or running `.github/workflows/release.yml` by hand, builds the `api`, `web` and `worker` images and publishes multi-arch (amd64 and arm64) manifests to GHCR, authenticated with the built-in `GITHUB_TOKEN`. The image path is `ghcr.io/<owner>/conveyor-<service>` with the owner lowercased, because GHCR requires a lowercase path and the owner (`OnlyOneByte`) is mixed-case. Each image and architecture builds on a native runner, because the worker's engine downloads are too heavy to emulate. Each build pushes an untagged image by digest; a per-service job joins the two digests into one tag set: `x.y.z`, `x.y`, `latest` (tag runs only) and `sha-<short>`. A manual run on a branch therefore never moves `latest`. Release builds keep `ORCA_ENABLE` at its `auto` default, unlike CI, which disables Orca. The build cache uses `mode=min`: exporting every intermediate layer of the multi-gigabyte worker image was the likely cause of the v0.1.0 arm64 failure. A newer run for the same ref cancels the older one. Each build pushes a SLSA provenance attestation (`provenance: mode=max`) and an SPDX SBOM (`sbom: true`) with its image, and the multi-arch tag carries both; `docker buildx imagetools inspect <image>:<tag> --format '{{json .Provenance}}'` (or `.SBOM`) reads them.
