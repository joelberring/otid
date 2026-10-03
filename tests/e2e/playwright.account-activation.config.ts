import { defineConfig } from "@playwright/test";

const origin = "http://127.0.0.1:3159";
export default defineConfig({
  tsconfig: "tsconfig.account-activation.json",
  testDir: ".", testMatch: "task-159-account-activation.spec.ts", workers: 1, timeout: 45_000,
  use: { baseURL: origin, trace: "off", video: "off" },
  webServer: {
    command: "node_modules/.bin/next dev --hostname 127.0.0.1 --port 3159",
    cwd: "../../apps/web", url: `${origin}/activate`, reuseExistingServer: false, timeout: 90_000,
    env: { ...process.env, O_TID_PUBLIC_ORIGIN: origin, DATABASE_URL: "", TEST_DATABASE_URL: "",
      O_TID_DEMO_E2E: "1", O_TID_LOCAL_DEMO: "0" }
  }
});
