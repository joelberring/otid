import { randomUUID } from "node:crypto";
import { defineConfig } from "@playwright/test";

const sourceUrl = process.env.TEST_DATABASE_URL;
if (!sourceUrl) throw new Error("TASK159 behöver explicit isolerad TEST_DATABASE_URL");
const source = new URL(sourceUrl);
const sourceName = source.pathname.slice(1);
if (!["postgres:", "postgresql:"].includes(source.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(source.hostname) ||
  !/^otid_(?:task159|test)_[a-z0-9][a-z0-9_-]*$/.test(sourceName) ||
  /(?:^|[_-])(demo|race|private)(?:[_-]|$)/i.test(sourceName)) {
  throw new Error("TASK159 accepterar bara en explicit lokal syntetisk databas");
}
const runId = process.env.OTID_TASK159_E2E_RUN_ID ?? randomUUID().replaceAll("-", "");
if (!/^[a-f0-9]{32}$/.test(runId)) throw new Error("Ogiltigt test-ID");
process.env.OTID_TASK159_E2E_RUN_ID = runId;
const target = new URL(sourceUrl);
target.pathname = `/otid_task159_e2e_${runId}`;
process.env.OTID_TASK159_E2E_TARGET_URL = target.toString();
const origin = "http://127.0.0.1:3160";

export default defineConfig({
  tsconfig: "tsconfig.account-activation-real.json",
  testDir: ".", testMatch: "task-159-account-activation-real.spec.ts", workers: 1, timeout: 60_000,
  use: { baseURL: origin, trace: "off", video: "off" },
  webServer: {
    command: "node_modules/.bin/next dev --hostname 127.0.0.1 --port 3160",
    cwd: "../../apps/web", url: `${origin}/activate`, reuseExistingServer: false, timeout: 90_000,
    env: { ...process.env, O_TID_PUBLIC_ORIGIN: origin, DATABASE_URL: target.toString(),
      TEST_DATABASE_URL: target.toString(), O_TID_DEMO_E2E: "1", O_TID_LOCAL_DEMO: "0" }
  }
});
