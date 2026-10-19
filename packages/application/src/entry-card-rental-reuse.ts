import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { entryCardRentalReuseIdempotencyKeySchema, entryCardRentalReuseRequestSchema,
  entryCardRentalReuseResponseSchema } from "@o-tid/contracts";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { lockRaceForMutation } from "./concurrency";
import { bumpReadoutPackageVersion } from "./snapshot";
import { UUID_PATTERN as uuid } from "./serialization";

type Authentication = RaceSessionProof;
const maxVersion = 2_147_483_647;

function receipt(row: typeof schema.entryCardRentalReuseRequests.$inferSelect, replayed: boolean) {
  return entryCardRentalReuseResponseSchema.parse({
    formatVersion: 1, replayed, requestId: row.requestId, raceId: row.raceId,
    source: { entryId: row.sourceEntryId, classId: row.sourceClassId,
      assignment: { id: row.sourceAssignmentId, cardNumber: row.cardNumber } },
    target: { entryId: row.targetEntryId, classId: row.targetClassId,
      assignment: { id: row.targetAssignmentId, cardNumber: row.cardNumber, isRental: true, rentalReturned: false } },
    sourceEntryVersionBefore: row.sourceEntryVersionBefore, sourceEntryVersionAfter: row.sourceEntryVersionAfter,
    targetEntryVersionBefore: row.targetEntryVersionBefore, targetEntryVersionAfter: row.targetEntryVersionAfter,
    snapshotVersionBefore: row.snapshotVersionBefore, snapshotVersionAfter: row.snapshotVersionAfter,
    changedAt: row.changedAt.toISOString()
  });
}

export async function reuseReturnedRentalCardAsAdmin(db: Database,
  input: Authentication & { entryId: string; idempotencyKey: string | null; request: unknown }, now = new Date()) {
  const key = entryCardRentalReuseIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const parsed = entryCardRentalReuseRequestSchema.safeParse(input.request);
  if (!key.success || !parsed.success || !uuid.test(input.raceId) || !uuid.test(input.entryId)) {
    return { status: "invalid-request" as const };
  }
  const intent = parsed.data;
  const requestId = key.data.slice("entry-card-rental-reuse:".length);
  const authentication = { ...input, role: "ADMIN" as const, requireCsrf: true };
  const preflight = await requireRaceRole(db, authentication, now);
  if (preflight.status !== "authenticated") return preflight;
  return db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, authentication, now, "update");
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForMutation(tx, input.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existing] = await tx.select().from(schema.entryCardRentalReuseRequests)
      .where(eq(schema.entryCardRentalReuseRequests.requestId, requestId));
    if (existing) {
      if (existing.raceId !== input.raceId || existing.targetEntryId !== input.entryId ||
        existing.actorAccountId !== auth.principal.accountId ||
        existing.sourceEntryId !== intent.source.entryId || existing.sourceClassId !== intent.source.classId ||
        existing.sourceAssignmentId !== intent.source.assignment.id || existing.cardNumber !== intent.source.assignment.cardNumber ||
        existing.sourceEntryVersionBefore !== intent.source.entryVersion ||
        existing.targetClassId !== intent.expectedTargetClassId ||
        existing.targetEntryVersionBefore !== intent.expectedTargetEntryVersion) return { status: "conflict" as const };
      return { status: "changed" as const, response: receipt(existing, true) };
    }
    if (intent.source.entryId === input.entryId ||
      race.snapshotVersion >= maxVersion) return { status: "conflict" as const };
    const entries = await tx.select().from(schema.entries).where(and(eq(schema.entries.raceId, input.raceId),
      inArray(schema.entries.id, [intent.source.entryId, input.entryId]))).orderBy(asc(schema.entries.id)).for("update");
    const source = entries.find((row) => row.id === intent.source.entryId);
    const target = entries.find((row) => row.id === input.entryId);
    if (!target) return { status: "not-found" as const };
    if (!source || entries.length !== 2 || source.classId !== intent.source.classId ||
      source.version !== intent.source.entryVersion || target.classId !== intent.expectedTargetClassId ||
      target.version !== intent.expectedTargetEntryVersion || source.version >= maxVersion || target.version >= maxVersion) {
      return { status: "conflict" as const };
    }
    const sourceAssignments = await tx.select().from(schema.cardAssignments).where(and(
      eq(schema.cardAssignments.raceId, input.raceId), eq(schema.cardAssignments.entryId, source.id),
      eq(schema.cardAssignments.active, true))).limit(2).for("update");
    const targetAssignments = await tx.select().from(schema.cardAssignments).where(and(
      eq(schema.cardAssignments.raceId, input.raceId), eq(schema.cardAssignments.entryId, target.id),
      eq(schema.cardAssignments.active, true))).limit(2).for("update");
    const sourceAssignment = sourceAssignments[0];
    if (sourceAssignments.length !== 1 || targetAssignments.length !== 0 || !sourceAssignment ||
      sourceAssignment.id !== intent.source.assignment.id || sourceAssignment.cardNumber !== intent.source.assignment.cardNumber ||
      !sourceAssignment.isRental || !sourceAssignment.rentalReturned) return { status: "conflict" as const };
    await tx.update(schema.cardAssignments).set({ active: false }).where(eq(schema.cardAssignments.id, sourceAssignment.id));
    const [targetAssignment] = await tx.insert(schema.cardAssignments).values({ raceId: input.raceId,
      entryId: target.id, cardNumber: sourceAssignment.cardNumber, isRental: true, rentalReturned: false }).returning({ id: schema.cardAssignments.id });
    if (!targetAssignment) throw new Error("Den nya hyrbrickskopplingen kunde inte sparas");
    const sourceEntryVersionAfter = source.version + 1;
    const targetEntryVersionAfter = target.version + 1;
    const snapshotVersionAfter = race.snapshotVersion + 1;
    await tx.update(schema.entries).set({ version: sourceEntryVersionAfter }).where(eq(schema.entries.id, source.id));
    await tx.update(schema.entries).set({ version: targetEntryVersionAfter }).where(eq(schema.entries.id, target.id));
    await bumpReadoutPackageVersion(tx, input.raceId);
    const [saved] = await tx.insert(schema.entryCardRentalReuseRequests).values({
      requestId, raceId: input.raceId, sourceEntryId: source.id, sourceClassId: source.classId,
      sourceAssignmentId: sourceAssignment.id, cardNumber: sourceAssignment.cardNumber,
      targetEntryId: target.id, targetClassId: target.classId, targetAssignmentId: targetAssignment.id,
      actorAccountId: auth.principal.accountId,
      sourceEntryVersionBefore: source.version, sourceEntryVersionAfter,
      targetEntryVersionBefore: target.version, targetEntryVersionAfter,
      snapshotVersionBefore: race.snapshotVersion, snapshotVersionAfter, changedAt: now
    }).returning();
    if (!saved) throw new Error("Hyrbricksåteranvändningen kunde inte journalföras");
    await tx.insert(schema.auditEvents).values({
      raceId: input.raceId, entityType: "entry", entityId: target.id,
      action: "ENTRY_CARD_RENTAL_REUSED_BY_ADMIN", actorKind: "USER_ACCOUNT",
      actorId: auth.principal.accountId, requestId,
      before: { sourceEntryId: source.id, sourceAssignmentId: sourceAssignment.id, cardNumber: sourceAssignment.cardNumber,
        sourceEntryVersion: source.version, targetEntryId: target.id, targetEntryVersion: target.version,
        snapshotVersion: race.snapshotVersion },
      after: { sourceEntryId: source.id, sourceAssignmentId: sourceAssignment.id, sourceEntryVersion: sourceEntryVersionAfter,
        targetEntryId: target.id, targetAssignmentId: targetAssignment.id, targetEntryVersion: targetEntryVersionAfter,
        cardNumber: sourceAssignment.cardNumber, snapshotVersion: snapshotVersionAfter }
    });
    return { status: "changed" as const, response: receipt(saved, false) };
  });
}
