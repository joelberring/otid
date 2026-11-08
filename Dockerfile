# Webben för drift (ADR-0168, steg 6): Next standalone + paketerad migrering.
# ADR-0195: samma avbildning för alla servrar (inget serverspecifikt byggs in; allt läses från miljön när den startar). GitHub
# Actions bygger den efter grön CI på main och lägger den i ghcr.io/joelberring/otid-web; servern hämtar den (docs/drift.md).
FROM node:24-bookworm-slim AS build
# OTID_SKIP_BUILD_CHECKS=1: next build hoppar över typkontrollen (CI kör den vid varje push). Halverar byggtiden och tar bort
# en minut med drygt 2 GB i minnet. --build-arg OTID_SKIP_BUILD_CHECKS=0 kontrollerar typerna även här.
ARG OTID_SKIP_BUILD_CHECKS=1
# Taket gäller Nodes egen heap (Turbopack är Rust och räknas inte); bygget klarar sig med 1 GB, 1,5 GB ger marginal på 4 GB.
ENV CI=1 NEXT_TELEMETRY_DISABLED=1 OTID_SKIP_BUILD_CHECKS=${OTID_SKIP_BUILD_CHECKS} NODE_OPTIONS=--max-old-space-size=1536
RUN corepack enable
WORKDIR /src
COPY . .
# BuildKit-cacher (finns bara på byggdatorn, inte i avbildningen): pnpm:s paketlager och Nexts byggcache (Turbopack). Ett nytt
# bygge på samma dator laddar inte ner paketen igen och kompilerar bara det som ändrats.
RUN --mount=type=cache,id=otid-pnpm-store,target=/pnpm-store,sharing=locked \
  pnpm install --frozen-lockfile --store-dir /pnpm-store
RUN --mount=type=cache,id=otid-next-cache,target=/src/apps/web/.next/cache,sharing=locked \
  pnpm --filter @o-tid/web build
# ADR-0219 (K2): kartjobben i utskriftsarbetaren ritar med @napi-rs/canvas (inbyggd modul, samma version som i package.json).
RUN mkdir -p /canvas && cd /canvas && npm init -y >/dev/null \
  && npm install --omit=dev --no-audit --no-fund "@napi-rs/canvas@$(node -p "require('/src/package.json').dependencies['@napi-rs/canvas']")"

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1 MIGRATIONS_DIR=/app/migrations
WORKDIR /app
COPY --chown=node:node --from=build /src/apps/web/.next/standalone ./
COPY --chown=node:node --from=build /src/apps/web/.next/static ./apps/web/.next/static
COPY --chown=node:node --from=build /src/apps/web/public ./apps/web/public
COPY --chown=node:node --from=build /src/apps/web/.next/migrate.mjs ./migrate.mjs
# Superadmin sätts bara med kommando på servern (ADR-0172): node superadmin.mjs grant <e-post>
COPY --chown=node:node --from=build /src/apps/web/.next/superadmin.mjs ./superadmin.mjs
# Steg 65: utskriftsarbetaren (tjänsten print-worker: node print-worker.mjs) och typsnitten för PDF:en (Roboto, OFL 1.1).
COPY --chown=node:node --from=build /src/apps/web/.next/print-worker.mjs ./print-worker.mjs
COPY --chown=node:node --from=build /src/apps/web/.next/fonts ./fonts
COPY --chown=node:node --from=build /canvas/node_modules/@napi-rs ./node_modules/@napi-rs
COPY --chown=node:node --from=build /src/packages/database/migrations ./migrations
USER node
EXPOSE 3000
# Migrerar först; startar webben bara om migreringen lyckades.
CMD ["sh", "-c", "node migrate.mjs && exec node apps/web/server.js"]
