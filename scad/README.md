# SCAD sources

OpenSCAD model sources used by generators. Mounted **read-only** into the worker at
`/scad`.

## gridfinity-rebuilt-openscad (planned submodule)

The `gridfinity` generator shells out to:

```
openscad -o model.stl -D 'gridx=…;gridy=…;…' /scad/gridfinity-rebuilt-openscad/gridfinity.scad
```

Add it as a submodule (personal GitHub, no corp tooling):

```bash
git submodule add https://github.com/kennetek/gridfinity-rebuilt-openscad \
  scad/gridfinity-rebuilt-openscad
```

> Not yet vendored — M0/M1 run the generator in `CONVEYOR_ENGINE_STUB=1` mode, which
> emits a placeholder STL without invoking OpenSCAD. Wire the submodule when enabling
> real generation, and confirm the `-D` parameter names match the lib's variables.
