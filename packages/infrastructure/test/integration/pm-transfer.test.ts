import { createHash, randomUUID } from "node:crypto";
import { Agent } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "minio";
import { createDatabase, schema } from "@o-tid/database";
import {
  createEvent,
  issuePairingAdminAccessCredential,
  loginPairingAdmin,
  reservePmDocumentAsAdmin,
  transferPmDocumentAsAdmin
} from "@o-tid/application";
import { pmObjectManifestSchema } from "@o-tid/contracts";
import { createPmObjectStore } from "../../src";

const databaseUrl = process.env.TEST_DATABASE_URL;
const endpointValue = process.env.OTID_MINIO_TEST_ENDPOINT;
const accessKey = process.env.OTID_MINIO_TEST_ACCESS_KEY;
const secretKey = process.env.OTID_MINIO_TEST_SECRET_KEY;
const confirmation = process.env.OTID_MINIO_TEST_CONFIRM;
if (!databaseUrl || !endpointValue || !accessKey || !secretKey || confirmation !== "isolated-disposable-minio") {
  throw new Error("Isolerad PM transfer-testkonfiguration krävs");
}

const endpoint = new URL(endpointValue);
if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port ||
  endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) {
  throw new Error("Isolerad PM transfer-testkonfiguration krävs");
}

const { db, pool } = createDatabase(databaseUrl);
const agent = new Agent({ keepAlive: false });
const bucket = `otid-pm-transfer-${randomUUID()}`;
const storeId = randomUUID();
const client = new Client({
  endPoint: endpoint.hostname,
  port: Number(endpoint.port),
  useSSL: false,
  region: "us-east-1",
  accessKey,
  secretKey,
  pathStyle: true,
  transportAgent: agent
});
const bytes = Buffer.from("%PDF-1.4\nsynthetic transfer fixture\n%%EOF\n", "utf8");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const now = new Date("2026-09-07T10:00:00.000Z");

const objectStore = createPmObjectStore({
  storeId,
  endpoint: endpoint.toString(),
  bucket,
  region: "us-east-1",
  accessKey,
  secretKey,
  mode: "loopback-development",
  deadlineMs: 2_000
});

beforeAll(async () => {
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
  await client.makeBucket(bucket, "us-east-1");
  await client.setBucketVersioning(bucket, { Status: "Enabled" });
});
afterAll(async () => { agent.destroy(); await pool.end(); });

async function* validBody(signal: AbortSignal): AsyncIterable<Uint8Array> {
  if (signal.aborted) throw new Error("Synthetic body aborted");
  yield bytes;
}

async function fixture() {
  const { race } = await createEvent(db, {
    name: "Synthetic PM transfer", raceName: "Synthetic", raceDate: "2026-09-07", timeZone: "Europe/Stockholm"
  });
  const installation = await issuePairingAdminAccessCredential(db, {
    raceId: race.id, capability: "MANAGE_PM_DOCUMENT", label: "Synthetic PM",
    expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000)
  }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential }, {
    now, expectedRaceId: race.id, expectedCapability: "MANAGE_PM_DOCUMENT"
  });
  if (login.status !== "authenticated") throw new Error("Synthetic PM login failed");
  const auth = { raceId: race.id, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  const reservation = await reservePmDocumentAsAdmin(db, {
    ...auth,
    idempotencyKey: `pm-upload:${randomUUID()}`,
    request: { formatVersion: 1, title: "Synthetic PM", mediaType: "application/pdf", sha256, byteLength: bytes.length }
  }, now);
  if (reservation.status !== "reserved") throw new Error("Synthetic PM reservation failed");
  return { race, auth, uploadId: reservation.response.uploadId };
}

describe("TASK013 actual isolated MinIO + PostgreSQL PM transfer", () => {
  it("stores one exact version with a pending job, then retries without another PUT and reads frozen bytes", async () => {
    const f = await fixture();
    let puts = 0;
    const store = {
      put: async (input: { raceId: string; attemptId: string; sha256: string; byteLength: number }, source: Uint8Array) => {
        puts++;
        return objectStore.put(input, source);
      }
    };
    const first = await transferPmDocumentAsAdmin(db, { ...f.auth, uploadId: f.uploadId, readBody: validBody }, store, () => now);
    expect(first.status).toBe("stored");
    if (first.status !== "stored") throw new Error("Synthetic PM transfer failed");
    expect(first.response.replayed).toBe(false);
    expect(puts).toBe(1);

    const [manifest] = await db.select().from(schema.pmObjectManifests).where(eq(schema.pmObjectManifests.uploadId, f.uploadId));
    const [job] = await db.select().from(schema.pmScanJobs).where(eq(schema.pmScanJobs.uploadId, f.uploadId));
    const attempts = await db.select().from(schema.pmUploadAttempts).where(eq(schema.pmUploadAttempts.uploadId, f.uploadId));
    expect(manifest).toBeDefined();
    expect(job).toMatchObject({ uploadId: f.uploadId, state: "PENDING", generation: 0n, leaseOwner: null, leaseUntil: null });
    expect(attempts).toHaveLength(1);

    const replay = await transferPmDocumentAsAdmin(db, {
      ...f.auth,
      uploadId: f.uploadId,
      readBody: () => { throw new Error("Retry body must not be read"); }
    }, store, () => now);
    expect(replay).toMatchObject({ status: "stored", response: { replayed: true, uploadId: f.uploadId } });
    expect(puts).toBe(1);
    expect((await db.select().from(schema.pmUploadAttempts).where(eq(schema.pmUploadAttempts.uploadId, f.uploadId)))).toHaveLength(1);

    const frozen = pmObjectManifestSchema.parse({
      formatVersion: 1,
      storeId: manifest!.storeId,
      key: manifest!.objectKey,
      versionId: manifest!.versionId,
      sha256: manifest!.sha256,
      byteLength: manifest!.byteLength
    });
    await expect(objectStore.read(frozen)).resolves.toEqual(bytes);
  });
});
