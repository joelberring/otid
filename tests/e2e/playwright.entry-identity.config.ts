import { defineConfig } from "@playwright/test";

const database = process.env.TEST_DATABASE_URL;
if (!database || database !== process.env.DATABASE_URL) {
  throw new Error("Namn-/klubbprov kräver samma isolerade DATABASE_URL/TEST_DATABASE_URL");
}
export default defineConfig({
  tsconfig: "tsconfig.entry-identity.json", testDir: ".", testMatch: "task-026-entry-identity.spec.ts",
  timeout: 60_000, workers: 1,
  use: { baseURL: "http://127.0.0.1:3121", trace: "off", video: "off" },
  webServer: {
    command: "pnpm --filter @o-tid/web dev --port 3121", cwd: "../..",
    url: "http://127.0.0.1:3121", reuseExistingServer: false, timeout: 90_000,
    env: { ...process.env, DATABASE_URL: database, O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3121", O_TID_DEMO_E2E: "1" }
  }
});
