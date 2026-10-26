import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { schema } from "@o-tid/database";
import {
  entryCourseControls, evaluateReadoutForEntry, RESULT_ENGINE_VERSION, teamSprintEachLegLayout, teamSprintRoute,
  type EvaluationResult, type NormalizedCardReadout, type RaceSnapshot, type TeamSprintEachLegPart, type TeamSprintRoute
} from "@o-tid/domain";
import { appendResultRevision } from "./result-revisions";
import { loadRaceSnapshot, type DbExecutor } from "./snapshot";
import { assessReadOutEntries, recalculateAssessedEntries } from "./result-reassessment";
import type { Transaction } from "./relay-admin";

/**
 * Steg 50 (ADR-0174 beslut 9): teamsprint med utläsning efter varje sträcka. En löpare med flera sträckor har brickan på
 * sin första sträcka; de övriga sträckorna pekar på den (`entry.relay_card_entry_id`). Vilken utläsning varje sträcka bygger
 * på står i sträckans resultatrevision (`readout_id`), så ögonblicksbildens delning räknas fram ur dem.
 */
export interface TeamSprintRunnerPart {
  readonly entryId: string;
  readonly leg: number;
  /** Sträckan har ett resultat (utläsning eller beslut). */
  readonly done: boolean;
  readonly readout?: { readonly id: string; readonly finishPunchedAt?: string };
}

export interface TeamSprintRunner {
  readonly ownerEntryId: string;
  readonly classId: string;
  readonly teamId: string;
  readonly changeoverCode: number | null;
  readonly parts: readonly TeamSprintRunnerPart[];
}

/** Löparna med flera sträckor i klasser med utläsning efter varje sträcka (bara brickans ägare om `ownerEntryId`). */
export async function loadTeamSprintRunners(db: DbExecutor, raceId: string, ownerEntryId?: string,
  /** Steg 54: bara löpare vars alla sträckor finns här (en avgränsad ögonblicksbild med hela lag). */
  onlyEntryIds?: ReadonlySet<string>): Promise<TeamSprintRunner[]> {
  const rows = await db.select({ id: schema.entries.id, teamId: schema.entries.teamId, leg: schema.entries.relayLeg,
    cardEntryId: schema.entries.relayCardEntryId, classId: schema.entries.classId, code: schema.classes.relayChangeoverCode })
    .from(schema.entries).innerJoin(schema.classes, eq(schema.classes.id, schema.entries.classId))
    .where(and(eq(schema.entries.raceId, raceId), eq(schema.classes.relayReadoutMode, "EACH_LEG"), isNotNull(schema.entries.teamId),
      isNull(schema.entries.struckAt)));
  const byRunner = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.cardEntryId ?? row.id;
    if (ownerEntryId !== undefined && key !== ownerEntryId) continue;
    if (onlyEntryIds !== undefined && !onlyEntryIds.has(row.id)) continue;
    byRunner.set(key, [...byRunner.get(key) ?? [], row]);
  }
  const groups = [...byRunner].filter(([, legs]) => legs.length > 1);
  if (groups.length === 0) return [];
  const ids = groups.flatMap(([, legs]) => legs.map((leg) => leg.id));
  const withResult = new Set((await db.selectDistinct({ entryId: schema.resultRevisions.entryId }).from(schema.resultRevisions)
    .where(and(eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.entryId, ids)))).map((row) => row.entryId));
  const readouts = new Map((await db.selectDistinctOn([schema.resultRevisions.entryId], { entryId: schema.resultRevisions.entryId,
    id: schema.cardReadouts.id, finish: schema.cardReadouts.finishPunchedAt }).from(schema.resultRevisions)
    .innerJoin(schema.cardReadouts, eq(schema.cardReadouts.id, schema.resultRevisions.readoutId))
    .where(and(eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.entryId, ids), isNotNull(schema.resultRevisions.readoutId)))
    .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision))).map((row) => [row.entryId,
    { id: row.id, ...(row.finish ? { finishPunchedAt: row.finish.toISOString() } : {}) }]));
  return groups.map(([owner, legs]) => {
    const sorted = [...legs].sort((left, right) => (left.leg ?? 0) - (right.leg ?? 0));
    return { ownerEntryId: owner, classId: sorted[0]!.classId, teamId: sorted[0]!.teamId!, changeoverCode: sorted[0]!.code,
      parts: sorted.map((row) => ({ entryId: row.id, leg: row.leg ?? 0, done: withResult.has(row.id),
        ...(readouts.has(row.id) ? { readout: readouts.get(row.id)! } : {}) })) };
  });
}

/** Sträckornas delning för löparen, med `links` (nya kopplingar sträcka → utläsning) ovanpå de sparade. */
export function teamSprintRunnerLayout(runner: TeamSprintRunner,
  links: ReadonlyMap<string, { readonly id: string; readonly finishPunchedAt?: string }> = new Map()): Map<string, TeamSprintEachLegPart> {
  return teamSprintEachLegLayout(runner.parts.map((part) => {
    const readout = links.get(part.entryId) ?? part.readout;
    return { entryId: part.entryId, ...(readout ? { readout } : {}) };
  }), runner.changeoverCode ?? undefined);
}

/** Ögonblicksbilden med löparens sträckor delade enligt `layout`. */
export function withTeamSprintLayout(snapshot: RaceSnapshot, layout: ReadonlyMap<string, TeamSprintEachLegPart>): RaceSnapshot {
  return { ...snapshot, entries: snapshot.entries.map((entry) => layout.has(entry.id) ? { ...entry, teamSprint: layout.get(entry.id)! } : entry) };
}

/** Vilka av löparens sträckor en ny utläsning gäller (domänens regel med sträckornas banor ur ögonblicksbilden). */
export function routeTeamSprintReadout(runner: TeamSprintRunner, snapshot: RaceSnapshot, readout: NormalizedCardReadout): TeamSprintRoute {
  return teamSprintRoute(runner.parts.map((part) => ({ ...part, controlCodes: entryCourseControls(snapshot, part.entryId)?.controlCodes ?? [] })),
    readout, runner.changeoverCode ?? undefined);
}

/** Kopplingarna sträcka → utläsning som en fördelning ger: alla täckta sträckor, utom de som saknar mål (glömd utläsning). */
export function routeLinks(runner: TeamSprintRunner, route: TeamSprintRoute): string[] {
  if (route.kind === "REREAD") return route.parts.map((part) => runner.parts[part - 1]!.entryId);
  if (route.kind !== "LEGS") return [];
  const missing = new Set(route.missing);
  return runner.parts.slice(route.from - 1, route.to).flatMap((part, index) => missing.has(route.from + index) ? [] : [part.entryId]);
}

export type TeamSprintStoreResult =
  | { readonly kind: "stored"; readonly route: TeamSprintRoute; readonly evaluation: EvaluationResult;
      readonly revisions: readonly { readonly id: string; readonly entryId: string; readonly revision: number; readonly courseVersionId: string }[];
      /** Löparens sträckor med utläsning som inte fick den här (deras delning kan ha ändrats). */
      readonly otherReadOut: readonly string[] }
  | { readonly kind: "refused"; readonly route: TeamSprintRoute };

/**
 * Fördelar en utläsning av löparens bricka på sträckorna och sparar en revision per kopplad sträcka (bedömd med den nya
 * delningen). En dubblett blir en omläsning av samma sträckor. En utläsning som inte går att lägga (måltid före föregående
 * sträckas, eller alla sträckor redan utlästa) sparas inte som resultat.
 */
export async function storeTeamSprintReadout(tx: DbExecutor, input: { readonly runner: TeamSprintRunner; readonly snapshot: RaceSnapshot;
  readonly readout: NormalizedCardReadout; readonly cause: "CARD_READOUT" | "UNKNOWN_READOUT_RESOLUTION" | "READOUT_REREAD";
  readonly snapshotVersion: number; readonly actorAccountId?: string; readonly createdAt?: Date; readonly route?: TeamSprintRoute }): Promise<TeamSprintStoreResult> {
  const { runner, readout } = input;
  const route = input.route ?? routeTeamSprintReadout(runner, input.snapshot, readout);
  const linked = routeLinks(runner, route);
  if (linked.length === 0) return { kind: "refused", route };
  const link = { id: readout.id, ...(readout.finishPunchedAt ? { finishPunchedAt: readout.finishPunchedAt } : {}) };
  const layout = teamSprintRunnerLayout(runner, new Map(linked.map((entryId) => [entryId, link])));
  const snapshot = withTeamSprintLayout(input.snapshot, layout);
  const revisions: { id: string; entryId: string; revision: number; courseVersionId: string }[] = [];
  let evaluation: EvaluationResult | undefined;
  for (const entryId of linked) {
    const outcome = evaluateReadoutForEntry(readout, snapshot, entryId);
    if (outcome.entryId !== entryId || !outcome.courseVersionId) throw new Error("Teamsprintens sträcka kunde inte bedömas");
    const created = await appendResultRevision(tx, { raceId: snapshot.race.id, entryId, readoutId: readout.id, cause: input.cause, outcome,
      engineVersion: RESULT_ENGINE_VERSION, snapshotVersion: input.snapshotVersion, courseVersionId: outcome.courseVersionId,
      ...(input.actorAccountId ? { actorAccountId: input.actorAccountId } : {}), ...(input.createdAt ? { createdAt: input.createdAt } : {}) });
    revisions.push({ id: created.id, entryId, revision: created.revision, courseVersionId: outcome.courseVersionId });
    evaluation = outcome;
  }
  const otherReadOut = runner.parts.filter((part) => part.readout && !linked.includes(part.entryId)).map((part) => part.entryId);
  return { kind: "stored", route, evaluation: evaluation!, revisions, otherReadOut };
}

/**
 * `storeTeamSprintReadout` och omräkning av löparens andra utlästa sträckor vars delning ändrades av den nya kopplingen (t.ex.
 * när första utläsningen kommer efter den andra: sträcka 3 bedöms då bara mot stämplingarna efter första utläsningens mål).
 */
export async function storeTeamSprintReadoutAndRecalculate(tx: Transaction, input: Parameters<typeof storeTeamSprintReadout>[1]):
  Promise<TeamSprintStoreResult> {
  const result = await storeTeamSprintReadout(tx, input);
  if (result.kind !== "stored" || result.otherReadOut.length === 0) return result;
  const after = await loadRaceSnapshot(tx, input.snapshot.race.id);
  const raceClass = after.classes.find((row) => row.id === input.runner.classId);
  if (!raceClass) return result;
  const assessed = await assessReadOutEntries(tx, after.race.id, [{ id: raceClass.id, name: raceClass.name }], input.snapshot, after,
    result.otherReadOut);
  if (assessed === "too-large") throw new Error("Teamsprintens löpare kunde inte räknas om");
  await recalculateAssessedEntries(tx, { raceId: after.race.id, assessed: assessed.filter((row) => row.changed), snapshot: after,
    snapshotVersion: input.snapshotVersion, courseVersionId: new Map([[raceClass.id, raceClass.courseVersionId]]) });
  return result;
}
