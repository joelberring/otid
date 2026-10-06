import { randomBytes } from "node:crypto";
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
 *
 * Eventor (ADR-0170 beslut 4): global-setup startar en falsk Eventor på E2E_EVENTOR_PORT (4319).
 * Utvecklingsservern får en slumpad masternyckel och pekas dit; driftmiljön får samma inställningar
 * via sin .env (se CI).
 *
 * E-post (ADR-0172): global-setup startar en falsk SMTP-server på E2E_SMTP_PORT (4325) som sparar
 * mejlen i E2E_MAIL_DIR. Webben skickar dit med vanlig SMTP (OTID_SMTP_URL). Många konton skapas
 * från samma adress, så gränsen för registreringar höjs (OTID_REGISTRATION_LIMIT_PER_HOUR).
 *
 * Radiokontroller (ADR-0172 beslut 5): global-setup startar en falsk ROC på E2E_ROC_PORT (4331). Webben pekas dit med
 * OTID_ROC_BASE_URL; driftmiljön får samma inställning via sin .env (se CI).
 */
const external = process.env.E2E_BASE_URL;
const port = Number(process.env.E2E_PORT ?? 3100);
const origin = external ?? `http://127.0.0.1:${port}`;
const database = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
/** Samma port som tests/e2e/fake-eventor.ts. */
const eventorPort = Number(process.env.E2E_EVENTOR_PORT ?? 4319);
/** Samma port som tests/e2e/fake-smtp.ts. */
const smtpPort = Number(process.env.E2E_SMTP_PORT ?? 4325);
/** Samma port som tests/e2e/fake-roc.ts. */
const rocPort = Number(process.env.E2E_ROC_PORT ?? 4331);
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
      env: { ...process.env, DATABASE_URL: database!, O_TID_PUBLIC_ORIGIN: origin,
        OTID_EVENTOR_MASTER_KEY: randomBytes(32).toString("base64"), OTID_EVENTOR_BASE_URL: `http://127.0.0.1:${eventorPort}`,
        OTID_SMTP_URL: `smtp://127.0.0.1:${smtpPort}`, OTID_MAIL_FROM: "O-Tid test <noreply@o-tid.test>",
        OTID_REGISTRATION_LIMIT_PER_HOUR: "1000", OTID_ROC_BASE_URL: `http://127.0.0.1:${rocPort}` }
    }
  })
});
