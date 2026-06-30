# M2 — Transports (Moonraker + ElegooLink/SDCP)

How a sliced gcode reaches a printer and how live status flows back. Both adapters
are **written against the published protocols but not yet verified on hardware** —
this doc is the capture-and-confirm runbook.

Status (2026-06-29):

| Transport | submit | status | cancel | discover |
|---|---|---|---|---|
| Moonraker (Klipper) | ✅ written | ✅ written | ✅ written | n/a (explicit IP) |
| Elegoo (SDCP) | 🟡 written* | 🟡 written | 🟡 written | ✅ written |

\* Elegoo file-upload route is the one genuinely-uncertain bit (see below).

All paths run today in `CONVEYOR_ENGINE_STUB=1` mode (verified: both stations flow
`transferring → printing(0..1) → done`). Unset the stub to hit real hardware.

## Moonraker (Klipper) — `plugins/transports/moonraker`

Pure HTTP, well-documented, lowest risk. Endpoints:

| Step | Call |
|---|---|
| upload | `POST /server/files/upload` (multipart `file`) |
| start | `POST /printer/print/start?filename=<name>` |
| status | `GET /printer/objects/query?print_stats&virtual_sdcard&display_status` |
| cancel | `POST /printer/print/cancel` |

Status mapping (`print_stats.state`): `printing/paused → printing`, `complete → done`,
`cancelled → canceled`, `error → failed`. Progress prefers `display_status.progress`,
falls back to `virtual_sdcard.progress` (both 0..1).

### Verify on your Klipper
1. In **Admin → Printers**, set the `klipper-garage` printer `address` to your Moonraker
   host, e.g. `192.168.1.50:7125` (or a full `http://…` URL).
2. If your Moonraker requires auth, either add the worker host to `[authorization]
   trusted_clients` in `moonraker.conf`, **or** set `MOONRAKER_API_KEY` on the worker
   (and store `apiKey` in the printer's secrets for the upload step).
3. Unset `CONVEYOR_ENGINE_STUB`, submit a gridfinity job to the Garage Klipper station,
   watch the WS stepper. Confirm progress advances and the job ends `done`.
4. Mid-print, hit cancel (`POST /jobs/:id/cancel`) and confirm the printer stops and the
   job goes `canceled`.

Poll interval: `MOONRAKER_POLL_MS` (default 2000).

## ElegooLink / SDCP — `plugins/transports/elegoo`

SDCP V3.0.0 (ELEGOO/Chitu). UDP discovery + WebSocket control on `:3030` + HTTP upload.
Helpers in `src/sdcp.ts` (discovery parse, command framing, status-frame parse).

| Step | Mechanism |
|---|---|
| discover | UDP broadcast `M99999` → `:3000`; printers reply with a JSON datagram |
| control | `ws://<ip>:3030/websocket` — JSON request `{Id,Data:{Cmd,Data,RequestID,MainboardID,TimeStamp},Topic}` |
| start | `Cmd 128` (START_PRINT) `{Filename,StartLayer}` |
| stop | `Cmd 130` (STOP_PRINT) |
| status | pushed `sdcp/status/<id>` frames → `PrintInfo.Status` enum + `Progress` |

Status enum → PrintStatus: `9 complete → done`, `8 stopped → canceled`,
`CurrentStatus contains 1` or `Status 13 → printing`.

### ⚠️ The spike's #1 risk: file upload
SDCP's file-transfer route + chunking is **under-specified and differs across firmware**
(resin vs FDM). The adapter implements the common
`POST http://<ip>:3030/uploadFile/upload` multipart form, but this is the thing to
confirm first.

### Verify on your Elegoo
1. **Capture the real upload.** Use ElegooLink (or the printer's web UI) to send a file
   while capturing traffic (Wireshark / browser devtools). Note the exact upload URL,
   method, field name, and whether it chunks. Adjust `uploadGcode()` in `index.ts`.
2. **Discovery:** run a one-off `discover()` on the worker LAN; confirm your printer's
   `MainboardIP`/`MainboardID` come back. Store `mainboardId` in the printer secrets if
   it differs from the Station's `printerId`.
3. **Control:** confirm the WS handshake at `ws://<ip>:3030/websocket` and that a
   STATUS request (`Cmd 0`) returns a frame `parseStatusFrame` accepts.
4. Unset the stub, submit to the Elegoo station, watch the stepper; then test cancel.

Env: `ELEGOO_WS_PORT` (3030), `ELEGOO_DISCOVERY_PORT` (3000), `ELEGOO_DISCOVERY_MS`,
`ELEGOO_STATUS_TIMEOUT_MS`.

## Note on the handle
`PrintHandle` now carries an optional `address` so `status()`/`cancel()` reach the device
without re-resolving the printer (it's server-side only, never sent to clients).
