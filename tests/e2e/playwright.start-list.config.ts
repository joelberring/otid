import { defineConfig } from "@playwright/test";
const origin = "http://127.0.0.1:3115";
// Real UI, synthetic intercepted API. Never connects to a test/private database.
export default defineConfig({
  tsconfig: "tsconfig.start-list.json", testDir: ".", testMatch: "task-015-start-list.spec.ts",
  workers: 1, timeout: 45_000,
  use: { baseURL: origin, trace: "off", video: "off", timezoneId: "America/New_York" },
  webServer: {
    command: "pnpm --filter @o-tid/web exec next dev --hostname 127.0.0.1 --port 3115",
    cwd: "../..", url: `${origin}/admin/10000000-0000-4000-8000-000000000001/start-list`,
    reuseExistingServer: false, timeout: 90_000,
    env: { O_TID_DEMO_E2E: "1", O_TID_LOCAL_DEMO: "0", O_TID_PUBLIC_ORIGIN: origin,
      DATABASE_URL: "", TEST_DATABASE_URL: "" }
  }
});
