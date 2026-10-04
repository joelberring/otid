import { describe, expect, it } from "vitest";
import {
  evaluateCardReadout, rankRelayLegs, rankRelayTeams, relayLegRestarted, relayLegRuleProblem, relayLegStartTime,
  relayLegStartTimes, relayTeamResult, relayTeamVariants, type RaceSnapshot, type RelayLegRule
} from "../src";

const at = (clock: string) => `2026-10-08T${clock}Z`;
const minutes = (value: number) => value * 60_000;

const rules: RelayLegRule[] = [
  { leg: 1, startMethod: "MASS_START", startTime: at("17:00:00") },
  { leg: 2, startMethod: "CHANGEOVER" },
  { leg: 3, startMethod: "RESTART", startTime: at("18:30:00") }
];

describe("stafettens sträckor", () => {
  it("godtar masstart på sträcka 1 och tider där de behövs", () => {
    expect(relayLegRuleProblem(rules)).toBeUndefined();
    expect(relayLegRuleProblem([rules[0]!])).toBe("TOO_FEW_LEGS");
    expect(relayLegRuleProblem([{ leg: 1, startMethod: "CHANGEOVER" }, rules[1]!])).toBe("FIRST_LEG_NOT_MASS_START");
    expect(relayLegRuleProblem([rules[0]!, { leg: 3, startMethod: "CHANGEOVER" }])).toBe("LEG_NUMBERS");
    expect(relayLegRuleProblem([rules[0]!, { leg: 2, startMethod: "RESTART" }])).toBe("MISSING_START_TIME");
    expect(relayLegRuleProblem([rules[0]!, { leg: 2, startMethod: "CHANGEOVER", startTime: at("17:00:00") }])).toBe("UNEXPECTED_START_TIME");
    expect(relayLegRuleProblem(Array.from({ length: 21 }, (_, index) => ({ leg: index + 1, startMethod: "MASS_START" as const,
      startTime: at("17:00:00") })))).toBe("TOO_MANY_LEGS");
  });

  it("växling: sträckan startar när föregående sträcka gick i mål", () => {
    const starts = relayLegStartTimes(rules, new Map([[1, at("17:31:10")], [2, at("18:05:00")]]));
    expect(starts.get(1)).toBe(at("17:00:00"));
    expect(starts.get(2)).toBe(at("17:31:10"));
    expect(starts.get(3)).toBe(at("18:05:00"));
    expect(relayLegRestarted(rules[2]!, at("18:05:00"))).toBe(false);
  });

  it("växling utan känd måltid ger ingen starttid", () => {
    expect(relayLegStartTime(rules[1]!, undefined)).toBeUndefined();
  });

  it("omstart: lag som inte växlat före omstartstiden startar då", () => {
    expect(relayLegStartTime(rules[2]!, at("18:42:00"))).toBe(at("18:30:00"));
    expect(relayLegStartTime(rules[2]!, undefined)).toBe(at("18:30:00"));
    expect(relayLegStartTime(rules[2]!, at("18:30:00"))).toBe(at("18:30:00"));
    expect(relayLegRestarted(rules[2]!, at("18:42:00"))).toBe(true);
    expect(relayLegRestarted(rules[2]!, undefined)).toBe(true);
    expect(relayLegRestarted(rules[1]!, undefined)).toBe(false);
  });

  it("masstart på en senare sträcka gäller oavsett föregående måltid", () => {
    const mass: RelayLegRule = { leg: 2, startMethod: "MASS_START", startTime: at("17:45:00") };
    expect(relayLegStartTime(mass, at("17:31:00"))).toBe(at("17:45:00"));
  });
});

describe("lagresultat", () => {
  it("godkänt lag: summan av sträcktiderna, som är sista måltid minus första start vid växling", () => {
    const result = relayTeamResult(3, [
      { leg: 1, status: "OK", elapsedMs: minutes(31) },
      { leg: 2, status: "OK", elapsedMs: minutes(34) },
      { leg: 3, status: "OK", elapsedMs: minutes(29) }
    ]);
    expect(result).toEqual({ status: "OK", elapsedMs: minutes(94), completedLegs: 3 });
  });

  it("omstart: lagets tid är summan av sträcktiderna, inte sista mål minus första start", () => {
    // Sträcka 2 gick i mål 18:42, sträcka 3 omstartade 18:30 och sprang 25 minuter (mål 18:55).
    const legThreeStart = relayLegStartTime(rules[2]!, at("18:42:00"))!;
    const legThree = Date.parse(at("18:55:00")) - Date.parse(legThreeStart);
    const result = relayTeamResult(3, [
      { leg: 1, status: "OK", elapsedMs: minutes(40) },
      { leg: 2, status: "OK", elapsedMs: minutes(62) },
      { leg: 3, status: "OK", elapsedMs: legThree }
    ]);
    expect(result.elapsedMs).toBe(minutes(40 + 62 + 25));
    expect(result.elapsedMs).not.toBe(Date.parse(at("18:55:00")) - Date.parse(at("17:00:00")));
  });

  it("felstämplad sträcka: laget är felstämplat och orankat även när övriga sträckor är klara", () => {
    const result = relayTeamResult(3, [
      { leg: 1, status: "OK", elapsedMs: minutes(31) },
      { leg: 2, status: "MP", elapsedMs: minutes(30) },
      { leg: 3, status: "OK", elapsedMs: minutes(29) }
    ]);
    expect(result).toEqual({ status: "MP", completedLegs: 3 });
  });

  it("brutit på en sträcka ger brutet lag; disk går före felstämpling", () => {
    expect(relayTeamResult(2, [{ leg: 1, status: "OK", elapsedMs: 1 }, { leg: 2, status: "DNF" }]).status).toBe("DNF");
    expect(relayTeamResult(3, [{ leg: 1, status: "MP" }, { leg: 2, status: "DSQ" }, { leg: 3, status: "OK", elapsedMs: 5 }]).status)
      .toBe("DSQ");
  });

  it("ute på sträcka: första sträckan utan resultat", () => {
    expect(relayTeamResult(3, [{ leg: 1, status: "OK", elapsedMs: minutes(31) }]))
      .toEqual({ status: "RUNNING", currentLeg: 2, completedLegs: 1 });
    expect(relayTeamResult(3, [])).toEqual({ status: "RUNNING", currentLeg: 1, completedLegs: 0 });
    // Ett underkänt lag kan fortfarande ha löpare ute.
    expect(relayTeamResult(3, [{ leg: 1, status: "MP", elapsedMs: 1 }])).toEqual({ status: "MP", currentLeg: 2, completedLegs: 1 });
  });

  it("placering bland godkända lag; lika tid ger samma placering", () => {
    const ok = (elapsedMs: number) => ({ status: "OK" as const, elapsedMs, completedLegs: 3 });
    const ranking = rankRelayTeams([
      { key: "lag-4", result: { status: "MP", completedLegs: 3 } },
      { key: "lag-2", result: ok(minutes(95)) },
      { key: "lag-5", result: { status: "RUNNING", currentLeg: 3, completedLegs: 2 } },
      { key: "lag-1", result: ok(minutes(94)) },
      { key: "lag-3", result: ok(minutes(95)) },
      { key: "lag-6", result: { status: "RUNNING", currentLeg: 2, completedLegs: 1 } },
      { key: "lag-7", result: { status: "DSQ", completedLegs: 3 } }
    ]);
    expect(ranking).toEqual([
      { key: "lag-1", position: 1, timeBehindMs: 0 },
      { key: "lag-2", position: 2, timeBehindMs: minutes(1) },
      { key: "lag-3", position: 2, timeBehindMs: minutes(1) },
      { key: "lag-5" },
      { key: "lag-6" },
      { key: "lag-4" },
      { key: "lag-7" }
    ]);
  });

  it("sträckresultat rankas för sig per sträcka", () => {
    const ranking = rankRelayLegs([
      { key: "a1", leg: 1, status: "OK", elapsedMs: minutes(31), courseVersionId: "v" },
      { key: "b1", leg: 1, status: "OK", elapsedMs: minutes(30), courseVersionId: "v" },
      { key: "a2", leg: 2, status: "OK", elapsedMs: minutes(28), courseVersionId: "v" },
      { key: "b2", leg: 2, status: "MP", elapsedMs: minutes(20), courseVersionId: "v" }
    ]);
    expect(ranking).toEqual([
      { key: "b1", leg: 1, rankingState: "RANKED", position: 1, timeBehindMs: 0 },
      { key: "a1", leg: 1, rankingState: "RANKED", position: 2, timeBehindMs: minutes(1) },
      { key: "a2", leg: 2, rankingState: "RANKED", position: 1, timeBehindMs: 0 },
      { key: "b2", leg: 2, rankingState: "NOT_RANKABLE_STATUS" }
    ]);
  });
});

describe("sträckan bedöms som en individuell avläsning", () => {
  const snapshot = (fixedStartTime?: string): RaceSnapshot => ({
    race: { id: "race", eventId: "event", name: "Stafett", raceDate: "2026-10-08", snapshotVersion: 1 },
    classes: [{ id: "class", raceId: "race", name: "Stafett", courseVersionId: "version", startRule: "FIXED" }],
    courses: [{ id: "course", raceId: "race", name: "Bana", versions: [{ id: "version", courseId: "course", version: 1,
      createdAt: at("08:00:00"), controls: [31, 32, 33].map((code, index) => ({ id: `control-${code}`, courseVersionId: "version",
        controlId: `c${code}`, sequence: index + 1, controlCode: code })) }] }],
    entries: [{ id: "leg-2", raceId: "race", classId: "class", givenName: "Bo", familyName: "Sträcka", ...(fixedStartTime ? { fixedStartTime } : {}) }],
    cardAssignments: [{ id: "card", raceId: "race", entryId: "leg-2", cardNumber: "8002", active: true }],
    classControlNeutralizations: []
  });
  const readout = { cardNumber: "8002", finishPunchedAt: at("18:05:00"),
    punches: [{ code: 31, punchedAt: at("17:40:00") }, { code: 32, punchedAt: at("17:50:00") }, { code: 33, punchedAt: at("18:00:00") }] };

  it("växlingstiden blir sträckans start och sträcktiden mål minus växling", () => {
    const start = relayLegStartTime(rules[1]!, at("17:31:10"));
    const result = evaluateCardReadout(readout, snapshot(start));
    expect(result).toMatchObject({ status: "OK", startTime: at("17:31:10"), elapsedMs: Date.parse(at("18:05:00")) - Date.parse(at("17:31:10")) });
  });

  it("okänd växlingstid ger saknad start tills föregående sträcka är avläst", () => {
    expect(evaluateCardReadout(readout, snapshot(undefined))).toMatchObject({ status: "MP", reason: "MISSING_START" });
  });
});

describe("gafflad stafett", () => {
  it("lagen roterar banans varianter så att lag i följd springer dem i olika ordning", () => {
    const codes = ["A", "B", "C"];
    const team = (teamIndex: number) => [...relayTeamVariants({ variantCodes: codes, legCount: 3, teamIndex }).entries()]
      .sort((left, right) => left[0] - right[0]).map(([, code]) => code).join("");
    expect([team(0), team(1), team(2), team(3)]).toEqual(["ABC", "BCA", "CAB", "ABC"]);
  });

  it("en sträcka med bestämd variant får den", () => {
    const variants = relayTeamVariants({ variantCodes: ["1", "2", "3"], legCount: 3, teamIndex: 1,
      fixedVariants: new Map([[1, "1"], [2, "2"], [3, "3"]]) });
    expect([...variants.entries()]).toEqual([[1, "1"], [2, "2"], [3, "3"]]);
    expect(relayTeamVariants({ variantCodes: [], legCount: 2, teamIndex: 0 }).size).toBe(0);
  });
});
