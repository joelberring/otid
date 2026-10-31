import { describe, expect, it } from "vitest";
import type { AdminRouteChoice, ControlMapResponse } from "@o-tid/contracts";
import type { LegAnalysis } from "@o-tid/route-choice";
import {
  calibrationSamples, corridorPath, courseTotal, courseWarnings, legKeys, legRows, mmToPixel, plannedLegs, publishableLegs, routeChoiceOptions,
  simplifyLine, warningText
} from "./route-choice-view";

/** Steg 60: vägvalsvyn med falska svar från motorn (motorn byggs separat i `@o-tid/route-choice`). */
const COURSE = "10000000-0000-4000-8000-000000000001";
const RACE = "10000000-0000-4000-8000-000000000002";
const render = { pxPerMm: 8, originX: -2, originY: 102 };

const controlMap = { courses: [
  { courseId: COURSE, name: "Lång", classNames: ["H21"], start: null, finish: null, forking: null,
    variants: [{ code: null, controlCodes: [31, 32, 33], entryCount: 3 }] },
  { courseId: "10000000-0000-4000-8000-000000000003", name: "Gafflad", classNames: [], start: null, finish: null, forking: null,
    variants: [{ code: "AC", controlCodes: [41], entryCount: 1 }, { code: "BD", controlCodes: [42], entryCount: 2 }] }
] } as unknown as ControlMapResponse;

const state: AdminRouteChoice = { formatVersion: 1, raceId: RACE, settings: { version: 1 },
  mapFile: { sha256: "a".repeat(64), scale: 10_000, render, georeference: null, image: { width: 992, height: 832 }, placement: "PAPER", mismatch: false },
  controls: [{ code: 31, at: { x: 15, y: 42 } }, { code: 32, at: { x: 42, y: 61 } }, { code: 33, at: null }],
  courses: [{ courseId: COURSE, start: { x: 4, y: 8 }, finish: { x: 12, y: 4 }, routeRunners: 0 }], published: [], publishedMapSha256: null };

const line = (meters: number, seconds: number, climb = 5) => ({ points: [{ x: 4, y: 8 }, { x: 10, y: 30 }, { x: 15, y: 42 }], meters, climbMeters: climb, seconds });
function analysis(key: string, overrides: Partial<LegAnalysis> = {}): LegAnalysis {
  return { key, straightMeters: 364, best: line(420, 151), alternatives: [], verdict: "NO_CHOICE", warnings: [], milliseconds: 12, ...overrides };
}

describe("vägvalsvyn", () => {
  it("ger en rad per bana och variant och sträcknycklarna som sträcktidstabellen", () => {
    expect(routeChoiceOptions(controlMap.courses).map(option => [option.id.slice(-3), option.label])).toEqual([
      ["001", "Lång"], [":AC", "Gafflad, variant AC"], [":BD", "Gafflad, variant BD"]]);
    expect(legKeys([31, 32, 31])).toEqual(["S-31.1", "31.1-32.1", "32.1-31.2", "31.2-F"]);
  });

  it("planerar sträckorna i kartfilens mm med banans andra kontroller; en ände utan läge räknas inte", () => {
    const legs = plannedLegs(routeChoiceOptions(controlMap.courses)[0]!, state);
    expect(legs.map(leg => leg.key)).toEqual(["S-31.1", "31.1-32.1", "32.1-33.1", "33.1-F"]);
    expect(legs[0]!.input).toEqual({ key: "S-31.1", from: { x: 4, y: 8 }, to: { x: 15, y: 42 }, otherControls: [{ code: "32", at: { x: 42, y: 61 } }] });
    expect(legs[1]!.input!.otherControls).toEqual([]);
    expect(legs[2]!.input).toBeUndefined();
    expect(legs[3]!.input).toBeUndefined();
  });

  it("visar tabellen med meter, stigning, tid, antal vägval och bedömningen i klartext", () => {
    const legs = plannedLegs(routeChoiceOptions(controlMap.courses)[0]!, state);
    const analyses = new Map([
      ["S-31.1", analysis("S-31.1", { verdict: "ROUTE_CHOICE", alternatives: [{ ...line(500, 160), timeRatio: 1.06 }, { ...line(610, 170), timeRatio: 1.12 }] })],
      ["31.1-32.1", analysis("31.1-32.1", { verdict: "ABOUT_EQUAL", best: line(12_345, 3_725, 32.4) })]
    ]);
    const rows = legRows(legs, analyses);
    expect(rows[0]).toEqual({ key: "S-31.1", name: "start–31", straight: "364 m", best: "420 m", climb: "5 m", time: "2:31", choices: "3",
      verdict: "Vägvalssträcka", verdictKind: "ROUTE_CHOICE" });
    expect(rows[1]).toMatchObject({ name: "31–32", best: "12,3 km", climb: "32 m", time: "62:05", choices: "1",
      verdict: "Vägvalen är ungefär lika bra" });
    expect(rows[2]).toMatchObject({ name: "32–33", verdictKind: "NO_PLACE" });
    expect(legRows(legs, new Map([["S-31.1", analysis("S-31.1")]]))[0]!.verdict).toBe("Inget vägval");
    // Ännu inte räknad: fågelvägen ur lägena (1 mm = 1 mm här, motorn räknar meter) och "Räknas …".
    expect(legRows(legs, new Map())[0]).toMatchObject({ verdict: "Räknas …", verdictKind: "PENDING" });
    expect(legRows(legs, new Map([["S-31.1", analysis("S-31.1", { best: undefined, verdict: "NO_CHOICE", warnings: [{ kind: "NO_ROUTE" }] })]]))[0])
      .toMatchObject({ best: "–", verdict: "Ingen väg", verdictKind: "NO_ROUTE" });
  });

  it("summerar banan först när alla sträckor har en väg", () => {
    const two = plannedLegs(routeChoiceOptions(controlMap.courses)[0]!, state).slice(0, 2);
    const analyses = new Map([["S-31.1", analysis("S-31.1")], ["31.1-32.1", analysis("31.1-32.1", { straightMeters: 636, best: line(780, 300) })]]);
    expect(courseTotal(two, analyses)).toBe("Hela banan: bästa vägen 1200 m mot fågelvägen 1000 m (20 % längre).");
    expect(courseTotal(two, new Map([["S-31.1", analysis("S-31.1")]]))).toBeUndefined();
  });

  it("skriver varningarna i klartext utan dubbletter", () => {
    expect(warningText("44.1-45.1", { kind: "THROUGH_OTHER_CONTROL", code: "45" })).toBe("Bästa vägen går genom kontroll 45:s ring.");
    expect(warningText("37.1-38.1", { kind: "CONTROL_IN_IMPASSABLE", end: "to" })).toBe("Kontroll 38 ligger i ej passerbar mark.");
    expect(warningText("S-31.1", { kind: "CONTROL_IN_IMPASSABLE", end: "from" })).toBe("Starten ligger i ej passerbar mark.");
    expect(warningText("34.1-35.1", { kind: "NO_ROUTE" })).toBe("Ingen väg hittades mellan 34 och 35.");
    expect(warningText("36.1-F", { kind: "NO_ROUTE" })).toBe("Ingen väg hittades mellan 36 och mål.");
    const legs = plannedLegs(routeChoiceOptions(controlMap.courses)[0]!, state);
    const analyses = new Map([
      ["S-31.1", analysis("S-31.1", { warnings: [{ kind: "CONTROL_IN_IMPASSABLE", end: "to" }] })],
      ["31.1-32.1", analysis("31.1-32.1", { warnings: [{ kind: "CONTROL_IN_IMPASSABLE", end: "from" }, { kind: "THROUGH_OTHER_CONTROL", code: "33" }] })]
    ]);
    expect(courseWarnings(legs, analyses)).toEqual([{ key: "S-31.1", text: "Kontroll 31 ligger i ej passerbar mark." },
      { key: "31.1-32.1", text: "Bästa vägen går genom kontroll 33:s ring." }]);
  });

  it("räknar kartfilens mm till kartbildens pixlar och stråket till rektanglar", () => {
    expect(mmToPixel(render, { x: 42, y: 61 })).toEqual({ x: 352, y: 328 });
    // 3 × 2 celler à 1 mm med nedre vänstra hörnet i (0, 0) mm: första raden (överst) 1 1 0, andra 0 1 1.
    const path = corridorPath(render, { origin: { x: 0, y: 0 }, cellMm: 1, width: 3, height: 2, mask: new Uint8Array([1, 1, 0, 0, 1, 1]) });
    expect(path).toBe("M16 800h16v8h-16zM24 808h16v8h-16z");
  });

  it("förenklar de publicerade linjerna och behåller ändarna", () => {
    const points = Array.from({ length: 101 }, (_value, index) => ({ x: index, y: index % 2 === 0 ? 0 : 0.1 }));
    expect(simplifyLine(points)).toEqual([[0, 0], [100, 0]]);
    expect(simplifyLine([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }])).toEqual([[0, 0], [5, 5], [10, 0]]);
    expect(simplifyLine(Array.from({ length: 50 }, (_value, index) => ({ x: index, y: (index % 2) * 10 })), 0.25, 10).length).toBeLessThanOrEqual(10);
    const legs = plannedLegs(routeChoiceOptions(controlMap.courses)[0]!, state);
    expect(publishableLegs(legs, new Map([["S-31.1", analysis("S-31.1")], ["31.1-32.1", analysis("31.1-32.1", { best: undefined })]])))
      .toEqual([{ key: "S-31.1", points: [[4, 8], [10, 30], [15, 42]] }]);
  });

  it("gör om rutternas delar till kartfilens mm för kalibreringen och hoppar över delar utanför kartan", () => {
    const routes = { formatVersion: 1 as const, raceId: RACE, courseId: COURSE, runners: [{ variantCode: null, legs: [
      { key: "S-31.1", milliseconds: 150_000, points: [[0, 59.1, 18.1], [150_000, 59.2, 18.2]] as [number, number, number][] },
      { key: "31.1-32.1", milliseconds: 90_000, points: [[0, 59.1, 18.1], [90_000, 10, 10]] as [number, number, number][] }] }] };
    const samples = calibrationSamples(routes, (latitude, longitude) => latitude > 50 ? { x: longitude, y: latitude } : undefined);
    expect(samples).toEqual([{ key: "S-31.1", runner: "1", points: [{ x: 18.1, y: 59.1, ms: 0 }, { x: 18.2, y: 59.2, ms: 150_000 }] }]);
  });
});
