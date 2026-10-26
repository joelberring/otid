import { describe, expect, it } from "vitest";
import {
  teamSprintCoverage, teamSprintEachLegLayout, teamSprintEachLegReadout, teamSprintMissingReadouts, teamSprintRoute,
  type TeamSprintEachLegPart, type TeamSprintRoutePart
} from "../src/team-sprint";
import { evaluateReadoutForEntry } from "../src/entry-readout";
import type { EvaluationReadout, Punch, RaceSnapshot } from "../src/types";

/**
 * Steg 50 (ADR-0174 beslut 9): teamsprint med utläsning efter varje sträcka. Löpare A springer sträcka 1 (bana 31 32) och
 * sträcka 3 (bana 41 43) med bricka 500 och läser ut efter båda; B springer sträcka 2.
 */
const at = (clock: string) => `2026-10-08T${clock}.000Z`;
const minutes = (value: number) => value * 60_000;
const punch = (code: number, clock: string): Punch => ({ code, punchedAt: at(clock) });

const legOne = [punch(31, "17:02:00"), punch(32, "17:05:00")];
const legThree = [punch(41, "17:24:00"), punch(43, "17:27:00")];
const first: EvaluationReadout = { cardNumber: "500", finishPunchedAt: at("17:08:00"), punches: legOne };
// Andra utläsningen: brickan är inte tömd, första sträckans stämplingar finns kvar och målet är det nya.
const second: EvaluationReadout = { cardNumber: "500", finishPunchedAt: at("17:30:00"), punches: [...legOne, ...legThree] };

function version(id: string, codes: number[]) {
  return { id, courseId: `course-${id}`, version: 1, createdAt: at("08:00:00"),
    controls: codes.map((code, index) => ({ id: `${id}-${code}`, courseVersionId: id, controlId: `c${code}`, sequence: index + 1, controlCode: code })) };
}

function snapshot(parts: Map<string, TeamSprintEachLegPart>, starts: Record<string, string>): RaceSnapshot {
  return {
    race: { id: "race", eventId: "event", name: "Teamsprint", raceDate: "2026-10-08", snapshotVersion: 1 },
    classes: [{ id: "class", raceId: "race", name: "Teamsprint", courseVersionId: "a", startRule: "FIXED" }],
    courses: [{ id: "course-a", raceId: "race", name: "A", versions: [version("a", [31, 32])] },
      { id: "course-c", raceId: "race", name: "C", versions: [version("c", [41, 43])] }],
    entries: [
      { id: "leg-1", raceId: "race", classId: "class", givenName: "Ada", familyName: "Ek", fixedStartTime: starts["leg-1"]!,
        teamSprint: parts.get("leg-1")! },
      { id: "leg-3", raceId: "race", classId: "class", givenName: "Ada", familyName: "Ek", courseVersionId: "c",
        ...(starts["leg-3"] ? { fixedStartTime: starts["leg-3"] } : {}), teamSprint: parts.get("leg-3")! }],
    cardAssignments: [{ id: "a", raceId: "race", entryId: "leg-1", cardNumber: "500", active: true }]
  };
}

const routeParts = (done: [boolean, boolean], readouts: [EvaluationReadout & { id: string } | undefined, (EvaluationReadout & { id: string }) | undefined]):
  TeamSprintRoutePart[] => [
  { entryId: "leg-1", leg: 1, done: done[0], controlCodes: [31, 32],
    ...(readouts[0] ? { readout: { id: readouts[0].id, finishPunchedAt: readouts[0].finishPunchedAt! } } : {}) },
  { entryId: "leg-3", leg: 3, done: done[1], controlCodes: [41, 43],
    ...(readouts[1] ? { readout: { id: readouts[1].id, finishPunchedAt: readouts[1].finishPunchedAt! } } : {}) }];

describe("teamsprint: utläsning efter varje sträcka", () => {
  const starts = { "leg-1": at("17:00:00"), "leg-3": at("17:20:00") };

  it("andra utläsningen har kvar första sträckans stämplingar: sträcka 3 bedöms mot det som stämplats efter förra målet", () => {
    expect(teamSprintRoute(routeParts([false, false], [undefined, undefined]), first)).toMatchObject({ kind: "LEGS", from: 1, to: 1, missing: [] });
    expect(teamSprintRoute(routeParts([true, false], [{ ...first, id: "r1" }, undefined]), second))
      .toMatchObject({ kind: "LEGS", from: 2, to: 2, missing: [] });
    const layout = teamSprintEachLegLayout([{ entryId: "leg-1", readout: { id: "r1", finishPunchedAt: first.finishPunchedAt! } },
      { entryId: "leg-3", readout: { id: "r2", finishPunchedAt: second.finishPunchedAt! } }]);
    expect(layout.get("leg-3")).toMatchObject({ part: 2, from: 2, to: 2, after: first.finishPunchedAt });
    expect(teamSprintEachLegReadout(second, layout.get("leg-3")!, snapshot(layout, starts)).punches).toEqual(legThree);
    const snap = snapshot(layout, starts);
    expect(evaluateReadoutForEntry(first, snap, "leg-1")).toMatchObject({ status: "OK", elapsedMs: minutes(8), finishTime: at("17:08:00") });
    expect(evaluateReadoutForEntry(second, snap, "leg-3")).toMatchObject({ status: "OK", elapsedMs: minutes(10), finishTime: at("17:30:00") });
  });

  it("dubblett: samma bricka utläst igen efter samma sträcka är en omläsning, inte nästa sträcka", () => {
    expect(teamSprintRoute(routeParts([true, false], [{ ...first, id: "r1" }, undefined]), { ...first }))
      .toEqual({ kind: "REREAD", readoutId: "r1", parts: [1] });
    expect(teamSprintRoute(routeParts([true, true], [{ ...first, id: "r1" }, { ...second, id: "r2" }]), { ...second }))
      .toEqual({ kind: "REREAD", readoutId: "r2", parts: [2] });
  });

  it("en måltid före föregående sträckas mål ger ett tydligt besked; alla sträckor utlästa likaså", () => {
    const old = { cardNumber: "500", finishPunchedAt: at("17:07:00"), punches: legOne };
    expect(teamSprintRoute(routeParts([true, false], [{ ...first, id: "r1" }, undefined]), old)).toEqual({ kind: "EARLIER_FINISH", part: 1 });
    const third = { ...second, finishPunchedAt: at("17:45:00") };
    expect(teamSprintRoute(routeParts([true, true], [{ ...first, id: "r1" }, { ...second, id: "r2" }]), third)).toEqual({ kind: "ALL_READ" });
  });

  it("felstämpling på andra sträckan gäller bara den sträckan", () => {
    const mispunched = { ...second, punches: [...legOne, punch(41, "17:24:00")] };
    const layout = teamSprintEachLegLayout([{ entryId: "leg-1", readout: { id: "r1", finishPunchedAt: first.finishPunchedAt! } },
      { entryId: "leg-3", readout: { id: "r2", finishPunchedAt: mispunched.finishPunchedAt! } }]);
    const snap = snapshot(layout, starts);
    expect(evaluateReadoutForEntry(first, snap, "leg-1")).toMatchObject({ status: "OK" });
    // Första sträckans 31 och 32 finns kvar på brickan men räknas inte för sträcka 3.
    expect(evaluateReadoutForEntry(mispunched, snap, "leg-3")).toMatchObject({ status: "MP", missingControls: [43] });
  });

  it("glömd utläsning med växlingskontroll: delas vid växlingsstämplingen och båda sträckorna får mål", () => {
    const forgotten = { cardNumber: "500", finishPunchedAt: at("17:30:00"),
      punches: [...legOne, punch(100, "17:08:00"), ...legThree] };
    const route = teamSprintRoute(routeParts([false, false], [undefined, undefined]), forgotten, 100);
    expect(route).toEqual({ kind: "LEGS", from: 1, to: 2, byChangeover: true, missing: [] });
    const layout = teamSprintEachLegLayout([{ entryId: "leg-1", readout: { id: "r", finishPunchedAt: forgotten.finishPunchedAt } },
      { entryId: "leg-3", readout: { id: "r", finishPunchedAt: forgotten.finishPunchedAt } }], 100);
    expect(layout.get("leg-1")).toMatchObject({ from: 1, to: 2 });
    const snap = snapshot(layout, starts);
    expect(evaluateReadoutForEntry(forgotten, snap, "leg-1")).toMatchObject({ status: "OK", finishTime: at("17:08:00") });
    expect(evaluateReadoutForEntry(forgotten, snap, "leg-3")).toMatchObject({ status: "OK", finishTime: at("17:30:00"), elapsedMs: minutes(10) });
  });

  it("glömd utläsning utan växlingskontroll: banorna läggs i tur och ordning, bara sista sträckan får mål och den andra saknar utläsning", () => {
    const forgotten = { cardNumber: "500", finishPunchedAt: at("17:30:00"), punches: [...legOne, ...legThree] };
    const route = teamSprintRoute(routeParts([false, false], [undefined, undefined]), forgotten);
    expect(route).toEqual({ kind: "LEGS", from: 1, to: 2, byChangeover: false, missing: [1] });
    // Bara sträcka 3 får utläsningen; sträcka 1 visas som "utläsning saknas" (ingen felstämpling).
    const layout = teamSprintEachLegLayout([{ entryId: "leg-1" }, { entryId: "leg-3", readout: { id: "r", finishPunchedAt: forgotten.finishPunchedAt } }]);
    expect(layout.get("leg-3")).toMatchObject({ from: 1, to: 2 });
    const snap = snapshot(layout, starts);
    expect(teamSprintEachLegReadout(forgotten, layout.get("leg-3")!, snap).punches).toEqual(legThree);
    expect(evaluateReadoutForEntry(forgotten, snap, "leg-3")).toMatchObject({ status: "OK", elapsedMs: minutes(10) });
    expect(teamSprintMissingReadouts([{ done: false, hasReadout: false }, { done: true, hasReadout: true }])).toEqual([1]);
  });

  it("samma bana på båda sträckorna: en vanlig utläsning täcker en sträcka, en glömd två", () => {
    const course = [[31, 32], [31, 32]];
    expect(teamSprintCoverage(first, { courses: course }).count).toBe(1);
    const twice = { cardNumber: "500", finishPunchedAt: at("17:30:00"), punches: [...legOne, punch(31, "17:24:00"), punch(32, "17:27:00")] };
    expect(teamSprintCoverage(twice, { courses: course }).count).toBe(2);
    // Efter första utläsningen räknas bara stämplingarna efter dess mål.
    expect(teamSprintCoverage(twice, { courses: course, after: first.finishPunchedAt! }).count).toBe(1);
  });

  it("omvänd ordning: sträcka 3:s utläsning före sträcka 1:s, och lagkamratens växling före eller efter", () => {
    // A:s andra utläsning kommer först: den täcker båda sträckorna (glömd?) och sträcka 1 saknar utläsning tills första kommer.
    expect(teamSprintRoute(routeParts([false, false], [undefined, undefined]), second)).toMatchObject({ from: 1, to: 2, missing: [1] });
    // Sedan första utläsningen: den går till sträcka 1, och sträcka 3 bedöms om mot stämplingarna efter dess mål.
    expect(teamSprintRoute(routeParts([false, true], [undefined, { ...second, id: "r2" }]), first)).toMatchObject({ kind: "LEGS", from: 1, to: 1 });
    const layout = teamSprintEachLegLayout([{ entryId: "leg-1", readout: { id: "r1", finishPunchedAt: first.finishPunchedAt! } },
      { entryId: "leg-3", readout: { id: "r2", finishPunchedAt: second.finishPunchedAt! } }]);
    expect(layout.get("leg-3")).toMatchObject({ from: 2, after: first.finishPunchedAt });
    // Lagkamraten B (sträcka 2) inte avläst än: sträcka 3 saknar start. När B:s växling är känd blir den godkänd.
    expect(evaluateReadoutForEntry(second, snapshot(layout, { "leg-1": starts["leg-1"] }), "leg-3"))
      .toMatchObject({ status: "MP", reason: "MISSING_START" });
    expect(evaluateReadoutForEntry(second, snapshot(layout, starts), "leg-3")).toMatchObject({ status: "OK", elapsedMs: minutes(10) });
  });
});
