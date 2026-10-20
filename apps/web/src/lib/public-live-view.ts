import type { PublicLiveFinish, PublicLiveLeader, PublicLiveResponse, PublicRadioPassage } from "@o-tid/contracts";
import type { FollowedRunner, Follows } from "./follow-store";

/**
 * Live för publiken (PLAN.md steg 30): rena urval över Live-svaret för sidan – de senaste i mål, ledarna per klass och
 * det besökaren följer ("Följer" överst). Ingen resultatlogik: placering och ledare kommer från servern.
 */
export const LATEST_SHOWN = 15;

export type FollowedRunnerView = { runner: FollowedRunner; finish?: PublicLiveFinish | undefined; passage?: PublicRadioPassage | undefined };
export type FollowedClubView = { club: string; finishes: PublicLiveFinish[]; onTheWay: PublicRadioPassage[] };

/** Följda löpare i den här tävlingen (med målgång eller senaste radiopassage) och följda klubbar med sina löpare. */
export function followedView(live: PublicLiveResponse, follows: Follows, raceId: string): { runners: FollowedRunnerView[]; clubs: FollowedClubView[] } {
  const finishById = new Map(live.finishes.map(row => [row.publicResultId, row]));
  const passageById = new Map(live.radio.onTheWay.map(row => [row.publicResultId, row]));
  const runners = follows.runners.filter(runner => runner.raceId === raceId).map(runner => ({ runner,
    finish: finishById.get(runner.publicResultId), passage: finishById.has(runner.publicResultId) ? undefined : passageById.get(runner.publicResultId) }));
  const clubs = follows.clubs.map(club => ({ club, finishes: live.finishes.filter(row => row.organisationName === club),
    onTheWay: live.radio.onTheWay.filter(row => row.organisationName === club) }));
  return { runners, clubs };
}

/** Klubbarna som finns i Live (i mål eller ute i skogen), i namnordning, för "Följ en klubb". */
export function clubOptions(live: PublicLiveResponse): string[] {
  const clubs = new Set<string>();
  for (const row of [...live.finishes, ...live.radio.onTheWay, ...live.radio.latest]) if (row.organisationName) clubs.add(row.organisationName);
  return [...clubs].sort((a, b) => a.localeCompare(b, "sv"));
}

/** Ledarna grupperade per klass (delad förstaplats ger flera), i serverns ordning. */
export function leadersByClass(live: PublicLiveResponse): { className: string; leaders: PublicLiveLeader[] }[] {
  const groups: { className: string; leaders: PublicLiveLeader[] }[] = [];
  for (const leader of live.leaders) {
    const last = groups.at(-1);
    if (last?.className === leader.className) last.leaders.push(leader); else groups.push({ className: leader.className, leaders: [leader] });
  }
  return groups;
}

/** Sidan har något att visa: en målgång eller en radiopassage. */
export const hasActivity = (live: PublicLiveResponse) => live.finishes.length > 0 || live.radio.latest.length > 0 || live.radio.onTheWay.length > 0;
