import { and, eq, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { RELAY_MAX_LEGS, relayClassLegStarts, relayParallelChangeover, type StoredResultStatus } from "@o-tid/domain";
import { loadRelayClassConfigs, loadRelayLegEntries, loadRelayLegFinishTimes, loadRelayLegResults, loadRelayTeams, type RelayClassConfig,
  type RelayLegEntry } from "./relay-model";
import { assessReadOutEntries, recalculateAssessedEntries } from "./result-reassessment";
import { loadRaceSnapshot } from "./snapshot";
import { inUuids } from "./sql-ids";

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
 * En flygande omstart gör att ett lags växling kan ändra andra lags starter. Därför räknas hela klassen när den har en
 * flygande omstart, under ett lås per klass, så att avläsning på flera datorer samtidigt (linjestafett) ger samma starter.
 * Steg 51 (lasttest): utan flygande omstart beror ett lags starter bara på lagets egna växlingar, och då räknas bara de
 * ändrade lagen (en avläsning i en 25-mannastafett med 300 lag läser inte längre alla 7 500 sträckor).
 *
 * Anropas efter varje ändring som kan ge en sträcka ny måltid (avläsning, koppling av okänd bricka,
 * måltidsrättning) och efter ändrade start- eller omstartstider.
 */
export async function lockRelayClasses(tx: Executor, classIds: readonly string[]): Promise<void> {
  for (const classId of [...new Set(classIds)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"relay-class:" + classId}, 0))`);
  }
}

/**
 * Steg 54 (ADR-0177): utan flygande omstart beror ett lags starter bara på lagets egna växlingar. Då låses klassen delat
 * och laget ensamt, så att avläsningar för olika lag i samma klass (25-manna med flera avläsningsdatorer) görs samtidigt.
 * Det som räknar hela klassen (flygande omstart, ändrade starttider) låser klassen ensam och väntar ut dem. Ordningen är
 * alltid klassen före laget.
 */
export async function lockRelayTeams(tx: Executor, classId: string, teamIds: readonly string[]): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${"relay-class:" + classId}, 0))`);
  for (const teamId of [...new Set(teamIds)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"relay-team:" + teamId}, 0))`);
  }
}

async function hasFlyingRestart(tx: Executor, classId: string): Promise<boolean> {
  const [row] = await tx.select({ leg: schema.relayLegs.leg }).from(schema.relayLegs)
    .where(and(eq(schema.relayLegs.classId, classId), eq(schema.relayLegs.startMethod, "FLYING_RESTART"))).limit(1);
  return row !== undefined;
}

/**
 * Låser för brickans deltagare (anropas före bedömningen av en avläsning): hela klassen med flygande omstart, annars
 * laget (steg 54). Fick klassen flygande omstart medan låset togs görs avläsningen om (avläsningsdatorn försöker igen).
 */
export async function lockRelayClassOfEntry(tx: Executor, entryId: string | undefined): Promise<void> {
  if (!entryId) return;
  const [row] = await tx.select({ classId: schema.entries.classId, teamId: schema.entries.teamId }).from(schema.entries)
    .where(eq(schema.entries.id, entryId));
  if (!row?.teamId) return;
  if (await hasFlyingRestart(tx, row.classId)) { await lockRelayClasses(tx, [row.classId]); return; }
  await lockRelayTeams(tx, row.classId, [row.teamId]);
  if (await hasFlyingRestart(tx, row.classId)) throw new Error("Stafettklassen ändrades under avläsningen; försök igen");
}

export async function synchronizeRelayTeams(tx: Transaction, raceId: string, teamIds: readonly string[],
  snapshotVersion: number): Promise<{ readonly changedStarts: number; readonly recalculated: number }> {
  const unique = [...new Set(teamIds)];
  if (unique.length === 0) return { changedStarts: 0, recalculated: 0 };
  const teamRows = await loadRelayTeams(tx, raceId, unique);
  if (teamRows.length === 0) return { changedStarts: 0, recalculated: 0 };
  const classIds = [...new Set(teamRows.map(row => row.classId))];
  return synchronizeRelayClasses(tx, raceId, classIds, snapshotVersion, unique, teamRows);
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
  for (const entry of legs) {
    let group = byLeg.get(entry.leg);
    if (!group) { group = []; byLeg.set(entry.leg, group); }
    group.push(entry);
  }
  const rulesByLeg = config ? new Map(config.legs.map(row => [row.leg, row.changeoverRule])) : undefined;
  return new Map([...byLeg].map(([leg, runners]) => {
    if (runners.length === 1) return [leg, finishes.get(runners[0]!.id)] as const;
    const rule = rulesByLeg?.get(leg) ?? "FIRST";
    return [leg, relayParallelChangeover(rule, runners.map(runner => ({ ...(finishes.has(runner.id) ? { finishTime: finishes.get(runner.id)! } : {}),
      ...(statuses?.has(runner.id) ? { status: statuses.get(runner.id)! } : {}) })))] as const;
  }));
}

/**
 * Billig kontroll inför omräkning: har någon av de uppdaterade sträckstartarna redan ett resultat eller en avläst bricka?
 * Vid en vanlig växling (~99 % av stafettstämplingarna) har nästkommande sträcka varken resultat eller avläsning än, så
 * ögonblicksbild #2, `assessReadOutEntries` och varv 2 kan hoppas över helt med identiskt utfall.
 */
async function anyEntryNeedsReassessment(tx: Transaction, raceId: string, entryIds: readonly string[]): Promise<boolean> {
  if (entryIds.length === 0) return false;
  const { rows } = await tx.execute<{ needed: boolean }>(sql`
    select (
      exists (
        select 1 from ${schema.resultRevisions}
        where ${schema.resultRevisions.raceId} = ${raceId}
          and ${inUuids(schema.resultRevisions.entryId, entryIds)}
      )
      or exists (
        select 1 from ${schema.cardAssignments}
        join ${schema.cardReadouts}
          on ${schema.cardReadouts.raceId} = ${schema.cardAssignments.raceId}
          and ${schema.cardReadouts.cardNumber} = ${schema.cardAssignments.cardNumber}
        where ${schema.cardAssignments.raceId} = ${raceId}
          and ${schema.cardAssignments.active} = true
          and ${inUuids(schema.cardAssignments.entryId, entryIds)}
      )
    ) as needed
  `);
  return rows[0]?.needed === true;
}

export async function synchronizeRelayClasses(tx: Transaction, raceId: string, classIds: readonly string[],
  snapshotVersion: number, teamIds?: readonly string[],
  prefetchedTeams?: readonly { id: string; classId: string }[]): Promise<{ readonly changedStarts: number; readonly recalculated: number }> {
  if (classIds.length === 0) return { changedStarts: 0, recalculated: 0 };
  // En omräknad sträcka kan få ett mål (t.ex. en avläsning som kom före föregående sträckas, eller teamsprintens del vars
  // växling står på lagkamratens bricka) och därmed ge nästa sträcka en ny start: upprepa tills inga starter ändras.
  // Varje varv fastställer minst en sträcka till, så antalet varv begränsas av antalet platser (30 sträckor × 4 löpare).
  let changedStarts = 0, recalculated = 0;
  for (let round = 0; round <= RELAY_MAX_LEGS * 4; round += 1) {
    const changed = await recomputeRelayStarts(tx, raceId, classIds, teamIds, round === 0 ? prefetchedTeams : undefined);
    if (changed.length === 0) return { changedStarts, recalculated };
    changedStarts += changed.length;
    const changedEntryIds = changed.map(row => row.entryId);
    if (!await anyEntryNeedsReassessment(tx, raceId, changedEntryIds)) return { changedStarts, recalculated };
    // Steg 54: bara lagen som fick nya starter (deras sträckor räknas om), inte hela tävlingen.
    const snapshot = await loadRaceSnapshot(tx, raceId, { entryIds: changedEntryIds });
    const changedByClass = new Map<string, string[]>();
    for (const row of changed) {
      let list = changedByClass.get(row.classId);
      if (!list) { list = []; changedByClass.set(row.classId, list); }
      list.push(row.entryId);
    }
    for (const [classId, changedIds] of changedByClass) {
      const raceClass = snapshot.classes.find(row => row.id === classId);
      if (!raceClass) throw new Error("Stafettklassen saknas");
      const assessed = await assessReadOutEntries(tx, raceId, [{ id: classId, name: raceClass.name }], snapshot, snapshot, changedIds);
      if (assessed === "too-large") throw new Error("Stafettklassen är för stor");
      const rows = await recalculateAssessedEntries(tx, { raceId, assessed, snapshot, snapshotVersion,
        courseVersionId: new Map([[classId, raceClass.courseVersionId]]) });
      recalculated += rows.length;
    }
  }
  throw new Error("Stafettens starter blev inte stabila");
}

/**
 * Räknar och sparar sträckornas starttider i klasserna utan omräkning. Ger sträcklöparna som fick ny start.
 * `teamIds` (lagen som ändrats) begränsar räkningen i klasser utan flygande omstart; med flygande omstart räknas hela klassen.
 */
export async function recomputeRelayStarts(tx: Transaction, raceId: string, classIds: readonly string[], teamIds?: readonly string[],
  prefetchedTeams?: readonly { id: string; classId: string }[])
  : Promise<{ entryId: string; classId: string }[]> {
  if (classIds.length === 0) return [];
  const onlyTeams = teamIds === undefined ? undefined : new Set(teamIds);
  const flyingRows = await tx.selectDistinct({ classId: schema.relayLegs.classId }).from(schema.relayLegs)
    .where(and(inUuids(schema.relayLegs.classId, classIds), eq(schema.relayLegs.startMethod, "FLYING_RESTART")));
  const flying = new Set(flyingRows.map(row => row.classId));
  const wholeClass = (classId: string) => onlyTeams === undefined || flying.has(classId);
  // Steg 54: hela klasser låses ensamma, klasser utan flygande omstart bara för de ändrade lagen (klassen delat).
  await lockRelayClasses(tx, classIds.filter(wholeClass));
  const needsAllTeams = classIds.some(wholeClass);
  const allTeams = !needsAllTeams && prefetchedTeams
    ? prefetchedTeams
    : await loadRelayTeams(tx, raceId, needsAllTeams ? undefined : [...onlyTeams!]);
  const teamIdsByClass = new Map<string, string[]>();
  for (const team of allTeams) {
    if (onlyTeams && !onlyTeams.has(team.id)) continue;
    let list = teamIdsByClass.get(team.classId);
    if (!list) { list = []; teamIdsByClass.set(team.classId, list); }
    list.push(team.id);
  }
  for (const classId of [...classIds].filter(classId => !wholeClass(classId)).sort()) {
    await lockRelayTeams(tx, classId, teamIdsByClass.get(classId) ?? []);
  }
  const configs = await loadRelayClassConfigs(tx, raceId);
  if (classIds.some(classId => !wholeClass(classId) && configs.get(classId)?.legs.some(leg => leg.startMethod === "FLYING_RESTART"))) {
    throw new Error("Stafettklassen ändrades under omräkningen; försök igen");
  }
  const classIdSet = new Set(classIds);
  const teams = allTeams.filter(team => classIdSet.has(team.classId) &&
    (wholeClass(team.classId) || onlyTeams!.has(team.id)));
  const entries = await loadRelayLegEntries(tx, raceId, teams.map(team => team.id));
  const entriesByTeam = new Map<string, RelayLegEntry[]>();
  for (const entry of entries) {
    let list = entriesByTeam.get(entry.teamId);
    if (!list) { list = []; entriesByTeam.set(entry.teamId, list); }
    list.push(entry);
  }
  const entryIds = entries.map(entry => entry.id);
  const finishes = await loadRelayLegFinishTimes(tx, raceId, entryIds);
  // Steg 48: "sista i mål" på parallella sträckor (runners > 1) kräver att alla löpare på sträckan har ett resultat.
  const needsStatuses = classIds.some(classId =>
    configs.get(classId)?.legs.some(leg => leg.runners > 1 && leg.changeoverRule === "LAST")
  );
  const statuses = needsStatuses
    ? new Map([...await loadRelayLegResults(tx, raceId, entryIds)].map(([id, result]) => [id, result.status]))
    : undefined;
  const teamsByClass = new Map<string, typeof teams>();
  for (const team of teams) {
    let list = teamsByClass.get(team.classId);
    if (!list) { list = []; teamsByClass.set(team.classId, list); }
    list.push(team);
  }
  const changed: { entryId: string; classId: string }[] = [];
  const updates: { entryId: string; start: string | null }[] = [];
  for (const classId of classIds) {
    const config = configs.get(classId);
    if (!config) throw new Error("Laget hör inte till en stafettklass");
    const validLegs = new Set(config.legs.map(leg => leg.leg));
    const classTeams = teamsByClass.get(classId) ?? [];
    const legsByTeam = new Map(classTeams.map(team => [team.id, entriesByTeam.get(team.id) ?? []]));
    const starts = relayClassLegStarts(config.legs, classTeams.map(team => ({ key: team.id,
      changeovers: relayChangeovers(legsByTeam.get(team.id)!, finishes, config, statuses) })));
    for (const team of classTeams) {
      for (const entry of legsByTeam.get(team.id)!) {
        if (!validLegs.has(entry.leg)) throw new Error("Sträckan saknas i stafettklassen");
        const start = starts.teams.get(team.id)?.get(entry.leg)?.start;
        if ((entry.fixedStartTime?.toISOString() ?? undefined) === start) continue;
        updates.push({ entryId: entry.id, start: start ?? null });
        changed.push({ entryId: entry.id, classId: entry.classId });
      }
    }
  }
  if (updates.length === 1) {
    const single = updates[0]!;
    await tx.update(schema.entries).set({ fixedStartTime: single.start ? new Date(single.start) : null })
      .where(eq(schema.entries.id, single.entryId));
  } else if (updates.length > 1) {
    const chunkSize = 1_000;
    for (let offset = 0; offset < updates.length; offset += chunkSize) {
      const chunk = updates.slice(offset, offset + chunkSize);
      const ids = chunk.map(row => row.entryId);
      const starts = chunk.map(row => row.start);
      await tx.execute(sql`
        update ${schema.entries} as e
        set fixed_start_time = v.start_time
        from unnest(${sql.param(ids)}::uuid[], ${sql.param(starts)}::timestamptz[]) as v(id, start_time)
        where e.id = v.id
      `);
    }
  }
  return changed;
}
