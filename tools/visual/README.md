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

- Redis runs in Docker on a random `127.0.0.1` port, or uses `REDIS_URL` if that is set.
- The api and worker run from source. The api gets `HOST=127.0.0.1`. Its default stays `0.0.0.0` for compose.
- The web app is built with `vite build` and served with `vite preview` on `127.0.0.1`, reusing the dev proxy config. Dev mode is not used: its lazy dependency optimisation reloads pages mid-scene.
- Auth is off and the database lives in a temp directory, so every run starts clean.

Pass `--url http://127.0.0.1:5173` to shoot an app you already run. `--only home,settings` limits the scenes, and `--verbose` streams service logs to stderr.

Output, per scene and width (1440 and 390):

- `<scene>-<width>.png` is a full-page screenshot taken after the scene's steps.
- `<scene>-<width>.gif` is made for scenes with `record: true`. Viewport screenshots are sampled while the steps run, then encoded with `gifenc`. A GIF over 5 MB is re-encoded smaller; if it still does not fit, the scene fails.
- `manifest.json` lists every shot, its warnings and any error. The exit code is 1 if any scene failed.

`compare.ts` pairs files by name across two directories. It prints a markdown table with before, after and the share of changed pixels. A GIF takes its PNG's diff, and rows under 0.5% fold into a `<details>` block. Warnings and failures from both manifests are listed at the top. `--before-url` and `--after-url` set the image link prefixes.

## Scenes

Scenes live in `scenes.ts`. Each has a name, a route, a `ready` selector, optional `steps` (`click`, `type`, `press`, `scroll`, `waitFor`, `wait`) and an optional `record`. When you add a page, add a scene for it, and keep selectors on stable text or roles.

A `waitFor` with `warn` does not fail the scene on timeout. It records the warning, which then shows in the PR comment. `job-progress` uses this because of [#52](https://github.com/OnlyOneByte/Conveyor/issues/52): the status card can miss fast stub events, so the stepper may freeze.

## CI

`.github/workflows/visual.yml` runs on pull requests that touch `packages/{web,api,shared}/**`, `profiles/**`, the root `package.json` or `bun.lock`, `tools/visual/**`, or the workflow itself. It has three jobs:

- `visual` has a read-only token. It captures the base commit and the PR merge commit (`refs/pull/N/merge`), builds `comment.md` with a placeholder for the assets commit, and uploads everything as the `visual-pr-<number>` artifact. It fails when the merge-commit capture fails.
- `publish` has write access and runs no PR code. It downloads the artifact, pushes it to the orphan `pr-assets` branch under `pr-<number>/` (3 attempts, refetching each time), fills in the pinned commit and keeps one sticky comment on the PR. It is skipped for forks, which only get the artifact and the job summary.
- `cleanup` runs when the PR closes and deletes `pr-<number>/` from `pr-assets`.
