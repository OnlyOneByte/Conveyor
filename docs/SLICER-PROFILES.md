# Slicer profile validation

Edited slicer profiles are untrusted input. They are validated twice with the same shared code in `packages/shared/src/profile.ts`: once by the API before they are stored, and again by the worker before it writes them to disk for the slicer. A row edited directly in SQLite is therefore still checked before any slicer runs.

## Setting keys

Every setting key in an edited profile must be on an allowlist in `packages/shared/src/slicer-keys.ts`:

- `PRUSA_CONFIG_KEYS` covers each `key = value` line of a Prusa `config.ini`. Blank lines, `#` or `;` comments and `[section]` headers are skipped; any other line that is not an assignment is rejected.
- `ORCA_CONFIG_KEYS` covers every top-level key of the Orca `machine.json`, `process.json` and `filament.json` documents.

A profile with any key outside the list is rejected with a 400 from the API, or fails the slicer stage in the worker.

### What is left out on purpose

The lists exclude keys that make the slicer do more than turn a model into G-code:

- post-processing and script hooks
- output file name templates
- print host upload targets and credentials (address, API key, user, password, port, CA file)
- plugin loading
- custom bed model and texture file paths

The print host type, authorization type and certificate-revocation flags stay allowed: they are plain choices, the bundled Orca profile sets them, and the CLI never uploads.

### Where the lists come from

Each list is the set of print-config option names that the slicer itself defines, plus the keys the bundled profiles under `profiles/` already use, minus the classes above. The upstream source files are:

- PrusaSlicer: `src/slic3r-shared/src/Slic3r/Biz/Config/Legacy/PrintConfig.cpp`, the `PrintConfigDef` section up to `handle_legacy`
- OrcaSlicer: `src/libslic3r/PrintConfig.cpp`, the `PrintConfigDef` section up to `handle_legacy`

The per-axis machine limits (`machine_max_*_x|y|z|e`) are built in a loop upstream and are added by hand. Orca preset metadata (`type`, `name`, `inherits`, `from`, `setting_id`, `instantiation`, `version`, `filament_id`, `is_custom_defined`, `description`) is also allowed.

To pick up a new slicer release, extract the option names from those files again, apply the same exclusions, and regenerate the file. Any new key must be checked against the classes above before it is allowed.

## Profile paths

A profile's `path` must be `/profiles/<bundle>`: one directory name made of letters, digits, `.`, `_` and `-`, starting with a letter or digit and containing no `..`. `isBundledProfilePath` enforces this in `PUT /catalog/profiles` and in the worker before slicing. The API also rejects a profile whose `slicerId` is not a registered slicer.
