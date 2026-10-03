import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase, schema, type Database } from "@o-tid/database";
import { createEvent, issuePairingAdminAccessCredential, loginPairingAdmin, revokePairingAdminAccessCredential,
  reservePmDocumentAsAdmin, transferPmDocumentAsAdmin, type PmUploadObjectStore } from "../../src";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-07T10:00:00Z"), bytes = Buffer.from("Synthetic storage bytes, not scanned PDF");
const hash = createHash("sha256").update(bytes).digest("hex");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());
async function fixture() {
  const { race } = await createEvent(db, { name: "Synthetic transfer", raceName: "Synthetic", raceDate: "2026-09-07", timeZone: "Europe/Stockholm" });
  const installation = await issuePairingAdminAccessCredential(db, { raceId: race.id, capability: "MANAGE_PM_DOCUMENT", label: "Synthetic", expiresAt: new Date(now.getTime() + 3600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential }, { now, expectedRaceId: race.id, expectedCapability: "MANAGE_PM_DOCUMENT" });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  const auth = { raceId: race.id, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  const reserved = await reservePmDocumentAsAdmin(db, { ...auth, idempotencyKey: `pm-upload:${randomUUID()}`,
    request: { formatVersion: 1, title: "Synthetic", mediaType: "application/pdf", sha256: hash, byteLength: bytes.length } }, now);
  if (reserved.status !== "reserved") throw new Error("Synthetic reservation failed");
  return { installation, input: { ...auth, uploadId: reserved.response.uploadId, readBody: body } };
}
async function* body() { yield bytes.subarray(0, 7); yield bytes.subarray(7); }
// Explicit storage double: these tests prove real PG orchestration, never MinIO or PDF validity.
function storage(afterPut?: () => Promise<void>) {
  let calls = 0;
  const store: PmUploadObjectStore = { async put(input, content) {
    calls++; expect(Buffer.from(content)).toEqual(bytes);
    await afterPut?.();
    return { formatVersion: 1, storeId: randomUUID(), key: `pm/${input.raceId}/${input.attemptId}`,
      versionId: "synthetic-version", sha256: input.sha256, byteLength: input.byteLength };
  } };
  return { store, calls: () => calls };
}
async function rows(uploadId: string) {
  return { attempts: await db.select().from(schema.pmUploadAttempts).where(eq(schema.pmUploadAttempts.uploadId, uploadId)),
    manifests: await db.select().from(schema.pmObjectManifests).where(eq(schema.pmObjectManifests.uploadId, uploadId)),
    jobs: await db.select().from(schema.pmScanJobs).where(eq(schema.pmScanJobs.uploadId, uploadId)) };
}
describe("TASK013 PG transfer orchestration with explicit storage double", () => {
  it("commits manifest and pending job once, then retries without reading body or PUT", async () => {
    const f = await fixture(), s = storage();
    const result = await transferPmDocumentAsAdmin(db, f.input, s.store, () => now);
    expect(result.status).toBe("stored");
    const retry = await transferPmDocumentAsAdmin(db, { ...f.input, readBody: () => { throw new Error("Retry must not read body"); } }, s.store, () => now);
    expect(retry.status).toBe("stored"); expect(s.calls()).toBe(1);
    if (result.status !== "stored" || retry.status !== "stored") throw new Error("Missing receipt");
    expect(retry.response).toEqual({ ...result.response, replayed: true });
    const saved = await rows(f.input.uploadId);
    expect(saved.attempts).toHaveLength(1); expect(saved.manifests).toHaveLength(1);
    expect(saved.jobs).toHaveLength(1); expect(saved.jobs[0]?.state).toBe("PENDING");
  });
  it("rejects corrupt, oversized and truncated streams before PUT but preserves charges", async () => {
    const f = await fixture(), s = storage();
    for (const content of [Buffer.alloc(bytes.length), Buffer.alloc(bytes.length + 1), bytes.subarray(1)]) {
      const result = await transferPmDocumentAsAdmin(db, { ...f.input, readBody: async function* () { yield content; } }, s.store, () => now);
      expect(result.status).toBe("invalid-body");
    }
    expect(s.calls()).toBe(0);
    const saved = await rows(f.input.uploadId);
    expect(saved.attempts).toHaveLength(3); expect(saved.manifests).toHaveLength(0); expect(saved.jobs).toHaveLength(0);
  });
  it("does not read body with missing authority", async () => {
    const f = await fixture(), s = storage();
    const result = await transferPmDocumentAsAdmin(db, { ...f.input, sessionToken: null, readBody: () => { throw new Error("Unauthorized body read"); } }, s.store, () => now);
    expect(result.status).toBe("unauthorized"); expect(s.calls()).toBe(0);
    expect((await rows(f.input.uploadId)).attempts).toHaveLength(0);
  });
  it("aborts a stalled body at the total read deadline and never performs PUT", async () => {
    const f = await fixture(), s = storage(); let signal: AbortSignal | undefined;
    const result = await transferPmDocumentAsAdmin(db, { ...f.input, readBody: async function* (inputSignal) {
      signal = inputSignal;
      await new Promise<void>(resolve => inputSignal.addEventListener("abort", () => resolve(), { once: true }));
      yield bytes;
    } }, s.store, () => now);
    expect(result.status).toBe("invalid-body"); expect(signal?.aborted).toBe(true); expect(s.calls()).toBe(0);
    expect((await rows(f.input.uploadId)).manifests).toHaveLength(0);
  }, 40_000);
  it("preserves an uncertain PUT charge and allocates a different attempt for the next PUT", async () => {
    const f = await fixture(), ids: string[] = [];
    const failed: PmUploadObjectStore = { async put(input) { ids.push(input.attemptId); throw new Error("Sensitive SDK detail"); } };
    expect(await transferPmDocumentAsAdmin(db, f.input, failed, () => now)).toEqual({ status: "storage-unavailable" });
    expect(await transferPmDocumentAsAdmin(db, f.input, failed, () => now)).toEqual({ status: "storage-unavailable" });
    expect(new Set(ids).size).toBe(2);
    const saved = await rows(f.input.uploadId); expect(saved.attempts).toHaveLength(2); expect(saved.manifests).toHaveLength(0);
  });
  it("does not accept a malformed or cross-attempt storage manifest", async () => {
    const f = await fixture();
    const wrong: PmUploadObjectStore = { async put(input) { return { formatVersion: 1, storeId: randomUUID(),
      key: `pm/${input.raceId}/${randomUUID()}`, versionId: "v1", sha256: input.sha256, byteLength: input.byteLength }; } };
    expect((await transferPmDocumentAsAdmin(db, f.input, wrong, () => now)).status).toBe("storage-unavailable");
    expect((await rows(f.input.uploadId)).manifests).toHaveLength(0);
  });
  it("rechecks revocation after PUT without holding authorization locks over network", async () => {
    const f = await fixture();
    const s = storage(async () => { await revokePairingAdminAccessCredential(db, { credentialId: f.installation.credentialId, capability: "MANAGE_PM_DOCUMENT" }, now); });
    expect((await transferPmDocumentAsAdmin(db, f.input, s.store, () => now)).status).toBe("unauthorized");
    const saved = await rows(f.input.uploadId); expect(saved.attempts).toHaveLength(1); expect(saved.manifests).toHaveLength(0);
  });
  it("uses current time again after PUT and rejects expired sessions", async () => {
    const f = await fixture(); let current = now;
    const s = storage(async () => { current = new Date("2026-09-07T11:00:00Z"); });
    expect((await transferPmDocumentAsAdmin(db, f.input, s.store, () => current)).status).toBe("unauthorized");
    expect((await rows(f.input.uploadId)).manifests).toHaveLength(0);
  });
  it("chooses only one concurrent manifest and one job, leaving losing objects private", async () => {
    const f = await fixture(); let arrived = 0; let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const s = storage(async () => { if (++arrived === 2) release(); await gate; });
    const results = await Promise.all([transferPmDocumentAsAdmin(db, f.input, s.store, () => now), transferPmDocumentAsAdmin(db, f.input, s.store, () => now)]);
    expect(results.map(result => result.status)).toEqual(["stored", "stored"]);
    const saved = await rows(f.input.uploadId);
    expect(saved.attempts).toHaveLength(2); expect(saved.manifests).toHaveLength(1); expect(saved.jobs).toHaveLength(1);
  });
  it("rolls back manifest and job on a final transaction failure, preserving the earlier charge", async () => {
    const f = await fixture(), s = storage();
    // First transaction (charge) commits; reject only the second transaction after its writes.
    let transactions = 0;
    const wrapped = Object.create(db) as Database;
    wrapped.transaction = async (operation, config) => db.transaction(async tx => {
      const result = await operation(tx);
      if (++transactions === 2) throw new Error("Synthetic final commit failure");
      return result;
    }, config);
    await expect(transferPmDocumentAsAdmin(wrapped, f.input, s.store, () => now)).rejects.toThrow("Synthetic final commit failure");
    const saved = await rows(f.input.uploadId);
    expect(saved.attempts).toHaveLength(1); expect(saved.manifests).toHaveLength(0); expect(saved.jobs).toHaveLength(0);
  });
});
