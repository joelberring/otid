import { describe, expect, it } from "vitest";
import type { PublicLiveResponse } from "@o-tid/contracts";
import { ordinal, liveSv } from "../i18n/live-sv";
import { clubOptions, followedView, hasActivity, leadersByClass } from "./public-live-view";

/** PLAN.md steg 30: urvalen på Live-sidan. */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const runner = (n: number, given: string, club: string | null, className = "H21") =>
  ({ publicResultId: id(n), givenName: given, familyName: "Ek", organisationName: club, className });
const passage = (n: number, given: string, club: string) => ({ ...runner(n, given, club), controlCode: 50, label: "Radio 1",
  passedAt: "2026-10-20T18:00:00.000Z", elapsedMs: 372_000, place: 2, finished: false });
const live: PublicLiveResponse = { formatVersion: 1, raceId: id(99), generatedAt: "2026-10-20T18:10:00.000Z", timeZone: "Europe/Stockholm",
  newLeaderWindowMs: 300_000,
  finishes: [{ ...runner(1, "Anna", "OK Ek"), finishedAt: "2026-10-20T18:05:00.000Z", status: "OK", elapsedMs: 1_800_000, place: 1 },
    { ...runner(2, "Bo", "IFK Lidingö"), finishedAt: "2026-10-20T18:04:00.000Z", status: "MP" }],
  leaders: [{ ...runner(3, "Cia", null, "D21"), elapsedMs: 1_000_000, since: null, newLeader: false },
    { ...runner(1, "Anna", "OK Ek"), elapsedMs: 1_800_000, since: "2026-10-20T18:05:00.000Z", newLeader: true },
    { ...runner(4, "Dan", "OK Ek"), elapsedMs: 1_800_000, since: "2026-10-20T18:01:00.000Z", newLeader: true }],
  radio: { enabled: true, latest: [passage(5, "Eva", "Alfta-Ösa OK")], onTheWay: [passage(5, "Eva", "Alfta-Ösa OK")] } };

describe("Live-sidans urval", () => {
  it("följda löpare i den här tävlingen med målgång eller radiopassage, och klubbar med sina löpare", () => {
    const view = followedView(live, { runners: [
      { raceId: id(99), publicResultId: id(2), name: "Bo Ek", club: "IFK Lidingö", className: "H21" },
      { raceId: id(99), publicResultId: id(5), name: "Eva Ek", club: "Alfta-Ösa OK", className: "H21" },
      { raceId: id(99), publicResultId: id(7), name: "Gun Ek", club: null, className: "H21" },
      { raceId: "en-annan", publicResultId: id(1), name: "Anna Ek", club: "OK Ek", className: "H21" }], clubs: ["OK Ek", "Ingen"] }, id(99));
    expect(view.runners.map(row => [row.runner.name, row.finish?.status, row.passage?.controlCode])).toEqual([
      ["Bo Ek", "MP", undefined], ["Eva Ek", undefined, 50], ["Gun Ek", undefined, undefined]]);
    expect(view.clubs.map(row => [row.club, row.finishes.map(finish => finish.givenName), row.onTheWay.length])).toEqual([
      ["OK Ek", ["Anna"], 0], ["Ingen", [], 0]]);
  });

  it("klubbarna i namnordning, ledarna per klass och om något hänt", () => {
    expect(clubOptions(live)).toEqual(["Alfta-Ösa OK", "IFK Lidingö", "OK Ek"]);
    expect(leadersByClass(live).map(group => [group.className, group.leaders.map(row => row.givenName)])).toEqual([
      ["D21", ["Cia"]], ["H21", ["Anna", "Dan"]]]);
    expect(hasActivity(live)).toBe(true);
    expect(hasActivity({ ...live, finishes: [], radio: { enabled: true, latest: [], onTheWay: [] } })).toBe(false);
  });

  it("placering som svensk ordning och radiopassagen som mening", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(["1:a", "2:a", "3:e", "4:e", "11:e", "12:e", "13:e", "21:a", "22:a",
      "101:a", "111:e"]);
    expect(liveSv.passed("Radio 1", "6:12", 2)).toBe("passerade Radio 1 6:12, 2:a");
    expect(liveSv.passed("kontroll 50", null, null)).toBe("passerade kontroll 50");
  });
});
