import { and, count, eq, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { classCapacityKeySchema, classCapacityRequestSchema, classCapacityResponseSchema } from "@o-tid/contracts";
import { authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation,
  type PairingAdminRequestAuthentication } from "./pairing-admin";
import { lockRaceForMutation } from "./concurrency";

type Input = Omit<PairingAdminRequestAuthentication, "capability"> & { classId: string; idempotencyKey: string | null; request: unknown };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function response(row: typeof schema.classCapacityChangeRequests.$inferSelect, replayed: boolean) {
  return classCapacityResponseSchema.parse({ formatVersion: 1, replayed, requestId: row.requestId,
    raceId: row.raceId, classId: row.classId, previousMaxEntries: row.previousMaxEntries, maxEntries: row.maxEntries,
    versionBefore: row.versionBefore, versionAfter: row.versionAfter, entryCount: row.entryCount, changedAt: row.changedAt.toISOString() });
}
export async function changeClassCapacityAsAdministrator(db: Database, input: Input, now = new Date()) {
  const key = classCapacityKeySchema.safeParse(input.idempotencyKey), parsed = classCapacityRequestSchema.safeParse(input.request);
  if (!key.success || !parsed.success || !uuid.test(input.classId) || !uuid.test(input.raceId)) return { status: "invalid-request" as const };
  const authentication = { ...input, capability: "MANAGE_RACE" as const, requireCsrf: true };
  const preflight = await authenticatePairingAdminSession(db, authentication, now);
  if (preflight.status !== "authenticated") return preflight;
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (auth.status !== "authenticated") return auth;
    await lockRaceForMutation(tx, input.raceId);
    const requestId = key.data.slice("class-capacity:".length), intent = parsed.data;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [old] = await tx.select().from(schema.classCapacityChangeRequests).where(eq(schema.classCapacityChangeRequests.requestId, requestId));
    if (old) {
      if (old.raceId !== input.raceId || old.classId !== input.classId || old.actorCredentialId !== auth.principal.accessCredentialId ||
        old.versionBefore !== intent.expectedCapacityVersion || old.previousMaxEntries !== intent.expectedMaxEntries || old.maxEntries !== intent.maxEntries) return { status: "conflict" as const };
      return { status: "changed" as const, response: response(old, true) };
    }
    const [raceClass] = await tx.select().from(schema.classes).where(and(eq(schema.classes.id, input.classId), eq(schema.classes.raceId, input.raceId)));
    if (!raceClass) return { status: "not-found" as const };
    if (raceClass.capacityVersion !== intent.expectedCapacityVersion || raceClass.maxEntries !== intent.expectedMaxEntries ||
      raceClass.capacityVersion >= 2_147_483_647) return { status: "conflict" as const };
    const [total] = await tx.select({ value: count() }).from(schema.entries).where(and(eq(schema.entries.raceId, input.raceId), eq(schema.entries.classId, input.classId)));
    if (!total || (intent.maxEntries !== null && total.value > intent.maxEntries)) return { status: "conflict" as const };
    const versionAfter = raceClass.capacityVersion + 1;
    await tx.update(schema.classes).set({ maxEntries: intent.maxEntries, capacityVersion: versionAfter }).where(eq(schema.classes.id, input.classId));
    const [saved] = await tx.insert(schema.classCapacityChangeRequests).values({ requestId, raceId: input.raceId, classId: input.classId,
      actorCredentialId: auth.principal.accessCredentialId, capability: "MANAGE_RACE", previousMaxEntries: raceClass.maxEntries,
      maxEntries: intent.maxEntries, versionBefore: raceClass.capacityVersion, versionAfter, entryCount: total.value, changedAt: now }).returning();
    if (!saved) throw new Error("Kapacitetsjournalen kunde inte sparas");
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "class", entityId: input.classId,
      action: "CLASS_CAPACITY_CHANGED_BY_ADMIN", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId, requestId,
      before: { maxEntries: raceClass.maxEntries, capacityVersion: raceClass.capacityVersion },
      after: { maxEntries: intent.maxEntries, capacityVersion: versionAfter, entryCount: total.value } });
    return { status: "changed" as const, response: response(saved, false) };
  });
}
