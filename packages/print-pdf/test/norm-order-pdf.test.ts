/**
 * ADR-0211 beslut 3: banans undre och övre lila i normens färgordning i PDF:en. En påhittad karta (Mapper, y nedåt i 1/1000
 * mm) med en svart stig och en stor byggnad med svart fyllning genom kontrollen i (50, 50), asfalt (brunt 50 %) under
 * byggnaden och gul mark. Samma karta i 1:10 000 (ISOM) och 1:4 000 (ISSprOM).
 */
import { describe, expect, it } from "vitest";
import {
  applyEdit, BUILT_IN_PRINT_PROFILES, emptyDocument, layoutCoursePage, sheetOfPage, type CourseSettingDocument, type CourseSettingEdit, type PrintProfile
} from "@o-tid/course-setting";
import { readMapFile } from "@o-tid/map-file";
import { colorsOverCourse, pressNormFor, writeSheetsPdf } from "../src";
import { fontFiles, parsePdf } from "./helpers";

const omap = (scale: number) => `<?xml version="1.0" encoding="UTF-8"?>
<map xmlns="http://openorienteering.org/apps/mapper/xml/v2" version="9">
<georeferencing scale="${scale}"><projected_crs id="Local"/></georeferencing>
<colors count="5">
<color priority="0" name="Svart 100%" c="0" m="0" y="0" k="1" opacity="1"><cmyk method="custom"/></color>
<color priority="1" name="Svart 100% byggnad" c="0" m="0" y="0" k="1" opacity="1"><cmyk method="custom"/></color>
<color priority="2" name="Brun 100%" c="0" m="0.56" y="1" k="0.18" opacity="1"><cmyk method="custom"/></color>
<color priority="3" name="Asfalt" c="0" m="0.28" y="0.45" k="0.12" opacity="1"><cmyk method="custom"/></color>
<color priority="4" name="Gul 100%" c="0" m="0.27" y="0.79" k="0" opacity="1"><cmyk method="custom"/></color>
</colors>
<barrier version="6" required="0.6.0">
<symbols count="5" id="norm">
<symbol type="4" id="0" code="401.0" name="Öppen mark"><area_symbol inner_color="4" patterns="0"/></symbol>
<symbol type="4" id="1" code="501.0" name="Hårdgjord yta"><area_symbol inner_color="3" patterns="0"/></symbol>
<symbol type="4" id="2" code="521.0" name="Byggnad"><area_symbol inner_color="1" patterns="0"/></symbol>
<symbol type="2" id="3" code="505.0" name="Stig"><line_symbol color="0" line_width="350" join_style="2" cap_style="0"/></symbol>
<symbol type="2" id="4" code="101.0" name="Höjdkurva"><line_symbol color="2" line_width="140" join_style="2" cap_style="0"/></symbol>
</symbols>
<parts count="1" current="0"><part name="del"><objects count="5">
<object type="1" symbol="0"><coords count="5">0 0;100000 0;100000 -100000;0 -100000;0 0 18;</coords></object>
<object type="1" symbol="1"><coords count="5">30000 -30000;70000 -30000;70000 -70000;30000 -70000;30000 -30000 18;</coords></object>
<object type="1" symbol="2"><coords count="5">45000 -40000;60000 -40000;60000 -60000;45000 -60000;45000 -40000 18;</coords></object>
<object type="1" symbol="3"><coords count="2">50000 0;50000 -100000;</coords></object>
<object type="1" symbol="4"><coords count="2">0 -52000;100000 -52000;</coords></object>
</objects></part></parts>
</barrier>
</map>
`;

/** Tryckeriets profil med banan och kartan i CMYK (så att färgerna går att hitta i innehållet) och banan i normens ordning. */
const profile: PrintProfile = { ...BUILT_IN_PRINT_PROFILES.find(item => item.id === "as-file")!, id: "norm", courseLayer: "REFERENCE", processColors: true,
  course: { cmyk: { c: 20, m: 100, y: 0, k: 0 }, spotName: "Purple", overprint: true, process: true } };

/** En bild (1 × 1 PNG) och ett vitt specialobjekt (white-out) över kontrollen, för ordningen under banan. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function sheetsFor(scale: number, specials = false) {
  let document: CourseSettingDocument = emptyDocument({ title: "Norm", mapScale: scale, sprint: scale <= 5000 });
  const edit = (change: CourseSettingEdit) => { const result = applyEdit(document, change); document = result.document; return result.created ?? ""; };
  const start = edit({ type: "ADD_CONTROL", kind: "START", at: { x: 20, y: 20 } });
  const control = edit({ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 50, y: 50 }, code: "31" });
  const finish = edit({ type: "ADD_CONTROL", kind: "FINISH", at: { x: 80, y: 20 } });
  const course = edit({ type: "ADD_COURSE", name: "A" });
  for (const id of [start, control, finish]) edit({ type: "INSERT_COURSE_CONTROL", course, control: id });
  if (specials) {
    edit({ type: "ADD_SPECIAL", special: { kind: "white-out", points: [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }] } });
    edit({ type: "ADD_SPECIAL", special: { kind: "image", points: [{ x: 25, y: 35 }, { x: 35, y: 25 }], image: { format: "png", data: PNG } } });
  }
  const map = readMapFile(new TextEncoder().encode(omap(scale)), "norm.omap");
  return { map, sheets: layoutCoursePage(document, { course, mapBounds: map.bounds ?? undefined }).map(sheetOfPage) };
}

async function pdfFor(scale: number, chosen: PrintProfile = profile, specials = false) {
  const { map, sheets } = sheetsFor(scale, specials);
  const result = await writeSheetsPdf({ sheets, map, profile: chosen, mode: "PRESS", fonts: fontFiles(), title: "Norm" });
  const pdf = await parsePdf(result.bytes);
  const content = pdf.pages[0]!.content;
  const forms = [...pdf.forms.values()];
  return {
    map, content, under: forms[0]!, over: forms[1]!,
    // Banans lila: ringar och linjer som linje (K), numret som fyllning (k).
    at: { under: content.indexOf("/Fm0 Do"), circle: content.indexOf("0.2 1 0 0 K"), over: content.indexOf("/Fm1 Do"), number: content.lastIndexOf("0.2 1 0 0 k") }
  };
}

describe("normens färgordning i PDF:en (ADR-0211 beslut 3)", () => {
  it("ISOM: banan över asfalten och de stora byggnadernas svarta fyllning, under svarta linjer och brunt 100 %", async () => {
    const pdf = await pdfFor(10000);
    expect(pressNormFor(pdf.map, profile)).toBe("ISOM");
    expect(pdf.at.under).toBeGreaterThan(-1);
    expect(pdf.at.circle).toBeGreaterThan(pdf.at.under);
    expect(pdf.at.over).toBeGreaterThan(pdf.at.circle);
    // Under banan: asfalten (fyllning 0/28/45/12) och byggnadens svarta fyllning; över: stigen (svart linje) och brunt.
    expect(pdf.under).toContain("0 0.28 0.45 0.12 k");
    expect(pdf.under).toContain("0 0 0 1 k");
    expect(pdf.over).not.toContain("0 0.28 0.45 0.12 k");
    expect(pdf.over).not.toContain("0 0 0 1 k");
    expect(pdf.over).toContain("0 0 0 1 K");
    expect(pdf.over).toContain("0 0.56 1 0.18 K");
    // Färgerna över banan med övertryck, så att lila syns genom dem på tryck.
    expect(pdf.over).toMatch(/\/GOP gs/);
    // Numret i undre lila (bilagan, förval i skog) före kartans färger över banan: kurvorna och stigen korsar det.
    expect(pdf.at.number).toBeLessThan(pdf.at.over);
    // "Kontrollnummer och texter överst": efter kartans färger över banan.
    const top = await pdfFor(10000, { ...profile, numbersOnTop: true });
    expect(top.at.number).toBeGreaterThan(top.at.over);
  });

  it("ISSprOM: numren över de svarta byggnaderna, ringarna under svart; brunt 100 % under banan", async () => {
    const pdf = await pdfFor(4000);
    expect(pressNormFor(pdf.map, profile)).toBe("ISSPROM");
    const over = colorsOverCourse(pdf.map, profile)!;
    expect(pdf.map.colors.filter(item => over.has(item.id)).map(item => item.name).sort()).toEqual(["Svart 100%", "Svart 100% byggnad"]);
    expect(pdf.at.circle).toBeGreaterThan(pdf.at.under);
    expect(pdf.at.over).toBeGreaterThan(pdf.at.circle);
    expect(pdf.at.number).toBeGreaterThan(pdf.at.over);
    expect(pdf.over).toContain("0 0 0 1 k");
    expect(pdf.under).toContain("0 0.56 1 0.18 K");
    expect(pdf.under).toContain("0 0.28 0.45 0.12 k");
  });

  it("normen kan väljas i profilen", async () => {
    const { map } = sheetsFor(10000);
    expect(pressNormFor(map, { ...profile, pressNorm: "ISSPROM" })).toBe("ISSPROM");
  });

  it("vita specialobjekt och bilder under banan: före undre lila, och kartans färger över banan ritas inte i dem (städrundan 2026-11-07)", async () => {
    for (const scale of [10000, 4000]) {
      const pdf = await pdfFor(scale, profile, true);
      // Vitt (CMYK 0) fylls och bilden ritas efter kartan under banan och före ringen; förut kom de efter kartans färger över banan.
      const white = pdf.content.indexOf("0 0 0 0 k");
      const image = pdf.content.indexOf("/Im0 Do");
      expect(white).toBeGreaterThan(pdf.at.under);
      expect(image).toBeGreaterThan(pdf.at.under);
      expect(white).toBeLessThan(pdf.at.circle);
      expect(image).toBeLessThan(pdf.at.circle);
      // Ramens innehåll efter ringen (undre lila, kartan över banan, övre lila) har varken vitt eller bilden; vitt efter ramen
      // är beskrivningens bakgrund på papperet.
      const placed = pdf.content.indexOf("\nQ\n", pdf.at.over) + 3;
      const frameEnd = pdf.content.startsWith("q\n", placed) ? pdf.content.indexOf("\nQ\n", placed) : placed;
      const after = pdf.content.slice(pdf.at.circle, frameEnd);
      expect(after).not.toContain("0 0 0 0 k");
      expect(after).not.toContain("/Im0 Do");
      // Kartans färger över banan klipps bort i båda ytorna: två jämn–udda-klippningar före utsnittet.
      const before = pdf.content.slice(pdf.content.lastIndexOf("q", pdf.at.over), pdf.at.over);
      expect(before.match(/W\* n/g)).toHaveLength(2);
    }
  });
});
