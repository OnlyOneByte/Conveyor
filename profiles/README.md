# Slicer profiles

Operator-curated slicer settings. End users never see the settings themselves — they
pick a printer and one of these profiles (`docs/DATA-MODEL.md`).

Mounted **read-only** at `/profiles` into both the api (which serves the bundled files to
the Settings editor) and the worker (which slices with them). Referenced by
`ProfileRef.path` in each slicer adapter. These files are the **defaults**: you can edit a
profile directly in the app (Settings → a profile row → **Edit JSON** for Orca, **Edit
INI** for PrusaSlicer), and that edit — stored in SQLite, not here — takes precedence at
slice time. **Reset** in the same editor discards the edit and falls back to the file on
this mount, so keep these bundles as the known-good baseline. Exporting fresh bundles is
therefore optional — only needed to change the *default* or to seed a brand-new profile.

## Layout

An OrcaSlicer profile is a directory of the three config JSONs exported from the
OrcaSlicer GUI (Profile → Export). A PrusaSlicer profile is a directory holding one
exported `config.ini`.

```
profiles/
  orca-klipper-pla-0.2/
    machine.json     # printer/machine settings
    process.json     # print process (layer height, speeds, …)
    filament.json    # filament
    README.md        # where the bundle came from and how it was verified
  prusa-klipper-pla-0.2/
    config.ini
  prusa-marlin-pla-0.2/
    config.ini
```

The seed catalog (`packages/shared/src/db/seed.ts`) points the profiles
`orca/klipper-pla-0.2`, `prusa/klipper-pla-0.2` and `prusa/marlin-pla-0.2` at these
directories.

> `.gitignore` excludes `profiles/**/secrets*`. The config bundles themselves
> are safe to commit if you want them version-controlled; keep any device tokens out.
