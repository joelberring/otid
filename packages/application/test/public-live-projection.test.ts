import { describe, expect, it } from "vitest";
import type { PublicRadioPassage, PublicRadioResponse, PublicResultListResponseV7 } from "@o-tid/contracts";
import { NEW_LEADER_WINDOW_MS, projectPublicLive, type PublicLiveArrival } from "../src/public-live";

/**
 * PLAN.md steg 30: den publika Live-projektionen. Ordning (nyaste först), "Ny ledare" inom fönstret, felstämplad utan
 * placering, strukna och ej start borta, och inga bricknummer eller interna id:n i svaret.
 */
const raceId = "10000000-0000-4000-8000-000000000030";
const now = new Date("2026-10-20T19:30:00.000Z");
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const CARD = "8123456";
const ENTRY_ID = "30000000-0000-4000-8000-000000000099";

type Row = PublicResultListResponseV7["results"][number];
const ok = (n: number, className: string, given: string, elapsedMs: number, position: number, behind: number): Row => ({
  className, publicResultId: id(n), givenName: given, familyName: "Ek", organisationName: n % 2 ? "OK Ek" : "IFK Lidingö", revision: 1,
  status: "OK", reason: "COMPLETE", elapsedMs, splits: [], missingControls: [], extraPunches: [], rankingState: "RANKED", position,
  timeBehindMs: behind });

const results: PublicResultListResponseV7 = { formatVersion: 7, results: [
  ok(1, "H21", "Anna", 1_800_000, 1, 0),
  ok(2, "H21", "Bo", 1_900_000, 2, 100_000),
  { className: "H21", publicResultId: id(3), givenName: "Cia", familyName: "Ek", organisationName: "OK Ek", revision: 2, status: "MP",
    reason: "MISSING_CONTROL", elapsedMs: 1_700_000, splits: [], missingControls: [33], extraPunches: [], rankingState: "NOT_RANKABLE_STATUS" },
  { className: "H21", publicResultId: id(4), givenName: "Dan", familyName: "Ek", organisationName: "OK Ek", revision: 1, status: "DNS",
    reason: "DID_NOT_START", splits: [], missingControls: [], extraPunches: [], rankingState: "NOT_RANKABLE_STATUS" },
  ok(5, "D21", "Eva", 2_000_000, 1, 0),
  ok(6, "D21", "Fia", 1_500_000, 1, 0),
  { className: "D21", publicResultId: id(7), givenName: "Gun", familyName: "Ek", organisationName: null, revision: 1, status: "MP",
    reason: "MISSING_FINISH", splits: [], missingControls: [], extraPunches: [], rankingState: "NOT_RANKABLE_STATUS" }
] };

/** Interna fält som en rad från databasen kan bära; projektionen får aldrig släppa ut dem. */
const internal = { cardNumber: CARD, entryId: ENTRY_ID };
const arrival = (n: number, at: Date, struckAt: Date | null = null): PublicLiveArrival => {
  const row = { publicResultId: id(n), arrivedAt: at, struckAt, ...internal };
  return row;
};
const arrivals = [arrival(1, minutesAgo(20)), arrival(2, minutesAgo(2)), arrival(3, minutesAgo(1)), arrival(4, minutesAgo(30)),
  arrival(5, minutesAgo(3)), arrival(6, minutesAgo(10), minutesAgo(1)), arrival(7, minutesAgo(4))];

const passage = (n: number, given: string, place: number, finished = false): PublicRadioPassage => {
  const row = { publicResultId: id(n), givenName: given, familyName: "Ek", organisationName: "OK Ek", className: "H21", controlCode: 50,
    label: "Radio 1", passedAt: minutesAgo(5).toISOString(), elapsedMs: 372_000, place, finished, ...internal };
  return row;
};
const radio: PublicRadioResponse = { formatVersion: 1, raceId, enabled: true, timeZone: "Europe/Stockholm",
  classes: [{ className: "H21", controls: [], onTheWay: [passage(8, "Hugo", 2), passage(6, "Fia", 1)] }],
  latest: [passage(8, "Hugo", 2), passage(6, "Fia", 1)] };

const live = (overrides: Partial<Parameters<typeof projectPublicLive>[0]> = {}) =>
  projectPublicLive({ raceId, now, timeZone: "Europe/Stockholm", results, arrivals, radio, ...overrides });

/** Alla löv i svaret, för jämförelse av hela värden (aldrig delsträngar: ett UUID kan råka innehålla siffrorna). */
function leaves(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(leaves);
  return [value];
}
function keys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keys);
  if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([key, inner]) => [key, ...keys(inner)]);
  return [];
}

describe("Live för publiken (PLAN.md steg 30)", () => {
  it("visar målgångarna nyaste först med klass, tid och placering; felstämplad utan placering och tid", () => {
    const response = live();
    expect(response.finishes.map(row => row.givenName)).toEqual(["Cia", "Bo", "Eva", "Anna"]);
    expect(response.finishes[0]).toEqual({ publicResultId: id(3), givenName: "Cia", familyName: "Ek", organisationName: "OK Ek",
      className: "H21", finishedAt: minutesAgo(1).toISOString(), status: "MP" });
    expect(response.finishes[1]).toMatchObject({ givenName: "Bo", status: "OK", elapsedMs: 1_900_000, place: 2 });
    expect(response.finishes.find(row => row.givenName === "Anna")).toMatchObject({ place: 1, elapsedMs: 1_800_000 });
  });

  it("lika ankomsttid ordnas på klass och namn", () => {
    const same = [arrival(1, minutesAgo(2)), arrival(2, minutesAgo(2)), arrival(5, minutesAgo(2))];
    expect(live({ arrivals: same }).finishes.map(row => row.givenName)).toEqual(["Eva", "Anna", "Bo"]);
  });

  it("utesluter ej start, saknad målstämpling, strukna och resultat som inte kommit in", () => {
    const response = live();
    const names = [...response.finishes, ...response.leaders].map(row => row.givenName);
    for (const name of ["Dan", "Gun", "Fia"]) expect(names).not.toContain(name);
    // Fia är struken: inte heller bland radiopassagerna.
    expect([...response.radio.latest, ...response.radio.onTheWay].map(row => row.givenName)).toEqual(["Hugo", "Hugo"]);
    expect(live({ arrivals: arrivals.filter(row => row.publicResultId !== id(2)) }).finishes.map(row => row.givenName)).not.toContain("Bo");
  });

  it("ledare per klass i namnordning; Ny ledare bara inom fönstret", () => {
    const response = live();
    expect(response.leaders.map(row => [row.className, row.givenName, row.newLeader])).toEqual([["D21", "Eva", true], ["H21", "Anna", false]]);
    expect(response.leaders[0]).toMatchObject({ elapsedMs: 2_000_000, since: minutesAgo(3).toISOString() });
    expect(response.newLeaderWindowMs).toBe(NEW_LEADER_WINDOW_MS);
    // Precis på gränsen räknas som ny, en sekund efter inte.
    const edge = (ms: number) => live({ arrivals: [arrival(1, new Date(now.getTime() - ms))] }).leaders.find(row => row.givenName === "Anna")!;
    expect(edge(NEW_LEADER_WINDOW_MS).newLeader).toBe(true);
    expect(edge(NEW_LEADER_WINDOW_MS + 1_000).newLeader).toBe(false);
    // Utan känd ankomst: ingen markering.
    expect(live({ arrivals: [] }).leaders.find(row => row.givenName === "Anna")).toMatchObject({ since: null, newLeader: false });
  });

  it("delad förstaplats ger båda som ledare", () => {
    const tied: PublicResultListResponseV7 = { formatVersion: 7, results: [ok(1, "H21", "Anna", 1_800_000, 1, 0), ok(2, "H21", "Bo", 1_800_000, 1, 0)] };
    expect(live({ results: tied }).leaders.map(row => row.givenName)).toEqual(["Anna", "Bo"]);
  });

  it("släpper aldrig ut bricknummer, interna id:n eller tekniska orsaker", () => {
    const response = live();
    const values = leaves(response);
    expect(values).not.toContain(CARD);
    expect(values).not.toContain(Number(CARD));
    expect(values).not.toContain(ENTRY_ID);
    for (const reason of ["MISSING_CONTROL", "MISSING_FINISH", "COMPLETE", "NOT_RANKABLE_STATUS", "RANKED"]) expect(values).not.toContain(reason);
    const names = new Set(keys(response));
    for (const key of ["cardNumber", "entryId", "reason", "rankingState", "missingControls", "splits", "revision", "struckAt"]) {
      expect(names.has(key), key).toBe(false);
    }
  });

  it("utan radio och utan resultat: tomt men giltigt", () => {
    const response = live({ results: { formatVersion: 7, results: [] }, arrivals: [],
      radio: { formatVersion: 1, raceId, enabled: false, timeZone: "Europe/Stockholm", classes: [], latest: [] } });
    expect(response).toMatchObject({ finishes: [], leaders: [], radio: { enabled: false, latest: [], onTheWay: [] } });
  });
});
