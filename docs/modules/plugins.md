# Plugins: implementation notes

The why behind the bundled plugins in `plugins/`. Contracts live in [../PLUGINS.md](../PLUGINS.md); engine
installs in [../archive/M1-WORKER-ENGINES.md](../archive/M1-WORKER-ENGINES.md); hardware runbooks in
[../M2-TRANSPORTS.md](../M2-TRANSPORTS.md).

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
- The klipper bundle (Creality K1 family) was verified by slicing a cube to real klipper g-code (302 layers).

### Prusa (`plugins/slicers/prusa`)

- PrusaSlicer's CLI is headless; no xvfb. Verified 2026-06-30 on Debian trixie / arm64.
- A bundle is one or more exported `.ini` files. A `config.ini` wins if present; otherwise every `*.ini` loads
  in alphabetical order, so a `00-printer.ini` / `10-filament.ini` split applies in order. Each becomes a
  repeated `--load`.
- `--output <path>` writes that exact file, so no rename is needed.
- `gcodeFlavor: "klipper"` declares the adapter's contract for job validation; the emitted flavor really comes
  from `gcode_flavor` in the loaded bundle, and the bundled defaults ship klipper.

## Transports

Neither transport has been run against real hardware yet (written 2026-06-29). Confirm with the runbooks in
[../M2-TRANSPORTS.md](../M2-TRANSPORTS.md).

Both upload the g-code through `multipartFileUpload` (`@conveyor/shared/node`), which streams the file from
disk as one multipart part with a fixed `Content-Length`. Two guards apply to every upload:

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
- The printer address accepts `host`, `host:port` or a full URL; plain hosts get `http://`.
- Auth: `submit()` sends `X-Api-Key` from `printer.secrets.apiKey` (or `moonrakerApiKey`). `status()` and
  `cancel()` only get the handle, so they read `MOONRAKER_API_KEY` from the environment. Without a key, add the
  worker host to Moonraker's `trusted_clients`.
- Status polls `print_stats.state` every `MOONRAKER_POLL_MS` (default 2000). Klipper states are `standby`,
  `printing`, `paused`, `complete`, `cancelled` and `error`. Progress prefers `display_status.progress` and
  falls back to `virtual_sdcard.progress`. Klipper can briefly report `standby` after a print ends, so
  `standby` after `printing` with progress at ~1 counts as done.
- Print progress (`PrintStatus.print`, on `printing` and `paused` polls): `layer` is
  `print_stats.info.current_layer` and `layers` is `print_stats.info.total_layer` when it is above 0. Klipper
  fills `info` only when the slicer emits `SET_PRINT_STATS_INFO`, so either can be absent. `secondsLeft` is
  `print_duration × (1 − p) / p`, rounded, where `p` is `virtual_sdcard.progress` (file position, not
  `display_status`), and is left out when `print_duration` is 0 or `p` is under 1% or at the end. The reply
  is parsed with zod (`query.ts`); a reply that does not match fails the stage.
- Cancel: `status(handle, signal)` passes the signal to every poll and to the sleep between polls.
  `cancel()` posts `/printer/print/cancel` with a 15 s timeout. `submit()` checks the signal between the upload
  and the start request, and throws `PrintNotStartedError` when it was cancelled first.

### Elegoo (`plugins/transports/elegoo`)

SDCP (Smart Device Control Protocol), written from the
[SDCP V3.0.0 spec](https://github.com/cbd-tech/SDCP-Smart-Device-Control-Protocol-V3.0.0):

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
  `PrintInfo.TotalLayer` when it is above 0, each only when it is a whole number. `secondsLeft` is never set:
  `CurrentTicks` and `TotalTicks` are in the spec, but their unit is not stated and differs between firmware,
  so a time left from them would be a guess.

To verify on hardware:

1. The upload route: the plugin uses `POST http://<ip>:3030/uploadFile/upload` (multipart `File`). Capture
   ElegooLink's traffic and adjust `uploadGcode()` if it 404s.
2. The `START_PRINT` payload: whether it takes `{ Filename, StartLayer }` or a path or token returned by the
   upload.
