import { and, count, eq, isNull, max, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { manualCourseVersionClassRelinkIdempotencyKeySchema, manualCourseVersionClassRelinkPreviewSchema,
  manualCourseVersionClassRelinkRequestSchema, manualCourseVersionClassRelinkResponseSchema } from "@o-tid/contracts";
import { authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { lockRaceForMutation } from "./concurrency";

type Input = Omit<PairingAdminRequestAuthentication, "capability"> & { idempotencyKey: string | null; request: unknown };
type PreviewInput = Omit<PairingAdminRequestAuthentication, "capability"> & { classId: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function countClassImpact(tx: Parameters<Database["transaction"]>[0] extends (tx: infer Transaction) => unknown ? Transaction : never,
  raceId: string, classId: string) {
  const [entries] = await tx.select({ entryCount: count() }).from(schema.entries).where(and(
    eq(schema.entries.raceId, raceId), eq(schema.entries.classId, classId)
  ));
  const [results] = await tx.select({ resultRevisionCount: count() }).from(schema.resultRevisions)
    .innerJoin(schema.entries, and(eq(schema.entries.id, schema.resultRevisions.entryId),
      eq(schema.entries.raceId, schema.resultRevisions.raceId)))
    .where(and(eq(schema.entries.raceId, raceId), eq(schema.entries.classId, classId)));
  return { entryCount: Number(entries?.entryCount ?? 0), resultRevisionCount: Number(results?.resultRevisionCount ?? 0) };
}

export async function previewManualCourseVersionClassRelinkAsAdministrator(db: Database, input: PreviewInput, now = new Date()) {
  if (!uuid.test(input.raceId) || !uuid.test(input.classId)) return { status: "invalid-request" as const };
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability: "MANAGE_RACE" }, now);
    if (auth.status !== "authenticated") return auth;
    const [row] = await tx.select({ courseId: schema.courses.id, courseName: schema.courses.name, className: schema.classes.name,
      snapshotVersion: schema.races.snapshotVersion, classCourseVersionId: schema.courseVersions.id,
      classCourseVersion: schema.courseVersions.version }).from(schema.classes)
      .innerJoin(schema.races, eq(schema.races.id, schema.classes.raceId))
      .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
      .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
      .where(and(eq(schema.classes.id, input.classId), eq(schema.classes.raceId, input.raceId),
        isNull(schema.classes.externalSource), isNull(schema.classes.externalId),
        isNull(schema.courses.externalSource), isNull(schema.courses.externalId)));
    if (!row) return { status: "not-found" as const };
    const controls = await tx.select({ code: schema.controls.code }).from(schema.courseControls)
      .innerJoin(schema.controls, eq(schema.controls.id, schema.courseControls.controlId))
      .where(eq(schema.courseControls.courseVersionId, row.classCourseVersionId)).orderBy(schema.courseControls.sequence);
    const impact = await countClassImpact(tx, input.raceId, input.classId);
    if (impact.entryCount > 10000) return { status: "too-large" as const };
    return { status: "ok" as const, response: manualCourseVersionClassRelinkPreviewSchema.parse({ formatVersion: 1,
      raceId: input.raceId, classId: input.classId, ...row, controlCodes: controls.map(control => control.code),
      ...impact, canRelink: impact.resultRevisionCount === 0, generatedAt: now.toISOString() }) };
  }, { isolationLevel: "repeatable read" });
}

export async function relinkManualCourseVersionClassAsAdministrator(db: Database, input: Input, now = new Date()) {
  const parsed = manualCourseVersionClassRelinkRequestSchema.safeParse(input.request);
  const key = manualCourseVersionClassRelinkIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!parsed.success || !key.success || key.data.slice("manual-course-version-link:".length) !== parsed.data.requestId || !uuid.test(input.raceId)) {
    return { status: "invalid-request" as const };
  }
  const authentication = { ...input, capability: "MANAGE_RACE" as const, requireCsrf: true };
  const initial = await authenticatePairingAdminSession(db, authentication, now);
  if (initial.status !== "authenticated") return initial;
  const intent = parsed.data;
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForMutation(tx, input.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'manual-course-version-link:' + intent.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.manualCourseVersionClassRelinkRequests)
      .where(eq(schema.manualCourseVersionClassRelinkRequests.requestId, intent.requestId));
    if (prior) {
      const original = manualCourseVersionClassRelinkRequestSchema.parse(prior.request);
      const response = manualCourseVersionClassRelinkResponseSchema.parse(prior.response);
      if (prior.raceId !== input.raceId || prior.actorCredentialId !== auth.principal.accessCredentialId ||
          JSON.stringify(original) !== JSON.stringify(intent) || prior.courseId !== response.courseId || prior.classId !== response.classId ||
          prior.previousCourseVersionId !== response.previousCourseVersionId || prior.courseVersionId !== response.courseVersionId ||
          response.raceId !== prior.raceId || response.requestId !== prior.requestId || response.replayed ||
          JSON.stringify(response.request) !== JSON.stringify(original)) return { status: "conflict" as const };
      return { status: "changed" as const, response: { ...response, replayed: true } };
    }
    if (race.snapshotVersion !== intent.expectedSnapshotVersion || race.snapshotVersion >= 2_147_483_647) return { status: "conflict" as const };
    const [current] = await tx.select({ courseName: schema.courses.name, className: schema.classes.name,
      previousCourseVersionId: schema.courseVersions.id, previousCourseVersion: schema.courseVersions.version })
      .from(schema.classes).innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
      .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
      .where(and(eq(schema.classes.id, intent.classId), eq(schema.classes.raceId, input.raceId),
        eq(schema.courses.id, intent.courseId), eq(schema.courseVersions.id, intent.expectedClassCourseVersionId),
        isNull(schema.classes.externalSource), isNull(schema.classes.externalId), isNull(schema.courses.externalSource), isNull(schema.courses.externalId)));
    if (!current) return { status: "not-found" as const };
    const impact = await countClassImpact(tx, input.raceId, intent.classId);
    if (impact.entryCount > 10000) return { status: "too-large" as const };
    if (impact.resultRevisionCount !== 0) return { status: "results-exist" as const };
    const [latest] = await tx.select({ version: max(schema.courseVersions.version) }).from(schema.courseVersions)
      .where(eq(schema.courseVersions.courseId, intent.courseId));
    const nextVersion = (latest?.version ?? 0) + 1;
    if (nextVersion <= current.previousCourseVersion || nextVersion > 2_147_483_647) return { status: "conflict" as const };
    const [courseVersion] = await tx.insert(schema.courseVersions).values({ courseId: intent.courseId, version: nextVersion }).returning();
    if (!courseVersion) throw new Error("Banversionen kunde inte skapas");
    for (const [index, code] of intent.controlCodes.entries()) {
      await tx.insert(schema.controls).values({ raceId: input.raceId, code }).onConflictDoNothing();
      const [control] = await tx.select({ id: schema.controls.id }).from(schema.controls).where(and(
        eq(schema.controls.raceId, input.raceId), eq(schema.controls.code, code)
      ));
      if (!control) throw new Error("Kontrollen kunde inte skapas");
      await tx.insert(schema.courseControls).values({ courseVersionId: courseVersion.id, controlId: control.id, sequence: index + 1 });
    }
    const response = manualCourseVersionClassRelinkResponseSchema.parse({ formatVersion: 1, replayed: false,
      requestId: intent.requestId, raceId: input.raceId, courseId: intent.courseId, classId: intent.classId,
      previousCourseVersionId: current.previousCourseVersionId, previousCourseVersion: current.previousCourseVersion,
      courseVersionId: courseVersion.id, courseVersion: courseVersion.version, request: intent, entryCount: impact.entryCount,
      snapshotVersionBefore: race.snapshotVersion, snapshotVersionAfter: race.snapshotVersion + 1, changedAt: now.toISOString() });
    await tx.update(schema.classes).set({ courseVersionId: courseVersion.id }).where(eq(schema.classes.id, intent.classId));
    await tx.update(schema.races).set({ snapshotVersion: response.snapshotVersionAfter }).where(eq(schema.races.id, input.raceId));
    await tx.insert(schema.manualCourseVersionClassRelinkRequests).values({ requestId: intent.requestId, raceId: input.raceId,
      courseId: intent.courseId, classId: intent.classId, previousCourseVersionId: current.previousCourseVersionId,
      courseVersionId: courseVersion.id, actorCredentialId: auth.principal.accessCredentialId, capability: "MANAGE_RACE", request: intent, response });
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "class", entityId: intent.classId,
      requestId: intent.requestId, actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId,
      action: "MANUAL_COURSE_VERSION_LINKED_BY_ADMIN", before: { courseId: intent.courseId, courseVersionId: current.previousCourseVersionId,
        courseVersion: current.previousCourseVersion, snapshotVersion: race.snapshotVersion },
      after: { courseVersionId: courseVersion.id, courseVersion: courseVersion.version, controlCodes: intent.controlCodes,
        entryCount: impact.entryCount, snapshotVersion: response.snapshotVersionAfter }, createdAt: now });
    return { status: "changed" as const, response };
  });
}
