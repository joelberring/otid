import { and, asc, desc, eq, getTableColumns, inArray, isNotNull } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import type { RelayLegRule, RelayStartMethod, StoredResultStatus } from "@o-tid/domain";
import { parseAdministratorStoredResultHead } from "./administrator-effective-result";
import { resolveStoredResultHeadStates } from "./result-revision-state";

/**
 * Stafett (ADR-0169 beslut 3): läsning av stafettklassernas sträckor, lagen, sträcklöparna
 * och sträckornas resultat. Bara läsning; reglerna finns i `@o-tid/domain` (relay.ts).
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

export interface RelayLegConfig extends RelayLegRule {
  readonly variantCode: string | null;
}

export interface RelayClassConfig {
  readonly classId: string;
  readonly legs: readonly RelayLegConfig[];
}

/** Stafettklasserna i loppet med sträckor i ordning. En klass utan sträckor är individuell. */
export async function loadRelayClassConfigs(tx: Executor, raceId: string): Promise<Map<string, RelayClassConfig>> {
  const rows = await tx.select().from(schema.relayLegs).where(eq(schema.relayLegs.raceId, raceId))
    .orderBy(asc(schema.relayLegs.classId), asc(schema.relayLegs.leg));
  const configs = new Map<string, RelayLegConfig[]>();
  for (const row of rows) {
    const legs = configs.get(row.classId) ?? [];
    legs.push({ leg: row.leg, startMethod: row.startMethod as RelayStartMethod, variantCode: row.courseVariantCode,
      ...(row.startTime ? { startTime: row.startTime.toISOString() } : {}) });
    configs.set(row.classId, legs);
  }
  return new Map([...configs].map(([classId, legs]) => [classId, { classId, legs }]));
}

export async function loadRelayTeams(tx: Executor, raceId: string, teamIds?: readonly string[]) {
  if (teamIds && teamIds.length === 0) return [];
  return tx.select({ id: schema.teams.id, classId: schema.teams.classId, number: schema.teams.number, name: schema.teams.name,
    organisationName: schema.teams.organisationName }).from(schema.teams)
    .where(teamIds ? and(eq(schema.teams.raceId, raceId), inArray(schema.teams.id, [...teamIds])) : eq(schema.teams.raceId, raceId))
    .orderBy(asc(schema.teams.number));
}
export type RelayTeamRow = Awaited<ReturnType<typeof loadRelayTeams>>[number];

/** Sträcklöparna (deltagare med lag) i sträckordning per lag. */
export async function loadRelayLegEntries(tx: Executor, raceId: string, teamIds?: readonly string[]) {
  if (teamIds && teamIds.length === 0) return [];
  const rows = await tx.select({ id: schema.entries.id, classId: schema.entries.classId, teamId: schema.entries.teamId,
    leg: schema.entries.relayLeg, givenName: schema.entries.givenName, familyName: schema.entries.familyName,
    organisationName: schema.entries.organisationName, fixedStartTime: schema.entries.fixedStartTime, version: schema.entries.version,
    courseVariantCode: schema.entries.courseVariantCode, publicResultId: schema.entries.publicResultId }).from(schema.entries)
    .where(and(eq(schema.entries.raceId, raceId), isNotNull(schema.entries.teamId),
      ...(teamIds ? [inArray(schema.entries.teamId, [...teamIds])] : [])))
    .orderBy(asc(schema.entries.teamId), asc(schema.entries.relayLeg));
  return rows.map(row => ({ ...row, teamId: row.teamId!, leg: row.leg! }));
}
export type RelayLegEntry = Awaited<ReturnType<typeof loadRelayLegEntries>>[number];

/** Lagets id för en deltagare, om deltagaren är sträcklöpare. */
export async function relayTeamOfEntry(tx: Executor, entryId: string): Promise<string | undefined> {
  const [row] = await tx.select({ teamId: schema.entries.teamId }).from(schema.entries).where(eq(schema.entries.id, entryId));
  return row?.teamId ?? undefined;
}

/**
 * Sträckans måltid, som avgör nästa sträckas växling: måltiden i den senaste resultatrevisionen
 * som har en (även felstämplad eller manuellt rättad), annars målstämplingen i revisionens avläsning
 * (en sträcka som lästes av före föregående sträcka saknar start men har gått i mål).
 */
export async function loadRelayLegFinishTimes(tx: Executor, raceId: string, entryIds: readonly string[]): Promise<Map<string, string>> {
  if (entryIds.length === 0) return new Map();
  const rows = await tx.select({ entryId: schema.resultRevisions.entryId, revision: schema.resultRevisions.revision,
    evaluation: schema.resultRevisions.evaluation, readoutFinish: schema.cardReadouts.finishPunchedAt })
    .from(schema.resultRevisions).leftJoin(schema.cardReadouts, eq(schema.cardReadouts.id, schema.resultRevisions.readoutId))
    .where(and(eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.entryId, [...entryIds])))
    .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision));
  const finishes = new Map<string, string>();
  for (const row of rows) {
    if (finishes.has(row.entryId)) continue;
    const evaluated = "finishTime" in row.evaluation && typeof row.evaluation.finishTime === "string" ? row.evaluation.finishTime : undefined;
    const finish = evaluated ?? row.readoutFinish?.toISOString();
    if (finish) finishes.set(row.entryId, new Date(finish).toISOString());
  }
  return finishes;
}

export interface RelayLegResult {
  readonly status: StoredResultStatus;
  readonly elapsedMs?: number;
  readonly startTime?: string;
  readonly finishTime?: string;
  readonly courseVersionId: string;
}

/** Sträckornas gällande (publicerade) resultat, samma som deltagarlistan och de publika resultaten visar. */
export async function loadRelayLegResults(tx: Transaction, raceId: string, entryIds: readonly string[]): Promise<Map<string, RelayLegResult>> {
  if (entryIds.length === 0) return new Map();
  const heads = await tx.selectDistinctOn([schema.resultRevisions.entryId], { ...getTableColumns(schema.resultRevisions) })
    .from(schema.resultRevisions).where(and(eq(schema.resultRevisions.raceId, raceId), eq(schema.resultRevisions.published, true),
      inArray(schema.resultRevisions.entryId, [...entryIds])))
    .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id));
  const results = new Map<string, RelayLegResult>();
  for (const state of await resolveStoredResultHeadStates(tx, raceId, heads)) {
    if (state.state !== "ACTIVE_RESULT") continue;
    const outcome = parseAdministratorStoredResultHead(state);
    results.set(state.head.entryId, { status: outcome.status as StoredResultStatus, courseVersionId: state.head.courseVersionId,
      ...("elapsedMs" in outcome && outcome.elapsedMs !== undefined ? { elapsedMs: outcome.elapsedMs } : {}),
      ...("startTime" in outcome && outcome.startTime !== undefined ? { startTime: outcome.startTime } : {}),
      ...("finishTime" in outcome && outcome.finishTime !== undefined ? { finishTime: outcome.finishTime } : {}) });
  }
  return results;
}
