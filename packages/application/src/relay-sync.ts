import { eq, inArray, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { RELAY_MAX_LEGS, relayClassLegStarts, relayParallelChangeover, type StoredResultStatus } from "@o-tid/domain";
import { loadRelayClassConfigs, loadRelayLegEntries, loadRelayLegFinishTimes, loadRelayLegResults, loadRelayTeams, type RelayClassConfig,
  type RelayLegEntry } from "./relay-model";
import { assessReadOutEntries, recalculateAssessedEntries } from "./result-reassessment";
import { loadRaceSnapshot } from "./snapshot";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

/**
 * Håller sträckornas starttider aktuella (ADR-0169 beslut 3, steg 47). Sträckans start räknas i domänen
 * (`relayClassLegStarts`) ur startsättet och lagets växling från föregående sträcka, och vid flygande omstart
 * ur ledarlagets växling. Den sparas som sträcklöparens fasta starttid och ingår därmed i resultatets underlag:
 * när en sträcka får ny start räknas dess avläsning om i samma transaktion (ny revision, historik kvar).
 * Måltiden kommer från resultatet eller avläsningens målstämpling och påverkas inte av sträckans egen start, så
 * alla starter kan räknas först och de berörda sträckorna sedan räknas om en gång.
 *
 * En flygande omstart gör att ett lags växling kan ändra andra lags starter. Därför räknas alltid hela klassen,
 * under ett lås per klass, så att avläsning på flera datorer samtidigt (linjestafett) ger samma starter.
 *
 * Anropas efter varje ändring som kan ge en sträcka ny måltid (avläsning, koppling av okänd bricka,
 * måltidsrättning) och efter ändrade start- eller omstartstider.
 */
export async function lockRelayClasses(tx: Executor, classIds: readonly string[]): Promise<void> {
  for (const classId of [...new Set(classIds)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"relay-class:" + classId}, 0))`);
  }
}

/** Låser stafettklassen för brickans deltagare (anropas före bedömningen av en avläsning). */
export async function lockRelayClassOfEntry(tx: Executor, entryId: string | undefined): Promise<void> {
  if (!entryId) return;
  const [row] = await tx.select({ classId: schema.entries.classId, teamId: schema.entries.teamId }).from(schema.entries)
    .where(eq(schema.entries.id, entryId));
  if (row?.teamId) await lockRelayClasses(tx, [row.classId]);
}

export async function synchronizeRelayTeams(tx: Transaction, raceId: string, teamIds: readonly string[],
  snapshotVersion: number): Promise<{ readonly changedStarts: number; readonly recalculated: number }> {
  const unique = [...new Set(teamIds)];
  if (unique.length === 0) return { changedStarts: 0, recalculated: 0 };
  const classIds = [...new Set((await tx.select({ classId: schema.teams.classId }).from(schema.teams)
    .where(inArray(schema.teams.id, unique))).map(row => row.classId))];
  return synchronizeRelayClasses(tx, raceId, classIds, snapshotVersion);
}

/** Samma som ovan för alla lag i en stafettklass. */
export async function synchronizeRelayClass(tx: Transaction, raceId: string, classId: string, snapshotVersion: number) {
  return synchronizeRelayClasses(tx, raceId, [classId], snapshotVersion);
}

/**
 * Lagets växling ut från varje sträcka: sträckans måltid, eller vid flera löpare på sträckan (steg 48) första eller sista
 * löparens mål enligt sträckans regel.
 */
export function relayChangeovers(legs: readonly RelayLegEntry[], finishes: ReadonlyMap<string, string>, config?: RelayClassConfig,
  statuses?: ReadonlyMap<string, StoredResultStatus>): Map<number, string | undefined> {
  const byLeg = new Map<number, RelayLegEntry[]>();
  for (const entry of legs) byLeg.set(entry.leg, [...byLeg.get(entry.leg) ?? [], entry]);
  return new Map([...byLeg].map(([leg, runners]) => {
    if (runners.length === 1) return [leg, finishes.get(runners[0]!.id)] as const;
    const rule = config?.legs.find(row => row.leg === leg)?.changeoverRule ?? "FIRST";
    return [leg, relayParallelChangeover(rule, runners.map(runner => ({ ...(finishes.has(runner.id) ? { finishTime: finishes.get(runner.id)! } : {}),
      ...(statuses?.has(runner.id) ? { status: statuses.get(runner.id)! } : {}) })))] as const;
  }));
}

export async function synchronizeRelayClasses(tx: Transaction, raceId: string, classIds: readonly string[],
  snapshotVersion: number): Promise<{ readonly changedStarts: number; readonly recalculated: number }> {
  if (classIds.length === 0) return { changedStarts: 0, recalculated: 0 };
  // En omräknad sträcka kan få ett mål (t.ex. en avläsning som kom före föregående sträckas, eller teamsprintens del vars
  // växling står på lagkamratens bricka) och därmed ge nästa sträcka en ny start: upprepa tills inga starter ändras.
  // Varje varv fastställer minst en sträcka till, så antalet varv begränsas av antalet platser (30 sträckor × 4 löpare).
  let changedStarts = 0, recalculated = 0;
  for (let round = 0; round <= RELAY_MAX_LEGS * 4; round += 1) {
    const changed = await recomputeRelayStarts(tx, raceId, classIds);
    if (changed.length === 0) return { changedStarts, recalculated };
    changedStarts += changed.length;
    const snapshot = await loadRaceSnapshot(tx, raceId);
    for (const classId of [...new Set(changed.map(row => row.classId))]) {
      const raceClass = snapshot.classes.find(row => row.id === classId);
      if (!raceClass) throw new Error("Stafettklassen saknas");
      const changedIds = changed.filter(row => row.classId === classId).map(row => row.entryId);
      const assessed = await assessReadOutEntries(tx, raceId, [{ id: classId, name: raceClass.name }], snapshot, snapshot, changedIds);
      if (assessed === "too-large") throw new Error("Stafettklassen är för stor");
      const rows = await recalculateAssessedEntries(tx, { raceId, assessed, snapshot, snapshotVersion,
        courseVersionId: new Map([[classId, raceClass.courseVersionId]]) });
      recalculated += rows.length;
    }
  }
  throw new Error("Stafettens starter blev inte stabila");
}

/** Räknar och sparar sträckornas starttider i klasserna utan omräkning. Ger sträcklöparna som fick ny start. */
export async function recomputeRelayStarts(tx: Transaction, raceId: string, classIds: readonly string[])
  : Promise<{ entryId: string; classId: string }[]> {
  await lockRelayClasses(tx, classIds);
  const configs = await loadRelayClassConfigs(tx, raceId);
  const teams = (await loadRelayTeams(tx, raceId)).filter(team => classIds.includes(team.classId));
  const entries = await loadRelayLegEntries(tx, raceId, teams.map(team => team.id));
  const finishes = await loadRelayLegFinishTimes(tx, raceId, entries.map(entry => entry.id));
  // Steg 48: "sista i mål" kräver att alla löpare på sträckan har ett resultat.
  const statuses = new Map([...await loadRelayLegResults(tx, raceId, entries.map(entry => entry.id))].map(([id, result]) => [id, result.status]));
  const changed: { entryId: string; classId: string }[] = [];
  for (const classId of classIds) {
    const config = configs.get(classId);
    if (!config) throw new Error("Laget hör inte till en stafettklass");
    const classTeams = teams.filter(team => team.classId === classId);
    const legsByTeam = new Map(classTeams.map(team => [team.id, entries.filter(entry => entry.teamId === team.id)]));
    const starts = relayClassLegStarts(config.legs, classTeams.map(team => ({ key: team.id,
      changeovers: relayChangeovers(legsByTeam.get(team.id)!, finishes, config, statuses) })));
    for (const team of classTeams) {
      for (const entry of legsByTeam.get(team.id)!) {
        if (!config.legs.some(leg => leg.leg === entry.leg)) throw new Error("Sträckan saknas i stafettklassen");
        const start = starts.teams.get(team.id)?.get(entry.leg)?.start;
        if ((entry.fixedStartTime?.toISOString() ?? undefined) === start) continue;
        await tx.update(schema.entries).set({ fixedStartTime: start ? new Date(start) : null }).where(eq(schema.entries.id, entry.id));
        changed.push({ entryId: entry.id, classId: entry.classId });
      }
    }
  }
  return changed;
}
