import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { entryCardAdminListResponseSchema, entryCardChangeRequestSchema,
  entryCardChangeIdempotencyKeySchema, entryCardChangeResponseSchema } from "@o-tid/contracts";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { bumpReadoutPackageVersion } from "./snapshot";
import { UUID_PATTERN } from "./serialization";

type Authentication = RaceSessionProof;

export async function listEntryCardsAsAdmin(db: Database, input: Authentication, now = new Date()) {
  return db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForSnapshot(tx, input.raceId);
    const entries = await tx.select({ id: schema.entries.id, givenName: schema.entries.givenName,
      familyName: schema.entries.familyName, classId: schema.entries.classId, className: schema.classes.name,
      version: schema.entries.version }).from(schema.entries).innerJoin(schema.classes, and(
      eq(schema.classes.id, schema.entries.classId), eq(schema.classes.raceId, input.raceId)
    )).where(eq(schema.entries.raceId, input.raceId)).orderBy(asc(schema.entries.familyName), asc(schema.entries.id)).limit(10_001);
    if (entries.length > 10_000) throw new Error("För många deltagare");
    const assignments = entries.length === 0 ? [] : await tx.select({ id: schema.cardAssignments.id,
      entryId: schema.cardAssignments.entryId, cardNumber: schema.cardAssignments.cardNumber
    }).from(schema.cardAssignments).where(and(eq(schema.cardAssignments.raceId, input.raceId),
      eq(schema.cardAssignments.active, true), inArray(schema.cardAssignments.entryId, entries.map((entry) => entry.id)))).limit(20_001);
    if (assignments.length > 20_000) throw new Error("För många aktiva brickkopplingar");
    const byEntry = new Map<string, typeof assignments>();
    for (const row of assignments) {
      const rows = byEntry.get(row.entryId) ?? [];
      rows.push(row); byEntry.set(row.entryId, rows);
    }
    return { status: "ok" as const, response: entryCardAdminListResponseSchema.parse({ formatVersion: 1,
      raceId: input.raceId, snapshotVersion: race.snapshotVersion,
      entries: entries.map(({ givenName, familyName, ...entry }) => {
        const rows = byEntry.get(entry.id) ?? [];
        const active = rows.length === 1 ? rows[0] : undefined;
        return { ...entry, displayName: `${givenName} ${familyName}`, multipleActiveAssignments: rows.length > 1,
          activeAssignment: active ? { id: active.id, cardNumber: active.cardNumber } : null };
      })
    }) };
  });
}

function response(row: typeof schema.entryCardChangeRequests.$inferSelect, replayed: boolean) {
  return entryCardChangeResponseSchema.parse({ formatVersion: 1, replayed, requestId: row.requestId,
    raceId: row.raceId, entryId: row.entryId, classId: row.classId,
    previousAssignment: row.previousAssignmentId ? { id: row.previousAssignmentId, cardNumber: row.previousCardNumber } : null,
    activeAssignment: { id: row.activeAssignmentId, cardNumber: row.cardNumber },
    entryVersionBefore: row.entryVersionBefore, entryVersionAfter: row.entryVersionAfter,
    snapshotVersionBefore: row.snapshotVersionBefore, snapshotVersionAfter: row.snapshotVersionAfter,
    changedAt: row.changedAt.toISOString() });
}

export async function changeEntryCardAsAdmin(db: Database,
  input: Authentication & { entryId: string; idempotencyKey: string | null; request: unknown }, now = new Date()) {
  const key = entryCardChangeIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const parsed = entryCardChangeRequestSchema.safeParse(input.request);
  if (!key.success || !parsed.success || !UUID_PATTERN.test(input.entryId)) {
    return { status: "invalid-request" as const };
  }
  const intent = parsed.data;
  const requestId = key.data.slice("entry-card-change:".length);
  const authentication = { ...input, role: "ADMIN" as const, requireCsrf: true };
  const preflight = await requireRaceRole(db, authentication, now);
  if (preflight.status !== "authenticated") return preflight;
  return db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, authentication, now, "update");
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForMutation(tx, input.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existing] = await tx.select().from(schema.entryCardChangeRequests).where(eq(schema.entryCardChangeRequests.requestId, requestId));
    if (existing) {
      if (existing.raceId !== input.raceId || existing.entryId !== input.entryId ||
        existing.actorAccountId !== auth.principal.accountId || existing.classId !== intent.expectedClassId ||
        existing.entryVersionBefore !== intent.expectedEntryVersion || existing.previousAssignmentId !== (intent.expectedAssignment?.id ?? null) ||
        existing.previousCardNumber !== (intent.expectedAssignment?.cardNumber ?? null) || existing.cardNumber !== intent.cardNumber) {
        return { status: "conflict" as const };
      }
      return { status: "changed" as const, response: response(existing, true) };
    }
    const [entry] = await tx.select().from(schema.entries).where(and(eq(schema.entries.id, input.entryId),
      eq(schema.entries.raceId, input.raceId))).for("update");
    if (!entry) return { status: "not-found" as const };
    const active = await tx.select().from(schema.cardAssignments).where(and(eq(schema.cardAssignments.raceId, input.raceId),
      eq(schema.cardAssignments.entryId, entry.id), eq(schema.cardAssignments.active, true))).limit(2);
    const previous = active[0];
    if (active.length > 1 || entry.version !== intent.expectedEntryVersion || entry.classId !== intent.expectedClassId ||
      entry.version >= 2_147_483_647 || race.snapshotVersion >= 2_147_483_647 ||
      (previous?.id ?? null) !== (intent.expectedAssignment?.id ?? null) ||
      (previous?.cardNumber ?? null) !== (intent.expectedAssignment?.cardNumber ?? null) || previous?.cardNumber === intent.cardNumber) {
      return { status: "conflict" as const };
    }
    const targets = await tx.select().from(schema.cardAssignments).where(and(eq(schema.cardAssignments.raceId, input.raceId),
      eq(schema.cardAssignments.cardNumber, intent.cardNumber))).orderBy(desc(schema.cardAssignments.createdAt), desc(schema.cardAssignments.id)).limit(10_001);
    if (targets.length > 10_000 || targets.some((target) => target.entryId !== entry.id || target.active)) {
      return { status: "conflict" as const };
    }
    const target = targets[0];
    if (previous) await tx.update(schema.cardAssignments).set({ active: false }).where(eq(schema.cardAssignments.id, previous.id));
    let assignmentId: string;
    if (target) {
      await tx.update(schema.cardAssignments).set({ active: true }).where(eq(schema.cardAssignments.id, target.id));
      assignmentId = target.id;
    } else {
      const [created] = await tx.insert(schema.cardAssignments).values({ raceId: input.raceId, entryId: entry.id,
        cardNumber: intent.cardNumber }).returning({ id: schema.cardAssignments.id });
      if (!created) throw new Error("Brickkopplingen kunde inte sparas");
      assignmentId = created.id;
    }
    await tx.update(schema.entries).set({ version: entry.version + 1 }).where(eq(schema.entries.id, entry.id));
    await bumpReadoutPackageVersion(tx, input.raceId);
    const [saved] = await tx.insert(schema.entryCardChangeRequests).values({ requestId, raceId: input.raceId,
      entryId: entry.id, classId: entry.classId, actorAccountId: auth.principal.accountId,
      previousAssignmentId: previous?.id ?? null, previousCardNumber: previous?.cardNumber ?? null,
      activeAssignmentId: assignmentId, cardNumber: intent.cardNumber, entryVersionBefore: entry.version,
      entryVersionAfter: entry.version + 1, snapshotVersionBefore: race.snapshotVersion,
      snapshotVersionAfter: race.snapshotVersion + 1, changedAt: now }).returning();
    if (!saved) throw new Error("Brickbytesjournalen kunde inte sparas");
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "entry", entityId: entry.id,
      action: "ENTRY_CARD_CHANGED_BY_ADMIN", actorKind: "USER_ACCOUNT", actorId: auth.principal.accountId,
      requestId, before: { assignmentId: previous?.id ?? null, entryVersion: entry.version, snapshotVersion: race.snapshotVersion },
      after: { assignmentId, entryVersion: entry.version + 1, snapshotVersion: race.snapshotVersion + 1 } });
    return { status: "changed" as const, response: response(saved, false) };
  });
}
