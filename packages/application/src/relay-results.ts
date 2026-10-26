import { and, asc, eq, inArray, max } from "drizzle-orm";
import { publicRelayResultsSchema, relayOverviewSchema, relayReadoutSchema, type PublicRelayResults, type RelayOverview,
  type RelayReadout } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { rankRelayLegs, rankRelayTeams, relayClassLegStarts, relayParallelLegOutcome, relayTeamResult, type RelayLegRestart, type RelayTeamResult,
  type UnfairRelayTeam } from "@o-tid/domain";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { lockRaceForSnapshot } from "./concurrency";
import { loadCourseVersionVariants } from "./course-variants";
import {
  loadRelayClassConfigs, loadRelayLegEntries, loadRelayLegFinishTimes, loadRelayLegResults, loadRelayTeams, relayLegCourseVersionId,
  type RelayClassConfig, type RelayLegEntry, type RelayLegResult, type RelayTeamRow
} from "./relay-model";
import { relayChangeovers } from "./relay-sync";
import { loadRelayLegCourses, relayClassFairness } from "./relay-variants";

/**
 * Stafettens resultat (ADR-0169 beslut 3): lagvyn i arbetsytan, publika lagresultat med
 * sträckresultat och stafettdelen i avläsningspaketet. Lagresultat, placering och sträckornas
 * placering räknas i domänen (relay.ts) ur sträckornas gällande resultat.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface RelayTeamView {
  readonly team: RelayTeamRow;
  readonly legs: readonly { readonly entry: RelayLegEntry; readonly result?: RelayLegResult; readonly restarted: boolean;
    readonly finishTime?: string; readonly changedOver: boolean }[];
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
  /** Steg 47: sträckans bana (id, namn) när den är en annan än klassens, omstarterna och lagen som inte springer samma sträckor. */
  readonly legCourses: ReadonlyMap<number, { courseId: string; courseName: string; courseVersionId: string }>;
  readonly restarts: ReadonlyMap<number, RelayLegRestart>;
  readonly unfairTeams: readonly UnfairRelayTeam[];
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
  const legVersionIds = [...new Set([...configs.values()].flatMap(config => config.legs.flatMap(leg => leg.courseVersionId ? [leg.courseVersionId] : [])))];
  const legCourseRows = legVersionIds.length === 0 ? [] : await tx.select({ versionId: schema.courseVersions.id, courseId: schema.courses.id,
    courseName: schema.courses.name }).from(schema.courseVersions).innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
    .where(inArray(schema.courseVersions.id, legVersionIds));
  const courseOfVersion = new Map(legCourseRows.map(row => [row.versionId, row]));
  const allVersions = [...new Set([...classRows.map(row => row.courseVersionId), ...legVersionIds])];
  const controlRows = await tx.select({ versionId: schema.courseControls.courseVersionId, code: schema.controls.code })
    .from(schema.courseControls).innerJoin(schema.controls, eq(schema.controls.id, schema.courseControls.controlId))
    .where(inArray(schema.courseControls.courseVersionId, allVersions)).orderBy(asc(schema.courseControls.courseVersionId),
      asc(schema.courseControls.sequence));
  const courseControls = new Map<string, number[]>();
  for (const row of controlRows) courseControls.set(row.versionId, [...courseControls.get(row.versionId) ?? [], row.code]);
  const [teams, entries] = await Promise.all([loadRelayTeams(tx, raceId), loadRelayLegEntries(tx, raceId)]);
  const entryIds = entries.map(entry => entry.id);
  const [results, finishes] = await Promise.all([loadRelayLegResults(tx, raceId, entryIds), loadRelayLegFinishTimes(tx, raceId, entryIds)]);
  const classes: RelayClassView[] = [];
  for (const row of classRows) {
    const config = configs.get(row.id)!;
    const classTeams = teams.filter(team => team.classId === row.id);
    const legsOf = new Map(classTeams.map(team => [team.id, entries.filter(entry => entry.teamId === team.id)]));
    const statuses = new Map([...results].map(([id, result]) => [id, result.status]));
    const changeoversOf = new Map(classTeams.map(team => [team.id, relayChangeovers(legsOf.get(team.id)!, finishes, config, statuses)]));
    const starts = relayClassLegStarts(config.legs, classTeams.map(team => ({ key: team.id, changeovers: changeoversOf.get(team.id)! })));
    const views = classTeams.map(team => {
      const changeovers = changeoversOf.get(team.id)!;
      const legs = legsOf.get(team.id)!.map(entry => {
        const result = results.get(entry.id);
        const finishTime = finishes.get(entry.id);
        return { entry, ...(result ? { result } : {}), ...(finishTime ? { finishTime } : {}),
          restarted: starts.teams.get(team.id)?.get(entry.leg)?.restarted ?? false, changedOver: false };
      }).map((leg, _index, all) => {
        // Steg 48: vid flera löpare på sträckan den (första i ordning) vars mål är lagets växling.
        const sameLeg = all.filter(other => other.entry.leg === leg.entry.leg);
        if (sameLeg.length < 2) return leg;
        const changer = sameLeg.find(other => other.finishTime !== undefined && other.finishTime === changeovers.get(leg.entry.leg));
        return { ...leg, changedOver: changer?.entry.id === leg.entry.id };
      });
      const outcomes = config.legs.map(rule => {
        const runners = legs.filter(leg => leg.entry.leg === rule.leg);
        if (runners.length <= 1) {
          const leg = runners[0];
          return { leg: rule.leg, restarted: leg?.restarted ?? false, ...(leg?.result ? { status: leg.result.status,
            ...(leg.result.elapsedMs === undefined ? {} : { elapsedMs: leg.result.elapsedMs }) } : {}) };
        }
        const legStart = starts.teams.get(team.id)?.get(rule.leg)?.start;
        return relayParallelLegOutcome({ leg: rule.leg, changeover: rule.changeoverRule, approval: rule.approvalRule,
          ...(legStart ? { legStart } : {}), restarted: runners[0]!.restarted, runners: runners.map(runner => ({
            ...(runner.result ? { status: runner.result.status } : {}), ...(runner.finishTime ? { finishTime: runner.finishTime } : {}) })) });
      });
      return { team, legs, result: relayTeamResult(config.legs.length, outcomes) };
    });
    const ranking = rankRelayTeams(views.map(view => ({ key: view.team.id, result: view.result })), { restartRanking: config.restartRanking });
    const byId = new Map(views.map(view => [view.team.id, view]));
    const legRankings = new Map(rankRelayLegs(views.flatMap(view => view.legs.flatMap(leg => leg.result ? [{ key: leg.entry.id,
      leg: leg.entry.leg, status: leg.result.status, courseVersionId: leg.result.courseVersionId,
      ...(leg.result.elapsedMs === undefined ? {} : { elapsedMs: leg.result.elapsedMs }) }] : []))).map(ranking =>
      [ranking.key, { ...(ranking.position === undefined ? {} : { position: ranking.position, timeBehindMs: ranking.timeBehindMs }) }]));
    const legCourses = new Map(config.legs.flatMap(leg => {
      const course = leg.courseVersionId ? courseOfVersion.get(leg.courseVersionId) : undefined;
      return course ? [[leg.leg, { courseId: course.courseId, courseName: course.courseName, courseVersionId: leg.courseVersionId! }] as const] : [];
    }));
    const legCourseVariants = await loadRelayLegCourses(tx, config);
    const unfairTeams = relayClassFairness(legCourseVariants, views.map(view => ({ key: view.team.id,
      variants: new Map(view.legs.map(leg => [leg.entry.leg, leg.entry.courseVariantCode])) })),
      new Map(config.legs.map(leg => [relayLegCourseVersionId(config, leg.leg), courseControls.get(relayLegCourseVersionId(config, leg.leg)) ?? []])));
    classes.push({ classId: row.id, name: row.name, courseId: row.courseId, courseName: row.courseName, courseVersionId: row.courseVersionId,
      config, legRankings, legCourses, restarts: starts.restarts, unfairTeams, teams: ranking.map(rank => ({ ...byId.get(rank.key)!,
        ...(rank.position === undefined ? {} : { position: rank.position, timeBehindMs: rank.timeBehindMs }) })) });
  }
  return { classes, finishes };
}

type Authentication = Omit<RaceSessionProof, "csrfCookie" | "csrfHeader">;

export type RelayOverviewResult = { status: "unauthorized" | "forbidden" | "invalid-request" } | { status: "ok"; response: RelayOverview };

/** Lagvyn i arbetsytan: klasser med sträckor, lag i nummerordning med sträcklöpare, bricka och status. */
/** Lagöversikten läses också av funktionären i kontrollvyn och hos speakern (ADR-0172 beslut 3). */
export async function getRelayOverviewAsAdmin(db: Database, input: Authentication, now = new Date()): Promise<RelayOverviewResult> {
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "FUNCTIONARY" }, now, "share");
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
    const variants = await loadCourseVersionVariants(tx, [...new Set([...classes.map(row => row.courseVersionId),
      ...classes.flatMap(row => [...row.legCourses.values()].map(course => course.courseVersionId))])]);
    const entryIds = classes.flatMap(row => row.teams.flatMap(view => view.legs.map(leg => leg.entry.id)));
    const revisions = new Map((entryIds.length === 0 ? [] : await tx.select({ entryId: schema.resultRevisions.entryId,
      revision: max(schema.resultRevisions.revision) }).from(schema.resultRevisions)
      .where(and(eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.entryId, entryIds)))
      .groupBy(schema.resultRevisions.entryId)).map(row => [row.entryId, row.revision ?? 0]));
    const numberOf = new Map(classes.flatMap(row => row.teams.map(view => [view.team.id, view.team.number] as const)));
    return { status: "ok", response: relayOverviewSchema.parse({ formatVersion: 1, raceId, snapshotVersion: race.snapshotVersion,
      timeZone: event.timeZone,
      classes: classes.map(row => ({ id: row.classId, name: row.name, courseId: row.courseId, courseName: row.courseName,
        courseVariants: (variants.get(row.courseVersionId) ?? []).map(variant => variant.code),
        legs: row.config.legs.map(leg => ({ leg: leg.leg, startMethod: leg.startMethod, startTime: leg.startTime ?? null,
          variantCode: leg.variantCode, courseId: row.legCourses.get(leg.leg)?.courseId ?? null,
          restartAfterMinutes: leg.restartAfterMinutes ?? null, runners: leg.runners, changeoverRule: leg.changeoverRule,
          approvalRule: leg.approvalRule })), teamCount: row.teams.length, changeoverCode: row.config.changeoverCode,
        restartRanking: row.config.restartRanking, forking: row.config.forking,
        legCourses: row.config.legs.map(leg => {
          const own = row.legCourses.get(leg.leg);
          const version = own?.courseVersionId ?? row.courseVersionId;
          return { leg: leg.leg, courseId: own?.courseId ?? row.courseId, courseName: own?.courseName ?? row.courseName,
            variants: (variants.get(version) ?? []).map(variant => variant.code) };
        }),
        restarts: [...row.restarts.values()].map(restart => ({ leg: restart.leg, time: restart.time ?? null,
          leaderChangeover: restart.leaderChangeover ?? null, leaderTeamNumber: restart.leaderKey ? numberOf.get(restart.leaderKey) ?? null : null,
          restartAfterMinutes: restart.restartAfterMinutes ?? null })),
        unfairTeams: row.unfairTeams.map(team => ({ teamId: team.key, missing: team.missing, extra: team.extra })) })),
      teams: classes.flatMap(row => [...row.teams].sort((left, right) => left.team.number - right.team.number).map(view => ({
        id: view.team.id, classId: row.classId, number: view.team.number, name: view.team.name,
        organisationName: view.team.organisationName, status: view.result.status, elapsedMs: view.result.elapsedMs ?? null,
        position: view.position ?? null, currentLeg: view.result.currentLeg ?? null, restarted: view.result.restarted,
        hasResult: view.legs.some(leg => (revisions.get(leg.entry.id) ?? 0) > 0),
        legs: view.legs.map(leg => ({ leg: leg.entry.leg, entryId: leg.entry.id, entryVersion: leg.entry.version,
          givenName: leg.entry.givenName, familyName: leg.entry.familyName, organisationName: leg.entry.organisationName,
          cardNumber: cardByEntry.get(leg.entry.id) ?? null, variantCode: leg.entry.courseVariantCode,
          startTime: leg.entry.fixedStartTime?.toISOString() ?? null, status: leg.result?.status ?? null,
          elapsedMs: leg.result?.elapsedMs ?? null, restarted: leg.restarted, finishTime: leg.finishTime ?? null,
          hasResult: (revisions.get(leg.entry.id) ?? 0) > 0, resultRevision: revisions.get(leg.entry.id) ?? 0,
          legOrder: leg.entry.legOrder, changedOver: leg.changedOver,
          sameAsLeg: leg.entry.cardEntryId ? view.legs.find(other => other.entry.id === leg.entry.cardEntryId)?.entry.leg ?? null : null,
          // Steg 48: teamsprint – sträckan har ett resultat men inget mål: växlingsstämplingen saknas på brickan.
          changeoverMissing: row.config.changeoverCode !== null && leg.result !== undefined && leg.finishTime === undefined }))
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
          restarted: leg.restarted, variantCode: leg.entry.courseVariantCode,
          courseName: row.legCourses.get(leg.entry.leg)?.courseName ?? null, legOrder: leg.entry.legOrder,
          changedOver: leg.changedOver })), restarted: view.result.restarted })),
      legs: row.config.legs.map(rule => ({ leg: rule.leg, results: row.teams.flatMap(view => view.legs
        .filter(leg => leg.entry.leg === rule.leg && leg.result).map(leg => ({ ranking: row.legRankings.get(leg.entry.id) ?? {},
          givenName: leg.entry.givenName, familyName: leg.entry.familyName, teamNumber: view.team.number, teamName: view.team.name,
          status: leg.result!.status, elapsedMs: leg.result!.elapsedMs ?? null, variantCode: leg.entry.courseVariantCode,
          restarted: leg.restarted })))
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
      startTime: leg.startTime ?? null, restartAfterMinutes: leg.restartAfterMinutes ?? null, changeoverRule: leg.changeoverRule })) })),
    teams: classes.flatMap(row => row.teams.map(view => ({ id: view.team.id, classId: row.classId, number: view.team.number,
      name: view.team.name, legs: view.legs.map(leg => ({ leg: leg.entry.leg, entryId: leg.entry.id, legOrder: leg.entry.legOrder,
        sameAsLeg: leg.entry.cardEntryId ? view.legs.find(other => other.entry.id === leg.entry.cardEntryId)?.entry.leg ?? null : null })) }))),
    legResults: classes.flatMap(row => row.teams.flatMap(view => view.legs.flatMap(leg => leg.result ? [{ entryId: leg.entry.id,
      status: leg.result.status, finishTime: finishes.get(leg.entry.id) ?? null, elapsedMs: leg.result.elapsedMs ?? null }] : [])))
  });
}
