# Slicer profiles

Operator-curated slicer settings. End users never see the settings themselves — they
pick a printer and one of these profiles (`docs/DATA-MODEL.md`).

Mounted **read-only** into the worker at `/profiles`. Referenced by `ProfileRef.path`
in each slicer adapter. These files are the **defaults**: for Orca profiles you can edit
the raw `machine`/`process`/`filament` JSON directly in the app (Settings → a profile
row → **Edit JSON**), and that edit — stored in SQLite, not here — takes precedence at
slice time. **Reset** in the same editor discards the edit and falls back to the file on
this mount, so keep these bundles as the known-good baseline. Exporting fresh bundles
from OrcaSlicer is therefore optional — only needed to change the *default* or to seed a
brand-new profile.

## Layout (OrcaSlicer)

Each profile is a directory of the three OrcaSlicer config JSONs exported from the
OrcaSlicer GUI (Profile → Export):

```
profiles/
  klipper-pla-0.2/
    machine.json     # printer/machine settings
    process.json     # print process (layer height, speeds, …)
    filament.json    # filament
  elegoo-pla-0.2/
    machine.json
    process.json
    filament.json
```

> `.gitignore` excludes `profiles/**/secrets*`. The JSON config bundles themselves
> are safe to commit if you want them version-controlled; keep any device tokens out.

## M0/M1 status

Empty placeholders. Export real bundles from OrcaSlicer once the M1 image can slice,
then drop them here and point a profile row's `path` at the directory.
