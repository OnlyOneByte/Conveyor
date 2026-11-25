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

How the comment ratchet works, and what each `check:comments` message means, is in
[AGENTS.md §2](../AGENTS.md#2-no-comments). It counts both trees each run and stores nothing, so removing a
comment needs no other change.

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

The file-size, comment and cast ratchets store no baseline. `check:lines` counts every file
([AGENTS.md §4](../AGENTS.md#4-size-limits)) in the PR's tree and in the base commit's tree. In CI the base is
the commit the PR's merge commit was built on (`HEAD^1`), the merge base with `main` for a manual run on another
branch, and the previous commit on `main` for a push; `scripts/checks/base.ts` picks it, as it does for `audit`,
the comment ratchet (`no-comments`), the cast ratchet (`lint`) and the coverage ratchet (`test`). Comparing
with `main`'s newer tip instead would judge a PR against a tree it was never built on. A file the base has over
its limit may keep its length or shrink; any other file fails past 250 lines, or 150 for a `.svelte`
component. Shrinking a file needs no other change, so two PRs that shrink different files never conflict.

Because the allowance is the base's own tree, two PRs that each pass can still fail together, like two PRs
whose tests pass alone: one shrinks a long file and the other, checked on the older `main`, adds lines to it.
`main`'s push run then fails against the commit before it. A stored count turned that into a merge conflict
instead, and also made every pair of PRs that shrank neighbouring entries conflict.

## The PR flow

1. **Issue.** Find or open the issues the change answers.
2. **Branch** from fresh `main`: `<type>/<slug>`, for example `fix/cancel-during-slice`.
3. **Change** one concern; related small issues in one area count as one. Update the docs the change
   touches, in the same PR.
4. **Open the PR** with a Conventional-Commit title and every section of the template filled in. The body
   names each issue on its own line (`Closes #N` or `Part of #N`). Agent PRs carry the `agent` label and one
   `area/*` label.
5. **UI changes** attach before and after screenshots (and a GIF for motion) under `## Visuals`, with the
   head sha on the `Provenance:` line.
6. **CI** runs `lint`, `format`, `typecheck`, `test`, `no-comments`, `file-size`, the three Docker builds and `compose`, which
   brings the whole stack up and checks it through Caddy.
7. **Review.** A separate reviewer agent posts `conveyor/adversarial-review`, following
   [review-rubric.md](review-rubric.md). It may start before CI finishes. Fix or rebut every `[S0]` and
   `[S1]` finding, then push; the reviewer re-reviews the new head.
8. **Merge.** The merge tooling squash-merges once every required check and the review status are green on
   the same head. `do-not-merge` stops it.

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

### Image scan

`bun audit` sees only npm packages. Each `Docker build (<service>)` job also scans the image it built with Trivy, pinned by digest, for vulnerabilities that already have a fix: in Debian packages, in the base images and in anything else the image holds. Fixed critical and high findings go in the job summary and the `image-scan-<service>` artifact. A fixed critical one fails the job; a high one doesn't. Usually the fix is a rebuild on a newer base image. To see the findings for an image you built locally:

```sh
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy@sha256:bcc376de8d77cfe086a917230e818dc9f8528e3c852f7b1aff648949b6258d1c \
  image --scanners vuln --ignore-unfixed --severity CRITICAL,HIGH conveyor-api
```

`Docker build (worker)` builds without OrcaSlicer (`ORCA_ENABLE=0`). The `orca slice` job builds the worker with it (`ORCA_ENABLE=1`) and scans that image the same way, into the `image-scan-worker-orca` artifact, so OrcaSlicer's bundled files are scanned too. `release.yml` scans each image it pushes, per architecture, into `image-scan-<service>-<arch>`. It pulls the image, then runs `docker logout ghcr.io`, which removes the stored GHCR login from the runner's Docker config before Trivy starts. That is a small step: a container with the Docker socket is root on the runner, so the real protection is that Trivy is pinned by digest. The step then downloads Trivy's vulnerability and Java databases once, with up to three tries, and runs both scans from that copy. The Java database is what lets Trivy report a JAR's CVEs; without it a scan of an image with a JAR fails instead of reporting. A fixed critical there fails the build job. Neither the job that creates the GitHub Release page (`attach OpenSCAD source`) nor the one that tags images (`publish`) runs then. The pushed image stays in GHCR untagged, by digest only. Nothing pulls an untagged digest, but you can delete that version from the `conveyor-<service>` package's page on GitHub.

A build cache can hand an image an OS-package layer built weeks ago, with packages missing later security fixes. Two things keep those layers current:

- **Base images are pinned by digest** in every `FROM` (`oven/bun:debian@sha256:…`). Dependabot's weekly `docker` update bumps the digest, and a new digest rebuilds every layer above it. Check that the first digest-only bump of `node:26-bookworm-slim` (same tag, new digest) actually arrives: a Dependabot experiment flag can suppress digest-only updates. If none has come after two weekly runs while the tag moved upstream, bump that digest by hand.
- **The worker's own apt layer takes an `OS_REFRESH` build argument.** CI, the compose job and `release.yml` pass the ISO week (`date -u +%G-W%V`), so that layer is rebuilt once a week, and the layers above it with it. The `deps` stage (`bun install`) and the OpenSCAD source build don't use it and stay cached. The api and web images install no OS packages of their own; their OS packages are the pinned base image.

CI also runs on a weekly schedule (Mondays, 05:23 UTC), so `main`'s images are rebuilt and scanned even in a week with no merges.

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

The PWA's service worker, `packages/web/src/service-worker/index.ts` (with its own `tsconfig.json` extending `$app/tsconfig/service-worker`), is a minimal offline app-shell cache. On install it precaches the build's immutable assets and the `static` files (`immutable` and `assets` from `$app/manifest`, under a cache named after `version` from `$app/env`), and answers those paths cache-first. The lookup passes `ignoreVary: true`, because these paths are content-hashed and never change. `vite preview` answers chunks with `Vary: Origin`, and a module script's request carries an `Origin` header that the install's `addAll` request didn't, so a plain `caches.match` missed every chunk: offline client navigation failed with a 500, and so did any lazy `import()`. In production, adapter-node sends `Vary: Accept-Encoding`, `Cache-Control: public,max-age=31536000,immutable` and a precompressed `Content-Encoding: br`, and Caddy's `encode` keeps `Vary: Accept-Encoding`. The worker relies on none of them: it matches by URL alone. When a route still can't load and `/_app/version.json` is unreachable, `+error.svelte` shows "Can't reach Conveyor" instead of a 500. `precached` in `precache.ts` leaves out `*.wasm`, three's `draco_*` and `basis_*` decoders, legacy `*.woff` fonts and the non-Latin font subsets, which the app never needs offline. It also leaves out the profile editor's CodeMirror chunk, which Settings loads on demand: the `conveyor:editor-chunks` plugin in `vite.config.ts` lists the client chunks that hold `@codemirror` modules and are reached only through `import()`, hands that list to the worker as `virtual:editor-chunks`, and writes it to `.svelte-kit/output/editor-chunks.json`. SvelteKit names every chunk by hash alone, so the chunk can't be singled out by name. Without a connection, the editor page says it needs one to load. It never caches API or websocket traffic. Only the precached paths are cached at all, but it also skips everything under `/api/`, so an API path added to the precache by mistake can't serve a stale catalog.

## Releases

Pushing a `v*` tag, or running `.github/workflows/release.yml` by hand, builds the `api`, `web` and `worker` images and publishes multi-arch (amd64 and arm64) manifests to GHCR, authenticated with the built-in `GITHUB_TOKEN`. The image path is `ghcr.io/<owner>/conveyor-<service>` with the owner lowercased, because GHCR requires a lowercase path and the owner (`OnlyOneByte`) is mixed-case. Each image and architecture builds on a native runner, because the worker's engine downloads are too heavy to emulate. Each build pushes an untagged image by digest; a per-service job joins the two digests into one tag set: `x.y.z`, `x.y`, `latest` (tag runs only) and `sha-<short>`. A manual run on a branch therefore never moves `latest`. Release builds keep `ORCA_ENABLE` at its `auto` default, unlike CI, which disables Orca. The build cache uses `mode=min`: exporting every intermediate layer of the multi-gigabyte worker image was the likely cause of the v0.1.0 arm64 failure. A newer run for the same ref cancels the older one. Each build pushes a SLSA provenance attestation (`provenance: mode=max`) and an SPDX SBOM (`sbom: true`) with its image, and the multi-arch tag carries both; `docker buildx imagetools inspect <image>:<tag> --format '{{json .Provenance}}'` (or `.SBOM`) reads them.

### Bundle budget (`bun run check:bundle`)

CI's `bundle` job builds the web app and runs `scripts/checks/bundle.ts` on `packages/web/.svelte-kit/output`. Run it locally after `bunx vite build` in `packages/web`.

- **Initial JS** for a route is every chunk its first load fetches: the client entries plus the route's layout and page nodes (from the server manifest), and their static imports from `.vite/manifest.json`, gzip -9. Dynamic imports don't count. Every page route is measured, and finding none fails the check, as does a budgeted route the build doesn't have or no budget for `/`. Every route needs its own limit in `scripts/checks/bundle/budget.json`, so a new route fails until it has one (the error suggests about 10% over what it measures); the committed limits are about 10% over each route's measured size. No route's initial JS may contain Zod (its `ZodError` class) or build code at runtime, which the strict CSP refuses; this checks each route's own first-load graph, where `layout-bundle.ts` covers only the shared bundle. Building code is found in each chunk's syntax tree (`scripts/checks/bundle/builds-code.ts`, TypeScript's parser), so text inside strings, such as a CSP's `'unsafe-eval'`, never counts. It flags any reference to `eval` or `Function` as a value: called directly, through `globalThis`, `window`, `self` or `global` (`globalThis.eval(`, `window["eval"]`), destructured (`const { Function: F } = globalThis`) or in a shorthand object (`{ eval }`). It also flags `Function` read off any object (`root.Function("return this")()`, as lodash and core-js do). It also flags a function's `.constructor` called with a string, and `setTimeout` or `setInterval` given a string. It leaves alone `x instanceof Function`, `typeof Function`, `Function.prototype`, property and method names, and `eval` on any other object (`client.eval(...)`). It is still a heuristic, and these get past it: a global name assembled from runtime strings; `eval` read off a global through an alias (`const g = globalThis; g.eval(…)`) or through `top`, `parent` or `frames`; a compiler reached with `.call` or `.apply` (`setTimeout.call(null, "…")`); a timer whose string isn't a literal (`setTimeout(code)`); and code a page loads with `import()` from `onMount`, because only static imports count toward a route's first load. And no route's initial JS may contain three.js (a chunk counts as three.js when any module it was built from sits under `node_modules/three/`, or its code carries three's `__THREE__` signature, which also catches a vendored copy; `vite.config.ts`'s `chunkModules` plugin writes those module ids per chunk to `.svelte-kit/output/chunk-modules.json` on every client build).
- **Precache** is the exact list the built `service-worker.js` hands `cache.addAll` on install: the check runs the worker's install handler in a sandbox (`node:vm`) with stub `self` and `caches`, so any filter in the worker counts. The `precached` filter is tested on its own in `precache.test.ts`. A worker that registers no install handler, or precaches nothing, fails the check. It fails when an immutable `.js` or `.css` is left out (the editor chunks from `editor-chunks.json` excepted), when the build lists no editor chunk, when an editor chunk is precached, and when raw or gzip size grows more than 10% past the committed numbers. When the growth is wanted, run `bun run check:bundle:update` and commit `budget.json`; CI refuses `--update`. A `budget.json` without positive numbers fails the check instead of passing it. `budget.json` is also compared with the base branch, like the other ratchets: a route's limit may not rise or be dropped, and the precache numbers may not rise more than 10% in one change. CI passes the base with `--base`; locally it defaults to `origin/main`.

### Measuring Make (`make-perf.yml`)

An optional job compares how fast Make (`/`) loads on two refs, on a CI runner instead of a busy laptop. It runs only when asked: add the `measure:make` label to a PR (it compares the PR's base with its head), or run **Make performance** from the Actions tab with a `base` and a `head` ref.

- It builds the web app at both refs and serves both through one Caddy configured like production: `encode gzip zstd`, TLS, and `/api` stripped and proxied, all on 127.0.0.1 with Caddy's admin API off. One api (SQLite queue, auth disabled) serves both. Every port is picked free at start, so a run can't collide with anything else on the machine, including a local run of the script.
- Lighthouse 12.8.2 runs on each with its default mobile settings and simulated throttling: one warm-up each, then `runs` rounds (10 by default) in alternating order, base first on odd rounds, head first on even ones.
- The job summary has the medians of time to interactive, first contentful paint, largest contentful paint and total blocking time, with the change. A run Lighthouse fails or reports as failed is left out, the job carries on, and the run counts show it. The summary is written even when an earlier step fails. The raw reports are in the `make-perf` artifact.
- Every label added to any PR starts a **Make performance** run, which skips at once unless the label is `measure:make`. GitHub can't filter `labeled` events by name before a run is created.
- `scripts/perf/make-ab.sh` and `scripts/perf/summary.ts` do the work; the job runs them from the workflow's own commit, so either ref can predate them.

