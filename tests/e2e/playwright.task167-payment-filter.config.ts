import { defineConfig } from "@playwright/test";

// Real Next UI with synthetic intercepted API responses; no PostgreSQL.
const origin = "http://127.0.0.1:3167";
export default defineConfig({
  tsconfig: "tsconfig.task167-payment-filter.json",
  testDir: ".", testMatch: ["task-167-payment-filter.spec.ts", "task-225-after-actions.spec.ts",
    "task-227-class-finder.spec.ts", "task-246-import-profile.spec.ts"], workers: 1, timeout: 45_000,
  use: { baseURL: origin, trace: "off", video: "off" },
  webServer: {
    command: "node apps/web/node_modules/next/dist/bin/next dev apps/web --hostname 127.0.0.1 --port 3167",
    cwd: "../..", url: `${origin}/admin/10000000-0000-4000-8000-000000000001/manage`,
    reuseExistingServer: false, timeout: 90_000,
    env: { ...process.env, O_TID_DEMO_E2E: "1", O_TID_LOCAL_DEMO: "0", O_TID_PUBLIC_ORIGIN: origin,
      DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/no-database" },
  },
});
