import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import {
  courseEditIdempotencyKeySchema, courseEditListResponseSchema, courseEditPreviewRequestSchema,
  courseEditPreviewResponseSchema, courseEditRequestSchema, courseEditResponseSchema,
  type CourseEditListResponse, type CourseEditPreviewResponse, type CourseEditResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  courseVariantForReadout, sameControlCodes, unevenCourseVariantLegs, withProposedCourseVersion, type RaceSnapshot
} from "@o-tid/domain";
import {
  authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { loadRaceSnapshot } from "./snapshot";
import {
  assessReadOutEntries, normalizedReadout, recalculateAssessedEntries, summarizeAssessment, type AssessedEntry
} from "./result-reassessment";
import { insertCourseVersionControls, loadCourseVersionVariants, type StoredCourseVariant } from "./course-variants";
import { PLACEHOLDER_COURSE } from "./source-sync-model";
import { loadRogainingSetup } from "./rogaining";

/**
 * Redigera bana (ADR-0169 beslut 4): ändra en banas kontrollföljd, även när
 * löpare har läst ut. Före sparande prövas varje avläsning mot den nya
 * kontrollföljden med resultatmotorn. Vid sparande skapas en ny banversion,
 * alla klasser på banans gällande version flyttas dit, tävlingens version ökar
 * ett steg och berörda resultat räknas om med nya revisioner – allt i en
 * transaktion. Råa avläsningar och äldre revisioner ändras aldrig.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
const capability = "MANAGE_RACE" as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function loadCourse(tx: Transaction, raceId: string, courseId: string) {
  const [course] = await tx.select({ id: schema.courses.id, name: schema.courses.name }).from(schema.courses)
    .where(and(eq(schema.courses.id, courseId), eq(schema.courses.raceId, raceId)));
  if (!course) return null;
  const [version] = await tx.select({ id: schema.courseVersions.id, version: schema.courseVersions.version })
    .from(schema.courseVersions).where(eq(schema.courseVersions.courseId, course.id))
    .orderBy(desc(schema.courseVersions.version), desc(schema.courseVersions.id)).limit(1);
  if (!version) return null;
  const controls = await tx.select({ code: schema.controls.code }).from(schema.courseControls)
    .innerJoin(schema.controls, eq(schema.controls.id, schema.courseControls.controlId))
    .where(eq(schema.courseControls.courseVersionId, version.id)).orderBy(asc(schema.courseControls.sequence));
  const classes = await tx.select({ id: schema.classes.id, name: schema.classes.name }).from(schema.classes)
    .where(and(eq(schema.classes.raceId, raceId), eq(schema.classes.courseVersionId, version.id)))
    .orderBy(asc(schema.classes.name), asc(schema.classes.id));
  const variants = (await loadCourseVersionVariants(tx, [version.id])).get(version.id) ?? [];
  return { ...course, version, controlCodes: controls.map(row => row.code), variants, classes };
}
type LoadedCourse = NonNullable<Awaited<ReturnType<typeof loadCourse>>>;

/**
 * Gafflad bana: varianten som ändras måste finnas och banan behåller alla varianter.
 * Bana utan varianter: ingen variant får anges. Ger varianternas nya kontrollföljder,
 * eller undefined när begäran inte passar banan.
 */
function proposedVariants(course: LoadedCourse, variantCode: string | undefined, controlCodes: readonly number[])
  : { variants: StoredCourseVariant[]; currentControlCodes: readonly number[] } | undefined {
  if (course.variants.length === 0) return variantCode === undefined ? { variants: [], currentControlCodes: course.controlCodes } : undefined;
  const current = course.variants.find(variant => variant.code === variantCode);
  if (!current) return undefined;
  return { currentControlCodes: current.controlCodes,
    variants: course.variants.map(variant => variant.code === variantCode ? { code: variant.code, controlCodes: [...controlCodes] } : variant) };
}

/** Prövar varje avläst löpare på banans klasser mot den föreslagna kontrollföljden. */
async function assess(tx: Transaction, raceId: string, course: LoadedCourse, snapshot: RaceSnapshot,
  controlCodes: readonly number[], variants: readonly StoredCourseVariant[]): Promise<AssessedEntry[] | "too-large"> {
  const forked = variants.length > 0;
  const proposed = withProposedCourseVersion(snapshot, course.id, course.version.id,
    { id: randomUUID(), version: course.version.version + 1, createdAt: new Date(0).toISOString(),
      controlCodes: forked ? [] : controlCodes, ...(forked ? { variants } : {}) });
  return assessReadOutEntries(tx, raceId, course.classes, snapshot, proposed);
}

/**
 * Beskedet för en ändrad variant gäller löparna som springer den: tilldelade eller,
 * utan tilldelning, de vars stämplingar passar varianten. Alla avlästa på banan räknas
 * ändå om vid sparande eftersom banan får en ny version.
 */
function onVariant(assessed: readonly AssessedEntry[], snapshot: RaceSnapshot, variantCode: string | undefined): AssessedEntry[] {
  if (variantCode === undefined) return [...assessed];
  return assessed.filter(row => courseVariantForReadout(normalizedReadout(row.readout), snapshot)?.code === variantCode);
}

function previewResponse(raceId: string, course: LoadedCourse, snapshotVersion: number, controlCodes: number[],
  variantCode: string | undefined, currentControlCodes: readonly number[], assessed: AssessedEntry[]): CourseEditPreviewResponse {
  return courseEditPreviewResponseSchema.parse({ formatVersion: 1, raceId, courseId: course.id, courseName: course.name,
    snapshotVersion, ...(variantCode === undefined ? {} : { variantCode }), currentControlCodes, controlCodes,
    ...summarizeAssessment(assessed) });
}

export type CourseEditListResult = { status: "unauthorized" | "forbidden" } | { status: "ok"; response: CourseEditListResponse };

/** Banor med kontroller, klasser, anmälda och avlästa – underlaget för tabellen i Banor. */
export async function listCoursesForEditAsAdministrator(db: Database, input: Authentication, now = new Date()): Promise<CourseEditListResult> {
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const race = await lockRaceForSnapshot(tx, raceId);
    const courses = await tx.select({ id: schema.courses.id, externalSource: schema.courses.externalSource,
      externalId: schema.courses.externalId }).from(schema.courses).where(eq(schema.courses.raceId, raceId));
    const placeholder = new Set(courses.filter(row => row.externalSource === PLACEHOLDER_COURSE.externalSource &&
      row.externalId === PLACEHOLDER_COURSE.externalId).map(row => row.id));
    const entries = await tx.select({ id: schema.entries.id, classId: schema.entries.classId,
      fixedStartTime: schema.entries.fixedStartTime, teamId: schema.entries.teamId }).from(schema.entries).where(eq(schema.entries.raceId, raceId));
    const assignments = await tx.select({ entryId: schema.cardAssignments.entryId, cardNumber: schema.cardAssignments.cardNumber })
      .from(schema.cardAssignments).where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.active, true)));
    const readCards = new Set((await tx.selectDistinct({ cardNumber: schema.cardReadouts.cardNumber }).from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId))).map(row => row.cardNumber));
    const readEntries = new Set(assignments.filter(row => readCards.has(row.cardNumber)).map(row => row.entryId));
    const entryVariants = new Map((await tx.select({ id: schema.entries.id, code: schema.entries.courseVariantCode })
      .from(schema.entries).where(eq(schema.entries.raceId, raceId))).map(row => [row.id, row.code]));
    const rows = [];
    for (const { id } of courses) {
      const course = await loadCourse(tx, raceId, id);
      if (!course) continue;
      // Platshållaren för Eventor-klasser utan banfil visas bara så länge någon klass står på den.
      if (placeholder.has(course.id) && course.classes.length === 0) continue;
      const classIds = new Set(course.classes.map(row => row.id));
      const courseEntries = entries.filter(row => classIds.has(row.classId));
      const variants = course.variants.map(variant => {
        const onVariant = courseEntries.filter(row => entryVariants.get(row.id) === variant.code);
        return { code: variant.code, controlCodes: [...variant.controlCodes], entryCount: onVariant.length,
          readOutCount: onVariant.filter(row => readEntries.has(row.id)).length };
      });
      rows.push({ courseId: course.id, courseVersionId: course.version.id, name: course.name, controlCodes: course.controlCodes,
        classes: course.classes.map(row => ({ classId: row.id, name: row.name })), entryCount: courseEntries.length,
        readOutCount: courseEntries.filter(row => readEntries.has(row.id)).length, variants,
        unevenLegs: unevenCourseVariantLegs(course.variants) });
    }
    rows.sort((left, right) => left.name.localeCompare(right.name, "sv-SE") || (left.courseId < right.courseId ? -1 : 1));
    // Klasserna som tabell: varje klass med sin bana, startsätt och läge.
    const resultEntries = new Set((await tx.selectDistinct({ entryId: schema.resultRevisions.entryId }).from(schema.resultRevisions)
      .where(and(eq(schema.resultRevisions.raceId, raceId), eq(schema.resultRevisions.published, true)))).map(row => row.entryId));
    const classRows = await tx.select({ id: schema.classes.id, name: schema.classes.name, startRule: schema.classes.startRule,
      courseId: schema.courseVersions.courseId, courseVersionId: schema.classes.courseVersionId,
      externalSource: schema.classes.externalSource, externalId: schema.classes.externalId })
      .from(schema.classes).innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
      .where(eq(schema.classes.raceId, raceId)).orderBy(asc(schema.classes.name), asc(schema.classes.id));
    const classVariants = await loadCourseVersionVariants(tx, classRows.map(row => row.courseVersionId));
    const classes = classRows.map(row => {
      const classEntries = entries.filter(entry => entry.classId === row.id);
      const codes = (classVariants.get(row.courseVersionId) ?? []).map(variant => variant.code);
      return { classId: row.id, name: row.name, courseId: row.courseId, startRule: row.startRule, entryCount: classEntries.length,
        readOutCount: classEntries.filter(entry => readEntries.has(entry.id)).length,
        resultCount: classEntries.filter(entry => resultEntries.has(entry.id)).length,
        // Stafettsträckor får sin start av masstart, växling eller omstart; de saknar inte starttid.
        missingStartTimeCount: row.startRule === "FIXED" ? classEntries.filter(entry => entry.fixedStartTime === null && entry.teamId === null).length : 0,
        renamable: row.externalSource === null && row.externalId === null, variantCount: codes.length,
        missingVariantCount: codes.length === 0 ? 0 : classEntries.filter(entry => {
          const code = entryVariants.get(entry.id);
          return code === null || code === undefined || !codes.includes(code);
        }).length };
    });
    // Kontroller & poäng (ADR-0170 beslut 5): koderna som banorna använder i dag.
    const rogaining = await loadRogainingSetup(tx, raceId, rows.flatMap(row => [...row.controlCodes,
      ...row.variants.flatMap(variant => variant.controlCodes)]));
    return { status: "ok", response: courseEditListResponseSchema.parse({ formatVersion: 1, raceId,
      snapshotVersion: race.snapshotVersion, courses: rows, classes, rogaining }) };
  });
}

export type CourseEditPreviewResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" | "too-large" }
  | { status: "ok"; response: CourseEditPreviewResponse };

/** Läser bara: vad händer med de avlästa löparnas resultat om banan får dessa kontroller? */
export async function previewCourseEditAsAdministrator(db: Database, input: Authentication & { courseId: string; request: unknown },
  now = new Date()): Promise<CourseEditPreviewResult> {
  const parsed = courseEditPreviewRequestSchema.safeParse(input.request);
  if (!parsed.success || !uuid.test(input.raceId) || !uuid.test(input.courseId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const race = await lockRaceForSnapshot(tx, raceId);
    if (race.snapshotVersion !== parsed.data.expectedSnapshotVersion) return { status: "conflict" };
    const course = await loadCourse(tx, raceId, input.courseId);
    if (!course) return { status: "not-found" };
    const plan = proposedVariants(course, parsed.data.variantCode, parsed.data.controlCodes);
    if (!plan || sameControlCodes(plan.currentControlCodes, parsed.data.controlCodes)) return { status: "invalid-request" };
    const snapshot = await loadRaceSnapshot(tx, raceId);
    const assessed = await assess(tx, raceId, course, snapshot, parsed.data.controlCodes, plan.variants);
    if (assessed === "too-large") return { status: "too-large" };
    return { status: "ok", response: previewResponse(raceId, course, race.snapshotVersion, parsed.data.controlCodes,
      parsed.data.variantCode, plan.currentControlCodes, onVariant(assessed, snapshot, parsed.data.variantCode)) };
  }, { isolationLevel: "repeatable read" });
}

export type CourseEditResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" | "too-large" }
  | { status: "confirmation-required"; preview: CourseEditPreviewResponse }
  | { status: "edited"; response: CourseEditResponse };

/**
 * Sparar ändringen. Om någon löpares status ändras krävs `confirmResultChanges`;
 * annars sparas direkt. Berörda resultat räknas om i samma transaktion.
 */
export async function editCourseAsAdministrator(db: Database, input: Authentication & { idempotencyKey: string | null; request: unknown },
  now = new Date()): Promise<CourseEditResult> {
  const parsed = courseEditRequestSchema.safeParse(input.request);
  const key = courseEditIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!parsed.success || !key.success || key.data !== `course-edit:${parsed.data.requestId}` || !uuid.test(input.raceId)) {
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
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"course-edit:" + intent.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.courseEditRequests).where(eq(schema.courseEditRequests.requestId, intent.requestId));
    if (prior) {
      const response = courseEditResponseSchema.parse(prior.response);
      if (prior.raceId !== raceId || prior.actorCredentialId !== auth.principal.accessCredentialId || response.replayed ||
          JSON.stringify(courseEditRequestSchema.parse(prior.request)) !== JSON.stringify(intent)) return { status: "conflict" };
      return { status: "edited", response: { ...response, replayed: true } };
    }
    if (race.snapshotVersion !== intent.expectedSnapshotVersion || race.snapshotVersion >= 2_147_483_647) return { status: "conflict" };
    const course = await loadCourse(tx, raceId, intent.courseId);
    if (!course) return { status: "not-found" };
    const plan = proposedVariants(course, intent.variantCode, intent.controlCodes);
    if (!plan || sameControlCodes(plan.currentControlCodes, intent.controlCodes)) return { status: "invalid-request" };
    if (course.classes.length > 0) {
      await tx.select({ id: schema.entries.id }).from(schema.entries).where(and(eq(schema.entries.raceId, raceId),
        inArray(schema.entries.classId, course.classes.map(row => row.id)))).orderBy(asc(schema.entries.id)).for("update");
    }
    const before = await loadRaceSnapshot(tx, raceId);
    const assessed = await assess(tx, raceId, course, before, intent.controlCodes, plan.variants);
    if (assessed === "too-large") return { status: "too-large" };
    const preview = previewResponse(raceId, course, race.snapshotVersion, intent.controlCodes, intent.variantCode,
      plan.currentControlCodes, onVariant(assessed, before, intent.variantCode));
    if (preview.requiresConfirmation && !intent.confirmResultChanges) return { status: "confirmation-required", preview };

    const [latestVersion] = await tx.select({ version: max(schema.courseVersions.version) }).from(schema.courseVersions)
      .where(eq(schema.courseVersions.courseId, course.id));
    const nextVersion = (latestVersion?.version ?? 0) + 1;
    if (nextVersion > 2_147_483_647) return { status: "conflict" };
    const [courseVersion] = await tx.insert(schema.courseVersions).values({ courseId: course.id, version: nextVersion }).returning();
    if (!courseVersion) throw new Error("Banversionen kunde inte skapas");
    // Gafflad bana: banans egen kontrollföljd är tom och alla varianter följer med till nya versionen.
    await insertCourseVersionControls(tx, raceId, courseVersion.id, plan.variants.length > 0 ? [] : intent.controlCodes, plan.variants);
    const classIds = course.classes.map(row => row.id);
    if (classIds.length > 0) {
      await tx.update(schema.classes).set({ courseVersionId: courseVersion.id })
        .where(and(eq(schema.classes.raceId, raceId), inArray(schema.classes.id, classIds)));
    }
    const snapshotVersionAfter = race.snapshotVersion + 1;
    await tx.update(schema.races).set({ snapshotVersion: snapshotVersionAfter }).where(eq(schema.races.id, raceId));

    // Omräkning med den sparade banan. Databasen sätter varje ny revisions underlagshash.
    const snapshot = await loadRaceSnapshot(tx, raceId);
    const recalculated = await recalculateAssessedEntries(tx, { raceId, assessed, snapshot,
      snapshotVersion: snapshotVersionAfter, courseVersionId: courseVersion.id });
    const response = courseEditResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId, raceId,
      courseId: course.id, request: intent, previousCourseVersionId: course.version.id, courseVersionId: courseVersion.id,
      classIds, snapshotVersionBefore: race.snapshotVersion, snapshotVersionAfter, recalculated, editedAt: now.toISOString() });
    await tx.insert(schema.courseEditRequests).values({ requestId: intent.requestId, raceId, courseId: course.id,
      previousCourseVersionId: course.version.id, courseVersionId: courseVersion.id,
      actorCredentialId: auth.principal.accessCredentialId, capability, request: intent, response, editedAt: now });
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "course", entityId: course.id, requestId: intent.requestId,
      actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId, action: "COURSE_EDITED_BY_ADMIN",
      before: { courseVersionId: course.version.id, controlCodes: plan.currentControlCodes, variantCode: intent.variantCode ?? null,
        snapshotVersion: race.snapshotVersion },
      after: { courseVersionId: courseVersion.id, controlCodes: intent.controlCodes, variantCode: intent.variantCode ?? null, classIds, snapshotVersion: snapshotVersionAfter,
        recalculatedCount: recalculated.length }, createdAt: now });
    if (recalculated.length > 0) {
      await tx.insert(schema.auditEvents).values(recalculated.map(item => ({ raceId, entityType: "result_revision",
        entityId: item.resultRevisionId, action: "RESULT_RECALCULATED_AFTER_COURSE_EDIT", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL" as const,
        actorId: auth.principal.accessCredentialId, requestId: intent.requestId,
        after: { courseId: course.id, entryId: item.entryId, revision: item.revision, cause: "EXPLICIT_RECALCULATION" }, createdAt: now })));
    }
    return { status: "edited", response };
  });
}
