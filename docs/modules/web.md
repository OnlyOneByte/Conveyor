# packages/web

The SvelteKit app: Make, Jobs, Printers and the belt. Code in this package is moving to no comments; the reasons
behind it live here, one section per file, as the comments come out.

## lib/rerun.ts and routes/+page.svelte (the rerun handoff)

"Print again" on a receipt and "Pick printer" in the Needs-you tray hand a job's request to Make. They don't
submit it themselves.

- **The stash.** `stashRerun` writes the request to `sessionStorage` and navigates to `/?rerun=1`. Make reads it
  once on mount with `takeRerun`, which also clears it, so a refresh doesn't apply it again.
  - **Why not the URL:** generator params are arbitrary JSON, which is fragile and size-limited in a query string.
  - **Why `sessionStorage`:** it is scoped to the tab, so a stale prefill never leaks into a later visit.
- **Applying it.** Make applies the stash after the catalog has loaded, so its selections win over the reactive
  defaults, which only fill empty selections. A printer or profile that no longer exists is set anyway. The
  eligibility filters then fall back to a valid default, and the user picks again.
- **`retryOf`.** Pick printer stashes the failure's id in the payload's `retryOf` field, and preselects a printer
  other than the one that failed (the first in the catalog that takes the job's generator), leaving the profile
  for Make to default. `linkedRetry` sends `retryOf` only while Make generates with the stashed
  generator. While Make is on Upload or another generator, the link is suspended, so an unrelated print can't
  spend the failure's retry and clear it from Needs you. Switching back to the stashed generator restores it,
  since that print is a retry of the same failure. Make forgets the handoff after one submit attempt, whatever its
  result.
  - **One send path:** with `retryOf`, Make's Print goes through `sendJob`, which calls `retryJob` (`lib/retry.ts`)
    like the tray's Retry. Without it, `sendJob` calls `submitJob`.
  - **A 409:** a failure that was already retried is shown as "This job was already retried." (`ALREADY_RETRIED`).
- **Jobs** (`routes/jobs/+page.svelte`, `lib/jobs-list.ts`). One server-backed list:
  - **Groups:** On the belt (from `GET /jobs/active`, polled every 2 s while visible), then Today, Yesterday and
    Earlier (from `GET /jobs-history`, 50 at a time with its `before` cursor). A job that is on the belt is never
    listed again below it.
  - **Rows:** each row is one link to `/jobs/<id>` with the name, printer, status in words and time. A failure leads
    with what to do (`failureText`).
  - **Filters:** All, On the belt, Printed, Failed and Canceled. The settled ones ask the server by `state`, and the
    counts come from `GET /jobs-history/counts`.
  - **Keys:** the rows share one Tab stop. `J`/`K` move real focus, Enter opens, `C` cancels a job on the belt after
    a confirm dialog, `R` retries a failure, and `/` focuses the filter.
  - **When it can't load:** "Can't reach Conveyor" with Try again, never the empty state. `/history` redirects here.
- **The belt's feed** (`lib/belt.ts`, `lib/active-jobs.ts`). The shell runs the only `GET /jobs/active` poll:
  - **Sharing:** each answer goes into the `activeJobs` store, which `/monitor` and the queued job card read
    instead of polling themselves.
  - **Pace:** `createTicker` polls every 2 s while the tab is visible, and every 10 s (`COVERED_MS`) while every job
    on the belt is on the rail with an open socket and no page is watching (`watchActive`; `/monitor` watches, so it
    keeps 2 s). A queued job, or a closed socket, brings it back to 2 s.
  - **Offline:** after `FAILS_TO_CLEAR` failed polls in a row the belt goes offline, keeping its last jobs, and says
    so once. The end counts keep their last values when `GET /jobs-history/counts` or Needs you fails.
- **Who may run again** (`rerunRequest`). A job runs again with its own request only when it is done or canceled,
  isn't an upload (an upload's file isn't kept), and still has a printer and a profile.
  - **Users:** the receipt and the belt's Print-again toast both decide with it.
  - **A job still canceling:** it has no history record yet, so the belt applies the same rule to the request the
    chip already carries from `GET /jobs/active`.

## routes/printers and lib/printer-status.ts (the Printers page)

One card per printer, from `GET /catalog/printers`, `GET /jobs/active` (every 2 s) and a reachability probe
per printer (`GET /catalog/printers/:id/reachable`) when the page opens and once a minute after
(`REACH_MS`), as #339 asks. Probes and polls skip while the tab is hidden. `printerCard` turns those into the
card:

| State | When | Shows |
|---|---|---|
| Busy | a job on `/jobs/active` names this printer and isn't `queued` | that job, its stage and percent, the time left when the printer reports `print.secondsLeft`, and a bar while printing |
| Ready | the last probe connected | "Connected" and its latency |
| Offline | the last probe failed | why in plain words (`unreachableText` maps `timeout`, `ECONNREFUSED` and the rest), and `lastSeenAt` as "Last answered 3h ago" |
| Checking | no probe has answered yet | nothing else |

Busy wins over a failed probe, because a printer that is printing is reachable to the worker. Every card lists
its waiting jobs (queued ones naming it, oldest first) with links; on an offline printer the list turns red
and says they can't start until it's back.

Add and Edit open `PrinterDialog.svelte`, a `Dialog` with `Field`s and a real `Select` for the transport.
`printer-form.ts` holds the rules: `draftErrors` checks the fields on save and then on every change, and focus
moves to the first field with an error. A new printer's ID follows its name (`slugOf`) until you edit the ID.
The secret field is write-only: blank keeps what is saved. **Clear saved secrets** resends the saved printer,
not the form, with `secrets: null`. **Delete printer** asks first in the same dialog, and stays disabled while
the printer has jobs on the belt, because the API refuses that delete with `409`; a `409` from a race is shown
in plain words.

Settings keeps profiles and preferences; the nav's Printers tab stays current on `/settings` too, and the
page's **More** menu links there. `/monitor` keeps its active-jobs list only.

### Settings

`/settings` has three panels: **Profiles**, **This browser** and **About**.

- **Profiles** lists each profile by name with its facts (`profileFacts` in `profile-facts.ts`: material and
  layer height read from the name, then firmware and slicer, like "PLA · 0.20 mm · Klipper · OrcaSlicer") and a
  tag: Bundled, Added, and ", edited" when its content was changed. Bundled profiles have no Delete.
- **Add profile** is a dialog with selects for the slicer (`GET /catalog/slicers`) and the firmware (every
  transport's `acceptsFlavors`). The ID is `<slicer>/<slug of the name>`, and the folder follows the name until
  you edit it. `profileErrors` checks the name, a free ID and a `/profiles/<bundle>` folder.
- **Delete** asks in a dialog that names the profile. The toast after it offers **Undo**, which registers the
  profile again and restores its edited content, read before the delete. Focus then moves to the next row's
  last action (the previous row's when the last row went), or to **Add profile** once the list is empty.
- **This browser** holds the theme, the preview spin and the single-key shortcuts switch from
  `preferences.ts`. **About** shows the release (kit's `version.name`, set from `CONVEYOR_VERSION` at build
  time; release images pass the tag) and links to the source, docs, issues and license.

`/settings/profiles/<id>` edits a profile's content in CodeMirror 6, loaded only on that route
(`code-editor.ts`): JSON or INI highlighting, line numbers, and a lint mark on the line with the problem. Tab
leaves the editor, so focus is never trapped. `profile-check.ts` runs the API's own validators from
`@conveyor/shared/profile` (no Zod) on every change and finds the line: the Lezer JSON parser locates a syntax error, and a
refused setting is found by its key. The error shows above the editor in plain words, and Save stays disabled
until it is fixed. Orca's three files are tabs, and a file with an error carries a dot. **Reset to original**
and leaving with unsaved changes both ask in a dialog; Ctrl or ⌘ S saves. Until the editor has mounted
(still loading, or its chunk failed to load offline), Save, Tidy layout, Reset and Ctrl S do nothing, so no
change is ever made to text nobody can see. A profile whose content answers `404` (one just added, whose
folder has no files yet) opens with empty files and a note to paste the slicer's settings. Only a network
failure, or a `502`, `503` or `504` from the proxy in front of a stopped api, reads "Can't reach Conveyor"
(`http-error.ts`). Any other error shows the server's `error` message, or the method, path and status when the
body has none: `api.ts`'s `getJson` and the profile content fetch both read failures through `failure()`.

## lib/components/Viewport.svelte (the lazy 3D preview)

three.js and Threlte are about 200 KB gzip, two thirds of what `/` used to load first. `Viewport.svelte` is the only thing pages import: it fills its parent with a placeholder (a breathing cube and "Loading the 3D preview…") and, on mount, `import()`s `ViewportCanvas.svelte`, which holds the `Canvas`, the tone mapping and `PreviewScene` or `MeshScene`. The placeholder is absolutely positioned in the same box the canvas takes, so nothing shifts when it swaps. A failed import says so and asks for a reload.

The job page renders `Viewport` only for a Gridfinity job, so any other job's page never fetches three.js. Orbit controls come from three's own `OrbitControls` through `Orbit.svelte` (damping on, auto-rotate from the preference). `@threlte/extras` is gone: its barrel pulled in three's Draco and KTX2 loaders, whose `new URL(...)` emitted 1.9 MB of decoders into the build. `bun run check:bundle` holds both budgets ([contributing.md](../contributing.md#bundle-budget-bun-run-checkbundle)).

