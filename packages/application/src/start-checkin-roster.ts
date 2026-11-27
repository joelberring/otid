import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { StartCheckinOperationSchema, StartCheckinRosterResponseSchema, administratorForestWatchResponseSchema } from "@o-tid/contracts";
import { buildForestWatchList, reportedStartAt, type AppliedStartObservation } from "@o-tid/domain";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { UUID_PATTERN } from "./serialization";
import { parseStrictStoredResultRevision, StoredResultRevisionConflict, type StoredPublishedResultOutcome, type StoredResultRevisionInput } from "./stored-result-revision";
import { validateStoredStartCheckinDns } from "./start-checkin-dns-source";
import { validateStoredStartCheckinReceipt } from "./start-checkin-sync";
import { reviewedCheckinRequests } from "./checkin-conflict-review-journal";
import { allowsStartCheckinSourceAction } from "./start-checkin-source-action";

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const validDate = (value: Date) => { if (!Number.isFinite(value.getTime())) throw new Error("Lästiden är ogiltig"); return value; };

type ResultCause = typeof schema.resultRevisions.$inferSelect["cause"];
const TIMED_STATUSES = ["OK", "OVERTIME", "MP"] as const;
const ROSTER_STATUS_BY_CAUSE: Record<ResultCause, { readonly statuses: readonly string[]; readonly readout: boolean; readonly reason?: string }> = {
  CARD_READOUT: { statuses: TIMED_STATUSES, readout: true },
  CLASS_CHANGE_RECALCULATION: { statuses: TIMED_STATUSES, readout: true },
  EXPLICIT_RECALCULATION: { statuses: TIMED_STATUSES, readout: true },
  UNKNOWN_READOUT_RESOLUTION: { statuses: TIMED_STATUSES, readout: true },
  SHORTENED_COURSE_CLASS_TRANSFER: { statuses: TIMED_STATUSES, readout: true },
  MANUAL_DID_NOT_START: { statuses: ["DNS"], readout: false },
  START_CHECKIN_DID_NOT_START: { statuses: ["DNS"], readout: false },
  MANUAL_DID_NOT_START_WITHDRAWAL: { statuses: ["DNS"], readout: false },
  MANUAL_DISQUALIFICATION: { statuses: ["DSQ"], readout: false },
  MANUAL_RESULT_APPROVAL: { statuses: ["OK"], readout: false, reason: "MANUAL_APPROVAL" },
  MANUAL_DID_NOT_FINISH: { statuses: ["DNF"], readout: false },
  MANUAL_OUT_OF_COMPETITION: { statuses: ["OOC"], readout: false },
  MANUAL_WITHOUT_TIMING: { statuses: ["NT"], readout: false },
  MANUAL_DISQUALIFICATION_WITHDRAWAL: { statuses: TIMED_STATUSES, readout: false },
  MANUAL_RESULT_APPROVAL_WITHDRAWAL: { statuses: TIMED_STATUSES, readout: false },
  MANUAL_DID_NOT_FINISH_WITHDRAWAL: { statuses: TIMED_STATUSES, readout: false },
  MANUAL_OUT_OF_COMPETITION_WITHDRAWAL: { statuses: TIMED_STATUSES, readout: false },
  MANUAL_WITHOUT_TIMING_WITHDRAWAL: { statuses: TIMED_STATUSES, readout: false },
  MANUAL_FINISH_TIME_CORRECTION: { statuses: TIMED_STATUSES, readout: false },
  MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL: { statuses: TIMED_STATUSES, readout: false },
  MANUAL_PUNCH_START_TIME_CORRECTION: { statuses: TIMED_STATUSES, readout: false },
  MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL: { statuses: TIMED_STATUSES, readout: false },
  MANUAL_TIME: { statuses: TIMED_STATUSES, readout: false },
  MANUAL_TIME_WITHDRAWAL: { statuses: TIMED_STATUSES, readout: false },
  MANUAL_CONTROL_APPROVAL: { statuses: ["OK", "MP"], readout: false },
  MANUAL_CONTROL_APPROVAL_WITHDRAWAL: { statuses: TIMED_STATUSES, readout: false },
  MANUAL_RESULT_REMOVED: { statuses: ["MP"], readout: false, reason: "MISSING_START" },
  READOUT_REREAD: { statuses: TIMED_STATUSES, readout: true },
  MANUAL_MISPUNCH_CONFIRMATION: { statuses: ["MP"], readout: false },
  MANUAL_MISPUNCH_CONFIRMATION_WITHDRAWAL: { statuses: TIMED_STATUSES, readout: false }
};

/**
 * Lättviktskontroll av status/DNS för startavprickning och Kvar i skogen utan full Zod-parsning av
 * `evaluation`-JSONB (undviker validering av tiotusentals sträcktider per läsning). Avpricknings-DNS
 * behåller full källvalidering.
 */
export function storedRosterResultStatus(
  row: StoredResultRevisionInput,
  checkinSource?: Parameters<typeof validateStoredStartCheckinDns>[0]
): StoredPublishedResultOutcome["status"] {
  if (row.startCheckinDnsDecisionId !== null) {
    return parseStrictStoredResultRevision(row, checkinSource).status;
  }
  const rule = ROSTER_STATUS_BY_CAUSE[row.cause];
  const evaluation = row.evaluation;
  if (!rule || evaluation === null || typeof evaluation !== "object" || Array.isArray(evaluation)) {
    throw new StoredResultRevisionConflict("Resultatrevisionen motsäger sitt lagrade utfall");
  }
  const fields = evaluation as unknown as Record<string, unknown>;
  const status = fields.status;
  const reason = fields.reason;
  const entryId = fields.entryId;
  const classId = fields.classId;
  const courseVersionId = fields.courseVersionId;
  if (typeof status !== "string" || status === "UNKNOWN_CARD" || typeof reason !== "string" ||
      !Number.isSafeInteger(row.revision) || row.revision < 1 ||
      !Number.isSafeInteger(row.snapshotVersion) || row.snapshotVersion < 1 ||
      entryId !== row.entryId || typeof classId !== "string" || !UUID_PATTERN.test(classId) ||
      courseVersionId !== row.courseVersionId || status !== row.status || reason !== row.reason) {
    throw new StoredResultRevisionConflict("Resultatrevisionen motsäger sitt lagrade utfall");
  }
  if (!rule.statuses.includes(status) || (row.readoutId !== null) !== rule.readout ||
      (rule.reason !== undefined && reason !== rule.reason) ||
      (rule.reason === undefined && rule.statuses === TIMED_STATUSES && reason === "MANUAL_APPROVAL") ||
      (row.shortenedCourseClassTransferId !== undefined &&
        (row.cause === "SHORTENED_COURSE_CLASS_TRANSFER") !== (row.shortenedCourseClassTransferId !== null))) {
    throw new StoredResultRevisionConflict("Resultatrevisionens orsak och utfall motsäger varandra");
  }
  return status as StoredPublishedResultOutcome["status"];
}

/** Kvar i skogen (ADR-0172 beslut 3): administratören och funktionären läser samma lista. */
/**
 * Steg 54: flera skärmar (speakern, arbetsytan) frågar samma sak samtidigt. `reuse` får dela en uträkning per tävling en
 * kort stund (webben: 2 s); behörigheten kontrolleras ändå för varje anrop, och innehållet är detsamma för alla med
 * behörighet.
 */
export type ForestWatchReuse = <T>(raceId: string, compute: () => Promise<T>) => Promise<T>;

export async function listAdministratorForestWatch(
  db: Database, input: RaceSessionProof, now = new Date(), reuse: ForestWatchReuse = (_raceId, compute) => compute()
) {
  now = validDate(now);
  return db.transaction(async (tx) => {
    const authorization = await requireRaceRole(tx, {
      ...input, role: "FUNCTIONARY"
    }, now, "share");
    if (authorization.status !== "authenticated") return authorization;
    const raceId = authorization.principal.raceId;
    return reuse(raceId, async () => {
      const result = await readAuthorizedStartCheckinRoster(tx, raceId, now, false, true);
      if (result.status !== "ok") return result;
      return { status: "ok" as const, response: administratorForestWatchResponseSchema.parse({ ...result.response, raceDate: result.raceDate,
        reportedStarts: result.reportedStarts, radioPunched: await radioPunchedEntries(tx, raceId) }) };
    });
  }, { isolationLevel: "repeatable read" });
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Löpare (ej strukna) vars bricka har stämplat vid en radiokontroll i tävlingen, i id-ordning. Även en bricka som inte
 * längre är aktiv räknas: hellre en löpare för mycket som ute än en för lite. Kvar i skogen räknar dem som ute även före
 * den lottade starttiden.
 */
async function radioPunchedEntries(tx: Tx, raceId: string): Promise<string[]> {
  const rows = await tx.selectDistinct({ entryId: schema.cardAssignments.entryId }).from(schema.radioPunches)
    .innerJoin(schema.cardAssignments, and(eq(schema.cardAssignments.raceId, schema.radioPunches.raceId),
      eq(schema.cardAssignments.cardNumber, schema.radioPunches.cardNumber)))
    .innerJoin(schema.entries, and(eq(schema.entries.id, schema.cardAssignments.entryId), isNull(schema.entries.struckAt)))
    .where(eq(schema.radioPunches.raceId, raceId)).orderBy(asc(schema.cardAssignments.entryId)).limit(10_001);
  if (rows.length > 10_000) throw new Error("För många radiostämplade löpare");
  return rows.map(row => row.entryId);
}

/** Internal projection; caller must already hold protected-read or mutation authority. */
export async function readAuthorizedStartCheckinRoster(tx: Tx, raceId: string, now: Date, reviewDetails = false, includeReportedStarts = false) {
    const [race] = await tx.select().from(schema.races).where(eq(schema.races.id, raceId)).for("share");
    if (!race) return { status: "not-found" as const };
    const [event] = await tx.select({ timeZone: schema.events.timeZone }).from(schema.events).where(eq(schema.events.id, race.eventId));
    if (!event) throw new Error("Loppets tävling saknas");
    const entries = await tx.select().from(schema.entries)
      .where(and(eq(schema.entries.raceId, race.id), isNull(schema.entries.struckAt))).limit(10_001);
    const classes = await tx.select().from(schema.classes)
      .where(eq(schema.classes.raceId, race.id)).limit(1_001);
    const assignments = await tx.select().from(schema.cardAssignments)
      .where(and(eq(schema.cardAssignments.raceId, race.id), eq(schema.cardAssignments.active, true))).limit(20_001);
    const operations = await tx.select().from(schema.startCheckinOperations)
      .where(eq(schema.startCheckinOperations.raceId, race.id)).limit(100_001);
    const devices = await tx.select().from(schema.startCheckinDevices)
      .where(eq(schema.startCheckinDevices.raceId, race.id)).limit(1_001);
    const revisions = await tx.selectDistinctOn([schema.startCheckinRevisions.entryId]).from(schema.startCheckinRevisions)
      .where(eq(schema.startCheckinRevisions.raceId, race.id))
      .orderBy(asc(schema.startCheckinRevisions.entryId), desc(schema.startCheckinRevisions.revision)).limit(10_001);
    const heads = await tx.selectDistinctOn([schema.resultRevisions.entryId], {
      id: schema.resultRevisions.id,
      raceId: schema.resultRevisions.raceId,
      entryId: schema.resultRevisions.entryId,
      revision: schema.resultRevisions.revision,
      status: schema.resultRevisions.status,
      reason: schema.resultRevisions.reason,
      cause: schema.resultRevisions.cause,
      readoutId: schema.resultRevisions.readoutId,
      startCheckinDnsDecisionId: schema.resultRevisions.startCheckinDnsDecisionId,
      shortenedCourseClassTransferId: schema.resultRevisions.shortenedCourseClassTransferId,
      // Undvik att skicka stora split-arrayer i evaluation för icke-avpricknings-DNS; behåll full evaluation för avpricknings-DNS.
      evaluation: sql<typeof schema.resultRevisions.$inferSelect["evaluation"]>`case when ${schema.resultRevisions.startCheckinDnsDecisionId} is not null or jsonb_typeof(${schema.resultRevisions.evaluation}) <> 'object' then ${schema.resultRevisions.evaluation} else jsonb_build_object('status', ${schema.resultRevisions.evaluation}->'status', 'reason', ${schema.resultRevisions.evaluation}->'reason', 'entryId', ${schema.resultRevisions.evaluation}->'entryId', 'classId', ${schema.resultRevisions.evaluation}->'classId', 'courseVersionId', ${schema.resultRevisions.evaluation}->'courseVersionId') end`,
      engineVersion: schema.resultRevisions.engineVersion,
      snapshotVersion: schema.resultRevisions.snapshotVersion,
      courseVersionId: schema.resultRevisions.courseVersionId,
      published: schema.resultRevisions.published,
      createdAt: schema.resultRevisions.createdAt
    }).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, race.id))
      .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision)).limit(10_001);
    if (entries.length > 10_000 || classes.length > 1_000 || assignments.length > 20_000 || operations.length > 100_000 ||
        devices.length > 1_000 || revisions.length > 10_000 || heads.length > 10_000) return { status: "too-large" as const };
    const entryIds = new Set(entries.map(e => e.id)), classById = new Map(classes.map(c => [c.id, c]));
    const deviceById = new Map(devices.map(d => [d.id, d]));
    const operationById = new Map(operations.map(o => [o.requestId, o]));
    const reviewed = await reviewedCheckinRequests(tx, race.id, operationById);
    const revisionByEntry = new Map(revisions.map(r => [r.entryId, r]));
    const conflicts = new Set<string>();
    const reviewedByEntry = new Map<string, string[]>();
    const startObservations = new Map<string, AppliedStartObservation[]>();
    for (const operation of operations) {
      const receipt = validateStoredStartCheckinReceipt(operation), device = deviceById.get(operation.deviceId);
      if (!entryIds.has(operation.entryId) || !device || device.actorAccountId !== operation.actorAccountId) throw new Error("Operativ källa utanför roster eller enhet");
      const intent = StartCheckinOperationSchema.parse(operation.intent);
      if (!allowsStartCheckinSourceAction(device.role, intent.action)) throw new Error("Operationens funktion motsäger enheten");
      if (includeReportedStarts && receipt.effect.kind === "APPLIED") {
        const history = startObservations.get(operation.entryId) ?? [];
        history.push({ revision: receipt.effect.revision, state: intent.action.state, observedAt: intent.observedAt });
        startObservations.set(operation.entryId, history);
      }
      if (receipt.effect.kind === "CONFLICT" && !reviewed.has(operation.requestId)) conflicts.add(operation.entryId);
      if (reviewDetails && reviewed.has(operation.requestId)) {
        const ids = reviewedByEntry.get(operation.entryId) ?? [];
        ids.push(operation.requestId); reviewedByEntry.set(operation.entryId, ids);
      }
    }
    for (const revision of revisions) {
      const operation = operationById.get(revision.requestId);
      if (!operation || !entryIds.has(revision.entryId)) throw new Error("Avprickningsrevisionens källa saknas");
      const receipt = validateStoredStartCheckinReceipt(operation), intent = StartCheckinOperationSchema.parse(operation.intent);
      if (receipt.effect.kind !== "APPLIED" || receipt.effect.revisionId !== revision.id || receipt.effect.revision !== revision.revision ||
          operation.entryId !== revision.entryId || intent.action.state !== revision.startState ||
          (intent.action.kind === "FINISH_CORRECTION" && intent.action.manualReturnRegistered !== revision.manualReturnRegistered)) throw new Error("Operativ revision motsäger sin källa");
    }
    const linkedReturns = await tx.selectDistinct({ entryId: schema.cardAssignments.entryId }).from(schema.cardReadouts)
      .innerJoin(schema.cardAssignments, and(eq(schema.cardAssignments.raceId, schema.cardReadouts.raceId), eq(schema.cardAssignments.cardNumber, schema.cardReadouts.cardNumber)))
      .where(eq(schema.cardReadouts.raceId, race.id)).limit(10_001);
    const technicalReturns = await tx.selectDistinct({ entryId: schema.resultRevisions.entryId }).from(schema.resultRevisions)
      .where(and(eq(schema.resultRevisions.raceId, race.id), inArray(schema.resultRevisions.cause,
        ["CARD_READOUT", "CLASS_CHANGE_RECALCULATION", "EXPLICIT_RECALCULATION", "UNKNOWN_READOUT_RESOLUTION",
          "SHORTENED_COURSE_CLASS_TRANSFER", "READOUT_REREAD"]))).limit(10_001);
    const returned = new Set([...linkedReturns, ...technicalReturns].map(r => r.entryId));
    if ([...returned].some(id => !entryIds.has(id))) throw new Error("Återkomstkälla utanför rostern");
    const activeDns = new Set<string>(), decided = new Set<string>();
    for (const state of await resolveStoredResultHeadStates(tx, race.id, heads)) {
      if (!entryIds.has(state.head.entryId)) throw new Error("Resultatkälla utanför rostern");
      if (state.state !== "ACTIVE_RESULT") continue;
      // Steg 35: ett gällande beslut utan avläsning (deltog utan tid, utom tävlan, brutit, disk, manuell tid) betyder att
      // arrangören vet var löparen är: löparen räknas som i mål, inte kvar i skogen.
      if (storedRosterResultStatus(state.head, state.startCheckinDns?.source) === "DNS") activeDns.add(state.head.entryId);
      else decided.add(state.head.entryId);
    }
    const cards = new Map<string, string[]>();
    for (const assignment of assignments) {
      if (!entryIds.has(assignment.entryId)) throw new Error("Brickkoppling utanför rostern");
      cards.set(assignment.entryId, [...(cards.get(assignment.entryId) ?? []), assignment.cardNumber]);
    }
    const watch = new Map(buildForestWatchList(race.id, entries.map(entry => ({ raceId: race.id, entryId: entry.id,
      startState: revisionByEntry.get(entry.id)?.startState ?? "UNMARKED",
      returnRegistered: returned.has(entry.id) || decided.has(entry.id) || (revisionByEntry.get(entry.id)?.manualReturnRegistered ?? false),
      activeDns: activeDns.has(entry.id), conflictingReports: conflicts.has(entry.id)
    }))).map(row => [row.entryId, row]));
    const rows = entries.map(entry => {
      const raceClass = classById.get(entry.classId), revision = revisionByEntry.get(entry.id), forest = watch.get(entry.id);
      if (!raceClass || !forest) throw new Error("Rosterpostens klass eller skogsstatus saknas");
      const activeCards = cards.get(entry.id) ?? [];
      return { entryId: entry.id, entryVersion: entry.version, classId: raceClass.id, className: raceClass.name,
        displayName: `${entry.givenName} ${entry.familyName}`, organisationName: entry.organisationName,
        startRule: raceClass.startRule, fixedStartTime: raceClass.startRule === "FIXED" ? entry.fixedStartTime?.toISOString() ?? null : null,
        cardNumber: activeCards.length === 1 ? activeCards[0] : null, multipleActiveAssignments: activeCards.length > 1,
        revision: revision?.revision ?? 0, startState: revision?.startState ?? "UNMARKED", manualReturnRegistered: revision?.manualReturnRegistered ?? false,
        readoutReturnRegistered: returned.has(entry.id), activeDns: activeDns.has(entry.id), conflictingReports: conflicts.has(entry.id),
        forestState: forest.state, needsFollowUp: forest.needsFollowUp,
        ...(reviewDetails ? { reviewedConflictRequestIds: (reviewedByEntry.get(entry.id) ?? []).sort(compare) } : {}) };
    }).sort((a, b) => compare(a.className, b.className) || compare(a.classId, b.classId) ||
      compare(a.fixedStartTime ?? "~", b.fixedStartTime ?? "~") || compare(a.displayName, b.displayName) || compare(a.entryId, b.entryId));
    const response = StartCheckinRosterResponseSchema.parse({ formatVersion: 1, raceId: race.id,
      snapshotVersion: race.snapshotVersion, timeZone: event.timeZone, generatedAt: now.toISOString(), knowledge: "LAST_SYNCED_ONLY",
      // Avprickningar görs bara online (ADR-0172 beslut 3); fristående enheter finns inte längre.
      entries: rows, devices: [] });
    return { status: "ok" as const, response, raceDate: race.raceDate, ...(includeReportedStarts ? {
      reportedStarts: rows.map(row => ({ entryId: row.entryId,
        observedAt: reportedStartAt({ revision: row.revision, state: row.startState }, startObservations.get(row.entryId) ?? []) }))
    } : {}) };
}
