/**
 * Nivåstödet (ADR-0212): mätningen och reglerna på små syntetiska kartor (1:10 000, mått i meter i terrängen). Vägvalen
 * ges för hand här; motorn och mätningen tillsammans provas i `packages/route-choice/test/level.test.ts`.
 */
import type { MapObject, MapSymbol, ParsedMap, Point } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import {
  ALL_LEVEL_RULES, applyEdit, assessLevel, carryCourseLevels, checkKey, checkLevel, CONTROL_RULES, controlFeatures, harderThan, judgeControl,
  judgeLeg, LEG_RULES, legFeatures, levelChecks, levelControls, levelDeviation, levelDeviations, levelFromClassNames, levelLegPairs, levelRank,
  prepareLevelMap, suggestedCourseLevel, type ControlLevelFeatures, type LegLevelFeatures
} from "../src";
import { Builder } from "./build";

const SCALE = 10_000;
const m = (x: number, y: number): Point => ({ x: x / 10, y: y / 10 });
const code = (text: string) => ({ text, main: Number(text.split(".")[0]), sub: Number(text.split(".")[1] ?? 0) });
const pointSymbol = (number: string, name: string): MapSymbol => ({ id: number, kind: "POINT", code: code(number), name, hidden: false, elements: [] });
const lineSymbol = (number: string, name: string): MapSymbol => ({ id: number, kind: "LINE", code: code(number), name, hidden: false, strokes: [{ color: 0, width: 0.25 }] });
const areaSymbol = (number: string, name: string): MapSymbol => ({ id: number, kind: "AREA", code: code(number), name, hidden: false, fill: 0, hatches: [] });
const SYMBOLS = [
  areaSymbol("405", "Skog"), areaSymbol("401", "Öppen mark"), lineSymbol("505", "Stig"), lineSymbol("504", "Traktorväg"), lineSymbol("101", "Höjdkurva"),
  lineSymbol("306", "Dike"), pointSymbol("205", "Stor sten"), pointSymbol("204", "Sten"), pointSymbol("109", "Punkthöjd"), pointSymbol("111", "Liten grop")
];

const line = (symbol: string, ...points: [number, number][]): MapObject =>
  ({ kind: "line", symbol, path: points.map(([x, y], i) => ({ type: i === 0 ? "M" : "L", ...m(x, y) })) as never });
const at = (symbol: string, x: number, y: number): MapObject => ({ kind: "point", symbol, at: m(x, y), angle: 0 });
const area = (symbol: string, x0: number, y0: number, x1: number, y1: number): MapObject =>
  ({ kind: "area", symbol, angle: 0, rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y], i) => ({ type: i === 0 ? "M" : "L", ...m(x!, y!) }))] as never });
/** En sluten höjdkurva (en liten höjd) med radien r meter. */
const knoll = (x: number, y: number, r: number): MapObject => line("101", ...Array.from({ length: 13 }, (_, k): [number, number] =>
  [x + r * Math.cos(k * Math.PI / 6), y + r * Math.sin(k * Math.PI / 6)]));

function mapOf(objects: MapObject[]): ParsedMap {
  return { format: "OCD", version: "test", scale: SCALE, georeference: null, warnings: [], bounds: { minX: -300, minY: -300, maxX: 300, maxY: 300 },
    colors: [], symbols: new Map(SYMBOLS.map(symbol => [symbol.id, symbol])), objects: [area("405", -3000, -3000, 3000, 3000), ...objects] };
}

/** Detaljrik kurvbild utan linjer: många små höjder och gropar i ett rutnät kring (cx, cy). */
function detailed(cx: number, cy: number, span: number): MapObject[] {
  const out: MapObject[] = [];
  for (let x = cx - span; x <= cx + span; x += 20) for (let y = cy - span; y <= cy + span; y += 20) {
    out.push((x + y) % 40 === 0 ? knoll(x, y, 8) : at("111", x + 10, y + 5));
  }
  return out;
}

const control = (map: ParsedMap, x: number, y: number, d?: string, f?: string) =>
  controlFeatures(prepareLevelMap(map), { id: "c", at: m(x, y), ...(d ? { d } : {}), ...(f ? { f } : {}) });
const leg = (map: ParsedMap, best: [number, number][], followRatio = 1) =>
  legFeatures(prepareLevelMap(map), { key: "k", from: "a", to: "b", best: best.map(([x, y]) => m(x, y)), followRatio })!;

describe("nivåstödets kontroller", () => {
  const path = line("505", [-1000, 0], [1000, 0]);

  it("en kontroll på stigen är Grön", () => {
    const features = control(mapOf([path]), 300, 3, "5.2");
    expect(features.strongMeters).toBeLessThanOrEqual(5);
    expect(judgeControl(features)).toEqual({ rank: 0, values: {} });
  });

  it("en kontroll 60 m från stigen vid en stor sten är Vit eller Gul, med skälet att den ligger längre bort än Vit tillåter", () => {
    const features = control(mapOf([path, at("205", 300, 60)]), 300, 60, "2.4");
    expect(features.feature.size).toBe("BIG");
    expect(features.handrailMeters).toBe(60);
    const verdict = judgeControl(features);
    expect([1, 2]).toContain(verdict.rank);
    expect(verdict).toMatchObject({ rank: 2, rule: "C_NEAR_HANDRAIL", values: { meters: 60, limit: 50 } });
  });

  it("en sten med höjd 1,5 m i kolumn F är stor; en vanlig sten är tydlig men inte stor", () => {
    expect(control(mapOf([path, at("204", 300, 30)]), 300, 30, "2.4", "1.5").feature.size).toBe("BIG");
    expect(control(mapOf([path, at("204", 300, 30)]), 300, 30, "2.4").feature.size).toBe("MEDIUM");
    // Utan beskrivning: kartans föremål vid centrum.
    expect(control(mapOf([path, at("205", 300, 30)]), 300, 30).feature).toMatchObject({ size: "BIG", source: "MAP", code: "205" });
  });

  it("en kontroll i detaljrik kurvbild långt från linjer är Blå eller Svart", () => {
    const features = control(mapOf([path, ...detailed(400, 600, 200)]), 410, 605, "1.13");
    expect(features.feature.size).toBe("SMALL");
    expect(features.handrailMeters).toBeUndefined();
    expect(features.attackMeters).toBeUndefined();
    expect(judgeControl(features)).toMatchObject({ rank: 5, rule: "C_ATTACK" });
  });

  it("ett litet föremål med en stor angreppspunkt nära är Violett; utan ledstänger men med stora föremål är det tydliga Orange", () => {
    const map = mapOf([path, at("205", 400, 700), at("111", 410, 760)]);
    expect(judgeControl(control(map, 410, 760, "1.13")).rank).toBe(4);
    expect(judgeControl(control(mapOf([path, at("205", 400, 700), at("204", 410, 760)]), 410, 760, "2.4")).rank).toBe(3);
  });

  it("öppen mark är en yta: kanten mot skogen är en ledstång, mitt i en stor gräsyta är den inte det (ägarens synpunkt 2026-11-04)", () => {
    const map = mapOf([area("401", 0, 200, 400, 600)]);
    expect(judgeControl(control(map, 0, 400, "4.1")).rank).toBe(0);
    const inside = control(map, 200, 400, "1.10");
    expect(inside.strongMeters).toBeGreaterThan(150);
    // Sikten hjälper att läsa in sig, men ett litet föremål mitt på en stor gräsyta är inte lätt.
    expect(inside.relocationMeters).toBe(0);
    expect(judgeControl(inside).rank).toBeGreaterThanOrEqual(3);
  });

  it("ett medelstort föremål en bit in från stigen är inte Vit (Vit vill ha stort och tydligt eller på stigen)", () => {
    const stone = control(mapOf([path, at("204", 300, 25)]), 300, 25, "2.4");
    expect(judgeControl(stone)).toMatchObject({ rank: 2, rule: "C_CLEAR_FEATURE" });
    expect(judgeControl(control(mapOf([path, at("205", 300, 25)]), 300, 25, "2.4")).rank).toBe(1);
    // En punkthöjd 30 m från stigen är Orange (SOFT:s exempel), en liten sten likaså.
    expect(judgeControl(control(mapOf([path, at("109", 300, 30)]), 300, 30, "1.10"))).toMatchObject({ rank: 3, rule: "C_SMALL_NEAR" });
    expect(control(mapOf([path, at("204", 300, 30)]), 300, 30, "2.4", "0.8").feature.size).toBe("SMALL");
  });

  it("föreslår närmaste stigkorsning och stora föremål på kartan", () => {
    const features = control(mapOf([path, line("504", [300, -500], [300, 500]), at("205", 360, 120)]), 380, 90, "1.10");
    expect(features.candidates.junction).toEqual(m(300, 0));
    expect(features.candidates.bigFeature).toEqual(m(360, 120));
    expect(features.candidates.handrail).toBeDefined();
  });
});

describe("nivåstödets sträckor", () => {
  const paths = [line("505", [0, 0], [500, 0], [500, 500]), line("505", [0, 0], [0, 500], [500, 500])];

  it("en sträcka längs stigarna är Grön eller Vit", () => {
    const features = leg(mapOf(paths), [[0, 0], [500, 0], [500, 500]]);
    expect(features.strongShare).toBeGreaterThan(0.95);
    expect(features.longestOffMeters).toBe(0);
    expect(judgeLeg(features).rank).toBeLessThanOrEqual(1);
  });

  it("en sträcka där det lönar sig att gena är Gul eller svårare", () => {
    const features = leg(mapOf(paths), [[0, 0], [500, 500]], 1.3);
    expect(features.shortcutGain).toBeCloseTo(0.3);
    expect(features.longestOffMeters).toBeGreaterThan(150);
    const verdict = judgeLeg(features);
    expect(verdict.rank).toBeGreaterThanOrEqual(2);
  });

  it("en kort genväg genom skogen är Gul: reglerna säger att genandet är mer än Vit tillåter", () => {
    const map = mapOf([line("505", [0, 0], [300, 0]), line("505", [300, 80], [600, 80]), line("505", [300, 0], [300, 300], [300, 80])]);
    const verdict = judgeLeg(leg(map, [[0, 0], [300, 0], [300, 80], [600, 80]].map(([x, y]) => [x!, y!]), 1.15));
    expect(verdict).toMatchObject({ rank: 2, rule: "L_NO_SHORTCUT", values: { percent: 15 } });
  });

  it("en lång sträcka genom detaljrik kurvbild utan linjer kräver kurvläsning (Blå eller Svart)", () => {
    const map = mapOf([line("505", [-1000, 0], [1000, 0]), ...detailed(400, 600, 300)]);
    const features = leg(map, [[200, 380], [600, 820]]);
    expect(features.detailMeters).toBeGreaterThan(150);
    expect(judgeLeg(features)).toMatchObject({ rank: 5, rule: "L_CONTOURS" });
  });

  it("ett tätt stignät och flera likvärdiga vägval är svårare än Gul", () => {
    const base: LegLevelFeatures = { key: "k", from: "a", to: "b", meters: 600, strongShare: 0.8, handrailShare: 0.8, longestOffStrongMeters: 40,
      longestOffMeters: 40, decisions: 5, junctions: 3, closeAlternatives: 1, shortcutGain: 0.15, detailMeters: 0 };
    expect(judgeLeg(base).rank).toBe(2);
    expect(judgeLeg({ ...base, closeAlternatives: 2 })).toMatchObject({ rank: 3, rule: "L_ROUTE_CHOICE" });
    expect(judgeLeg({ ...base, junctions: 12 })).toMatchObject({ rank: 3, rule: "L_NETWORK" });
    expect(judgeLeg({ ...base, closeAlternatives: 3, decisions: 20, junctions: 9 })).toMatchObject({ rank: 5, rule: "L_HARD_CHOICE" });
    // Grön har inga vägval.
    expect(judgeLeg({ ...base, strongShare: 1, handrailShare: 1, longestOffStrongMeters: 0, longestOffMeters: 0, decisions: 1, junctions: 1,
      closeAlternatives: 1, shortcutGain: 0 })).toMatchObject({ rank: 1, rule: "L_NO_CHOICE" });
  });

  it("räknar stigkorsningar som vägen passerar, inte en stig i flera delar ände mot ände", () => {
    const joined = mapOf([line("505", [0, 0], [300, 0]), line("505", [300, 0], [600, 0])]);
    expect(leg(joined, [[0, 0], [600, 0]]).junctions).toBe(0);
    const network = mapOf([line("505", [0, 0], [600, 0]), line("505", [200, -100], [200, 100]), line("505", [400, 0], [400, 200])]);
    expect(leg(network, [[0, 0], [600, 0]]).junctions).toBe(2);
    const alternatives = legFeatures(prepareLevelMap(joined), { key: "k", from: "a", to: "b", best: [m(0, 0), m(600, 0)], alternatives: [1.05, 1.08, 1.2] })!;
    expect(alternatives.closeAlternatives).toBe(2);
  });

  it("räknar byten mellan stigar som går åt olika håll, inte en rak stig i flera delar", () => {
    const straight = mapOf([line("505", [0, 0], [300, 0]), line("505", [300, 0], [600, 0])]);
    expect(leg(straight, [[0, 0], [600, 0]]).decisions).toBe(0);
    const turns = mapOf([line("505", [0, 0], [200, 0]), line("505", [200, 0], [200, 200]), line("505", [200, 200], [400, 200])]);
    expect(leg(turns, [[0, 0], [200, 0], [200, 200], [400, 200]]).decisions).toBe(2);
  });
});

describe("nivåstödets regler och tips", () => {
  it("varje regel har en nivå, och reglerna gäller upp till Violett", () => {
    expect(new Set(ALL_LEVEL_RULES).size).toBe(ALL_LEVEL_RULES.length);
    for (const rule of [...CONTROL_RULES, ...LEG_RULES]) expect(rule.through).toBeLessThanOrEqual(4);
  });

  it("tipset mot målnivån är det första kravet som inte uppfylls där; tydligt lättare från Gul", () => {
    const far: ControlLevelFeatures = { control: "c", strongMeters: 80, handrailMeters: 80, feature: { size: "BIG", source: "DESCRIPTION", d: "2.4" },
      attackMeters: 20, relocationMeters: 20, candidates: {} };
    const verdict = judgeControl(far);
    expect(verdict.rank).toBe(2);
    expect(levelDeviation("control", far, verdict.rank, levelRank("GRON"))).toMatchObject({ direction: "HARDER", rule: "C_ON_HANDRAIL" });
    expect(levelDeviation("control", far, verdict.rank, levelRank("VIT"))).toMatchObject({ direction: "HARDER", rule: "C_NEAR_HANDRAIL",
      values: { meters: 80, limit: 50 } });
    expect(levelDeviation("control", far, verdict.rank, levelRank("GUL"))).toBeUndefined();
    expect(levelDeviation("control", far, verdict.rank, levelRank("VIOLETT"))).toMatchObject({ direction: "EASIER", rule: "E_CONTROL_EASY" });
    const along: LegLevelFeatures = { key: "k", from: "a", to: "b", meters: 400, strongShare: 1, handrailShare: 1, longestOffStrongMeters: 0,
      longestOffMeters: 0, decisions: 1, junctions: 1, closeAlternatives: 0, shortcutGain: 0, detailMeters: 0 };
    expect(levelDeviation("leg", along, 0, levelRank("GUL"))).toMatchObject({ direction: "EASIER", rule: "E_LEG_NO_SHORTCUT" });
    expect(levelDeviation("leg", along, 0, levelRank("VIT"))).toBeUndefined();
  });

  it("sammanfattar banan och räknar det som är svårare", () => {
    const item = (rank: number): ControlLevelFeatures => ({ control: String(rank), strongMeters: rank === 0 ? 0 : 80, handrailMeters: rank === 0 ? 0 : 80,
      feature: { size: "BIG", source: "NONE" }, attackMeters: 10, relocationMeters: 10, candidates: {} });
    const assessment = assessLevel([item(0), item(0), item(2), item(2), item(2)], []);
    expect(assessment.low).toBe(2);
    expect(harderThan(assessment, 0)).toEqual({ controls: 3, legs: 0 });
  });
});

describe("målnivån", () => {
  it("föreslås ur klasserna (SOFT 2022)", () => {
    expect(levelFromClassNames(["H10"])).toBe("VIT");
    expect(levelFromClassNames(["D12", "H12"])).toBe("GUL");
    expect(levelFromClassNames(["H14"])).toBe("ORANGE");
    expect(levelFromClassNames(["D16"])).toBe("VIOLETT");
    expect(levelFromClassNames(["H21", "D45"])).toBe("SVART");
    expect(levelFromClassNames(["H70", "D75"])).toBe("BLA");
    expect(levelFromClassNames(["Inskolning"])).toBe("GRON");
    expect(levelFromClassNames(["Mycket lätt"])).toBe("VIT");
    expect(levelFromClassNames(["Lätt"])).toBe("GUL");
    expect(levelFromClassNames(["Medelsvår"])).toBe("ORANGE");
    expect(levelFromClassNames(["Svår 3 km"])).toBe("BLA");
    expect(levelFromClassNames(["Svår 5 km"])).toBe("SVART");
    expect(levelFromClassNames(["Gul lång"])).toBe("GUL");
    expect(levelFromClassNames(["Öppen 1"])).toBeUndefined();
    // Flera nivåer: den svåraste.
    expect(levelFromClassNames(["H12", "H14"])).toBe("ORANGE");
  });

  it("sparas med UPDATE_COURSE, kopieras med banan, följer med en ny .ppen och ger notiser bara på begäran", () => {
    const b = new Builder();
    const course = b.course("Ungdom");
    const start = b.control("START", 0, 0), one = b.control("NORMAL", 10, 0, "31"), finish = b.control("FINISH", 20, 0);
    b.insert(course, start, null); b.insert(course, one); b.insert(course, finish);
    b.edit({ type: "UPDATE_COURSE", course, changes: { secondaryTitle: "H12, D12" } });
    expect(suggestedCourseLevel(b.document.courses[0]!)).toBe("GUL");
    b.edit({ type: "UPDATE_COURSE", course, changes: { level: "GRON" } });
    expect(b.document.courses[0]!.level).toBe("GRON");
    expect(() => applyEdit(b.document, { type: "UPDATE_COURSE", course, changes: { level: "ROSA" as never } })).toThrow();
    expect(levelControls(b.document, course).map(row => row.id)).toEqual([one]);
    expect(levelLegPairs(b.document, course)).toEqual([{ from: start, to: one }, { from: one, to: finish }]);

    const far: ControlLevelFeatures = { control: one, strongMeters: 80, handrailMeters: 80, feature: { size: "BIG", source: "NONE" }, attackMeters: 10,
      relocationMeters: 10, candidates: {} };
    const assessment = assessLevel([far], []);
    expect(levelDeviations(assessment, "GRON")).toHaveLength(1);
    expect(levelChecks(b.document, course, assessment)).toEqual([]);
    b.edit({ type: "SET_EVENT", changes: { levelNotices: true } });
    const checks = levelChecks(b.document, course, assessment);
    expect(checks).toHaveLength(1);
    expect(checkLevel(checks[0]!)).toBe("NOTICE");
    expect(checkKey(checks[0]!)).toBe(`LEVEL_DEVIATION/GRON/${one}`);

    b.edit({ type: "DUPLICATE_COURSE", course, name: "Kopia" });
    expect(b.document.courses.find(row => row.name === "Kopia")!.level).toBe("GRON");
    const imported = { ...b.document, courses: b.document.courses.map(row => ({ ...row, level: undefined })), event: { ...b.document.event, levelNotices: undefined } };
    const carried = carryCourseLevels(b.document, imported);
    expect(carried.courses.map(row => row.level)).toEqual(["GRON", "GRON"]);
    expect(carried.event.levelNotices).toBe(true);
    b.edit({ type: "UPDATE_COURSE", course, changes: { level: null } });
    expect(b.document.courses[0]!.level).toBeUndefined();
  });
});
