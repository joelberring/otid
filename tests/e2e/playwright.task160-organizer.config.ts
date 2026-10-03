import { defineConfig } from "@playwright/test";
import { chmodSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const sourceDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!sourceDatabaseUrl) throw new Error("TASK160 behöver explicit TEST_DATABASE_URL");
const source = new URL(sourceDatabaseUrl);
if (!(["postgres:", "postgresql:"].includes(source.protocol)
  && ["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)
  && source.pathname === "/otid_task160_test")) {
  throw new Error("TASK160 kräver den uttryckligt isolerade lokala otid_task160_test-databasen");
}

const runId = process.env.OTID_TASK160_RUN_ID ?? randomUUID().replaceAll("-", "");
if (!/^[a-f0-9]{32}$/.test(runId)) throw new Error("TASK160 fixture-ID ogiltigt");
process.env.OTID_TASK160_RUN_ID = runId;
const target = new URL(sourceDatabaseUrl);
target.pathname = `/otid_task150_e2e_${runId}`;
const tempRoot = realpathSync(tmpdir());
const privateDirectory = process.env.OTID_TASK160_PRIVATE_DIRECTORY
  ?? mkdtempSync(join(tempRoot, "otid-task160-organizer-e2e-"));
if (dirname(privateDirectory) !== tempRoot
  || !/^otid-task160-organizer-e2e-[A-Za-z0-9]+$/.test(basename(privateDirectory))) {
  throw new Error("TASK160 privat fixture-katalog ogiltig");
}
chmodSync(privateDirectory, 0o700);
const credentialsFile = join(privateDirectory, "accounts.json");
const origin = "http://127.0.0.1:3156";
process.env.OTID_TASK160_TARGET_URL = target.toString();
process.env.OTID_TASK160_PRIVATE_DIRECTORY = privateDirectory;
process.env.OTID_TASK160_RUN_ID = runId;
process.env.TASK150_SOURCE_DATABASE_URL = sourceDatabaseUrl;
process.env.TASK150_TARGET_DATABASE_NAME = target.pathname.slice(1);
process.env.TASK150_PRIVATE_DIRECTORY = privateDirectory;
process.env.TASK150_CREDENTIALS_FILE = credentialsFile;

export default defineConfig({
  tsconfig: "tsconfig.task160-organizer.json",
  testDir: ".", testMatch: "task-160-owner-account-invitation.spec.ts", workers: 1, timeout: 90_000,
  use: { baseURL: origin, trace: "off", video: "off" },
  webServer: {
    command: "node --import tsx tests/e2e/task-150-organizer-server.ts",
    cwd: "../..", url: `${origin}/organizer`, reuseExistingServer: false, timeout: 180_000,
    env: {
      ...process.env,
      CI: "true", NODE_ENV: "test",
      DATABASE_URL: target.toString(), TEST_DATABASE_URL: target.toString(),
      TASK150_SOURCE_DATABASE_URL: sourceDatabaseUrl,
      TASK150_TARGET_DATABASE_NAME: target.pathname.slice(1),
      TASK150_PRIVATE_DIRECTORY: privateDirectory,
      TASK150_CREDENTIALS_FILE: credentialsFile,
      TASK150_PORT: "3156", TASK150_DIST_DIR: ".next-task160-organizer-test",
      O_TID_PUBLIC_ORIGIN: origin, O_TID_DEMO_E2E: "0"
    }
  }
});
