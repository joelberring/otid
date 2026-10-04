import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { administratorEffectiveResultResponseSchema, type AdministratorEffectiveResultResponse } from "@o-tid/contracts";
import { authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { resolveStoredResultHeadStates, type StoredResultHeadState } from "./result-revision-state";
import { parseStrictStoredResultRevision, StoredResultRevisionConflict, type StoredResultRevisionInput } from "./stored-result-revision";
import { isEffectiveResultCurrent, loadResultBasisHash } from "./result-basis";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type AdministratorEffectiveResult =
  | { status: "unauthorized" | "forbidden" | "not-found" | "invalid-request" }
  | { status: "ok"; response: AdministratorEffectiveResultResponse };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Shared strict outcome projection for the detail read and the bounded roster read. */
export function parseAdministratorStoredResultHead(state: StoredResultHeadState<StoredResultRevisionInput>) {
  return parseStrictStoredResultRevision(state.head, state.startCheckinDns?.source,
    state.finishTimeCorrection ?? undefined, state.finishTimeCorrectionWithdrawal ?? undefined,
    state.punchStartTimeCorrection ?? undefined, state.punchStartTimeCorrectionWithdrawal ?? undefined,
    state.shortenedCourseClassTransfer ?? undefined);
}

type HistoricalControl = { id: string; sequence: number; controlCode: number };
type StoredSplit = { controlCode: number; occurrence: number; elapsedMs: number; legMs: number };

/** Stored split occurrences count the complete historical sequence, including a neutralized control. */
export function projectAdministratorControlTimes(controls: readonly HistoricalControl[], neutralizedControlId: string | null,
  splits: readonly StoredSplit[]) {
  const splitByKey = new Map<string, StoredSplit>(splits.map(split => [`${split.controlCode}:${split.occurrence}`, split]));
  if (splitByKey.size !== splits.length) throw new StoredResultRevisionConflict("Dubbla lagrade sträcktider");
  const occurrences = new Map<number, number>();
  const matched = new Set<string>();
  const projected = controls.map(control => {
    const occurrence = (occurrences.get(control.controlCode) ?? 0) + 1;
    occurrences.set(control.controlCode, occurrence);
    const key = `${control.controlCode}:${occurrence}`;
    const split = neutralizedControlId === control.id ? undefined : splitByKey.get(key);
    if (split) matched.add(key);
    const validSplit = split && split.elapsedMs >= 0 && split.legMs >= 0;
    return { sequence: control.sequence, controlCode: control.controlCode, occurrence,
      elapsedMs: validSplit ? split.elapsedMs : null, legMs: validSplit ? split.legMs : null };
  });
  if (matched.size !== splitByKey.size) throw new StoredResultRevisionConflict("Lagrad sträcktid saknar historisk kontroll");
  return projected;
}

async function guardHistory(tx: Transaction, raceId: string, entryId: string) {
  let count = 0;
  for (const table of [schema.resultDisqualificationDecisions, schema.resultApprovalDecisions,
    schema.didNotFinishDecisions, schema.notCompetingDecisions, schema.withoutTimingDecisions,
    schema.startCheckinDnsDecisions]) {
    const rows = await tx.select({ id: table.id }).from(table).where(and(
      eq(table.raceId, raceId), eq(table.entryId, entryId)
    )).limit(1_001);
    count += rows.length;
    if (count > 1_000) throw new StoredResultRevisionConflict("Deltagarens beslutshistorik är för stor");
  }
}

export async function getAdministratorEffectiveResult(db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf"> & { entryId: string },
  now = new Date()
): Promise<AdministratorEffectiveResult> {
  if (!uuid.test(input.raceId) || !uuid.test(input.entryId)) return { status: "invalid-request" };
  if (!Number.isFinite(now.getTime())) throw new Error("Lästiden är ogiltig");
  return db.transaction(async tx => {
    const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
      sessionToken: input.sessionToken, raceId: input.raceId, capability: "MANAGE_RACE"
    }, now);
    if (authorization.status !== "authenticated") return authorization;
    const [race] = await tx.select().from(schema.races)
      .where(eq(schema.races.id, authorization.principal.raceId)).for("share");
    if (!race) return { status: "not-found" };
    const [entry] = await tx.select().from(schema.entries).where(and(
      eq(schema.entries.raceId, race.id), eq(schema.entries.id, input.entryId)
    ));
    if (!entry) return { status: "not-found" };
    const [event] = await tx.select({ timeZone: schema.events.timeZone }).from(schema.events)
      .where(eq(schema.events.id, race.eventId));
    const [currentClass] = await tx.select({ id: schema.classes.id }).from(schema.classes)
      .where(and(eq(schema.classes.id, entry.classId), eq(schema.classes.raceId, race.id)));
    if (!event || !currentClass) throw new StoredResultRevisionConflict("Deltagarens lopprelation saknas");
    // Kort historik för deltagarkortet: de senaste publicerade resultatändringarna, nyaste först.
    const history = (await tx.select({ revision: schema.resultRevisions.revision, cause: schema.resultRevisions.cause,
      status: schema.resultRevisions.status, at: schema.resultRevisions.createdAt }).from(schema.resultRevisions)
      .where(and(eq(schema.resultRevisions.raceId, race.id), eq(schema.resultRevisions.entryId, entry.id),
        eq(schema.resultRevisions.published, true)))
      .orderBy(desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id)).limit(10))
      .map(row => ({ ...row, at: row.at.toISOString() }));
    const common = { formatVersion: 1 as const, raceId: race.id, entryId: entry.id, history,
      entryVersion: entry.version, currentClassId: entry.classId, snapshotVersion: race.snapshotVersion,
      generatedAt: now.toISOString(), timeZone: event.timeZone };
    const [selected] = await tx.select().from(schema.resultRevisions).where(and(
      eq(schema.resultRevisions.raceId, race.id), eq(schema.resultRevisions.entryId, entry.id),
      eq(schema.resultRevisions.published, true)
    )).orderBy(desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id)).limit(1);
    if (!selected) return { status: "ok", response: administratorEffectiveResultResponseSchema.parse({
      ...common, state: "NO_PUBLISHED_RESULT", selectedRevision: null
    }) };
    await guardHistory(tx, race.id, entry.id);
    const [resolved] = await resolveStoredResultHeadStates(tx, race.id, [selected]);
    if (!resolved) throw new StoredResultRevisionConflict("Gällande resultat saknas");
    const outcome = parseAdministratorStoredResultHead(resolved);
    const [resultClass] = await tx.select({ id: schema.classes.id, name: schema.classes.name }).from(schema.classes)
      .where(and(eq(schema.classes.raceId, race.id), eq(schema.classes.id, outcome.classId)));
    const courseIds = [...new Set([selected.courseVersionId, resolved.head.courseVersionId])];
    const courses = await tx.select({ id: schema.courseVersions.id, name: schema.courses.name }).from(schema.courseVersions)
      .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
      .where(and(eq(schema.courses.raceId, race.id), inArray(schema.courseVersions.id, courseIds)));
    if (!resultClass || courses.length !== courseIds.length) throw new StoredResultRevisionConflict("Resultatets historiska lopprelation saknas");
    const selectedRevision = { id: selected.id, revision: selected.revision };
    if (resolved.state === "NO_ACTIVE_RESULT") return { status: "ok", response: administratorEffectiveResultResponseSchema.parse({
      ...common, state: "NO_ACTIVE_RESULT", selectedRevision
    }) };
    const decisions = {
      MANUAL_DID_NOT_START: "DNS", START_CHECKIN_DID_NOT_START: "CHECKIN_DNS",
      MANUAL_DISQUALIFICATION: "DSQ", MANUAL_RESULT_APPROVAL: "APPROVAL",
      MANUAL_DID_NOT_FINISH: "DNF", MANUAL_OUT_OF_COMPETITION: "OOC", MANUAL_WITHOUT_TIMING: "NT"
    } as const;
    const cause = resolved.head.cause;
    const governingDecision = Object.hasOwn(decisions, cause) ? decisions[cause as keyof typeof decisions] : "NONE";
    let controlDetails = null;
    const technical = "splits" in outcome && (outcome.splits.length > 0 || outcome.missingControls.length > 0 ||
      outcome.extraPunches.length > 0 || "startTime" in outcome || "finishTime" in outcome);
    if (technical) {
      const course = courses.find(row => row.id === resolved.head.courseVersionId);
      if (!course) throw new StoredResultRevisionConflict("Resultatets banversion saknas");
      const controls = await tx.select({ id: schema.courseControls.id, sequence: schema.courseControls.sequence,
        controlCode: schema.controls.code, controlRaceId: schema.controls.raceId })
        .from(schema.courseControls).innerJoin(schema.controls, eq(schema.controls.id, schema.courseControls.controlId))
        .where(eq(schema.courseControls.courseVersionId, resolved.head.courseVersionId))
        .orderBy(asc(schema.courseControls.sequence)).limit(1_001);
      if (controls.length === 0 || controls.length > 1_000 || controls.some((row, index) =>
        row.controlRaceId !== race.id || row.sequence !== index + 1 || row.controlCode < 1)) {
        throw new StoredResultRevisionConflict("Resultatets historiska kontrollföljd saknas");
      }
      const neutralizationId = resolved.head.controlNeutralizationId;
      const neutralized = neutralizationId === null ? null : (await tx.select().from(schema.classControlNeutralizations)
        .where(and(eq(schema.classControlNeutralizations.id, neutralizationId),
          eq(schema.classControlNeutralizations.raceId, race.id))).limit(1))[0];
      if (neutralizationId !== null && (!neutralized || neutralized.classId !== outcome.classId ||
        neutralized.courseVersionId !== resolved.head.courseVersionId || !controls.some(row =>
          row.id === neutralized.courseControlId && row.sequence === neutralized.sequence && row.controlCode === neutralized.controlCode))) {
        throw new StoredResultRevisionConflict("Resultatets neutralisering saknas");
      }
      const splits = "splits" in outcome ? outcome.splits : [];
      const projectedControls = projectAdministratorControlTimes(controls, neutralized?.courseControlId ?? null, splits);
      const validInstant = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : null;
      controlDetails = { courseName: course.name, courseVersionId: resolved.head.courseVersionId,
        startTime: validInstant("startTime" in outcome ? outcome.startTime : null),
        finishTime: validInstant("finishTime" in outcome ? outcome.finishTime : null),
        controls: projectedControls, missingControls: "missingControls" in outcome ? outcome.missingControls : [],
        extraPunches: "extraPunches" in outcome ? outcome.extraPunches : [] };
    }
    return { status: "ok", response: administratorEffectiveResultResponseSchema.parse({
      ...common, state: "ACTIVE_RESULT", selectedRevision, resultClass,
      resultSnapshotVersion: resolved.head.snapshotVersion, governingDecision, controlDetails,
      resultCurrent: isEffectiveResultCurrent(resolved, await loadResultBasisHash(tx, entry.id), race.snapshotVersion),
      result: { revision: resolved.head.revision, status: outcome.status, reason: outcome.reason,
        ...("elapsedMs" in outcome ? { elapsedMs: outcome.elapsedMs } : {}) }
    }) };
  }, { isolationLevel: "repeatable read" });
}
