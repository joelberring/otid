import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { entryCardAdminListResponseSchema, entryCardChangeRequestSchema,
  entryCardChangeIdempotencyKeySchema, entryCardChangeResponseSchema, type EntryCardChangeResponse,
  type EntryCardInUseResponse } from "@o-tid/contracts";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { bumpReadoutPackageVersion, type DbExecutor } from "./snapshot";
import { UUID_PATTERN } from "./serialization";
import { activeCardHolder, assignCard, linkUnresolvedReadout, type CardHolder, type LinkedReadout } from "./card-assignment";
import { swapCards } from "./entry-card-swap";

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

interface CardChangeOutcome {
  readonly swappedWith?: NonNullable<EntryCardChangeResponse["swappedWith"]>;
  readonly linkedReadouts?: readonly LinkedReadout[];
  readonly staleResults?: NonNullable<EntryCardChangeResponse["staleResults"]>;
}

function response(row: typeof schema.entryCardChangeRequests.$inferSelect, replayed: boolean) {
  const outcome = (row.outcome ?? {}) as CardChangeOutcome;
  return entryCardChangeResponseSchema.parse({ formatVersion: 1, replayed, requestId: row.requestId,
    raceId: row.raceId, entryId: row.entryId, classId: row.classId,
    previousAssignment: row.previousAssignmentId ? { id: row.previousAssignmentId, cardNumber: row.previousCardNumber } : null,
    activeAssignment: { id: row.activeAssignmentId, cardNumber: row.cardNumber },
    entryVersionBefore: row.entryVersionBefore, entryVersionAfter: row.entryVersionAfter,
    snapshotVersionBefore: row.snapshotVersionBefore, snapshotVersionAfter: row.snapshotVersionAfter,
    changedAt: row.changedAt.toISOString(),
    ...(outcome.swappedWith ? { swappedWith: outcome.swappedWith } : {}),
    ...(outcome.linkedReadouts?.length ? { linkedReadouts: outcome.linkedReadouts } : {}),
    ...(outcome.staleResults?.length ? { staleResults: outcome.staleResults } : {}) });
}

async function holderDetails(tx: DbExecutor, holder: CardHolder): Promise<EntryCardInUseResponse["holder"]> {
  const [row] = await tx.select({ entryId: schema.entries.id, givenName: schema.entries.givenName, familyName: schema.entries.familyName,
    classId: schema.entries.classId, className: schema.classes.name, version: schema.entries.version }).from(schema.entries)
    .innerJoin(schema.classes, eq(schema.classes.id, schema.entries.classId)).where(eq(schema.entries.id, holder.entryId));
  if (!row) throw new Error("Brickans deltagare saknas");
  return { entryId: row.entryId, displayName: `${row.givenName} ${row.familyName}`, classId: row.classId, className: row.className,
    version: row.version, assignment: { id: holder.assignmentId, cardNumber: holder.cardNumber } };
}

export type EntryCardChangeResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" }
  | { status: "card-in-use"; holder: EntryCardInUseResponse["holder"] }
  | { status: "changed"; response: EntryCardChangeResponse };

/**
 * Byt bricka. Reglerna finns i `card-assignment.ts` (översynen 2026-11-02): en inaktiv koppling hos en annan deltagare
 * hindrar inte; är brickan aktiv hos någon annan blir svaret `card-in-use` med vem, och med `swapWith` byts brickorna
 * mellan de två (`entry-card-swap.ts`). Fanns redan en okänd avläsning av den nya brickan kopplas den och räknas.
 */
export async function changeEntryCardAsAdmin(db: Database,
  input: Authentication & { entryId: string; idempotencyKey: string | null; request: unknown }, now = new Date()): Promise<EntryCardChangeResult> {
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
  return db.transaction(async (tx): Promise<EntryCardChangeResult> => {
    const auth = await requireRaceRole(tx, authentication, now, "update");
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForMutation(tx, input.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existing] = await tx.select().from(schema.entryCardChangeRequests).where(eq(schema.entryCardChangeRequests.requestId, requestId));
    if (existing) {
      const swapped = (existing.outcome as CardChangeOutcome | null)?.swappedWith?.entryId;
      if (existing.raceId !== input.raceId || existing.entryId !== input.entryId ||
        existing.actorAccountId !== auth.principal.accountId || existing.classId !== intent.expectedClassId ||
        existing.entryVersionBefore !== intent.expectedEntryVersion || existing.previousAssignmentId !== (intent.expectedAssignment?.id ?? null) ||
        existing.previousCardNumber !== (intent.expectedAssignment?.cardNumber ?? null) || existing.cardNumber !== intent.cardNumber ||
        swapped !== intent.swapWith?.entryId) {
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
    const holder = await activeCardHolder(tx, input.raceId, intent.cardNumber);
    let assignmentId: string;
    let outcome: CardChangeOutcome = {};
    if (intent.swapWith) {
      // Bytet gäller exakt den löpare och den koppling som administratören såg.
      if (!previous || !holder || holder.entryId !== intent.swapWith.entryId || holder.assignmentId !== intent.swapWith.expectedAssignment.id) {
        return { status: "conflict" as const };
      }
      const [other] = await tx.select().from(schema.entries).where(and(eq(schema.entries.id, holder.entryId),
        eq(schema.entries.raceId, input.raceId))).for("update");
      const otherActive = other ? await tx.select({ id: schema.cardAssignments.id }).from(schema.cardAssignments)
        .where(and(eq(schema.cardAssignments.entryId, other.id), eq(schema.cardAssignments.active, true))).limit(2) : [];
      if (!other || other.id === entry.id || other.version !== intent.swapWith.expectedEntryVersion ||
        other.classId !== intent.swapWith.expectedClassId || other.version >= 2_147_483_647 || otherActive.length !== 1) {
        return { status: "conflict" as const };
      }
      const swapped = await swapCards(tx, { raceId: input.raceId, entry, other, actorAccountId: auth.principal.accountId,
        mine: { id: previous.id, cardNumber: previous.cardNumber }, theirs: { id: holder.assignmentId, cardNumber: holder.cardNumber } });
      assignmentId = swapped.assignmentId;
      outcome = { swappedWith: { entryId: other.id, displayName: `${other.givenName} ${other.familyName}`,
        previousAssignment: { id: holder.assignmentId, cardNumber: holder.cardNumber },
        activeAssignment: { id: swapped.otherAssignmentId, cardNumber: previous.cardNumber },
        entryVersionBefore: other.version, entryVersionAfter: other.version + 1 },
      linkedReadouts: swapped.linkedReadouts, staleResults: swapped.staleResults };
    } else {
      if (holder) return { status: "card-in-use", holder: await holderDetails(tx, holder) };
      assignmentId = (await assignCard(tx, { raceId: input.raceId, entryId: entry.id, cardNumber: intent.cardNumber })).assignmentId;
      const linked = await linkUnresolvedReadout(tx, { raceId: input.raceId, entryId: entry.id, cardNumber: intent.cardNumber,
        actorAccountId: auth.principal.accountId });
      if (linked) outcome = { linkedReadouts: [linked] };
    }
    await tx.update(schema.entries).set({ version: entry.version + 1 }).where(eq(schema.entries.id, entry.id));
    await bumpReadoutPackageVersion(tx, input.raceId);
    const [saved] = await tx.insert(schema.entryCardChangeRequests).values({ requestId, raceId: input.raceId,
      entryId: entry.id, classId: entry.classId, actorAccountId: auth.principal.accountId,
      previousAssignmentId: previous?.id ?? null, previousCardNumber: previous?.cardNumber ?? null,
      activeAssignmentId: assignmentId, cardNumber: intent.cardNumber, entryVersionBefore: entry.version,
      entryVersionAfter: entry.version + 1, snapshotVersionBefore: race.snapshotVersion,
      snapshotVersionAfter: race.snapshotVersion + 1, changedAt: now,
      outcome: Object.keys(outcome).length > 0 ? JSON.parse(JSON.stringify(outcome)) as Record<string, unknown> : null }).returning();
    if (!saved) throw new Error("Brickbytesjournalen kunde inte sparas");
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "entry", entityId: entry.id,
      action: outcome.swappedWith ? "ENTRY_CARDS_SWAPPED_BY_ADMIN" : "ENTRY_CARD_CHANGED_BY_ADMIN", actorKind: "USER_ACCOUNT",
      actorId: auth.principal.accountId,
      requestId, before: { assignmentId: previous?.id ?? null, entryVersion: entry.version, snapshotVersion: race.snapshotVersion },
      after: { assignmentId, entryVersion: entry.version + 1, snapshotVersion: race.snapshotVersion + 1,
        ...(outcome.swappedWith ? { swappedWith: outcome.swappedWith.entryId } : {}),
        ...(outcome.linkedReadouts?.length ? { linkedRevisions: outcome.linkedReadouts.map((row) => row.revision) } : {}) } });
    return { status: "changed" as const, response: response(saved, false) };
  });
}
