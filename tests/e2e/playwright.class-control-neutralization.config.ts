import { defineConfig } from "@playwright/test";
const database = process.env.TEST_DATABASE_URL;
if (!database || database !== process.env.DATABASE_URL) throw new Error("Explicit matching isolated database required");
export default defineConfig({ tsconfig: "tsconfig.class-control-neutralization.json", testDir: ".", testMatch: "task-092-class-control-neutralization.spec.ts", timeout: 60_000, workers: 1,
  use: { baseURL: "http://127.0.0.1:3124", trace: "off", video: "off" },
  webServer: { command: "pnpm --filter @o-tid/web dev --hostname 127.0.0.1 --port 3124", cwd: "../..", url: "http://127.0.0.1:3124", reuseExistingServer: false, timeout: 90_000,
    env: { ...process.env, DATABASE_URL: database, O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3124", O_TID_DEMO_E2E: "1" } } });
