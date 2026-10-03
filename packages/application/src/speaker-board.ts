import { and, asc, desc, eq, getTableColumns, inArray } from "drizzle-orm";
import { speakerBoardResponseSchema, speakerBoardRowSchema, type SpeakerBoardResponse, type SpeakerBoardRow } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { parseStrictStoredResultRevision } from "./stored-result-revision";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type SpeakerBoardResult =
  | { status: "unauthorized" | "forbidden" | "not-found" }
  | { status: "ok"; response: SpeakerBoardResponse };

async function guardHistory(tx: Transaction, raceId: string, entryIds: string[]): Promise<void> {
  if (entryIds.length === 0) return;
  let count = 0;
  for (const table of [schema.resultDisqualificationDecisions, schema.resultApprovalDecisions,
    schema.didNotFinishDecisions, schema.notCompetingDecisions, schema.withoutTimingDecisions,
    schema.startCheckinDnsDecisions]) {
    const ids = await tx.select({ id: table.id }).from(table).where(and(
      eq(table.raceId, raceId), inArray(table.entryId, entryIds)
    )).limit(1_001);
    count += ids.length;
    if (count > 1_000) throw new Error("Speakerunderlagets beslutshistorik är för stor");
  }
}

export async function listSpeakerBoardAsAdmin(
  db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability">,
  now = new Date()
): Promise<SpeakerBoardResult> {
  return listSpeakerBoardForCapability(db, input, "VIEW_SPEAKER_BOARD", now);
}

export async function listSpeakerBoardAsAdministrator(
  db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability">,
  now = new Date()
): Promise<SpeakerBoardResult> {
  return listSpeakerBoardForCapability(db, input, "MANAGE_RACE", now);
}

async function listSpeakerBoardForCapability(
  db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability">,
  capability: "VIEW_SPEAKER_BOARD" | "MANAGE_RACE",
  now: Date
): Promise<SpeakerBoardResult> {
  if (!Number.isFinite(now.getTime())) throw new Error("Lästiden är ogiltig");
  return db.transaction(async (tx) => {
    const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
      ...input, capability
    }, now);
    if (authorization.status !== "authenticated") return authorization;
    const [race] = await tx.select({ id: schema.races.id, name: schema.races.name,
      eventId: schema.races.eventId, snapshotVersion: schema.races.snapshotVersion })
      .from(schema.races).where(eq(schema.races.id, authorization.principal.raceId)).for("share");
    if (!race) return { status: "not-found" };
    const [event] = await tx.select({ name: schema.events.name, timeZone: schema.events.timeZone })
      .from(schema.events).where(eq(schema.events.id, race.eventId));
    if (!event) return { status: "not-found" };

    // First choose the published head per entry, THEN globally order and limit.
    // Full stored result provenance stays inside the central resolver boundary.
    const latest = tx.selectDistinctOn([schema.resultRevisions.entryId], {
      ...getTableColumns(schema.resultRevisions)
    }).from(schema.resultRevisions).where(and(
      eq(schema.resultRevisions.raceId, race.id), eq(schema.resultRevisions.published, true)
    )).orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision),
      desc(schema.resultRevisions.id)).as("speaker_latest_published");
    const heads = await tx.select().from(latest).orderBy(desc(latest.createdAt), desc(latest.id)).limit(25);
    const entryIds = heads.map((head) => head.entryId);
    if (new Set(entryIds).size !== heads.length) throw new Error("Speakerunderlaget har dubbla deltagare");
    await guardHistory(tx, race.id, entryIds);
    const states = await resolveStoredResultHeadStates(tx, race.id, heads);
    const parsed = states.map((state) => ({ state,
      outcome: parseStrictStoredResultRevision(state.head, state.startCheckinDns?.source,
        state.finishTimeCorrection ?? undefined, state.finishTimeCorrectionWithdrawal ?? undefined,
        state.punchStartTimeCorrection ?? undefined, state.punchStartTimeCorrectionWithdrawal ?? undefined,
        state.shortenedCourseClassTransfer ?? undefined) }));
    const classIds = [...new Set(parsed.map(({ outcome }) => outcome.classId))];
    const courseVersionIds = [...new Set(heads.map((head) => head.courseVersionId)
      .concat(states.map((state) => state.head.courseVersionId)))];
    const [entries, classes, courses] = await Promise.all([
      entryIds.length === 0 ? Promise.resolve([]) : tx.select({ id: schema.entries.id,
        givenName: schema.entries.givenName, familyName: schema.entries.familyName,
        organisationName: schema.entries.organisationName }).from(schema.entries)
        .where(and(eq(schema.entries.raceId, race.id), inArray(schema.entries.id, entryIds))),
      classIds.length === 0 ? Promise.resolve([]) : tx.select({ id: schema.classes.id, name: schema.classes.name })
        .from(schema.classes).where(and(eq(schema.classes.raceId, race.id), inArray(schema.classes.id, classIds))),
      courseVersionIds.length === 0 ? Promise.resolve([]) : tx.select({ id: schema.courseVersions.id })
        .from(schema.courseVersions).innerJoin(schema.courses, eq(schema.courseVersions.courseId, schema.courses.id))
        .where(and(eq(schema.courses.raceId, race.id), inArray(schema.courseVersions.id, courseVersionIds)))
    ]);
    if (entries.length !== entryIds.length || classes.length !== classIds.length || courses.length !== courseVersionIds.length) {
      throw new Error("Speakerunderlaget saknar giltig lopprelation");
    }
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));
    const classById = new Map(classes.map((raceClass) => [raceClass.id, raceClass.name]));
    const rows: SpeakerBoardRow[] = parsed.map(({ state, outcome }, index) => {
      const entry = entryById.get(state.selectedHead.entryId);
      const className = classById.get(outcome.classId);
      if (!entry || !className) throw new Error("Speakerunderlagets visningsuppgifter saknas");
      const common = { slot: index + 1, givenName: entry.givenName, familyName: entry.familyName,
        organisationName: entry.organisationName, className, selectedRevision: state.selectedHead.revision,
        registeredAt: state.selectedHead.createdAt.toISOString() };
      if (state.state === "NO_ACTIVE_RESULT") return { ...common, state: "NO_ACTIVE_RESULT" };
      return speakerBoardRowSchema.parse({ ...common, state: "ACTIVE_RESULT", result: {
        revision: state.head.revision, status: outcome.status, reason: outcome.reason,
        ...("elapsedMs" in outcome ? { elapsedMs: outcome.elapsedMs } : {})
      } });
    });
    return { status: "ok", response: speakerBoardResponseSchema.parse({
      formatVersion: 1, raceId: race.id, eventName: event.name, raceName: race.name,
      raceSnapshotVersion: race.snapshotVersion, timeZone: event.timeZone,
      generatedAt: now.toISOString(), selection: "LATEST_PUBLISHED_HEADS_BY_REGISTRATION", rows
    }) };
  }, { isolationLevel: "repeatable read" });
}
