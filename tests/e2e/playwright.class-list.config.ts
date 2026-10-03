import { defineConfig } from "@playwright/test";

const database = process.env.TEST_DATABASE_URL;
if (!database || database !== process.env.DATABASE_URL) {
  throw new Error("Klasslisteprov kräver samma isolerade DATABASE_URL/TEST_DATABASE_URL");
}

export default defineConfig({
  tsconfig: "tsconfig.class-list.json",
  testDir: ".",
  testMatch: "task-001.spec.ts",
  grep: /klassadmin återupptar okänd commit utan dubbel ändring eller resultatomräkning/,
  timeout: 60_000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3109", trace: "off", video: "off" },
  webServer: {
    command: "pnpm --filter @o-tid/web dev --port 3109",
    cwd: "../..",
    url: "http://127.0.0.1:3109",
    reuseExistingServer: false,
    timeout: 90_000,
    env: { ...process.env, DATABASE_URL: database,
      O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3109", O_TID_DEMO_E2E: "1" }
  }
});
