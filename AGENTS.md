# AGENTS.md: Conveyor engineering rules

Binding for every contributor, human or agent. Read it before every task.
When the code and this file disagree, fix the code. How changes to this file are gated: [§12](#12-guardrail-paths).

Every rule carries its own tag. **[CI]** a required check fails the PR today. **[review]** the adversarial
reviewer enforces it: a violation is S1 (blocks merge) unless [the rubric](docs/review-rubric.md) names a lower
severity for that case. Rules move from [review] to [CI] as the guard grows; treat both as hard rules.

## 0. Golden rules

1. No comments in code, ever, including suppressions. [CI] Prose goes in `docs/`.
2. One concern per PR. Related small issues in one area count as one concern. [review]
3. Types are the documentation: make illegal states unrepresentable. [review]
4. Delete before you add. No code "for later". [review]
5. Every UI change ships with screenshots, and a GIF when anything moves. [review]

## 1. Repository layout (today)

```
packages/shared/        domain types, zod schemas, SQLite access (bun:sqlite)
packages/api/           Fastify REST + WebSocket front door, enqueues jobs
packages/worker/        job worker (BullMQ, or SQLite via CONVEYOR_QUEUE + CONVEYOR_QUEUE_UNSTABLE), drives generate → slice → transport
packages/web/           SvelteKit PWA (rewrite pending, see Stack (TBD))
plugins/<kind>/<name>/  generators | slicers | transports
scripts/checks/         house-rule checkers (no-comments, coverage and file-size ratchets)
tools/visual/           screenshot and GIF capture for UI PRs
docs/                   all prose; index in docs/README.md
```

How it fits together: [docs/architecture.md](docs/architecture.md). Dependency rule: nothing imports from
`api`, `worker` or `web`; generator plugins import only `shared`. An import against the documented direction
is S1. [review]

## 2. No comments

The guard in `scripts/checks/comments/` is the source of truth; when this text and the guard disagree, the guard
wins. What it counts today:

- `//`, `/* */`, `/** */` and `<!-- -->` in `*.ts`, `*.tsx`, `*.mts`, `*.cts`, `*.js`, `*.jsx`, `*.mjs`,
  `*.cjs`, `*.svelte` (script, markup and style), `*.css`, `*.html` and JSONC (`tsconfig*.json`, `biome.json`,
  `*.jsonc`). [CI]
- Any `#` comment, full-line or trailing, in `Dockerfile*` (including `# syntax=`), `Caddyfile`, `*.yml`,
  `*.yaml`, `*.toml` and `*.sh`. Only a shebang on line 1 is allowed. [CI]
- Every suppression: `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck`, `biome-ignore`, `eslint-disable`,
  `prettier-ignore`, `svelte-ignore`, `shellcheck disable`. A wrong rule is fixed in config. [CI]
- Commented-out code is a comment. Delete it; git remembers. [CI]
- Markdown is exempt. Strings containing `//` are fine: the guard parses, it doesn't grep.

Instead of a comment, in order: rename the symbol, extract a named function, encode it in a type, write a
test whose name states the rule, or write it in `docs/modules/<module>.md`.

**How the ratchet works.** `scripts/checks/comments.ts` counts comment lines and suppressions per file and
compares each file with the base branch's `scripts/checks/comments/baseline/<area>.json` files (one per area: `api`, `worker`, `shared`, `web`, `plugins`, `repo`). The `no-comments` check:

| You did | Result |
|---|---|
| Added a comment to any file | `added: …` and the check fails |
| Removed comments | `baseline … is stale`: run `bun run check:comments:update` and commit the area files it rewrites |
| Raised a number in the baseline by hand | `baseline raised: …` and the check fails |

Counts only go down. The target is 0 everywhere; then the check switches to `--strict`.

## 3. Naming

- Files `kebab-case.ts`. Tests `<file>.test.ts`, next to the file they test. Component naming: Stack (TBD). [review]
- Functions start with a verb (`claimNextJob`). Booleans start with `is`, `has`, `can`, `should`. Types are
  `PascalCase` nouns: no `I` prefix, no `Type` suffix. [review]
- No abbreviations except `id`, `url`, `api`, `ui`, `db`, `mm`, `stl`, `gcode`. Units in names (`heightMm`,
  `timeoutMs`). [review]
- `SCREAMING_CASE` only for module-level primitive constants. [review]
- Named exports only. `export default` only where a framework demands it (`*.config.ts`, `*.config.js`). [review]
- A weak name, one that needs a comment to make sense, is S2. A misleading name is S1. [review]

## 4. Size limits

| Limit | Max | Tag |
|---|---|---|
| Lines per file | 250 | [CI: `file-size`]; also [review], S1, in `packages/web`, which Biome doesn't format |
| Lines per UI component (`.svelte`) | 150 | [CI: `file-size`]; also [review], S1 |
| Cognitive complexity per function | 12 | [CI] in `scripts/**`; [review], S1, elsewhere |
| Positional parameters | 3 (then pass one object) | [CI] in `scripts/**`; [review], S1, elsewhere |

The `file-size` check counts lines in code, style and component files (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs`, `.jsx`, `.svelte`, `.css`). A file listed in `scripts/checks/lines/baseline.json` may stay as long as its entry there; every other file must keep to the limit. The baseline only shrinks: an entry above the base branch's, or a new entry, fails, and so does a baseline that no longer matches the files over the limit.

## 5. Types

- `tsc` (with `strict`) and `svelte-check` report 0 errors. [CI: `typecheck`]
- Target flags, added by an infra PR: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `noFallthroughCasesInSwitch`. Never turn a flag
  off. [review]
- No explicit `any`. [CI: `lint`, outside `packages/web`; review inside it] No implied `any` either (untyped
  `JSON.parse`, a `catch (e)` used as an object): use `unknown` and narrow. [review]
- No non-null `!`. [CI: `lint`, outside `packages/web`; review inside it]
- No `as` casts except `as const` (or `<const>`). Parse values; don't assert them. [CI: `lint`, through
  `bun run check:casts` over every `.ts` file and Svelte `<script>` block; the casts that predate it are
  listed in `scripts/checks/casts/baseline.json`, which may only shrink. A file that is new to the base may
  take over a removed file's allowance only when `git diff -M -C` pairs the two as a rename or copy (a
  split), and never more than the removed file had. Casts inside Svelte markup: review]
- No `enum`. Use a string-literal union with a `const` array:
  `export const JOB_STATES = ["queued", "slicing", "done"] as const; export type JobState = (typeof JOB_STATES)[number];` [review]
- IDs are branded, never bare `string`:
  `export const JobId = z.string().brand<"JobId">(); export type JobId = z.infer<typeof JobId>;` [review]
- Model state as discriminated unions on `kind`. [review]
- Every `switch` or `if` chain over a union is exhaustive and ends in an exhaustive-never helper
  (`(value: never): never`), so a new member is a type error. [review]
- Validate external input (HTTP, env, files, plugin output, printer replies) with zod once, at the edge.
  Inside, trust the types. [review]

## 6. Errors

- Domain code returns `Result<T, E>` and does not throw. `E` is a tagged union:
  `{ kind: "PrinterUnreachable"; printerId: PrinterId }`. [review]
- Only adapters throw or catch: the HTTP layer maps each `kind` to a status code and a `{ kind, message }` body
  in one table. The UI maps `kind` to plain-language copy; raw codes appear only under "Details". [review]
- No empty `catch`, no `.catch(() => {})`, no catch that only logs. Handle it, convert it to a tagged error,
  or let it crash. [review]
- Cancellation goes through `AbortSignal`, passed to every stage and every `Bun.spawn`. [review]

## 7. Testing

- The suite passes. [CI: `test`]
- Test every exported function in `shared` and the worker pipeline, every HTTP route (Fastify `inject`, or a
  listener on `127.0.0.1:0` driven with `fetch` where `inject` misbehaves under Bun), every plugin against recorded fixtures (no real printer), and every key UI flow end to end in
  stub mode (`CONVEYOR_ENGINE_STUB=1`). Don't test framework internals, trivial getters or generated CSS. [review]
- Names state behaviour: `test("claim skips printers that already have a running job")`. [review]
- Assert outputs and side effects. `toBeDefined()`, "does not throw" alone, and snapshots of logic are fake
  tests. [review]
- Deterministic: inject the clock and the ID generator; no real network, no sleeps for ordering. [review]
- Every bug fix includes a test that fails on the parent commit. [review]
- Prove a new test bites: break the production line it covers and watch it fail. [review]
- Coverage target is 80% lines and functions. Until then coverage must not drop. [review]
- Line coverage of `api`, `worker`, `shared` and `plugins` may not fall more than 0.5 percentage points
  below the base's `scripts/checks/coverage/baseline/`. [CI: `test`]

## 8. Commits, branches and PRs

- **Titles** are Conventional Commits; squash merge uses the PR title. [CI: `pr-meta`]
  `^(feat|fix|refactor|perf|test|docs|build|ci|chore|revert)(\((web|api|worker|shared|engine|queue|db|core|plugins|infra|guard|tools|docs|deps)\))?!?: \S.{0,70}$`
  Imperative, lower-case after the colon, no trailing period, at most 72 characters. Use the real package
  name as the scope (`web`, `api`, `worker`, `shared`, `plugins`); `guard` is `scripts/checks`, `tools` is
  `tools/`. Breaking changes carry `!` and a `BREAKING CHANGE:` line in the body.
- **Branches**: `<type>/<slug>` or `<type>/<issue>-<slug>` (`feat/42-sqlite-queue`). Never push to `main`.
- **Issue first.** Every PR names each issue it answers, one per line: `Closes #N`, or `Part of #N` when
  it stays open. A PR may name several. [CI: `pr-meta` checks that each one named is an existing issue;
  review checks it is the right one]
- **Template**: fill every section of `.github/PULL_REQUEST_TEMPLATE.md` with real content. [review]
- **Labels**: `agent` on agent-authored PRs (those opened by the `OnlyOneByte` account), plus exactly one
  `area/*` (`area/backend`, `area/ui`, `area/infra`). [CI: `pr-meta`]
- **Merging**: squash by default. A merge commit only for a format-only commit that must survive for
  `.git-blame-ignore-revs`. Agents never merge by hand; the merge tooling lands a PR once the gate is green.
- **UI PRs** (anything touching `packages/web/**`, `docs/design/**`, `*.svelte`, `*.css`, or a user-visible
  string) put before/after images in `## Visuals`, a GIF for motion or multi-step flows, desktop 1440×900 and
  mobile 390×844 when layout changes, and a `Provenance:` line naming the head sha. Missing visuals fail
  review outright. [review]

## 9. CI: required checks

Job names in `.github/workflows/ci.yml` are the check names. Run the same commands locally before you push.

| Check | Local command |
|---|---|
| `lint` | `bun run lint && bun run check:casts`; after removing a cast, run `bun run check:casts:update` and commit `scripts/checks/casts/baseline.json` |
| `format` | `bun run format:check` (fix with `bun run format`) |
| `typecheck` | `bun run typecheck`, then in `packages/web`: `bunx svelte-kit sync && bunx svelte-check`, then `bunx vite build` and `bun scripts/checks/layout-bundle.ts` (no Zod in the layout's import closure) |
| `test` | `bun run test:coverage && bun run check:coverage`, then the suite once more in a seeded random order over an `LC_ALL=C`-sorted file list (the log prints the seed, the commit, how to check it out and the rerun command, not the file list itself); after raising coverage 0.5 or more, run `bun run check:coverage:update` and commit the `scripts/checks/coverage/baseline/<package>.json` files it rewrites |
| `no-comments` | `bun run check:comments` |
| `file-size` | `bun run check:lines`; after shrinking a file in `scripts/checks/lines/baseline.json`, run `bun run check:lines:update` and commit the baseline |
| `Docker build (api / worker / web)` | `docker build --build-arg ORCA_ENABLE=0 -f packages/<service>/Dockerfile .` |
| `compose` | CI only: builds the stack, runs `docker compose up -d`, waits for `https://localhost/api/health` through Caddy, checks that only Caddy publishes and only on `127.0.0.1`, that failed logins are counted per real client, and that api, worker and web each run as uid/gid `10001` with no effective capabilities, a bounding set of only `CHOWN SETUID SETGID DAC_READ_SEARCH` (none for web), no extra groups, `NoNewPrivs` and a read-only root, with `secrets.key` at `10001:10001 0600`, then `docker compose down -v` |
| `pr-meta` | CI only, from the PR's own metadata, no code checked out: the title pattern and length, the labels, and the issue lines (§8). It re-runs when the title, body or labels change, so fix them in place; Dependabot PRs are skipped |
| `conveyor/adversarial-review` | set by the reviewer, never by the author |

Review may start before CI is green. Merge needs both: every required check and the review status green on
the same head sha.

## 10. Review gate

`conveyor/adversarial-review` is a commit status posted by a separate reviewer agent in a fresh session. Its
job is to find the reason not to merge: it checks out the head, runs the checks itself, breaks production
lines to prove tests bite, opens the running app for UI changes, and reproduces every claim in the PR body.
It follows [docs/review-rubric.md](docs/review-rubric.md); this file wins where the two disagree.

| Tag | Meaning | Blocks |
|---|---|---|
| `[S0]` | Security hole, data loss, corrupt state, broken `main`, auth or bind regression | Yes, never deferrable |
| `[S1]` | Real bug, missing or fake test, rule violation, missing visuals, unverifiable claim | Yes |
| `[S2]` | Works but worse than it should be | No: fix now or file an issue |
| `[S3]` | Nit, said once | No |

Any S0 or S1 sets the status to `failure`. As the author: fix it, or rebut it on the thread with evidence,
then push. Never set the status yourself, and never argue a rule away in a thread; change it in a PR.

## 11. Security [review]

- Default bind is loopback. A new listener on `0.0.0.0` or a published port without auth is S0.
- Every new route is behind auth unless its issue says otherwise.
- Paths built from user input are normalised and checked for containment.
- User input reaches `Bun.spawn` only as an argv element, never in a shell string. No string-built SQL.
- No secrets in code, logs, fixtures, screenshots or PR bodies.
- Workflows: no `pull_request_target` running PR code; `permissions:` stays minimal.
- Adding a dependency needs one line in the PR body saying why the standard library or existing code isn't
  enough. A decision with alternatives gets an ADR in `docs/adr/`.
- Experiments are welcome: at most one PR a week trials a new tool or framework, behind an ADR with an exit
  criterion. It is reverted if the criterion isn't met in 2 weeks.

## 12. Guardrail paths

Guardrail paths: `.github/**`, `scripts/checks/**`, `AGENTS.md`, `CLAUDE.md`, and `CODEOWNERS`, `biome.json`,
`biome.jsonc`, `tsconfig*.json` and `bunfig.toml` at any depth (so `packages/web/tsconfig.json` counts).
`merge.sh` exempts `scripts/checks/comments/baseline/{api,worker,shared,web,plugins,repo}.json` and `scripts/checks/coverage/baseline/{api,worker,shared,plugins}.json`, so a PR
that only lowers a baseline is not held. A guardrail-path PR needs a passing adversarial review from
a second, independent reviewer session that saw none of the earlier rounds. The merge tooling refuses
guardrail-path PRs unless the conductor sets `CONVEYOR_GUARDRAIL_OK=1`, which it does only after that
independent pass. Keep guardrail changes in their own PR.

## 13. Docs

- Index: [docs/README.md](docs/README.md). Every doc page is linked from it. [review]
- A change to public exports, a route, an env var, a CLI flag, a config key or a plugin contract updates the
  matching page in the same PR. [review]
- Docs are audited on a cadence: [docs/audit.md](docs/audit.md).

## Stack (TBD)

The UI rewrite's framework (Svelte 5 or Solid) is not decided. Until its ADR merges, this section holds only
placeholders, and today's `packages/web` (SvelteKit on Svelte 5, still written in Svelte 4 component syntax) follows the language-level rules above.
The ADR's PR fills in:

- Component file naming and the 150-line component limit's exact scope.
- Reactivity rules (runes or signals only; no legacy APIs) and how logic moves out of components into
  testable `*.ts` modules.
- The typed API client components must use (no raw `fetch` in components).
- Styling: design tokens in one place, no raw colour literals outside them.
- Accessible primitives for dialogs, menus, selects and popovers.
- E2E and visual-capture tooling.
