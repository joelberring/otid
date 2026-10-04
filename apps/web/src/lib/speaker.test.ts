import { describe, expect, it } from "vitest";
import type { AdministratorForestWatchResponse, PublicResultListResponseV7, SpeakerBoardResponse } from "@o-tid/contracts";
import { classLeaders, forestByClass, latestFinishers } from "./speaker";

let ids = 0;
const id = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;
const result = (className: string, givenName: string, position: number | undefined, elapsedMs: number, status: "OK" | "MP" = "OK") => ({
  publicResultId: id(), className, givenName, familyName: "Löpare", organisationName: "OK Test", revision: 1,
  reason: status === "OK" ? "COMPLETE" : "MISSING_CONTROL", elapsedMs, splits: [], missingControls: [], extraPunches: [], status,
  ...(position === undefined ? { rankingState: "NOT_RANKABLE_STATUS" } : { rankingState: "RANKED", position, timeBehindMs: 0 })
}) as unknown as PublicResultListResponseV7["results"][number];

const results: PublicResultListResponseV7 = { formatVersion: 7, results: [
  result("H21", "Hugo", 2, 65_000), result("H21", "Anna", 1, 60_000), result("H21", "Bo", 3, 70_000), result("H21", "Cia", 4, 80_000),
  result("D21", "Dora", 1, 50_000), result("D21", "Eva", undefined, 40_000, "MP")
] };

describe("speakersidan", () => {
  it("visar de tre bästa per klass, klasserna i namnordning", () => {
    expect(classLeaders(results).map(row => [row.className, row.leaders.map(leader => leader.givenName)])).toEqual([
      ["D21", ["Dora"]], ["H21", ["Anna", "Hugo", "Bo"]]
    ]);
  });

  it("visar senast i mål nyast först med placering för godkända", () => {
    const row = (givenName: string, className: string, at: string, status: "OK" | "MP") => ({ slot: ids++ % 25 + 1, givenName, familyName: "Löpare",
      organisationName: "OK Test", className, selectedRevision: 1, registeredAt: at, state: "ACTIVE_RESULT",
      result: status === "OK" ? { revision: 1, status, reason: "COMPLETE", elapsedMs: 60_000 }
        : { revision: 1, status, reason: "MISSING_CONTROL", elapsedMs: 40_000 } });
    const board = { rows: [row("Anna", "H21", "2026-10-08T16:01:00.000Z", "OK"), row("Eva", "D21", "2026-10-08T16:03:00.000Z", "MP")] } as unknown as SpeakerBoardResponse;
    expect(latestFinishers(board, results).map(row => [row.givenName, row.position])).toEqual([["Eva", undefined], ["Anna", 1]]);
    expect(latestFinishers(board, undefined)[1]!.position).toBeUndefined();
  });

  it("grupperar kvar i skogen per klass", () => {
    const entry = (displayName: string, className: string, forestState: string) => ({ displayName, className, forestState });
    const forest = { entries: [entry("Ö", "H21", "UNCONFIRMED"), entry("Å", "H21", "STARTED_NO_RETURN"), entry("Klar", "H21", "RETURNED"),
      entry("Ej start", "D21", "NOT_STARTED"), entry("Dora", "D21", "CONFLICT")] } as unknown as AdministratorForestWatchResponse;
    expect(forestByClass(forest).map(row => [row.className, row.runners.map(runner => runner.displayName)])).toEqual([
      ["D21", ["Dora"]], ["H21", ["Å", "Ö"]]
    ]);
  });
});
