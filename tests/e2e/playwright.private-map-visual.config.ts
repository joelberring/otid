import { defineConfig } from "@playwright/test";

const origin = "http://127.0.0.1:3131";

// Actual Next page with synthetic, browser-intercepted admin responses. No database or real credential.
export default defineConfig({
  tsconfig: "tsconfig.private-map-visual.json", testDir: ".",
  testMatch: ["task-242-private-map-visual.spec.ts", "task-243-neutral-class-admin.spec.ts"],
  workers: 1, timeout: 45_000,
  use: { baseURL: origin, browserName: "chromium", trace: "off", video: "off" },
  webServer: {
    command: "node apps/web/node_modules/next/dist/bin/next dev apps/web --hostname 127.0.0.1 --port 3131",
    cwd: "../..", url: `${origin}/admin/10000000-0000-4000-8000-000000000001/map`, reuseExistingServer: false, timeout: 90_000,
    env: { ...process.env, DATABASE_URL: "", TEST_DATABASE_URL: "", O_TID_DEMO_E2E: "1",
      O_TID_LOCAL_DEMO: "0", O_TID_PUBLIC_ORIGIN: origin }
  }
});
