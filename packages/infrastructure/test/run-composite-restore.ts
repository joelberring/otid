import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { constants } from "node:fs";
import { chmod, lstat, mkdtemp, open, readFile, realpath, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { Client } from "minio";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase, schema, type Database } from "@o-tid/database";
import {
  OperationalRestoreVerificationError,
  captureOperationalBackup,
  captureOperationalBackupSource,
  prepareOperationalBackupSourcePreflight,
  readOperationalBackupPmObjects,
  verifyOperationalRestore,
} from "@o-tid/application";
import {
  createOperationalBackupPmVerifier,
  createOperationalBackupOperationStateRecorder,
  createOperationalBackupPostgresDumpPort,
  measureOperationalBackupPostgresDump,
  readOperationalBackupOperationState,
  verifyOperationalBackupTargetReadiness,
  verifyOperationalBackupCompletion,
  provisionPinnedOperationalBackupTarget,
  readOperationalBackupTargetBinding,
  replicateOperationalBackupStore,
  readOperationalBackupPmObject,
  createPmObjectStore,
  type OperationalBackupPostgresConnection,
} from "../src";
import { withPinnedMinioReplication, withPinnedMinioSource } from "./pinned-minio-replication-fixture";

// One opt-in synthetic compatibility proof, not a production backup command.
// No default DATABASE_URL, existing MinIO endpoint, credential or race is read.
const confirmation = "synthetic-empty-databases";
const task174Confirmation = "synthetic-source-target-composition";
const task176Confirmation = "synthetic-source-replication-composition";
const task177Confirmation = "synthetic-managed-backup-receipt";
const task178Confirmation = "synthetic-receipted-backup-restore";
const task179Confirmation = "synthetic-durable-restore-handoff";
const task174Composition = process.env.OTID_TASK174_CONFIRM === task174Confirmation;
const task176Composition = process.env.OTID_TASK176_CONFIRM === task176Confirmation;
const task177Composition = process.env.OTID_TASK177_CONFIRM === task177Confirmation;
const task178Composition = process.env.OTID_TASK178_CONFIRM === task178Confirmation;
const task179Composition = process.env.OTID_TASK179_CONFIRM === task179Confirmation;
const sourceUrl = process.env.TASK170_SOURCE_DATABASE_URL;
const targetUrl = process.env.TASK170_TARGET_DATABASE_URL;
const pgBinDirectory = process.env.TASK170_PG_BIN_DIR;
const [minioBinary, mcBinary] = process.argv.slice(2);
if ((!task174Composition && !task176Composition && !task177Composition && !task178Composition && !task179Composition && process.env.OTID_TASK170_CONFIRM !== confirmation) ||
  Number(task174Composition) + Number(task176Composition) + Number(task177Composition) + Number(task178Composition) + Number(task179Composition) > 1 ||
  (process.env.OTID_TASK176_CONFIRM !== undefined && !task176Composition) ||
  (process.env.OTID_TASK177_CONFIRM !== undefined && !task177Composition) ||
  (process.env.OTID_TASK178_CONFIRM !== undefined && !task178Composition) ||
  (process.env.OTID_TASK179_CONFIRM !== undefined && !task179Composition) ||
  !sourceUrl || !targetUrl ||
  !pgBinDirectory || !isAbsolute(pgBinDirectory) || !minioBinary || !mcBinary) {
  throw new Error("TASK170_CONFIGURATION_INVALID");
}

type DatabaseTarget = {
  readonly connectionString: string;
  readonly databaseName: string;
  readonly suffix: string;
  readonly toolEnvironment: NodeJS.ProcessEnv;
  readonly dumpConnection: OperationalBackupPostgresConnection;
};

function parseDatabaseUrl(value: string, role: "source" | "target"): DatabaseTarget {
  try {
    const match = /^(postgres(?:ql)?:\/\/)([^/?#]+)\/([a-z0-9_]+)$/.exec(value);
    if (!match) throw new Error();
    const authority = match[2]!;
    const hostAndPort = authority.slice(authority.lastIndexOf("@") + 1);
    const authorityMatch = /^(localhost|127\.0\.0\.1|\[::1\]):([0-9]+)$/.exec(hostAndPort);
    const parsed = new URL(value);
    const databaseName = match[3]!;
    const prefix = `otid_task170_${role}_`;
    const suffix = databaseName.startsWith(prefix) ? databaseName.slice(prefix.length) : "";
    const port = Number(authorityMatch?.[2]);
    if (!authorityMatch || !parsed.username || !/^[a-z0-9][a-z0-9_]{0,31}$/.test(suffix) ||
      parsed.search || parsed.hash || parsed.pathname !== `/${databaseName}` ||
      !Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error();
    const toolEnvironment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? "",
      LANG: "C",
      PGHOST: authorityMatch[1]!.replace(/^\[|\]$/g, ""),
      PGPORT: authorityMatch[2],
      PGUSER: decodeURIComponent(parsed.username),
      PGDATABASE: databaseName,
      PGSSLMODE: "disable",
    };
    if (parsed.password) toolEnvironment.PGPASSWORD = decodeURIComponent(parsed.password);
    const dumpConnection: OperationalBackupPostgresConnection = {
      host: authorityMatch[1]!.replace(/^\[|\]$/g, ""),
      port,
      user: decodeURIComponent(parsed.username),
      password: parsed.password ? decodeURIComponent(parsed.password) : "",
      database: databaseName,
      sslMode: "disable",
    };
    return { connectionString: value, databaseName, suffix, toolEnvironment, dumpConnection };
  } catch {
    throw new Error("TASK170_CONFIGURATION_INVALID");
  }
}

const source = parseDatabaseUrl(sourceUrl, "source");
const target = parseDatabaseUrl(targetUrl, "target");
if (source.suffix !== target.suffix || source.databaseName === target.databaseName) {
  throw new Error("TASK170_CONFIGURATION_INVALID");
}

async function assertDatabaseEmpty(db: Database): Promise<void> {
  const result = await db.execute(sql`
    SELECT
      EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      ) AS "hasUserRelations",
      EXISTS (
        SELECT 1 FROM pg_namespace
        WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'public')
          AND nspname NOT LIKE 'pg_toast%'
      ) AS "hasUserSchemas",
      EXISTS (SELECT 1 FROM pg_extension WHERE extname <> 'plpgsql') AS "hasNonDefaultExtensions"
  `);
  const row = result.rows[0];
  if (!row || row.hasUserRelations !== false || row.hasUserSchemas !== false || row.hasNonDefaultExtensions !== false) {
    throw new Error("TASK170_DATABASE_NOT_EMPTY");
  }
}

function runPostgresTool(executable: string, args: string[], environment: NodeJS.ProcessEnv, captureOutput = false): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let output = "";
    let settled = false;
    const child = spawn(executable, args, {
      env: environment,
      stdio: ["ignore", captureOutput ? "pipe" : "ignore", "ignore"],
    });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolvePromise(output.trim());
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("TASK170_POSTGRES_TOOL_FAILED"));
    }, 120_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (output.length < 4096) output += chunk.toString("utf8").slice(0, 4096 - output.length);
    });
    child.once("error", () => finish(new Error("TASK170_POSTGRES_TOOL_FAILED")));
    child.once("close", (code) => code === 0 ? finish() : finish(new Error("TASK170_POSTGRES_TOOL_FAILED")));
  });
}

function runTask179Child(phase: "capture" | "restore", privateEnvironment: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let childCode = "";
    const child = spawn("pnpm", ["exec", "tsx", "test/task179-handoff-child.ts", phase], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
        CI: "true", NODE_ENV: "test", ...privateEnvironment },
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const value = chunk.toString("utf8").trim();
      if (/^(?:TASK179|OPERATIONAL_BACKUP)_[A-Z0-9_]+$/.test(value)) childCode = value;
    });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolvePromise();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`TASK179_${phase.toUpperCase()}_TIMEOUT`));
    }, 180_000);
    child.once("error", () => finish(new Error(`TASK179_${phase.toUpperCase()}_FAILED`)));
    child.once("close", code => code === 0 ? finish() : finish(new Error(childCode || `TASK179_${phase.toUpperCase()}_FAILED`)));
  });
}

function clientMajor(version: string): number {
  const match = /PostgreSQL\) (\d+)\./.exec(version);
  if (!match) throw new Error("TASK170_POSTGRES_TOOL_VERSION_INVALID");
  return Number(match[1]);
}

async function databaseMajor(db: Database): Promise<number> {
  const result = await db.execute(sql`SHOW server_version_num`);
  const version = Number((result.rows[0] as { server_version_num?: unknown } | undefined)?.server_version_num);
  if (!Number.isSafeInteger(version) || version < 100_000) throw new Error("TASK170_POSTGRES_VERSION_INVALID");
  return Math.floor(version / 10_000);
}

type PmTuple = {
  readonly storeId: string;
  readonly key: string;
  readonly versionId: string;
  readonly sha256: string;
  readonly byteLength: number;
};

async function createSyntheticRestoreChain(db: Database, pm: PmTuple, ids: { raceId: string; attemptId: string }) {
  const now = new Date("2026-09-20T10:00:00.000Z");
  const eventId = randomUUID(), raceId = ids.raceId, courseId = randomUUID(), courseVersionId = randomUUID();
  const classId = randomUUID(), entryId = randomUUID(), rawId = randomUUID(), readoutId = randomUUID();
  const finalizerId = randomUUID(), pmActorId = randomUUID(), uploadId = randomUUID(), attemptId = ids.attemptId;
  await db.insert(schema.events).values({ id: eventId, name: "TASK170 syntetisk återställning", startsOn: "2026-09-20", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Syntetiskt lopp", raceDate: "2026-09-20" });
  await db.insert(schema.courses).values({ id: courseId, raceId, name: "Syntetisk bana" });
  await db.insert(schema.courseVersions).values({ id: courseVersionId, courseId, version: 1 });
  await db.insert(schema.classes).values({ id: classId, raceId, courseVersionId, name: "Syntetisk klass", startRule: "FIXED" });
  await db.insert(schema.entries).values({ id: entryId, raceId, classId, givenName: "Syntetisk", familyName: "Löpare" });
  await db.insert(schema.rawDeviceMessages).values({
    id: rawId, raceId, deviceId: randomUUID(), sessionId: randomUUID(), localSequence: 1, packageVersion: 1,
    stationReceivedAt: now, serverReceivedAt: now, transport: "simulator", rawPayload: { synthetic: true }, contentHash: "a".repeat(64),
  });
  await db.insert(schema.cardReadouts).values({
    id: readoutId, raceId, rawMessageId: rawId, cardNumber: "12345", startPunchedAt: new Date("2026-09-20T09:00:00.000Z"),
    finishPunchedAt: new Date("2026-09-20T09:30:00.000Z"), punches: [], readAt: now,
  });
  await db.insert(schema.resultRevisions).values({
    raceId, entryId, readoutId, revision: 1, cause: "CARD_READOUT", status: "OK", reason: "COMPLETE",
    evaluation: {
      status: "OK", reason: "COMPLETE", entryId, classId, courseVersionId,
      startTime: "2026-09-20T09:00:00.000Z", finishTime: "2026-09-20T09:30:00.000Z", elapsedMs: 1_800_000,
      missingControls: [], extraPunches: [], splits: [],
    },
    engineVersion: "synthetic", snapshotVersion: 1, courseVersionId, published: true, createdAt: now,
  });
  await db.insert(schema.pairingAdminAccessCredentials).values([
    { id: finalizerId, raceId, capability: "FINALIZE_RESULTS", label: "Synthetic finalizer", secretHash: "a".repeat(64), issuedAt: now, expiresAt: new Date("2026-09-20T18:00:00.000Z") },
    { id: pmActorId, raceId, capability: "MANAGE_PM_DOCUMENT", label: "Synthetic PM", secretHash: "a".repeat(64), issuedAt: now, expiresAt: new Date("2026-09-20T18:00:00.000Z") },
  ]);
  await db.insert(schema.resultFinalizations).values({
    id: randomUUID(), requestId: randomUUID(), raceId, scope: "RACE", classId: null, scopeRevision: 1,
    sourceSnapshotVersion: 1, sourceHash: "a".repeat(64), frozenProjection: {}, completeXml: "<ResultList status=\"Complete\" />",
    completeXmlHash: "a".repeat(64), actorCredentialId: finalizerId, finalizedAt: now,
  });
  await db.insert(schema.auditEvents).values({
    raceId, entityType: "synthetic_restore_chain", entityId: entryId, action: "SYNTHETIC_RESTORE_CHAIN", after: { synthetic: true }, createdAt: now,
  });
  await db.transaction(async (tx) => {
    await tx.insert(schema.pmUploadReservations).values({
      id: uploadId, requestId: randomUUID(), raceId, actorCredentialId: pmActorId, capability: "MANAGE_PM_DOCUMENT",
      slot: 1, title: "Synthetic PM", mediaType: "application/pdf", sha256: pm.sha256,
      byteLength: pm.byteLength, reservedAt: now,
    });
    await tx.insert(schema.pmUploadAttempts).values({
      id: attemptId, uploadId, raceId, attemptNumber: 1, sha256: pm.sha256,
      byteLength: pm.byteLength, chargedAt: now,
    });
    await tx.insert(schema.pmObjectManifests).values({
      uploadId, attemptId, raceId, storeId: pm.storeId, objectKey: pm.key,
      versionId: pm.versionId, sha256: pm.sha256, byteLength: pm.byteLength, storedAt: now,
    });
    await tx.insert(schema.pmScanJobs).values({ uploadId, state: "PENDING", generation: 0n, createdAt: now });
  });
  return { eventId, entryId };
}

function samePm(left: PmTuple, right: PmTuple): boolean {
  return left.storeId === right.storeId && left.key === right.key && left.versionId === right.versionId &&
    left.sha256 === right.sha256 && left.byteLength === right.byteLength;
}

async function expectRestoreError(operation: Promise<unknown>, code: OperationalRestoreVerificationError["code"]): Promise<void> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof OperationalRestoreVerificationError && error.code === code) return;
    throw error;
  }
  throw new Error("TASK170_EXPECTED_REJECTION_MISSING");
}

async function readBoundTargetCredentials(input: {
  privateRoot: string;
  backupId: string;
  binding: Awaited<ReturnType<typeof readOperationalBackupTargetBinding>>;
}): Promise<{ accessKey: string; secretKey: string }> {
  const path = join(input.privateRoot, `${input.backupId}.credentials.json`);
  if (input.binding.credentialRef !== `file:${path}` || dirname(path) !== input.privateRoot) {
    throw new Error("TASK176_TARGET_CREDENTIAL_BINDING_INVALID");
  }
  const [named, root] = await Promise.all([lstat(path), lstat(input.privateRoot)]);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!root.isDirectory() || root.uid !== process.getuid?.() || (root.mode & 0o777) !== 0o700 ||
      !opened.isFile() || opened.nlink !== 1 || opened.uid !== process.getuid?.() ||
      (opened.mode & 0o777) !== 0o600 || opened.dev !== named.dev || opened.ino !== named.ino ||
      opened.dev !== input.binding.credentialFileIdentity.dev ||
      opened.ino !== input.binding.credentialFileIdentity.ino || opened.size > 4096) {
      throw new Error("TASK176_TARGET_CREDENTIAL_BINDING_INVALID");
    }
    const bytes = await handle.readFile();
    if (createHash("sha256").update(bytes).digest("hex") !== input.binding.credentialFileSha256) {
      throw new Error("TASK176_TARGET_CREDENTIAL_BINDING_INVALID");
    }
    const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("TASK176_TARGET_CREDENTIAL_BINDING_INVALID");
    }
    const credentials = parsed as Record<string, unknown>;
    if (Object.keys(credentials).sort().join(",") !== "accessKey,secretKey" ||
      typeof credentials.accessKey !== "string" || credentials.accessKey.length < 10 || credentials.accessKey.length > 128 ||
      typeof credentials.secretKey !== "string" || credentials.secretKey.length < 32 || credentials.secretKey.length > 128) {
      throw new Error("TASK176_TARGET_CREDENTIAL_BINDING_INVALID");
    }
    return { accessKey: credentials.accessKey, secretKey: credentials.secretKey };
  } finally {
    await handle.close();
  }
}

async function verifyPinnedMc(path: string): Promise<string> {
  const expected = "f72ab39389f6b8ac7369fa1894b62f34a9eca230c339c0b3128a7e45ecfcf139";
  const canonical = await realpath(path);
  const details = await stat(canonical);
  if (canonical !== path || !details.isFile() || (details.mode & 0o111) === 0 ||
    createHash("sha256").update(await readFile(canonical)).digest("hex") !== expected) {
    throw new Error("TASK176_PINNED_MC_INVALID");
  }
  return canonical;
}

async function verifyNoSourceRules(endpoint: string, bucket: string, credentials: { accessKey: string; secretKey: string }): Promise<void> {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port) {
    throw new Error("TASK176_SOURCE_RULE_CHECK_INVALID");
  }
  const client = new Client({ endPoint: url.hostname, port: Number(url.port), useSSL: false, region: "us-east-1",
    ...credentials, retryOptions: { disableRetry: true } });
  try {
    const getReplication = client.getBucketReplication.bind(client) as unknown as (name: string) => Promise<unknown>;
    const response = await getReplication(bucket);
    const outer = response && typeof response === "object" ? response as Record<string, unknown> : {};
    const configuration = outer["ReplicationConfiguration"];
    const rules = configuration && typeof configuration === "object"
      ? (configuration as Record<string, unknown>)["rules"] : undefined;
    if (!Array.isArray(rules) || rules.length !== 0) throw new Error("TASK176_SOURCE_RULES_NOT_EMPTY");
  } catch (error) {
    if (error instanceof Error && error.message === "TASK176_SOURCE_RULES_NOT_EMPTY") throw error;
    if (!error || typeof error !== "object" || !("code" in error) ||
      (error as { code?: unknown }).code !== "ReplicationConfigurationNotFoundError") {
      throw new Error("TASK176_SOURCE_RULE_CHECK_FAILED");
    }
  }
}

async function main(): Promise<void> {
  const sourceDatabase = createDatabase(source.connectionString);
  const targetDatabase = createDatabase(target.connectionString);
  let privateDirectory: string | undefined;
  let task178Completed = false;
  let task179Completed = false;
  try {
    // Never let a migration or pg_restore run against a pre-existing target.
    await assertDatabaseEmpty(sourceDatabase.db);
    await assertDatabaseEmpty(targetDatabase.db);
    const sourceMajor = await databaseMajor(sourceDatabase.db);
    if (!task174Composition && !task176Composition && await databaseMajor(targetDatabase.db) !== sourceMajor) throw new Error("TASK170_POSTGRES_VERSION_MISMATCH");
    if ((task176Composition || task177Composition || task178Composition || task179Composition) && sourceMajor !== 17) throw new Error("TASK176_POSTGRES_VERSION_INVALID");
    if ((task177Composition || task178Composition || task179Composition) && await databaseMajor(targetDatabase.db) !== 17) throw new Error("TASK177_POSTGRES_VERSION_INVALID");
    const pgDump = join(pgBinDirectory!, "pg_dump");
    const pgRestore = join(pgBinDirectory!, "pg_restore");
    if (!task174Composition && !task176Composition && clientMajor(await runPostgresTool(pgRestore, ["--version"], target.toolEnvironment, true)) !== sourceMajor) {
      throw new Error("TASK170_POSTGRES_TOOL_VERSION_INVALID");
    }

    const raceId = randomUUID(), attemptId = randomUUID(), backupId = randomUUID();
    const managedMc = task176Composition || task177Composition || task178Composition || task179Composition ? await verifyPinnedMc(resolve(mcBinary!)) : undefined;
    let identity: Awaited<ReturnType<typeof createSyntheticRestoreChain>> | undefined;
    let sourceCapture: Awaited<ReturnType<typeof captureOperationalBackupSource>> | undefined;
    let dumpPath: string | undefined;
    const sourceReady = async ({ first: firstManifest, second: secondManifest, sourceStore, sourceCredentials,
      sourceEndpoint, bucket, targetInstanceId, targetConfiguration }: {
        first: import("./pinned-minio-replication-fixture").PinnedPmVersionManifest;
        second: import("./pinned-minio-replication-fixture").PinnedPmVersionManifest;
        sourceStore: import("./pinned-minio-replication-fixture").PinnedMinioPmObjectStore;
        sourceEndpoint: string; bucket: string; targetInstanceId?: string;
        sourceCredentials?: { accessKey: string; secretKey: string };
        targetConfiguration?: { endpoint: string; region: "us-east-1"; accessKey: string; secretKey: string; mode: "loopback-development" };
      }) => {
        if (firstManifest.versionId === secondManifest.versionId) throw new Error("TASK170_HISTORICAL_VERSION_MISSING");
        await migrate(sourceDatabase.db, { migrationsFolder: new URL("../../database/migrations", import.meta.url).pathname });
        identity = await createSyntheticRestoreChain(sourceDatabase.db, firstManifest, { raceId, attemptId });
        privateDirectory = await mkdtemp(join(await realpath(tmpdir()), "otid-task170-restore-"));
        await chmod(privateDirectory, 0o700);
        if (task179Composition) {
          if (!sourceCredentials || !managedMc || !identity) throw new Error("TASK179_SOURCE_CONFIGURATION_INVALID");
          const targetRoot = await mkdtemp(join(await realpath(tmpdir()), "otid-task179-target-"));
          const recordDirectory = await mkdtemp(join(await realpath(tmpdir()), "otid-task179-record-"));
          await chmod(targetRoot, 0o700);
          await chmod(recordDirectory, 0o700);
          const common: NodeJS.ProcessEnv = {
            OTID_TASK179_CHILD_CONFIRM: task179Confirmation,
            TASK179_BACKUP_ID: backupId,
            TASK179_OPERATION_DIRECTORY: privateDirectory,
            TASK179_TARGET_ROOT: targetRoot,
            TASK179_RECORD_DIRECTORY: recordDirectory,
            TASK179_REPOSITORY_ROOT: process.cwd(),
            TASK179_MINIO_BINARY: resolve(minioBinary!),
            TASK179_PG_BIN_DIR: pgBinDirectory!,
          };
          await runTask179Child("capture", {
            ...common,
            TASK179_SOURCE_DATABASE_URL: source.connectionString,
            TASK179_SOURCE_ENDPOINT: sourceEndpoint,
            TASK179_SOURCE_BUCKET: bucket,
            TASK179_SOURCE_ACCESS_KEY: sourceCredentials.accessKey,
            TASK179_SOURCE_SECRET_KEY: sourceCredentials.secretKey,
            TASK179_FIRST_PM_JSON: JSON.stringify(firstManifest),
            TASK179_MC_BINARY: managedMc,
          });
          // This is a distinct OS process. It receives no source URL, source
          // credential or private in-memory manifest from the capture process.
          await runTask179Child("restore", {
            ...common,
            TASK179_TARGET_DATABASE_URL: target.connectionString,
            TASK179_EXPECTED_EVENT_ID: identity.eventId,
            TASK179_EXPECTED_ENTRY_ID: identity.entryId,
          });
          const restoredPm = await readOperationalBackupPmObjects(targetDatabase.db);
          if (restoredPm.length !== 1 || !samePm(restoredPm[0]!, firstManifest) ||
              samePm(restoredPm[0]!, secondManifest)) throw new Error("TASK179_RESTORED_PM_INVALID");
          const events = await targetDatabase.db.execute(sql`SELECT id FROM event WHERE id = ${identity.eventId}`);
          const entries = await targetDatabase.db.execute(sql`SELECT id FROM entry WHERE id = ${identity.entryId}`);
          if (events.rows.length !== 1 || entries.rows.length !== 1) throw new Error("TASK179_RESTORED_HISTORY_INVALID");
          task179Completed = true;
          await rm(targetRoot, { recursive: true, force: true });
          await rm(recordDirectory, { recursive: true, force: true });
          return;
        }
        const recorder = createOperationalBackupOperationStateRecorder({ directory: privateDirectory, repositoryRoot: process.cwd() });
        const dumpPort = await createOperationalBackupPostgresDumpPort({
          repositoryRoot: process.cwd(), directory: privateDirectory, backupId,
          pgDumpPath: pgDump, connection: source.dumpConnection,
          readServerMajor: () => databaseMajor(sourceDatabase.db),
        });
        dumpPath = dumpPort.dumpPath;
        const sourcePreflight = {
          prepare: (intent: Parameters<typeof prepareOperationalBackupSourcePreflight>[1]) =>
            prepareOperationalBackupSourcePreflight(sourceDatabase.db, intent, createOperationalBackupPmVerifier(sourceStore)),
        };
        const runIntent = {
          backupId, createdAt: new Date("2026-09-20T10:00:00.000Z").toISOString(), writeStopConfirmed: true,
        };
        if (task177Composition || task178Composition) {
          if (!sourceCredentials || !managedMc) throw new Error("TASK177_SOURCE_CONFIGURATION_INVALID");
          const privateTargetRoot = await mkdtemp(join(await realpath(tmpdir()), task178Composition ? "otid-task178-target-" : "otid-task177-target-"));
          await chmod(privateTargetRoot, 0o700);
          let provisioned: Awaited<ReturnType<typeof provisionPinnedOperationalBackupTarget>> | undefined;
          let targetPmReader: ReturnType<typeof createPmObjectStore> | undefined;
          let targetCredentials: { accessKey: string; secretKey: string } | undefined;
          let store: { storeId: string; sourceEndpoint: string; sourceBucket: string; targetBucket: string } | undefined;
          let completed = false;
          let receipt: Awaited<ReturnType<typeof captureOperationalBackup>>;
          try {
            receipt = await captureOperationalBackup(runIntent, sourcePreflight, {
            async createPostgresDump() { return dumpPort.createPostgresDump(); },
            async recordOperationState(state) { await recorder.record(state); },
            async prepareEmptyTarget(evidence) {
              sourceCapture = evidence;
              store = { storeId: firstManifest.storeId, sourceEndpoint, sourceBucket: bucket, targetBucket: bucket };
              if (evidence.manifest.pmObjects.length !== 1 || !samePm(evidence.manifest.pmObjects[0]!, firstManifest) ||
                samePm(evidence.manifest.pmObjects[0]!, secondManifest)) throw new Error("TASK177_SOURCE_PM_REFERENCE_MISMATCH");
              const sourceState = await readOperationalBackupOperationState({ directory: privateDirectory!, repositoryRoot: process.cwd(), backupId });
              provisioned = await provisionPinnedOperationalBackupTarget({
                backupId, sourceCapture: evidence, operationStateDirectory: privateDirectory!, stores: [store],
                privateRoot: privateTargetRoot, repositoryRoot: process.cwd(), minioBinary: resolve(minioBinary!),
              });
              const binding = await readOperationalBackupTargetBinding({ directory: privateTargetRoot, repositoryRoot: process.cwd(), backupId });
              if (provisioned.readiness.kind !== "TARGET_READY_EVIDENCE" || provisioned.readiness.backupId !== backupId ||
                provisioned.readiness.manifestSha256 !== evidence.manifestSha256 || provisioned.readiness.targetId !== binding.targetId ||
                JSON.stringify(provisioned.readiness.storeIds) !== JSON.stringify([firstManifest.storeId]) ||
                JSON.stringify(binding) !== JSON.stringify(provisioned.binding) || binding.stores.length !== 1 ||
                JSON.stringify(binding.stores[0]) !== JSON.stringify(store) || binding.manifestSha256 !== evidence.manifestSha256 ||
                sourceState?.phase !== "TARGET_PREPARATION_PENDING" || sourceState.manifestSha256 !== evidence.manifestSha256) {
                throw new Error("TASK177_TARGET_BINDING_INVALID");
              }
              targetCredentials = await readBoundTargetCredentials({ privateRoot: privateTargetRoot, backupId, binding });
              targetPmReader = createPmObjectStore({ storeId: firstManifest.storeId, endpoint: binding.targetEndpoint, bucket,
                region: "us-east-1", ...targetCredentials, mode: "loopback-development", deadlineMs: 5_000 });
              const databasePm = await readOperationalBackupPmObjects(sourceDatabase.db);
              if (databasePm.length !== 1 || !samePm(databasePm[0]!, firstManifest)) throw new Error("TASK177_DATABASE_PM_REFERENCE_INVALID");
              await assertDatabaseEmpty(targetDatabase.db);
            },
            async replicateAndCleanup(evidence) {
              if (!provisioned || !targetPmReader || !targetCredentials || !store) throw new Error("TASK177_TARGET_NOT_READY");
              const binding = await readOperationalBackupTargetBinding({ directory: privateTargetRoot, repositoryRoot: process.cwd(), backupId });
              const operationState = await readOperationalBackupOperationState({ directory: privateDirectory!, repositoryRoot: process.cwd(), backupId });
              await replicateOperationalBackupStore({
                backupId, sourceCapture: evidence, operationState, readinessEvidence: provisioned.readiness,
                targetBinding: binding, store, sourceCredentials, target: {
                  endpoint: binding.targetEndpoint, region: "us-east-1", mode: "loopback-development", ...targetCredentials,
                }, targetPmReader, mcBinary: managedMc, recordOperationState: state => recorder.record(state),
                timeoutMs: 60_000, pollIntervalMs: 250,
              });
            },
            async verifyCompletion(evidence) {
              if (!sourceCapture || !targetPmReader || !sourceCredentials || !store) throw new Error("TASK177_COMPLETION_INPUT_INVALID");
              return verifyOperationalBackupCompletion({
                sourceCapture: evidence, operationStateDirectory: privateDirectory!, repositoryRoot: process.cwd(),
                targetBindingDirectory: privateTargetRoot, store, sourceCredentials, targetPmReader, dumpPath: dumpPath!,
              });
            },
            });
            const receiptKeys = Object.keys(receipt).sort();
            if (receiptKeys.join(",") !== "backupId,manifestSha256,verifiedPmObjectCount" || !sourceCapture ||
              receipt.backupId !== sourceCapture.manifest.backupId || receipt.manifestSha256 !== sourceCapture.manifestSha256 ||
              receipt.verifiedPmObjectCount !== sourceCapture.verifiedPmObjectCount) throw new Error("TASK177_RECEIPT_INVALID");
            await assertDatabaseEmpty(targetDatabase.db);
            if (task178Composition) {
              if (!sourceCapture || !targetPmReader || !identity || !dumpPath) throw new Error("TASK178_RESTORE_INPUT_INVALID");
              const expectedDump = sourceCapture.manifest.postgresDump;
              const dumpStat = await stat(dumpPath);
              if (!dumpStat.isFile() || (dumpStat.mode & 0o077) !== 0) throw new Error("TASK178_DUMP_INVALID");
              await runPostgresTool(pgRestore, ["--list", dumpPath], target.toolEnvironment);
              await assertDatabaseEmpty(targetDatabase.db);
              await runPostgresTool(pgRestore, [
                "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl",
                "--dbname", target.databaseName, dumpPath,
              ], target.toolEnvironment);
              const measuredAfterRestore = await measureOperationalBackupPostgresDump({
                identity: expectedDump.identity, chunks: createReadStream(dumpPath),
                expected: { sha256: expectedDump.sha256, byteLength: expectedDump.byteLength },
              });
              const restoreReceipt = await verifyOperationalRestore(targetDatabase.db, sourceCapture.manifest, {
                async measure() { return measuredAfterRestore; },
              }, createOperationalBackupPmVerifier(targetPmReader));
              const restoredPm = await readOperationalBackupPmObjects(targetDatabase.db);
              if (restoreReceipt.manifestSha256 !== sourceCapture.manifestSha256 ||
                restoreReceipt.verifiedPmObjectCount !== sourceCapture.verifiedPmObjectCount ||
                restoreReceipt.databaseEvidence.pmObjects.length !== 1 ||
                !samePm(restoreReceipt.databaseEvidence.pmObjects[0]!, firstManifest) ||
                restoredPm.length !== 1 || !samePm(restoredPm[0]!, firstManifest) ||
                restoreReceipt.databaseEvidence.history.events !== 1 || restoreReceipt.databaseEvidence.history.entries !== 1 ||
                restoreReceipt.databaseEvidence.history.resultFinalizations !== 1) {
                throw new Error("TASK178_RESTORE_RECEIPT_INVALID");
              }
              const eventRows = await targetDatabase.db.execute(sql`SELECT id FROM event WHERE id = ${identity.eventId}`);
              const entryRows = await targetDatabase.db.execute(sql`SELECT id FROM entry WHERE id = ${identity.entryId}`);
              if (eventRows.rows.length !== 1 || eventRows.rows[0]?.id !== identity.eventId ||
                entryRows.rows.length !== 1 || entryRows.rows[0]?.id !== identity.entryId) {
                throw new Error("TASK178_RESTORED_IDENTITY_MISMATCH");
              }
            }
            completed = true;
            if (task178Composition) task178Completed = true;
          } finally {
            if (provisioned) await provisioned.stop();
            if (completed) await rm(privateTargetRoot, { recursive: true, force: true });
          }
          return;
        }
        sourceCapture = await captureOperationalBackupSource(runIntent, sourcePreflight, {
          createPostgresDump: () => dumpPort.createPostgresDump(),
          recordOperationState: state => recorder.record(state),
        });
        const state = await readOperationalBackupOperationState({ directory: privateDirectory, repositoryRoot: process.cwd(), backupId });
        if (state?.phase !== "TARGET_PREPARATION_PENDING" || state.manifestSha256 !== sourceCapture.manifestSha256 ||
          state.storeIds.length !== 1 || state.storeIds[0] !== firstManifest.storeId ||
          sourceCapture.manifest.pmObjects.length !== 1 ||
          !samePm(sourceCapture.manifest.pmObjects[0]!, firstManifest) ||
          samePm(sourceCapture.manifest.pmObjects[0]!, secondManifest)) {
          throw new Error("TASK170_SOURCE_PM_REFERENCE_MISMATCH");
        }
        if (task174Composition || task176Composition) {
          const privateTargetRoot = await mkdtemp(join(await realpath(tmpdir()), "otid-task174-target-"));
          await chmod(privateTargetRoot, 0o700);
          const provisioned = await provisionPinnedOperationalBackupTarget({
            backupId, sourceCapture, operationStateDirectory: privateDirectory,
            stores: [{ storeId: firstManifest.storeId, sourceEndpoint, sourceBucket: bucket, targetBucket: bucket }],
            privateRoot: privateTargetRoot, repositoryRoot: process.cwd(), minioBinary: resolve(minioBinary!),
          });
          try {
            const binding = await readOperationalBackupTargetBinding({
              directory: privateTargetRoot, repositoryRoot: process.cwd(), backupId,
            });
            if (provisioned.readiness.kind !== "TARGET_READY_EVIDENCE" ||
              provisioned.readiness.backupId !== backupId ||
              provisioned.readiness.manifestSha256 !== sourceCapture.manifestSha256 ||
              provisioned.readiness.targetId !== binding.targetId ||
              JSON.stringify(provisioned.readiness.storeIds) !== JSON.stringify([firstManifest.storeId]) ||
              JSON.stringify(binding) !== JSON.stringify(provisioned.binding) ||
              binding.stores.length !== 1 || binding.stores[0]?.storeId !== firstManifest.storeId ||
              binding.manifestSha256 !== sourceCapture.manifestSha256) {
              throw new Error(task176Composition ? "TASK176_TARGET_BINDING_INVALID" : "TASK174_TARGET_COMPOSITION_INVALID");
            }
            if (task176Composition) {
              if (!managedMc || !sourceCredentials || sourceCapture.manifest.pmObjects.length !== 1 ||
                !samePm(sourceCapture.manifest.pmObjects[0]!, firstManifest) ||
                firstManifest.versionId === secondManifest.versionId ||
                firstManifest.storeId !== secondManifest.storeId || firstManifest.key !== secondManifest.key) {
                throw new Error("TASK176_SOURCE_MANIFEST_INVALID");
              }
              const targetCredentials = await readBoundTargetCredentials({
                privateRoot: privateTargetRoot, backupId, binding,
              });
              const store = { storeId: firstManifest.storeId, sourceEndpoint, sourceBucket: bucket, targetBucket: bucket };
              if (binding.stores.length !== 1 || JSON.stringify(binding.stores[0]) !== JSON.stringify(store)) {
                throw new Error("TASK176_TARGET_STORE_BINDING_INVALID");
              }
              const operationState = await readOperationalBackupOperationState({
                directory: privateDirectory, repositoryRoot: process.cwd(), backupId,
              });
              if (operationState?.phase !== "TARGET_PREPARATION_PENDING" ||
                operationState.manifestSha256 !== sourceCapture.manifestSha256 ||
                operationState.storeIds.length !== 1 || operationState.storeIds[0] !== firstManifest.storeId) {
                throw new Error("TASK176_SOURCE_STATE_INVALID");
              }
              const targetPmReader = createPmObjectStore({ storeId: firstManifest.storeId,
                endpoint: binding.targetEndpoint, bucket, region: "us-east-1", ...targetCredentials,
                mode: "loopback-development", deadlineMs: 5_000 });
              await replicateOperationalBackupStore({
                backupId, sourceCapture, operationState, readinessEvidence: provisioned.readiness,
                targetBinding: binding, store, sourceCredentials, target: {
                  endpoint: binding.targetEndpoint, region: "us-east-1", mode: "loopback-development", ...targetCredentials,
                }, targetPmReader, mcBinary: managedMc,
                recordOperationState: state => recorder.record(state),
                timeoutMs: 60_000, pollIntervalMs: 250,
              });
              const cleanupState = await readOperationalBackupOperationState({
                directory: privateDirectory, repositoryRoot: process.cwd(), backupId,
              });
              if (cleanupState?.phase !== "CLEANUP_VERIFIED" || cleanupState.backupId !== backupId ||
                cleanupState.manifestSha256 !== sourceCapture.manifestSha256 || cleanupState.storeIds.length !== 1 ||
                cleanupState.storeIds[0] !== firstManifest.storeId) {
                throw new Error("TASK176_CLEANUP_STATE_INVALID");
              }
              await verifyNoSourceRules(sourceEndpoint, bucket, sourceCredentials);
              const databasePm = await readOperationalBackupPmObjects(sourceDatabase.db);
              if (databasePm.length !== 1 || !samePm(databasePm[0]!, firstManifest)) {
                throw new Error("TASK176_DATABASE_PM_REFERENCE_INVALID");
              }
              await readOperationalBackupPmObject(targetPmReader, databasePm[0]!);
            }
          } finally {
            await provisioned.stop();
          }
          return;
        }
        if (!targetInstanceId || !targetConfiguration) throw new Error("TASK170_TARGET_FIXTURE_MISSING");
        const targetReadiness = await verifyOperationalBackupTargetReadiness({
          backupId, sourceCapture, operationState: state,
          targetFreshnessAttestation: { backupId, targetId: targetInstanceId, freshlyProvisioned: true, exclusive: true },
          target: targetConfiguration,
          stores: [{ storeId: firstManifest.storeId, sourceEndpoint, sourceBucket: bucket, targetBucket: bucket }],
        });
        if (targetReadiness.kind !== "TARGET_READY_EVIDENCE" || targetReadiness.backupId !== backupId ||
          targetReadiness.manifestSha256 !== sourceCapture.manifestSha256 || targetReadiness.targetId !== targetInstanceId ||
          targetReadiness.storeIds.length !== 1 || targetReadiness.storeIds[0] !== firstManifest.storeId) {
          throw new Error("TASK173_TARGET_READINESS_INVALID");
        }
      };
    if (task174Composition || task176Composition || task177Composition || task178Composition || task179Composition) {
      await withPinnedMinioSource({ minioBinary: resolve(minioBinary!), sourceObjectKey: `pm/${raceId}/${attemptId}`,
        onSourceReady: sourceReady });
      if (task176Composition) {
        console.log("TASK176 synthetic PostgreSQL source capture, bound MinIO target, one-store replication, cleanup, and exact DB-referenced PM version read passed. No restore or backup receipt was created.");
      } else if (task178Composition) {
        console.log("TASK178 receipted synthetic PostgreSQL and version-preserving PM backup restored into an empty PostgreSQL17 target; receipt, dump, historical PM tuple, history, and synthetic IDs verified. No production backup was created.");
      } else if (task179Composition) {
        console.log("TASK179 synthetic completed backup reopened by a separate restore process and verified against the exact historical PM version in a new empty PostgreSQL17 target. No production backup was created.");
      } else if (task177Composition) {
        console.log("TASK177 managed one-store synthetic backup capture, cleanup proof, empty target database, and safe receipt passed; no restore or production backup was created.");
      } else {
        console.log("TASK174 source capture to private pinned target readiness passed; no replication rule or backup acknowledgement was created.");
      }
    } else await withPinnedMinioReplication({
      minioBinary: resolve(minioBinary!),
      mcBinary: resolve(mcBinary!),
      sourceObjectKey: `pm/${raceId}/${attemptId}`,
      onSourceReady: sourceReady,
      async onTargetReady({ manifests: { first: firstManifest, second: secondManifest }, targetStore }) {
        if (!identity || !sourceCapture || !dumpPath) throw new Error("TASK170_SOURCE_CHAIN_MISSING");
        const pmObjects = await readOperationalBackupPmObjects(sourceDatabase.db);
        if (pmObjects.length !== 1 || !samePm(pmObjects[0]!, firstManifest)) {
          throw new Error("TASK170_SOURCE_PM_REFERENCE_MISMATCH");
        }
        const measuredBeforeRestore = sourceCapture.manifest.postgresDump;
        const dumpStat = await stat(dumpPath);
        if (!dumpStat.isFile() || (dumpStat.mode & 0o077) !== 0) throw new Error("TASK170_DUMP_INVALID");
        await runPostgresTool(pgRestore, ["--list", dumpPath], target.toolEnvironment);
        await assertDatabaseEmpty(targetDatabase.db);
        await runPostgresTool(pgRestore, [
          "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl",
          "--dbname", target.databaseName, dumpPath,
        ], target.toolEnvironment);
        const measuredAfterRestore = await measureOperationalBackupPostgresDump({
          identity: measuredBeforeRestore.identity, chunks: createReadStream(dumpPath),
          expected: { sha256: measuredBeforeRestore.sha256, byteLength: measuredBeforeRestore.byteLength },
        });
        const manifest = sourceCapture.manifest;
        const pmVerifier = createOperationalBackupPmVerifier(targetStore);
        let targetPmVerified = false;
        const receipt = await verifyOperationalRestore(targetDatabase.db, manifest, {
          async measure() { return measuredAfterRestore; },
        }, {
          async verify(pmObject) {
            await pmVerifier.verify(pmObject);
            targetPmVerified = true;
          },
        });
        if (!targetPmVerified || receipt.verifiedPmObjectCount !== 1 ||
          receipt.databaseEvidence.migrationIdentity !== manifest.migrationIdentity ||
          receipt.databaseEvidence.pmObjects.length !== 1 ||
          !samePm(receipt.databaseEvidence.pmObjects[0]!, firstManifest) ||
          receipt.databaseEvidence.history.events !== 1 || receipt.databaseEvidence.history.entries !== 1 ||
          receipt.databaseEvidence.history.resultFinalizations !== 1) {
          throw new Error("TASK170_COMPOSITE_RECEIPT_INVALID");
        }
        const eventRows = await targetDatabase.db.execute(sql`SELECT id FROM event WHERE id = ${identity.eventId}`);
        const entryRows = await targetDatabase.db.execute(sql`SELECT id FROM entry WHERE id = ${identity.entryId}`);
        if (eventRows.rows.length !== 1 || eventRows.rows[0]?.id !== identity.eventId ||
          entryRows.rows.length !== 1 || entryRows.rows[0]?.id !== identity.entryId) {
          throw new Error("TASK170_RESTORED_IDENTITY_MISMATCH");
        }

        // A missing target version fails at PM reading, before DB evidence;
        // the newer version is readable but cannot replace the DB's older tuple.
        await expectRestoreError(verifyOperationalRestore(targetDatabase.db, {
          ...manifest, pmObjects: [{ ...pmObjects[0]!, versionId: "missing-version" }],
        }, { async measure() { return measuredAfterRestore; } }, pmVerifier), "PM_OBJECT_VERIFICATION_FAILED");
        await expectRestoreError(verifyOperationalRestore(targetDatabase.db, {
          ...manifest, pmObjects: [{ ...pmObjects[0]!, versionId: secondManifest.versionId,
            sha256: secondManifest.sha256, byteLength: secondManifest.byteLength }],
        }, { async measure() { return measuredAfterRestore; } }, pmVerifier), "PM_REFERENCE_MISMATCH");
        await expectRestoreError(verifyOperationalRestore(targetDatabase.db, {
          ...manifest, postgresDump: { ...measuredBeforeRestore, sha256: "f".repeat(64) },
        }, { async measure() { return measuredAfterRestore; } }, pmVerifier), "POSTGRES_DUMP_VERIFICATION_FAILED");
      },
    });
    if (!task174Composition && !task176Composition && !task177Composition && !task178Composition && !task179Composition) console.log("TASK170 synthetic composite PM/PostgreSQL restore proof passed; no production backup was created.");
  } finally {
    await Promise.all([
      sourceDatabase.pool.end(), targetDatabase.pool.end(),
      ...(privateDirectory && ((!task178Composition || task178Completed) && (!task179Composition || task179Completed))
        ? [rm(privateDirectory, { recursive: true, force: true })] : []),
    ]);
  }
}

await main();
