import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { pmObjectManifestSchema } from "@o-tid/contracts";
import { createDatabase, type Database } from "@o-tid/database";
import {
  captureOperationalBackup,
  prepareOperationalBackupSourcePreflight,
  readOperationalBackupPmObjects,
  verifyOperationalRestore,
} from "@o-tid/application";
import {
  createOperationalBackupOperationStateRecorder,
  createOperationalBackupPmVerifier,
  createOperationalBackupPostgresDumpPort,
  createPmObjectStore,
  measureOperationalBackupPostgresDump,
  openCompletedPinnedOperationalBackupTarget,
  OperationalBackupPinnedTargetError,
  provisionPinnedOperationalBackupTarget,
  readOperationalBackupCompletionRecord,
  readOperationalBackupOperationState,
  readOperationalBackupPmObject,
  readOperationalBackupTargetBinding,
  replicateOperationalBackupStore,
  verifyOperationalBackupCompletion,
  verifyOperationalBackupDumpFile,
  writeOperationalBackupCompletionRecord,
  type OperationalBackupPostgresConnection,
} from "../src";

// Invoked only by the isolated TASK179 parent. It does not accept a default
// database, target, key, manifest, or dump path from an existing installation.
const confirmation = "synthetic-durable-restore-handoff";
const phase = process.argv[2];
let currentStage = "CONFIGURATION";
if (process.env.OTID_TASK179_CHILD_CONFIRM !== confirmation ||
    (phase !== "capture" && phase !== "restore")) throw new Error("TASK179_CHILD_CONFIGURATION_INVALID");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error("TASK179_CHILD_CONFIGURATION_INVALID");
  return value;
}

function absolute(name: string): string {
  const value = required(name);
  if (resolve(value) !== value) throw new Error("TASK179_CHILD_CONFIGURATION_INVALID");
  return value;
}

function databaseUrl(name: string, role: "source" | "target"): {
  url: string; databaseName: string; connection: OperationalBackupPostgresConnection; toolEnvironment: NodeJS.ProcessEnv;
} {
  const value = required(name);
  const parsed = new URL(value);
  const databaseName = parsed.pathname.slice(1);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" ||
      !/^[0-9]+$/.test(parsed.port) || !parsed.username || parsed.search || parsed.hash ||
      !new RegExp(`^otid_task170_${role}_[a-z0-9][a-z0-9_]{0,31}$`).test(databaseName) ||
      parsed.pathname !== `/${databaseName}`) throw new Error("TASK179_CHILD_DATABASE_INVALID");
  const port = Number(parsed.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("TASK179_CHILD_DATABASE_INVALID");
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  return {
    url: value, databaseName,
    connection: { host: "127.0.0.1", port, user, password, database: databaseName, sslMode: "disable" },
    toolEnvironment: { PATH: process.env.PATH ?? "", LANG: "C", PGHOST: "127.0.0.1", PGPORT: String(port),
      PGUSER: user, PGDATABASE: databaseName, PGSSLMODE: "disable", ...(password ? { PGPASSWORD: password } : {}) },
  };
}

async function databaseMajor(db: Database): Promise<number> {
  const rows = await db.execute(sql`SHOW server_version_num`);
  const version = Number((rows.rows[0] as { server_version_num?: unknown } | undefined)?.server_version_num);
  if (!Number.isSafeInteger(version) || Math.floor(version / 10_000) !== 17) throw new Error("TASK179_POSTGRES_VERSION_INVALID");
  return 17;
}

async function assertDatabaseEmpty(db: Database): Promise<void> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
        AND c.relkind IN ('r','p','v','m','S','f')
    ) AS "hasUserRelations",
    EXISTS (SELECT 1 FROM pg_extension WHERE extname <> 'plpgsql') AS "hasNonDefaultExtensions"
  `);
  const row = result.rows[0];
  if (!row || row.hasUserRelations !== false || row.hasNonDefaultExtensions !== false) {
    throw new Error("TASK179_DATABASE_NOT_EMPTY");
  }
}

function runPostgresTool(executable: string, args: string[], environment: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const child = spawn(executable, args, { env: environment, stdio: ["ignore", "ignore", "ignore"] });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolvePromise();
    };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(new Error("TASK179_POSTGRES_TOOL_FAILED")); }, 120_000);
    child.once("error", () => finish(new Error("TASK179_POSTGRES_TOOL_FAILED")));
    child.once("close", code => code === 0 ? finish() : finish(new Error("TASK179_POSTGRES_TOOL_FAILED")));
  });
}

async function readBoundCredentials(privateRoot: string, backupId: string,
  binding: Awaited<ReturnType<typeof readOperationalBackupTargetBinding>>): Promise<{accessKey: string; secretKey: string}> {
  const path = join(privateRoot, `${backupId}.credentials.json`);
  if (binding.credentialRef !== `file:${path}`) throw new Error("TASK179_TARGET_CREDENTIAL_INVALID");
  const named = await lstat(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.uid !== process.getuid?.() ||
        (opened.mode & 0o777) !== 0o600 || opened.dev !== named.dev || opened.ino !== named.ino ||
        opened.dev !== binding.credentialFileIdentity.dev || opened.ino !== binding.credentialFileIdentity.ino ||
        opened.size > 4096) throw new Error("TASK179_TARGET_CREDENTIAL_INVALID");
    const bytes = await handle.readFile();
    if (createHash("sha256").update(bytes).digest("hex") !== binding.credentialFileSha256) {
      throw new Error("TASK179_TARGET_CREDENTIAL_INVALID");
    }
    const value = JSON.parse(bytes.toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("TASK179_TARGET_CREDENTIAL_INVALID");
    const data = value as Record<string, unknown>;
    if (Object.keys(data).sort().join(",") !== "accessKey,secretKey" ||
        typeof data.accessKey !== "string" || typeof data.secretKey !== "string") {
      throw new Error("TASK179_TARGET_CREDENTIAL_INVALID");
    }
    return { accessKey: data.accessKey, secretKey: data.secretKey };
  } finally { await handle.close(); }
}

async function capture(): Promise<void> {
  const database = databaseUrl("TASK179_SOURCE_DATABASE_URL", "source");
  const backupId = required("TASK179_BACKUP_ID");
  const repositoryRoot = absolute("TASK179_REPOSITORY_ROOT");
  const operationStateDirectory = absolute("TASK179_OPERATION_DIRECTORY");
  const targetBindingDirectory = absolute("TASK179_TARGET_ROOT");
  const recordDirectory = absolute("TASK179_RECORD_DIRECTORY");
  const minioBinary = absolute("TASK179_MINIO_BINARY");
  const mcBinary = absolute("TASK179_MC_BINARY");
  const pgDumpPath = join(absolute("TASK179_PG_BIN_DIR"), "pg_dump");
  const sourceEndpoint = required("TASK179_SOURCE_ENDPOINT");
  const bucket = required("TASK179_SOURCE_BUCKET");
  const sourceCredentials = { accessKey: required("TASK179_SOURCE_ACCESS_KEY"),
    secretKey: required("TASK179_SOURCE_SECRET_KEY") };
  const firstPm = pmObjectManifestSchema.parse(JSON.parse(required("TASK179_FIRST_PM_JSON")));
  const sourceStore = createPmObjectStore({ storeId: firstPm.storeId, endpoint: sourceEndpoint, bucket,
    region: "us-east-1", ...sourceCredentials, mode: "loopback-development", deadlineMs: 5_000 });
  const store = { storeId: firstPm.storeId, sourceEndpoint, sourceBucket: bucket, targetBucket: bucket };
  const sourceDatabase = createDatabase(database.url);
  let provisioned: Awaited<ReturnType<typeof provisionPinnedOperationalBackupTarget>> | undefined;
  try {
    currentStage = "SOURCE_DATABASE";
    await databaseMajor(sourceDatabase.db);
    currentStage = "DUMP_PORT";
    const recorder = createOperationalBackupOperationStateRecorder({ directory: operationStateDirectory, repositoryRoot });
    const dumpPort = await createOperationalBackupPostgresDumpPort({ repositoryRoot, directory: operationStateDirectory,
      backupId, pgDumpPath, connection: database.connection, readServerMajor: () => databaseMajor(sourceDatabase.db) });
    let sourceCapture: unknown;
    let targetPmReader: ReturnType<typeof createPmObjectStore> | undefined;
    let targetCredentials: {accessKey: string; secretKey: string} | undefined;
    currentStage = "CAPTURE";
    const captureReceipt = await captureOperationalBackup({
      backupId, createdAt: "2026-09-20T10:00:00.000Z", writeStopConfirmed: true,
    }, { prepare: intent => { currentStage = "SOURCE_PREFLIGHT"; return prepareOperationalBackupSourcePreflight(sourceDatabase.db, intent,
      createOperationalBackupPmVerifier(sourceStore)); } }, {
      createPostgresDump: () => { currentStage = "DUMP"; return dumpPort.createPostgresDump(); },
      recordOperationState: state => recorder.record(state),
      async prepareEmptyTarget(evidence) {
        currentStage = "TARGET_PREPARATION";
        sourceCapture = evidence;
        const sourcePm = await readOperationalBackupPmObjects(sourceDatabase.db);
        if (sourcePm.length !== 1 || sourcePm[0]?.storeId !== firstPm.storeId ||
            sourcePm[0]?.versionId !== firstPm.versionId) throw new Error("TASK179_SOURCE_PM_INVALID");
        provisioned = await provisionPinnedOperationalBackupTarget({ backupId, sourceCapture: evidence,
          operationStateDirectory, stores: [store], privateRoot: targetBindingDirectory,
          repositoryRoot, minioBinary });
        const binding = await readOperationalBackupTargetBinding({ directory: targetBindingDirectory,
          repositoryRoot, backupId });
        targetCredentials = await readBoundCredentials(targetBindingDirectory, backupId, binding);
        targetPmReader = createPmObjectStore({ storeId: firstPm.storeId, endpoint: binding.targetEndpoint,
          bucket, region: "us-east-1", ...targetCredentials, mode: "loopback-development", deadlineMs: 5_000 });
      },
      async replicateAndCleanup(evidence) {
        currentStage = "REPLICATION";
        if (!provisioned || !targetPmReader || !targetCredentials) throw new Error("TASK179_TARGET_NOT_READY");
        const operationState = await readOperationalBackupOperationState({ directory: operationStateDirectory,
          repositoryRoot, backupId });
        const binding = await readOperationalBackupTargetBinding({ directory: targetBindingDirectory,
          repositoryRoot, backupId });
        await replicateOperationalBackupStore({ backupId, sourceCapture: evidence, operationState,
          readinessEvidence: provisioned.readiness, targetBinding: binding, store, sourceCredentials,
          target: { endpoint: binding.targetEndpoint, region: "us-east-1", mode: "loopback-development",
            ...targetCredentials }, targetPmReader, mcBinary,
          recordOperationState: state => recorder.record(state), timeoutMs: 60_000, pollIntervalMs: 250 });
      },
      async verifyCompletion(evidence) {
        currentStage = "FINAL_PROOF";
        if (!targetPmReader) throw new Error("TASK179_TARGET_NOT_READY");
        return verifyOperationalBackupCompletion({ sourceCapture: evidence, operationStateDirectory,
          repositoryRoot, targetBindingDirectory, store, sourceCredentials, targetPmReader,
          dumpPath: dumpPort.dumpPath });
      },
    });
    currentStage = "RECORD";
    if (!sourceCapture || !targetPmReader) throw new Error("TASK179_CAPTURE_EVIDENCE_MISSING");
    await writeOperationalBackupCompletionRecord({ sourceCapture, captureReceipt, operationStateDirectory,
      repositoryRoot, targetBindingDirectory, dumpPath: dumpPort.dumpPath, store, sourceCredentials,
      targetPmReader, recordDirectory });
  } finally {
    if (provisioned) await provisioned.stop();
    await sourceDatabase.pool.end();
  }
}

async function restore(): Promise<void> {
  const database = databaseUrl("TASK179_TARGET_DATABASE_URL", "target");
  const backupId = required("TASK179_BACKUP_ID");
  const repositoryRoot = absolute("TASK179_REPOSITORY_ROOT");
  const operationStateDirectory = absolute("TASK179_OPERATION_DIRECTORY");
  const targetBindingDirectory = absolute("TASK179_TARGET_ROOT");
  const recordDirectory = absolute("TASK179_RECORD_DIRECTORY");
  const minioBinary = absolute("TASK179_MINIO_BINARY");
  const pgRestorePath = join(absolute("TASK179_PG_BIN_DIR"), "pg_restore");
  const expectedEventId = required("TASK179_EXPECTED_EVENT_ID");
  const expectedEntryId = required("TASK179_EXPECTED_ENTRY_ID");
  const targetDatabase = createDatabase(database.url);
  let target: Awaited<ReturnType<typeof openCompletedPinnedOperationalBackupTarget>> | undefined;
  try {
    currentStage = "TARGET_DATABASE";
    await databaseMajor(targetDatabase.db);
    await assertDatabaseEmpty(targetDatabase.db);
    currentStage = "RECORD_READ";
    const completion = await readOperationalBackupCompletionRecord({ backupId, recordDirectory, repositoryRoot,
      operationStateDirectory, targetBindingDirectory, dumpDirectory: operationStateDirectory });
    currentStage = "TARGET_OPEN";
    try {
      target = await openCompletedPinnedOperationalBackupTarget({ backupId, completion,
        operationStateDirectory, privateRoot: targetBindingDirectory, repositoryRoot, minioBinary });
    } catch (error) {
      if (error instanceof OperationalBackupPinnedTargetError) {
        throw new Error(`TASK179_TARGET_OPEN_${error.stage}`);
      }
      throw error;
    }
    for (const object of completion.manifest.pmObjects) await readOperationalBackupPmObject(target.targetPmReader, object);
    const dumpPath = join(operationStateDirectory, completion.manifest.postgresDump.identity);
    await verifyOperationalBackupDumpFile(dumpPath, repositoryRoot, completion.manifest.postgresDump);
    currentStage = "RESTORE";
    await runPostgresTool(pgRestorePath, ["--list", dumpPath], database.toolEnvironment);
    await assertDatabaseEmpty(targetDatabase.db);
    await runPostgresTool(pgRestorePath, ["--exit-on-error", "--single-transaction", "--no-owner", "--no-acl",
      "--dbname", database.databaseName, dumpPath], database.toolEnvironment);
    await verifyOperationalBackupDumpFile(dumpPath, repositoryRoot, completion.manifest.postgresDump);
    const measured = await measureOperationalBackupPostgresDump({ identity: completion.manifest.postgresDump.identity,
      chunks: createReadStream(dumpPath), expected: { sha256: completion.manifest.postgresDump.sha256,
        byteLength: completion.manifest.postgresDump.byteLength } });
    currentStage = "RESTORE_PROOF";
    const receipt = await verifyOperationalRestore(targetDatabase.db, completion.manifest,
      { async measure() { return measured; } }, createOperationalBackupPmVerifier(target.targetPmReader));
    const restored = await readOperationalBackupPmObjects(targetDatabase.db);
    const pm = completion.manifest.pmObjects[0];
    if (receipt.manifestSha256 !== completion.manifestSha256 ||
        receipt.verifiedPmObjectCount !== completion.verifiedPmObjectCount ||
        receipt.databaseEvidence.history.events !== 1 || receipt.databaseEvidence.history.entries !== 1 ||
        receipt.databaseEvidence.history.resultFinalizations !== 1 ||
        restored.length !== 1 || !pm || restored[0]?.storeId !== pm.storeId ||
        restored[0]?.key !== pm.key || restored[0]?.versionId !== pm.versionId ||
        restored[0]?.sha256 !== pm.sha256 || restored[0]?.byteLength !== pm.byteLength) {
      throw new Error("TASK179_RESTORE_EVIDENCE_INVALID");
    }
    const events = await targetDatabase.db.execute(sql`SELECT id FROM event WHERE id = ${expectedEventId}`);
    const entries = await targetDatabase.db.execute(sql`SELECT id FROM entry WHERE id = ${expectedEntryId}`);
    if (events.rows.length !== 1 || entries.rows.length !== 1) throw new Error("TASK179_RESTORED_IDS_INVALID");
  } finally {
    if (target) await target.stop();
    await targetDatabase.pool.end();
  }
}

try {
  if (phase === "capture") await capture();
  else await restore();
} catch (error) {
  // The parent reports only a phase code. Private paths, credentials and PM
  // keys remain out of stdout/stderr even on failure.
  const safe = error instanceof Error && /^TASK179_TARGET_OPEN_[A-Z0-9_]+$/.test(error.message)
    ? error.message : `TASK179_${phase.toUpperCase()}_${currentStage}_FAILED`;
  process.stderr.write(`${safe}\n`);
  process.exitCode = 1;
}
