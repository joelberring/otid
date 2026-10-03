import { defineConfig } from "@playwright/test";
const database = process.env.TEST_DATABASE_URL;
if (!database || database !== process.env.DATABASE_URL) throw new Error("Matchande isolerad testdatabas krävs");
export default defineConfig({
  tsconfig: "tsconfig.speaker.json", testDir: ".", testMatch: "task-008-speaker-manual.spec.ts",
  timeout: 60_000, workers: 1,
  projects: [{ name: "speaker-production" }],
  use: { baseURL: "https://127.0.0.1:3111", ignoreHTTPSErrors: true, trace: "off", video: "off",
    launchOptions: { ignoreDefaultArgs: ["--disable-back-forward-cache"] } },
  webServer: { command: "node tests/e2e/speaker-production-server.mjs", cwd: "../..",
    url: "https://127.0.0.1:3111/admin/10000000-0000-4000-8000-000000000001/speaker",
    ignoreHTTPSErrors: true, reuseExistingServer: false, timeout: 60_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
    env: { ...process.env, DATABASE_URL: database, TEST_DATABASE_URL: database } }
});
