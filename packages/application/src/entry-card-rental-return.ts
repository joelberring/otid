import { and, eq, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { entryCardRentalReturnChangeIdempotencyKeySchema, entryCardRentalReturnChangeRequestSchema,
  entryCardRentalReturnChangeResponseSchema } from "@o-tid/contracts";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { lockRaceForMutation } from "./concurrency";
import { bumpReadoutPackageVersion } from "./snapshot";
import { UUID_PATTERN as uuid } from "./serialization";

type Authentication = RaceSessionProof;
const maxVersion = 2_147_483_647;

function receipt(row: typeof schema.entryCardRentalReturnChanges.$inferSelect, replayed: boolean) {
  return entryCardRentalReturnChangeResponseSchema.parse({
    formatVersion: 1, replayed, requestId: row.requestId, raceId: row.raceId, entryId: row.entryId,
    classId: row.classId, assignment: { id: row.assignmentId, cardNumber: row.cardNumber },
    previousRentalReturned: row.previousRentalReturned, rentalReturned: row.rentalReturned,
    entryVersionBefore: row.entryVersionBefore, entryVersionAfter: row.entryVersionAfter,
    snapshotVersionBefore: row.snapshotVersionBefore, snapshotVersionAfter: row.snapshotVersionAfter,
    changedAt: row.changedAt.toISOString()
  });
}

export async function changeEntryCardRentalReturnAsAdmin(db: Database,
  input: Authentication & { entryId: string; idempotencyKey: string | null; request: unknown }, now = new Date()) {
  const key = entryCardRentalReturnChangeIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const parsed = entryCardRentalReturnChangeRequestSchema.safeParse(input.request);
  if (!key.success || !parsed.success || !uuid.test(input.raceId) || !uuid.test(input.entryId)) {
    return { status: "invalid-request" as const };
  }
  const intent = parsed.data;
  const requestId = key.data.slice("entry-card-rental-return-change:".length);
  const authentication = { ...input, role: "ADMIN" as const, requireCsrf: true };
  const preflight = await requireRaceRole(db, authentication, now);
  if (preflight.status !== "authenticated") return preflight;
  return db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, authentication, now, "update");
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForMutation(tx, input.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existing] = await tx.select().from(schema.entryCardRentalReturnChanges)
      .where(eq(schema.entryCardRentalReturnChanges.requestId, requestId));
    if (existing) {
      if (existing.raceId !== input.raceId || existing.entryId !== input.entryId ||
        existing.actorAccountId !== auth.principal.accountId ||
        existing.classId !== intent.expectedClassId || existing.entryVersionBefore !== intent.expectedEntryVersion ||
        existing.assignmentId !== intent.expectedAssignment.id || existing.cardNumber !== intent.expectedAssignment.cardNumber ||
        existing.previousRentalReturned !== intent.expectedAssignment.rentalReturned ||
        existing.rentalReturned !== intent.rentalReturned) return { status: "conflict" as const };
      return { status: "changed" as const, response: receipt(existing, true) };
    }
    const [entry] = await tx.select().from(schema.entries).where(and(
      eq(schema.entries.id, input.entryId), eq(schema.entries.raceId, input.raceId))).for("update");
    if (!entry) return { status: "not-found" as const };
    const active = await tx.select().from(schema.cardAssignments).where(and(
      eq(schema.cardAssignments.raceId, input.raceId), eq(schema.cardAssignments.entryId, entry.id),
      eq(schema.cardAssignments.active, true))).limit(2).for("update");
    const assignment = active[0];
    if (active.length !== 1 || !assignment || entry.version !== intent.expectedEntryVersion ||
      entry.classId !== intent.expectedClassId ||
      entry.version >= maxVersion || race.snapshotVersion >= maxVersion ||
      assignment.id !== intent.expectedAssignment.id || assignment.cardNumber !== intent.expectedAssignment.cardNumber ||
      !assignment.isRental || assignment.isRental !== intent.expectedAssignment.isRental ||
      assignment.rentalReturned !== intent.expectedAssignment.rentalReturned ||
      assignment.rentalReturned === intent.rentalReturned) return { status: "conflict" as const };
    const entryVersionAfter = entry.version + 1;
    const snapshotVersionAfter = race.snapshotVersion + 1;
    await tx.update(schema.cardAssignments).set({ rentalReturned: intent.rentalReturned })
      .where(eq(schema.cardAssignments.id, assignment.id));
    await tx.update(schema.entries).set({ version: entryVersionAfter }).where(eq(schema.entries.id, entry.id));
    await bumpReadoutPackageVersion(tx, input.raceId);
    const [saved] = await tx.insert(schema.entryCardRentalReturnChanges).values({
      requestId, raceId: input.raceId, entryId: entry.id, classId: entry.classId,
      assignmentId: assignment.id, cardNumber: assignment.cardNumber,
      actorAccountId: auth.principal.accountId,
      previousRentalReturned: assignment.rentalReturned, rentalReturned: intent.rentalReturned,
      entryVersionBefore: entry.version, entryVersionAfter,
      snapshotVersionBefore: race.snapshotVersion, snapshotVersionAfter, changedAt: now
    }).returning();
    if (!saved) throw new Error("Hyrbrickans återlämningsjournal kunde inte sparas");
    await tx.insert(schema.auditEvents).values({
      raceId: input.raceId, entityType: "entry", entityId: entry.id,
      action: "ENTRY_CARD_RENTAL_RETURN_CHANGED_BY_ADMIN", actorKind: "USER_ACCOUNT",
      actorId: auth.principal.accountId, requestId,
      before: { assignmentId: assignment.id, cardNumber: assignment.cardNumber, isRental: assignment.isRental,
        rentalReturned: assignment.rentalReturned, entryVersion: entry.version, snapshotVersion: race.snapshotVersion },
      after: { assignmentId: assignment.id, cardNumber: assignment.cardNumber, isRental: assignment.isRental,
        rentalReturned: intent.rentalReturned, entryVersion: entryVersionAfter, snapshotVersion: snapshotVersionAfter }
    });
    return { status: "changed" as const, response: receipt(saved, false) };
  });
}
