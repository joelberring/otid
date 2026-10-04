import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, max, sql } from "drizzle-orm";
import {
  courseEditIdempotencyKeySchema, courseEditListResponseSchema, courseEditPreviewRequestSchema,
  courseEditPreviewResponseSchema, courseEditRequestSchema, courseEditResponseSchema,
  type CourseEditListResponse, type CourseEditPreviewResponse, type CourseEditResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  courseEditOutcome, evaluateCardReadout, RESULT_ENGINE_VERSION, sameControlCodes, summarizeCourseEdit,
  withProposedCourseVersion, type CourseEditOutcome, type EvaluationStatus, type NormalizedCardReadout, type RaceSnapshot
} from "@o-tid/domain";
import {
  authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { loadRaceSnapshot } from "./snapshot";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { appliedControlNeutralization } from "./class-control-neutralization";

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
type Readout = typeof schema.cardReadouts.$inferSelect;
type Revision = typeof schema.resultRevisions.$inferSelect;
const capability = "MANAGE_RACE" as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_ENTRIES = 10_000;

function normalized(readout: Readout): NormalizedCardReadout {
  return { id: readout.id, raceId: readout.raceId, cardNumber: readout.cardNumber,
    ...(readout.startPunchedAt ? { startPunchedAt: readout.startPunchedAt.toISOString() } : {}),
    ...(readout.finishPunchedAt ? { finishPunchedAt: readout.finishPunchedAt.toISOString() } : {}),
    punches: readout.punches, rawMessageId: readout.rawMessageId, readAt: readout.readAt.toISOString() };
}

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
  return { ...course, version, controlCodes: controls.map(row => row.code), classes };
}
type LoadedCourse = NonNullable<Awaited<ReturnType<typeof loadCourse>>>;

type AssessedEntry = {
  entryId: string; displayName: string; className: string; readout: Readout; latest: Revision | null;
  outcome: CourseEditOutcome | "NOT_RECALCULATED"; before: EvaluationStatus; after: EvaluationStatus; recalculate: boolean;
};

/** Prövar varje avläst löpare på banans klasser mot den föreslagna kontrollföljden. */
async function assess(tx: Transaction, raceId: string, course: LoadedCourse, snapshot: RaceSnapshot,
  controlCodes: readonly number[]): Promise<AssessedEntry[] | "too-large"> {
  const classIds = course.classes.map(row => row.id);
  if (classIds.length === 0) return [];
  const classNames = new Map(course.classes.map(row => [row.id, row.name]));
  const entries = await tx.select({ id: schema.entries.id, classId: schema.entries.classId,
    givenName: schema.entries.givenName, familyName: schema.entries.familyName }).from(schema.entries)
    .where(and(eq(schema.entries.raceId, raceId), inArray(schema.entries.classId, classIds)))
    .orderBy(asc(schema.entries.familyName), asc(schema.entries.givenName), asc(schema.entries.id)).limit(MAX_ENTRIES + 1);
  if (entries.length > MAX_ENTRIES) return "too-large";
  if (entries.length === 0) return [];
  const entryIds = entries.map(row => row.id);
  const assignments = await tx.select({ entryId: schema.cardAssignments.entryId, cardNumber: schema.cardAssignments.cardNumber })
    .from(schema.cardAssignments).where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.active, true),
      inArray(schema.cardAssignments.entryId, entryIds)));
  const cardsByEntry = new Map<string, string[]>();
  for (const row of assignments) cardsByEntry.set(row.entryId, [...cardsByEntry.get(row.entryId) ?? [], row.cardNumber]);
  const cards = [...new Set(assignments.map(row => row.cardNumber))];
  const readouts = cards.length === 0 ? [] : await tx.selectDistinctOn([schema.cardReadouts.cardNumber]).from(schema.cardReadouts)
    .where(and(eq(schema.cardReadouts.raceId, raceId), inArray(schema.cardReadouts.cardNumber, cards)))
    .orderBy(asc(schema.cardReadouts.cardNumber), desc(schema.cardReadouts.readAt), desc(schema.cardReadouts.id));
  const readoutByCard = new Map(readouts.map(row => [row.cardNumber, row]));
  const latest = await tx.selectDistinctOn([schema.resultRevisions.entryId]).from(schema.resultRevisions)
    .where(and(eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.entryId, entryIds)))
    .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id));
  const latestByEntry = new Map(latest.map(row => [row.entryId, row]));
  // Löpare med ett avläsningsbaserat resultat; ett manuellt beslut kan ligga överst utan avläsning.
  const technical = new Set((await tx.selectDistinct({ entryId: schema.resultRevisions.entryId }).from(schema.resultRevisions)
    .where(and(eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.entryId, entryIds),
      isNotNull(schema.resultRevisions.readoutId)))).map(row => row.entryId));
  const stateByEntry = new Map((await resolveStoredResultHeadStates(tx, raceId, latest)).map(state => [state.head.entryId, state]));
  const proposed = withProposedCourseVersion(snapshot, course.id, course.version.id,
    { id: randomUUID(), version: course.version.version + 1, createdAt: new Date(0).toISOString(), controlCodes });
  const assessed: AssessedEntry[] = [];
  for (const entry of entries) {
    const entryCards = cardsByEntry.get(entry.id) ?? [];
    const readout = entryCards.length === 1 ? readoutByCard.get(entryCards[0]!) : undefined;
    if (!readout) continue;
    const head = latestByEntry.get(entry.id) ?? null;
    const state = stateByEntry.get(entry.id);
    const current = evaluateCardReadout(normalized(readout), snapshot);
    const next = evaluateCardReadout(normalized(readout), proposed);
    const before = head?.status === "OK" || head?.status === "MP" ? head.status : current.status;
    const base = { entryId: entry.id, displayName: `${entry.givenName} ${entry.familyName}`,
      className: classNames.get(entry.classId)!, readout, latest: head, before, after: next.status };
    // Manuellt rättad tid finns bara i den rättade revisionen; en omräkning från avläsningen skulle tappa den.
    if (head && (head.manualFinishTimeCorrectionId !== null || head.manualPunchStartTimeCorrectionId !== null)) {
      assessed.push({ ...base, outcome: "NOT_RECALCULATED", recalculate: false }); continue;
    }
    // Ej start gäller löparen oavsett avläsningen och får inte ersättas av en teknisk revision.
    const didNotStart = !state || state.state === "NO_ACTIVE_RESULT" || state.head.didNotStartDecisionId !== null ||
      state.startCheckinDns?.correction === null;
    if (!head || !technical.has(entry.id) || didNotStart || next.entryId !== entry.id || current.entryId !== entry.id) {
      assessed.push({ ...base, outcome: "UNCHANGED", recalculate: false }); continue;
    }
    const manual = state.disqualification?.withdrawal === null || state.approval?.withdrawal === null ||
      state.didNotFinish?.withdrawal === null || state.notCompeting?.withdrawal === null || state.withoutTiming?.withdrawal === null;
    assessed.push({ ...base, outcome: courseEditOutcome(before, next.status, manual), recalculate: true });
  }
  return assessed;
}

function previewResponse(raceId: string, course: LoadedCourse, snapshotVersion: number, controlCodes: number[],
  assessed: AssessedEntry[]): CourseEditPreviewResponse {
  const outcomes = assessed.flatMap(row => row.outcome === "NOT_RECALCULATED" ? [] : [row.outcome]);
  const changes = assessed.filter(row => row.outcome === "BECOMES_OK" || row.outcome === "BECOMES_MISPUNCHED");
  return courseEditPreviewResponseSchema.parse({ formatVersion: 1, raceId, courseId: course.id, courseName: course.name,
    snapshotVersion, currentControlCodes: course.controlCodes, controlCodes, readOutCount: assessed.length,
    ...summarizeCourseEdit(outcomes), notRecalculatedCount: assessed.length - outcomes.length,
    changes: changes.map(row => ({ entryId: row.entryId, displayName: row.displayName, className: row.className,
      before: row.before, after: row.after })), requiresConfirmation: changes.length > 0 });
}

export type CourseEditListResult = { status: "unauthorized" | "forbidden" } | { status: "ok"; response: CourseEditListResponse };

/** Banor med kontroller, klasser, anmälda och avlästa – underlaget för tabellen i Banor. */
export async function listCoursesForEditAsAdministrator(db: Database, input: Authentication, now = new Date()): Promise<CourseEditListResult> {
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const race = await lockRaceForSnapshot(tx, raceId);
    const courses = await tx.select({ id: schema.courses.id }).from(schema.courses).where(eq(schema.courses.raceId, raceId));
    const entries = await tx.select({ id: schema.entries.id, classId: schema.entries.classId }).from(schema.entries)
      .where(eq(schema.entries.raceId, raceId));
    const assignments = await tx.select({ entryId: schema.cardAssignments.entryId, cardNumber: schema.cardAssignments.cardNumber })
      .from(schema.cardAssignments).where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.active, true)));
    const readCards = new Set((await tx.selectDistinct({ cardNumber: schema.cardReadouts.cardNumber }).from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId))).map(row => row.cardNumber));
    const readEntries = new Set(assignments.filter(row => readCards.has(row.cardNumber)).map(row => row.entryId));
    const rows = [];
    for (const { id } of courses) {
      const course = await loadCourse(tx, raceId, id);
      if (!course) continue;
      const classIds = new Set(course.classes.map(row => row.id));
      const courseEntries = entries.filter(row => classIds.has(row.classId));
      rows.push({ courseId: course.id, courseVersionId: course.version.id, name: course.name, controlCodes: course.controlCodes,
        classes: course.classes.map(row => ({ classId: row.id, name: row.name })), entryCount: courseEntries.length,
        readOutCount: courseEntries.filter(row => readEntries.has(row.id)).length });
    }
    rows.sort((left, right) => left.name.localeCompare(right.name, "sv-SE") || (left.courseId < right.courseId ? -1 : 1));
    return { status: "ok", response: courseEditListResponseSchema.parse({ formatVersion: 1, raceId,
      snapshotVersion: race.snapshotVersion, courses: rows }) };
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
    if (sameControlCodes(course.controlCodes, parsed.data.controlCodes)) return { status: "invalid-request" };
    const assessed = await assess(tx, raceId, course, await loadRaceSnapshot(tx, raceId), parsed.data.controlCodes);
    if (assessed === "too-large") return { status: "too-large" };
    return { status: "ok", response: previewResponse(raceId, course, race.snapshotVersion, parsed.data.controlCodes, assessed) };
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
    if (sameControlCodes(course.controlCodes, intent.controlCodes)) return { status: "invalid-request" };
    if (course.classes.length > 0) {
      await tx.select({ id: schema.entries.id }).from(schema.entries).where(and(eq(schema.entries.raceId, raceId),
        inArray(schema.entries.classId, course.classes.map(row => row.id)))).orderBy(asc(schema.entries.id)).for("update");
    }
    const assessed = await assess(tx, raceId, course, await loadRaceSnapshot(tx, raceId), intent.controlCodes);
    if (assessed === "too-large") return { status: "too-large" };
    const preview = previewResponse(raceId, course, race.snapshotVersion, intent.controlCodes, assessed);
    if (preview.requiresConfirmation && !intent.confirmResultChanges) return { status: "confirmation-required", preview };

    const [latestVersion] = await tx.select({ version: max(schema.courseVersions.version) }).from(schema.courseVersions)
      .where(eq(schema.courseVersions.courseId, course.id));
    const nextVersion = (latestVersion?.version ?? 0) + 1;
    if (nextVersion > 2_147_483_647) return { status: "conflict" };
    const [courseVersion] = await tx.insert(schema.courseVersions).values({ courseId: course.id, version: nextVersion }).returning();
    if (!courseVersion) throw new Error("Banversionen kunde inte skapas");
    for (const [index, code] of intent.controlCodes.entries()) {
      await tx.insert(schema.controls).values({ raceId, code }).onConflictDoNothing();
      const [control] = await tx.select({ id: schema.controls.id }).from(schema.controls)
        .where(and(eq(schema.controls.raceId, raceId), eq(schema.controls.code, code)));
      if (!control) throw new Error("Kontrollen kunde inte skapas");
      await tx.insert(schema.courseControls).values({ courseVersionId: courseVersion.id, controlId: control.id, sequence: index + 1 });
    }
    const classIds = course.classes.map(row => row.id);
    if (classIds.length > 0) {
      await tx.update(schema.classes).set({ courseVersionId: courseVersion.id })
        .where(and(eq(schema.classes.raceId, raceId), inArray(schema.classes.id, classIds)));
    }
    const snapshotVersionAfter = race.snapshotVersion + 1;
    await tx.update(schema.races).set({ snapshotVersion: snapshotVersionAfter }).where(eq(schema.races.id, raceId));

    // Omräkning med den sparade banan. Databasen sätter varje ny revisions underlagshash.
    const snapshot = await loadRaceSnapshot(tx, raceId);
    const recalculated: { entryId: string; resultRevisionId: string; revision: number }[] = [];
    for (const row of assessed.filter(value => value.recalculate)) {
      const evaluation = evaluateCardReadout(normalized(row.readout), snapshot);
      if (evaluation.entryId !== row.entryId || evaluation.courseVersionId !== courseVersion.id) {
        throw new Error("Omräkningen gav en annan deltagare eller bana än förhandsbeskedet");
      }
      const [created] = await tx.insert(schema.resultRevisions).values({ raceId, entryId: row.entryId, readoutId: row.readout.id,
        revision: row.latest!.revision + 1, cause: "EXPLICIT_RECALCULATION", status: evaluation.status, reason: evaluation.reason,
        evaluation, engineVersion: RESULT_ENGINE_VERSION, snapshotVersion: snapshotVersionAfter, courseVersionId: courseVersion.id,
        controlNeutralizationId: appliedControlNeutralization(snapshot, evaluation), published: true }).returning();
      if (!created) throw new Error("Resultatrevisionen kunde inte sparas");
      recalculated.push({ entryId: row.entryId, resultRevisionId: created.id, revision: created.revision });
    }
    const response = courseEditResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId, raceId,
      courseId: course.id, request: intent, previousCourseVersionId: course.version.id, courseVersionId: courseVersion.id,
      classIds, snapshotVersionBefore: race.snapshotVersion, snapshotVersionAfter, recalculated, editedAt: now.toISOString() });
    await tx.insert(schema.courseEditRequests).values({ requestId: intent.requestId, raceId, courseId: course.id,
      previousCourseVersionId: course.version.id, courseVersionId: courseVersion.id,
      actorCredentialId: auth.principal.accessCredentialId, capability, request: intent, response, editedAt: now });
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "course", entityId: course.id, requestId: intent.requestId,
      actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId, action: "COURSE_EDITED_BY_ADMIN",
      before: { courseVersionId: course.version.id, controlCodes: course.controlCodes, snapshotVersion: race.snapshotVersion },
      after: { courseVersionId: courseVersion.id, controlCodes: intent.controlCodes, classIds, snapshotVersion: snapshotVersionAfter,
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
