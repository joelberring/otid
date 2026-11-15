import { describe, expect, it } from "vitest";
import {
  controlsInReach, duelPoints, duelScores, judgePunches, parseControlPoints, virtualResult, withinRadius, type VirtualCourse, type VirtualPunch
} from "../src";

// 1:10 000: 10 m per mm. Start (0,0), 31 (10,0), 32 (20,0), 33 (20,10), mål (0,10).
const M = 10;
const control = (id: string, kind: "START" | "CONTROL" | "FINISH", code: string, x: number, y: number, points = 10) => ({ id, kind, code, x, y, points });
const controls = [control("s", "START", "S", 0, 0), control("a", "CONTROL", "31", 10, 0, 20), control("b", "CONTROL", "32", 20, 0),
  control("c", "CONTROL", "33", 20, 10, 30), control("f", "FINISH", "M", 0, 10)];
const ordered: VirtualCourse = { order: "ORDERED", controls };
const score: VirtualCourse = { order: "SCORE", controls };
const punch = (id: string, at: number, dx = 0, accuracyM = 5): VirtualPunch => {
  const c = controls.find(item => item.id === id)!;
  return { control: id, at, x: c.x + dx, y: c.y, accuracyM };
};

describe("virtuella kontroller: inom radien", () => {
  it("radien i meter och noggrannheten ≤ 20 m", () => {
    expect(withinRadius(controls[1]!, { x: 12.4, y: 0, accuracyM: 5 }, 25, M)).toBe(true);
    expect(withinRadius(controls[1]!, { x: 12.6, y: 0, accuracyM: 5 }, 25, M)).toBe(false);
    expect(withinRadius(controls[1]!, { x: 10, y: 0, accuracyM: 21 }, 25, M)).toBe(false);
    expect(controlsInReach(ordered, { x: 0.5, y: 0, accuracyM: 5 }, 25, M)).toEqual([]);
    expect(controlsInReach(ordered, { x: 19, y: 0, accuracyM: 5 }, 25, M).map(item => item.code)).toEqual(["32"]);
  });
});

describe("virtuella kontroller: ordningen", () => {
  it("vanlig bana: fel ordning räknas inte, målet först när alla är tagna, inget efter målet", () => {
    const judged = judgePunches(ordered, [punch("b", 100), punch("a", 200), punch("f", 250), punch("b", 300), punch("c", 400), punch("f", 500),
      punch("a", 600)], 0, 25, M);
    expect(judged.map(item => [item.code, item.fromStartMs])).toEqual([["31", 200], ["32", 300], ["33", 400], ["M", 500]]);
    expect(virtualResult(judged, ordered)).toEqual({ controls: 3, points: 60, finished: true, lastAt: 500 });
  });

  it("poängbana: valfri ordning, varje kontroll en gång; position utanför radien räknas inte", () => {
    const judged = judgePunches(score, [punch("c", 100), punch("a", 200), punch("c", 250), punch("b", 300, 3)], 0, 25, M);
    expect(judged.map(item => item.code)).toEqual(["33", "31"]);
    expect(virtualResult(judged, score)).toMatchObject({ controls: 2, points: 50, finished: false });
  });
});

describe("virtuella kontroller: duellen", () => {
  it("först full poäng, tvåan 30 % avrundat, sedan 0; lagkamrater delar först", () => {
    const { teams, controls: perControl } = duelScores([
      { runner: "Sara", team: "Röda", punches: [{ control: "a", at: 100 }, { control: "b", at: 400 }] },
      { runner: "Kim", team: "Röda", punches: [{ control: "b", at: 300 }] },
      { runner: "Bo", team: "Blå", punches: [{ control: "a", at: 200 }, { control: "b", at: 350 }] },
      { runner: "Ali", team: "Gul", punches: [{ control: "a", at: 300 }] }
    ], control => control === "a" ? 25 : 10);
    expect(teams).toEqual({ Röda: 25 + 10, Blå: 8 + 3, Gul: 0 });
    expect(perControl.filter(item => item.control === "b").map(item => [item.team, item.runner, item.points])).toEqual([["Röda", "Kim", 10], ["Blå", "Bo", 3]]);
  });

  it("ledarens poäng per kod", () => {
    expect(parseControlPoints("31=20, 32: 15")).toEqual({ 31: 20, 32: 15 });
    expect(parseControlPoints("31")).toBeUndefined();
    expect(duelPoints({ 31: 20 }, "31")).toBe(20);
    expect(duelPoints({ 31: 20 }, "32")).toBe(10);
  });
});
