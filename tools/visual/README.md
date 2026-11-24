# Visual evidence

Screenshots and GIFs of the web UI for every UI pull request. Why it is built this way: [ADR 0003](../../docs/adr/0003-visual-evidence.md).

## Local use

```sh
cd tools/visual
bun install
bunx playwright install chromium
bun capture.ts --out /tmp/visual/after
bun compare.ts --before /tmp/visual/before --after /tmp/visual/after
```

`capture.ts` boots the whole stack from `--root` (default: this checkout) in stub mode:

- Redis always runs in Docker on a random `127.0.0.1` port. A `REDIS_URL` in your shell is ignored, so the stack never touches another Redis.
- The api and worker run from source. The api gets `CONVEYOR_HOST=127.0.0.1`. Its code default is `127.0.0.1`; the api image sets `0.0.0.0` for the compose network, where the caddy publish is the boundary.
- The web app is built with `vite build` and served with `vite preview` on `127.0.0.1`, reusing the dev proxy config. Dev mode is not used: its lazy dependency optimisation reloads pages mid-scene.
- Auth is off and the database lives in a temp directory, so every run starts clean.
- The worker reads the checkout's `profiles/`, so stub jobs slice with the bundled profiles and `job-progress` runs to Done.
- Before the api starts, `seed.ts` writes one failed and one canceled job into the temp database with the same `dbRecordJob` the worker uses. With the `job-progress` jobs, `history` shows done, canceled and failed rows. The seed loads `openDb` and `dbRecordJob` from the `--root` checkout but takes its job records from the head's `seed.ts`, because CI captures the base with the head's tooling. So a PR that changes the job-record shape (`SettledJob` or the `jobs` table) will see its base-side capture fail: the head's records don't fit the base's writer. The base step is `continue-on-error`, so the merge-commit capture still runs. The comment's footer then reads `capture: failure` for the base, and with no base images every scene is listed as new. That's expected for such a PR, and the base side recovers once it merges.
- The `history` scene lists the seeded jobs and the ones `job-progress` just ran, whose ids and times differ on every run. Each page's `/api/jobs-history` response is rewritten in the browser (`history.ts`): ids become `00000001-0000-4000-8000-000000000000` and up, oldest first, and `createdAt` and `updatedAt` become 12:01, 12:02, … UTC on 2026-01-01. Every other field, and the page that renders them, is real. The `job-detail` and `job-detail-failed` scenes open `/history/seed-canceled` and `/history/seed-failed` directly, by their seeded ids; the failed one shows the error block. Their `/api/jobs-history/<id>` response keeps the id, and `createdAt` and `updatedAt` become 12:00 UTC on 2026-01-01. In the list and in a detail response alike, a time field is pinned only when the api returned it, so a missing one still renders as missing. Following a link from the pinned list wouldn't work: the pinned ids aren't ones the api knows.
- On SIGINT, SIGTERM or an uncaught error the stack tears itself down once: it kills the api, worker and web processes, removes the Redis container and deletes the temp directory, then exits with 130, 143 or 1. A child still running 5 s after SIGTERM gets SIGKILL. A second signal during teardown exits at once and prints what it may leave behind: each child process still running, with its pid; the Redis container id, with the `docker rm -f` command that removes it; and the temp directory. If any cleanup fails, such as `docker rm -f`, the run prints why and exits 1. The teardown lives in `teardown.ts`.

Pass `--url http://127.0.0.1:5173` to shoot an app you already run. `--only home,settings` limits the scenes, `--scheme dark` shoots with the dark colour scheme (default `light`), and `--verbose` streams service logs to stderr.

Output, per scene and width (1440 and 390):

- `<scene>-<width>.png` is a full-page screenshot taken after the scene's steps.
- `<scene>-<width>.gif` is made for scenes with `record: true`. Viewport screenshots are sampled while the steps run, then encoded with `gifenc`. A GIF over 5 MB is re-encoded smaller; if it still does not fit, the scene fails.
- `manifest.json` lists every shot, its warnings and any error. The exit code is 1 if any scene failed.

After its steps, every scene checks that the page's `<title>` is its first `h1` plus ` · Conveyor`, the rule in `docs/design/track-ui.md`. A mismatch fails the scene; a page with no `h1` is skipped.

`compare.ts` pairs files by name across two directories. It prints a markdown table with before, after and three numbers per scene: the share of pixels whose largest channel moved by more than 16/255, the share that moved at all, and the largest channel change. A GIF takes its PNG's numbers. A row folds into a `<details>` block only when no pixel moved at all, so a small but sharp change, such as an 88×88 icon on a 1440×1087 capture (0.49%), is listed. A share under 0.01% prints as `<0.01%`, not `0.00%`. This works because captures are deterministic: with no visual change, every scene diffs to exactly 0. The second share catches a faint, uniform change (shading, tone mapping, a theme colour) that stays under 16/255 everywhere, like three r187's 2.6–3.2% at 8–9/255 on the 3D preview. The comment says how many listed rows changed only faintly. Warnings and failures from both manifests are listed at the top. `--before-url` and `--after-url` set the image link prefixes.

## Scenes

Scenes live in `scenes.ts`. Each has a name, a route, a `ready` selector, optional `steps` (`click`, `type`, `press`, `hover`, `scroll`, `waitFor`, `wait`, `hits`, `fulfill`) and an optional `record`. `fulfill` answers every request to a URL glob with a fixed status and JSON body for the rest of the scene, as `retry-link` does to get an already-retried 409 without changing the seeded jobs. When you add a page, add a scene for it, and keep selectors on stable text or roles.

The stack runs with auth off, so a scene with `signedOut: true` stubs it in the browser instead (`auth.ts`): `/api/auth/status` answers signed out, and `/api/auth/login` answers `401 invalid password`. The `sign-in` and `sign-in-wrong` scenes use it; no other request is stubbed.

A `waitFor` with `warn` does not fail the scene on timeout. It records the warning, which then shows in the PR comment. No scene uses it today: `job-progress` waits for the final stage strictly, since the status stream no longer loses events (#52).

## CI

`.github/workflows/visual.yml` runs on pull requests that touch `packages/{web,api,shared}/**`, `profiles/**`, the root `package.json` or `bun.lock`, `tools/visual/**`, or the workflow itself. It has three jobs:

- `visual` has a read-only token. It captures the base commit and the PR merge commit (`refs/pull/N/merge`), builds `comment.md` with a placeholder for the assets commit, and uploads everything as the `visual-pr-<number>` artifact. It fails when the merge-commit capture fails.
- `publish` has write access and runs no PR code. It downloads the artifact, pushes it to the orphan `pr-assets` branch under `pr-<number>/` (3 attempts, refetching each time), fills in the pinned commit and keeps one sticky comment on the PR. It is skipped for forks, which only get the artifact and the job summary.
- `cleanup` runs when the PR closes and deletes `pr-<number>/` from `pr-assets`.

The root `bunfig.toml` keeps `tools/visual/**` out of the root `bun test`, since the root install doesn't include this package's dependencies. The `visual` job runs these tests with them installed.
