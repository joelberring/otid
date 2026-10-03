import { defineConfig } from "@playwright/test";
const database = process.env.TEST_DATABASE_URL;
if (!database || database !== process.env.DATABASE_URL) throw new Error("Speakerprov kräver samma isolerade DATABASE_URL/TEST_DATABASE_URL");
export default defineConfig({
  tsconfig: "tsconfig.speaker.json",
  testDir: ".", testMatch: ["task-008-speaker.spec.ts", "task-008-speaker-manual.spec.ts"], timeout: 60_000, workers: 1,
  use: { baseURL: "http://127.0.0.1:3108", trace: "off", video: "off",
    // Playwright otherwise disables the browser facility this navigation test observes.
    launchOptions: { ignoreDefaultArgs: ["--disable-back-forward-cache"] } },
  webServer: { command: "pnpm --filter @o-tid/web dev --port 3108", cwd: "../..",
    url: "http://127.0.0.1:3108/admin/10000000-0000-4000-8000-000000000001/speaker", reuseExistingServer: false, timeout: 90_000,
    env: { ...process.env, DATABASE_URL: database, O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3108", O_TID_DEMO_E2E: "1" } }
});
