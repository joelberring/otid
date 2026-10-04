import { and, asc, count, countDistinct, eq, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { planClassStartRuleChange } from "@o-tid/domain";
import { classStartRulePreviewSchema, classStartRuleChangeRequestSchema, classStartRuleChangeResponseSchema } from "@o-tid/contracts";
import { authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation, authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { lockRaceForMutation } from "./concurrency";

type Input = Omit<PairingAdminRequestAuthentication, "capability"> & { classId: string; request: unknown };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export async function previewClassStartRuleAsAdministrator(db: Database, input: Omit<Input, "request">, now = new Date()) {
  if (!uuid.test(input.raceId) || !uuid.test(input.classId)) return { status: "invalid-request" as const };
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability: "MANAGE_RACE" }, now);
    if (auth.status !== "authenticated") return auth;
    const [row] = await tx.select({ className: schema.classes.name, startRule: schema.classes.startRule,
      snapshotVersion: schema.races.snapshotVersion }).from(schema.classes)
      .innerJoin(schema.races, eq(schema.races.id, schema.classes.raceId))
      .where(and(eq(schema.classes.id, input.classId), eq(schema.classes.raceId, input.raceId)));
    if (!row) return { status: "not-found" as const };
    const [counts] = await tx.select({ entryCount: count(), fixedStartTimeCount: count(schema.entries.fixedStartTime) })
      .from(schema.entries).where(and(eq(schema.entries.raceId, input.raceId), eq(schema.entries.classId, input.classId)));
    if (!counts || counts.entryCount > 10000) return { status: "too-large" as const };
    const [results] = await tx.select({ entriesWithResults: countDistinct(schema.resultRevisions.entryId) })
      .from(schema.resultRevisions).innerJoin(schema.entries, and(eq(schema.entries.id, schema.resultRevisions.entryId), eq(schema.entries.raceId, schema.resultRevisions.raceId)))
      .where(and(eq(schema.entries.raceId, input.raceId), eq(schema.entries.classId, input.classId)));
    return { status: "ok" as const, response: classStartRulePreviewSchema.parse({ formatVersion: 1,
      raceId: input.raceId, classId: input.classId, ...row, ...counts,
      entriesWithResults: results?.entriesWithResults ?? 0, generatedAt: now.toISOString() }) };
  }, { isolationLevel: "repeatable read" });
}
export async function changeClassStartRuleAsAdministrator(db: Database, input: Input, now = new Date()) {
  const parsed = classStartRuleChangeRequestSchema.safeParse(input.request);
  if (!parsed.success || !uuid.test(input.raceId) || !uuid.test(input.classId)) return { status: "invalid-request" as const };
  const authentication = { ...input, capability: "MANAGE_RACE" as const, requireCsrf: true };
  const initial = await authenticatePairingAdminSession(db, authentication, now);
  if (initial.status !== "authenticated") return initial;
  const intent = parsed.data;
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForMutation(tx, input.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'class-start-rule:' + intent.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.classStartRuleChanges).where(eq(schema.classStartRuleChanges.requestId, intent.requestId));
    if (prior) {
      const original = classStartRuleChangeRequestSchema.parse(prior.request);
      const response = classStartRuleChangeResponseSchema.parse(prior.response);
      if (prior.raceId !== input.raceId || prior.classId !== input.classId || prior.actorCredentialId !== auth.principal.accessCredentialId ||
        JSON.stringify(original) !== JSON.stringify(intent)) return { status: "conflict" as const };
      if (response.requestId !== prior.requestId || response.raceId !== prior.raceId || response.classId !== prior.classId ||
        response.previousStartRule !== original.expectedStartRule || response.startRule !== original.startRule ||
        response.snapshotVersionBefore !== original.expectedSnapshotVersion) throw new Error("Invalid start-rule journal");
      const items = await tx.select().from(schema.classStartRuleChangeItems).where(eq(schema.classStartRuleChangeItems.requestId, prior.requestId));
      if (items.length !== response.entryCount || items.some(item => item.raceId !== prior.raceId || item.classId !== prior.classId ||
        item.versionAfter !== item.versionBefore + (response.changed ? 1 : 0) ||
        (response.changed ? item.fixedStartTime !== null : item.fixedStartTime?.getTime() !== item.previousFixedStartTime?.getTime())) ||
        (response.changed ? items.filter(item => item.previousFixedStartTime !== null).length : 0) !== response.clearedStartTimes) throw new Error("Incomplete start-rule journal");
      return { status: "changed" as const, response };
    }
    const [raceClass] = await tx.select().from(schema.classes).where(and(eq(schema.classes.id, input.classId), eq(schema.classes.raceId, input.raceId)));
    if (!raceClass) return { status: "not-found" as const };
    if (race.snapshotVersion !== intent.expectedSnapshotVersion || raceClass.startRule !== intent.expectedStartRule) return { status: "conflict" as const };
    const changed = raceClass.startRule !== intent.startRule;
    if (changed && race.snapshotVersion >= 2_147_483_647) return { status: "conflict" as const };
    const rows = await tx.select({ id: schema.entries.id, version: schema.entries.version, fixedStartTime: schema.entries.fixedStartTime,
      exactTime: sql<boolean>`${schema.entries.fixedStartTime} IS NULL OR date_trunc('milliseconds',${schema.entries.fixedStartTime}) = ${schema.entries.fixedStartTime}`
    }).from(schema.entries).where(and(eq(schema.entries.raceId, input.raceId), eq(schema.entries.classId, input.classId)))
      .orderBy(asc(schema.entries.id)).limit(10001).for("update");
    if (rows.length > 10000) return { status: "too-large" as const };
    if (rows.some(row => !row.exactTime || (changed && row.version >= 2_147_483_647))) return { status: "conflict" as const };
    const plan = planClassStartRuleChange({ current: raceClass.startRule, target: intent.startRule,
      entries: rows.map(row => ({ ...row, fixedStartTime: row.fixedStartTime?.toISOString() ?? null })) });
    const response = classStartRuleChangeResponseSchema.parse({ formatVersion: 1, requestId: intent.requestId,
      raceId: input.raceId, classId: input.classId, previousStartRule: raceClass.startRule, startRule: intent.startRule,
      snapshotVersionBefore: race.snapshotVersion, snapshotVersionAfter: race.snapshotVersion + (changed ? 1 : 0),
      entryCount: rows.length, clearedStartTimes: plan.clearedStartTimes, changed, changedAt: now.toISOString() });
    if (changed) {
      await tx.update(schema.classes).set({ startRule: plan.startRule, startDrawId: null }).where(eq(schema.classes.id, input.classId));
      await tx.update(schema.entries).set({ fixedStartTime: null, version: sql`${schema.entries.version} + 1` })
        .where(and(eq(schema.entries.raceId, input.raceId), eq(schema.entries.classId, input.classId)));
      await tx.update(schema.races).set({ snapshotVersion: response.snapshotVersionAfter }).where(eq(schema.races.id, input.raceId));
    }
    await tx.insert(schema.classStartRuleChanges).values({ requestId: intent.requestId, raceId: input.raceId, classId: input.classId,
      actorCredentialId: auth.principal.accessCredentialId, capability: "MANAGE_RACE", request: intent, response });
    // Bounded batches avoid PostgreSQL's parameter limit for large classes.
    for (let offset = 0; offset < plan.entries.length; offset += 500) await tx.insert(schema.classStartRuleChangeItems).values(
      plan.entries.slice(offset, offset + 500).map(entry => ({ ...entry, requestId: intent.requestId, raceId: input.raceId, classId: input.classId,
        previousFixedStartTime: entry.previousFixedStartTime === null ? null : new Date(entry.previousFixedStartTime),
        fixedStartTime: entry.fixedStartTime === null ? null : new Date(entry.fixedStartTime) })));
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "class", entityId: input.classId,
      requestId: intent.requestId, actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId,
      action: "CLASS_START_RULE_REVIEWED_BY_ADMIN", before: { startRule: raceClass.startRule, snapshotVersion: race.snapshotVersion },
      after: { ...response, reason: intent.reason }, createdAt: now });
    return { status: "changed" as const, response };
  });
}
