import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { pmDocumentUploadRequestSchema, pmDocumentUploadIdempotencyKeySchema, pmDocumentReservationResponseSchema } from "@o-tid/contracts";
import { authenticatePairingAdminSessionForMutation, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { lockRaceForMutation } from "./concurrency";

type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
const capability = "MANAGE_PM_DOCUMENT" as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function response(row: typeof schema.pmUploadReservations.$inferSelect, replayed: boolean) {
  return pmDocumentReservationResponseSchema.parse({ formatVersion: 1, uploadId: row.id,
    requestId: row.requestId, raceId: row.raceId, replayed, reservedAt: row.reservedAt.toISOString() });
}

export async function reservePmDocumentAsAdmin(db: Database,
  input: Authentication & { idempotencyKey: string | null; request: unknown }, now = new Date()
) {
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const key = pmDocumentUploadIdempotencyKeySchema.safeParse(input.idempotencyKey);
    const request = pmDocumentUploadRequestSchema.safeParse(input.request);
    if (!key.success || !request.success) return { status: "invalid-request" as const };
    await lockRaceForMutation(tx, input.raceId);
    const requestId = key.data.slice("pm-upload:".length), intent = request.data;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existing] = await tx.select().from(schema.pmUploadReservations).where(eq(schema.pmUploadReservations.requestId, requestId));
    if (existing) {
      if (existing.raceId !== input.raceId || existing.actorCredentialId !== auth.principal.accessCredentialId ||
        existing.title !== intent.title || existing.mediaType !== intent.mediaType || existing.sha256 !== intent.sha256 ||
        existing.byteLength !== intent.byteLength) return { status: "conflict" as const };
      return { status: "reserved" as const, response: response(existing, true) };
    }
    const slots = await tx.select({ slot: schema.pmUploadReservations.slot }).from(schema.pmUploadReservations)
      .where(eq(schema.pmUploadReservations.raceId, input.raceId));
    const occupied = new Set(slots.map(row => row.slot));
    let slot = 1;
    while (occupied.has(slot) && slot <= 100) slot++;
    if (slot > 100) return { status: "quota-exceeded" as const };
    const [saved] = await tx.insert(schema.pmUploadReservations).values({
      id: randomUUID(), requestId, raceId: input.raceId, actorCredentialId: auth.principal.accessCredentialId,
      capability, slot, title: intent.title, mediaType: intent.mediaType, sha256: intent.sha256,
      byteLength: intent.byteLength, reservedAt: now
    }).returning();
    if (!saved) throw new Error("PM_RESERVATION_NOT_STORED");
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "pm_upload", entityId: saved.id,
      action: "PM_UPLOAD_RESERVED", actorKind: "PAIRING_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId,
      requestId, after: { capability, slot, byteLength: saved.byteLength, sha256: saved.sha256 } });
    return { status: "reserved" as const, response: response(saved, false) };
  }, { isolationLevel: "read committed" });
}

/** Server-internal: each successful allocation charges a NEW possible PUT, never replay a PUT with this id. */
export async function allocatePmUploadAttemptAsAdmin(db: Database,
  input: Authentication & { uploadId: string }, now = new Date()
) {
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    if (!uuid.test(input.uploadId)) return { status: "invalid-request" as const };
    await lockRaceForMutation(tx, input.raceId);
    const [reservation] = await tx.select().from(schema.pmUploadReservations).where(and(
      eq(schema.pmUploadReservations.id, input.uploadId), eq(schema.pmUploadReservations.raceId, input.raceId),
      eq(schema.pmUploadReservations.actorCredentialId, auth.principal.accessCredentialId)
    ));
    if (!reservation) return { status: "not-found" as const };
    const [manifest] = await tx.select().from(schema.pmObjectManifests).where(eq(schema.pmObjectManifests.uploadId, input.uploadId));
    if (manifest) return { status: "already-stored" as const, manifest };
    const attempts = await tx.select({ number: schema.pmUploadAttempts.attemptNumber }).from(schema.pmUploadAttempts)
      .where(eq(schema.pmUploadAttempts.uploadId, input.uploadId));
    const occupied = new Set(attempts.map(row => row.number));
    let number = 1;
    while (occupied.has(number) && number <= 8) number++;
    if (number > 8) return { status: "quota-exceeded" as const };
    const [attempt] = await tx.insert(schema.pmUploadAttempts).values({
      id: randomUUID(), uploadId: reservation.id, raceId: input.raceId, attemptNumber: number,
      sha256: reservation.sha256, byteLength: reservation.byteLength, chargedAt: now
    }).returning();
    if (!attempt) throw new Error("PM_ATTEMPT_NOT_STORED");
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "pm_upload_attempt", entityId: attempt.id,
      action: "PM_UPLOAD_ATTEMPT_CHARGED", actorKind: "PAIRING_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId,
      after: { capability, uploadId: reservation.id, attemptNumber: number, byteLength: attempt.byteLength } });
    return { status: "allocated" as const, attempt };
  }, { isolationLevel: "read committed" });
}
