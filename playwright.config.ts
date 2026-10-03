import { defineConfig, devices } from "@playwright/test";

/**
 * En gemensam konfiguration för alla webbläsartester (ADR-0168).
 *
 * Standard: startar webben i utvecklingsläge på port 3100 mot E2E_DATABASE_URL
 * (eller TEST_DATABASE_URL), som migreras i global-setup.
 *
 * Mot en körande driftmiljö: sätt E2E_BASE_URL (t.ex. https://localhost från
 * docker-compose.prod.yml). Då startas ingen server och självsignerade
 * certifikat godtas.
 */
const external = process.env.E2E_BASE_URL;
const port = Number(process.env.E2E_PORT ?? 3100);
const origin = external ?? `http://127.0.0.1:${port}`;
const database = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!external && !database) throw new Error("Sätt E2E_DATABASE_URL eller TEST_DATABASE_URL för webbläsartesterna (eller E2E_BASE_URL)");
if (!external && database) process.env.E2E_DATABASE_URL = database;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  // Utvecklingsservern kompilerar sidor vid första besöket, vilket kan vara långsamt i CI.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: origin, trace: "retain-on-failure", ...devices["Desktop Chrome"],
    ...(external ? { ignoreHTTPSErrors: true, launchOptions: { args: ["--ignore-certificate-errors"] } } : {})
  },
  ...(external ? {} : {
    webServer: {
      command: `pnpm --filter @o-tid/web dev --port ${port}`,
      url: `${origin}/organizer`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { ...process.env, DATABASE_URL: database!, O_TID_PUBLIC_ORIGIN: origin }
    }
  })
});
