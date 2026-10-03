import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "task-006w-shell.spec.ts", timeout: 30_000, workers: 1,
  use: { baseURL: "http://127.0.0.1:3103" },
  webServer: { command: "pnpm --filter @o-tid/web dev --port 3103", cwd: "../..",
    url: "http://127.0.0.1:3103/checkin/index.html", reuseExistingServer: false, timeout: 60_000 }
});
