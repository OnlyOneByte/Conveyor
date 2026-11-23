# Design: the Belt UI and its Track rail

Status: accepted by the owner on 2026-11-23. [ADR 0005](../adr/0005-belt-ui-track-rail.md) records the decision.
The rewrite plan is in [Implementation plan](#implementation-plan).

Mockup: [track-mockup.html](track-mockup.html). Open it in a browser, without a hash for its index of states.
Add `?theme=light` or `?theme=dark` to force a theme. It loads Bricolage Grotesque and DM Mono (both SIL OFL-1.1)
from the Fontsource CDN and falls back to system fonts offline. That CDN is for the mockup only: the app self-hosts
its fonts and makes no third-party requests (see [Type](#type)).

Answers the UX audit, umbrella [#49](https://github.com/OnlyOneByte/Conveyor/issues/49), and its IA findings
[#38](https://github.com/OnlyOneByte/Conveyor/issues/38), [#39](https://github.com/OnlyOneByte/Conveyor/issues/39)
and [#46](https://github.com/OnlyOneByte/Conveyor/issues/46).

## Summary

The product is named after a conveyor, so the UI uses one. A **belt** runs across the top of every page and holds
every job that isn't finished. This version of the belt is a **Track**: one continuous rail where each job is a
small chip placed by its real overall progress. Chips that would overlap merge into a group chip. Waiting jobs sit
in a Queue box at the left; finished and failed jobs leave the rail into two bins at the right.

The belt is the global job tray the audit asks for (#46): where a job is, is visible from any page. Under it the app is
warm and tactile: a green cutting mat for the model, plain-language questions in the form, and a receipt for each
finished job.

Two other belt shapes were compared and not chosen: one shared belt with five slotted stations, and one belt per
printer. Track is the most compact (about 100 px tall), places jobs by real progress rather than by station, and its
mini-rail works unchanged as the 40 px collapsed belt and the mobile summary.

## Tokens

All tokens are CSS custom properties on `:root`, switched by `data-theme="light|dark"` on `<html>`. No raw colours,
sizes or durations appear outside the token file; the lint rule for this lands with the tokens PR.

The theme is the saved choice, else `prefers-color-scheme`. It is applied before first paint by
`static/theme-init.js`, a few lines loaded synchronously in `app.html`'s `<head>`. Being an external same-origin
file, it is allowed by the CSP's `default-src 'self'`; there is no inline script, so no nonce or hash is needed.

### Type

| Token | Value | Use |
|---|---|---|
| `--display` | Bricolage Grotesque (variable, 200–800), then `system-ui` | Everything except data |
| `--mono` | DM Mono 400 and 500, then `ui-monospace` | Numbers, times, sizes, IDs, labels, kbd |
| Page title | 36 px / 800 / -0.04em (30 px under 760 px) | One `h1` per route |
| Section | 18 px / 700 | `h2` inside a page |
| Body | 15 px / 1.45 | Default |
| Chip | 13 px / 650 | Rail chips |
| Label | 11 px mono / 500 / uppercase / 0.09em | Captions, station names |

**The app self-hosts its fonts.** A self-hosted app must not call third parties, so the web package depends on
`@fontsource-variable/bricolage-grotesque` and `@fontsource/dm-mono` (weights 400 and 500), imports only their latin
subsets, and Vite bundles the `woff2` files into the build. Fonts are served from the app's own origin with
`font-display: swap`; there is no CDN, Google Fonts or other external request at runtime. The CSP needs no change:
fonts fall under its `default-src 'self'`, and no `font-src` exception is added. Both fonts are SIL OFL-1.1; the
tokens PR lists them in `THIRD_PARTY_NOTICES.md`.

### Colour

OKLCH. Every text pair below passes WCAG AA (axe-core 4.14 on the mockup, light and dark, 1440 and 390 px).

| Token | Light ("Paper") | Dark ("Night shift") | Use |
|---|---|---|---|
| `--bg` | `oklch(.952 .016 85)` | `oklch(.19 .01 60)` | Page |
| `--paper` | `oklch(.992 .006 85)` | `oklch(.25 .012 60)` | Cards, chips, popovers |
| `--sunk` | `oklch(.93 .016 85)` | `oklch(.215 .011 60)` | Wells, queued chips, selected rows |
| `--ink` | `oklch(.22 .02 55)` | `oklch(.95 .012 85)` | Text, primary toggles |
| `--muted` | `oklch(.45 .02 60)` | `oklch(.78 .015 80)` | Secondary text |
| `--faint` | `oklch(.5 .02 65)` | `oklch(.7 .015 75)` | Labels |
| `--line` / `--line-2` | ink at 13% / 24% | ink at 10% / 20% | Borders |
| `--accent` | `oklch(.68 .19 45)` | `oklch(.74 .17 50)` | The one primary action |
| `--focus` | `oklch(.52 .17 42)` | `oklch(.74 .17 50)` | Focus ring: at least 4.8:1 on `--bg`, `--paper` and `--sunk` in both themes (WCAG 1.4.11 needs 3:1) |
| `--accent-ink` | `oklch(.2 .03 45)` | `oklch(.18 .02 50)` | Text on `--accent` |
| `--live` | `oklch(.54 .18 42)` | `oklch(.77 .16 52)` | Progress, moving chips |
| `--ok` | `oklch(.48 .13 150)` | `oklch(.78 .14 150)` | Printed |
| `--err` | `oklch(.5 .2 28)` | `oklch(.74 .16 28)` | Failed, Needs you |
| `--off` | `oklch(.5 .01 60)` | `oklch(.68 .01 60)` | Offline, canceled |
| `--belt` / `--tread` | `oklch(.26 .008 60)` / `oklch(.34 .008 60)` | `oklch(.12 .005 60)` / `oklch(.2 .006 60)` | The rail |
| `--mat` | `oklch(.44 .075 168)` | `oklch(.31 .055 168)` | Model preview background |

The model's faces use seven `--bin-*` tokens (safety-orange PLA) so the preview recolours with the theme. Colour is
never the only signal: every state also has an icon or a word.

### Space, radius, elevation

- Spacing: `--s1` 4, `--s2` 8, `--s3` 12, `--s4` 16, `--s5` 24, `--s6` 32 px. Page gutter is `--s6` on desktop and
  16 px under 760 px.
- Radius: `--r-chip` 16, controls 13, `--r-card` 18, `--r-panel` 26 px.
- Elevation: `--lift` for resting cards and chips, `--lift-hi` for hovered, focused or moving ones. Nothing else
  casts a shadow.
- Targets: at least 44 px on touch layouts, 30 px minimum on desktop (above WCAG 2.5.8's 24 px).

### Motion

| Token | Value | Use |
|---|---|---|
| `--t-fast` | 150 ms | Hover and focus lift, colour changes |
| `--t-move` | 400 ms | A chip tweening to its new position after a progress update |
| `--t-hop` | 600 ms | A chip leaving the rail into a bin |
| `--ease-move` | `cubic-bezier(.65,0,.35,1)` | Movement |
| `--ease-pop` | `cubic-bezier(.3,1.4,.5,1)` | Lift and press |

Under `prefers-reduced-motion: reduce`, durations become 0 and the treads stop. See [Reduced motion](#reduced-motion).

## Information architecture

Three nouns in the main nav, in this order: **Make**, **Jobs**, **Printers**. Settings lives under Printers'
header menu and at `/settings`. `/monitor` and the localStorage "from this browser" list are removed (#46, #38).

| Route | Page | `h1` | The belt |
|---|---|---|---|
| `/` | Make | What are we making? | Full Track; collapses to 40 px after 80 px of scroll |
| `/jobs` | Jobs | Jobs | 40 px |
| `/jobs/:id` | Job detail | The job's name | 40 px; this job's chip is outlined |
| `/printers` | Printers | Printers | 40 px |
| `/settings` | Settings | Settings | 40 px |
| `/login` | Sign in | Sign in to Conveyor | None |

Every route sets `<title>` to `<h1> · Conveyor` (#32). Under 760 px the nav is a bottom tab bar with the same three
items (#31).

- **Make:** the model on the mat on the left, the form on the right as three questions (How big? What's inside?
  Where should it print?), and an `--ink` dock holding the summary and the one orange **Print** button (dark in the
  light theme, light in the dark theme). The dock is
  sticky and sits on a solid band of the page colour, so no content shows behind it. Upload STL is the second
  source tab, reachable by keyboard (#45, #34).
- **Jobs:** one server-backed list. An **On the belt** group comes first (live, from `GET /jobs/active`), then day
  groups from history. Each row is one link with state, name, printer, plain status and time; under 760 px the
  status word stays, so state never rests on colour alone. Filters are pills (All, On the belt, Printed, Failed,
  Canceled), and `/` focuses the filter (#38).
- **Job detail:** one page for every state. A running job shows its chip, stage, progress and Cancel. A settled job
  shows the receipt: model preview, settings with the form's own labels and units, stage times, filament, files to
  download, and the job ID behind Copy. **Print again** is the primary action in the header. A failed job leads with
  the reason in plain words and Retry (#39, #37).
- **Printers:** one card per printer with status (ready, busy with the current job and time left, offline since),
  its waiting count, and Edit. Add printer is a dialog. Reachability checks move here from Monitor (#46).
- **Settings:** profiles (bundled ones read-only), the switch for single-key shortcuts, and about. Sign-in is set by
  `CONVEYOR_PASSWORD` in the environment, so it is not a setting. Real dialogs replace `confirm()` (#40, #41, #43).

The mockup covers Make, Jobs, the Track rail in every state and the command menu. Job detail, Printers,
Settings, sign-in and 404 are not mocked here: each is designed in its own issue (#331, #332, #333 and #325),
which adds its mockup under `docs/design/` and captures it before writing code.

### Words

- Display names, never IDs: "Voron 2.4", not `voron-1`; "PLA · 0.20 mm", not `orca/klipper-pla-0.2`. IDs live
  behind Copy (#37).
- Say what happened and what to do next, in plain words: "Elegoo Centauri didn't answer within 10 seconds", then
  Retry. No errno codes, stack traces or stage identifiers in the main text.
- Short, sentence-case labels and questions; numbers with units ("126 mm", "41 min left").
- An empty state never stands in for an error: "Can't reach Conveyor" is not "No jobs yet".

## The Track rail

### Layout

`[Queue box 150 px] [rail, fills] [bins 170 px]`, 110 px tall on desktop. The rail is split by ticks into four
stages. Print gets half because it takes most of the time:

| Stage | Rail span |
|---|---|
| Model | 0–15% |
| Slice | 15–34% |
| Send | 34–49% |
| Print | 49–100% |

A chip's centre is `start + progress × (end − start)` of its stage, with 2% inset at each end so a chip at 0% or 100%
never sits on a tick. The stage label that holds at least one chip is shown in `--ink` with an accent dot.

### Chip anatomy

A 34 px pill: a 24 px progress ring, the job's short name, and a mono value at the right. Minimum width 156 px; the
name shows up to 150 px and then ends in an ellipsis. The full name, printer and status are always in the chip's
accessible name (after its visible text, see [ARIA](#aria)) and in the focus card, so nothing is lost to truncation.

Names are shortened for the rail only: "Gridfinity bin 2×3 · 6u" becomes "Bin 2×3 · 6u", and an upload keeps its file
name.

Sources, as in [Data](#data): **now** is in today's API, **browser** is derived on the page, and an issue number
needs that backend change and is hidden until it lands.

| State | Where | Ring | Value | Focus card adds |
|---|---|---|---|---|
| Queued | Queue box list | dashed, empty | `next` | Printer (now), place in line (browser), rough start (#337) |
| Modelling | Rail, Model | indeterminate quarter | `…` | Typical duration (#337) |
| Slicing | Rail, Slice | fills with % | `35%` (now) | Time left (browser, from the progress rate) |
| Sending | Rail, Send | fills with % | `72%` (now) | Bytes sent of total (#336) |
| Printing | Rail, Print | fills with % | `64%` (now) | Layer, minutes left, finish time (#335) |
| Done | Finished bin | full, `--ok` | `✓` | Took (now, from `timings`), filament (#338) |
| Failed | Needs-you tray | full, `--err` | `!` | Stage (now), reason in plain words (browser, from `error.reason`), Retry, Pick printer |
| Canceled | Toast only | full, `--off`, name struck through | `×` | Print again |

Hover (after 300 ms) or focus (at once) lifts the chip and opens its **focus card** under it: the full name, what is
happening, the numbers, and **Open job** plus the state's one action (Cancel, Retry). Clicking the chip itself opens
Job detail.

The card follows WCAG 1.4.13. It stays open while the pointer is over the chip or the card, closes with Esc without
moving focus, and never covers the chip. From the keyboard, `↓` on a focused chip moves focus into the card's first
action, Tab and Shift+Tab move between its actions, and Esc or `↑` returns focus to the chip. The card is a
non-modal popover placed right after its chip in the DOM, and the chip points at it with `aria-describedby`.

### Collision and merge

Recomputed on every update and on resize:

1. Sort the rail's chips by centre x, in pixels.
2. Walk left to right. If a chip's left edge would sit less than 6 px from the current group's right edge, it joins
   that group; the group's centre becomes the mean of its members' centres.
3. A group of one renders as a chip; a group of two or more renders as a **group chip**: stacked mini rings, "N jobs",
   and the members' values in rail order ("35% · … · 12%").
4. Clamp every chip to the rail's ends.
5. Hysteresis: a group only splits again when the gap would exceed 16 px, so chips don't flicker at the boundary.

The group chip's accessible name starts with its visible text and then lists every member and its status. Focus
opens a member list in the card; ←/→ walk the members and Enter opens one.

### Job counts

| Jobs | What shows |
|---|---|
| 0 | Empty Queue box, still rail with "Nothing on the rail · Voron and Ender ready", Finished bin with today's count |
| 1 | One chip, at its stage |
| 3 | Typically one printing, one slicing, one queued; no merges |
| 8 | Modelling and slicing chips merge into a group, one printing chip, 3 queued, Finished 1, Needs you 1 |
| 20 | Queue box "Waiting 13", one group chip of 3 near Slice, separate Send and Print chips; the rail never grows taller |

### End states

- **Done:** the ring closes, turns green, and the chip slides right into the **Finished** bin over `--t-hop`. The
  bin shows today's count and links to Jobs filtered to today. The job is in history from the moment it finishes;
  the bin is a receipt, not storage.
- **Failed:** the ring turns red, and the chip drops into **Needs you**. The tray stays until each job is retried,
  moved to another printer, or dismissed, and never hides on its own. The collapsed rail and the mobile summary both
  show its red count.
- **Canceled:** the chip strikes through and fades over `--t-fast`. A toast offers **Print again** for 6 s, or until
  focus leaves it. There is no undo: the worker has already stopped.

### The collapsed rail (40 px)

Shown after 80 px of scroll on Make, and always on every other page. One dark bar holds "Belt", the waiting count, a
mini-rail with a dot per moving job and the stage ticks, "next done in 41 min" (#335; hidden until then), the Finished and Needs-you counts, and
an expand button (`aria-expanded`) that opens the full Track in place.

### Mobile (under 760 px)

The full Track does not fit, so the belt becomes a **summary chip**: "6 on the belt · Ender 64%, 41 min", the waiting
and Needs-you counts, and the mini-rail. Its expand button opens a sheet of full-width chips that show their status
in words ("printing", plus "· 41 min left" once #335 lands), plus the two bins. On Make the summary scrolls with the page; once scrolled, a
sticky copy takes its place. On every other page it is sticky from the start.

## Keyboard, ARIA and screen readers

### Keyboard

Shortcuts never fire while focus is in a text field, and `?` lists them all. Single-key shortcuts (every row below
without `⌘`, `Ctrl` or an arrow) can be turned off, as WCAG 2.1.4 requires: the shortcut sheet and Settings both
have the switch, saved per browser. `⌘K`, `⌘↵` and the rail's arrow keys stay on, because they need a modifier or
a focused component.

| Keys | Where | Does |
|---|---|---|
| `⌘K` / `Ctrl K` | Anywhere | Opens the command menu |
| `N` | Anywhere | New print (Make, Gridfinity) |
| `B` | Anywhere | Expands or collapses the belt |
| `G` then `M`, `J` or `P` | Anywhere | Go to Make, Jobs or Printers |
| `T` | Anywhere | Switch theme |
| `Tab` | Rail | Enters once, on the leftmost chip (roving `tabindex`) |
| `←` `→` | Rail | Previous or next chip, then group members |
| `Enter` | Chip | Opens Job detail |
| `Esc` | Card, sheet, menu | Closes it and returns focus |
| `↓` / `↑` | Chip | Into its focus card's actions / back to the chip |
| `J` `K` | Jobs | Next or previous row (moves real focus) |
| `Enter` | Jobs | Opens the row |
| `C` / `R` | Jobs, selected row | Cancel (asks first) / Retry |
| `/` | Jobs | Focuses the filter |
| `⌘↵` | Make | Print |

The **command menu** follows the WAI-ARIA combobox pattern: a modal dialog with an input and a grouped listbox of
jobs (with their state), actions (with their shortcut) and printers. ↑/↓ move, Enter runs, Esc closes.

### ARIA

Every accessible name starts with the control's visible text (WCAG 2.5.3, Label in Name), and details follow in
visually hidden text after it. No `aria-label` replaces visible words.

| Element | Visible text | Accessible name |
|---|---|---|
| Chip | `Bin 2×3 · 6u 64%` | "Bin 2×3 · 6u 64%, Gridfinity bin 2×3 · 6u on Ender 3 V3, printing" (plus ", 41 min left" once #335 lands) |
| Group chip | `3 jobs 35% · … · 12%` | "3 jobs 35% · … · 12%: Bin 1×1 · 3u, slicing; …" |
| Queue box | `Waiting 3` | "Waiting 3" |
| Bins | `Finished 1 today`, `Needs you 1` | the same |
| Command button | `Search` and `⌘K` | "Search jobs, printers and actions ⌘K"; on mobile the word is visually hidden, not removed |

- The belt is a `region` named "On the belt". The rail is a `group` named "Rail, N moving".
- A chip is a link; a group chip is a button with `aria-expanded` that controls its member list.
- Jobs is a plain list of links with a roving `tabindex`: one Tab stop, and `J`/`K` move real focus. There is no
  `listbox` role and no `aria-activedescendant`.
- Every page has one `h1`, a `<title>`, a visible focus ring (3 px `--focus` outline, 2 px offset) and no positive
  `tabindex`.

### aria-live

The shell owns one `polite` and one `assertive` live region. The belt writes to them; pages do not.

- Polite: a job moves to a new stage ("Bin 1×1 moved to Send on Voron 2.4."), starts printing (with the time),
  finishes, or is canceled.
- Assertive: a job fails, with its reason and "Retry is on the job.".
- Never announced: percent changes, layer changes, chip merges.
- Bursts within 2 s merge into one sentence.

### Reduced motion

With `prefers-reduced-motion: reduce`, chips jump to their new position without a tween, the treads stand still,
nothing lifts on hover, and leaving the rail is an instant swap into the bin. The announcements are the same.

## Data

Today a job's events (`JobStatusEvent` in `packages/shared/src/events.ts`) carry `state`, `stage`, `progress`,
`message`, `error` and `timings`; `GET /jobs-history` takes only `limit` (at most 200). Every field the design shows
is one of three kinds:

- **Now:** in today's API.
- **Browser:** derived on the page from data that exists now.
- **Backend:** needs an `area/backend` issue. Until it lands, the UI issue that shows the field builds the fallback,
  and the field appears when the backend ships.

| Field | Shown in | Source | Until then |
|---|---|---|---|
| Live jobs, their stage and percent | rail, Jobs, Job detail | now: `GET /jobs/active` every 2 s while visible; `WS /jobs/:id/ws` per chip (at most 10, the rest poll) | |
| Cancel; Retry and Print again | focus card, Jobs, Job detail | now: `POST /jobs/:id/cancel`; `POST /jobs` with the original request (`lib/rerun.ts`) | |
| Stage times, took | Done card, receipt | now: `timings` | |
| Failure stage and reason | Needs you, Job detail | now: `error`; the plain-language wording is mapped in the browser | |
| Place in line | Queued card | browser: `GET /jobs/active` ordered by `createdAt` per printer | |
| Slicing time left | Slicing card | browser: from the rate of `progress` over the last updates; shown after two updates | |
| Finished today | Finished bin | browser: settled jobs from `GET /jobs-history` with today's `updatedAt` | |
| Printer ready, busy or not reachable | Make picker, Printers | now: `/jobs/active` and `GET /catalog/printers/:id/reachable` | |
| Layer, time left, finish time, "next done in" | Printing card, collapsed rail, mobile sheet, Job detail | backend: [#335](https://github.com/OnlyOneByte/Conveyor/issues/335) | percentage only; those rows hidden |
| Bytes sent of total | Sending card | backend: [#336](https://github.com/OnlyOneByte/Conveyor/issues/336) | percentage only |
| Typical duration, rough start | Modelling and Queued cards | backend: [#337](https://github.com/OnlyOneByte/Conveyor/issues/337) | hidden; place in line still shows |
| Filament | Done card, receipt | backend: [#338](https://github.com/OnlyOneByte/Conveyor/issues/338) | hidden |
| Busy time left, offline since | Make picker, Printers | backend: [#339](https://github.com/OnlyOneByte/Conveyor/issues/339) | Ready, Busy or Not reachable, no times |
| History paging, filters, counts | Jobs | backend: [#340](https://github.com/OnlyOneByte/Conveyor/issues/340) | newest 200, filtered in the browser, counts "in the last 200" |
| Dismissed failures | Needs you | backend: [#341](https://github.com/OnlyOneByte/Conveyor/issues/341) | failures from the last 24 h, no Dismiss |

Dismiss is stored on the server rather than in the browser, because a browser-only store would bring back the
per-browser job state the audit removes (#46). A single server-sent stream of all job events would replace the
polling and the per-chip sockets; it is a later backend change, not needed for this plan. The rail takes its jobs as
props, so the same component renders stub data in the visual-capture scenes.

## Implementation plan

Twelve UI PRs of at most 400 changed lines each, in dependency order, tracked in
[#322](https://github.com/OnlyOneByte/Conveyor/issues/322) (#323 to #334), plus the seven backend issues in
[Data](#data) (#335 to #341). Each UI issue carries its acceptance criteria, the audit issues it closes, the
visuals it must attach, and the backend issues it waits on with their fallbacks.

## Not decided

- Printer farms over 6 printers: the Queue box may need a per-printer breakdown.
- Whether the Finished bin's count resets at midnight or when opened.
- The global job-event stream that replaces polling.
