import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { pmObjectManifestSchema, pmDocumentStorageReceiptSchema } from "@o-tid/contracts";
import { allocatePmUploadAttemptAsAdmin } from "./pm-document-upload";
import { authenticatePairingAdminSessionForMutation, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { lockRaceForMutation } from "./concurrency";

/** Trusted composition only. Production uses the MinIO adapter, never request-selected implementations. */
export interface PmUploadObjectStore {
  put(input: { raceId: string; attemptId: string; sha256: string; byteLength: number }, bytes: Uint8Array): Promise<unknown>;
}
type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
type ManifestRow = typeof schema.pmObjectManifests.$inferSelect;
const capability = "MANAGE_PM_DOCUMENT" as const;
function receipt(row: ManifestRow, replayed: boolean) {
  return pmDocumentStorageReceiptSchema.parse({ formatVersion: 1, uploadId: row.uploadId,
    raceId: row.raceId, storedAt: row.storedAt.toISOString(), replayed });
}

async function readBytes(readBody: (signal: AbortSignal) => AsyncIterable<Uint8Array>, length: number): Promise<Buffer> {
  const controller = new AbortController();
  const expiresAt = performance.now() + 30_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("PM_BODY_DEADLINE")); }, 30_000);
  });
  try {
    // The HTTP reader must honor abort and release its stream; no request body is read before allocation.
    const iterator = readBody(controller.signal)[Symbol.asyncIterator]();
    const bytes = Buffer.alloc(length);
    let size = 0;
    while (true) {
      if (performance.now() >= expiresAt) throw new Error("PM_BODY_DEADLINE");
      const part = await Promise.race([iterator.next(), deadline]);
      if (part.done) break;
      if (!(part.value instanceof Uint8Array) || size + part.value.byteLength > length) throw new Error("PM_BODY_SIZE");
      bytes.set(part.value, size);
      size += part.value.byteLength;
    }
    if (size !== length) throw new Error("PM_BODY_SIZE");
    return bytes;
  } finally { clearTimeout(timer); controller.abort(); }
}

/** No public route until the actual HTTP reader, limiter, scanner and end-to-end tests are in place. */
export async function transferPmDocumentAsAdmin(db: Database,
  input: Authentication & { uploadId: string; readBody: (signal: AbortSignal) => AsyncIterable<Uint8Array> },
  store: PmUploadObjectStore, clock: () => Date = () => new Date()
) {
  const allocation = await allocatePmUploadAttemptAsAdmin(db, input, clock());
  if (allocation.status === "already-stored") return { status: "stored" as const, response: receipt(allocation.manifest, true) };
  if (allocation.status !== "allocated") return allocation;
  const attempt = allocation.attempt;
  let bytes: Buffer;
  try {
    bytes = await readBytes(input.readBody, attempt.byteLength);
    if (createHash("sha256").update(bytes).digest("hex") !== attempt.sha256) return { status: "invalid-body" as const };
  } catch { return { status: "invalid-body" as const }; }
  let result: unknown;
  try {
    result = await store.put({ raceId: attempt.raceId, attemptId: attempt.id,
      sha256: attempt.sha256, byteLength: attempt.byteLength }, bytes);
  } catch { return { status: "storage-unavailable" as const }; }
  const parsed = pmObjectManifestSchema.safeParse(result);
  if (!parsed.success || parsed.data.key !== `pm/${attempt.raceId}/${attempt.id}` ||
    parsed.data.sha256 !== attempt.sha256 || parsed.data.byteLength !== attempt.byteLength) {
    return { status: "storage-unavailable" as const };
  }
  const manifest = parsed.data;
  return db.transaction(async tx => {
    const now = clock();
    const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    await lockRaceForMutation(tx, input.raceId);
    const [reservation] = await tx.select().from(schema.pmUploadReservations).where(and(
      eq(schema.pmUploadReservations.id, input.uploadId), eq(schema.pmUploadReservations.raceId, input.raceId),
      eq(schema.pmUploadReservations.actorCredentialId, auth.principal.accessCredentialId)
    ));
    if (!reservation) return { status: "not-found" as const };
    const [existing] = await tx.select().from(schema.pmObjectManifests).where(eq(schema.pmObjectManifests.uploadId, input.uploadId));
    if (existing) return { status: "stored" as const, response: receipt(existing, true) };
    const [saved] = await tx.insert(schema.pmObjectManifests).values({
      uploadId: input.uploadId, attemptId: attempt.id, raceId: input.raceId, storeId: manifest.storeId,
      objectKey: manifest.key, versionId: manifest.versionId, sha256: manifest.sha256,
      byteLength: manifest.byteLength, storedAt: now
    }).returning();
    if (!saved) throw new Error("PM_MANIFEST_NOT_STORED");
    await tx.insert(schema.pmScanJobs).values({ uploadId: saved.uploadId, createdAt: now });
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "pm_upload", entityId: input.uploadId,
      action: "PM_UPLOAD_STORED", actorKind: "PAIRING_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId,
      after: { capability, attemptId: attempt.id, byteLength: manifest.byteLength, sha256: manifest.sha256 } });
    return { status: "stored" as const, response: receipt(saved, false) };
  }, { isolationLevel: "read committed" });
}
