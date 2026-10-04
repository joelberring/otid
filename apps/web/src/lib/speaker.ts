import type { AdministratorForestWatchResponse, PublicResultListResponseV7, RelayOverview, SpeakerBoardResponse } from "@o-tid/contracts";
import { inForest } from "./section-status";

/**
 * Speakersidan (ADR-0170 beslut 2): senast i mål, ledare per klass, kvar i skogen per klass och stafettlag
 * per sträcka. Rena funktioner över de svar sidan redan läser; ingen egen resultatlogik.
 */

type PublicResult = PublicResultListResponseV7["results"][number];
export type RankedResult = Exclude<PublicResult, { status: "NT" }> & { rankingState: "RANKED"; position: number; elapsedMs: number };

const ranked = (row: PublicResult): row is RankedResult =>
  row.status === "OK" && row.rankingState === "RANKED" && row.position !== undefined && row.elapsedMs !== undefined;

/** De `limit` bästa i varje klass (delade placeringar följer med), klasserna i namnordning. */
export function classLeaders(response: PublicResultListResponseV7, limit = 3): { className: string; leaders: RankedResult[] }[] {
  const byClass = new Map<string, RankedResult[]>();
  for (const row of response.results) {
    if (!ranked(row) || row.position > limit) continue;
    byClass.set(row.className, [...(byClass.get(row.className) ?? []), row]);
  }
  return [...byClass.entries()].sort(([a], [b]) => a.localeCompare(b, "sv"))
    .map(([className, leaders]) => ({ className, leaders: leaders.sort((a, b) => a.position - b.position || a.elapsedMs - b.elapsedMs) }));
}

const personKey = (row: { givenName: string; familyName: string; className: string; organisationName: string | null }) =>
  [row.className, row.givenName, row.familyName, row.organisationName ?? ""].join("\u0000");

export type Finisher = SpeakerBoardResponse["rows"][number] & { position: number | undefined };

/**
 * Senast i mål: speakerunderlagets senaste resultat, nyaste först, med placeringen ur den publika listan
 * (samma klass, namn och klubb). Löpare utan publicerad placering får ingen.
 */
export function latestFinishers(board: SpeakerBoardResponse, results: PublicResultListResponseV7 | undefined, limit = 12): Finisher[] {
  const positions = new Map<string, number>();
  for (const row of results?.results ?? []) if (ranked(row)) positions.set(personKey(row), row.position);
  return [...board.rows].sort((a, b) => b.registeredAt.localeCompare(a.registeredAt)).slice(0, limit)
    .map(row => ({ ...row, position: row.state === "ACTIVE_RESULT" && row.result.status === "OK" ? positions.get(personKey(row)) : undefined }));
}

/** Kvar i skogen per klass, klasserna i namnordning och löparna i namnordning. */
export function forestByClass(forest: AdministratorForestWatchResponse): { className: string; runners: AdministratorForestWatchResponse["entries"] }[] {
  const byClass = new Map<string, AdministratorForestWatchResponse["entries"]>();
  for (const row of inForest(forest.entries)) byClass.set(row.className, [...(byClass.get(row.className) ?? []), row]);
  return [...byClass.entries()].sort(([a], [b]) => a.localeCompare(b, "sv"))
    .map(([className, runners]) => ({ className, runners: [...runners].sort((a, b) => a.displayName.localeCompare(b.displayName, "sv")) }));
}

/** Stafett: lagen per klass och sträcka – ute på sträckan, i mål och underkända. */
export function relayLegs(relay: RelayOverview) {
  return relay.classes.map(raceClass => {
    const teams = relay.teams.filter(team => team.classId === raceClass.id);
    return { raceClass, legs: raceClass.legs.map(leg => ({ leg: leg.leg,
      out: teams.filter(team => team.status === "RUNNING" && team.currentLeg === leg.leg) })),
    finished: teams.filter(team => team.status === "OK").sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999)) };
  });
}
