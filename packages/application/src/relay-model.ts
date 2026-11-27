import { and, asc, desc, eq, getTableColumns, isNotNull, isNull, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import type { RelayApprovalRule, RelayChangeoverRule, RelayForkingMode, RelayLegRule, RelayRestartRanking, RelayStartMethod,
  StoredResultStatus } from "@o-tid/domain";
import { parseAdministratorStoredResultHead } from "./administrator-effective-result";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { inUuids } from "./sql-ids";

/**
 * Stafett (ADR-0169 beslut 3): läsning av stafettklassernas sträckor, lagen, sträcklöparna
 * och sträckornas resultat. Bara läsning; reglerna finns i `@o-tid/domain` (relay.ts).
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

export interface RelayLegConfig extends RelayLegRule {
  readonly variantCode: string | null;
  /** Steg 47: sträckans egen banversion; null = klassens. */
  readonly courseVersionId: string | null;
  /** Steg 48: löpare på sträckan (1–4), när laget växlar och när sträckan är godkänd. */
  readonly runners: number;
  readonly changeoverRule: RelayChangeoverRule;
  readonly approvalRule: RelayApprovalRule;
}

export interface RelayClassConfig {
  readonly classId: string;
  readonly legs: readonly RelayLegConfig[];
  /** Steg 47: placering av lag i omstart (förval AFTER_NORMAL, SOFT TR 5.8.2) och gaffling (förval EVEN). */
  readonly restartRanking: RelayRestartRanking;
  readonly forking: RelayForkingMode;
  /** Klassens banversion, som gäller sträckor utan egen bana. */
  readonly classCourseVersionId: string;
  /** Steg 48: teamsprint – växlingskontrollens kod; null = vanlig stafett. */
  readonly changeoverCode: number | null;
  /** Steg 50: teamsprint – utläsning efter varje sträcka eller efter sista sträckan; null = vanlig stafett. */
  readonly readoutMode: "EACH_LEG" | "LAST_LEG" | null;
}

/** Stafettklasserna i loppet med sträckor i ordning. En klass utan sträckor är individuell. */
export async function loadRelayClassConfigs(tx: Executor, raceId: string): Promise<Map<string, RelayClassConfig>> {
  const rows = await tx.select({
    classId: schema.relayLegs.classId,
    leg: schema.relayLegs.leg,
    startMethod: schema.relayLegs.startMethod,
    courseVariantCode: schema.relayLegs.courseVariantCode,
    courseVersionId: schema.relayLegs.courseVersionId,
    runners: schema.relayLegs.runners,
    changeoverRule: schema.relayLegs.changeoverRule,
    approvalRule: schema.relayLegs.approvalRule,
    startTime: schema.relayLegs.startTime,
    restartAfterMinutes: schema.relayLegs.restartAfterMinutes,
    classCourseVersionId: schema.classes.courseVersionId,
    restartRanking: schema.classes.relayRestartRanking,
    forking: schema.classes.relayForking,
    changeoverCode: schema.classes.relayChangeoverCode,
    readoutMode: schema.classes.relayReadoutMode
  }).from(schema.relayLegs)
    .innerJoin(schema.classes, and(eq(schema.classes.id, schema.relayLegs.classId), eq(schema.classes.raceId, schema.relayLegs.raceId)))
    .where(eq(schema.relayLegs.raceId, raceId))
    .orderBy(asc(schema.relayLegs.classId), asc(schema.relayLegs.leg));
  if (rows.length === 0) return new Map();
  const result = new Map<string, RelayClassConfig>();
  const legsByClass = new Map<string, RelayLegConfig[]>();
  for (const row of rows) {
    let legs = legsByClass.get(row.classId);
    if (!legs) {
      legs = [];
      legsByClass.set(row.classId, legs);
      result.set(row.classId, {
        classId: row.classId,
        legs,
        restartRanking: row.restartRanking ?? "AFTER_NORMAL",
        forking: row.forking ?? "EVEN",
        classCourseVersionId: row.classCourseVersionId,
        changeoverCode: row.changeoverCode,
        readoutMode: row.readoutMode
      });
    }
    legs.push({ leg: row.leg, startMethod: row.startMethod as RelayStartMethod, variantCode: row.courseVariantCode,
      courseVersionId: row.courseVersionId, runners: row.runners, changeoverRule: row.changeoverRule, approvalRule: row.approvalRule,
      ...(row.startTime ? { startTime: row.startTime.toISOString() } : {}),
      ...(row.restartAfterMinutes !== null ? { restartAfterMinutes: row.restartAfterMinutes } : {}) });
  }
  return result;
}

/** Banversionen som sträckan springer. */
export function relayLegCourseVersionId(config: RelayClassConfig, leg: number): string {
  return config.legs.find(row => row.leg === leg)?.courseVersionId ?? config.classCourseVersionId;
}

export async function loadRelayTeams(tx: Executor, raceId: string, teamIds?: readonly string[]) {
  if (teamIds && teamIds.length === 0) return [];
  return tx.select({ id: schema.teams.id, classId: schema.teams.classId, number: schema.teams.number, name: schema.teams.name,
    organisationName: schema.teams.organisationName }).from(schema.teams)
    .where(and(eq(schema.teams.raceId, raceId), isNull(schema.teams.struckAt), ...(teamIds ? [inUuids(schema.teams.id, teamIds)] : [])))
    .orderBy(asc(schema.teams.number));
}
export type RelayTeamRow = Awaited<ReturnType<typeof loadRelayTeams>>[number];

/** Sträcklöparna (deltagare med lag) i sträckordning per lag. */
export async function loadRelayLegEntries(tx: Executor, raceId: string, teamIds?: readonly string[]) {
  if (teamIds && teamIds.length === 0) return [];
  const rows = await tx.select({ id: schema.entries.id, classId: schema.entries.classId, teamId: schema.entries.teamId,
    leg: schema.entries.relayLeg, givenName: schema.entries.givenName, familyName: schema.entries.familyName,
    organisationName: schema.entries.organisationName, fixedStartTime: schema.entries.fixedStartTime, version: schema.entries.version,
    courseVariantCode: schema.entries.courseVariantCode, publicResultId: schema.entries.publicResultId,
    legOrder: schema.entries.relayLegOrder, cardEntryId: schema.entries.relayCardEntryId }).from(schema.entries)
    .where(and(eq(schema.entries.raceId, raceId), isNotNull(schema.entries.teamId), isNull(schema.entries.struckAt),
      ...(teamIds ? [inUuids(schema.entries.teamId, teamIds)] : [])))
    .orderBy(asc(schema.entries.teamId), asc(schema.entries.relayLeg), asc(sql`coalesce(${schema.entries.relayLegOrder}, 1)`));
  return rows.map(row => ({ ...row, teamId: row.teamId!, leg: row.leg!, legOrder: row.legOrder ?? 1 }));
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
  const rows = await tx.select({
    entryId: schema.resultRevisions.entryId,
    evaluatedFinish: sql<string | null>`case when jsonb_typeof(${schema.resultRevisions.evaluation} -> 'finishTime') = 'string' then ${schema.resultRevisions.evaluation} ->> 'finishTime' else null end`,
    readoutFinish: schema.cardReadouts.finishPunchedAt
  })
    .from(schema.resultRevisions).leftJoin(schema.cardReadouts, eq(schema.cardReadouts.id, schema.resultRevisions.readoutId))
    .where(and(eq(schema.resultRevisions.raceId, raceId), inUuids(schema.resultRevisions.entryId, entryIds)))
    .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision));
  const finishes = new Map<string, string>();
  for (const row of rows) {
    if (finishes.has(row.entryId)) continue;
    const finish = row.evaluatedFinish ?? row.readoutFinish?.toISOString();
    if (finish) finishes.set(row.entryId, new Date(finish).toISOString());
  }
  return finishes;
}

export interface RelayLegResult {
  readonly status: StoredResultStatus;
  /** Bedömningens orsak (steg 50: `MISSING_START` = sträckan väntar på föregående sträckas växling). */
  readonly reason?: string;
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
      inUuids(schema.resultRevisions.entryId, entryIds)))
    .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id));
  const results = new Map<string, RelayLegResult>();
  for (const state of await resolveStoredResultHeadStates(tx, raceId, heads)) {
    if (state.state !== "ACTIVE_RESULT") continue;
    const outcome = parseAdministratorStoredResultHead(state);
    results.set(state.head.entryId, { status: outcome.status as StoredResultStatus, courseVersionId: state.head.courseVersionId,
      ...("reason" in outcome && typeof outcome.reason === "string" ? { reason: outcome.reason } : {}),
      ...("elapsedMs" in outcome && outcome.elapsedMs !== undefined ? { elapsedMs: outcome.elapsedMs } : {}),
      ...("startTime" in outcome && outcome.startTime !== undefined ? { startTime: outcome.startTime } : {}),
      ...("finishTime" in outcome && outcome.finishTime !== undefined ? { finishTime: outcome.finishTime } : {}) });
  }
  return results;
}
