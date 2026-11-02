import { describe, expect, it } from "vitest";
import { BUILT_IN_PRINT_PROFILES, parsePrintProfile, type PrintProfile } from "@o-tid/course-setting";
import type { ColorUsage, MapColor } from "@o-tid/map-file";
import {
  afterViews, approvalEdits, approvedProfile, compareFrame, cssOfCmyk, decide, isolateAdjust, layerStack, previewProfile, proposalState, RenderQueue, thumbnailView
} from "./course-setting-bl-proposal";
import { pdfPreflight } from "./course-setting-print-jobs";

const forest = BUILT_IN_PRINT_PROFILES.find(item => item.id === "bl-forest-2026-11-02")!;
/** Kartfärg med rank (0 = överst) och CMYK i procent. */
const color = (id: number, name: string, rank: number, cmyk: [number, number, number, number]): MapColor =>
  ({ id, name, rank, cmyk: { c: cmyk[0] / 100, m: cmyk[1] / 100, y: cmyk[2] / 100, k: cmyk[3] / 100 }, rgb: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 1 });
const used = (codes: string[], kinds: ColorUsage["kinds"]): ColorUsage =>
  ({ objects: 4, kinds, codes, mains: codes.map(code => Number.parseInt(code, 10)), sample: { x: 10, y: 20 } });

const colors = [
  color(15, "Brun 100%", 0, [20, 70, 100, 0]), color(2, "Svart", 1, [0, 0, 0, 100]), color(16, "Blå 100%", 2, [95, 30, 0, 0]),
  color(18, "Blå 50%", 3, [47.5, 19.5, 0, 0]), color(27, "Grön 50%", 4, [40, 0, 60, 0]), color(32, "Gul 100%", 5, [0, 25, 95, 0]),
  color(1, "Alla färgseparationer", 6, [100, 100, 100, 100])
];
const usage = new Map<number, ColorUsage>([[15, used(["101", "102"], ["LINE"])], [2, used(["201", "505"], ["POINT", "LINE"])], [16, used(["301.1", "304"], ["AREA", "LINE"])],
  [18, used(["302"], ["AREA"])], [27, used(["408"], ["AREA"])], [32, used(["401"], ["AREA"])]]);

describe("BL-förslaget i förhandsvisningen", () => {
  it("rader i kartans ordning med säkerhet, färgrutor före (filens skärmfärg) och efter (BL via SWOP); oanvända för sig", () => {
    const state = proposalState(forest, colors, usage)!;
    expect(state.rows.map(row => row.proposal.color.name)).toEqual(["Brun 100%", "Svart", "Blå 100%", "Blå 50%", "Grön 50%", "Gul 100%"]);
    expect(state.unused.map(row => row.proposal.color.name)).toEqual(["Alla färgseparationer"]);
    expect(state.counts).toMatchObject({ AMBIGUOUS: 1, CONFIRM: 1, decided: 0, pending: 6 });
    const brown = state.rows[0]!;
    expect(brown).toMatchObject({ status: "PENDING", row: { id: "brown-contours" }, before: "rgb(128, 128, 128)" });
    expect(brown.after).toBe(cssOfCmyk({ c: 0, m: 75, y: 100, k: 33 }));
    expect(brown.after).not.toBe(brown.before);
    expect(proposalState(BUILT_IN_PRINT_PROFILES[0]!, colors, usage)).toBeUndefined();
  });

  it("godta alla säkra, godta, behåll filens och välj BL-rad; kopian sparas med id, källa och besluten", () => {
    let profile: PrintProfile = forest;
    let state = proposalState(profile, colors, usage)!;
    let decisions = decide(state, profile.colorDecisions, { kind: "ACCEPT_SAFE" });
    expect(decisions.map(item => item.name).sort()).toEqual(["Blå 50%", "Brun 100%", "Gul 100%", "Svart"]);
    decisions = decide(state, decisions, { kind: "CHOOSE", ocadId: 16, row: "blue-area" });
    decisions = decide(state, decisions, { kind: "KEEP", ocadId: 27 });
    expect(() => decide(state, decisions, { kind: "CHOOSE", ocadId: 27, row: "brown-30" })).toThrow(/inga värden/);
    profile = approvedProfile(profile, decisions, BUILT_IN_PRINT_PROFILES);
    expect(profile).toMatchObject({ id: "bl-forest-2026-11-02-godkand", basedOn: "bl-forest-2026-11-02", sourceUrl: forest.sourceUrl, reference: forest.reference });
    expect(parsePrintProfile(JSON.stringify(profile))).toEqual(profile);
    expect(approvalEdits(profile)).toEqual([{ type: "PUT_PRINT_PROFILE", profile }, { type: "SET_EVENT", changes: { printProfileId: profile.id } }]);
    // Kopian byggs på: samma id och namn nästa gång.
    expect(approvedProfile(profile, [], BUILT_IN_PRINT_PROFILES)).toMatchObject({ id: profile.id, name: profile.name });
    state = proposalState(profile, colors, usage)!;
    expect(state.rows.find(row => row.proposal.color.ocadId === 16)).toMatchObject({ status: "ACCEPTED", chosen: true, row: { id: "blue-area" } });
    expect(state.rows.find(row => row.proposal.color.ocadId === 27)).toMatchObject({ status: "KEPT", row: null });
    expect(state.counts).toMatchObject({ decided: 6, pending: 0 });
    // Förhandskontrollen före PDF:en: inga obekräftade kvar, passmärket oanvänt.
    const report = pdfPreflight(profile, colors, new Set(), usage);
    expect(report.unconfirmed).toEqual([]);
    expect(report.canPrint).toBe(true);
    expect(pdfPreflight(forest, colors, new Set(), usage).unconfirmed).toHaveLength(6);
  });

  it("lagren: brunt, svart och blå linje över banan, blå 50 % och grönt under; efter-bilden i två delar", () => {
    const state = proposalState(forest, colors, usage)!;
    const profile: PrintProfile = { ...forest, colorDecisions: decide(state, [], { kind: "CHOOSE", ocadId: 16, row: "blue-line-point" }) };
    const fresh = proposalState(profile, colors, usage)!;
    const stack = layerStack(profile, fresh);
    expect(stack.onTop).toBe(false);
    expect(stack.over.map(layer => layer.name)).toEqual(["Brun 100%", "Svart", "Blå 100%"]);
    expect(stack.under.map(layer => layer.name)).toEqual(["Blå 50%", "Grön 50%", "Gul 100%"]);
    expect(stack.course.css).toBe(cssOfCmyk({ c: 35, m: 95, y: 0, k: 0 }));
    const views = afterViews(profile, fresh, colors);
    expect([...(views.over ?? [])].sort((a, b) => a - b)).toEqual([2, 15, 16]);
    expect(views.under).toContain(18);
    // Förslaget visas i efter-bilden även när det inte är godkänt; PDF:en använder bara besluten.
    expect(views.adjust[32]!.cmyk).toEqual({ c: 0, m: 0.27, y: 0.94, k: 0 });
    expect(previewProfile(profile, fresh).colorDecisions!.length).toBeGreaterThan(profile.colorDecisions!.length);
    expect(layerStack({ ...profile, courseLayer: "TOP" }, fresh).onTop).toBe(true);
  });

  it("kartbiten: bara färgen tänd och ett utsnitt kring stället där den syns", () => {
    const adjust = isolateAdjust(colors, 15);
    expect(adjust[15]).toEqual({});
    expect(adjust[2]).toEqual({ lighten: 0.88 });
    expect(thumbnailView({ x: 10, y: 20 }, 36, 144)).toEqual({ width: 144, height: 144, pxPerMm: 4, origin: { x: -8, y: 38 } });
  });

  it("jämförelsens utsnitt: banan med marginal inom ramens kartyta, i papperets mm", () => {
    const frame = { clip: { x: 10, y: 10, width: 190, height: 277 }, transform: { scale: 1, translateX: 10, translateY: 287 },
      mapArea: { minX: 0, minY: 0, maxX: 190, maxY: 277 },
      figures: [{ kind: "circle" as const, role: "CONTROL" as const, color: "COURSE" as const, center: { x: 50, y: 60 }, diameter: 6, lineWidth: 0.35 },
        { kind: "polyline" as const, role: "LEG" as const, color: "COURSE" as const, points: [{ x: 50, y: 60 }, { x: 80, y: 100 }], width: 0.35 }] };
    const cut = compareFrame(frame, 10);
    expect(cut.mapArea).toEqual({ minX: 37, minY: 47, maxX: 90, maxY: 110 });
    expect(cut.clip).toEqual({ x: 47, y: 177, width: 53, height: 63 });
    const empty = { ...frame, figures: [] };
    expect(compareFrame(empty)).toBe(empty);
  });

  it("kön ritar en bild i taget, högst prioritet först", async () => {
    const queue = new RenderQueue();
    const order: string[] = [];
    let release!: () => void;
    const first = queue.add(() => new Promise<string>(resolve => { release = () => { order.push("ark 1"); resolve("a"); }; }), 0);
    const sheet = queue.add(async () => { order.push("ark 2"); return "b"; }, 0);
    const thumb = queue.add(async () => { order.push("kartbit"); return "c"; }, 2);
    release();
    expect(await Promise.all([first, sheet, thumb])).toEqual(["a", "b", "c"]);
    expect(order).toEqual(["ark 1", "kartbit", "ark 2"]);
  });
});
