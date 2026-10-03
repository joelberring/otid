import { and, eq, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { manualClassCreateIdempotencyKeySchema, manualClassCreateRequestSchema, manualClassCreateResponseSchema } from "@o-tid/contracts";
import { authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { lockRaceForMutation } from "./concurrency";

type Input = Omit<PairingAdminRequestAuthentication, "capability"> & { idempotencyKey: string | null; request: unknown };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function createManualClassAsAdministrator(db: Database, input: Input, now = new Date()) {
  const parsed = manualClassCreateRequestSchema.safeParse(input.request);
  const key = manualClassCreateIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!parsed.success || !key.success || key.data.slice("manual-class-create:".length) !== parsed.data.requestId ||
    !uuid.test(input.raceId)) return { status: "invalid-request" as const };
  const authentication = { ...input, capability: "MANAGE_RACE" as const, requireCsrf: true };
  const initial = await authenticatePairingAdminSession(db, authentication, now);
  if (initial.status !== "authenticated") return initial;
  const intent = parsed.data;
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForMutation(tx, input.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'manual-class:' + intent.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.manualClassCreateRequests)
      .where(eq(schema.manualClassCreateRequests.requestId, intent.requestId));
    if (prior) {
      const original = manualClassCreateRequestSchema.parse(prior.request);
      const response = manualClassCreateResponseSchema.parse(prior.response);
      if (prior.raceId !== input.raceId || prior.actorCredentialId !== auth.principal.accessCredentialId ||
        JSON.stringify(original) !== JSON.stringify(intent) || prior.courseId !== response.courseId ||
        prior.courseVersionId !== response.courseVersionId || prior.classId !== response.classId ||
        response.raceId !== prior.raceId || response.requestId !== prior.requestId || response.replayed ||
        JSON.stringify(response.request) !== JSON.stringify(original)) return { status: "conflict" as const };
      return { status: "created" as const, response: { ...response, replayed: true } };
    }
    if (race.snapshotVersion !== intent.expectedSnapshotVersion || race.snapshotVersion >= 2_147_483_647) return { status: "conflict" as const };
    const [target] = await tx.select({ courseId: schema.courses.id, courseName: schema.courses.name,
      courseVersionId: schema.courseVersions.id, courseVersion: schema.courseVersions.version })
      .from(schema.courseVersions).innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
      .where(and(eq(schema.courseVersions.id, intent.courseVersionId), eq(schema.courses.raceId, input.raceId)));
    if (!target) return { status: "not-found" as const };
    if (!target.courseName.trim() || !Number.isInteger(target.courseVersion) ||
      target.courseVersion <= 0 || target.courseVersion > 2_147_483_647) return { status: "conflict" as const };
    const controls = await tx.select({ sequence: schema.courseControls.sequence, code: schema.controls.code,
      raceId: schema.controls.raceId }).from(schema.courseControls)
      .innerJoin(schema.controls, eq(schema.controls.id, schema.courseControls.controlId))
      .where(eq(schema.courseControls.courseVersionId, target.courseVersionId)).orderBy(schema.courseControls.sequence);
    if (!controls.length || controls.length > 1000 || controls.some((control, index) =>
      control.sequence !== index + 1 || control.raceId !== input.raceId ||
      !Number.isInteger(control.code) || control.code <= 0 || control.code > 2_147_483_647)) return { status: "conflict" as const };
    const [raceClass] = await tx.insert(schema.classes).values({ raceId: input.raceId, name: intent.className,
      courseVersionId: target.courseVersionId, startRule: intent.startRule }).returning();
    if (!raceClass) throw new Error("Klassen kunde inte skapas");
    const response = manualClassCreateResponseSchema.parse({ formatVersion: 1, replayed: false,
      requestId: intent.requestId, raceId: input.raceId, courseId: target.courseId,
      courseVersionId: target.courseVersionId, courseName: target.courseName, courseVersion: target.courseVersion,
      classId: raceClass.id, request: intent, snapshotVersionBefore: race.snapshotVersion,
      snapshotVersionAfter: race.snapshotVersion + 1, createdAt: now.toISOString() });
    await tx.update(schema.races).set({ snapshotVersion: response.snapshotVersionAfter }).where(eq(schema.races.id, input.raceId));
    await tx.insert(schema.manualClassCreateRequests).values({ requestId: intent.requestId, raceId: input.raceId,
      courseId: target.courseId, courseVersionId: target.courseVersionId, classId: raceClass.id,
      actorCredentialId: auth.principal.accessCredentialId, capability: "MANAGE_RACE", request: intent, response });
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "class", entityId: raceClass.id,
      requestId: intent.requestId, actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId,
      action: "MANUAL_CLASS_CREATED_ON_EXISTING_COURSE_BY_ADMIN", before: { snapshotVersion: race.snapshotVersion },
      after: { classId: raceClass.id, courseId: target.courseId, courseVersionId: target.courseVersionId,
        courseName: target.courseName, courseVersion: target.courseVersion, startRule: intent.startRule,
        snapshotVersion: response.snapshotVersionAfter }, createdAt: now });
    return { status: "created" as const, response };
  });
}
