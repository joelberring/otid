import { defineConfig } from "@playwright/test";

// Real Next UI; browser intercepts synthetic API responses. No database involved.
const origin = "http://127.0.0.1:3114";
export default defineConfig({
  tsconfig: "tsconfig.workspace.json",
  testDir: ".", testMatch: ["task-014-workspace.spec.ts", "task-223-organizer-visual.spec.ts", "task-271-organizer-events-visual.spec.ts", "task-272-organizer-entry-states-visual.spec.ts", "task-273-organizer-create-visual.spec.ts", "task-274-coadmin-visual.spec.ts", "task-275-invitation-visual.spec.ts", "task-276-invitation-grant-review.spec.ts"], workers: 1, timeout: 45_000,
  use: { baseURL: origin, trace: "off", video: "off" },
  webServer: {
    command: "pnpm --filter @o-tid/web exec next dev --hostname 127.0.0.1 --port 3114",
    cwd: "../..", url: `${origin}/admin/10000000-0000-4000-8000-000000000001`,
    reuseExistingServer: false, timeout: 90_000,
    env: { O_TID_DEMO_E2E: "1", O_TID_LOCAL_DEMO: "0", O_TID_PUBLIC_ORIGIN: origin,
      DATABASE_URL: "", TEST_DATABASE_URL: "" }
  }
});
