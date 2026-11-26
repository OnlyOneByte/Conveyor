# Slicer profile validation

Edited slicer profiles are untrusted input. They are validated twice with the same shared code in `packages/shared/src/profile.ts`: once by the API before they are stored, and again by the worker before it writes them to disk for the slicer. A row edited directly in SQLite is therefore still checked before any slicer runs.

## Setting keys

Every setting key in an edited profile must be on an allowlist. The lists are data files, `packages/shared/slicer-keys/prusa.json` and `orca.json`. `packages/shared/src/slicer-keys.ts` loads them into sets and refuses to load if an entry is not a plain key name or matches the excluded classes in `packages/shared/src/slicer-key-policy.ts`:

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

### Custom G-code stays allowed

Keys such as `start_gcode`, `end_gcode`, `layer_gcode`, `machine_start_gcode` and `before_layer_change_gcode` stay on the list on purpose. Their text is copied into the G-code file that goes to the printer. The slicer expands placeholders in it with its own macro language, which has no way to start a program or touch files on the worker. Editing start and end G-code is also a core reason to edit a profile at all. The risk that remains is on the printer side: whoever can edit a profile can make the printer run any G-code. That is the same trust as sending a print, so it is gated by catalog write access rather than by this list.

### Where the lists come from

Each list is the set of print-config option names that the slicer itself defines, plus the keys the bundled profiles under `profiles/` already use, minus the classes above. The upstream source files are:

- PrusaSlicer: `src/slic3r-shared/src/Slic3r/Biz/Config/Legacy/PrintConfig.cpp`, the `PrintConfigDef` section up to `handle_legacy`
- OrcaSlicer: `src/libslic3r/PrintConfig.cpp`, the `PrintConfigDef` section up to `handle_legacy`

The per-axis machine limits (`machine_max_*_x|y|z|e`) are built in a loop upstream and are added by hand. Orca preset metadata (`type`, `name`, `inherits`, `from`, `setting_id`, `instantiation`, `version`, `filament_id`, `is_custom_defined`, `description`) is also allowed.

### Regenerating

`scripts/slicer-keys/generate.ts` builds both files. It downloads the two upstream files at the commits pinned in its `SOURCES` table, so the output is the same on any machine:

```sh
bun run slicer-keys
bun run check:slicer-keys
```

The first command rewrites the data files. The second regenerates in memory and exits non-zero if the committed files differ, so CI or a reviewer can confirm the data matches the pinned sources and the bundled profiles. It needs network access to `raw.githubusercontent.com`.

To pick up a new slicer release, change the pinned commit, run `bun run slicer-keys`, and review every added key against the classes above before you commit. To exclude a new class, change `DENIED_KEY` in `slicer-key-policy.ts` and regenerate.

## Profile paths

A profile's `path` must be `/profiles/<bundle>`: one directory name made of letters, digits, `.`, `_` and `-`, starting with a letter or digit and containing no `..`. `isBundledProfilePath` enforces this in `PUT /catalog/profiles` (`packages/api/src/catalog-validation.ts`) and in the worker before slicing. The API also rejects a profile whose `slicerId` is not a registered slicer.

The worker also resolves the bundle with `realpath` under `CONVEYOR_PROFILES_ROOT` (default `/profiles`) and refuses a directory that resolves outside that root, for example through a symlink. `/profiles` is mounted read-only today, so this is defence in depth. The slicer gets the resolved path.
