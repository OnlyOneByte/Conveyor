# Visual evidence

Screenshots and GIFs of the web UI for every UI pull request.

## Local use

```sh
cd tools/visual
bun install
bunx playwright install chromium
bun capture.ts --out /tmp/visual/after
bun compare.ts --before /tmp/visual/before --after /tmp/visual/after
```

`capture.ts` boots the whole stack from `--root` (default: this checkout) in stub mode: Redis in Docker on a random `127.0.0.1` port (or `REDIS_URL` if set), the api and worker under `bun --preload loopback.ts` so every listener binds to `127.0.0.1`, and `vite dev` for the web app. Auth is off and the database lives in a temp directory, so runs start clean. Pass `--url http://127.0.0.1:5173` to shoot an app you already run instead.

Options: `--only home,settings` limits scenes, `--gif-mode frames|ffmpeg` forces the GIF path, and `--verbose` streams service logs to stderr.

Output, per scene and width (1440 and 390):

- `<scene>-<width>.png` is a full-page screenshot after the scene's steps.
- `<scene>-<width>.gif` is made for scenes with `record: true`. With `ffmpeg` on `PATH` it comes from Playwright's video; without it, viewport screenshots are sampled and encoded with `gifenc`. GIFs are shrunk until they fit in 5 MB.
- `manifest.json` lists every shot and any scene error. The exit code is 1 if any scene failed.

`compare.ts` pairs files by name across two directories and prints a markdown table with before, after and the share of changed pixels. Unchanged rows fold into a `<details>` block. `--before-url` and `--after-url` set the image link prefixes.

## Scenes

Scenes live in `scenes.ts`: a name, a route, a `ready` selector, optional `steps` (`click`, `type`, `press`, `scroll`, `waitFor`, `wait`) and `record`. Add a scene when you add a page, and keep the selectors on stable text or roles.

`job-progress` submits a real stub job. Its wait for the last stage is `optional` because the job status card can miss fast stub events (snapshot fetched before the socket subscribes), so the final frame may show a job that looks stuck.

## CI

`.github/workflows/visual.yml` runs on pull requests that touch `packages/web/**`, `tools/visual/**` or the workflow. It captures the base and head commits with the head's tooling, pushes both sets to the orphan `pr-assets` branch under `pr-<number>/`, and keeps one sticky comment on the PR with the comparison table, linked through `raw.githubusercontent.com` at the pinned assets commit. Pull requests from forks get the table in the job summary and the images as a run artifact, since their token cannot push. The `visual` job fails when the head capture fails; a failing base capture is reported in the comment footer.
