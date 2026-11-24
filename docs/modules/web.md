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

## lib/components/Viewport.svelte (the lazy 3D preview)

three.js and Threlte are about 200 KB gzip, two thirds of what `/` used to load first. `Viewport.svelte` is the only thing pages import: it fills its parent with a placeholder (a breathing cube and "Loading the 3D preview…") and, on mount, `import()`s `ViewportCanvas.svelte`, which holds the `Canvas`, the tone mapping and `PreviewScene` or `MeshScene`. The placeholder is absolutely positioned in the same box the canvas takes, so nothing shifts when it swaps. A failed import says so and asks for a reload.

The job page renders `Viewport` only for a Gridfinity job, so any other job's page never fetches three.js. Orbit controls come from three's own `OrbitControls` through `Orbit.svelte` (damping on, auto-rotate from the preference). `@threlte/extras` is gone: its barrel pulled in three's Draco and KTX2 loaders, whose `new URL(...)` emitted 1.9 MB of decoders into the build. `bun run check:bundle` holds both budgets ([contributing.md](../contributing.md#bundle-budget-bun-run-checkbundle)).

