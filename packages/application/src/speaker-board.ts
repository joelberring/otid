import { and, asc, desc, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import { speakerBoardResponseSchema, speakerBoardRowSchema, type SpeakerBoardResponse, type SpeakerBoardRow } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { relayClassLegStarts } from "@o-tid/domain";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { parseStrictStoredResultRevision } from "./stored-result-revision";
import { loadRelayClassConfigs, loadRelayLegEntries, loadRelayLegFinishTimes, loadRelayLegResults, loadRelayTeams,
  type RelayLegEntry } from "./relay-model";
import { relayChangeovers } from "./relay-sync";
import { inUuids } from "./sql-ids";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type SpeakerRelayInfo = { teamNumber: number; teamName: string; leg: number; variantCode: string | null; restarted: boolean };

/**
 * Hämtar laguppgifter och omstartsflagga bara för de högst 25 stafettsträckorna på speakersidan, utan att köra hela
 * 7 500-sträckors `loadRelayView`. Klasser utan omstart behöver inga resultatsökningar alls; klasser med fast omstart
 * läser bara de visade lagen, och klasser med flygande omstart räknar bara omstarterna för klassen.
 */
async function loadSpeakerRelayInfo(
  tx: Transaction,
  raceId: string,
  relayEntries: readonly { id: string; teamId: string | null; relayLeg: number | null; courseVariantCode: string | null }[]
): Promise<Map<string, SpeakerRelayInfo>> {
  const relayOf = new Map<string, SpeakerRelayInfo>();
  const valid = relayEntries.filter(
    (entry): entry is { id: string; teamId: string; relayLeg: number; courseVariantCode: string | null } =>
      entry.teamId !== null && entry.relayLeg !== null
  );
  if (valid.length === 0) return relayOf;
  const teamIds = [...new Set(valid.map(entry => entry.teamId))];
  const teams = await loadRelayTeams(tx, raceId, teamIds);
  if (teams.length === 0) return relayOf;
  const teamById = new Map(teams.map(team => [team.id, team]));
  const configs = await loadRelayClassConfigs(tx, raceId);

  const entriesByClass = new Map<string, typeof valid>();
  for (const entry of valid) {
    const team = teamById.get(entry.teamId);
    if (!team || !configs.has(team.classId)) continue;
    let list = entriesByClass.get(team.classId);
    if (!list) { list = []; entriesByClass.set(team.classId, list); }
    list.push(entry);
  }

  for (const [classId, classEntries] of entriesByClass) {
    const config = configs.get(classId)!;
    const ruleByLeg = new Map(config.legs.map(rule => [rule.leg, rule]));
    const needsRestartCheck = classEntries.some(entry => {
      const method = ruleByLeg.get(entry.relayLeg)?.startMethod;
      return method === "RESTART" || method === "FLYING_RESTART";
    });
    const restartedByEntry = new Map<string, boolean>();
    if (needsRestartCheck) {
      const needsFlying = classEntries.some(entry => ruleByLeg.get(entry.relayLeg)?.startMethod === "FLYING_RESTART");
      const scopeTeamIds = needsFlying
        ? (await tx.select({ id: schema.teams.id }).from(schema.teams)
            .where(and(eq(schema.teams.raceId, raceId), eq(schema.teams.classId, classId), isNull(schema.teams.struckAt)))
            .orderBy(asc(schema.teams.number))).map(row => row.id)
        : [...new Set(classEntries.map(entry => entry.teamId))];
      const legEntries = await loadRelayLegEntries(tx, raceId, scopeTeamIds);
      const legEntryIds = legEntries.map(entry => entry.id);
      const finishes = await loadRelayLegFinishTimes(tx, raceId, legEntryIds);
      const needsStatuses = config.legs.some(leg => leg.runners > 1 && leg.changeoverRule === "LAST");
      const statuses = needsStatuses
        ? new Map([...await loadRelayLegResults(tx, raceId, legEntryIds)].map(([id, result]) => [id, result.status]))
        : undefined;
      const byTeam = new Map<string, RelayLegEntry[]>();
      for (const legEntry of legEntries) {
        let list = byTeam.get(legEntry.teamId);
        if (!list) { list = []; byTeam.set(legEntry.teamId, list); }
        list.push(legEntry);
      }
      const starts = relayClassLegStarts(config.legs, scopeTeamIds.map(teamId => ({
        key: teamId,
        changeovers: relayChangeovers(byTeam.get(teamId) ?? [], finishes, config, statuses)
      })));
      for (const entry of classEntries) {
        restartedByEntry.set(entry.id, starts.teams.get(entry.teamId)?.get(entry.relayLeg)?.restarted ?? false);
      }
    }
    for (const entry of classEntries) {
      const team = teamById.get(entry.teamId)!;
      relayOf.set(entry.id, {
        teamNumber: team.number,
        teamName: team.name,
        leg: entry.relayLeg,
        variantCode: entry.courseVariantCode,
        restarted: restartedByEntry.get(entry.id) ?? false
      });
    }
  }
  return relayOf;
}

export type SpeakerBoardResult =
  | { status: "unauthorized" | "forbidden" | "not-found" }
  | { status: "ok"; response: SpeakerBoardResponse };


/** Speaker och kontrollvyns senaste avläsningar: administratören och funktionären (ADR-0172 beslut 3). */
export async function listSpeakerBoardAsAdmin(
  db: Database,
  input: RaceSessionProof,
  now = new Date()
): Promise<SpeakerBoardResult> {
  if (!Number.isFinite(now.getTime())) throw new Error("Lästiden är ogiltig");
  return db.transaction(async (tx) => {
    const authorization = await requireRaceRole(tx, { ...input, role: "FUNCTIONARY" }, now, "share");
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
    }).from(schema.resultRevisions)
      // Struck entries are not shown, so they must not take a slot in the limit either.
      .innerJoin(schema.entries, eq(schema.entries.id, schema.resultRevisions.entryId))
      .where(and(
        eq(schema.resultRevisions.raceId, race.id), eq(schema.resultRevisions.published, true),
        isNull(schema.entries.struckAt)
      )).orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision),
      desc(schema.resultRevisions.id)).as("speaker_latest_published");
    // "Senast i mål" ordnas på när löparen kom in, samma källa som publika Live (`readArrivals` i public-live.ts): den
    // första publicerade revisionen från en avläsning. En omräkning, en rättelse eller ett statusbyte skapar nya
    // revisioner men flyttar alltså inte löparen. Utan avläsning (manuellt beslut) gäller den första publicerade
    // revisionen; Live tar där den senaste, men speakern ska inte heller låta ett senare beslut flytta raden.
    const arrival = tx.select({ entryId: schema.resultRevisions.entryId,
      arrivedAtMs: sql<string>`extract(epoch from coalesce(
        min(${schema.resultRevisions.createdAt}) filter (where ${schema.resultRevisions.readoutId} is not null),
        min(${schema.resultRevisions.createdAt}))) * 1000`.as("arrived_at_ms") })
      .from(schema.resultRevisions)
      .where(and(eq(schema.resultRevisions.raceId, race.id), eq(schema.resultRevisions.published, true)))
      .groupBy(schema.resultRevisions.entryId).as("speaker_arrival");
    const ordered = await tx.select().from(latest).innerJoin(arrival, eq(arrival.entryId, latest.entryId))
      .orderBy(desc(arrival.arrivedAtMs), desc(latest.id)).limit(25);
    const heads = ordered.map((row) => row.speaker_latest_published);
    const arrivedAt = new Map(ordered.map((row) => [row.speaker_arrival.entryId, new Date(Number(row.speaker_arrival.arrivedAtMs))]));
    const entryIds = heads.map((head) => head.entryId);
    if (new Set(entryIds).size !== heads.length) throw new Error("Speakerunderlaget har dubbla deltagare");
    const states = await resolveStoredResultHeadStates(tx, race.id, heads);
    const parsed = states.map((state) => ({ state,
      outcome: parseStrictStoredResultRevision(state.head, state.startCheckinDns?.source) }));
    const classIds = [...new Set(parsed.map(({ outcome }) => outcome.classId))];
    const courseVersionIds = [...new Set(heads.map((head) => head.courseVersionId)
      .concat(states.map((state) => state.head.courseVersionId)))];
    const entries = entryIds.length === 0 ? [] : await tx.select({ id: schema.entries.id,
      givenName: schema.entries.givenName, familyName: schema.entries.familyName,
      organisationName: schema.entries.organisationName, teamId: schema.entries.teamId, relayLeg: schema.entries.relayLeg,
      courseVariantCode: schema.entries.courseVariantCode }).from(schema.entries)
      .where(and(eq(schema.entries.raceId, race.id), inUuids(schema.entries.id, entryIds), isNull(schema.entries.struckAt)));
    const classes = classIds.length === 0 ? [] : await tx.select({ id: schema.classes.id, name: schema.classes.name })
      .from(schema.classes).where(and(eq(schema.classes.raceId, race.id), inUuids(schema.classes.id, classIds)));
    const courses = courseVersionIds.length === 0 ? [] : await tx.select({ id: schema.courseVersions.id })
      .from(schema.courseVersions).innerJoin(schema.courses, eq(schema.courseVersions.courseId, schema.courses.id))
      .where(and(eq(schema.courses.raceId, race.id), inUuids(schema.courseVersions.id, courseVersionIds)));
    if (entries.length !== entryIds.length || classes.length !== classIds.length || courses.length !== courseVersionIds.length) {
      throw new Error("Speakerunderlaget saknar giltig lopprelation");
    }
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));
    // Steg 47: stafettsträckornas lag och omstart (lättviktigt urval för de visade raderna).
    const relayEntries = entries.filter((entry) => entry.teamId !== null);
    const relayOf = await loadSpeakerRelayInfo(tx, race.id, relayEntries);
    const classById = new Map(classes.map((raceClass) => [raceClass.id, raceClass.name]));
    const arrivedAtOf = (entryId: string) => {
      const at = arrivedAt.get(entryId);
      if (!at || !Number.isFinite(at.getTime())) throw new Error("Speakerunderlagets ankomsttid saknas");
      return at.toISOString();
    };
    const rows: SpeakerBoardRow[] = parsed.map(({ state, outcome }, index) => {
      const entry = entryById.get(state.selectedHead.entryId);
      const className = classById.get(outcome.classId);
      if (!entry || !className) throw new Error("Speakerunderlagets visningsuppgifter saknas");
      const common = { slot: index + 1, givenName: entry.givenName, familyName: entry.familyName,
        organisationName: entry.organisationName, className, selectedRevision: state.selectedHead.revision,
        registeredAt: arrivedAtOf(state.selectedHead.entryId), ...(relayOf.has(entry.id) ? { relay: relayOf.get(entry.id)! } : {}) };
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
