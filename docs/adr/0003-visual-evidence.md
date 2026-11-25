# ADR 0003 — Visual evidence for UI pull requests

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

Every UI PR must show what changed, as before/after screenshots and GIFs. Agents review and merge PRs, so the evidence has to be produced by CI, not by hand. The tooling should not need anything Conveyor does not already ship, and its output must render inline in a PR comment.

## Decision

- **Capture with Playwright (`playwright`)** against the real stack in stub mode: api, worker, `vite build` served by adapter-node behind the repo's `Caddyfile` (Caddy in Docker), and Redis in Docker. Everything binds to `127.0.0.1`. Playwright is the standard headless-browser driver, and it brings its own Chromium.
- **Encode GIFs in pure JS** with `pngjs` (decoding the screenshots) and `gifenc` (quantising and encoding them). GitHub's hosted runners have no ffmpeg, and installing it on every run costs time and widens the supply chain. `gifenc` has a single maintainer but no dependencies and about 1,200 lines of source, and it is pinned in `tools/visual/bun.lock`. If it goes stale it can be vendored or swapped for ffmpeg without changing `capture.ts`'s output contract. There is no ffmpeg path, so the one GIF path is the one CI runs.
- **Keep the tooling a standalone package** (`tools/visual`, with its own lockfile). Its dependencies stay out of the app's workspace and Docker images.
- **Host the images on an orphan `pr-assets` branch** under `pr-<number>/`, linked through `raw.githubusercontent.com` at a pinned commit. Images have to sit at a public URL to render in a comment. Workflow artifacts don't render inline, and committing images to the PR branch would put them into `main`'s history. Pinning to the commit keeps older comments valid.
- **Split privileges.** The job that runs PR code has a read-only token. A separate job, which runs no PR code, holds `contents: write` and `pull-requests: write`. It only pushes the downloaded artifact and posts the comment. "After" is the PR merge commit, so a branch that is behind `main` is not blamed for `main`'s changes.

## Consequences

- Each push to a UI PR adds about 6 MB to `pr-assets`. A job on `pull_request: closed` deletes `pr-<number>/`. The blobs still stay in that branch's history until the branch is squashed. That is a manual or scheduled follow-up: rewrite `pr-assets` as one orphan commit.
- A full clone fetches `pr-assets` too. `git clone --single-branch` avoids it.
- Fork PRs get the artifact and the job summary, but no comment, because their token cannot push.
- Stub mode shows UI and flow, not slicer output. Real-engine evidence needs another path.
