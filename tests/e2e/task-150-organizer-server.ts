import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, join, basename } from "node:path";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { provisionUserAccount } from "@o-tid/application";
import { createDatabase } from "@o-tid/database";
import { migrate } from "@o-tid/database";
import webNextConfig from "../../apps/web/next.config";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const targetUrl = process.env.DATABASE_URL;
const sourceUrl = process.env.TASK150_SOURCE_DATABASE_URL;
const targetName = process.env.TASK150_TARGET_DATABASE_NAME;
const privateDirectory = process.env.TASK150_PRIVATE_DIRECTORY;
const credentialsFile = process.env.TASK150_CREDENTIALS_FILE;
const runId = targetName?.split("_").at(-1);
const task155Fixture = targetName?.startsWith("otid_task155_browser_") ?? false;
const task160Fixture = targetName?.startsWith("otid_task150_e2e_") && process.env.TASK150_PORT === "3156";
if (!targetUrl || targetUrl !== process.env.TEST_DATABASE_URL || !sourceUrl || !targetName
  || !/^(?:otid_task150_e2e|otid_task155_browser)_[a-f0-9]{32}$/.test(targetName) || !runId
  || !privateDirectory || !credentialsFile || !credentialsFile.startsWith(`${privateDirectory}/`)) {
  throw new Error("TASK150 browser fixture configuration rejected");
}
const target = new URL(targetUrl);
const source = new URL(sourceUrl);
const sourceName = source.pathname.slice(1);
const tempRoot = realpathSync(tmpdir());
if (target.pathname !== `/${targetName}` || !["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)
  || !(/^(?:otid_task150_(synthetic|spec|e2e)_[a-z0-9][a-z0-9_-]{0,40}|otid_task160_test)$/.test(sourceName))
  || /(?:^|[_-])(demo|race|private)(?:[_-]|$)/i.test(sourceName)
  || dirname(privateDirectory) !== tempRoot
  || !/^otid-task(?:150-organizer|152-claim|153-follows|154-private-route|155-private-route|160-organizer)-e2e-[A-Za-z0-9]+$/.test(basename(privateDirectory))
  || credentialsFile !== join(privateDirectory, "accounts.json")) {
  throw new Error("TASK150 browser database target rejected");
}
const databaseUrl = targetUrl;
const adminDatabaseUrl = sourceUrl;
const privateDir = privateDirectory;
const credentialsPath = credentialsFile;
const fixtureRunId = runId;
const portValue = process.env.TASK150_PORT ?? "3150";
const distDir = process.env.TASK150_DIST_DIR ?? ".next-organizer-test";
if (!(portValue === "3150" || portValue === "3151" || portValue === "3152" || portValue === "3154" || portValue === "3155" || portValue === "3156") || !/^\.next-[a-z0-9-]{1,48}$/.test(distDir)) {
  throw new Error("TASK150 server isolation configuration rejected");
}
const port = Number(portValue);

let databaseCreated = false;
let server: Server | undefined;
type NextApp = {
  close(): Promise<void>;
  getRequestHandler(): (request: IncomingMessage, response: ServerResponse) => Promise<void>;
  getUpgradeHandler(): (request: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>;
  prepare(): Promise<void>;
};
let nextApp: NextApp | undefined;
let stopping: Promise<void> | undefined;
let setupStage = "configuration";

function provisionAccount(loginName: string, displayName: string, outputPath: string): Record<string, unknown> {
  const cliPath = join(root, "node_modules/tsx/dist/cli.mjs");
  const result = spawnSync(process.execPath, [cliPath, join(root, "scripts/organizer-account-access.ts"),
    "provision", "--confirm", "synthetic-test-database", "--private-output", outputPath], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "test", DATABASE_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl },
    input: JSON.stringify({ loginName, displayName }),
    encoding: "utf8",
    maxBuffer: 16_384
  });
  if (result.error || result.status !== 0) throw new Error("Synthetic organizer fixture provisioning failed");
  return JSON.parse(readFileSync(outputPath, "utf8")) as Record<string, unknown>;
}

async function prepareDatabaseAndAccounts(): Promise<void> {
  setupStage = "create-synthetic-database";
  const { pool: adminPool } = createDatabase(adminDatabaseUrl);
  try {
    await adminPool.query(`CREATE DATABASE "${targetName}"`);
    databaseCreated = true;
  } finally {
    await adminPool.end();
  }

  setupStage = "migrate-synthetic-database";
  const { db, pool } = createDatabase(databaseUrl);
  try {
    await migrate(db, { migrationsFolder: resolve(root, "packages/database/migrations") });
  } finally {
    await pool.end();
  }

  setupStage = "prepare-private-fixture-directory";
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  await chmod(privateDir, 0o700);
  const ownerName = `task150.owner.${fixtureRunId}`;
  const otherName = `task150.other.${fixtureRunId}`;
  const ownerFile = join(privateDir, "owner.json");
  const otherFile = join(privateDir, "other.json");
  let owner: Record<string, unknown>, other: Record<string, unknown>;
  if (task155Fixture || task160Fixture) {
    setupStage = task160Fixture ? "provision-task160-synthetic-accounts" : "provision-task155-synthetic-accounts";
    const { db, pool } = createDatabase(databaseUrl);
    try {
      const ownerAccount = await provisionUserAccount(db, { loginName: ownerName, displayName: "Syntetisk arrangör" });
      const otherAccount = await provisionUserAccount(db, { loginName: otherName, displayName: "Annan syntetisk arrangör" });
      owner = { accountId: ownerAccount.accountId, loginName: ownerAccount.loginName, password: ownerAccount.initialPassword };
      other = { accountId: otherAccount.accountId, loginName: otherAccount.loginName, password: otherAccount.initialPassword };
      await writeFile(ownerFile, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
      await writeFile(otherFile, JSON.stringify(other), { flag: "wx", mode: 0o600 });
    } finally { await pool.end(); }
  } else {
    setupStage = "provision-synthetic-owner";
    owner = provisionAccount(ownerName, "Syntetisk arrangör", ownerFile);
    setupStage = "provision-synthetic-other";
    other = provisionAccount(otherName, "Annan syntetisk arrangör", otherFile);
  }
  setupStage = "write-private-fixture";
  const fixture = { owner, other };
  await writeFile(credentialsPath, JSON.stringify(fixture), { flag: "wx", mode: 0o600 });
  await chmod(credentialsPath, 0o600);
}

async function cleanup(dropDatabase = true): Promise<void> {
  if (stopping) return stopping;
  stopping = (async () => {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolveClose) => server!.close(() => resolveClose()));
    }
    await nextApp?.close();
    if (databaseCreated && dropDatabase) {
      const { pool: adminPool } = createDatabase(adminDatabaseUrl);
      try {
        await adminPool.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [targetName]);
        await adminPool.query(`DROP DATABASE IF EXISTS "${targetName}" WITH (FORCE)`);
      } finally { await adminPool.end(); }
    }
    await rm(privateDir, { recursive: true, force: true });
  })();
  return stopping;
}

async function start(): Promise<void> {
  await prepareDatabaseAndAccounts();
  setupStage = "prepare-next";
  const webDirectory = resolve(root, "apps/web");
  const requireFromWeb = createRequire(join(webDirectory, "package.json"));
  const loadedNext: unknown = requireFromWeb("next");
  if (typeof loadedNext !== "function") throw new Error("Next server entrypoint unavailable");
  const createNextServer = loadedNext as (options: Record<string, unknown>) => NextApp;
  nextApp = createNextServer({
    dev: true,
    dir: webDirectory,
    hostname: "127.0.0.1",
    port,
    conf: { ...webNextConfig, distDir }
  });
  await nextApp.prepare();
  const requestHandler = nextApp.getRequestHandler();
  server = createServer((request, response) => {
    if (request.method === "POST" && request.url === `/__task150/shutdown/${fixtureRunId}`) {
      response.once("finish", () => {
        void cleanup(false).then(() => process.exit(0)).catch(() => process.exit(1));
      });
      response.writeHead(204);
      response.end();
      return;
    }
    void requestHandler(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  const upgradeHandler = nextApp.getUpgradeHandler();
  server.on("upgrade", (request, socket, head) => { void upgradeHandler(request, socket, head); });
  setupStage = "listen-loopback";
  await new Promise<void>((resolveListen, reject) => {
    server!.once("error", reject);
  server!.listen(port, "127.0.0.1", () => resolveListen());
  });
  process.stdout.write(`TASK150 synthetic organizer browser server ready on 127.0.0.1:${port}; fixture=${existsSync(credentialsPath) ? "present" : "missing"}\n`);
}

process.once("SIGINT", () => {
  process.stderr.write("TASK150 organizer fixture received SIGINT\n");
  void cleanup().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  process.stderr.write("TASK150 organizer fixture received SIGTERM\n");
  void cleanup().finally(() => process.exit(0));
});
process.once("uncaughtException", (error) => {
  process.stderr.write(`TASK150 organizer fixture failed at ${setupStage}: ${error.name}\n`);
  void cleanup().finally(() => process.exit(1));
});

start().catch((error: unknown) => {
  process.stderr.write(`TASK150 organizer fixture failed at ${setupStage}: ${error instanceof Error ? error.name : "unknown"}\n`);
  void cleanup().finally(() => process.exit(1));
});
