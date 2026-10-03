import { and, eq, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import {
  entryPaymentStatusChangeIdempotencyKeySchema,
  entryPaymentStatusChangeRequestSchema,
  entryPaymentStatusChangeResponseSchema
} from "@o-tid/contracts";
import { authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation,
  type PairingAdminRequestAuthentication } from "./pairing-admin";
import { lockRaceForMutation } from "./concurrency";

type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
const capability = "MANAGE_RACE" as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const maxVersion = 2_147_483_647;

function receipt(row: typeof schema.entryPaymentStatusChanges.$inferSelect, replayed: boolean) {
  return entryPaymentStatusChangeResponseSchema.parse({
    formatVersion: 1, replayed, requestId: row.requestId, raceId: row.raceId,
    entryId: row.entryId, classId: row.classId,
    previousPaymentStatus: row.previousPaymentStatus, paymentStatus: row.paymentStatus,
    entryVersionAtChange: row.entryVersionAtChange,
    paymentStatusVersionBefore: row.paymentStatusVersionBefore,
    paymentStatusVersionAfter: row.paymentStatusVersionAfter,
    changedAt: row.changedAt.toISOString()
  });
}

/** Changes only private administrative payment state; it never changes public race state. */
export async function changeEntryPaymentStatusAsAdministrator(
  db: Database,
  input: Authentication & { entryId: string; idempotencyKey: string | null; request: unknown },
  now = new Date()
) {
  const key = entryPaymentStatusChangeIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const parsed = entryPaymentStatusChangeRequestSchema.safeParse(input.request);
  if (!key.success || !parsed.success || !uuid.test(input.raceId) || !uuid.test(input.entryId)) {
    return { status: "invalid-request" as const };
  }
  const requestId = key.data.slice("entry-payment-status-change:".length);
  const intent = parsed.data;
  const authentication = { ...input, capability, requireCsrf: true };
  const preflight = await authenticatePairingAdminSession(db, authentication, now);
  if (preflight.status !== "authenticated") return preflight;

  return db.transaction(async (tx) => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (auth.status !== "authenticated") return auth;
    await lockRaceForMutation(tx, input.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existing] = await tx.select().from(schema.entryPaymentStatusChanges)
      .where(eq(schema.entryPaymentStatusChanges.requestId, requestId));
    if (existing) {
      if (existing.raceId !== input.raceId || existing.entryId !== input.entryId ||
          existing.actorCredentialId !== auth.principal.accessCredentialId || existing.classId !== intent.expectedClassId ||
          existing.entryVersionAtChange !== intent.expectedEntryVersion ||
          existing.previousPaymentStatus !== intent.expectedPaymentStatus ||
          existing.paymentStatusVersionBefore !== intent.expectedPaymentStatusVersion ||
          existing.paymentStatus !== intent.paymentStatus) return { status: "conflict" as const };
      return { status: "changed" as const, response: receipt(existing, true) };
    }
    const [entry] = await tx.select().from(schema.entries).where(and(
      eq(schema.entries.id, input.entryId), eq(schema.entries.raceId, input.raceId)
    )).for("update");
    if (!entry) return { status: "not-found" as const };
    if (entry.version !== intent.expectedEntryVersion || entry.classId !== intent.expectedClassId ||
        entry.paymentStatus !== intent.expectedPaymentStatus ||
        entry.paymentStatusVersion !== intent.expectedPaymentStatusVersion ||
        entry.paymentStatusVersion >= maxVersion || entry.paymentStatus === intent.paymentStatus) {
      return { status: "conflict" as const };
    }
    const paymentStatusVersionAfter = entry.paymentStatusVersion + 1;
    await tx.update(schema.entries).set({ paymentStatus: intent.paymentStatus, paymentStatusVersion: paymentStatusVersionAfter })
      .where(eq(schema.entries.id, entry.id));
    const [saved] = await tx.insert(schema.entryPaymentStatusChanges).values({
      requestId, raceId: input.raceId, entryId: entry.id, classId: entry.classId,
      actorCredentialId: auth.principal.accessCredentialId, capability,
      previousPaymentStatus: entry.paymentStatus, paymentStatus: intent.paymentStatus,
      entryVersionAtChange: entry.version,
      paymentStatusVersionBefore: entry.paymentStatusVersion, paymentStatusVersionAfter, changedAt: now
    }).returning();
    if (!saved) throw new Error("Betalstatusjournalen kunde inte sparas");
    await tx.insert(schema.auditEvents).values({
      raceId: input.raceId, entityType: "entry", entityId: entry.id,
      action: "ENTRY_PAYMENT_STATUS_CHANGED_BY_ADMIN", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL",
      actorId: auth.principal.accessCredentialId, requestId,
      before: { paymentStatus: entry.paymentStatus, paymentStatusVersion: entry.paymentStatusVersion, entryVersion: entry.version },
      after: { paymentStatus: intent.paymentStatus, paymentStatusVersion: paymentStatusVersionAfter, entryVersion: entry.version }
    });
    return { status: "changed" as const, response: receipt(saved, false) };
  });
}
