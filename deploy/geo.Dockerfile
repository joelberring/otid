# ADR-0219 K5: geo-arbetaren (Karttapullautin och scripts/geo-worker.ts) för en egen geo-server. Byggs för linux/amd64 och
# linux/arm64 (Hetzner CX och CAX). Karttapullautin (GPL-3, https://github.com/karttapullautin/karttapullautin) byggs oförändrad
# ur källkoden vid taggen nedan och körs som ett eget program; ingen kod kopieras in i O-Tid.
ARG PULLAUTIN_TAG=v2.15.4
ARG PULLAUTIN_COMMIT=7a25b61e46609e11a0c41be0686307c651227598
# K6b: LibreDWG (GPL-3, https://www.gnu.org/software/libredwg/) för DWG-ritningar; bara programmet dwgread, oförändrat.
ARG LIBREDWG_VERSION=0.13.3
ARG LIBREDWG_SHA256=83f1f6e78a744777a481ff4520e4cef3f8ac4b2c1c25671077ca12fe81e8816e

# Karttapullautin korskompileras på byggdatorns plattform (snabbt även för arm64) och länkas statiskt, som i projektets egna
# utgåvor.
FROM --platform=$BUILDPLATFORM rust:1-bookworm AS pullautin
ARG PULLAUTIN_TAG
ARG PULLAUTIN_COMMIT
ARG TARGETARCH
WORKDIR /src
RUN git clone --depth 1 --branch "${PULLAUTIN_TAG}" https://github.com/karttapullautin/karttapullautin.git . \
  && test "$(git rev-parse HEAD)" = "${PULLAUTIN_COMMIT}"
RUN set -eu; \
  case "${TARGETARCH}" in \
    amd64) target=x86_64-unknown-linux-gnu ;; \
    arm64) target=aarch64-unknown-linux-gnu; apt-get update; apt-get install -y --no-install-recommends gcc-aarch64-linux-gnu libc6-dev-arm64-cross; \
      export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc ;; \
    *) echo "Okänd plattform ${TARGETARCH}"; exit 1 ;; \
  esac; \
  rustup target add "${target}"; \
  RUSTFLAGS='-C target-feature=+crt-static -C strip=symbols' cargo build --release --locked --target "${target}"; \
  cp "target/${target}/release/pullauta" /pullauta

# Grundkartan G1: lasclip (O-Tids eget lilla program, tools/lasclip) klipper laserfilerna till kartans område. Byggs på samma
# sätt som Karttapullautin och länkas statiskt.
FROM --platform=$BUILDPLATFORM rust:1-bookworm AS lasclip
ARG TARGETARCH
WORKDIR /src
COPY tools/lasclip/ .
RUN set -eu; \
  case "${TARGETARCH}" in \
    amd64) target=x86_64-unknown-linux-gnu ;; \
    arm64) target=aarch64-unknown-linux-gnu; apt-get update; apt-get install -y --no-install-recommends gcc-aarch64-linux-gnu libc6-dev-arm64-cross; \
      export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc ;; \
    *) echo "Okänd plattform ${TARGETARCH}"; exit 1 ;; \
  esac; \
  rustup target add "${target}"; \
  RUSTFLAGS='-C target-feature=+crt-static' cargo build --release --locked --target "${target}"; \
  cp "target/${target}/release/lasclip" /lasclip

# dwgread korskompileras likadant på byggdatorns plattform (Debian bookworm, samma glibc som Node-avbildningen). Två
# parallella kompileringar räcker; fler tar slut på minnet i den stora avkodaren.
FROM --platform=$BUILDPLATFORM debian:bookworm AS libredwg
ARG LIBREDWG_VERSION
ARG LIBREDWG_SHA256
ARG TARGETARCH
RUN set -eu; \
  apt-get update; apt-get install -y --no-install-recommends build-essential ca-certificates curl python3 xz-utils; \
  case "${TARGETARCH}" in \
    amd64) host=""; strip=strip ;; \
    arm64) apt-get install -y --no-install-recommends gcc-aarch64-linux-gnu libc6-dev-arm64-cross binutils-aarch64-linux-gnu; \
      host="--host=aarch64-linux-gnu"; strip=aarch64-linux-gnu-strip ;; \
    *) echo "Okänd plattform ${TARGETARCH}"; exit 1 ;; \
  esac; \
  curl -fsSL -o /tmp/libredwg.tar.xz "https://github.com/LibreDWG/libredwg/releases/download/${LIBREDWG_VERSION}/libredwg-${LIBREDWG_VERSION}.tar.xz"; \
  echo "${LIBREDWG_SHA256}  /tmp/libredwg.tar.xz" | sha256sum -c -; \
  mkdir /src; tar -xJf /tmp/libredwg.tar.xz -C /src --strip-components=1; cd /src; \
  ./configure ${host} --disable-bindings --disable-python --enable-release --disable-shared --prefix=/usr/local; \
  make -j2 -C src; make -j2 -C programs dwgread; \
  mkdir -p /opt/libredwg/bin; "${strip}" -o /opt/libredwg/bin/dwgread programs/dwgread; cp COPYING /opt/libredwg/

FROM node:24-bookworm-slim
ARG PULLAUTIN_TAG
ARG LIBREDWG_VERSION
ENV NODE_ENV=production OTID_PULLAUTA=/opt/pullauta/pullauta OTID_PULLAUTA_INI=/opt/pullauta/pullauta.default.ini OTID_GEO_WORKDIR=/work \
  OTID_DWGREAD=/opt/libredwg/bin/dwgread OTID_LASCLIP=/opt/lasclip/lasclip
COPY --from=pullautin /pullauta /opt/pullauta/pullauta
COPY --from=pullautin /src/pullauta.default.ini /src/LICENSE /opt/pullauta/
COPY --from=libredwg /opt/libredwg /opt/libredwg
COPY --from=lasclip /lasclip /opt/lasclip/lasclip
RUN echo "Karttapullautin ${PULLAUTIN_TAG}, GPL-3. Källkoden: https://github.com/karttapullautin/karttapullautin/tree/${PULLAUTIN_TAG}" > /opt/pullauta/KALLA.txt \
  && echo "LibreDWG ${LIBREDWG_VERSION}, GPL-3. Källkoden: https://github.com/LibreDWG/libredwg/releases/tag/${LIBREDWG_VERSION}" > /opt/libredwg/KALLA.txt \
  && mkdir -p /work /app && chown node:node /work
# Geo-arbetaren och fuktigheten (K5c) körs direkt av Node (typerna tas bort); package.json gör dem till ES-moduler.
COPY --chown=node:node scripts/geo-worker.ts scripts/geo-moisture.ts scripts/geo-vegetation.ts scripts/geo-water.ts scripts/geo-cliffs.ts scripts/geo-ditches.ts scripts/geo-rock.ts scripts/geo-gpkg.ts scripts/geo-dwg.ts /app/
RUN echo '{ "type": "module", "private": true }' > /app/package.json
USER node
WORKDIR /app
CMD ["node", "/app/geo-worker.ts"]
