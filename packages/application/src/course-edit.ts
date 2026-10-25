import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import {
  courseEditIdempotencyKeySchema, courseEditListResponseSchema, courseEditPreviewRequestSchema,
  courseEditPreviewResponseSchema, courseEditRequestSchema, courseEditResponseSchema,
  type CourseEditListResponse, type CourseEditPreviewResponse, type CourseEditResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  courseForkingFairness, courseVariantForReadout, forkingControlSet, sameControlCodes, unevenCourseVariantLegs, withProposedCourseVersion,
  withProposedEntryVariants, type CourseForking, type RaceSnapshot
} from "@o-tid/domain";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { bumpReadoutPackageVersion, loadRaceSnapshot } from "./snapshot";
import {
  assessReadOutEntries, countManualDecisions, normalizedReadout, recalculateAssessedEntries, summarizeAssessment, type AssessedEntry
} from "./result-reassessment";
import {
  insertCourseVersionControls, loadCourseVersionVariants, planVariantDistribution, writeEntryVariants, type StoredCourseVariant
} from "./course-variants";
import { courseForkingView, loadCourseVersionForking, planForkingSave, type ForkingSavePlan } from "./course-forking";
import { loadCoursePositions, withPositionLengths } from "./course-positions";
import { PLACEHOLDER_COURSE } from "./source-sync-model";
import { loadRogainingSetup } from "./rogaining";
import { UUID_PATTERN as uuid } from "./serialization";

/**
 * Redigera bana (ADR-0169 beslut 4): ändra en banas kontrollföljd, även när
 * löpare har läst ut. Före sparande prövas varje avläsning mot den nya
 * kontrollföljden med resultatmotorn. Vid sparande skapas en ny banversion,
 * alla klasser på banans gällande version flyttas dit, tävlingens version ökar
 * ett steg och berörda resultat räknas om med nya revisioner – allt i en
 * transaktion. Råa avläsningar och äldre revisioner ändras aldrig.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Authentication = RaceSessionProof;

async function loadCourse(tx: Transaction, raceId: string, courseId: string) {
  const [course] = await tx.select({ id: schema.courses.id, name: schema.courses.name, lengthMeters: schema.courses.lengthMeters,
    climbMeters: schema.courses.climbMeters, forkingMode: schema.courses.forkingMode }).from(schema.courses)
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
  const forking = (await loadCourseVersionForking(tx, [version.id])).get(version.id);
  const positions = await loadCoursePositions(tx, raceId, course.id, [...controls.map(row => row.code),
    ...variants.flatMap(variant => variant.controlCodes), ...(forking ? forkingControlSet(forking) : [])]);
  // Steg 49: en variant utan längd i banfilen får längden ur kontrollernas lägen när alla är kända.
  return { ...course, raceId, version, controlCodes: controls.map(row => row.code), variants: withPositionLengths(variants, positions), forking,
    positions, classes };
}
type LoadedCourse = NonNullable<Awaited<ReturnType<typeof loadCourse>>>;

/**
 * Gafflad bana: varianten som ändras måste finnas och banan behåller alla varianter.
 * Bana utan varianter: ingen variant får anges. Ger varianternas nya kontrollföljder,
 * eller undefined när begäran inte passar banan.
 */
type EditPlan = { variants: StoredCourseVariant[]; currentControlCodes: readonly number[]; controlCodes: readonly number[];
  forking?: ForkingSavePlan };

async function proposedVariants(tx: Transaction, course: LoadedCourse, request: { variantCode?: string | undefined; controlCodes?: number[] | undefined;
  forking?: CourseForking | undefined }): Promise<EditPlan | undefined> {
  // Steg 49: en ny struktur ersätter banans kontroller och varianter. Samma struktur igen är ingen ändring.
  if (request.forking) {
    const plan = planForkingSave(course.variants, request.forking);
    if (!plan || (course.forking && JSON.stringify(course.forking) === JSON.stringify(plan.forking))) return undefined;
    if (!plan.forking && sameControlCodes(course.controlCodes, plan.controlCodes) && course.variants.length === 0) return undefined;
    const positions = await loadCoursePositions(tx, course.raceId, course.id, forkingControlSet(request.forking));
    return { variants: withPositionLengths(plan.variants, positions), currentControlCodes: course.controlCodes, controlCodes: plan.controlCodes,
      forking: plan };
  }
  const controlCodes = request.controlCodes ?? [];
  const variantCode = request.variantCode;
  if (sameControlCodes(course.variants.find(variant => variant.code === variantCode)?.controlCodes ??
    (variantCode === undefined ? course.controlCodes : []), controlCodes)) return undefined;
  if (course.variants.length === 0) return variantCode === undefined ? { variants: [], currentControlCodes: course.controlCodes, controlCodes } : undefined;
  const current = course.variants.find(variant => variant.code === variantCode);
  if (!current) return undefined;
  // En ändrad variant har ingen känd längd längre.
  return { currentControlCodes: current.controlCodes, controlCodes,
    variants: withPositionLengths(course.variants.map(variant => variant.code === variantCode
      ? { code: variant.code, controlCodes: [...controlCodes], lengthMeters: null } : variant), course.positions) };
}

/** Löparnas koder när strukturen sparas: samma kontrollföljd under ny kod, null när kontrollföljden försvinner. */
function entryCodeChanges(snapshot: RaceSnapshot, course: LoadedCourse, plan: EditPlan): Map<string, string | null> {
  const changes = new Map<string, string | null>();
  if (!plan.forking) return changes;
  const classIds = new Set(course.classes.map(row => row.id));
  for (const entry of snapshot.entries) {
    if (!classIds.has(entry.classId) || entry.courseVariantCode === undefined) continue;
    const next = plan.forking.codeMap.has(entry.courseVariantCode) ? plan.forking.codeMap.get(entry.courseVariantCode)! : null;
    if (next !== entry.courseVariantCode) changes.set(entry.id, next);
  }
  return changes;
}

/** Prövar varje avläst löpare på banans klasser mot den föreslagna kontrollföljden. */
async function assess(tx: Transaction, raceId: string, course: LoadedCourse, base: RaceSnapshot,
  controlCodes: readonly number[], variants: readonly StoredCourseVariant[], entryCodes: ReadonlyMap<string, string | null> = new Map())
  : Promise<AssessedEntry[] | "too-large"> {
  const forked = variants.length > 0;
  // Löpare vars kontrollföljd försvinner bedöms mot varianten som stämplingarna passar (samma som fördelningen ger dem).
  const snapshot = entryCodes.size > 0 ? withProposedEntryVariants(base, entryCodes) : base;
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

function previewResponse(raceId: string, course: LoadedCourse, snapshotVersion: number, plan: EditPlan,
  variantCode: string | undefined, assessed: AssessedEntry[], entryCodes: ReadonlyMap<string, string | null>): CourseEditPreviewResponse {
  const forking = plan.forking && { variants: plan.forking.variants.map(variant => ({ code: variant.code, controlCodes: [...variant.controlCodes],
    previousCode: variant.previousCode })), removedCodes: [...plan.forking.removedCodes],
    renamedEntryCount: [...entryCodes.values()].filter(code => code !== null).length,
    reassignedEntryCount: plan.forking.variants.length === 0 ? 0 : [...entryCodes.values()].filter(code => code === null).length };
  return courseEditPreviewResponseSchema.parse({ formatVersion: 1, raceId, courseId: course.id, courseName: course.name,
    snapshotVersion, ...(variantCode === undefined ? {} : { variantCode }), currentControlCodes: plan.currentControlCodes,
    controlCodes: plan.forking ? [] : plan.controlCodes, ...(forking ? { forking } : {}),
    ...summarizeAssessment(assessed), manualDecisionCount: countManualDecisions(assessed) });
}

export type CourseEditListResult = { status: "unauthorized" | "forbidden" } | { status: "ok"; response: CourseEditListResponse };

/** Banor med kontroller, klasser, anmälda och avlästa – underlaget för tabellen i Banor. */
export async function listCoursesForEditAsAdmin(db: Database, input: Authentication, now = new Date()): Promise<CourseEditListResult> {
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
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
          readOutCount: onVariant.filter(row => readEntries.has(row.id)).length, lengthMeters: variant.lengthMeters ?? null };
      });
      // Steg 49: bilden (sparad eller härledd struktur) och rättvisekontrollen per gafflingssätt.
      const forking = courseForkingView(course.variants, course.forking);
      const fairness = course.variants.length === 0 ? undefined : courseForkingFairness({ mode: course.forkingMode, variants: course.variants,
        forking: course.forking ?? null });
      rows.push({ courseId: course.id, courseVersionId: course.version.id, name: course.name, controlCodes: course.controlCodes,
        lengthMeters: course.lengthMeters, climbMeters: course.climbMeters,
        classes: course.classes.map(row => ({ classId: row.id, name: row.name })), entryCount: courseEntries.length,
        readOutCount: courseEntries.filter(row => readEntries.has(row.id)).length, variants,
        unevenLegs: unevenCourseVariantLegs(course.variants), ...(forking ? { forking, forkingMode: course.forkingMode } : {}),
        ...(fairness ? { fairness: { level: fairness.level, warningLegs: fairness.warningLegs, noticeLegs: fairness.noticeLegs,
          shortestMeters: fairness.shortestMeters, longestMeters: fairness.longestMeters } } : {}) });
    }
    rows.sort((left, right) => left.name.localeCompare(right.name, "sv-SE") || (left.courseId < right.courseId ? -1 : 1));
    // Klasserna som tabell: varje klass med sin bana, startsätt och läge.
    const resultEntries = new Set((await tx.selectDistinct({ entryId: schema.resultRevisions.entryId }).from(schema.resultRevisions)
      .where(and(eq(schema.resultRevisions.raceId, raceId), eq(schema.resultRevisions.published, true)))).map(row => row.entryId));
    const classRows = await tx.select({ id: schema.classes.id, name: schema.classes.name, startRule: schema.classes.startRule,
      courseId: schema.courseVersions.courseId, courseVersionId: schema.classes.courseVersionId,
      externalSource: schema.classes.externalSource, externalId: schema.classes.externalId, maxTimeMinutes: schema.classes.maxTimeMinutes,
      rogainingTimeLimitSeconds: schema.classes.rogainingTimeLimitSeconds })
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
        maxTimeMinutes: row.maxTimeMinutes, rogaining: row.rogainingTimeLimitSeconds !== null,
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
export async function previewCourseEditAsAdmin(db: Database, input: Authentication & { courseId: string; request: unknown },
  now = new Date()): Promise<CourseEditPreviewResult> {
  const parsed = courseEditPreviewRequestSchema.safeParse(input.request);
  if (!parsed.success || !uuid.test(input.raceId) || !uuid.test(input.courseId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const race = await lockRaceForSnapshot(tx, raceId);
    const course = await loadCourse(tx, raceId, input.courseId);
    if (!course) return { status: "not-found" };
    const plan = await proposedVariants(tx, course, parsed.data);
    if (!plan) return { status: "invalid-request" };
    const snapshot = await loadRaceSnapshot(tx, raceId);
    const entryCodes = entryCodeChanges(snapshot, course, plan);
    const assessed = await assess(tx, raceId, course, snapshot, plan.controlCodes, plan.variants, entryCodes);
    if (assessed === "too-large") return { status: "too-large" };
    return { status: "ok", response: previewResponse(raceId, course, race.snapshotVersion, plan,
      parsed.data.variantCode, onVariant(assessed, snapshot, parsed.data.variantCode), entryCodes) };
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
export async function editCourseAsAdmin(db: Database, input: Authentication & { idempotencyKey: string | null; request: unknown },
  now = new Date()): Promise<CourseEditResult> {
  const parsed = courseEditRequestSchema.safeParse(input.request);
  const key = courseEditIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!parsed.success || !key.success || key.data !== `course-edit:${parsed.data.requestId}` || !uuid.test(input.raceId)) {
    return { status: "invalid-request" };
  }
  const intent = parsed.data;
  const authentication = { ...input, role: "ADMIN" as const, requireCsrf: true };
  const initial = await requireRaceRole(db, authentication, now);
  if (initial.status !== "authenticated") return initial;
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, authentication, now, "update");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const race = await lockRaceForMutation(tx, raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"course-edit:" + intent.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.courseEditRequests).where(eq(schema.courseEditRequests.requestId, intent.requestId));
    if (prior) {
      const response = courseEditResponseSchema.parse(prior.response);
      if (prior.raceId !== raceId || prior.actorAccountId !== auth.principal.accountId || response.replayed ||
          JSON.stringify(courseEditRequestSchema.parse(prior.request)) !== JSON.stringify(intent)) return { status: "conflict" };
      return { status: "edited", response: { ...response, replayed: true } };
    }
    if (race.snapshotVersion >= 2_147_483_647) return { status: "conflict" };
    const course = await loadCourse(tx, raceId, intent.courseId);
    if (!course) return { status: "not-found" };
    const plan = await proposedVariants(tx, course, intent);
    if (!plan) return { status: "invalid-request" };
    if (course.classes.length > 0) {
      await tx.select({ id: schema.entries.id }).from(schema.entries).where(and(eq(schema.entries.raceId, raceId),
        inArray(schema.entries.classId, course.classes.map(row => row.id)))).orderBy(asc(schema.entries.id)).for("update");
    }
    const before = await loadRaceSnapshot(tx, raceId);
    const entryCodes = entryCodeChanges(before, course, plan);
    const assessed = await assess(tx, raceId, course, before, plan.controlCodes, plan.variants, entryCodes);
    if (assessed === "too-large") return { status: "too-large" };
    const preview = previewResponse(raceId, course, race.snapshotVersion, plan, intent.variantCode,
      onVariant(assessed, before, intent.variantCode), entryCodes);
    if (preview.requiresConfirmation && !intent.confirmResultChanges) return { status: "confirmation-required", preview };

    const [latestVersion] = await tx.select({ version: max(schema.courseVersions.version) }).from(schema.courseVersions)
      .where(eq(schema.courseVersions.courseId, course.id));
    const nextVersion = (latestVersion?.version ?? 0) + 1;
    if (nextVersion > 2_147_483_647) return { status: "conflict" };
    // Steg 49: strukturen sparas med banversionen; en ändrad enskild variant tar bort den (varianterna redigeras då var för sig).
    const [courseVersion] = await tx.insert(schema.courseVersions).values({ courseId: course.id, version: nextVersion,
      forking: plan.forking?.forking ?? null }).returning();
    if (!courseVersion) throw new Error("Banversionen kunde inte skapas");
    // Gafflad bana: banans egen kontrollföljd är tom och alla varianter följer med till nya versionen.
    await insertCourseVersionControls(tx, raceId, courseVersion.id, plan.variants.length > 0 ? [] : plan.controlCodes, plan.variants);
    const classIds = course.classes.map(row => row.id);
    if (classIds.length > 0) {
      await tx.update(schema.classes).set({ courseVersionId: courseVersion.id })
        .where(and(eq(schema.classes.raceId, raceId), inArray(schema.classes.id, classIds)));
    }
    // Löparna behåller sin kontrollföljd under den nya koden; den vars kontrollföljd försvann får en ny variant
    // genom fördelningen (en avläst löpare den som stämplingarna passar).
    let reassigned = 0;
    if (entryCodes.size > 0) {
      await writeEntryVariants(tx, raceId, entryCodes);
      const open = new Set([...entryCodes].filter(([, code]) => code === null).map(([entryId]) => entryId));
      if (open.size > 0 && plan.variants.length > 0) {
        const seed = Number.parseInt(intent.requestId.replace(/-/g, "").slice(0, 8), 16) || 1;
        const planned = await planVariantDistribution(tx, raceId, classIds, seed, await loadRaceSnapshot(tx, raceId), open);
        await writeEntryVariants(tx, raceId, planned);
        reassigned = planned.size;
      }
    }
    const snapshotVersionAfter = race.snapshotVersion + 1;
    await bumpReadoutPackageVersion(tx, raceId);

    // Omräkning med den sparade banan. Databasen sätter varje ny revisions underlagshash.
    const snapshot = await loadRaceSnapshot(tx, raceId);
    const recalculated = await recalculateAssessedEntries(tx, { raceId, assessed, snapshot,
      snapshotVersion: snapshotVersionAfter, courseVersionId: courseVersion.id });
    const response = courseEditResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId, raceId,
      courseId: course.id, request: intent, previousCourseVersionId: course.version.id, courseVersionId: courseVersion.id,
      classIds, snapshotVersionBefore: race.snapshotVersion, snapshotVersionAfter, recalculated, editedAt: now.toISOString() });
    await tx.insert(schema.courseEditRequests).values({ requestId: intent.requestId, raceId, courseId: course.id,
      previousCourseVersionId: course.version.id, courseVersionId: courseVersion.id,
      actorAccountId: auth.principal.accountId, request: intent, response, editedAt: now });
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "course", entityId: course.id, requestId: intent.requestId,
      actorKind: "USER_ACCOUNT", actorId: auth.principal.accountId, action: "COURSE_EDITED_BY_ADMIN",
      before: { courseVersionId: course.version.id, controlCodes: plan.currentControlCodes, variantCode: intent.variantCode ?? null,
        variantCodes: course.variants.map(variant => variant.code), snapshotVersion: race.snapshotVersion },
      after: { courseVersionId: courseVersion.id, controlCodes: plan.controlCodes, variantCode: intent.variantCode ?? null, classIds,
        snapshotVersion: snapshotVersionAfter, recalculatedCount: recalculated.length,
        ...(plan.forking ? { forking: true, variantCodes: plan.variants.map(variant => variant.code), removedCodes: plan.forking.removedCodes,
          renamedEntryCount: [...entryCodes.values()].filter(code => code !== null).length, reassignedEntryCount: reassigned } : {}) }, createdAt: now });
    if (recalculated.length > 0) {
      await tx.insert(schema.auditEvents).values(recalculated.map(item => ({ raceId, entityType: "result_revision",
        entityId: item.resultRevisionId, action: "RESULT_RECALCULATED_AFTER_COURSE_EDIT", actorKind: "USER_ACCOUNT" as const,
        actorId: auth.principal.accountId, requestId: intent.requestId,
        after: { courseId: course.id, entryId: item.entryId, revision: item.revision, cause: "EXPLICIT_RECALCULATION" }, createdAt: now })));
    }
    return { status: "edited", response };
  });
}
