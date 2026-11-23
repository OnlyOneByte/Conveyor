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
| Liberation fonts | `2.00.1`, bundled in the OpenSCAD source tarball, installed to `/opt/openscad/share/openscad/fonts/` | SIL OFL-1.1 (`fonts/Liberation-2.00.1/LICENSE`) | <https://github.com/liberationfonts/liberation-fonts> | `scripts/build-openscad.sh` (OpenSCAD's `cmake --install`) |
| MCAD | bundled in the OpenSCAD source tarball, installed to `/opt/openscad/share/openscad/libraries/MCAD/` | LGPL-2.1 (`README.markdown` and `lgpl-2.1.txt`) | <https://github.com/openscad/MCAD> | `scripts/build-openscad.sh` (OpenSCAD's `cmake --install`) |
| gridfinity-rebuilt-openscad | the `scad/gridfinity-rebuilt-openscad` submodule commit | MIT (`LICENSE`) | <https://github.com/kennetek/gridfinity-rebuilt-openscad> | `COPY . .` and the `./scad` mount |

## Other programs the Dockerfiles install

| Component | Version | License | Upstream | Image |
| --- | --- | --- | --- | --- |
| Xvfb (`xvfb`, from xorg-server) | Debian trixie package at build time | MIT/X11 (X.Org's license, Debian `copyright`) | <https://gitlab.freedesktop.org/xorg/xserver> | worker |
| GnuPG `gpgv` | Debian trixie package at build time | GPL-3.0-or-later (Debian `copyright`) | <https://gnupg.org> | worker `openscad` build stage only; not in the published image |
| curl | Debian trixie package at build time | curl license (Debian `copyright`) | <https://curl.se> | worker |
| Bun | the `oven/bun:debian` base image at build time | MIT; it statically links JavaScriptCore/WebKit, which is LGPL-2 (`LICENSE.md`) | <https://github.com/oven-sh/bun> | api, worker, web build |
| Node.js | 26, from the `node:26-bookworm-slim` base image (the 26.x release at build time) | MIT, plus bundled dependencies (`LICENSE`) | <https://github.com/nodejs/node> | web |

The worker's other `apt-get` packages are runtime libraries: GTK, WebKitGTK, Mesa, GStreamer and their
libraries for the slicers, and the Debian packages `/opt/openscad/bin/openscad` loads directly (its ELF
`NEEDED` entries, besides libc, libm, libgcc_s and libstdc++): `libboost-program-options1.83.0`, `libcairo2`,
`libdouble-conversion3`, `libfontconfig1`, `libfreetype6`, `libglib2.0-0t64`, `libgmp10`, `libharfbuzz0b`,
`libmpfr6`, `libtbb12` and `libxml2`. Each carries its license in `/usr/share/doc/<package>/copyright` inside
the image. OpenSSL, nettle and libzip are found at build time but not linked into the binary.

## Fonts in the web app

Vite bundles these into the web build and the app serves them itself; no page loads a font from another origin.

| Component | Version | License | Upstream | Installed by |
| --- | --- | --- | --- | --- |
| Bricolage Grotesque (variable) | `@fontsource-variable/bricolage-grotesque` `5.3.0` | SIL OFL-1.1 (`LICENSE`: © 2022 The Bricolage Grotesque Project Authors) | <https://github.com/ateliertriay/bricolage> | `packages/web/package.json` |
| DM Mono 400 and 500 | `@fontsource/dm-mono` `5.3.0` | SIL OFL-1.1 (`LICENSE`: © 2020 The DM Mono Project Authors) | <https://github.com/googlefonts/dm-mono> | `packages/web/package.json` |

## Images the compose stack runs unmodified

| Component | Version | License | Upstream | Service |
| --- | --- | --- | --- | --- |
| Redis | `redis:8-alpine` (8.10.3 when this was written), the official image, pulled as is | Redis 8 offers RSALv2, SSPLv1 or AGPLv3, at the user's choice; Conveyor uses it under AGPLv3, as an unmodified separate service (`LICENSE.txt`) | <https://github.com/redis/redis> | `redis` in `docker-compose.yml` |

## Source for the GPL, AGPL, LGPL and OFL components

- **OrcaSlicer:** the `v2.4.1` tag, <https://github.com/OrcaSlicer/OrcaSlicer/releases/tag/v2.4.1>.
- **PrusaSlicer, Xvfb, curl and the other Debian packages:** the matching Debian source package, with
  `apt-get source <package>=<version>` or from <https://sources.debian.org> and <https://snapshot.debian.org>.
  `dpkg -l` inside the image gives the exact versions.
- **OpenSCAD:** `openscad-2026.11-RC0.src.tar.gz` (sha256
  `9e64122961b3bafadfb7a4581498a3e7efd50f61316806fc7a137fd699ffc9d2`), the exact source the image builds,
  with its manifold, Clipper2 and mimalloc submodules, the Liberation fonts and MCAD. `release.yml` attaches it, with its `.asc` and
  `.sha256`, to each Conveyor GitHub release. Upstream:
  <https://github.com/openscad/openscad/releases/tag/openscad-2026.11-RC0>.
  `/opt/openscad/share/doc/openscad/SOURCE` in the image names the commit, URL and sha256.
- **Redis:** the matching `8.x` release tag, <https://github.com/redis/redis/releases>. `redis-cli INFO server`
  in the running container prints the exact `redis_version`.
- **Bun's WebKit:** <https://github.com/oven-sh/WebKit>, at the version Bun's `LICENSE.md` describes.
