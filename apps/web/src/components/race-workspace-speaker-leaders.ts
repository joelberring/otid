import type { PublicResultListResponseV7 } from "@o-tid/contracts";

export type PublicClassLeader = PublicResultListResponseV7["results"][number] & {
  status: "OK";
  rankingState: "RANKED";
  elapsedMs: number;
  position: 1;
  timeBehindMs: 0;
};

export function publicClassLeaders(response: PublicResultListResponseV7): PublicClassLeader[] {
  return response.results.filter((result): result is PublicClassLeader =>
    result.status === "OK" &&
    result.rankingState === "RANKED" &&
    result.position === 1 &&
    result.timeBehindMs === 0 &&
    result.elapsedMs !== undefined);
}
