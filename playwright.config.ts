import { defineConfig, devices } from "@playwright/test";

/**
 * En gemensam konfiguration för alla webbläsartester (ADR-0168).
 * Kräver E2E_DATABASE_URL eller TEST_DATABASE_URL till en PostgreSQL/PostGIS-databas.
 * Databasen migreras i global-setup. Testerna skapar egna unika konton och tävlingar.
 */
const port = Number(process.env.E2E_PORT ?? 3100);
const origin = `http://127.0.0.1:${port}`;
const database = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!database) throw new Error("Sätt E2E_DATABASE_URL eller TEST_DATABASE_URL för webbläsartesterna");
process.env.E2E_DATABASE_URL = database;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  use: { baseURL: origin, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: `pnpm --filter @o-tid/web dev --port ${port}`,
    url: `${origin}/organizer`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { ...process.env, DATABASE_URL: database, O_TID_PUBLIC_ORIGIN: origin }
  }
});
