import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  classEditIdempotencyKeySchema, classEditPreviewRequestSchema, classEditPreviewResponseSchema, classEditRequestSchema,
  classEditResponseSchema, type ClassEditPreviewResponse, type ClassEditResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { planClassStartRuleChange, withProposedClassSetup, type RaceSnapshot, type StartRule } from "@o-tid/domain";
import {
  authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { loadRaceSnapshot } from "./snapshot";
import { assessReadOutEntries, recalculateAssessedEntries, summarizeAssessment, type AssessedEntry } from "./result-reassessment";

/**
 * Redigera klass (ADR-0169 beslut 4): klassnamn, bana och startsätt ändras i
 * klasstabellens rad. Byte av bana flyttar klassen till banans gällande version.
 * Byte av startsätt tömmer klassens fasta starttider (som `planClassStartRuleChange`).
 * Före sparande prövas klassens avläsningar mot resultatmotorn; bekräftelse krävs
 * bara när någon löpares status ändras. Sparandet räknar om berörda resultat med
 * nya revisioner i samma transaktion. Råa avläsningar ändras aldrig.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
const capability = "MANAGE_RACE" as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_VERSION = 2_147_483_647;

async function loadClass(tx: Transaction, raceId: string, classId: string) {
  const [row] = await tx.select({ id: schema.classes.id, name: schema.classes.name, startRule: schema.classes.startRule,
    courseVersionId: schema.classes.courseVersionId, externalSource: schema.classes.externalSource,
    externalId: schema.classes.externalId }).from(schema.classes)
    .where(and(eq(schema.classes.id, classId), eq(schema.classes.raceId, raceId)));
  return row ?? null;
}

/** Banans gällande (senaste) version. */
async function loadTargetCourse(tx: Transaction, raceId: string, courseId: string) {
  const [course] = await tx.select({ id: schema.courses.id, name: schema.courses.name }).from(schema.courses)
    .where(and(eq(schema.courses.id, courseId), eq(schema.courses.raceId, raceId)));
  if (!course) return null;
  const [version] = await tx.select({ id: schema.courseVersions.id }).from(schema.courseVersions)
    .where(eq(schema.courseVersions.courseId, course.id))
    .orderBy(desc(schema.courseVersions.version), desc(schema.courseVersions.id)).limit(1);
  return version ? { ...course, courseVersionId: version.id } : null;
}

type LoadedClass = NonNullable<Awaited<ReturnType<typeof loadClass>>>;
type TargetCourse = NonNullable<Awaited<ReturnType<typeof loadTargetCourse>>>;

async function countClearedStartTimes(tx: Transaction, raceId: string, raceClass: LoadedClass, startRule: StartRule) {
  if (raceClass.startRule === startRule) return 0;
  const rows = await tx.select({ id: schema.entries.id }).from(schema.entries).where(and(eq(schema.entries.raceId, raceId),
    eq(schema.entries.classId, raceClass.id), sql`${schema.entries.fixedStartTime} IS NOT NULL`));
  return rows.length;
}

async function assess(tx: Transaction, raceId: string, raceClass: LoadedClass, target: TargetCourse, startRule: StartRule,
  snapshot: RaceSnapshot): Promise<AssessedEntry[] | "too-large"> {
  if (raceClass.courseVersionId === target.courseVersionId && raceClass.startRule === startRule) return [];
  const proposed = withProposedClassSetup(snapshot, { classId: raceClass.id, courseVersionId: target.courseVersionId, startRule });
  return assessReadOutEntries(tx, raceId, [raceClass], snapshot, proposed);
}

function previewResponse(raceId: string, raceClass: LoadedClass, target: TargetCourse, startRule: StartRule,
  snapshotVersion: number, clearedStartTimeCount: number, assessed: AssessedEntry[]): ClassEditPreviewResponse {
  return classEditPreviewResponseSchema.parse({ formatVersion: 1, raceId, classId: raceClass.id, className: raceClass.name,
    snapshotVersion, courseId: target.id, courseName: target.name, startRule, clearedStartTimeCount,
    ...summarizeAssessment(assessed) });
}

export type ClassEditPreviewResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" | "too-large" }
  | { status: "ok"; response: ClassEditPreviewResponse };

/** Läser bara: vad händer med klassens avlästa löpare med denna bana och detta startsätt? */
export async function previewClassEditAsAdministrator(db: Database, input: Authentication & { classId: string; request: unknown },
  now = new Date()): Promise<ClassEditPreviewResult> {
  const parsed = classEditPreviewRequestSchema.safeParse(input.request);
  if (!parsed.success || !uuid.test(input.raceId) || !uuid.test(input.classId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const race = await lockRaceForSnapshot(tx, raceId);
    if (race.snapshotVersion !== parsed.data.expectedSnapshotVersion) return { status: "conflict" };
    const raceClass = await loadClass(tx, raceId, input.classId);
    const target = await loadTargetCourse(tx, raceId, parsed.data.courseId);
    if (!raceClass || !target) return { status: "not-found" };
    const assessed = await assess(tx, raceId, raceClass, target, parsed.data.startRule, await loadRaceSnapshot(tx, raceId));
    if (assessed === "too-large") return { status: "too-large" };
    const cleared = await countClearedStartTimes(tx, raceId, raceClass, parsed.data.startRule);
    return { status: "ok", response: previewResponse(raceId, raceClass, target, parsed.data.startRule, race.snapshotVersion,
      cleared, assessed) };
  }, { isolationLevel: "repeatable read" });
}

export type ClassEditResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" | "too-large" }
  | { status: "confirmation-required"; preview: ClassEditPreviewResponse }
  | { status: "edited"; response: ClassEditResponse };

/**
 * Sparar ändringen. Om någon löpares status ändras krävs `confirmResultChanges`;
 * annars sparas direkt. Ett importerat klassnamn kan inte ändras här.
 */
export async function editClassAsAdministrator(db: Database, input: Authentication & { idempotencyKey: string | null; request: unknown },
  now = new Date()): Promise<ClassEditResult> {
  const parsed = classEditRequestSchema.safeParse(input.request);
  const key = classEditIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!parsed.success || !key.success || key.data !== `class-edit:${parsed.data.requestId}` || !uuid.test(input.raceId)) {
    return { status: "invalid-request" };
  }
  const intent = parsed.data;
  const authentication = { ...input, capability, requireCsrf: true };
  const initial = await authenticatePairingAdminSession(db, authentication, now);
  if (initial.status !== "authenticated") return initial;
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const race = await lockRaceForMutation(tx, raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"class-edit:" + intent.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.classEditRequests).where(eq(schema.classEditRequests.requestId, intent.requestId));
    if (prior) {
      const response = classEditResponseSchema.parse(prior.response);
      if (prior.raceId !== raceId || prior.actorCredentialId !== auth.principal.accessCredentialId || response.replayed ||
          JSON.stringify(classEditRequestSchema.parse(prior.request)) !== JSON.stringify(intent)) return { status: "conflict" };
      return { status: "edited", response: { ...response, replayed: true } };
    }
    if (race.snapshotVersion !== intent.expectedSnapshotVersion || race.snapshotVersion >= MAX_VERSION) return { status: "conflict" };
    const raceClass = await loadClass(tx, raceId, intent.classId);
    const target = await loadTargetCourse(tx, raceId, intent.courseId);
    if (!raceClass || !target) return { status: "not-found" };
    const renamed = raceClass.name !== intent.className;
    const moved = raceClass.courseVersionId !== target.courseVersionId;
    const startRuleChanged = raceClass.startRule !== intent.startRule;
    if (!renamed && !moved && !startRuleChanged) return { status: "invalid-request" };
    if (renamed && (raceClass.externalSource !== null || raceClass.externalId !== null)) return { status: "conflict" };

    const entries = await tx.select({ id: schema.entries.id, version: schema.entries.version, fixedStartTime: schema.entries.fixedStartTime,
      exactTime: sql<boolean>`${schema.entries.fixedStartTime} IS NULL OR date_trunc('milliseconds',${schema.entries.fixedStartTime}) = ${schema.entries.fixedStartTime}`
    }).from(schema.entries).where(and(eq(schema.entries.raceId, raceId), eq(schema.entries.classId, raceClass.id)))
      .orderBy(asc(schema.entries.id)).limit(10_001).for("update");
    if (entries.length > 10_000) return { status: "too-large" };
    if (entries.some(row => !row.exactTime || (startRuleChanged && row.version >= MAX_VERSION))) return { status: "conflict" };
    const assessed = await assess(tx, raceId, raceClass, target, intent.startRule, await loadRaceSnapshot(tx, raceId));
    if (assessed === "too-large") return { status: "too-large" };
    const plan = planClassStartRuleChange({ current: raceClass.startRule, target: intent.startRule,
      entries: entries.map(row => ({ id: row.id, version: row.version, fixedStartTime: row.fixedStartTime?.toISOString() ?? null })) });
    const preview = previewResponse(raceId, raceClass, target, intent.startRule, race.snapshotVersion, plan.clearedStartTimes, assessed);
    if (preview.requiresConfirmation && !intent.confirmResultChanges) return { status: "confirmation-required", preview };

    // Nytt startsätt tömmer starttiderna och därmed klassens lottning (PLAN.md steg 9).
    await tx.update(schema.classes).set({ name: intent.className, courseVersionId: target.courseVersionId, startRule: plan.startRule,
      ...(startRuleChanged ? { startDrawId: null } : {}) })
      .where(and(eq(schema.classes.id, raceClass.id), eq(schema.classes.raceId, raceId)));
    if (plan.changed) {
      await tx.update(schema.entries).set({ fixedStartTime: null, version: sql`${schema.entries.version} + 1` })
        .where(and(eq(schema.entries.raceId, raceId), eq(schema.entries.classId, raceClass.id)));
    }
    const snapshotVersionAfter = race.snapshotVersion + 1;
    await tx.update(schema.races).set({ snapshotVersion: snapshotVersionAfter }).where(eq(schema.races.id, raceId));

    // Omräkning med den sparade klassen. Databasen sätter varje ny revisions underlagshash.
    const recalculated = await recalculateAssessedEntries(tx, { raceId, assessed, snapshot: await loadRaceSnapshot(tx, raceId),
      snapshotVersion: snapshotVersionAfter, courseVersionId: target.courseVersionId });
    const response = classEditResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId, raceId,
      classId: raceClass.id, request: intent, previousClassName: raceClass.name, previousCourseVersionId: raceClass.courseVersionId,
      courseVersionId: target.courseVersionId, previousStartRule: raceClass.startRule, clearedStartTimeCount: plan.clearedStartTimes,
      snapshotVersionBefore: race.snapshotVersion, snapshotVersionAfter, recalculated, editedAt: now.toISOString() });
    await tx.insert(schema.classEditRequests).values({ requestId: intent.requestId, raceId, classId: raceClass.id,
      previousCourseVersionId: raceClass.courseVersionId, courseVersionId: target.courseVersionId,
      actorCredentialId: auth.principal.accessCredentialId, capability, request: intent, response, editedAt: now });
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "class", entityId: raceClass.id, requestId: intent.requestId,
      actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId, action: "CLASS_EDITED_BY_ADMIN",
      before: { className: raceClass.name, courseVersionId: raceClass.courseVersionId, startRule: raceClass.startRule,
        snapshotVersion: race.snapshotVersion },
      after: { className: intent.className, courseVersionId: target.courseVersionId, startRule: intent.startRule,
        snapshotVersion: snapshotVersionAfter, clearedStartTimeCount: plan.clearedStartTimes, recalculatedCount: recalculated.length },
      createdAt: now });
    if (recalculated.length > 0) {
      await tx.insert(schema.auditEvents).values(recalculated.map(item => ({ raceId, entityType: "result_revision",
        entityId: item.resultRevisionId, action: "RESULT_RECALCULATED_AFTER_CLASS_EDIT", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL" as const,
        actorId: auth.principal.accessCredentialId, requestId: intent.requestId,
        after: { classId: raceClass.id, entryId: item.entryId, revision: item.revision, cause: "EXPLICIT_RECALCULATION" }, createdAt: now })));
    }
    return { status: "edited", response };
  });
}
