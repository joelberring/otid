import { defineConfig } from "@playwright/test";

const database = process.env.TEST_DATABASE_URL;
if (!database || database !== process.env.DATABASE_URL) throw new Error("Explicit matching isolated database required");
const origin = "http://127.0.0.1:3126";

export default defineConfig({
  tsconfig: "tsconfig.public-final-results.json", testDir: ".", testMatch: "task-127-public-final-results.spec.ts",
  timeout: 60_000, workers: 1,
  use: { baseURL: origin, trace: "off", video: "off" },
  webServer: {
    command: "pnpm --filter @o-tid/web dev --hostname 127.0.0.1 --port 3126", cwd: "../..",
    url: origin, reuseExistingServer: false, timeout: 90_000,
    env: { ...process.env, DATABASE_URL: database, O_TID_PUBLIC_ORIGIN: origin, O_TID_DEMO_E2E: "1" }
  }
});
