import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { colorUsage, readMapFile, type ColorUsage } from "@o-tid/map-file";
import {
  acceptSafe, BL_FOREST_2026_11_02, BL_SPRINT_2026_11_02, BUILT_IN_PRINT_PROFILES, colorComponents, colorPreflight, coursePlacement, decisionFor,
  latestPrintProfileId, mapColorAdjust, parsePrintProfile, PDF_PRINT_CAPABILITIES, pendingProposals, proposeColorMatches, referencePrintProfile,
  sourceMapColors, SUPERSEDED_PRINT_PROFILES, withDecision, type MatchColor, type PrintProfile, type ReferenceTable
} from "../src";

const forest = BUILT_IN_PRINT_PROFILES.find(profile => profile.id === "bl-forest-2026-11-02")!;
const sprint = BUILT_IN_PRINT_PROFILES.find(profile => profile.id === "bl-sprint-2026-11-02")!;
const use = (codes: string[], kinds: ColorUsage["kinds"], objects = 10): ColorUsage =>
  ({ objects, kinds, codes, mains: [...new Set(codes.map(code => Number.parseInt(code, 10)))].sort((a, b) => a - b), sample: { x: 0, y: 0 } });
let order = 0;
/** En kartfärg; `drawOrder` räknas upp i den ordning färgerna skapas (underst först). */
const color = (ocadId: number, name: string, cmyk: [number, number, number, number], usage?: ColorUsage): MatchColor =>
  ({ ocadId, name, cmyk: { c: cmyk[0], m: cmyk[1], y: cmyk[2], k: cmyk[3] }, overprint: false, drawOrder: order++, ...(usage ? { usage } : {}) });

/** En syntetisk skogskarta i OCAD:s ordning (underst först): gult, grönt, blått, brunt, svart. */
function forestMap(): MatchColor[] {
  order = 0;
  return [
    color(32, "Gul 100%", [0, 25, 95, 0], use(["401", "402"], ["AREA"])),
    color(28, "Grön 20%", [20, 0, 30, 0], use(["406"], ["AREA"])),
    color(27, "Grön 50%", [40, 0, 60, 0], use(["408"], ["AREA"])),
    color(25, "Grön 100% + 50% Svart", [80, 0, 100, 40], use(["411.2"], ["AREA"])),
    color(18, "Blå 50%", [47.5, 19.5, 0, 0], use(["302"], ["AREA"])),
    color(16, "Blå 100%", [95, 30, 0, 0], use(["301.1", "304", "305"], ["AREA", "LINE"])),
    color(15, "Brun 100%", [20, 70, 100, 0], use(["101", "102", "103"], ["LINE"])),
    color(2, "Svart", [0, 0, 0, 100], use(["201", "505", "509"], ["LINE", "POINT"])),
    color(1, "Alla färgseparationer", [100, 100, 100, 100]),
    color(60, "Ram", [0, 0, 0, 60], use(["999"], ["LINE"]))
  ];
}

describe("BL-tabellerna och versionerna (ADR-0183 beslut 7)", () => {
  it("har källa, datum och BL:s tal rad för rad; tomma celler är tolkade och märkta", () => {
    expect(forest).toMatchObject({ name: "BL skog", sourceUrl: "https://www.bl-idrottsservice.se/farginstallningar-kartnormen/", sourceDate: "2026-11-02",
      course: { cmyk: { c: 35, m: 95, y: 0, k: 0 }, process: true, overprint: false }, courseLayer: "REFERENCE", processColors: true });
    expect(sprint).toMatchObject({ sourceUrl: "https://www.bl-idrottsservice.se/farginstallning-sprintnormen/", course: { cmyk: { c: 35, m: 100, y: 0, k: 0 } } });
    expect(BL_SPRINT_2026_11_02.effectiveFrom).toBe("2025-05-01");
    expect(BL_FOREST_2026_11_02.rows).toHaveLength(27);
    expect(BL_SPRINT_2026_11_02.rows).toHaveLength(30);
    const row = (table: ReferenceTable, id: string) => table.rows.find(item => item.id === id)!;
    expect(row(BL_FOREST_2026_11_02, "violet-opaque")).toMatchObject({ cmyk: { c: 35, m: 95, y: 0, k: 0 }, emptyCells: ["k"], courseNumber: 50 });
    expect(row(BL_FOREST_2026_11_02, "brown-30").cmyk).toBeNull();
    expect(row(BL_FOREST_2026_11_02, "yellow-green").cmyk).toEqual({ c: 33, m: 28, y: 85, k: 0 });
    expect(row(BL_FOREST_2026_11_02, "all-colors").role).toBe("REGISTRATION");
    expect(row(BL_SPRINT_2026_11_02, "yellow-green").cmyk).toEqual({ c: 34, m: 30, y: 85, k: 0 });
    expect(row(BL_SPRINT_2026_11_02, "black-20-crossing").cmyk).toEqual({ c: 0, m: 0, y: 0, k: 15 });
    expect(row(BL_SPRINT_2026_11_02, "green-point").emptyCells).toEqual(["k"]);
    // Ordningen: banans violett under brunt, svart och 100 % blå; blå 70/50 under violetten.
    expect(BL_FOREST_2026_11_02).toMatchObject({ courseRow: "violet-transparent", courseBelow: ["brown-contours", "black", "blue-line-point"], courseAbove: ["blue-70", "blue-50"] });
    expect(BL_FOREST_2026_11_02.notes.every(note => note.url.startsWith("https://www.bl-idrottsservice.se/"))).toBe(true);
    expect(parsePrintProfile(JSON.stringify(forest))).toEqual(forest);
  });

  it("en ny tabell ger en ny profil; de gamla versionerna är orörda och pekar på den nya", () => {
    // Den första BL-profilen (ur macpurplepen, 2026-08-27) får aldrig ändras: tävlingar kan ha valt den.
    const hash = (id: string) => createHash("sha256").update(JSON.stringify(BUILT_IN_PRINT_PROFILES.find(profile => profile.id === id))).digest("hex").slice(0, 16);
    expect(hash("bl-forest-2026-08-27")).toBe("a4888ff5133f0dfc");
    expect(hash("bl-sprint-2025-05-01")).toBe("12c50774da76ec48");
    expect(SUPERSEDED_PRINT_PROFILES["bl-sprint-2025-05-01"]).toBe(sprint.id);
    expect(latestPrintProfileId("bl-forest-2026-08-27")).toBe(forest.id);
    expect(latestPrintProfileId(forest.id)).toBe(forest.id);
    const changed: ReferenceTable = { ...BL_FOREST_2026_11_02, version: "2027-03-01", sourceDate: "2027-03-01",
      rows: BL_FOREST_2026_11_02.rows.map(item => item.id === "violet-transparent" ? { ...item, cmyk: { c: 30, m: 100, y: 0, k: 0 } } : item) };
    const next = referencePrintProfile(changed, "BL skog");
    expect(next.id).toBe("bl-forest-2027-03-01");
    expect(next.course.cmyk).toEqual({ c: 30, m: 100, y: 0, k: 0 });
    expect(forest.course.cmyk).toEqual({ c: 35, m: 95, y: 0, k: 0 });
    // Tävlingens godkända kopia behåller sin tabell även när en ny finns.
    const copy: PrintProfile = { ...forest, id: "egen", basedOn: forest.id, colorDecisions: [{ ocadId: 7, name: "Grönt", cmyk: { c: 80, m: 0, y: 100, k: 0 }, row: "green-100" }] };
    expect(mapColorAdjust(copy, [{ id: 7, name: "Grönt" }])[7]!.cmyk).toEqual({ c: 0.76, m: 0, y: 0.91, k: 0 });
  });

  it("avvisar beslut som pekar på rader som inte finns och lager utan tabell", () => {
    expect(() => parsePrintProfile(JSON.stringify({ ...forest, colorDecisions: [{ ocadId: 1, name: "x", cmyk: { c: 0, m: 0, y: 0, k: 0 }, row: "finns-inte" }] })))
      .toThrow(/rad som inte finns/);
    const plain = { ...forest, reference: undefined };
    expect(() => parsePrintProfile(JSON.stringify(plain))).toThrow(/kräver en tabell/);
  });
});

describe("förslaget: kartans färger mot BL:s rader", () => {
  it("läser färgord och andel ur namnen", () => {
    expect(colorComponents("Grön 100% + 50% Svart - Ytobjekt")).toEqual([{ hue: "green", percent: 100 }, { hue: "black", percent: 50 }]);
    expect(colorComponents("Gul 100%/grön 50%")).toEqual([{ hue: "yellow", percent: 100 }, { hue: "green", percent: 50 }]);
    expect(colorComponents("Brun för höjdkurvor mm")).toEqual([{ hue: "brown", percent: 100 }]);
    expect(colorComponents("Undre brun 30")).toEqual([{ hue: "brown", percent: 30 }]);
  });

  it("säker, behöver bekräftas, tvetydig och oanvänd, med skäl", () => {
    const proposals = proposeColorMatches(BL_FOREST_2026_11_02, forestMap());
    const by = (name: string) => proposals.find(item => item.color.name === name)!;
    expect(by("Svart")).toMatchObject({ row: "black", confidence: "SAFE" });
    expect(by("Brun 100%")).toMatchObject({ row: "brown-contours", confidence: "SAFE" });
    expect(by("Brun 100%").reasons.join(" ")).toMatch(/Används för 101, 102, 103/);
    expect(by("Gul 100%")).toMatchObject({ row: "yellow-100", confidence: "SAFE" });
    expect(by("Blå 50%")).toMatchObject({ row: "blue-50", confidence: "SAFE" });
    // Namnet säger 50 %, BL har 60 % för 408: förslaget gäller men måste bekräftas.
    expect(by("Grön 50%")).toMatchObject({ row: "green-60", confidence: "CONFIRM" });
    expect(by("Grön 50%").reasons.join(" ")).toMatch(/grön 50 %, BL:s rad grön 60 %/);
    // Blå 100 % både som yta och linje: två rader som ger olika sida av banan.
    expect(by("Blå 100%").confidence).toBe("AMBIGUOUS");
    expect(by("Blå 100%").candidates.slice(0, 2).sort()).toEqual(["blue-area", "blue-line-point"]);
    expect(by("Blå 100%").reasons.join(" ")).toMatch(/samma färg men på olika sidor om banan: ”Blå/);
    // Grön + svart finns inte i skogstabellen: behåll filens, men bekräfta.
    expect(by("Grön 100% + 50% Svart")).toMatchObject({ row: null, confidence: "CONFIRM" });
    expect(by("Alla färgseparationer")).toMatchObject({ row: "all-colors", unused: true });
    expect(by("Ram").row).toBeNull();
    // Kartans ordning, överst först (som OCAD:s färgtabell).
    expect(proposals[0]!.color.name).toBe("Ram");
  });

  it("godta alla säkra, ett eget val och beslut som inte längre gäller", () => {
    const colors = forestMap();
    const proposals = proposeColorMatches(BL_FOREST_2026_11_02, colors);
    let decisions = acceptSafe([], proposals);
    expect(decisions.map(item => item.name).sort()).toEqual(["Blå 50%", "Brun 100%", "Grön 20%", "Gul 100%", "Svart"].filter(name =>
      proposals.find(item => item.color.name === name)!.confidence === "SAFE").sort());
    expect(pendingProposals(proposals, decisions).map(item => item.color.name)).toContain("Blå 100%");
    decisions = withDecision(decisions, colors.find(item => item.name === "Blå 100%")!, "blue-area");
    decisions = withDecision(decisions, colors.find(item => item.name === "Ram")!, null);
    expect(decisionFor(decisions, { ocadId: 16, name: "Blå 100%" })?.row).toBe("blue-area");
    // Samma id men nytt namn (ny kartfil): beslutet gäller inte.
    expect(decisionFor(decisions, { ocadId: 16, name: "Blå" })).toBeUndefined();
    const profile: PrintProfile = { ...forest, colorDecisions: decisions };
    const adjust = mapColorAdjust(profile, colors.map(item => ({ id: item.ocadId, name: item.name })));
    expect(adjust[16]!.cmyk).toEqual({ c: 1, m: 0, y: 0, k: 0 });
    expect(adjust[15]!.cmyk).toEqual({ c: 0, m: 0.75, y: 1, k: 0.33 });
    expect(adjust[60]).toBeUndefined();
    expect(mapColorAdjust(profile, [{ id: 16, name: "Blå" }])).toEqual({});
  });

  it("ordningen: banan under brunt, svart och 100 % blå linje, över blå 70/50; avvikelser blir varningar", () => {
    order = 0;
    const colors = [
      color(1, "Blå 50%", [50, 0, 0, 0], use(["302"], ["AREA"])),
      color(2, "Blå 70%", [70, 0, 0, 0], use(["301"], ["AREA"])),
      color(3, "Brun för höjdkurvor mm", [0, 75, 100, 33], use(["101"], ["LINE"])),
      color(4, "Svart", [0, 0, 0, 100], use(["201"], ["POINT"])),
      color(5, "Grön 100%", [76, 0, 91, 0], use(["417"], ["POINT"]))
    ];
    const decisions = acceptSafe([], proposeColorMatches(BL_FOREST_2026_11_02, colors));
    const placement = coursePlacement(BL_FOREST_2026_11_02, colors, item => decisionFor(decisions, item)?.row);
    expect(placement.position).toBe(2);
    expect([...placement.above].sort()).toEqual([3, 4, 5]);
    // Grön 100 % ligger över banan i kartan men under i BL:s tabell; den föreslås inte som säker.
    expect(proposeColorMatches(BL_FOREST_2026_11_02, colors).find(item => item.color.ocadId === 5)!.confidence).toBe("CONFIRM");
    const withGreen = withDecision(decisions, colors[4]!, "green-100");
    const report = colorPreflight({ ...forest, colorDecisions: withGreen }, colors, PDF_PRINT_CAPABILITIES);
    expect(report.findings.find(finding => finding.rule === "order" && finding.text.includes("Grön 100%"))?.severity).toBe("INFO");
    // Brunt under blå 70 %: uttrycklig regel i källan, alltså varning.
    order = 0;
    const wrong = [colors[2]!, colors[0]!, colors[1]!].map(item => ({ ...item, drawOrder: order++ }));
    const wrongReport = colorPreflight({ ...forest, colorDecisions: acceptSafe([], proposeColorMatches(BL_FOREST_2026_11_02, wrong)).concat(
      withDecision([], wrong[0]!, "brown-contours")) }, wrong, PDF_PRINT_CAPABILITIES);
    expect(wrongReport.findings.some(finding => finding.severity === "WARNING" && /Brun för höjdkurvor mm.*ska ligga över banan/.test(finding.text))).toBe(true);
  });

  it("förhandskontrollen: obekräftade färger, passmärket och banans violett", () => {
    const colors = forestMap();
    const none = colorPreflight(forest, colors, PDF_PRINT_CAPABILITIES);
    expect(none.findings[0]?.severity).toBe("WARNING");
    expect(none.findings[0]?.text).toMatch(/inte godkänt/);
    expect(none.unconfirmed).toContain("Svart");
    expect(none.unconfirmed).not.toContain("Alla färgseparationer");
    expect(none.findings.find(finding => finding.rule === "registration")?.severity).toBe("INFO");
    const proposals = proposeColorMatches(BL_FOREST_2026_11_02, colors);
    const partly = colorPreflight({ ...forest, colorDecisions: acceptSafe([], proposals) }, colors, PDF_PRINT_CAPABILITIES);
    expect(partly.findings.some(finding => finding.severity === "WARNING" && /inte bekräftade/.test(finding.text) && finding.text.includes("Blå 100%"))).toBe(true);
    expect(partly.canPrint).toBe(true);
    order = 0;
    const used = [color(1, "Alla färger", [100, 100, 100, 100], use(["999"], ["LINE"], 3))];
    expect(colorPreflight(forest, used, PDF_PRINT_CAPABILITIES)).toMatchObject({ canPrint: false });
    const purple = colorPreflight({ ...forest, course: { ...forest.course, cmyk: { c: 20, m: 100, y: 0, k: 0 } } }, colors, PDF_PRINT_CAPABILITIES);
    expect(purple.findings.some(finding => finding.rule === "course" && /35\/95\/0\/0/.test(finding.text))).toBe(true);
  });
});

const realMap = process.env.OTID_REAL_MAP;
describe.skipIf(!realMap || !existsSync(realMap))("ägarens karta (OTID_REAL_MAP, t.ex. Högdalen)", () => {
  it("förslaget för BL skog och BL sprint: de flesta säkra, banan under brunt", () => {
    const map = readMapFile(new Uint8Array(readFileSync(realMap as string)), realMap as string);
    const colors = sourceMapColors(map.colors, colorUsage(map));
    for (const table of [BL_FOREST_2026_11_02, BL_SPRINT_2026_11_02]) {
      const proposals = proposeColorMatches(table, colors);
      const counts = { SAFE: 0, CONFIRM: 0, AMBIGUOUS: 0, UNUSED: 0 };
      for (const item of proposals) counts[item.unused ? "UNUSED" : item.confidence] += 1;
      console.info(`${table.family}: ${JSON.stringify(counts)}`);
      expect(counts.SAFE).toBeGreaterThan(5);
      const decisions = acceptSafe([], proposals);
      const placement = coursePlacement(table, colors, item => decisionFor(decisions, item)?.row);
      expect(placement.position).not.toBeNull();
      const brown = proposals.find(item => item.color.usage?.mains.includes(101) && item.row !== null);
      if (brown) expect(placement.above.has(brown.color.ocadId)).toBe(true);
      // Vita färger utan tydlig sida: samma färg, och skälet säger att skillnaden är sidan av banan.
      for (const item of proposals.filter(entry => entry.confidence === "AMBIGUOUS" && entry.row === "white")) {
        expect(item.reasons.join(" ")).toMatch(/samma färg men på olika sidor om banan/);
      }
    }
  });
});
