import type { Database } from "@o-tid/database";
import type { IofResultListPersonResult, IofResultListTeamResult } from "@o-tid/iof-xml";
import { loadRelayView } from "./relay-results";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * IOF XML ResultList för stafett (ADR-0169 beslut 3): lagresultat (TeamResult) per stafettklass
 * med sträcklöparnas resultat (TeamMemberResult). Sträckans placering skrivs som type="Leg" och
 * lagets tid, placering och status som OverallResult på sista avlästa sträckan. Lag och placeringar
 * räknas i domänen; personresultaten är samma projektion som för individuella klasser.
 * Ger lagresultat per klass-id för stafettklasserna.
 */
export async function relayTeamResultsForExport(tx: Transaction, raceId: string,
  personResults: ReadonlyMap<string, IofResultListPersonResult>): Promise<Map<string, IofResultListTeamResult[]>> {
  const { classes } = await loadRelayView(tx, raceId);
  const byClass = new Map<string, IofResultListTeamResult[]>();
  for (const raceClass of classes) {
    byClass.set(raceClass.classId, raceClass.teams.map(view => ({
      name: view.team.name, bibNumber: view.team.number, legCount: raceClass.config.legs.length,
      ...(view.team.organisationName === null ? {} : { organisationName: view.team.organisationName }),
      status: view.result.status === "RUNNING" ? "Active" : view.result.status === "NT" ? "OOC" : view.result.status,
      ...(view.result.status === "OK" ? { elapsedMs: view.result.elapsedMs! } : {}),
      ...(view.position === undefined ? {} : { position: view.position, timeBehindMs: view.timeBehindMs! }),
      members: view.legs.flatMap(leg => {
        const result = personResults.get(leg.entry.id);
        if (!result) return [];
        const ranking = raceClass.legRankings.get(leg.entry.id);
        const ranked = result.status === "OK" && ranking?.position !== undefined
          ? { ...result, position: ranking.position, timeBehindMs: ranking.timeBehindMs! } : result;
        return [{ leg: leg.entry.leg, result: ranked }];
      })
    })));
  }
  return byClass;
}
