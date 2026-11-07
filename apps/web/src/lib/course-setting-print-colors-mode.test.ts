/**
 * ADR-0215: förvalet "Kartans egna färger", läget "Tryck hos BL" med bara de tveksamma färgerna och "Egna inställningar"
 * för en tävling som redan har en egen profil (statusraden).
 */
import { describe, expect, it } from "vitest";
import { BUILT_IN_PRINT_PROFILES, MAP_OWN_PRINT_PROFILE_ID, type PrintProfile } from "@o-tid/course-setting";
import type { ColorUsage, MapColor } from "@o-tid/map-file";
import { printColorsSv } from "../i18n/course-setting-print-colors-sv";
import { approvedProfile, decide, proposalState } from "./course-setting-bl-proposal";
import { blProfileIdFor, colorModeOf, colorSummary, doubtfulRows } from "./course-setting-print-colors-mode";
import { pressLayersFor } from "./course-setting-press-layers";

const profile = (id: string) => BUILT_IN_PRINT_PROFILES.find(item => item.id === id)!;
const mapOwn = profile(MAP_OWN_PRINT_PROFILE_ID);
const forest = profile("bl-forest-2026-11-02");
/** Kartfärg med rank (0 = överst) och CMYK i procent. */
const color = (id: number, name: string, rank: number, cmyk: [number, number, number, number]): MapColor =>
  ({ id, name, rank, cmyk: { c: cmyk[0] / 100, m: cmyk[1] / 100, y: cmyk[2] / 100, k: cmyk[3] / 100 }, rgb: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 1 });
const used = (codes: string[], kinds: ColorUsage["kinds"]): ColorUsage =>
  ({ objects: 4, kinds, codes, mains: codes.map(code => Number.parseInt(code, 10)), sample: { x: 10, y: 20 } });

const colors = [
  color(15, "Brun 100%", 0, [20, 70, 100, 0]), color(2, "Svart", 1, [0, 0, 0, 100]), color(16, "Blå 100%", 2, [95, 30, 0, 0]),
  color(18, "Blå 50%", 3, [47.5, 19.5, 0, 0]), color(27, "Grön 50%", 4, [40, 0, 60, 0]), color(33, "Svart för odlad mark", 5, [0, 0, 0, 100]),
  color(32, "Gul 100%", 6, [0, 25, 95, 0]), color(1, "Alla färgseparationer", 7, [100, 100, 100, 100])
];
const usage = new Map<number, ColorUsage>([[15, used(["101", "102"], ["LINE"])], [2, used(["201", "505"], ["POINT", "LINE"])], [16, used(["301.1", "304"], ["AREA", "LINE"])],
  [18, used(["302"], ["AREA"])], [27, used(["408"], ["AREA"])], [33, used(["412"], ["AREA"])], [32, used(["401"], ["AREA"])]]);

describe("lägena för färgerna (colorModeOf)", () => {
  it("förvalet är kartans egna färger i normens ordning; BL-tabellen utan egna rader är BL; allt annat är egna inställningar", () => {
    expect(BUILT_IN_PRINT_PROFILES[0]).toBe(mapOwn);
    expect(mapOwn).toMatchObject({ courseLayer: "REFERENCE", mapColors: [], course: { cmyk: { c: 20, m: 100, y: 0, k: 0 }, overprint: true } });
    expect(mapOwn.processColors).toBeUndefined();
    expect(colorModeOf(mapOwn)).toBe("MAP_OWN");
    expect(colorModeOf(forest)).toBe("BL");
    expect(colorModeOf(approvedProfile(forest, [], BUILT_IN_PRINT_PROFILES))).toBe("BL");
    // Ett tidigare lagrat val står kvar: som i filen (banan överst), kontorsskrivaren, den äldre BL-versionen och en tabell för hand.
    expect(colorModeOf(profile("as-file"))).toBe("CUSTOM");
    expect(colorModeOf(profile("office"))).toBe("CUSTOM");
    expect(colorModeOf(profile("bl-forest-2026-08-27"))).toBe("CUSTOM");
    const byHand: PrintProfile = { ...approvedProfile(forest, [], BUILT_IN_PRINT_PROFILES), mapColors: [{ match: { ocadIds: [2] }, cmyk: { c: 0, m: 0, y: 0, k: 90 } }] };
    expect(colorModeOf(byHand)).toBe("CUSTOM");
  });

  it("Tryck hos BL väljer den senaste tabellen för kartans norm", () => {
    expect(blProfileIdFor("ISOM")).toBe("bl-forest-2026-11-02");
    expect(blProfileIdFor("ISSPROM")).toBe("bl-sprint-2026-11-02");
  });
});

describe("de tveksamma färgerna hos BL (doubtfulRows)", () => {
  it("bara färger utan säker rad och färger som tabellen lägger på andra sidan banan än normen; besluten står kvar", () => {
    const state = proposalState(forest, colors, usage)!;
    const doubtful = doubtfulRows(state, "ISOM", true);
    const names = (rows: typeof doubtful) => rows.map(item => `${item.row.proposal.color.name}: ${item.reasons.join("+")}`);
    expect(names(doubtful)).toEqual(["Blå 100%: MATCH", "Grön 50%: MATCH", "Svart för odlad mark: MATCH+SIDE"]);
    // De säkra (Brun, Svart, Blå 50 %, Gul) visas inte; den oanvända färgen inte heller.
    const safe = state.rows.filter(row => !doubtful.some(item => item.row === row)).map(row => row.proposal.color.name);
    expect(safe).toEqual(["Brun 100%", "Svart", "Blå 50%", "Gul 100%"]);
    // Banan överst (normens ordning av): ingen sida att missa.
    expect(names(doubtfulRows(state, "ISOM", false))).toEqual(["Blå 100%: MATCH", "Grön 50%: MATCH", "Svart för odlad mark: MATCH"]);
    // En säker färg där man själv valt en rad över banan som normen lägger under: tveksam för sidans skull.
    const chosen = proposalState({ ...forest, colorDecisions: decide(state, [], { kind: "CHOOSE", ocadId: 18, row: "black" }) }, colors, usage)!;
    expect(names(doubtfulRows(chosen, "ISOM", true))).toContain("Blå 50%: SIDE");
    // Ett beslut tar inte bort raden ur listan (den visar "Godkänd" och kan ångras).
    const decided = proposalState({ ...forest, colorDecisions: decide(state, [], { kind: "KEEP", ocadId: 27 }) }, colors, usage)!;
    expect(names(doubtfulRows(decided, "ISOM", true))).toEqual(names(doubtful));
  });
});

describe("statusraden (colorSummary)", () => {
  const line = (chosen: PrintProfile) => {
    const summary = colorSummary(chosen, colors, usage, pressLayersFor(chosen, colors, usage, 10000), "ISOM");
    return summary.mode === "MAP_OWN" ? printColorsSv.statusMapOwn(summary.total, summary.over)
      : summary.mode === "BL" ? printColorsSv.statusBl(summary.family, summary.pending, summary.total) : printColorsSv.statusCustom(summary.name);
  };

  it("kartans egna: färgerna som används och hur många som ligger över banan", () => {
    expect(colorSummary(mapOwn, colors, usage, pressLayersFor(mapOwn, colors, usage, 10000), "ISOM")).toEqual({ mode: "MAP_OWN", total: 7, over: 3 });
    expect(line(mapOwn)).toBe("Färger: kartans egna, i normens ordning (7 färger, 3 över banan)");
    expect(printColorsSv.statusMapOwn(0, 0)).toBe("Färger: kartans egna, i normens ordning");
  });

  it("BL: färgerna kvar att godkänna och de tveksamma", () => {
    expect(colorSummary(forest, colors, usage, pressLayersFor(forest, colors, usage, 10000), "ISOM"))
      .toEqual({ mode: "BL", family: "FOREST", pending: 7, total: 7, doubtful: 3 });
    expect(line(forest)).toBe("Färger: tryck hos BL (skog), 7 färger kvar att godkänna");
    const state = proposalState(forest, colors, usage)!;
    const all = state.rows.reduce((decisions, row) => decide(state, decisions, { kind: "KEEP", ocadId: row.proposal.color.ocadId }), [] as ReturnType<typeof decide>);
    expect(line(approvedProfile(forest, all, BUILT_IN_PRINT_PROFILES))).toBe("Färger: tryck hos BL (skog), alla godkända");
  });

  it("ett tidigare lagrat val: Egna inställningar (Avancerat) med profilens namn", () => {
    expect(line(profile("as-file"))).toBe("Färger: Egna inställningar (Avancerat) – Tryckeri (som i filen)");
    expect(line({ ...mapOwn, id: "egen-1", name: "Vår profil", basedOn: MAP_OWN_PRINT_PROFILE_ID })).toBe("Färger: Egna inställningar (Avancerat) – Vår profil");
  });
});
