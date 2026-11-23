FROM oven/bun:debian AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
COPY packages/worker/package.json packages/worker/
COPY plugins/generators/gridfinity/package.json plugins/generators/gridfinity/
COPY plugins/generators/passthrough/package.json plugins/generators/passthrough/
COPY plugins/slicers/orca/package.json plugins/slicers/orca/
COPY plugins/slicers/prusa/package.json plugins/slicers/prusa/
COPY plugins/transports/moonraker/package.json plugins/transports/moonraker/
COPY plugins/transports/elegoo/package.json plugins/transports/elegoo/
COPY plugins/registry/builtin/package.json plugins/registry/builtin/
RUN bun install --frozen-lockfile --production

FROM debian:trixie-slim AS openscad
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake ninja-build pkg-config bison flex gettext ca-certificates curl gpgv \
      libboost-program-options-dev libboost-regex-dev libcgal-dev libeigen3-dev libgmp-dev libmpfr-dev \
      libdouble-conversion-dev libfontconfig-dev libfreetype-dev libharfbuzz-dev libglib2.0-dev \
      libxml2-dev libzip-dev libtbb-dev libcairo2-dev libssl-dev nettle-dev \
 && rm -rf /var/lib/apt/lists/*
COPY --chmod=755 scripts/build-openscad.sh scripts/fetch-openscad-source.sh scripts/verify-openscad-signature.sh /tmp/
COPY scripts/openscad-release-key.asc /tmp/
RUN /tmp/build-openscad.sh /opt/openscad

FROM oven/bun:debian
LABEL org.opencontainers.image.source="https://github.com/OnlyOneByte/Conveyor" \
      org.opencontainers.image.description="Conveyor worker — OpenSCAD generator + PrusaSlicer/OrcaSlicer engines" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
ARG ORCA_RELEASE=2.4.1
ARG ORCA_ENABLE=auto
ENV ORCA_BIN=/opt/orca/AppRun

RUN apt-get update && apt-get install -y --no-install-recommends \
      prusa-slicer \
      xvfb xauth ca-certificates curl \
      libharfbuzz0b libgpg-error0 libgcrypt20 libglib2.0-0 libfontconfig1 libfreetype6 libgomp1 \
      libgtk-3-0 libwebkit2gtk-4.1-0 libgl1 libegl1 libgstreamer1.0-0 fuse \
      libopengl0 libglu1-mesa libgl1-mesa-dri libglx-mesa0 libgles2 \
      libgstreamer-plugins-base1.0-0 libsecret-1-0 libsoup-3.0-0 \
      libxext6 libsm6 libice6 libnotify4 libgdk-pixbuf-2.0-0 \
      libboost-program-options1.83.0 libcairo2 libdouble-conversion3 libgmp10 libmpfr6 libtbb12 libxml2 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=openscad /opt/openscad /opt/openscad
ENV OPENSCAD_BIN=/opt/openscad/bin/openscad

COPY scripts/install-orca.sh /tmp/install-orca.sh
RUN chmod +x /tmp/install-orca.sh && /tmp/install-orca.sh "${ORCA_RELEASE}" "${ORCA_ENABLE}"
ENV ORCA_DATADIR=/opt/orca/squashfs-root/resources/profiles

WORKDIR /app
COPY --from=deps /app ./
COPY . .
RUN groupadd --system --gid 10001 conveyor \
 && useradd --system --uid 10001 --gid 10001 --create-home --home-dir /home/conveyor conveyor
ENV HOME=/home/conveyor
COPY --chmod=755 scripts/docker-entrypoint.sh /usr/local/bin/conveyor-entrypoint
ENTRYPOINT ["conveyor-entrypoint"]
RUN orca=true \
 && if [ -e /opt/orca/AppRun ]; then orca='test -x /opt/orca/AppRun && test -r "$ORCA_DATADIR"'; fi \
 && setpriv --reuid=10001 --regid=10001 --clear-groups sh -c "/opt/openscad/bin/openscad --version && $orca" \
 || { echo "uid 10001 cannot run OpenSCAD or OrcaSlicer" >&2; exit 1; }

CMD ["bun", "packages/worker/src/main.ts"]
