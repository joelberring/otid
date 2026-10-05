import { and, asc, eq, inArray } from "drizzle-orm";
import { publicRelayResultsSchema, relayOverviewSchema, relayReadoutSchema, type PublicRelayResults, type RelayOverview,
  type RelayReadout } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { rankRelayLegs, rankRelayTeams, relayLegRestarted, relayTeamResult, type RelayTeamResult } from "@o-tid/domain";
import { authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { lockRaceForSnapshot } from "./concurrency";
import { loadCourseVersionVariants } from "./course-variants";
import {
  loadRelayClassConfigs, loadRelayLegEntries, loadRelayLegFinishTimes, loadRelayLegResults, loadRelayTeams,
  type RelayClassConfig, type RelayLegEntry, type RelayLegResult, type RelayTeamRow
} from "./relay-model";

/**
 * Stafettens resultat (ADR-0169 beslut 3): lagvyn i arbetsytan, publika lagresultat med
 * sträckresultat och stafettdelen i avläsningspaketet. Lagresultat, placering och sträckornas
 * placering räknas i domänen (relay.ts) ur sträckornas gällande resultat.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface RelayTeamView {
  readonly team: RelayTeamRow;
  readonly legs: readonly { readonly entry: RelayLegEntry; readonly result?: RelayLegResult; readonly restarted: boolean }[];
  readonly result: RelayTeamResult;
  readonly position?: number;
  readonly timeBehindMs?: number;
}

export interface RelayClassView {
  readonly classId: string;
  readonly name: string;
  readonly courseId: string;
  readonly courseName: string;
  readonly courseVersionId: string;
  readonly config: RelayClassConfig;
  /** Lagen i resultatordning: placerade, ute, underkända. */
  readonly teams: readonly RelayTeamView[];
  readonly legRankings: ReadonlyMap<string, { position?: number; timeBehindMs?: number }>;
}

/** Stafettklasserna med lag, sträckor, resultat och placeringar. Tom lista när loppet saknar stafett. */
export async function loadRelayView(tx: Transaction, raceId: string) {
  const configs = await loadRelayClassConfigs(tx, raceId);
  if (configs.size === 0) return { classes: [] as RelayClassView[], finishes: new Map<string, string>() };
  const classRows = await tx.select({ id: schema.classes.id, name: schema.classes.name, courseVersionId: schema.classes.courseVersionId,
    courseId: schema.courses.id, courseName: schema.courses.name }).from(schema.classes)
    .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
    .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
    .where(and(eq(schema.classes.raceId, raceId), inArray(schema.classes.id, [...configs.keys()])))
    .orderBy(asc(schema.classes.name), asc(schema.classes.id));
  const [teams, entries] = await Promise.all([loadRelayTeams(tx, raceId), loadRelayLegEntries(tx, raceId)]);
  const entryIds = entries.map(entry => entry.id);
  const [results, finishes] = await Promise.all([loadRelayLegResults(tx, raceId, entryIds), loadRelayLegFinishTimes(tx, raceId, entryIds)]);
  const classes = classRows.map((row): RelayClassView => {
    const config = configs.get(row.id)!;
    const views = teams.filter(team => team.classId === row.id).map(team => {
      const legs = entries.filter(entry => entry.teamId === team.id).map(entry => {
        const result = results.get(entry.id);
        const rule = config.legs.find(leg => leg.leg === entry.leg)!;
        const previous = entries.find(candidate => candidate.teamId === team.id && candidate.leg === entry.leg - 1);
        return { entry, ...(result ? { result } : {}),
          restarted: result !== undefined && relayLegRestarted(rule, previous ? finishes.get(previous.id) : undefined) };
      });
      return { team, legs, result: relayTeamResult(config.legs.length, legs.map(leg => ({ leg: leg.entry.leg,
        ...(leg.result ? { status: leg.result.status, ...(leg.result.elapsedMs === undefined ? {} : { elapsedMs: leg.result.elapsedMs }) } : {}) }))) };
    });
    const ranking = rankRelayTeams(views.map(view => ({ key: view.team.id, result: view.result })));
    const byId = new Map(views.map(view => [view.team.id, view]));
    const legRankings = new Map(rankRelayLegs(views.flatMap(view => view.legs.flatMap(leg => leg.result ? [{ key: leg.entry.id,
      leg: leg.entry.leg, status: leg.result.status, courseVersionId: leg.result.courseVersionId,
      ...(leg.result.elapsedMs === undefined ? {} : { elapsedMs: leg.result.elapsedMs }) }] : []))).map(ranking =>
      [ranking.key, { ...(ranking.position === undefined ? {} : { position: ranking.position, timeBehindMs: ranking.timeBehindMs }) }]));
    return { classId: row.id, name: row.name, courseId: row.courseId, courseName: row.courseName, courseVersionId: row.courseVersionId,
      config, legRankings, teams: ranking.map(rank => ({ ...byId.get(rank.key)!,
        ...(rank.position === undefined ? {} : { position: rank.position, timeBehindMs: rank.timeBehindMs }) })) };
  });
  return { classes, finishes };
}

type Authentication = Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf" | "csrfCookie" | "csrfHeader">;

export type RelayOverviewResult = { status: "unauthorized" | "forbidden" | "invalid-request" } | { status: "ok"; response: RelayOverview };

/** Lagvyn i arbetsytan: klasser med sträckor, lag i nummerordning med sträcklöpare, bricka och status. */
/** Lagöversikten läses också av funktionären i kontrollvyn och hos speakern (ADR-0172 beslut 3). */
export async function getRelayOverviewAsAdministrator(db: Database, input: Authentication, now = new Date()): Promise<RelayOverviewResult> {
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability: "RACE_FUNCTIONARY" }, now);
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const race = await lockRaceForSnapshot(tx, raceId);
    const [event] = await tx.select({ timeZone: schema.events.timeZone }).from(schema.races)
      .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(eq(schema.races.id, raceId));
    if (!event) throw new Error("Evenemanget finns inte");
    const { classes } = await loadRelayView(tx, raceId);
    const cards = classes.length === 0 ? [] : await tx.select({ entryId: schema.cardAssignments.entryId, cardNumber: schema.cardAssignments.cardNumber })
      .from(schema.cardAssignments).where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.active, true)));
    const cardByEntry = new Map(cards.map(row => [row.entryId, row.cardNumber]));
    const variants = await loadCourseVersionVariants(tx, classes.map(row => row.courseVersionId));
    return { status: "ok", response: relayOverviewSchema.parse({ formatVersion: 1, raceId, snapshotVersion: race.snapshotVersion,
      timeZone: event.timeZone,
      classes: classes.map(row => ({ id: row.classId, name: row.name, courseId: row.courseId, courseName: row.courseName,
        courseVariants: (variants.get(row.courseVersionId) ?? []).map(variant => variant.code),
        legs: row.config.legs.map(leg => ({ leg: leg.leg, startMethod: leg.startMethod, startTime: leg.startTime ?? null,
          variantCode: leg.variantCode })), teamCount: row.teams.length })),
      teams: classes.flatMap(row => [...row.teams].sort((left, right) => left.team.number - right.team.number).map(view => ({
        id: view.team.id, classId: row.classId, number: view.team.number, name: view.team.name,
        organisationName: view.team.organisationName, status: view.result.status, elapsedMs: view.result.elapsedMs ?? null,
        position: view.position ?? null, currentLeg: view.result.currentLeg ?? null,
        legs: view.legs.map(leg => ({ leg: leg.entry.leg, entryId: leg.entry.id, entryVersion: leg.entry.version,
          givenName: leg.entry.givenName, familyName: leg.entry.familyName, organisationName: leg.entry.organisationName,
          cardNumber: cardByEntry.get(leg.entry.id) ?? null, variantCode: leg.entry.courseVariantCode,
          startTime: leg.entry.fixedStartTime?.toISOString() ?? null, status: leg.result?.status ?? null,
          elapsedMs: leg.result?.elapsedMs ?? null, restarted: leg.restarted }))
      }))) }) };
  }, { isolationLevel: "repeatable read" });
}

/** Publika stafettresultat: lagresultat med utfällbara sträckor och sträckresultat per sträcka. */
export async function publicRelayResults(db: Database, raceId: string): Promise<PublicRelayResults> {
  return db.transaction(async tx => {
    await lockRaceForSnapshot(tx, raceId);
    const { classes } = await loadRelayView(tx, raceId);
    return publicRelayResultsSchema.parse({ formatVersion: 1, classes: classes.map(row => ({
      name: row.name, legCount: row.config.legs.length,
      teams: row.teams.map(view => ({ number: view.team.number, name: view.team.name, organisationName: view.team.organisationName,
        status: view.result.status, elapsedMs: view.result.elapsedMs ?? null, position: view.position ?? null,
        timeBehindMs: view.timeBehindMs ?? null, currentLeg: view.result.currentLeg ?? null,
        legs: view.legs.map(leg => ({ leg: leg.entry.leg, givenName: leg.entry.givenName, familyName: leg.entry.familyName,
          organisationName: leg.entry.organisationName, publicResultId: leg.entry.publicResultId, status: leg.result?.status ?? null,
          elapsedMs: leg.result?.elapsedMs ?? null, legPosition: row.legRankings.get(leg.entry.id)?.position ?? null,
          restarted: leg.restarted, variantCode: leg.entry.courseVariantCode })) })),
      legs: row.config.legs.map(rule => ({ leg: rule.leg, results: row.teams.flatMap(view => view.legs
        .filter(leg => leg.entry.leg === rule.leg && leg.result).map(leg => ({ ranking: row.legRankings.get(leg.entry.id) ?? {},
          givenName: leg.entry.givenName, familyName: leg.entry.familyName, teamNumber: view.team.number, teamName: view.team.name,
          status: leg.result!.status, elapsedMs: leg.result!.elapsedMs ?? null })))
        .sort((left, right) => (left.ranking.position ?? Number.MAX_SAFE_INTEGER) - (right.ranking.position ?? Number.MAX_SAFE_INTEGER) ||
          left.teamNumber - right.teamNumber)
        .map(({ ranking, ...result }) => ({ ...result, position: ranking.position ?? null, timeBehindMs: ranking.timeBehindMs ?? null })) }))
    })) });
  }, { isolationLevel: "repeatable read" });
}

/** Stafettdelen i avläsningspaketet, eller undefined när loppet saknar stafettklasser. */
export async function loadRelayReadout(tx: Transaction, raceId: string): Promise<RelayReadout | undefined> {
  const { classes, finishes } = await loadRelayView(tx, raceId);
  if (classes.length === 0) return undefined;
  return relayReadoutSchema.parse({
    classes: classes.map(row => ({ classId: row.classId, legs: row.config.legs.map(leg => ({ leg: leg.leg, startMethod: leg.startMethod,
      startTime: leg.startTime ?? null })) })),
    teams: classes.flatMap(row => row.teams.map(view => ({ id: view.team.id, classId: row.classId, number: view.team.number,
      name: view.team.name, legs: view.legs.map(leg => ({ leg: leg.entry.leg, entryId: leg.entry.id })) }))),
    legResults: classes.flatMap(row => row.teams.flatMap(view => view.legs.flatMap(leg => leg.result ? [{ entryId: leg.entry.id,
      status: leg.result.status, finishTime: finishes.get(leg.entry.id) ?? null, elapsedMs: leg.result.elapsedMs ?? null }] : [])))
  });
}
