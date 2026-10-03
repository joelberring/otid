import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { StartCheckinOperationSchema, StartCheckinRosterResponseSchema, administratorForestWatchResponseSchema } from "@o-tid/contracts";
import { buildForestWatchList, reportedStartAt, type AppliedStartObservation } from "@o-tid/domain";
import { authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { parseStrictStoredResultRevision } from "./stored-result-revision";
import { validateStoredStartCheckinReceipt } from "./start-checkin-sync";
import { reviewedCheckinRequests } from "./checkin-conflict-review-journal";
import { allowsStartCheckinSourceAction } from "./start-checkin-source-action";

type Input = Omit<PairingAdminRequestAuthentication, "capability"> & {
  capability: "START_CHECKIN" | "FINISH_FOREST_WATCH";
  reviewDetails?: boolean;
};
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const validDate = (value: Date) => { if (!Number.isFinite(value.getTime())) throw new Error("Lästiden är ogiltig"); return value; };

export async function listAdministratorForestWatch(
  db: Database, input: Omit<PairingAdminRequestAuthentication, "capability">, now = new Date()
) {
  now = validDate(now);
  return db.transaction(async (tx) => {
    const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
      ...input, capability: "MANAGE_RACE"
    }, now);
    if (authorization.status !== "authenticated") return authorization;
    if (authorization.principal.capability !== "MANAGE_RACE") return { status: "forbidden" as const };
    const result = await readAuthorizedStartCheckinRoster(tx, authorization.principal.raceId, now, false, true);
    if (result.status !== "ok") return result;
    return { status: "ok" as const, response: administratorForestWatchResponseSchema.parse({ ...result.response, reportedStarts: result.reportedStarts }) };
  }, { isolationLevel: "repeatable read" });
}

/** Full private roster; a read never implies that remote devices have empty queues. */
export async function listStartCheckinRosterAsAdmin(db: Database, input: Input, now = new Date()) {
  if (input.capability !== "START_CHECKIN" && input.capability !== "FINISH_FOREST_WATCH") return { status: "forbidden" as const };
  if (!Number.isFinite(now.getTime())) throw new Error("Lästiden är ogiltig");
  return db.transaction(async (tx) => {
    const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, input, now);
    if (authorization.status !== "authenticated") return authorization;
    return readAuthorizedStartCheckinRoster(tx, authorization.principal.raceId, now, input.reviewDetails === true);
  }, { isolationLevel: "repeatable read" });
}

/** Internal projection; caller must already hold protected-read or mutation authority. */
export async function readAuthorizedStartCheckinRoster(tx: Parameters<Parameters<Database["transaction"]>[0]>[0], raceId: string, now: Date, reviewDetails = false, includeReportedStarts = false) {
    const [race] = await tx.select().from(schema.races).where(eq(schema.races.id, raceId)).for("share");
    if (!race) return { status: "not-found" as const };
    const [event] = await tx.select({ timeZone: schema.events.timeZone }).from(schema.events).where(eq(schema.events.id, race.eventId));
    if (!event) throw new Error("Loppets tävling saknas");
    const [entries, classes, assignments, operations, devices, revisions, heads] = await Promise.all([
      tx.select().from(schema.entries).where(eq(schema.entries.raceId, race.id)).limit(10_001),
      tx.select().from(schema.classes).where(eq(schema.classes.raceId, race.id)).limit(1_001),
      tx.select().from(schema.cardAssignments).where(and(eq(schema.cardAssignments.raceId, race.id), eq(schema.cardAssignments.active, true))).limit(20_001),
      tx.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, race.id)).limit(100_001),
      tx.select().from(schema.startCheckinDevices).where(eq(schema.startCheckinDevices.raceId, race.id)).limit(1_001),
      tx.selectDistinctOn([schema.startCheckinRevisions.entryId]).from(schema.startCheckinRevisions)
        .where(eq(schema.startCheckinRevisions.raceId, race.id)).orderBy(asc(schema.startCheckinRevisions.entryId), desc(schema.startCheckinRevisions.revision)).limit(10_001),
      tx.selectDistinctOn([schema.resultRevisions.entryId]).from(schema.resultRevisions)
        .where(eq(schema.resultRevisions.raceId, race.id)).orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision)).limit(10_001)
    ]);
    if (entries.length > 10_000 || classes.length > 1_000 || assignments.length > 20_000 || operations.length > 100_000 ||
        devices.length > 1_000 || revisions.length > 10_000 || heads.length > 10_000) return { status: "too-large" as const };
    const entryIds = new Set(entries.map(e => e.id)), classById = new Map(classes.map(c => [c.id, c]));
    const deviceById = new Map(devices.map(d => [d.id, d]));
    const operationById = new Map(operations.map(o => [o.requestId, o]));
    const reviewed = await reviewedCheckinRequests(tx, race.id, operationById);
    const revisionByEntry = new Map(revisions.map(r => [r.entryId, r]));
    const conflicts = new Set<string>();
    const reviewedByEntry = new Map<string, string[]>();
    const lastByDevice = new Map<string, typeof operations[number]>();
    const startObservations = new Map<string, AppliedStartObservation[]>();
    for (const operation of operations) {
      const receipt = validateStoredStartCheckinReceipt(operation), device = deviceById.get(operation.deviceId);
      if (!entryIds.has(operation.entryId) || !device || device.actorCredentialId !== operation.actorCredentialId) throw new Error("Operativ källa utanför roster eller enhet");
      const intent = StartCheckinOperationSchema.parse(operation.intent);
      if (!allowsStartCheckinSourceAction(device.capability, intent.action)) throw new Error("Operationens funktion motsäger enheten");
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
      if ((lastByDevice.get(device.id)?.localSequence ?? 0) < operation.localSequence) lastByDevice.set(device.id, operation);
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
          "SHORTENED_COURSE_CLASS_TRANSFER"]))).limit(10_001);
    const returned = new Set([...linkedReturns, ...technicalReturns].map(r => r.entryId));
    if ([...returned].some(id => !entryIds.has(id))) throw new Error("Återkomstkälla utanför rostern");
    const activeDns = new Set<string>();
    for (const state of await resolveStoredResultHeadStates(tx, race.id, heads)) {
      if (!entryIds.has(state.head.entryId)) throw new Error("Resultatkälla utanför rostern");
      if (state.state === "ACTIVE_RESULT" && parseStrictStoredResultRevision(state.head,
        state.startCheckinDns?.source, state.finishTimeCorrection ?? undefined, state.finishTimeCorrectionWithdrawal ?? undefined,
        state.punchStartTimeCorrection ?? undefined, state.punchStartTimeCorrectionWithdrawal ?? undefined,
        state.shortenedCourseClassTransfer ?? undefined).status === "DNS") activeDns.add(state.head.entryId);
    }
    const cards = new Map<string, string[]>();
    for (const assignment of assignments) {
      if (!entryIds.has(assignment.entryId)) throw new Error("Brickkoppling utanför rostern");
      cards.set(assignment.entryId, [...(cards.get(assignment.entryId) ?? []), assignment.cardNumber]);
    }
    const watch = new Map(buildForestWatchList(race.id, entries.map(entry => ({ raceId: race.id, entryId: entry.id,
      startState: revisionByEntry.get(entry.id)?.startState ?? "UNMARKED",
      returnRegistered: returned.has(entry.id) || (revisionByEntry.get(entry.id)?.manualReturnRegistered ?? false),
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
      entries: rows, devices: devices.filter(device => device.capability !== "MANAGE_RACE").map(device => ({ deviceId: device.id, label: device.label, capability: device.capability,
        lastSequence: lastByDevice.get(device.id)?.localSequence ?? 0, lastReceivedAt: lastByDevice.get(device.id)?.receivedAt.toISOString() ?? null
      })).sort((a, b) => compare(a.label, b.label) || compare(a.deviceId, b.deviceId)) });
    return { status: "ok" as const, response, ...(includeReportedStarts ? {
      reportedStarts: rows.map(row => ({ entryId: row.entryId,
        observedAt: reportedStartAt({ revision: row.revision, state: row.startState }, startObservations.get(row.entryId) ?? []) }))
    } : {}) };
}
