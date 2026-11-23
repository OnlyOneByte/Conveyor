# Adversarial review rubric

The reviewer's job is to find the reason this PR should not merge. A PR passes only when you looked for that reason in every section below and did not find one. "I did not check" is not a pass: either check it, or write it down as an S1 `could not verify`.

The repo's `AGENTS.md` is the source of truth for limits and conventions. Where it exists and disagrees with a number here, `AGENTS.md` wins.

## Severity levels

Every inline comment and every body finding starts with exactly one tag. `post-review.sh` rejects inline comments without one, and `merge.sh` refuses to merge while any unresolved thread starts with `[S0]` or `[S1]`.

| Tag | Name | Meaning | Blocks merge |
|---|---|---|---|
| `[S0]` | Critical | Security hole, data loss, corrupts state, breaks `main` (build, deploy, migration), or an auth or bind regression. | **Yes**, and never deferrable |
| `[S1]` | Major | A real bug on a reachable path, a missing or fake test for new logic, a rule violation that CI enforces or will enforce (comments, `any`, size limits), missing UI visuals, or a claim you could not verify. | **Yes** |
| `[S2]` | Minor | Works, but is worse than it should be: a weak name, a missed edge case on an unlikely path, an untested trivial branch, docs that are thin but not wrong. | No. Fix now or the author files an issue |
| `[S3]` | Nit | Taste. Say it once, never re-raise it. | No |

Verdict rule: **any S0 or S1 means `verdict: "fail"` and status `failure`**. Zero S0/S1 means `pass`. There is no "pass with concerns" for an S1.

Severity is about the consequence, not the size of the fix. A one-character fix to a data-loss bug is S0.

## Checklist

Work through every section on every PR. In the review body, list each section as `checked`, `n/a (why)`, or the finding tags it produced.

### 1. Correctness
- Read every changed line, then read the callers and callees of every changed function. Bugs live at the seams.
- Trace one real input end to end through the new code. Write down the input you used.
- Does it do what the linked issue asks, and only that? Behaviour the issue did not ask for is S1 scope creep when it is user-visible, S2 otherwise.
- State machines (job states, stages, queue claims, leases, cancel): enumerate every transition the diff touches. A transition that leaves a job stuck, double-claimed or silently dropped is S0.
- Concurrency: two workers, two jobs on one printer, cancel during a stage, a retry after a partial write, a crash between two writes. Unhandled is S1; corrupting is S0.
- Error paths: every `await`, spawn, fetch, file and DB call. Swallowed errors (`catch {}`, `.catch(() => {})`, catch-and-log) are S1.
- Removed code: what relied on it? `git grep` for every removed export, route, env var, config key and CSS class.

### 2. Edge cases
Check the ones that apply and name them in the body:
- Empty, one, many, and the maximum. Zero and negative numbers, `NaN`, very large values, units (mm vs cm).
- Missing, `null` and `undefined` fields; extra fields; unicode, spaces and `..` in names and paths.
- Network: timeout, refused, slow, partial response, duplicate delivery.
- Time: clock skew, DST, timers firing after teardown.
- UI: empty state, loading, error, very long text, narrow (390 px) and wide (1440 px), keyboard only, reduced motion.

### 3. Tests that assert behaviour
- Every new branch, loop, parser, state transition and bug fix has a test. Missing is S1.
- **Prove the test bites**: revert or break the production change locally and rerun the test. A test that still passes is fake: S1. Write down which line you broke.
- Assertions check outputs and side effects, not that a mock was called. `expect(x).toBeDefined()`, snapshot-of-logic and "does not throw" as the only assertion are S1.
- Test names state the rule (`claim skips printers that already have a running job`).
- Deterministic: injected clock and IDs, no real network, no sleeps for ordering, no order dependence. Run the changed tests 3 times; a flake is S1.
- A bug fix includes a test that fails on the parent commit. Show it.
- Coverage must not drop below the ratchet baseline (S1).

### 4. Types
- No `any`, explicit or implied (`JSON.parse` result used untyped, untyped catch variable used as an object). S1.
- No `as` casts other than `as const`, no non-null `!`, no `@ts-ignore` or `@ts-expect-error`. S1.
- No `enum`; string literal unions with a `const` array.
- Every `switch` or `if` chain over a union is exhaustive and ends in `absurd(value)`. A union member that falls through silently is S1.
- External input (HTTP, env, files, plugin output, printer replies) is parsed with zod once, at the edge. Unparsed input reaching domain code is S1; reaching a shell, path or SQL is S0.
- IDs are branded types, not bare `string`.
- `tsc` and `svelte-check` report 0 errors and 0 warnings.

### 5. Security
- Binds: anything listening on `0.0.0.0` or a published port without auth is S0. Default bind is loopback.
- Auth: every new route is behind auth unless the issue says otherwise. A weakened auth check is S0.
- Paths: uploads and user-supplied names joined into paths without normalising and checking containment is S0.
- Shell: user input reaching `Bun.spawn`, `exec` or a shell string is S0 unless passed as an argv element.
- SQL: string-built queries with user input are S0.
- Secrets: no tokens, keys or passwords in code, logs, fixtures, screenshots or the PR body. S0.
- New dependencies: why the standard library or existing code was not enough, the maintainer count, release churn and install scripts. An unjustified dependency is S1.
- CI and workflow changes: `pull_request_target`, new `permissions:` and secrets exposed to forks are S0 until proven safe.

### 6. Performance
- Work inside loops: N+1 queries, repeated parsing, spawns per item, a full re-render per keystroke. S1 on a hot path, S2 otherwise.
- Unbounded growth: arrays, maps, event logs, listeners or timers that are never cleaned up. S1.
- Blocking the event loop with synchronous file I/O or heavy compute on a request path. S1.
- UI: layout thrash, an unthrottled `$effect`, a three.js geometry rebuilt every frame, images or bundles added without need. Name the number when you have one (bundle delta, frame time).

### 7. Naming
- Files `kebab-case.ts`, components `PascalCase.svelte`, rune modules `*.svelte.ts`, tests `<file>.test.ts` beside the file.
- Functions start with a verb, booleans with `is`/`has`/`can`/`should`. Units in names (`timeoutMs`, `heightMm`). No abbreviations outside the allowed list.
- Named exports only, except where a framework requires a default.
- A name that needs a comment to make sense is S2; one that is actively misleading is S1.

### 8. File and module size
- A file is at most 250 lines, a Svelte component at most 150. Over is S1.
- Cognitive complexity at most 12 per function, at most 3 positional parameters. Over is S1.
- The PR is at most 400 changed lines (lockfiles, snapshots, migrations, `docs/design/**` and pure deletions excluded). 401 to 800 is S2 with a request to split; over 800 without the owner's `large-ok` label is S1.
- Dependency direction follows `docs/architecture.md` in the repo (today: `web → shared`, `api → shared`, `worker → shared`, generator plugins depend only on `shared`). An import against the documented direction is S1.
- One concern per PR. Two unrelated changes is S1: ask for a split.

### 9. Zero comments
**Any comment added by the diff is S1, with no exceptions and no judgement call.** Check the added lines yourself; do not rely on the guard alone.
- Banned: `//`, `/* */`, `/** */` and `<!-- -->` in `*.ts`, `*.tsx`, `*.mts`, `*.cts`, `*.js`, `*.jsx`, `*.mjs`, `*.cjs`, `*.svelte` (script, markup and style), `*.css`, `*.html` and JSONC (`tsconfig*.json`, `biome.json`, `*.jsonc`); any `#` comment, full-line or trailing, in `Dockerfile*` (including `# syntax=`), `Caddyfile`, `*.yml`, `*.yaml`, `*.toml` and `*.sh`. Allowed: only a shebang on line 1. Markdown is exempt. The guard in `scripts/checks/comments/` is the source of truth; when this text and the guard disagree, the guard wins.
- Suppression comments count: `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck`, `biome-ignore`, `eslint-disable`, `prettier-ignore`, `svelte-ignore`, `shellcheck disable`.
- Commented-out code counts.
- A string containing `//` is not a comment. The guard parses; you read.
- The fix you ask for: rename, extract a function, encode it in a type, write a test whose name states the rule, or move the prose to `docs/modules/<module>.md`.

Quick scan of added lines (it over-matches strings and URLs, so confirm each hit by reading it):

```bash
git diff origin/main...HEAD -U0 | grep -nE '^\+[^+].*(//|/\*|<!--)|^\+\s*#[^!]' || true
```

### 10. Docs
- A change to a package's public exports, a route, an env var, a CLI flag, a config key or a plugin contract updates the matching page under `docs/`. Missing is S1.
- Docs claims match the code: every backticked symbol and path in the changed docs exists. A wrong doc is S1; a thin one is S2.
- A decision with alternatives (new dependency, new pattern, major upgrade) has an ADR in `docs/adr/`. Missing is S1.
- Prose that would have been a code comment lives in `docs/modules/<module>.md`.

### 11. PR template
- Every section of `.github/PULL_REQUEST_TEMPLATE.md` is filled with real content: What, Why, `Closes #N`, How verified, Visuals (for UI PRs), Risk and rollback, Docs touched. An empty or placeholder section is S1.
- `Closes #N` names an existing open issue in this repo, and the diff actually addresses it.
- Every claim under "How verified" is something you reproduced. One you could not reproduce is S1 `could not verify`.
- The body describes the current diff, not an earlier round.

### 12. Conventional-commit title
- The title matches `^(feat|fix|refactor|perf|test|docs|build|ci|chore|revert)(\((web|api|worker|shared|engine|queue|db|core|plugins|infra|guard|tools|docs|deps)\))?!?: \S.{0,70}$`, is at most 72 characters, is imperative and lower-case after the colon, and has no trailing period. Squash merge uses it, so a wrong title is S1.
- The type matches the diff: a `refactor` that changes behaviour, or a `fix` with no bug, is S1.
- Breaking changes carry `!` and a `BREAKING CHANGE:` line in the body.

### 13. UI PRs only: visuals
A PR is a UI PR when it touches `packages/web/**`, `docs/design/**`, `*.svelte`, `*.css`, or any user-visible string.
- The `## Visuals` section contains at least one image. **Missing is S1 and the verdict is `fail`**, regardless of anything else.
- Motion, transitions, hover or focus states and multi-step flows need a GIF or video. A still image for a motion change is S1.
- Open every image and look at it. It must show the surface the diff changes, in the state the diff changes. A screenshot of an unrelated screen, or a stale one that does not show the change, is S1.
- The provenance line names a sha. If it is not the head sha, the diff between that sha and the head must not touch UI files; otherwise S1 stale.
- Desktop (1440×900) and mobile (390×844) when layout changed. Light and dark when tokens changed.
- Judge the design itself against the chosen mockup and these principles: hierarchy, one primary action, plain language, keyboard reachability, visible focus, WCAG AA contrast. A violation is S2, or S1 when it hides or blocks an action.
- Screenshots contain no secrets, tokens or real addresses (S0).
