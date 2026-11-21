# AGENTS.md: Conveyor engineering rules

Binding for every contributor, human or agent. Read it before every task.
When the code and this file disagree, fix the code. Changing this file needs the owner's review (CODEOWNERS).

Tags: **[CI]** a required check fails the PR today. **[review]** the adversarial reviewer blocks it (an S1 under
[the rubric](#review-gate)). Every [review] rule becomes [CI] as the guard grows; treat both as hard rules.

## 0. Golden rules

1. No comments in code, ever, including suppressions. [CI] Prose goes in `docs/`.
2. One concern per PR. Every required check is green before review.
3. Types are the documentation: make illegal states unrepresentable.
4. Delete before you add. No code "for later".
5. Every UI change ships with screenshots, and a GIF when anything moves. [review]

## 1. Repository layout (today)

```
packages/shared/        domain types, zod schemas, SQLite access (bun:sqlite)
packages/api/           Fastify REST + WebSocket front door, enqueues jobs
packages/worker/        BullMQ worker, drives generate → slice → transport
packages/web/           SvelteKit PWA (rewrite pending, see Stack (TBD))
plugins/<kind>/<name>/  generators | slicers | transports
scripts/checks/         house-rule checkers (no-comments ratchet)
docs/                   all prose; index in docs/README.md
```

How it fits together: [docs/architecture.md](docs/architecture.md).
Dependencies flow one way: `web → shared`, `api → plugins → shared`, `worker → plugins → shared`. Nothing
imports from `api`, `worker` or `web`, and plugins import only `shared`. [review]

## 2. No comments [CI: `no-comments`]

- Banned in `*.ts`, `*.js`, `*.mjs`, `*.cjs`, `*.svelte` (script, markup and style), `*.css`, `*.html`: `//`,
  `/* */`, `/** */`, `<!-- -->`. In `Dockerfile*`, `Caddyfile`, `*.yml`, `*.yaml`, `*.toml`, `*.sh`: any
  full-line `#`. Allowed: a shebang on line 1 and a Dockerfile `# syntax=` directive. Markdown is exempt.
- Suppressions are comments: no `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `biome-ignore`,
  `eslint-disable`, `svelte-ignore`, `prettier-ignore`, `shellcheck disable`. A wrong rule is fixed in config.
- Commented-out code is a comment. Delete it; git remembers.
- Instead of a comment, in order: rename the symbol, extract a named function, encode it in a type, write a
  test whose name states the rule, or write it in `docs/modules/<module>.md`.
- Strings containing `//` are fine: the checker parses, it doesn't grep.

**How the ratchet works.** `scripts/checks/comments.ts` counts comment lines and suppressions per file and
compares each file with the base branch's `scripts/checks/comments-baseline.json`.

| You did | Result |
|---|---|
| Added a comment to any file | `added: …` and the check fails |
| Removed comments | `baseline … is stale`: run `bun run check:comments:update` and commit the JSON |
| Raised a number in the baseline by hand | `baseline raised: …` and the check fails |

Counts only go down. The target is 0 everywhere; then the check switches to `--strict`.

## 3. Naming [review]

- Files `kebab-case.ts`. Tests `<file>.test.ts`, next to the file they test. Component naming: Stack (TBD).
- Functions start with a verb (`claimNextJob`). Booleans start with `is`, `has`, `can`, `should`. Types are
  `PascalCase` nouns: no `I` prefix, no `Type` suffix.
- No abbreviations except `id`, `url`, `api`, `ui`, `db`, `mm`, `stl`, `gcode`. Units in names (`heightMm`,
  `timeoutMs`).
- `SCREAMING_CASE` only for module-level primitive constants.
- Named exports only. `export default` only where a framework demands it (`*.config.ts`, `*.config.js`).

## 4. Size limits

| Limit | Max | Enforced |
|---|---|---|
| Lines per file | 250 | [review] |
| Lines per UI component | 150 | [review] |
| Cognitive complexity per function | 12 | [CI] in `scripts/**`, [review] elsewhere |
| Positional parameters | 3 (then pass one object) | [CI] in `scripts/**`, [review] elsewhere |
| Changed lines per PR | 400 (lockfiles, snapshots, migrations, `docs/design/**`, pure deletions excluded) | [review]: 401–800 asks for a split, over 800 needs the owner's `large-ok` label |

## 5. Types [CI: `typecheck`, 0 errors]

- `strict` is on. The target set (added by an infra PR, not by hand-waving): `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`,
  `noFallthroughCasesInSwitch`. Never turn a flag off.
- No `any`, written or implied (untyped `JSON.parse`, a `catch (e)` used as an object). Use `unknown` and narrow.
- No `as` casts except `as const`. No non-null `!` ([CI] in `scripts/**`). Parse values; don't assert them.
- No `enum`. Use a string-literal union with a `const` array:
  `export const JOB_STATES = ["queued", "slicing", "done"] as const; export type JobState = (typeof JOB_STATES)[number];`
- IDs are branded, never bare `string`:
  `export const JobId = z.string().brand<"JobId">(); export type JobId = z.infer<typeof JobId>;`
- Model state as discriminated unions on `kind`.
- Every `switch` or `if` chain over a union is exhaustive and ends in `default: return absurd(value)`, with
  `absurd(value: never): never` in `shared`.
- Validate external input (HTTP, env, files, plugin output, printer replies) with zod once, at the edge.
  Inside, trust the types.

## 6. Errors [review]

- Domain code returns `Result<T, E>` and does not throw. `E` is a tagged union:
  `{ kind: "PrinterUnreachable"; printerId: PrinterId }`.
- Only adapters throw or catch: the HTTP layer maps each `kind` to a status code and a `{ kind, message }` body
  in one table. The UI maps `kind` to plain-language copy; raw codes appear only under "Details".
- No empty `catch`, no `.catch(() => {})`, no catch that only logs. Handle it, convert it to a tagged error,
  or let it crash.
- Cancellation goes through `AbortSignal`, passed to every stage and every `Bun.spawn`.

## 7. Testing [CI: `test`]

- Test every exported function in `shared` and the worker pipeline, every HTTP route (inject requests, no
  real port), every plugin against recorded fixtures (no real printer), and every key UI flow end to end in
  stub mode (`CONVEYOR_ENGINE_STUB=1`).
- Don't test framework internals, trivial getters, or generated CSS.
- Names state behaviour: `test("claim skips printers that already have a running job")`.
- Assert outputs and side effects. `toBeDefined()`, "does not throw" alone, and snapshots of logic are fake tests.
- Deterministic: inject the clock and the ID generator; no real network, no sleeps for ordering.
- Every bug fix includes a test that fails on the parent commit.
- Coverage target is 80% lines and functions. Until then coverage must not drop. [review]
- Prove a new test bites: break the production line it covers and watch it fail.

## 8. Commits, branches and PRs

- **Titles** are Conventional Commits; squash merge uses the PR title. [review]
  `^(feat|fix|refactor|perf|test|docs|build|ci|chore|revert)(\((web|api|worker|shared|engine|queue|db|core|plugins|infra|guard|tools|docs|deps)\))?!?: \S.{0,70}$`
  Imperative, lower-case after the colon, no trailing period, at most 72 characters. Use the real package
  name as the scope (`web`, `api`, `worker`, `shared`, `plugins`); `guard` is `scripts/checks`, `tools` is
  `tools/`. Breaking changes carry `!` and a `BREAKING CHANGE:` line in the body.
- **Branches**: `<type>/<slug>` or `<type>/<issue>-<slug>` (`feat/42-sqlite-queue`). Never push to `main`.
- **Issue first.** Every PR names one issue on its own line: `Closes #N`, or `Part of #N` when it stays open.
- **Template**: fill every section of `.github/PULL_REQUEST_TEMPLATE.md` with real content. An empty section
  is an S1.
- **Labels**: `agent` on agent-authored PRs, plus one `area/*` (`area/backend`, `area/ui`, `area/infra`).
- Merges are squash-only. Agents never merge by hand; auto-merge lands a PR once the gate below is green.
- **UI PRs** (anything touching `packages/web/**`, `docs/design/**`, `*.svelte`, `*.css`, or a user-visible
  string) put before/after images in `## Visuals`, a GIF for motion or multi-step flows, desktop 1440×900 and
  mobile 390×844 when layout changes, and a `Provenance:` line naming the head sha. Missing visuals fail
  review outright.

## 9. CI: required checks

Job names in `.github/workflows/ci.yml` are the check names. Run the same commands locally before you push.

| Check | Local command |
|---|---|
| `lint` | `bun run lint` |
| `format` | `bun run format:check` (fix with `bun run format`) |
| `typecheck` | `bun run typecheck`, then in `packages/web`: `bunx svelte-kit sync && bunx svelte-check` |
| `test` | `bun test --coverage` |
| `no-comments` | `bun run check:comments` |
| `Docker build (api / worker / web)` | `docker build -f packages/<service>/Dockerfile .` |
| `conveyor/adversarial-review` | set by the reviewer, never by the author |

## Review gate

`conveyor/adversarial-review` is a commit status posted by a separate reviewer agent in a fresh session. It
sees only the diff, the linked issue, this file, CI results and the visuals, and its job is to find the reason
not to merge. It follows `RUBRIC.md` in the reviewer kit; this file wins where they disagree.

| Tag | Meaning | Blocks |
|---|---|---|
| `[S0]` | Security hole, data loss, corrupt state, broken `main`, auth or bind regression | Yes, never deferrable |
| `[S1]` | Real bug, missing or fake test, rule violation in this file, missing visuals, unverifiable claim | Yes |
| `[S2]` | Works but worse than it should be | No: fix now or file an issue |
| `[S3]` | Nit, said once | No |

Any S0 or S1 sets the status to `failure`. As the author: fix it, or rebut it on the thread with evidence.
Never set the status yourself, never re-request review without a new push, and never argue a rule here away
in a thread; change it in a PR.

## 10. Security [review]

- Default bind is loopback. A new listener on `0.0.0.0` or a published port without auth is S0.
- Every new route is behind auth unless its issue says otherwise.
- Paths built from user input are normalised and checked for containment.
- User input reaches `Bun.spawn` only as an argv element, never in a shell string. No string-built SQL.
- No secrets in code, logs, fixtures, screenshots or PR bodies.
- Workflows: no `pull_request_target` running PR code; `permissions:` stays minimal.

## 11. Dependencies and experiments

- Adding a dependency needs one line in the PR body saying why the standard library or existing code isn't
  enough. A decision with alternatives gets an ADR in `docs/adr/`.
- Experiments are welcome: at most one PR a week trials a new tool or framework, behind an ADR with an exit
  criterion. It is reverted if the criterion isn't met in 2 weeks.

## 12. Docs

- Index: [docs/README.md](docs/README.md). Every doc page is linked from it.
- A change to public exports, a route, an env var, a CLI flag, a config key or a plugin contract updates the
  matching page in the same PR. [review]
- Docs are audited on a cadence: [docs/audit.md](docs/audit.md).

## Stack (TBD)

The UI rewrite's framework (Svelte 5 or Solid) is not decided. Until its ADR merges, this section holds only
placeholders, and today's `packages/web` (SvelteKit, Svelte 4) follows the language-level rules above.
The ADR's PR fills in:

- Component file naming and the 150-line component limit's exact scope.
- Reactivity rules (runes or signals only; no legacy APIs) and how logic moves out of components into
  testable `*.ts` modules.
- The typed API client components must use (no raw `fetch` in components).
- Styling: design tokens in one place, no raw colour literals outside them.
- Accessible primitives for dialogs, menus, selects and popovers.
- E2E and visual-capture tooling.
