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

The web dev server (`vite dev` in `packages/web`) proxies `/api/`, WebSocket included, to the api and strips
the prefix, the same as Caddy, so the PWA only ever calls its own origin. Every API call in the PWA goes
through the `API` base in `lib/api.ts`, and every other path is a page. Two variables tune it:

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
bun run check:lines
```

The Redis Lua-guard tests in `packages/worker/src/status.test.ts` run only when `REDIS_URL` is set, and CI
fails without it. To match CI locally, start a Redis (`docker run --rm -p 6379:6379 redis:8-alpine`) and
export `REDIS_URL=redis://127.0.0.1:6379` before `bun run test:coverage`.

CI's `test` job also runs the whole suite once more in a random order. The seed comes from the commit being
tested, so rerunning the job gives the same order. The log and job summary print the seed, the commit, a
command to check that commit out, and the command that reruns the order. On a pull request the commit is
GitHub's merge of the PR into its base, not the PR head, so check out the printed commit
(`git fetch origin <sha> && git checkout <sha>`) rather than your branch. `--seed` alone shuffles the order,
and the order also depends on the list of files bun starts from, which differs between machines. CI therefore
passes the test files explicitly, sorted byte-wise so every locale gives the same list
(`git ls-files '*.test.ts' ':!:tools/visual/**' | LC_ALL=C sort`). On the printed commit, run the printed
command to get the same order locally. A test that only fails there depends on what ran before it: make it
set up its own state.

How the comments baseline works, and what each `check:comments` message means, is in
[AGENTS.md §2](../AGENTS.md#2-no-comments). It is one file per area,
`scripts/checks/comments/baseline/<area>.json`, and `bun run check:comments:update` rewrites only the areas
whose counts changed.

The coverage baseline is one file per package, `scripts/checks/coverage/baseline/<package>.json`, each holding
a single line-coverage percent, so PRs that move different packages never touch the same file. If
`check:coverage` says a package is 0.5 or more above the committed baseline, you raised coverage: run
`bun run check:coverage:update` and commit the files it names; it rewrites only packages whose floor rose. If
it says `dropped below base`, add the tests that cover what you changed.

Moving a test-only file out of `src/` into a declared helper folder lowers that package's number without any
real coverage being lost: the file leaves the denominator. That is the one case where a floor may go down, and
it is recorded where review sees it. Add an entry to `scripts/checks/coverage/baseline/reclassified.json`,
`{ "package", "from", "to", "floor" }`, and set the package's baseline to the measured value, the same number
as `floor`. `check:coverage` accepts the lower floor only for an entry the base does not already have, and
only when all of these hold:

- `from` is a counted source file of that package, and `to` is in that package's declared helper folder;
- git sees the commit range as a rename from `from` to `to` (`git diff -M90%`);
- `floor` equals the committed baseline;
- the move explains the whole drop: counting the moved file's lines on the base as fully covered brings the
  package back to at least the base's floor;
- nothing else in the repository changes. Every changed file is the recorded rename, a file under
  `scripts/checks/coverage/baseline/`, a Markdown file, or a file whose only changed lines are one-line
  imports or exports that follow the move. Both sides of each such line are resolved the way Bun resolves
  them, the old one on the base and the new one on the PR, and the new target must be the old target with
  the move applied. An import pointed at another file fails, and so does any other change anywhere,
  including root config such as `bunfig.toml`, `package.json` or a `tsconfig`.

Land other work in its own PR. What a whole-tree allowlist still can't see is left to the two-review gate.

Otherwise it fails and names the rule. The log prints how far the move could explain coverage, so a reviewer
sees the slack. Entries stay in the file as history and have no effect once they are on the base.

The coverage denominator is every code file (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.mjs`, but not `.d.ts`)
in `packages/api`, `worker`, `shared` and `plugins/*/*`. Only test code leaves it: a file named `*.test.*` or
`*.spec.*` (the name decides, not what the file contains), and the declared helper folders
`packages/shared/test/helpers/` and `packages/worker/test/helpers/`. Because those leave the denominator,
`check:coverage` fails when a module that still counts:

- imports something that lands in a helper folder or a `*.test.*`/`*.spec.*` file. Each quoted specifier is
  resolved the way Bun resolves it at run time (`Bun.resolveSync`, then `realpathSync`), so a relative path, a
  `package.json` `imports` or `exports` alias, a `tsconfig` `paths` alias and a symlink anywhere in the repo are all judged by where they
  really land. A specifier that doesn't resolve is skipped;
- names a `*.test.*` or `*.spec.*` file in an import;
- mentions `test` and `helpers` next to each other anywhere in its text (`\btest\W+helpers\b`). This is a text
  match, not a parse, so it also catches template literals, concatenation, variables, `path.join` and
  `import.meta.url`. A real source that trips it on a string has to reword the string.

It also fails on any tracked symlink under `packages/` or `plugins/`. Resolution follows a link only for a
quoted specifier, and the ban also covers a computed import through a linked folder. And it fails on a
`*.test.*` or `*.spec.*` file that never imports `bun:test`, because the name alone takes it out of the
denominator: a real module named like that has to be renamed. Any other module, including one kept in another `test/`
folder, is mapped by bun and counts; `bunfig.toml` sets `coverageSkipTestFiles = false` and ignores only those
helper folders and
`scripts/checks/coverage/sweep.ts` (the sweep runner itself) so it can. The sweep
that maps never-imported files fails when the whole sweep takes longer than 30 s; set
`CONVEYOR_COVERAGE_SWEEP_TIMEOUT_MS` to change that. The sweep runs as a child `bun test` without
`GITHUB_ACTIONS`, so the coverage checker's own tests, which make it fail on purpose (a hanging import, a
timeout of `soon`), don't post CI error annotations. Their output still shows in the log; the run's real
failures are the annotations and the final pass/fail count.

Lines that hold only types leave the denominator, so writing a type inline or as a named `interface` measures
the same. The checker parses each file with TypeScript and drops a line only when every token on it sits inside
a type (a type annotation, a type literal, an `interface` or a `type` alias), apart from bare `,` and `;`. A line
with any other token stays counted, and so do `extends`/`implements` clauses and `enum`s.

The file-size baseline, `scripts/checks/lines/baseline.json`, lists each file over its limit
([AGENTS.md §4](../AGENTS.md#4-size-limits)) with its line count. `check:lines` compares every file with the base
commit's baseline. In CI that is the commit the PR's merge commit was built on (`HEAD^1`), the merge base with
`main` for a manual run on another branch, and the previous commit on `main` for a push; `scripts/checks/base.ts`
picks it, as it does for `audit`, the comment ratchet (`no-comments`) and the coverage ratchet (`test`). Comparing
with `main`'s newer tip instead would judge a PR against baselines it was never built on. A listed file may stay at or under its entry; any other file fails past 250 lines, or 150 for a
`.svelte` component. When you shrink a listed file, the check says the baseline is stale: run
`bun run check:lines:update` and commit it. A file that drops to its limit leaves the baseline.

## The PR flow

1. **Issue.** Find or open the issue the change answers.
2. **Branch** from fresh `main`: `<type>/<slug>`, for example `fix/cancel-during-slice`.
3. **Change** one concern, at most 400 changed lines. Update the docs the change touches, in the same PR.
4. **Open the PR** with a Conventional-Commit title and every section of the template filled in. The body
   names the issue (`Closes #N` or `Part of #N`). Agent PRs carry the `agent` label and one `area/*` label.
5. **UI changes** attach before and after screenshots (and a GIF for motion) under `## Visuals`, with the
   head sha on the `Provenance:` line.
6. **CI** runs `lint`, `format`, `typecheck`, `test`, `no-comments`, `file-size`, the three Docker builds and `compose`, which
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
| `actions/setup-node` | `v7.1.0` | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
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

`.github/dependabot.yml` opens update PRs every week, at most 5 open per ecosystem:

| Ecosystem | Covers | Grouping | Title prefix |
| --- | --- | --- | --- |
| `bun` | `bun.lock` and every workspace `package.json`, plus `tools/visual`'s own `package.json` and `bun.lock` | minor and patch in one PR (`minor`) across both directories, majors one per PR per directory | `fix(deps)`, or `chore(deps)` for dev dependencies |
| `github-actions` | the SHA pins in `.github/workflows` | minor and patch in one PR (`minor`); majors are ignored | `ci` |
| `docker` | the `FROM` lines in `packages/{api,web,worker}/Dockerfile` | minor and patch in one PR (`images`), majors one per PR | `fix(deps)` |
| `docker-compose` | the `image:` lines in `docker-compose.yml` (`caddy`, `redis`) | one PR per image | `fix(deps)` |

The group names are short, so a title for several updates, such as
`fix(deps): bump the images group across 3 directories with 12 updates`, stays within 72 characters. A
group with a single update is titled after its package instead (`bump <package> from <old> to <new> in the
minor group`), which a long package name or version can push past 72; step 1 of the adoption below fixes
that title. Compose images get one PR each because their tags (`redis:8-alpine`, `caddy:2`) move only by
major, so every compose bump is a major and should be reviewed on its own.

`tools/visual` isn't a workspace member, so the `bun` entry lists it as a second directory
(`directories: [/, /tools/visual]`) rather than in a separate entry. Both then share one schedule, PR limit,
`minor` group and set of ignores, and a shared tool such as `typescript` or `@types/bun` moves in both in the
same grouped PR.

Dependabot reads the text `bun.lock`; it does not support the old binary `bun.lockb`. The web image's
`node:26-bookworm-slim` is the one `FROM` line with a version, so it is the only base image the `docker` entry
bumps. The api and worker use moving tags (`oven/bun:debian`, `debian:trixie-slim`), which Dependabot has no
version to bump.
Action majors are ignored because a new major usually changes inputs, so it gets its own PR by hand.
`@types/bun` gets patch updates only: it stays on the minor of the Bun that CI runs (`BUN_VERSION` in
`ci.yml`), so it moves in the PR that bumps CI's Bun. The root and `tools/visual` both pin it to `~1.3.14` for
that reason. TypeScript majors are ignored as well: TypeScript 7, the native compiler, drops the JS compiler API
that SvelteKit 3, `svelte-check` and the coverage checker's `type-lines.ts` need (#281 has the details). The
ignore lives here rather than as a `@dependabot ignore` comment, so it covers both directories and shows in
review. Node image majors are ignored too: Node moves to the next LTS line on purpose, and the odd-numbered
releases in between are never LTS.

A Dependabot PR doesn't follow the PR rules on its own. A builder adopts each one as its author session before
it goes to review:

1. Retitle it to RUBRIC §12 if needed (72 characters at most, an allowed type and scope).
2. Rewrite the body to the PR template, ending with that builder's `Author-Session:` line.
3. For a `github-actions` PR, push a commit that updates the pinned-actions table above with the new release
   and commit for each bumped action.
4. For a Redis major, bump the pins Dependabot doesn't update in the same PR: the `test` job's `redis` service
   in `.github/workflows/ci.yml`, `tools/visual/stack.ts` (`redisContainer`), `tools/visual/stack.test.ts`, and
   the local `docker run --rm -p 6379:6379 redis:8-alpine` hint under "Before you push" on this page. The
   `lint` job's "One Redis image in every pin" step (`bun scripts/checks/redis-pins.ts`) fails while any of these, or `docker-compose.yml`, has no Redis image reference or names a different one. A Docker Hub prefix (`docker.io/library/`) reads as the same image; any other registry or namespace is a different one.
   Then check the upgrade on an existing data volume before merging. The CI `compose` job pre-seeds only the
   Caddy volumes and starts Redis on a fresh one, so it can't catch a volume the new Redis can't read, and once
   the new Redis has rewritten the volume, going back to the old image may not work.

   Run it through `docker compose`, not a bare `docker run`. Compose starts Redis as uid `999:1000` with a
   read-only root filesystem and only `/data` writable, as in production. A bare run as root would hide a new
   image that can't write the volume the old one left behind.

   1. On `main` (the old tag), start the stack, then stop the worker so a job stays queued:
      `docker compose up -d` and `docker compose stop worker`.
   2. Seed a probe key and a queued job. Run `docker compose exec redis redis-cli SET conveyor:upgrade-probe 1`,
      log in, submit a job with `POST /api/jobs`, and note its `jobId`.
   3. Flush and record: `docker compose exec redis redis-cli SAVE`, then
      `docker compose exec redis redis-cli DBSIZE`. Note the count.
   4. `docker compose stop redis`, check out the PR branch (the new tag), then `docker compose up -d redis`
      on the same `redis_data` volume.
   5. It passes only when all four hold (each `redis-cli` through `docker compose exec redis`):
      - `docker compose ps redis` shows `healthy`.
      - `redis-cli GET conveyor:upgrade-probe` returns `1`.
      - `redis-cli DBSIZE` matches the count from step 3.
      - The queued job survived: `redis-cli EXISTS bull:conveyor-jobs:<jobId>` returns `1`, and
        `redis-cli LPOS bull:conveyor-jobs:wait <jobId>` returns a number, not `(nil)`.

   Check the job in Redis, not through `GET /api/jobs/active`. That route lists only jobs the worker has reported
   on, so with the worker stopped it is empty on the old Redis too. Put the four results in the PR's How
   verified section.

Once anyone but Dependabot pushes to its branch, Dependabot stops rebasing that PR. From then on the builder
keeps it current with `main` by merging `main` in. Commenting `@dependabot recreate` throws the pushed commits
away.

## Toolchain notes

`mise.toml` pins Bun, which is both the package manager and the runtime: it runs TypeScript directly, so there is no build step. Node 26 is pinned too: vite runs under `node` when one is on `PATH`, and SvelteKit 3 needs Node 22.17 or later. CI's `typecheck` job and the Visual evidence workflow set up the same Node 26 with `actions/setup-node`, so the `bunx` tools there don't run on whatever Node the runner image ships. The `typecheck` job also type-checks the service worker (`tsc -p src/service-worker/tsconfig.json` from `packages/web`, with the repo's single TypeScript 6.0.3 from the root `package.json`), which `svelte-check` doesn't cover. `bunfig.toml` points installs at the public npm registry, so a machine whose global config names a private mirror still resolves the same packages.

The web image builds the SvelteKit PWA with Bun and serves the `adapter-node` output with Node. Every Dockerfile copies the `package.json` of every workspace member before `bun install --frozen-lockfile`, even the members that image never imports (the web image copies the worker's and every plugin's). `--frozen-lockfile` checks the whole workspace graph against `bun.lock`, and a missing manifest makes bun report `lockfile had changes` and abort. A new workspace package needs a `COPY` line in all three Dockerfiles.

The PWA's service worker, `packages/web/src/service-worker/index.ts` (with its own `tsconfig.json` extending `$app/tsconfig/service-worker`), is a minimal offline app-shell cache. On install it precaches the build's immutable assets and the `static` files (`immutable` and `assets` from `$app/manifest`, under a cache named after `version` from `$app/env`), and answers those paths cache-first. It never caches API or websocket traffic. Only the precached paths are cached at all, but it also skips everything under `/api/`, so an API path added to the precache by mistake can't serve a stale catalog.

## Releases

Pushing a `v*` tag, or running `.github/workflows/release.yml` by hand, builds the `api`, `web` and `worker` images and publishes multi-arch (amd64 and arm64) manifests to GHCR, authenticated with the built-in `GITHUB_TOKEN`. The image path is `ghcr.io/<owner>/conveyor-<service>` with the owner lowercased, because GHCR requires a lowercase path and the owner (`OnlyOneByte`) is mixed-case. Each image and architecture builds on a native runner, because the worker's engine downloads are too heavy to emulate. Each build pushes an untagged image by digest; a per-service job joins the two digests into one tag set: `x.y.z`, `x.y`, `latest` (tag runs only) and `sha-<short>`. A manual run on a branch therefore never moves `latest`. Release builds keep `ORCA_ENABLE` at its `auto` default, unlike CI, which disables Orca. The build cache uses `mode=min`: exporting every intermediate layer of the multi-gigabyte worker image was the likely cause of the v0.1.0 arm64 failure. A newer run for the same ref cancels the older one. Each build pushes a SLSA provenance attestation (`provenance: mode=max`) and an SPDX SBOM (`sbom: true`) with its image, and the multi-arch tag carries both; `docker buildx imagetools inspect <image>:<tag> --format '{{json .Provenance}}'` (or `.SBOM`) reads them.
