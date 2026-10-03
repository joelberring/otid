import { defineConfig } from "@playwright/test";

// Real Next UI; browser intercepts synthetic participant API responses. No database or object store is involved.
const origin = "http://127.0.0.1:3127";
export default defineConfig({
  tsconfig: "tsconfig.route-upload.json", testDir: ".", testMatch: "task-111-route-upload.spec.ts", workers: 1, timeout: 45_000,
  use: { baseURL: origin, trace: "off", video: "off" },
  webServer: {
    command: "pnpm --filter @o-tid/web exec next dev --hostname 127.0.0.1 --port 3127", cwd: "../..", url: `${origin}/route-upload`,
    reuseExistingServer: false, timeout: 90_000,
    env: { O_TID_DEMO_E2E: "1", O_TID_LOCAL_DEMO: "0", O_TID_PUBLIC_ORIGIN: origin, DATABASE_URL: "", TEST_DATABASE_URL: "" }
  }
});
