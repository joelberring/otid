import { defineConfig } from "@playwright/test";
import { validateDemoTarget } from "../../packages/application/src/demo-target-policy";

const databaseUrl = process.env.TEST_DATABASE_URL ?? "";
validateDemoTarget({ databaseUrl, environment: "test", confirmation: process.env.OTID_DEMO_TEST_CONFIRM ?? "" });
if (databaseUrl !== process.env.DATABASE_URL) throw new Error("Matching isolated demo databases required");
export default defineConfig({
  tsconfig: "tsconfig.demo.json",
  testDir: ".", testMatch: "task-007-demo.spec.ts", timeout: 60_000, workers: 1,
  use: { baseURL: "http://127.0.0.1:3107" },
  webServer: { command: "pnpm --filter @o-tid/web dev --port 3107", cwd: "../..",
    url: "http://127.0.0.1:3107/checkin/index.html", reuseExistingServer: false, timeout: 60_000,
    env: { ...process.env, DATABASE_URL: databaseUrl, O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3107",
      O_TID_SIMULATOR_MODE: "loopback-development", O_TID_DEMO_E2E: "1" } }
});
