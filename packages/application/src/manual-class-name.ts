import { and, eq, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { manualClassNameCandidateSchema, manualClassNameChangeIdempotencyKeySchema,
  manualClassNameChangeRequestSchema, manualClassNameChangeResponseSchema } from "@o-tid/contracts";
import { authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { lockRaceForMutation } from "./concurrency";

type ReadInput = Omit<PairingAdminRequestAuthentication, "capability"> & { classId: string };
type ChangeInput = ReadInput & { idempotencyKey: string | null; request: unknown };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function listManualClassNameAsAdministrator(db: Database, input: ReadInput, now = new Date()) {
  if (!uuid.test(input.raceId) || !uuid.test(input.classId)) return { status: "invalid-request" as const };
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability: "MANAGE_RACE" }, now);
    if (auth.status !== "authenticated") return auth;
    const [row] = await tx.select({ snapshotVersion: schema.races.snapshotVersion, className: schema.classes.name,
      courseVersionId: schema.classes.courseVersionId, externalSource: schema.classes.externalSource,
      externalId: schema.classes.externalId }).from(schema.classes)
      .innerJoin(schema.races, eq(schema.races.id, schema.classes.raceId))
      .where(and(eq(schema.classes.id, input.classId), eq(schema.classes.raceId, input.raceId)));
    if (!row) return { status: "not-found" as const };
    return { status: "ok" as const, response: manualClassNameCandidateSchema.parse({ formatVersion: 1,
      raceId: input.raceId, classId: input.classId, snapshotVersion: row.snapshotVersion,
      className: row.className, courseVersionId: row.courseVersionId,
      editable: row.externalSource === null && row.externalId === null }) };
  }, { isolationLevel: "repeatable read" });
}

export async function changeManualClassNameAsAdministrator(db: Database, input: ChangeInput, now = new Date()) {
  const parsed = manualClassNameChangeRequestSchema.safeParse(input.request);
  const key = manualClassNameChangeIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!parsed.success || !key.success || key.data.slice("manual-class-name:".length) !== parsed.data.requestId ||
    !uuid.test(input.raceId) || !uuid.test(input.classId)) return { status: "invalid-request" as const };
  const authentication = { ...input, capability: "MANAGE_RACE" as const, requireCsrf: true };
  const initial = await authenticatePairingAdminSession(db, authentication, now);
  if (initial.status !== "authenticated") return initial;
  const intent = parsed.data;
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForMutation(tx, input.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'manual-class-name:' + intent.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.manualClassNameChangeRequests)
      .where(eq(schema.manualClassNameChangeRequests.requestId, intent.requestId));
    if (prior) {
      const original = manualClassNameChangeRequestSchema.parse(prior.request);
      const response = manualClassNameChangeResponseSchema.parse(prior.response);
      if (prior.raceId !== input.raceId || prior.classId !== input.classId ||
        prior.actorCredentialId !== auth.principal.accessCredentialId ||
        JSON.stringify(original) !== JSON.stringify(intent) || prior.courseVersionId !== response.courseVersionId ||
        response.raceId !== prior.raceId || response.classId !== prior.classId ||
        response.requestId !== prior.requestId || response.replayed ||
        JSON.stringify(response.request) !== JSON.stringify(original)) return { status: "conflict" as const };
      return { status: "changed" as const, response: { ...response, replayed: true } };
    }
    const [raceClass] = await tx.select().from(schema.classes)
      .where(and(eq(schema.classes.id, input.classId), eq(schema.classes.raceId, input.raceId)));
    if (!raceClass) return { status: "not-found" as const };
    if (raceClass.externalSource !== null || raceClass.externalId !== null ||
      race.snapshotVersion !== intent.expectedSnapshotVersion || raceClass.name !== intent.expectedClassName ||
      raceClass.name === intent.className || race.snapshotVersion >= 2_147_483_647) return { status: "conflict" as const };
    const response = manualClassNameChangeResponseSchema.parse({ formatVersion: 1, replayed: false,
      requestId: intent.requestId, raceId: input.raceId, classId: input.classId,
      courseVersionId: raceClass.courseVersionId, previousClassName: raceClass.name, className: intent.className,
      request: intent, snapshotVersionBefore: race.snapshotVersion,
      snapshotVersionAfter: race.snapshotVersion + 1, changedAt: now.toISOString() });
    await tx.update(schema.classes).set({ name: intent.className }).where(eq(schema.classes.id, input.classId));
    await tx.update(schema.races).set({ snapshotVersion: response.snapshotVersionAfter }).where(eq(schema.races.id, input.raceId));
    await tx.insert(schema.manualClassNameChangeRequests).values({ requestId: intent.requestId, raceId: input.raceId,
      classId: input.classId, courseVersionId: raceClass.courseVersionId,
      actorCredentialId: auth.principal.accessCredentialId, capability: "MANAGE_RACE", request: intent, response });
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "class", entityId: input.classId,
      requestId: intent.requestId, actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId,
      action: "MANUAL_CLASS_NAME_CHANGED_BY_ADMIN",
      before: { className: raceClass.name, courseVersionId: raceClass.courseVersionId, snapshotVersion: race.snapshotVersion },
      after: { className: intent.className, courseVersionId: raceClass.courseVersionId,
        snapshotVersion: response.snapshotVersionAfter }, createdAt: now });
    return { status: "changed" as const, response };
  });
}
