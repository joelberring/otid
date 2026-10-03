import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdtemp, open, rm, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase, schema } from "@o-tid/database";
import {
  OperationalRestoreVerificationError,
  readAppliedMigrationIdentity,
  verifyOperationalRestore,
  verifyOperationalRestoreDatabase,
} from "../../src";

const sourceUrl = process.env.TEST_DATABASE_URL;
if (!sourceUrl) throw new Error("TASK169_TEST_DATABASE_CONFIGURATION_INVALID");
const restoreUrl = process.env.TEST_RESTORE_DATABASE_URL;
const pgBinDirectory = process.env.TEST_PG_BIN_DIR;
if ((restoreUrl === undefined) !== (pgBinDirectory === undefined)) {
  throw new Error("TASK169_TEST_DATABASE_CONFIGURATION_INVALID");
}
const sourceTarget = restoreUrl === undefined ? undefined : parseTask169DatabaseUrl(sourceUrl, "source");
const restoreTarget = restoreUrl === undefined ? undefined : parseTask169DatabaseUrl(restoreUrl, "target");
if (restoreTarget && (!sourceTarget || !isAbsolute(pgBinDirectory!) || sourceTarget.suffix !== restoreTarget.suffix ||
  sourceTarget.databaseName === restoreTarget.databaseName)) {
  throw new Error("TASK169_TEST_DATABASE_CONFIGURATION_INVALID");
}
const { db, pool } = createDatabase(sourceTarget?.connectionString ?? sourceUrl);
const restoreDatabase = restoreTarget ? createDatabase(restoreTarget.connectionString) : undefined;
const now = new Date("2026-09-20T10:00:00.000Z");
const sha256 = "a".repeat(64);
let syntheticChain: Awaited<ReturnType<typeof createSyntheticRestoreChain>> | undefined;

beforeAll(async () => {
  if (restoreTarget) await assertDatabaseEmpty(db);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
  syntheticChain = await createSyntheticRestoreChain();
});
afterAll(async () => {
  await Promise.all([pool.end(), ...(restoreDatabase ? [restoreDatabase.pool.end()] : [])]);
});

type Task169DatabaseTarget = {
  connectionString: string;
  databaseName: string;
  suffix: string;
  toolEnvironment: NodeJS.ProcessEnv;
};

function parseTask169DatabaseUrl(value: string, role?: "source" | "target"): Task169DatabaseTarget {
  try {
    const match = /^(postgres(?:ql)?:\/\/)([^/?#]+)\/([a-z0-9_]+)$/.exec(value);
    if (!match) throw new Error();
    const authority = match[2]!;
    const hostAndPort = authority.slice(authority.lastIndexOf("@") + 1);
    const authorityMatch = /^(localhost|127\.0\.0\.1|\[::1\]):([0-9]+)$/.exec(hostAndPort);
    const parsed = new URL(value);
    const databaseName = match[3]!;
    const prefix = role === "source" ? "otid_task169_source_"
      : role === "target" ? "otid_task169_target_" : "";
    const suffix = prefix ? (databaseName.startsWith(prefix) ? databaseName.slice(prefix.length) : "") : databaseName;
    const username = decodeURIComponent(parsed.username);
    const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
    if (!authorityMatch || !username ||
      (prefix && !/^[a-z0-9][a-z0-9_]{0,31}$/.test(suffix)) ||
      parsed.search || parsed.hash || parsed.pathname !== `/${databaseName}` ||
      Number(authorityMatch[2]) < 1 || Number(authorityMatch[2]) > 65_535 || !Number.isSafeInteger(Number(authorityMatch[2]))) {
      throw new Error();
    }
    const host = authorityMatch[1]!.replace(/^\[|\]$/g, "");
    const toolEnvironment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? "",
      LANG: "C",
      PGHOST: host,
      PGPORT: authorityMatch[2],
      PGUSER: username,
      PGDATABASE: databaseName,
      PGSSLMODE: "disable",
    };
    if (password !== undefined) toolEnvironment.PGPASSWORD = password;
    return {
      connectionString: value,
      databaseName,
      suffix,
      toolEnvironment,
    };
  } catch {
    throw new Error("TASK169_TEST_DATABASE_CONFIGURATION_INVALID");
  }
}

async function assertDatabaseEmpty(database: typeof db): Promise<void> {
  const result = await database.execute(sql`
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
    throw new Error("TASK169_DATABASE_NOT_EMPTY");
  }
}

function runPostgresTool(executable: string, args: string[], environment: NodeJS.ProcessEnv, captureOutput = false): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const child = spawn(executable, args, {
      env: environment,
      stdio: ["ignore", captureOutput ? "pipe" : "ignore", "ignore"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("TASK169_POSTGRES_TOOL_FAILED"));
    }, 120_000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output.trim());
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      if (output.length < 4096) output += chunk.toString("utf8").slice(0, 4096 - output.length);
    });
    child.once("error", () => finish(new Error("TASK169_POSTGRES_TOOL_FAILED")));
    child.once("close", (code) => code === 0 ? finish() : finish(new Error("TASK169_POSTGRES_TOOL_FAILED")));
  });
}

async function measureDump(path: string, identity: string) {
  const hash = createHash("sha256");
  let byteLength = 0;
  for await (const chunk of createReadStream(path)) {
    const bytes = chunk as Buffer;
    hash.update(bytes);
    byteLength += bytes.byteLength;
  }
  if (byteLength < 1 || !Number.isSafeInteger(byteLength)) throw new Error("TASK169_DUMP_INVALID");
  return { identity, sha256: hash.digest("hex"), byteLength };
}

function clientMajor(version: string): number {
  const match = /PostgreSQL\) (\d+)\./.exec(version);
  if (!match) throw new Error("TASK169_POSTGRES_TOOL_VERSION_INVALID");
  return Number(match[1]);
}

async function databaseMajor(database: typeof db): Promise<number> {
  const result = await database.execute(sql`SHOW server_version_num`);
  const version = Number((result.rows[0] as { server_version_num?: unknown } | undefined)?.server_version_num);
  if (!Number.isSafeInteger(version) || version < 100_000) throw new Error("TASK169_POSTGRES_VERSION_INVALID");
  return Math.floor(version / 10_000);
}

async function createSyntheticRestoreChain() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const classId = randomUUID(), entryId = randomUUID(), rawId = randomUUID(), readoutId = randomUUID();
  const finalizerId = randomUUID(), pmActorId = randomUUID(), uploadId = randomUUID(), attemptId = randomUUID();
  const storeId = randomUUID(), objectKey = `pm/${raceId}/${attemptId}`, versionId = "synthetic-version-1";
  await db.insert(schema.events).values({ id: eventId, name: "TASK099 syntetisk återställning", startsOn: "2026-09-20", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Syntetiskt lopp", raceDate: "2026-09-20" });
  await db.insert(schema.courses).values({ id: courseId, raceId, name: "Syntetisk bana" });
  await db.insert(schema.courseVersions).values({ id: courseVersionId, courseId, version: 1 });
  await db.insert(schema.classes).values({ id: classId, raceId, courseVersionId, name: "Syntetisk klass", startRule: "FIXED" });
  await db.insert(schema.entries).values({ id: entryId, raceId, classId, givenName: "Syntetisk", familyName: "Löpare" });
  await db.insert(schema.rawDeviceMessages).values({
    id: rawId, raceId, deviceId: randomUUID(), sessionId: randomUUID(), localSequence: 1, packageVersion: 1,
    stationReceivedAt: now, serverReceivedAt: now, transport: "simulator", rawPayload: { synthetic: true }, contentHash: sha256,
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
    { id: finalizerId, raceId, capability: "FINALIZE_RESULTS", label: "Synthetic finalizer", secretHash: sha256, issuedAt: now, expiresAt: new Date("2026-09-20T18:00:00.000Z") },
    { id: pmActorId, raceId, capability: "MANAGE_PM_DOCUMENT", label: "Synthetic PM", secretHash: sha256, issuedAt: now, expiresAt: new Date("2026-09-20T18:00:00.000Z") },
  ]);
  await db.insert(schema.resultFinalizations).values({
    id: randomUUID(), requestId: randomUUID(), raceId, scope: "RACE", classId: null, scopeRevision: 1,
    sourceSnapshotVersion: 1, sourceHash: sha256, frozenProjection: {}, completeXml: "<ResultList status=\"Complete\" />",
    completeXmlHash: sha256, actorCredentialId: finalizerId, finalizedAt: now,
  });
  await db.insert(schema.auditEvents).values({
    raceId, entityType: "synthetic_restore_chain", entityId: entryId, action: "SYNTHETIC_RESTORE_CHAIN", after: { synthetic: true }, createdAt: now,
  });
  await db.transaction(async (tx) => {
    await tx.insert(schema.pmUploadReservations).values({
      id: uploadId, requestId: randomUUID(), raceId, actorCredentialId: pmActorId, capability: "MANAGE_PM_DOCUMENT",
      slot: 1, title: "Synthetic PM", mediaType: "application/pdf", sha256, byteLength: 10, reservedAt: now,
    });
    await tx.insert(schema.pmUploadAttempts).values({
      id: attemptId, uploadId, raceId, attemptNumber: 1, sha256, byteLength: 10, chargedAt: now,
    });
    await tx.insert(schema.pmObjectManifests).values({
      uploadId, attemptId, raceId, storeId, objectKey, versionId, sha256, byteLength: 10, storedAt: now,
    });
    await tx.insert(schema.pmScanJobs).values({ uploadId, state: "PENDING", generation: 0n, createdAt: now });
  });
  return { storeId, key: objectKey, versionId, eventId, entryId };
}

describe("TASK099 restore-verifier mot isolerad PostgreSQL/PostGIS", () => {
  it("avvisar icke-loopback och felbenämnda TASK169-databaser utan att röja URL", () => {
    const invalidTargets = [
      ["postgresql://tester:private@db.example.test:5432/otid_task169_source_20260923_b7f214", "source"],
      ["postgresql://tester:private@localhost:5432/otid_test_source_20260923_b7f214", "source"],
      ["postgresql://tester:private@localhost:5432/otid_task169_target_20260923_b7f214?sslmode=require", "target"],
    ] as const;
    for (const [databaseUrl, role] of invalidTargets) {
      expect(() => parseTask169DatabaseUrl(databaseUrl, role)).toThrow("TASK169_TEST_DATABASE_CONFIGURATION_INVALID");
      try {
        parseTask169DatabaseUrl(databaseUrl, role);
      } catch (error) {
        expect(String(error)).not.toContain("private");
        expect(String(error)).not.toContain("db.example.test");
      }
    }
    expect(parseTask169DatabaseUrl(
      "postgresql://joelberring@localhost:5432/otid_task169_source_20260923_b7f214", "source",
    ).databaseName).toBe("otid_task169_source_20260923_b7f214");
  });

  it("godkänner en läsande sammanhängande syntetisk tävlingskedja och avvisar ändrad PM-version", async () => {
    if (!syntheticChain) throw new Error("TASK099_SYNTHETIC_CHAIN_UNAVAILABLE");
    const pmObject = syntheticChain;
    const manifest = {
      formatVersion: 1 as const, backupId: randomUUID(), createdAt: now.toISOString(), writeStopConfirmed: true as const,
      postgresDump: { identity: "private/synthetic.dump", sha256, byteLength: 10 },
      migrationIdentity: await readAppliedMigrationIdentity(db),
      pmObjects: [{ storeId: pmObject.storeId, key: pmObject.key, versionId: pmObject.versionId, sha256, byteLength: 10 }],
    };
    await expect(verifyOperationalRestoreDatabase(db, manifest)).resolves.toMatchObject({
      migrationIdentity: manifest.migrationIdentity,
      pmObjects: [manifest.pmObjects[0]],
      history: { events: 1, races: 1, entries: 1, rawDeviceMessages: 1, cardReadouts: 1, resultRevisions: 1, auditEvents: 1, resultFinalizations: 1 },
    });
    const verifiedTargetVersions: string[] = [];
    const receipt = await verifyOperationalRestore(db, manifest, {
      async measure() { return manifest.postgresDump; }
    }, {
      async verify(candidate) {
        if (candidate.storeId !== pmObject.storeId || candidate.key !== pmObject.key || candidate.versionId !== pmObject.versionId || candidate.sha256 !== sha256 || candidate.byteLength !== 10) {
          throw new Error("Synthetic target PM mismatch");
        }
        verifiedTargetVersions.push(candidate.versionId);
      }
    });
    expect(receipt.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.verifiedPmObjectCount).toBe(1);
    expect(receipt.databaseEvidence.migrationIdentity).toBe(manifest.migrationIdentity);
    expect(verifiedTargetVersions).toEqual(["synthetic-version-1"]);
    await expect(verifyOperationalRestore(db, manifest, {
      async measure() { return manifest.postgresDump; }
    }, {
      async verify() { throw new Error("Synthetic target PM unavailable"); }
    })).rejects.toMatchObject({ code: "PM_OBJECT_VERIFICATION_FAILED" } satisfies Partial<OperationalRestoreVerificationError>);
    await expect(verifyOperationalRestoreDatabase(db, {
      ...manifest, pmObjects: [{ ...manifest.pmObjects[0], versionId: "synthetic-version-2" }],
    })).rejects.toMatchObject({ code: "PM_REFERENCE_MISMATCH" } satisfies Partial<OperationalRestoreVerificationError>);
  });

  const itWhenRestoreIsOptedIn = restoreTarget ? it : it.skip;
  itWhenRestoreIsOptedIn("återställer faktisk pg_dump -Fc till ny tom DB och verifierar den utan seed eller migration efteråt", async () => {
    if (!restoreTarget || !restoreDatabase || !pgBinDirectory || !sourceTarget || !syntheticChain) {
      throw new Error("TASK169_TEST_DATABASE_CONFIGURATION_INVALID");
    }
    const sourceMajor = await databaseMajor(db);
    const targetMajor = await databaseMajor(restoreDatabase.db);
    const pgDump = join(pgBinDirectory, "pg_dump");
    const pgRestore = join(pgBinDirectory, "pg_restore");
    expect(targetMajor).toBe(sourceMajor);
    expect(clientMajor(await runPostgresTool(pgDump, ["--version"], sourceTarget.toolEnvironment, true))).toBe(sourceMajor);
    expect(clientMajor(await runPostgresTool(pgRestore, ["--version"], restoreTarget.toolEnvironment, true))).toBe(sourceMajor);

    await assertDatabaseEmpty(restoreDatabase.db);
    const sourceIdentity = syntheticChain;
    const migrationIdentity = await readAppliedMigrationIdentity(db);
    const privateDirectory = await mkdtemp(join(tmpdir(), "otid-task169-restore-"));
    const dumpPath = join(privateDirectory, "synthetic-postgres.dump");
    const identity = `TASK169-synthetic-${randomUUID()}`;

    try {
      await chmod(privateDirectory, 0o700);
      const reservedDump = await open(dumpPath, "wx", 0o600);
      await reservedDump.close();
      await runPostgresTool(pgDump, ["--format=custom", "--file", dumpPath, "--dbname", sourceTarget.databaseName], sourceTarget.toolEnvironment);
      await chmod(dumpPath, 0o600);
      const dumpStat = await stat(dumpPath);
      expect(dumpStat.isFile()).toBe(true);
      expect(dumpStat.mode & 0o077).toBe(0);
      const measuredBeforeRestore = await measureDump(dumpPath, identity);

      await runPostgresTool(pgRestore, ["--list", dumpPath], restoreTarget.toolEnvironment);
      await runPostgresTool(pgRestore, [
        "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl",
        "--dbname", restoreTarget.databaseName, dumpPath,
      ], restoreTarget.toolEnvironment);

      const eventRows = await restoreDatabase.db.execute(sql`SELECT id FROM event WHERE id = ${sourceIdentity.eventId}`);
      const entryRows = await restoreDatabase.db.execute(sql`SELECT id FROM entry WHERE id = ${sourceIdentity.entryId}`);
      expect(eventRows.rows).toEqual([{ id: sourceIdentity.eventId }]);
      expect(entryRows.rows).toEqual([{ id: sourceIdentity.entryId }]);

      const manifest = {
        formatVersion: 1 as const,
        backupId: randomUUID(),
        createdAt: now.toISOString(),
        writeStopConfirmed: true as const,
        postgresDump: measuredBeforeRestore,
        migrationIdentity,
        pmObjects: [{
          storeId: sourceIdentity.storeId,
          key: sourceIdentity.key,
          versionId: sourceIdentity.versionId,
          sha256,
          byteLength: 10,
        }],
      };
      const measuredAfterRestore = await measureDump(dumpPath, identity);
      expect(measuredAfterRestore).toEqual(measuredBeforeRestore);
      const receipt = await verifyOperationalRestore(restoreDatabase.db, manifest, {
        async measure() { return measuredAfterRestore; },
      }, {
        async verify(candidate) {
          if (candidate.storeId !== sourceIdentity.storeId || candidate.key !== sourceIdentity.key ||
            candidate.versionId !== sourceIdentity.versionId || candidate.sha256 !== sha256 || candidate.byteLength !== 10) {
            throw new Error("TASK169_SYNTHETIC_PM_REFERENCE_MISMATCH");
          }
        },
      });
      expect(receipt.verifiedPmObjectCount).toBe(1);
      expect(receipt.databaseEvidence.migrationIdentity).toBe(migrationIdentity);
      expect(receipt.databaseEvidence.history).toEqual({
        events: 1, races: 1, entries: 1, rawDeviceMessages: 1, cardReadouts: 1,
        resultRevisions: 1, auditEvents: 1, resultFinalizations: 1,
      });
    } finally {
      await rm(privateDirectory, { recursive: true, force: true });
    }
  });
});
