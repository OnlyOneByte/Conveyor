# Plugins: implementation notes

The why behind the bundled plugins in `plugins/`. Contracts live in [../PLUGINS.md](../PLUGINS.md); engine
installs in [../archive/M1-WORKER-ENGINES.md](../archive/M1-WORKER-ENGINES.md). The hardware runbooks are
under each transport below.

With `CONVEYOR_ENGINE_STUB=1` the pipeline runs with no engine or printer: the Gridfinity generator writes a
placeholder STL, slicers write a placeholder g-code, and transports fake an upload and a short progress run.
The passthrough generator ignores the flag: it always copies the real upload and fails with
`upload not found` without one.

The Gridfinity, Orca and Prusa plugins read their environment (`CONVEYOR_ENGINE_STUB`, `GRIDFINITY_SCAD`,
`ORCA_BIN`, `ORCA_DATADIR`, `PRUSA_BIN`, and `OPENSCAD_BIN` as before) each time they run, not when they are
loaded. So their tests share one loaded copy per file and set the environment per test, and coverage counts
every path they run: `bun test` reports only the last copy of a module it loads.

## Generators

### Gridfinity (`plugins/generators/gridfinity`)

- Renders `gridfinity-rebuilt-bins.scad` from gridfinity-rebuilt-openscad (default
  `/scad/gridfinity-rebuilt-openscad/gridfinity-rebuilt-bins.scad`; `GRIDFINITY_SCAD` overrides it). File and
  variable names were verified against the library's HEAD as of 2025-08 by rendering a real STL with OpenSCAD 2023.09 nightly: a 2×3 bin
  measured 83.5×125.5 mm, matching the Gridfinity spec.
- Before running OpenSCAD it checks the `.scad` file exists. If it doesn't, usually because `./scad` was cloned
  without its submodule, the stage fails with `missingLibrary(path)`: the path plus `git submodule update --init`.
- The worker image builds OpenSCAD 2026.11-RC0 from source and installs it at `OPENSCAD_BIN` (the library
  needs 2023+); without it the plugin runs `openscad` from `PATH`.
- `gridfinityParams` (zod) is the single source of truth: the worker validates against it and the PWA renders
  the form from its JSON Schema. The `ui` block is presentation only. Footprint and height are shown first;
  everything else sits behind "More options". `unitMm` drives the live millimetre readout.
- `preview: procedural` means the client builds the preview geometry from the params.

Param to OpenSCAD variable mapping:

| Param | Variable | Value |
|---|---|---|
| `gridX`, `gridY`, `heightUnits` | `gridx`, `gridy`, `gridz` | direct |
| `divisionsX`, `divisionsY` | `divx`, `divy` | direct |
| `scoop` | `scoop` (0..1 float) | `1` full ramp, `0` none |
| `labelTab` | `style_tab` (0 Full … 5 None) | `1` Auto, `5` None |
| `magnetHoles` | `magnet_holes` | bool |
| `stackingLip` | `include_lip` | bool |
| (none) | `refined_holes` | always `false` |

Why `refined_holes` is pinned to `false`: the library defaults it to `true` and asserts that refined holes and
magnet holes are not both on, or OpenSCAD aborts with an empty object. Refined holes are still magnet pockets
(a bore with a toothpick slit), so leaving the default would make "Magnet holes in base: off" emit a different
style of magnet hole instead of none. Both flags `false` is valid and gives a hole-free base.

### Passthrough (`plugins/generators/passthrough`)

- The "Upload STL" source: the uploaded STL is the model; no engine runs.
- The API stores uploads at `<DATA_DIR>/uploads/<uploadId>.stl` (`UPLOAD_DIR` overrides). The worker shares the
  `/data` volume and copies the upload into the job's `workDir`, so artifacts live in `workDir` and the original
  stays intact for retries.
- `uploadId` must match `^[A-Za-z0-9_-]+$` (max 128), so it cannot escape the uploads directory. `basename()`
  on top of that is a second guard. `filename` is display-only and never used for IO.
- No procedural preview: the client renders the real uploaded mesh.

## Slicers

Each slicer advertises bundled read-only defaults under `/profiles`. Runtime profiles are resolved from SQLite
by the worker and passed to `slice()` as a `ProfileRef`, so they need not be listed in the plugin.

### Orca (`plugins/slicers/orca`)

- Orca is GUI-first, so it runs under `xvfb-run -a`.
- A bundle is `machine.json`, `process.json` and `filament.json`. Leaf presets use `inherits` chains that only
  resolve against the full vendor profile tree, so `--datadir` points at `ORCA_DATADIR` (default
  `/opt/orca/squashfs-root/resources/profiles`, the AppImage's own profile tree).
- CLI verified 2026-06-30 against OrcaSlicer 2.4.1 (aarch64 AppImage):
  - the action is `--slice 0` (all plates); there is no `--export-gcode`;
  - machine and process load together: `--load-settings "machine.json;process.json"`;
  - filaments load with `--load-filaments`;
  - `--outputdir` is a directory and Orca writes `plate_1.gcode`, which the plugin copies to `model.gcode` so
    the transport stage has a stable path.
- A zero exit with no `plate_1.gcode`, or an empty one, fails the slicer stage with
  `<orca bin> exited 0 but wrote no G-code`, plus Orca's stderr when it wrote any (`requireOutput`, #384).
- The klipper bundle (Creality K1 family) was verified by slicing a cube to real klipper g-code (302 layers).

### Prusa (`plugins/slicers/prusa`)

- PrusaSlicer's CLI is headless; no xvfb. Verified 2026-06-30 on Debian trixie / arm64.
- A bundle is one or more exported `.ini` files. A `config.ini` wins if present; otherwise every `*.ini` loads
  in alphabetical order, so a `00-printer.ini` / `10-filament.ini` split applies in order. Each becomes a
  repeated `--load`.
- `--output <path>` writes that exact file, so no rename is needed.
- PrusaSlicer 2.9.2, Debian trixie's package, exits 0 and writes no G-code when every object is outside the
  print volume. It says `All objects are outside of the print volume.` on stderr; its `Nothing to print...`
  line goes to stdout, which isn't read. A zero exit with a missing or empty `model.gcode` therefore fails the
  slicer stage with `<prusa bin> exited 0 but wrote no G-code: <stderr>` (`requireOutput`, #384), instead of
  failing later in transport. The web's `failureText` reads that stderr line as a model that doesn't fit the
  bed.
- `gcodeFlavor: "klipper"` declares the adapter's contract for job validation; the emitted flavor really comes
  from `gcode_flavor` in the loaded bundle, and the bundled defaults ship klipper.

## Transports

Neither transport has been run against real hardware yet (written 2026-06-29), and neither cancel path has
either. Confirm them with the "Verify on hardware" runbook under each one. Both read `CONVEYOR_ENGINE_STUB`
once, when the worker loads them, so restart the worker after unsetting it.

Printers are added and edited on the **Printers** page (`/printers`). The form's secret field saves
`secrets.mainboardId` for an Elegoo printer and `secrets.apiKey` for any other; other keys are set with
`PUT /api/catalog/printers`. A write's `secrets` merges per key, so saving one keeps the rest, `null`
removes a key, and `secrets: null` (the form's **Clear saved secrets**) removes them all
([api.md](api.md#catalog-and-history-routescatalogts-routescatalog-contentts)).

Both upload the g-code through `multipartFileUpload({ field, path, filename }, onSent)` (`@conveyor/shared/node`),
which streams the file from disk as one multipart part with a fixed `Content-Length`. `onSent(bytesSent,
bytesTotal)` counts the file's bytes only, not the multipart framing, against its size. It fires as the
printer reads the body, at most once per `UPLOAD_REPORT_MS` (250 ms, so 4 a second), and always for the last
chunk. Both transports pass it to `ctx.reportUpload`. On the SQLite queue the worker's progress flush (one
write a second per step) coalesces these further, and a report still pending when the stage moves on is
dropped. Two guards apply to every upload:

- **Size.** The length is the file's size when the upload starts. If the file grows or shrinks before the last
  byte is sent, the stream fails, and the job fails at the transport stage. It is never sent truncated, and
  the printer isn't left waiting for bytes that won't come.
- **Timeout.** `CONVEYOR_UPLOAD_TIMEOUT_MS` (default 600000, 10 minutes) bounds the whole upload request,
  together with the job's cancel signal. A timeout fails the transport stage, while a cancel still ends the
  job as canceled with no print started. A value that isn't a positive integer fails the upload, naming the
  variable.

### Moonraker (`plugins/transports/moonraker`)

- Klipper over the Moonraker HTTP API; the lowest-risk transport. Endpoints:
  - `POST /server/files/upload` (multipart `file`, to the virtual sdcard)
  - `POST /printer/print/start?filename=<name>`
  - `GET /printer/objects/query?print_stats&virtual_sdcard&display_status`
  - `POST /printer/print/cancel`
- The printer address accepts:
  - a full `http(s)://` URL, in any case (`HTTP://…`), which is used as is;
  - any form `parseHostPort` accepts ([shared.md](shared.md#addressts)), optionally followed by a path, as in
    `printer.local/moonraker` or `[fe80::1]:7125/moonraker` for Moonraker behind a reverse-proxy prefix.
- For the second kind:
  1. A leading `//` is dropped.
  2. The text before the first `/` is the authority, and anything up to its last `@` is userinfo, which is
     dropped. `fetch` dropped it on main too, so no `Authorization` header is sent either way.
  3. What remains is parsed as host and port, port 80 by default, and becomes `http://` plus
     `formatHostPort(host, port)`, so a bare IPv6 address is bracketed.
  4. The path is kept, minus one trailing `/`.
- An authority it rejects fails the stage with `moonraker printer address <reason>` before any request. The
  reason quotes the whole address, redacted, so a password that contains `/` is never partly quoted. An
  address with a control character or line break inside it is rejected; surrounding whitespace is trimmed.
- Saving a printer checks only its host against the address rule, so every form that worked before still
  does: `//host/path` and `user:pass@host[/path]` included.
- Auth: `submit()` sends `X-Api-Key` from `printer.secrets.apiKey` (or `moonrakerApiKey`). The worker passes
  the same printer to `status()` and `cancel()`, which send that key too, or `MOONRAKER_API_KEY` from the
  environment when the printer has none. Without a key, add the worker host to Moonraker's `trusted_clients`.
- Status polls `print_stats.state` every `MOONRAKER_POLL_MS` (default 2000, read when the status stream starts; it must be a whole number above 0). Klipper states are `standby`,
  `printing`, `paused`, `complete`, `cancelled` and `error`. Progress prefers `display_status.progress` and
  falls back to `virtual_sdcard.progress`. Klipper can briefly report `standby` after a print ends, so
  `standby` after `printing` with progress at ~1 counts as done.
- Print progress (`PrintStatus.print`, on `printing` and `paused` polls): `layer` is
  `print_stats.info.current_layer` and `layers` is `print_stats.info.total_layer` when it is above 0. Klipper
  fills `info` only when the slicer emits `SET_PRINT_STATS_INFO`, so either can be absent. `secondsLeft` is
  `print_duration × (1 − p) / p`, rounded, where `p` is `virtual_sdcard.progress` (file position, not
  `display_status`), and is left out when `print_duration` is under 1 s (Klipper's float error lands just either side of zero),
  or when `p` is under 1% or at the end.
  `p` counts file bytes, header and thumbnails included, so the estimate runs low early in a print (about 38%
  low at 5% real progress with a 3% header) and converges as the print goes on; correcting it needs the file's
  `gcode_start_byte` and `gcode_end_byte` metadata, which `status()` does not fetch.
- The reply is parsed with zod (`query.ts`). An unreadable `state` or progress fails the stage. A print-only
  field it cannot use (`print_duration`, `info`) reads as absent instead, so a cosmetic value never fails a
  running print: Klipper can report `print_duration` a hair below zero (`-1.2e-14`) after a pause before the
  first extrusion.
- Cancel: `status(handle, signal, printer)` passes the signal to every poll and to the sleep between polls.
  Each poll gives up after `MOONRAKER_STATUS_TIMEOUT_MS` (default 30000), so a hung request can't hold the job.
  A failed poll (a timeout, a refused connection or an error reply) is retried after the usual wait; once
  `MOONRAKER_STATUS_FAILURES` (default 5) fail in a row, the stage fails with `moonraker status query failed:
  <last error> (<n> in a row)`. A good poll resets the count. Both settings must be whole numbers above 0.
- Every upload, status poll and cancel first checks the printer's host against the address rule in
  [docs/self-hosting.md](../self-hosting.md#printer-addresses), resolving names each time. Elegoo checks before
  its upload, before `START_PRINT`, before opening the status socket and before `STOP_PRINT`.
  `cancel()` posts `/printer/print/cancel` with a 15 s timeout. `submit()` checks the signal between the upload
  and the start request, and throws `PrintNotStartedError` when it was cancelled first.

Verify on hardware:

1. Set the `klipper-garage` printer's address to your Moonraker host, for example `192.168.1.50:7125` or a
   full `http://…` URL.
2. Auth: either add the worker host to `[authorization] trusted_clients` in `moonraker.conf`, or set the
   printer's `apiKey` secret in Settings. Upload, status and cancel all send it.
3. Unset `CONVEYOR_ENGINE_STUB`, restart the worker and submit a job to Garage Klipper. Confirm that progress
   advances and the job ends `done`.
4. Mid-print, cancel the job from Monitor (or `POST /api/jobs/:id/cancel`). Confirm that the printer stops and
   the job ends `canceled`.

### Elegoo (`plugins/transports/elegoo`)

SDCP (Smart Device Control Protocol), written from the
[SDCP V3.0.0 spec](https://github.com/cbd-tech/SDCP-Smart-Device-Control-Protocol-V3.0.0):

- Addresses: `printerEndpoint` parses the printer address with `parseHostPort` ([shared.md](shared.md#addressts)),
  with `ELEGOO_WS_PORT` as the default port, then formats it with `formatHostPort`. The WebSocket and the
  upload URL both use it, so `fe80::1` becomes `ws://[fe80::1]:3030/websocket`. An address it rejects fails
  the command with `elegoo printer address <reason>` before a socket opens.
- Control: WebSocket `ws://<ip>:3030/websocket` (`ELEGOO_WS_PORT`), JSON request/response plus pushed status
  topics. A request carries `From: 0` (local PC/app) and `TimeStamp` in wall-clock seconds. The
  clock is read through `nowMs()` when a command is sent, so nothing reads the clock at import time and the
  import graph stays pure. Each command waits
  up to 15 s for its ack. JSON frames for other requests are skipped; an unreadable frame rejects the command.
  The status stream tolerates up to `MAX_BAD_STATUS_FRAMES - 1` (2) unreadable frames since the last readable
  status frame, so one garbled push does not fail a running print; the third ends `status()` with a
  `StageError` that names the count and quotes the last frame. Only a readable status frame resets the
  count: notice, attributes and response frames leave it as it is, so they cannot keep a broken stream alive.
- Idle timeout: `ELEGOO_STATUS_TIMEOUT_MS` (default 10 minutes) is an inactivity limit, not a limit on the
  whole print. A timer starts when the stream opens and restarts on every `sdcp/status` frame that maps to a
  print status (`printing`, including paused, `done` or `canceled`). When it fires, `status()` throws a
  `StageError` "no print status for <ms> ms" and the job fails. Nothing else restarts it: notice, attributes
  and response frames, unreadable frames, `sdcp/error` frames (even repeated ones), and status frames that
  map to no state, such as idle (`CurrentStatus: [0]` without `PrintInfo.Status` 8 or 9).
- Status refresh: SDCP V3.0.0 pushes status only when it changes, or in reply to a `Cmd 0` status request;
  it has no periodic push. A paused print changes nothing, so on its own it would go silent. While the stream
  is open it therefore sends `Cmd 0` to the handle's `deviceId` every `ELEGOO_STATUS_TIMEOUT_MS / 2`. A
  printer that is printing or paused answers with `CurrentStatus: [1]`, which restarts the timer, so a pause
  of any length stays alive. The interval starts when the socket opens and stops when the stream ends.
- Fatal errors mid-print: SDCP V3.0.0 has no "print aborted" push, so a printer that stops after an
  `sdcp/error` gives no end signal. A halted printer answers the refresh with idle, which does not restart
  the timer, so such a job stays `printing` for at most `ELEGOO_STATUS_TIMEOUT_MS` after its last print
  status, then fails.
- Parsing: every frame is checked against a zod schema in `src/frames.ts` (push envelope,
  status, error and ack shapes). `parsePushFrame` and `ackCode` return an `SdcpRead`
  (`frame`, `other` or `malformed` with the failing field path) and never throw; each caller switches over all
  three.
- Printer errors: SDCP V3.0.0 defines `ErrorCode` 1 (MD5 check failed) and 2 (file format incorrect), both
  file-transfer errors; the code is accepted as a number or a string. An `sdcp/error/<id>` push
  (`Data.Data.ErrorCode`) before printing has been observed yields `failed` with the message
  "printer reported SDCP error <code>", which ends the job. Once printing has been observed it is kept as a
  note: the last `printing` status is re-emitted with "printer reported SDCP error <code> while printing",
  and the print carries on. `sdcp/notice/<id>` and `sdcp/attributes/<id>` pushes are informational and
  skipped.
- Files: HTTP upload to the mainboard. The route and chunking differ between resin and FDM lines.
- Cancel: `cancel()` sends `Cmd 130` (STOP_PRINT) to the handle's `deviceId`, which is the stored
  `mainboardId`. It resolves only on a matching ack with `Ack 0`. A non-zero ack, a socket close before the
  ack, an error or the 15 s timeout rejects it. `handleFor()` builds the same handle for an interrupted
  `submit()`. The socket, ack and status-stream code lives in `src/socket.ts`.

Status mapping from a pushed `sdcp/status/<id>` frame. `Status` is read from the top level of the frame, as the
spec shows it, or from `Data.Status`, as the fixtures carry it. The `PrintInfo` numbers accept a number or a
numeric string (`"40"`); any other string (`"40%"`) makes the frame malformed.

- `CurrentStatus`: 0 idle, 1 printing, 2 transferring.
- `PrintInfo.Status`: 9 complete → `done`; 8 stopped → `canceled` ("stopped on printer"); 13 is the generic
  "printing" sub-state FDM lines report. Idle and other states emit nothing, so the UI keeps its prior state.
- `PrintInfo.Progress` is a 0..100 percentage on most firmware and is normalised to 0..1; without it, progress
  comes from `CurrentLayer / TotalLayer`.
- Print progress (`PrintStatus.print`): `layer` from `PrintInfo.CurrentLayer` and `layers` from
  `PrintInfo.TotalLayer` when it is above 0, each only when it is a whole number. `secondsLeft` is
  `TotalTicks − CurrentTicks`, rounded, read as seconds. The SDCP V3.0.0 spec says milliseconds ("Current Print
  Time (ms)"), but FDM firmware sends seconds, and Conveyor only sends sliced G-code, so every Elegoo target is
  FDM:
  - a Centauri Carbon capture in
    [elegoo-homeassistant#35](https://github.com/danielcherubini/elegoo-homeassistant/issues/35) has
    `"CurrentTicks": 4160.40348639997, "TotalTicks": 9193` for a print its owner reports as 2 h 33 min;
  - that integration multiplies both by 1000 for FDM printers only
    (`custom_components/elegoo_printer/sdcp/models/status.py`, lines 188-192);
  - OpenCentauri's API doc (`docs/software/api.md`) shows `CurrentTicks: 3600, TotalTicks: 36000` at layer 100
    of 1000, which is 1 h into a 10 h print.

  `CurrentTicks` can be fractional, so any finite value of 0 or more is read. `secondsLeft` is left out when
  either is missing or negative, when `TotalTicks` is 0, or when the print has run past the estimate.

Verify on hardware. The upload route is the least certain part, because SDCP leaves file transfer
under-specified and resin and FDM firmware differ, so confirm it first:

1. Upload: the plugin sends `POST http://<ip>:3030/uploadFile/upload` (`ELEGOO_WS_PORT`, multipart field
   `File`). Send a file with ElegooLink or the printer's web UI while capturing the traffic (Wireshark or
   browser devtools), note the URL, method, field name and whether it chunks, and adjust `uploadGcode()` in
   `src/index.ts` to match.
2. Start: check whether `START_PRINT` (`Cmd 128`) takes `{ Filename, StartLayer }`, as sent today, or a path
   or token the upload returns.
3. Mainboard id: read the printer's `MainboardID` from its screen or ElegooLink. If it differs from the
   printer's `id`, store it as the `mainboardId` secret; every command and the stop go to it.
4. Control: confirm the handshake at `ws://<ip>:3030/websocket` and that a status request (`Cmd 0`) gets a
   frame `parsePushFrame` reads as `frame`.
5. Unset `CONVEYOR_ENGINE_STUB`, restart the worker, submit to the Elegoo printer and watch the job. Then
   cancel one mid-print and confirm the printer acks the stop and the job ends `canceled`.
