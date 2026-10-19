import { and, count, eq, sql, isNull } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { classCapacityKeySchema, classCapacityRequestSchema, classCapacityResponseSchema } from "@o-tid/contracts";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { lockRaceForMutation } from "./concurrency";
import { UUID_PATTERN as uuid } from "./serialization";

type Input = RaceSessionProof & { classId: string; idempotencyKey: string | null; request: unknown };
function response(row: typeof schema.classCapacityChangeRequests.$inferSelect, replayed: boolean) {
  return classCapacityResponseSchema.parse({ formatVersion: 1, replayed, requestId: row.requestId,
    raceId: row.raceId, classId: row.classId, previousMaxEntries: row.previousMaxEntries, maxEntries: row.maxEntries,
    versionBefore: row.versionBefore, versionAfter: row.versionAfter, entryCount: row.entryCount, changedAt: row.changedAt.toISOString() });
}
export async function changeClassCapacityAsAdmin(db: Database, input: Input, now = new Date()) {
  const key = classCapacityKeySchema.safeParse(input.idempotencyKey), parsed = classCapacityRequestSchema.safeParse(input.request);
  if (!key.success || !parsed.success || !uuid.test(input.classId) || !uuid.test(input.raceId)) return { status: "invalid-request" as const };
  const authentication = { ...input, role: "ADMIN" as const, requireCsrf: true };
  const preflight = await requireRaceRole(db, authentication, now);
  if (preflight.status !== "authenticated") return preflight;
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, authentication, now, "update");
    if (auth.status !== "authenticated") return auth;
    await lockRaceForMutation(tx, input.raceId);
    const requestId = key.data.slice("class-capacity:".length), intent = parsed.data;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [old] = await tx.select().from(schema.classCapacityChangeRequests).where(eq(schema.classCapacityChangeRequests.requestId, requestId));
    if (old) {
      if (old.raceId !== input.raceId || old.classId !== input.classId || old.actorAccountId !== auth.principal.accountId ||
        old.versionBefore !== intent.expectedCapacityVersion || old.previousMaxEntries !== intent.expectedMaxEntries || old.maxEntries !== intent.maxEntries) return { status: "conflict" as const };
      return { status: "changed" as const, response: response(old, true) };
    }
    const [raceClass] = await tx.select().from(schema.classes).where(and(eq(schema.classes.id, input.classId), eq(schema.classes.raceId, input.raceId)));
    if (!raceClass) return { status: "not-found" as const };
    if (raceClass.capacityVersion !== intent.expectedCapacityVersion || raceClass.maxEntries !== intent.expectedMaxEntries ||
      raceClass.capacityVersion >= 2_147_483_647) return { status: "conflict" as const };
    const [total] = await tx.select({ value: count() }).from(schema.entries).where(and(eq(schema.entries.raceId, input.raceId), eq(schema.entries.classId, input.classId),
      isNull(schema.entries.struckAt)));
    if (!total || (intent.maxEntries !== null && total.value > intent.maxEntries)) return { status: "conflict" as const };
    const versionAfter = raceClass.capacityVersion + 1;
    await tx.update(schema.classes).set({ maxEntries: intent.maxEntries, capacityVersion: versionAfter }).where(eq(schema.classes.id, input.classId));
    const [saved] = await tx.insert(schema.classCapacityChangeRequests).values({ requestId, raceId: input.raceId, classId: input.classId,
      actorAccountId: auth.principal.accountId, previousMaxEntries: raceClass.maxEntries,
      maxEntries: intent.maxEntries, versionBefore: raceClass.capacityVersion, versionAfter, entryCount: total.value, changedAt: now }).returning();
    if (!saved) throw new Error("Kapacitetsjournalen kunde inte sparas");
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "class", entityId: input.classId,
      action: "CLASS_CAPACITY_CHANGED_BY_ADMIN", actorKind: "USER_ACCOUNT", actorId: auth.principal.accountId, requestId,
      before: { maxEntries: raceClass.maxEntries, capacityVersion: raceClass.capacityVersion },
      after: { maxEntries: intent.maxEntries, capacityVersion: versionAfter, entryCount: total.value } });
    return { status: "changed" as const, response: response(saved, false) };
  });
}
