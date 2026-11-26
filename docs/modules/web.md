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
  - **Best effort:** when storage is blocked (private mode, a full quota), `stashRerun` does nothing and the
    button just doesn't pre-fill.
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
  - **When it can't load:** "Can't reach Conveyor" with Try again, never the empty state. `/history` and `/monitor` redirect here.
- **The belt's feed** (`lib/belt.ts`, `lib/active-jobs.ts`). The shell runs the only `GET /jobs/active` poll:
  - **Sharing:** each answer goes into the `activeJobs` store, which the queued job card reads instead of
    polling itself.
  - **Pace:** `createTicker` polls every 2 s while the tab is visible, and every 10 s (`COVERED_MS`) while every job
    on the belt is on the rail with an open socket. A queued job, or a closed socket, brings it back to 2 s.
  - **Offline:** after `FAILS_TO_CLEAR` failed polls in a row the belt goes offline, keeping its last jobs, and says
    so once. When `GET /jobs-history/counts` or Needs you fails, the end counts keep their last values and the belt
    shows its offline state too ("Can't reach Conveyor", with the last jobs), until a refresh answers again:
    `createEnds` reports each refresh through `down()`, and the layout passes `offline || endsDown`. So a failed
    poll never reads as an empty belt (#530).
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
The secret field is write-only: blank keeps what is saved, and the dialog names the saved field (an API key
for Moonraker, a Mainboard ID for Elegoo, in `SavedSecrets.svelte`). **Clear saved secrets** asks first, since
Cancel can't undo it, and ignores a pointer click on **Clear it** for its first 500 ms so a double-click can't confirm (a
keyboard or assistive-technology activation, `detail === 0`, goes through at once); the question
resets whenever the dialog closes or shows another printer, and a failed clear keeps focus on **Clear it**; **Clear it** resends the saved printer, not the form, with `secrets: null`, and **Keep it**
returns focus to the button. On a touch screen the job links on each printer card are 44 px tall. **Delete printer** asks first in the same dialog, and stays disabled while
the printer has jobs on the belt, because the API refuses that delete with `409`; a `409` from a race is shown
in plain words.

Settings keeps profiles and preferences; the nav's Printers tab stays current on `/settings` too, and the
page's **More** menu links there.

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
(`http-error.ts`). Any other error reads "Conveyor hit a problem loading this. Try again in a moment.", with
**Try again** as the primary action and **Back to Settings** beside it. The server's own `error` message, trimmed
and cut to 300 characters with an ellipsis, or the bare status line when there is none, is under a closed
**Details** disclosure (`ErrorDetails.svelte`), where it wraps anywhere and scrolls past 12rem instead of widening
the page.

## lib/said.ts (what a failure says on screen)

Every place that shows an error to the user goes through `said(e)`, `saidOnLoad(e)` or `couldnt(what, e)`, so the
words follow the spec's Words rules. The server's own `error` message is shown as it is. Conveyor being
unreachable, by `http-error.ts`'s `unreachable(e)`, has two sentences: a `502`, `503` or `504` from the proxy in front
of a stopped api (an `Unreachable`) reads "Can't reach Conveyor. Check that it's running, then try again.", and a
network `TypeError` reads "Can't reach Conveyor. Check your connection, then try again." Every status throw in
`api.ts`, `belt-ends.ts` and `jobs-list.ts` gives a gateway status an `Unreachable`, through `failure()` or
`statusError()`. A `GET /path 500`-style line (any of GET, POST, PUT, PATCH or DELETE), or a stock status text such
as Fastify's `Internal Server Error`, becomes "Conveyor couldn't do that just now. Try again." after an action, and
"Conveyor hit a problem loading this. Try again in a moment." on a page load (`saidOnLoad`). `couldnt("upload
cube.stl", e)` reads "Couldn't upload cube.stl: <server message>", or "Couldn't upload cube.stl. Try again." when
there is none. The thrown `Error` keeps its message, so code that matches on it (a profile or printer with jobs
"queued or running") is unchanged.

Whenever the page shows one of those plain sentences instead of the server's own words, `detailOf(e)` returns the
original text (`POST /jobs 502`, `Failed to fetch`, `Internal Server Error`), and `ErrorDetails.svelte` shows it
under the message in a closed **Details** disclosure, styled like the job receipt's (#37). Its text wraps
anywhere and scrolls past 12rem. Only when it overflows is it a Tab stop (`tabindex="0"`), so it can be scrolled
from the keyboard; a short detail that fits is not, so Tab doesn't stop on text with nothing to scroll. When the
server's own message is already on screen there is nothing more to say, so there is no disclosure. The profile
page is the exception: it never leads with the server's words, so they go under **Details** too. Make's dock and
upload, the printer, profile and delete dialogs, the profile editor and its page show it; the toast for a failed
Undo does not, since a toast has no room for one.

## lib/components/Viewport.svelte (the lazy 3D preview)

three.js and Threlte are about 200 KB gzip, two thirds of what `/` used to load first. `Viewport.svelte` is the only thing pages import: it fills its parent with a placeholder (a breathing cube and "Loading the 3D preview…") and, on mount, `import()`s `ViewportCanvas.svelte`, which holds the `Canvas`, the tone mapping and `PreviewScene` or `MeshScene`. The placeholder is absolutely positioned in the same box the canvas takes, so nothing shifts when it swaps. A failed import says so and asks for a reload.

The job page renders `Viewport` only for a Gridfinity job, so any other job's page never fetches three.js. Orbit controls come from three's own `OrbitControls` through `Orbit.svelte` (damping on, auto-rotate from the preference). `@threlte/extras` is gone: its barrel pulled in three's Draco and KTX2 loaders, whose `new URL(...)` emitted 1.9 MB of decoders into the build. `bun run check:bundle` holds both budgets ([contributing.md](../contributing.md#bundle-budget-bun-run-checkbundle)).


## lib/previews/gridfinity.ts and gridfinity-mesh.ts (the Gridfinity bin preview)

`buildGeometry` builds the bin the Make page previews: a faithful approximation, drawn on the client in well under a millisecond, not the manufacturing-exact STL ([ADR 0002](../adr/0002-dual-model-preview.md)). It is centred at the origin with Y up, then moved down by half its height so it sits in frame. `binHeight` is the overall height (the stacking lip sits inside it, as the spec has it), and `boundingRadius` is the half-diagonal the camera uses to frame any bin size.

### Dimensions

The constants come from `scad/gridfinity-rebuilt-openscad/src/core/standard.scad`:

| Constant | Value | Spec name |
| --- | --- | --- |
| `GRID_PITCH` | 42 mm | `GRID_DIMENSIONS_MM` |
| `HEIGHT_UNIT` | 7 mm | `BASE_HEIGHT`, which is also the height unit |
| `FOOT_WIDTH` | 41.5 mm | `BASE_TOP_DIMENSIONS`, leaving the spec's 0.5 mm gap (`FOOT_GAP`) between cells |
| `CORNER_RADIUS` | 3.75 mm | `BASE_TOP_RADIUS` (7.5 / 2) |
| `BASE_PROFILE_HEIGHT` | 4.75 mm | the top of `BASE_PROFILE` |
| `LIP_HEIGHT`, `LIP_FILLET` | 4.4, 0.6 mm | `STACKING_LIP_HEIGHT`, `STACKING_LIP_FILLET_RADIUS` |
| `MAGNET_RADIUS`, `MAGNET_DEPTH` | 3.25, 2.4 mm | `MAGNET_HOLE_RADIUS` (6.5 / 2), `MAGNET_HOLE_DEPTH` (the magnet plus 2 layers) |
| `MAGNET_CENTRE_OFFSET` | 13 mm | `base_bottom_dimensions / 2 - HOLE_DISTANCE_FROM_BOTTOM_EDGE` = 35.6 / 2 − 4.8 |

`WALL_THICKNESS` is 1.2 mm. `QUADS_PER_CORNER` is 12, enough for corner radii of at most 3.75 mm.

### Swept profiles

The base and the stacking lip are built the way the library builds them: a 2D profile swept around a rounded-rectangle path, so chamfers are true angled surfaces and corners are real fillets. An earlier version stacked boxes, which looked stepped.

- **`BASE_PROFILE`** is the spec's `[[0,0], [0.8,0.8], [0.8,2.6], [2.95,4.75]]`. The spec gives it as an outward offset from the innermost bottom point; the code carries it as an inset from the footprint (inset = 2.95 − offset). From the bottom, the stations are:
  1. a short run of the flat underside;
  2. the innermost bottom point;
  3. up and out at 45°;
  4. straight up;
  5. up and out at 45° to the full footprint;
  6. a point 0.01 mm proud of the body wall and 0.4 mm into the bridge above.

  The first and last stations exist so that those two edges can be rounded too, and the last one avoids a coplanar seam.
- **`LIP_PROFILE`** is the spec's `STACKING_LIP_LINE`, `[[0,0], [0.7,0.7], [0.7,2.5], [2.6,4.4]]`: the socket the next bin's feet drop into. Its inset is measured from the bin's outer face, so it traces the lip's inner surface. The first station is the deepest point of the ledge. The spec's top point is a knife edge that it then fillets, so the code keeps a flat of half the fillet radius there instead of a zero-width strip.
- **Edge rounding** (`roundProfile`, `EDGE_ROUNDING` 0.4 mm over `EDGE_ROUNDING_STEPS` 3): the spec profiles are pure chamfers. Swept as they are, every junction is a hard crease, and the base reads as folded cardboard. A printed part has extrusion rounding at those edges, so each interior station gets a tangent arc of constant radius. The tangent length is clamped to 45 % of each neighbouring segment, so an arc can't overrun one, and a collinear or doubled-back station is left as it is. The base uses `EDGE_ROUNDING`; the lip uses half its fillet radius.

### How the meshes are built (`gridfinity-mesh.ts`)

- **`ring`** is a closed rounded rectangle in the XZ plane, walked counter-clockwise. It always has `4 × (QUADS_PER_CORNER + 1)` points, whatever its radius, so any two rings can be stitched 1:1. That is what makes the sweep work.
- **`sweepSolid`** sweeps a rounded profile into one smooth-shaded geometry. Vertices are shared between bands, so `computeVertexNormals` shows the rounded junctions as real curvature. Flats are unaffected, because averaging across a tangent join gives back the same normal.
- **`band`** is one quad strip between two rings, used for the walls and the bridge. Each band is its own geometry, so vertices are shared around the ring (corner fillets shade smoothly) but not between bands (joins stay crisp). `inward` flips the winding for surfaces seen from inside the bin.
- **`annulus`** is a flat ring between two rings at one height, and **`face`** a solid rounded rectangle, fanned from the centre.
- **`undersideFace`** is the downward-facing underside of a foot, with the magnet bores cut out of it. There is no CSG here, so without real holes the face would cover the bore pockets from below. `ShapeGeometry` triangulates a contour with holes; a hole is an arc drawn clockwise. The shape lies in XY facing +Z, and a rotation of π/2 about X maps it to XZ facing −Y.

### Parts

- **Base:** one swept foot per grid cell, smooth-shaded, plus its underside face. With magnet holes, each foot gets four bores at ±`MAGNET_CENTRE_OFFSET`. Each bore is an open cylinder for its wall, seen through the hole, and a disc for its floor (a `CircleGeometry` rotated from +Z to face −Y). The bore materials are much darker than the body on purpose: the scene has no ambient occlusion, so a 2.4 mm pocket can't shadow itself and would vanish into the surface around it. The floor is darker still, which gives the pocket depth. The bore wall is double-sided, so the far inside wall shows when you look up into it.
- **Bridge:** the slab from `BASE_PROFILE_HEIGHT` to `HEIGHT_UNIT` that ties the feet together and forms the interior floor.
- **Walls:** from `HEIGHT_UNIT` to the top, or to `LIP_HEIGHT` below it when there is a stacking lip. The lip then owns the top `LIP_HEIGHT`, and the two meet back to back. The touching faces point opposite ways, so they don't z-fight.
- **Stacking lip:**
  - the swept socket;
  - an outer face flush with the walls;
  - the underside of the ledge;
  - the top flat.
- **Dividers:** `divisionsX − 1` and `divisionsY − 1` boxes across the interior.
- **Label tab:** a small angled shelf along the back top of the first compartment.
- **Scoop:** a quarter-cylinder ramp along the front of the interior floor.

## lib/components/SchemaForm.svelte and SchemaGroup.svelte (the generated form)

Make's Configure card is generated from the generator's JSON Schema (`paramJsonSchema` from `@conveyor/shared`), one control per property, with no per-generator UI code. `form-schema.ts` holds the schema shapes the form reads and the pure helpers both components share:
- `paramJsonSchema` wraps the object behind `$ref` → `definitions[name]`; the helper resolves it.
- A field's current number falls back to its default, then its minimum.
- An explicit control hint wins; otherwise the control is inferred from the schema.
- **The readout beside a group heading:** when every field in the group maps units to millimetres, it shows real millimetres, the number you measure a drawer against. A numeric pair without that mapping echoes its values, such as "1 × 1".
- **Hints are optional** (`ui`: grouping, advanced fields, preferred controls, unit-to-mm mapping). Without them every field renders in one flat group. A field the hints forget is appended as a visible group rather than dropped: a stray control fails better than a silently missing parameter.

`SchemaForm` seeds defaults from the schema once, when it first resolves. It dispatches that first `change` from `onMount` when it isn't mounted yet: a dispatch from a reactive statement can run during component init, before the parent has attached its listener. When it was dropped, printing without touching the form posted `params: {}`, and the job's history row recorded no parameters.

`SchemaGroup` renders one group, the optional heading and readout and then its fields laid out per `group.layout`, the same way in the primary section and inside More options. The parent owns mutation, so the whole form dispatches one change event.
- **The value per field is a reactive statement, not a `num(key)` call in the markup.** Svelte tracks only the identifiers named in a template expression, so `value={num(key)}` would depend on `num` and `key`, never on `value`. The stepper's number would then stay frozen while everything else updated.
- **Typing commits only while the value is legal**, so a half-typed "1" on a field with a minimum of 2 isn't pulled out from under the caret. On blur or Enter the value is clamped and the input is forced back in sync: an out-of-range entry was never committed, so the state may not have changed, and Svelte would otherwise leave the stale text in the box.
- **Layout:** booleans sit in a compact two-column grid. The stepper's − and + flank a real number input, so ±1 is one tap and an exact value can still be typed. The wrapper carries the 44 px tap target, so the inner input opts out of the global minimum height.

## lib/components/PreviewScene.svelte and MeshScene.svelte (the 3D scenes)

- **`PreviewScene`** rebuilds the procedural bin (`previews/gridfinity.ts`) whenever the params change. That takes well under a millisecond, with no network or server round trip, and Threlte's `is` mounts the prebuilt `THREE.Group` directly. `buildGeometry` centres the bin on the origin, so its underside sits at −h/2. The ground grid, there for scale, is placed at that height; at −radius (the bounding sphere) it used to float tens of millimetres below the model.
- **`MeshScene`** renders the user's real uploaded STL (the passthrough source), as opposed to the procedural preview. It re-parses whenever the file changes: `STLLoader.parse()` is a synchronous local decode of an `ArrayBuffer`. It recentres the geometry on the origin so the orbit controls frame it.
- **Auto-spin** is opt-in (Settings → Preferences) and off by default in both scenes. Users who asked the OS for reduced motion never get it.

## lib/preferences.ts (per-browser preferences)

Preferences describe how this browser renders, not anything about the catalog, so they live in `localStorage`, not SQLite, and are per device: the same choice on a phone and a desktop is two settings. When storage is blocked (private mode), a read falls back to the default and a failed write is dropped, so the choice just doesn't survive a reload.
- **Auto-spin** (`spinPreview`) is off by default. A model that keeps rotating is distracting while you dial in parameters, and it fights manual orbiting: the camera drifts the moment you let go. The toggle is on `/settings` and the viewer on `/`, so the two are often open in separate tabs. The `storage` event fires only in other tabs, so listening to it keeps them in sync without looping on the tab's own writes.
- **Reduced motion** (`prefersReducedMotion`) overrides the preference. `autoRotate` is a render-loop prop, not a CSS animation, so the global `@media (prefers-reduced-motion)` rule in `app.css` can't reach it.

## lib/api.ts and /settings (fetching state)

- **`fetchJobHistoryEntry`** doesn't use `getJson`, which throws the same error for every non-ok status. The job page has to tell "no job with this id" (a not-found page) apart from a server failure (shown as an error), so only `404` becomes `null` and anything else still throws.
- **Deleting** a printer or profile surfaces the server's `error` message, so a refusal explains itself. A body that isn't JSON falls back to the method, path and status.
- **`uploadStl`** uploads an STL for the passthrough generator and returns an opaque `uploadId`.
- **Client-rendered page:** `/settings` sets `ssr = false`, because its cookies and fetches run in the browser.
