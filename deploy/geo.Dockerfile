# ADR-0219 K5: geo-arbetaren (Karttapullautin och scripts/geo-worker.ts) för en egen geo-server. Byggs för linux/amd64 och
# linux/arm64 (Hetzner CX och CAX). Karttapullautin (GPL-3, https://github.com/karttapullautin/karttapullautin) byggs oförändrad
# ur källkoden vid taggen nedan och körs som ett eget program; ingen kod kopieras in i O-Tid.
ARG PULLAUTIN_TAG=v2.15.4
ARG PULLAUTIN_COMMIT=7a25b61e46609e11a0c41be0686307c651227598

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

FROM node:24-bookworm-slim
ARG PULLAUTIN_TAG
ENV NODE_ENV=production OTID_PULLAUTA=/opt/pullauta/pullauta OTID_PULLAUTA_INI=/opt/pullauta/pullauta.default.ini OTID_GEO_WORKDIR=/work
COPY --from=pullautin /pullauta /opt/pullauta/pullauta
COPY --from=pullautin /src/pullauta.default.ini /src/LICENSE /opt/pullauta/
RUN echo "Karttapullautin ${PULLAUTIN_TAG}, GPL-3. Källkoden: https://github.com/karttapullautin/karttapullautin/tree/${PULLAUTIN_TAG}" > /opt/pullauta/KALLA.txt \
  && mkdir -p /work /app && chown node:node /work
# Geo-arbetaren och fuktigheten (K5c) körs direkt av Node (typerna tas bort); package.json gör dem till ES-moduler.
COPY --chown=node:node scripts/geo-worker.ts scripts/geo-moisture.ts /app/
RUN echo '{ "type": "module", "private": true }' > /app/package.json
USER node
WORKDIR /app
CMD ["node", "/app/geo-worker.ts"]
