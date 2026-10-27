import { describe, expect, it } from "vitest";
import { readoutStanding, relayReadoutStanding, type RelayStandingTeam, type StandingRow } from "../src";

const row = (key: string, elapsedMs: number | undefined, status: StandingRow["status"] = "OK", score?: number): StandingRow =>
  ({ key, name: `Löpare ${key}`, status, ...(elapsedMs === undefined ? {} : { elapsedMs }), ...(score === undefined ? {} : { score }) });

describe("readoutStanding (steg 57)", () => {
  it("ger placering bland godkända och avståndet till ledaren", () => {
    const rows = [row("a", 1_800_000), row("b", 1_900_000), row("c", 1_934_000), row("d", 1_700_000, "MP")];
    expect(readoutStanding(rows, "c")).toEqual({ position: 3, tied: false, finished: 3,
      leader: { name: "Löpare a", behindMs: 134_000 } });
  });

  it("ger ledarens marginal till tvåan och ensam ledare utan marginal", () => {
    expect(readoutStanding([row("a", 1_800_000), row("b", 1_865_000)], "a")).toEqual({ position: 1, tied: false, finished: 2,
      ahead: { ms: 65_000 } });
    expect(readoutStanding([row("a", 1_800_000)], "a")).toEqual({ position: 1, tied: false, finished: 1 });
  });

  it("lika tid ger samma placering, även delad ledning", () => {
    const rows = [row("a", 1_800_000), row("b", 1_800_000), row("c", 1_900_000), row("d", 1_900_000)];
    expect(readoutStanding(rows, "b")).toEqual({ position: 1, tied: true, finished: 4, leader: { name: "Löpare a", behindMs: 0 } });
    expect(readoutStanding(rows, "d")).toMatchObject({ position: 3, tied: true, leader: { name: "Löpare a", behindMs: 100_000 } });
  });

  it("ger ingen placering för ej godkända", () => {
    expect(readoutStanding([row("a", 1_800_000), row("b", 1_700_000, "MP")], "b")).toBeUndefined();
    expect(readoutStanding([row("a", 1_800_000), row("b", 1_700_000, "OVERTIME")], "b")).toBeUndefined();
  });

  it("rogaining rangordnas på poäng och sedan tid", () => {
    const rows = [row("a", 3_500_000, "OK", 180), row("b", 3_000_000, "OK", 140), row("c", 3_400_000, "OK", 140)];
    expect(readoutStanding(rows, "c")).toEqual({ position: 3, tied: false, finished: 3, leader: { name: "Löpare a", pointsBehind: 40 } });
    expect(readoutStanding(rows, "a")).toEqual({ position: 1, tied: false, finished: 3, ahead: { points: 40 } });
    expect(readoutStanding(rows, "b")).toMatchObject({ position: 2 });
  });
});

const team = (key: string, legs: [number, number | undefined, (string | undefined)?, boolean?, string?][]): RelayStandingTeam => ({ key, name: `Lag ${key}`,
  legs: legs.map(([leg, elapsedMs, status, restarted, runner]) => ({ key: runner ?? `${key}${leg}`, leg, restarted: restarted ?? false,
    ...(status ? { status: status as "OK" } : elapsedMs === undefined ? {} : { status: "OK" as const }),
    ...(elapsedMs === undefined ? {} : { elapsedMs }) })) });
const rules = [1, 2, 3].map((leg) => ({ leg, changeoverRule: "FIRST" as const, approvalRule: "ALL" as const }));

describe("relayReadoutStanding (steg 57)", () => {
  it("ger lagets placering efter sträckan och sträcktiden mot bästa", () => {
    const teams = [team("1", [[1, 1_000_000], [2, 1_100_000], [3, undefined]]), team("2", [[1, 900_000], [2, 1_000_000], [3, undefined]]),
      team("3", [[1, 950_000], [2, undefined], [3, undefined]])];
    expect(relayReadoutStanding({ teams, rules, restartRanking: "AFTER_NORMAL", teamKey: "1", runnerKey: "12", leg: 2 })).toEqual({ leg: 2,
      team: { position: 2, tied: false, finished: 2, leader: { name: "Lag 2", behindMs: 200_000 } },
      legTime: { position: 2, tied: false, finished: 2, leader: { name: "Lag 2", behindMs: 100_000 }, elapsedMs: 1_100_000 } });
    // Efter sträcka 1 leder lag 2; lag 3 räknas med.
    expect(relayReadoutStanding({ teams, rules, restartRanking: "AFTER_NORMAL", teamKey: "2", runnerKey: "21", leg: 1 })?.team)
      .toEqual({ position: 1, tied: false, finished: 3, ahead: { ms: 50_000 } });
  });

  it("ett lag med underkänd sträcka får ingen lagplacering men sträcktiden räknas", () => {
    const teams = [team("1", [[1, 1_000_000, "MP"], [2, 900_000]]), team("2", [[1, 900_000], [2, 1_000_000]])];
    const standing = relayReadoutStanding({ teams, rules, restartRanking: "AFTER_NORMAL", teamKey: "1", runnerKey: "12", leg: 2 });
    expect(standing?.team).toBeUndefined();
    expect(standing?.legTime).toMatchObject({ position: 1, ahead: { ms: 100_000 } });
  });

  it("lag i omstart placeras efter de andra (förval) och utan negativt avstånd", () => {
    const teams = [team("1", [[1, 1_000_000], [2, 1_200_000]]), team("2", [[1, 900_000], [2, 1_000_000, "OK", true]])];
    expect(relayReadoutStanding({ teams, rules, restartRanking: "AFTER_NORMAL", teamKey: "2", runnerKey: "22", leg: 2 })?.team)
      .toEqual({ position: 2, tied: false, finished: 2, leader: { name: "Lag 1" } });
    expect(relayReadoutStanding({ teams, rules, restartRanking: "BY_TIME", teamKey: "2", runnerKey: "22", leg: 2 })?.team)
      .toEqual({ position: 1, tied: false, finished: 2, ahead: { ms: 300_000 } });
  });

  it("flera löpare på sträckan: första i mål växlar, alla ska vara godkända", () => {
    const teams = [team("1", [[1, 1_000_000, "OK", false, "a"], [1, 1_100_000, "OK", false, "b"]]),
      team("2", [[1, 950_000, "OK", false, "c"], [1, undefined, undefined, false, "d"]])];
    // Lag 2 väntar på sin andra löpare (alla ska vara godkända), så lag 1 leder ensamt efter sträckan.
    expect(relayReadoutStanding({ teams, rules, restartRanking: "AFTER_NORMAL", teamKey: "1", runnerKey: "b", leg: 1 })).toEqual({ leg: 1,
      team: { position: 1, tied: false, finished: 1 },
      legTime: { position: 3, tied: false, finished: 3, leader: { name: "Lag 2", behindMs: 150_000 }, elapsedMs: 1_100_000 } });
  });
});
