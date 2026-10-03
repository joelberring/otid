import { defineConfig } from "@playwright/test";

const database = process.env.TEST_DATABASE_URL;
if (!database || database !== process.env.DATABASE_URL) throw new Error("Explicit matching isolated database required");
const origin = "http://127.0.0.1:3129";

export default defineConfig({
  tsconfig: "tsconfig.public-result-detail-event-stream.json",
  testDir: ".",
  testMatch: "task-130-public-result-detail-event-stream.spec.ts",
  timeout: 70_000,
  workers: 1,
  use: { baseURL: origin, trace: "off", video: "off" },
  webServer: {
    command: "pnpm --filter @o-tid/web dev --hostname 127.0.0.1 --port 3129",
    cwd: "../..",
    url: origin,
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      ...process.env,
      DATABASE_URL: database,
      O_TID_PUBLIC_ORIGIN: origin,
      O_TID_DEMO_E2E: "1",
      O_TID_SIMULATOR_MODE: "loopback-development"
    }
  }
});
