# Locked slicer profiles

Admin-curated, server-side-only slicer settings. End users never see these — they
pick a **Station** (`docs/DATA-MODEL.md`), which binds a printer to one profile here.

Mounted **read-only** into the worker at `/profiles`. Referenced by `ProfileRef.path`
in each slicer adapter.

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
then drop them here and point a Station's `profileId` at the directory.
