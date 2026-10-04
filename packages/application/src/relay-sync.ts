import { eq } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { relayLegStartTime } from "@o-tid/domain";
import { loadRelayClassConfigs, loadRelayLegEntries, loadRelayLegFinishTimes, loadRelayTeams } from "./relay-model";
import { assessReadOutEntries, recalculateAssessedEntries } from "./result-reassessment";
import { loadRaceSnapshot } from "./snapshot";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Håller sträckornas starttider aktuella (ADR-0169 beslut 3). Sträckans start räknas i domänen
 * ur startsättet och föregående sträckas måltid och sparas som sträcklöparens fasta starttid.
 * Därmed ingår den i resultatets underlag: när en sträcka får ny start räknas dess avläsning om
 * i samma transaktion (ny revision, historik kvar). Måltiden kommer från resultatet eller
 * avläsningens målstämpling och påverkas inte av sträckans egen start, så alla starter kan
 * räknas först och de berörda sträckorna sedan räknas om en gång.
 *
 * Anropas efter varje ändring som kan ge en sträcka ny måltid (avläsning, koppling av okänd
 * bricka, måltidsrättning) och efter ändrade start- eller omstartstider.
 */
export async function synchronizeRelayTeams(tx: Transaction, raceId: string, teamIds: readonly string[],
  snapshotVersion: number): Promise<{ readonly changedStarts: number; readonly recalculated: number }> {
  const unique = [...new Set(teamIds)];
  if (unique.length === 0) return { changedStarts: 0, recalculated: 0 };
  const [configs, teams, entries] = await Promise.all([loadRelayClassConfigs(tx, raceId), loadRelayTeams(tx, raceId, unique),
    loadRelayLegEntries(tx, raceId, unique)]);
  const finishes = await loadRelayLegFinishTimes(tx, raceId, entries.map(entry => entry.id));
  const changed: { entryId: string; classId: string }[] = [];
  for (const team of teams) {
    const config = configs.get(team.classId);
    if (!config) throw new Error("Laget hör inte till en stafettklass");
    const legs = entries.filter(entry => entry.teamId === team.id);
    for (const entry of legs) {
      const rule = config.legs.find(leg => leg.leg === entry.leg);
      if (!rule) throw new Error("Sträckan saknas i stafettklassen");
      const previous = legs.find(candidate => candidate.leg === entry.leg - 1);
      const start = relayLegStartTime(rule, previous ? finishes.get(previous.id) : undefined);
      if ((entry.fixedStartTime?.toISOString() ?? undefined) === start) continue;
      await tx.update(schema.entries).set({ fixedStartTime: start ? new Date(start) : null }).where(eq(schema.entries.id, entry.id));
      changed.push({ entryId: entry.id, classId: entry.classId });
    }
  }
  if (changed.length === 0) return { changedStarts: 0, recalculated: 0 };
  const snapshot = await loadRaceSnapshot(tx, raceId);
  const changedIds = new Set(changed.map(row => row.entryId));
  const classIds = [...new Set(changed.map(row => row.classId))];
  let recalculated = 0;
  for (const classId of classIds) {
    const raceClass = snapshot.classes.find(row => row.id === classId);
    if (!raceClass) throw new Error("Stafettklassen saknas");
    const assessed = await assessReadOutEntries(tx, raceId, [{ id: classId, name: raceClass.name }], snapshot, snapshot);
    if (assessed === "too-large") throw new Error("Stafettklassen är för stor");
    const rows = await recalculateAssessedEntries(tx, { raceId, assessed: assessed.filter(row => changedIds.has(row.entryId)),
      snapshot, snapshotVersion, courseVersionId: raceClass.courseVersionId });
    recalculated += rows.length;
  }
  return { changedStarts: changed.length, recalculated };
}

/** Samma som ovan för alla lag i en stafettklass. */
export async function synchronizeRelayClass(tx: Transaction, raceId: string, classId: string, snapshotVersion: number) {
  const teams = (await loadRelayTeams(tx, raceId)).filter(team => team.classId === classId);
  return synchronizeRelayTeams(tx, raceId, teams.map(team => team.id), snapshotVersion);
}
