# SCAD sources

OpenSCAD model sources used by generators. Mounted **read-only** into the worker at
`/scad`.

## gridfinity-rebuilt-openscad (submodule)

[kennetek/gridfinity-rebuilt-openscad](https://github.com/kennetek/gridfinity-rebuilt-openscad)
is a git submodule at `scad/gridfinity-rebuilt-openscad`. Fetch it after cloning:

```bash
git submodule update --init
```

The `gridfinity` generator shells out to:

```
openscad -o model.stl -D gridx=… -D gridy=… … /scad/gridfinity-rebuilt-openscad/gridfinity-rebuilt-bins.scad
```

Set `GRIDFINITY_SCAD` to use a different file. With `CONVEYOR_ENGINE_STUB=1` the generator
emits a placeholder STL without invoking OpenSCAD, so the submodule isn't needed in stub mode.
