# Orca — Klipper PLA 0.2mm (verified)

OrcaSlicer leaf-preset bundle for a **Klipper**-flavored 0.2mm PLA print.

- `machine.json`  — `Creality K1 (0.4 nozzle)` (inherits `fdm_creality_common`), `gcode_flavor: klipper`
- `process.json`  — `0.20mm Standard @Creality K1 (0.4 nozzle)`
- `filament.json` — `Creality Generic PLA @K1-all`

These are **verbatim leaf exports** from OrcaSlicer 2.4.1's bundled system profiles.
Their `inherits` parents (`fdm_creality_common`, `fdm_process_creality_common`,
`Creality Generic PLA`, …) are resolved at slice time against `ORCA_DATADIR`
(the AppImage's `resources/profiles` tree, set in the worker Dockerfile).

## Why this family

Verified 2026-06-30 in the worker base image (`oven/bun:1.3.14-debian`, aarch64):

```
orca-slicer --datadir <vendor-tree> \
  --load-settings "machine.json;process.json" --load-filaments "filament.json" \
  --slice 0 --outputdir <dir> cube.stl
→ exit 0, plate_1.gcode 232 KB, gcode_flavor = klipper, 302 layers
```

The K1 is a native-Klipper printer whose `before_layer_change_gcode` emits `G92 E0`,
so it passes Orca's relative-E **normative check** — a generic `MyKlipper` base or a
thin `inherits`-only wrapper does **not** (fails `-17`/`-51`). See `docs/M1-WORKER-ENGINES.md`.

## Swapping in your own printer

Export `machine.json` / `process.json` / `filament.json` from the OrcaSlicer GUI
(Profile → Export) for your printer, drop them in a new `profiles/orca-<id>/` dir,
add a `Profile` row in `packages/shared/src/db/seed.ts` (or in Settings). Its
`gcodeFlavor` must be one the target printer's transport lists in
`acceptsFlavors`, or the pair is refused at submit (and the PWA will not offer it).

## Editing the JSON in-app

You can also tweak these three documents directly in the app (Settings → the profile
row → **Edit JSON**) without re-exporting. The edit is stored in the database and
overrides the bundled file above until you **Reset**. When you edit, *you* own the
correctness the GUI would otherwise guarantee:

- **`inherits`** — leaf presets inherit vendor system parents resolved at slice time
  against `ORCA_DATADIR`. Keep the `inherits` key (and its exact parent name) intact, or
  the slice loses every inherited setting.
- **Machine dimensions** — bed size, origin, and nozzle diameter must match the real
  printer; a mismatch slices happily but prints wrong.
- **`gcode_flavor`** — must stay consistent with the profile row's `gcodeFlavor` and the
  target transport's `acceptsFlavors`, or the pair becomes unprintable.
- **Start/end G-code** — retained verbatim; a Klipper printer needs its relative-E and
  homing sequence (see the normative-check note above) or Orca rejects the slice.

The server validates that each document parses as a JSON object and stays within the
size limits, but it does **not** re-run OrcaSlicer's semantic checks on save — a
malformed-but-parseable profile only surfaces when a job actually slices.
