# Webben för drift (ADR-0168, steg 6): Next standalone + paketerad migrering.
FROM node:24-bookworm-slim AS build
ENV CI=1 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @o-tid/web build

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1 MIGRATIONS_DIR=/app/migrations
WORKDIR /app
COPY --chown=node:node --from=build /src/apps/web/.next/standalone ./
COPY --chown=node:node --from=build /src/apps/web/.next/static ./apps/web/.next/static
COPY --chown=node:node --from=build /src/apps/web/public ./apps/web/public
COPY --chown=node:node --from=build /src/apps/web/.next/migrate.mjs ./migrate.mjs
# Superadmin sätts bara med kommando på servern (ADR-0172): node superadmin.mjs grant <e-post>
COPY --chown=node:node --from=build /src/apps/web/.next/superadmin.mjs ./superadmin.mjs
COPY --chown=node:node --from=build /src/packages/database/migrations ./migrations
USER node
EXPOSE 3000
# Migrerar först; startar webben bara om migreringen lyckades.
CMD ["sh", "-c", "node migrate.mjs && exec node apps/web/server.js"]
