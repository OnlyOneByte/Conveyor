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
- **Recent jobs.** After a submit, Make records the job in the browser's recent-jobs memory (`lib/recent-jobs.ts`),
  so a refresh keeps it visible.
- **The belt's feed** (`lib/belt.ts`, `lib/active-jobs.ts`). The shell runs the only `GET /jobs/active` poll:
  - **Sharing:** each answer goes into the `activeJobs` store, which `/monitor` and the queued job card read
    instead of polling themselves.
  - **Pace:** `createTicker` polls every 2 s while the tab is visible, and every 10 s (`COVERED_MS`) while every job
    on the belt is on the rail with an open socket. A queued job, or a closed socket, brings it back to 2 s.
  - **Offline:** after `FAILS_TO_CLEAR` failed polls in a row the belt goes offline, keeping its last jobs, and says
    so once. The end counts keep their last values when `GET /jobs-history/counts` or Needs you fails.
- **Who may run again** (`rerunRequest`). A job runs again with its own request only when it is done or canceled,
  isn't an upload (an upload's file isn't kept), and still has a printer and a profile.
  - **Users:** the receipt and the belt's Print-again toast both decide with it.
  - **A job still canceling:** it has no history record yet, so the belt applies the same rule to the request the
    chip already carries from `GET /jobs/active`.
