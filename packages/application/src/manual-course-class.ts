import { and, eq, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { manualCourseClassCreateIdempotencyKeySchema, manualCourseClassCreateRequestSchema, manualCourseClassCreateResponseSchema } from "@o-tid/contracts";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { lockRaceForMutation } from "./concurrency";
import { classNameTaken, courseNameTaken } from "./duplicate-names";
import { bumpReadoutPackageVersion } from "./snapshot";
import { UUID_PATTERN as uuid } from "./serialization";

type Input = RaceSessionProof & { idempotencyKey: string | null; request: unknown };

export async function createManualCourseClassAsAdmin(db: Database, input: Input, now = new Date()) {
  const parsed = manualCourseClassCreateRequestSchema.safeParse(input.request);
  const key = manualCourseClassCreateIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!parsed.success || !key.success || key.data.slice("manual-course-class-create:".length) !== parsed.data.requestId || !uuid.test(input.raceId)) return { status: "invalid-request" as const };
  const authentication = { ...input, role: "ADMIN" as const, requireCsrf: true };
  const initial = await requireRaceRole(db, authentication, now);
  if (initial.status !== "authenticated") return initial;
  const intent = parsed.data;
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, authentication, now, "update");
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForMutation(tx, input.raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'manual-course-class:' + intent.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.manualCourseClassCreateRequests)
      .where(eq(schema.manualCourseClassCreateRequests.requestId, intent.requestId));
    if (prior) {
      const original = manualCourseClassCreateRequestSchema.parse(prior.request);
      const response = manualCourseClassCreateResponseSchema.parse(prior.response);
      if (prior.raceId !== input.raceId || prior.actorAccountId !== auth.principal.accountId ||
        JSON.stringify(original) !== JSON.stringify(intent) || prior.courseId !== response.courseId ||
        prior.courseVersionId !== response.courseVersionId || prior.classId !== response.classId ||
        response.raceId !== prior.raceId || response.requestId !== prior.requestId || response.replayed ||
        JSON.stringify(response.request) !== JSON.stringify(original)) return { status: "conflict" as const };
      return { status: "created" as const, response: { ...response, replayed: true } };
    }
    if (race.snapshotVersion >= 2_147_483_647) return { status: "conflict" as const };
    const className = intent.className;
    if (await courseNameTaken(tx, input.raceId, intent.courseName) ||
      (className !== undefined && await classNameTaken(tx, input.raceId, className))) {
      return { status: "duplicate-name" as const };
    }
    const [course] = await tx.insert(schema.courses).values({ raceId: input.raceId, name: intent.courseName }).returning();
    if (!course) throw new Error("Banan kunde inte skapas");
    const [courseVersion] = await tx.insert(schema.courseVersions).values({ courseId: course.id, version: 1 }).returning();
    if (!courseVersion) throw new Error("Banversionen kunde inte skapas");
    for (const [index, code] of intent.controlCodes.entries()) {
      await tx.insert(schema.controls).values({ raceId: input.raceId, code }).onConflictDoNothing();
      const [control] = await tx.select({ id: schema.controls.id }).from(schema.controls).where(and(
        eq(schema.controls.raceId, input.raceId), eq(schema.controls.code, code)
      ));
      if (!control) throw new Error("Kontrollen kunde inte skapas");
      await tx.insert(schema.courseControls).values({ courseVersionId: courseVersion.id, controlId: control.id, sequence: index + 1 });
    }
    // Steg 55: utan klassnamn skapas bara banan; en klass läggs till senare under Klasser.
    let classId: string | null = null;
    if (className !== undefined) {
      const [raceClass] = await tx.insert(schema.classes).values({ raceId: input.raceId, name: className,
        courseVersionId: courseVersion.id, startRule: intent.startRule ?? "PUNCH",
        // Rogainingtävling (ADR-0170 beslut 5): klassen bedöms på poäng med tidsgräns och straff.
        ...(intent.rogaining ? { rogainingTimeLimitSeconds: intent.rogaining.timeLimitMinutes * 60,
          rogainingPenaltyPointsPerMinute: intent.rogaining.penaltyPoints } : {}) }).returning();
      if (!raceClass) throw new Error("Klassen kunde inte skapas");
      classId = raceClass.id;
    }
    const response = manualCourseClassCreateResponseSchema.parse({ formatVersion: 1, replayed: false,
      requestId: intent.requestId, raceId: input.raceId, courseId: course.id, courseVersionId: courseVersion.id,
      classId, request: intent, snapshotVersionBefore: race.snapshotVersion,
      snapshotVersionAfter: race.snapshotVersion + 1, createdAt: now.toISOString() });
    await bumpReadoutPackageVersion(tx, input.raceId);
    await tx.insert(schema.manualCourseClassCreateRequests).values({ requestId: intent.requestId, raceId: input.raceId,
      courseId: course.id, courseVersionId: courseVersion.id, classId,
      actorAccountId: auth.principal.accountId, request: intent, response });
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: classId ? "class" : "course",
      entityId: classId ?? course.id, requestId: intent.requestId, actorKind: "USER_ACCOUNT", actorId: auth.principal.accountId,
      action: classId ? "MANUAL_COURSE_CLASS_CREATED_BY_ADMIN" : "MANUAL_COURSE_CREATED_BY_ADMIN",
      before: { snapshotVersion: race.snapshotVersion },
      after: { courseId: course.id, courseVersionId: courseVersion.id, classId,
        startRule: intent.startRule ?? null, controlCodes: intent.controlCodes, rogaining: intent.rogaining ?? null,
        snapshotVersion: response.snapshotVersionAfter }, createdAt: now });
    return { status: "created" as const, response };
  });
}
