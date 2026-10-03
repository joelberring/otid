import { defineConfig } from "@playwright/test";
import { chmodSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const sourceDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!sourceDatabaseUrl) throw new Error("Explicit TEST_DATABASE_URL required for TASK154 private route browser test");
const source = new URL(sourceDatabaseUrl);
const sourceName = source.pathname.slice(1);
if (!( ["postgres:", "postgresql:"].includes(source.protocol)
  && ["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)
  && /^otid_task150_synthetic_[a-z0-9][a-z0-9_-]{0,40}$/.test(sourceName)
  && !/(?:^|[_-])(demo|race|private)(?:[_-]|$)/i.test(sourceName))) {
  throw new Error("TASK154 only accepts an explicit local synthetic otid_task150_synthetic_* TEST_DATABASE_URL");
}

const runId = process.env.OTID_TASK154_RUN_ID ?? randomUUID().replaceAll("-", "");
if (!/^[a-f0-9]{32}$/.test(runId)) throw new Error("TASK154 fixture run id rejected");
process.env.OTID_TASK154_RUN_ID = runId;
const targetDatabaseName = `otid_task150_e2e_${runId}`;
const target = new URL(sourceDatabaseUrl);
target.pathname = `/${targetDatabaseName}`;
const tempRoot = realpathSync(tmpdir());
const privateDirectory = process.env.OTID_TASK154_PRIVATE_DIRECTORY
  ?? mkdtempSync(join(tempRoot, "otid-task154-private-route-e2e-"));
if (dirname(privateDirectory) !== tempRoot || !/^otid-task154-private-route-e2e-[A-Za-z0-9]+$/.test(basename(privateDirectory))) {
  throw new Error("TASK154 private fixture path rejected");
}
chmodSync(privateDirectory, 0o700);
const credentialsFile = join(privateDirectory, "accounts.json");
process.env.OTID_TASK154_DATABASE_URL = target.toString();
process.env.OTID_TASK154_SOURCE_DATABASE_URL = sourceDatabaseUrl;
process.env.OTID_TASK154_PRIVATE_DIRECTORY = privateDirectory;
process.env.OTID_TASK154_CREDENTIALS_FILE = credentialsFile;

const origin = "http://127.0.0.1:3154";
export default defineConfig({
  tsconfig: "tsconfig.task154-private-route.json",
  testDir: ".",
  testMatch: "task-154-private-route.spec.ts",
  timeout: 120_000,
  workers: 1,
  use: { baseURL: origin, trace: "off", video: "off" },
  webServer: {
    command: "node node_modules/tsx/dist/cli.mjs tests/e2e/task-150-organizer-server.ts",
    cwd: "../..",
    url: `${origin}/organizer`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      CI: "true",
      NODE_ENV: "test",
      DATABASE_URL: target.toString(),
      TEST_DATABASE_URL: target.toString(),
      TASK150_SOURCE_DATABASE_URL: sourceDatabaseUrl,
      TASK150_TARGET_DATABASE_NAME: targetDatabaseName,
      TASK150_CREDENTIALS_FILE: credentialsFile,
      TASK150_PRIVATE_DIRECTORY: privateDirectory,
      TASK150_PORT: "3154",
      TASK150_DIST_DIR: ".next-task154-private-route-test",
      O_TID_PUBLIC_ORIGIN: origin,
      O_TID_DEMO_E2E: "0"
    }
  }
});
