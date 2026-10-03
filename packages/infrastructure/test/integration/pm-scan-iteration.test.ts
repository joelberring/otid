import { createHash, randomUUID } from "node:crypto";
import { Agent } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "minio";
import { createDatabase, schema } from "@o-tid/database";
import {
  createEvent, issuePairingAdminAccessCredential, loginPairingAdmin,
  reservePmDocumentAsAdmin, transferPmDocumentAsAdmin, runPmScanIteration
} from "@o-tid/application";
import { canonicalJsonBytes, pmObjectManifestSchema, pmScanEvidenceSchema, type PmScanEvidence } from "@o-tid/contracts";
import { createNativePmScannerProbe, createPmObjectStore } from "../../src";

const databaseUrl = process.env.TEST_DATABASE_URL;
const endpointValue = process.env.OTID_MINIO_TEST_ENDPOINT;
const accessKey = process.env.OTID_MINIO_TEST_ACCESS_KEY;
const secretKey = process.env.OTID_MINIO_TEST_SECRET_KEY;
const root = process.env.OTID_PM_NATIVE_SCANNER_ROOT;
if (!databaseUrl || !endpointValue || !accessKey || !secretKey || !root ||
  process.env.OTID_MINIO_TEST_CONFIRM !== "isolated-disposable-minio") {
  throw new Error("Explicit isolated PostgreSQL/MinIO and OTID_PM_NATIVE_SCANNER_ROOT are required");
}
const endpoint = new URL(endpointValue);
if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port ||
  endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) {
  throw new Error("Isolated loopback MinIO configuration required");
}
const scanner = createNativePmScannerProbe({ mode: "native-compatibility-probe", root });
const { db, pool } = createDatabase(databaseUrl);
const agent = new Agent({ keepAlive: false });
const bucket = `otid-pm-scan-${randomUUID()}`;
const client = new Client({ endPoint: endpoint.hostname, port: Number(endpoint.port), useSSL: false,
  region: "us-east-1", accessKey, secretKey, pathStyle: true, transportAgent: agent });
const objectStore = createPmObjectStore({ storeId: randomUUID(), endpoint: endpoint.toString(), bucket,
  region: "us-east-1", accessKey, secretKey, mode: "loopback-development", deadlineMs: 10_000 });
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

beforeAll(async () => {
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
  await client.makeBucket(bucket, "us-east-1");
  await client.setBucketVersioning(bucket, { Status: "Enabled" });
});
afterAll(async () => { agent.destroy(); await pool.end(); });

/** Independently generated one-page PDF; offsets refer to the exact ASCII bytes. */
function syntheticPdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>"
  ];
  let document = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document, "ascii"));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(document, "ascii");
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) document += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document, "ascii");
}

async function upload(bytes: Buffer) {
  const now = new Date();
  const { race } = await createEvent(db, { name: "Synthetic native PM scan", raceName: "Synthetic",
    raceDate: now.toISOString().slice(0, 10), timeZone: "Europe/Stockholm" });
  const installation = await issuePairingAdminAccessCredential(db, { raceId: race.id,
    capability: "MANAGE_PM_DOCUMENT", label: "Synthetic native scan", expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential },
    { now, expectedRaceId: race.id, expectedCapability: "MANAGE_PM_DOCUMENT" });
  if (login.status !== "authenticated") throw new Error("Synthetic PM login failed");
  const auth = { raceId: race.id, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  const reservation = await reservePmDocumentAsAdmin(db, { ...auth, idempotencyKey: `pm-upload:${randomUUID()}`,
    request: { formatVersion: 1, title: "Synthetic native PM", mediaType: "application/pdf", sha256: hash(bytes), byteLength: bytes.length } }, now);
  if (reservation.status !== "reserved") throw new Error("Synthetic PM reservation failed");
  const uploadId = reservation.response.uploadId;
  const stored = await transferPmDocumentAsAdmin(db, { ...auth, uploadId,
    async *readBody(signal) { signal.throwIfAborted(); yield bytes; } }, objectStore);
  expect(stored).toMatchObject({ status: "stored", response: { uploadId, replayed: false } });
  const [row] = await db.select().from(schema.pmObjectManifests).where(eq(schema.pmObjectManifests.uploadId, uploadId));
  if (!row) throw new Error("Synthetic PM manifest missing");
  const manifest = pmObjectManifestSchema.parse({ formatVersion: 1, storeId: row.storeId, key: row.objectKey,
    versionId: row.versionId, sha256: row.sha256, byteLength: row.byteLength });
  return { uploadId, manifest };
}

describe("TASK013 actual PostgreSQL + MinIO + native qpdf/ClamAV iteration; never production isolation", () => {
  it("persists exact real evidence from the stored PDF version and cannot scan a finished job again", async () => {
    const bytes = syntheticPdf(), f = await upload(bytes);
    let reads = 0, scans = 0;
    let observation: PmScanEvidence | undefined;
    const ports = {
      async read(manifest: typeof f.manifest, signal: AbortSignal) {
        reads++;
        expect(manifest).toEqual(f.manifest);
        signal.throwIfAborted();
        const result = await objectStore.read(manifest, signal);
        signal.throwIfAborted();
        expect(result).toEqual(bytes);
        return result;
      },
      async scan(input: Parameters<typeof scanner.scan>[0]) {
        scans++;
        observation = pmScanEvidenceSchema.parse(await scanner.scan(input));
        return observation;
      }
    };
    const first = await runPmScanIteration(db, { workerId: randomUUID(), uploadId: f.uploadId }, ports);
    expect(first).toMatchObject({ status: "recorded", outcome: "PASSED", publishable: false, replayed: false });
    expect(observation).toMatchObject({ executionProfile: "native-probe-v1", manifest: f.manifest,
      contentVerified: true, cleanupSucceeded: true, qpdf: { encryption: { exitCode: 2 }, check: { exitCode: 0 } },
      clamav: { run: { exitCode: 0 }, summary: { scannedFiles: 1, infectedFiles: 0 }, databases: { signaturesVerified: true } } });
    const reports = await db.select().from(schema.pmScanReports).where(eq(schema.pmScanReports.uploadId, f.uploadId));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ outcome: "PASSED", publishable: false, evidence: observation });
    expect(reports[0]!.contentHash).toBe(hash(canonicalJsonBytes(observation)));
    const [job] = await db.select().from(schema.pmScanJobs).where(eq(schema.pmScanJobs.uploadId, f.uploadId));
    expect(job).toMatchObject({ state: "FINISHED", generation: 1n, leaseOwner: null, leaseUntil: null });
    expect(await runPmScanIteration(db, { workerId: randomUUID(), uploadId: f.uploadId }, ports)).toEqual({ status: "no-job" });
    expect({ reads, scans }).toEqual({ reads: 1, scans: 1 });
    expect(await db.select().from(schema.pmScanReports).where(eq(schema.pmScanReports.uploadId, f.uploadId))).toEqual(reports);
    await expect(objectStore.read(f.manifest)).resolves.toEqual(bytes);
  }, 290_000);

  it("records the actual malformed-PDF engine failure without an invented antivirus result", async () => {
    const f = await upload(Buffer.from("%PDF-1.4\nintentionally truncated synthetic PDF\n", "ascii"));
    const result = await runPmScanIteration(db, { workerId: randomUUID(), uploadId: f.uploadId }, {
      async read(manifest, signal) { signal.throwIfAborted(); const bytes = await objectStore.read(manifest, signal); signal.throwIfAborted(); return bytes; },
      scan: input => scanner.scan(input)
    });
    expect(result).toMatchObject({ status: "recorded", outcome: "FAILED", publishable: false });
    const [report] = await db.select().from(schema.pmScanReports).where(eq(schema.pmScanReports.uploadId, f.uploadId));
    expect(report).toMatchObject({ outcome: "FAILED", publishable: false,
      evidence: { manifest: f.manifest, contentVerified: true, cleanupSucceeded: true,
        qpdf: { encryption: { hasErrors: true }, check: null }, clamav: null } });
    const [job] = await db.select().from(schema.pmScanJobs).where(eq(schema.pmScanJobs.uploadId, f.uploadId));
    expect(job).toMatchObject({ state: "FINISHED", generation: 1n, leaseOwner: null, leaseUntil: null });
  }, 290_000);
});
