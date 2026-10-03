import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".", testMatch: "task-006w-vault.spec.ts", timeout: 30_000, workers: 1,
  use: { baseURL: "http://127.0.0.1:3102" },
  webServer: { command: "node tests/e2e/fixtures/checkin-vault-server.mjs", cwd: "../..",
    url: "http://127.0.0.1:3102", reuseExistingServer: false, timeout: 15_000 }
});
