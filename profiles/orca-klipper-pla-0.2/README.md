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
add a `Profile` row in `packages/shared/src/db/seed.ts` (or via the admin panel), and
point a Station at it. Keep the printer Klipper- or Marlin-flavored to match the
transport's `acceptsFlavors`.
