import { defineConfig } from "@playwright/test";

const database = process.env.TEST_DATABASE_URL;
if (!database || database !== process.env.DATABASE_URL) throw new Error("Explicit matching isolated database required");

export default defineConfig({
  tsconfig: "tsconfig.class-result-recalculation.json", testDir: ".", testMatch: "task-091-class-result-recalculation.spec.ts",
  timeout: 60_000, workers: 1,
  use: { baseURL: "http://127.0.0.1:3123", trace: "off", video: "off" },
  webServer: { command: "pnpm --filter @o-tid/web dev --hostname 127.0.0.1 --port 3123", cwd: "../..",
    url: "http://127.0.0.1:3123", reuseExistingServer: false, timeout: 90_000,
    env: { ...process.env, DATABASE_URL: database, O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3123", O_TID_DEMO_E2E: "1" } }
});
