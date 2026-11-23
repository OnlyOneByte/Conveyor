# Third-party notices

Conveyor itself is `AGPL-3.0-or-later` ([LICENSE](LICENSE)). The container images also ship the third-party
programs below, each under its own license. Each license was read from the upstream repository or from the
Debian package's own `copyright` file, not inferred.

## Engines in the worker image

| Component | Version in the image | License | Upstream | Installed by |
| --- | --- | --- | --- | --- |
| OrcaSlicer | `v2.4.1` (`ORCA_RELEASE`), AppImage, SHA-256-checked | AGPL-3.0 (`LICENSE.txt`) | <https://github.com/OrcaSlicer/OrcaSlicer> | `scripts/install-orca.sh` |
| PrusaSlicer | the Debian trixie `prusa-slicer` package at build time (`2.9.2+dfsg-1` when this was written) | AGPL-3; its icons are CC-BY-3.0 (Debian `copyright`) | <https://github.com/prusa3d/PrusaSlicer> | `apt-get` in `packages/worker/Dockerfile` |
| OpenSCAD | `2026.11-RC0`, commit `9ba0cee7c947`, built from the signed upstream source tarball on every arch | GPL-2.0-or-later, with an exception for linking CGAL (`COPYING` and source headers); it statically links its bundled manifold (Apache-2.0), Clipper2 (BSL-1.0) and mimalloc (MIT) | <https://github.com/openscad/openscad> | the `openscad` stage of `packages/worker/Dockerfile`, with `scripts/fetch-openscad-source.sh` and `scripts/build-openscad.sh` |
| gridfinity-rebuilt-openscad | the `scad/gridfinity-rebuilt-openscad` submodule commit | MIT (`LICENSE`) | <https://github.com/kennetek/gridfinity-rebuilt-openscad> | `COPY . .` and the `./scad` mount |

## Other programs the Dockerfiles install

| Component | Version | License | Upstream | Image |
| --- | --- | --- | --- | --- |
| Xvfb (`xvfb`, from xorg-server) | Debian trixie package at build time | MIT/X11 (X.Org's license, Debian `copyright`) | <https://gitlab.freedesktop.org/xorg/xserver> | worker |
| GnuPG `gpgv` | Debian trixie package at build time | GPL-3.0-or-later (Debian `copyright`) | <https://gnupg.org> | worker `openscad` build stage only; not in the published image |
| curl | Debian trixie package at build time | curl license (Debian `copyright`) | <https://curl.se> | worker |
| Bun | the `oven/bun:debian` base image at build time | MIT; it statically links JavaScriptCore/WebKit, which is LGPL-2 (`LICENSE.md`) | <https://github.com/oven-sh/bun> | api, worker, web build |
| Node.js | the `node:lts-bookworm-slim` base image at build time | MIT, plus bundled dependencies (`LICENSE`) | <https://github.com/nodejs/node> | web |

The worker's other `apt-get` packages are runtime libraries: GTK, WebKitGTK, Mesa, GStreamer and their
libraries for the slicers, and `libboost-program-options1.83.0`, `libcairo2`, `libdouble-conversion3`,
`libgmp10`, `libmpfr6`, `libtbb12` and `libxml2`, which OpenSCAD links against. Each carries its license in
`/usr/share/doc/<package>/copyright` inside the image.

## Source for the GPL, AGPL and LGPL components

- **OrcaSlicer:** the `v2.4.1` tag, <https://github.com/OrcaSlicer/OrcaSlicer/releases/tag/v2.4.1>.
- **PrusaSlicer, Xvfb, curl and the other Debian packages:** the matching Debian source package, with
  `apt-get source <package>=<version>` or from <https://sources.debian.org> and <https://snapshot.debian.org>.
  `dpkg -l` inside the image gives the exact versions.
- **OpenSCAD:** `openscad-2026.11-RC0.src.tar.gz` (sha256
  `9e64122961b3bafadfb7a4581498a3e7efd50f61316806fc7a137fd699ffc9d2`), the exact source the image builds,
  with its manifold, Clipper2 and mimalloc submodules. `release.yml` attaches it, with its `.asc` and
  `.sha256`, to each Conveyor GitHub release. Upstream:
  <https://github.com/openscad/openscad/releases/tag/openscad-2026.11-RC0>.
  `/opt/openscad/share/doc/openscad/SOURCE` in the image names the commit, URL and sha256.
- **Bun's WebKit:** <https://github.com/oven-sh/WebKit>, at the version Bun's `LICENSE.md` describes.
