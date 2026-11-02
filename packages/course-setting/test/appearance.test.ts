import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appearanceOf, appearanceWarnings, applyEdit, CourseSettingEditError, documentChanges, editTouches, layoutOverprint, paperSizesFor,
  printScalesInUse, readPpen, replayEdits, standardPaperSizes, writePpen, type CourseSettingDocument, type CourseSettingEdit, type OverprintPrimitive
} from "../src";
import { sizesFor } from "../src/appearance";
import { formatFloat32 } from "../src/ppen-common";
import { lineCourse } from "./build";
import { normalizedXml, ppenFiles, readText, testFilesDir } from "./helpers";

/** ADR-0180 beslut 12: banans utseende (`SET_APPEARANCE`) i .ppen, måtten på papperet och varningarna. */
const files = ppenFiles().filter(path => relative(testFilesDir, path) !== "sampleevent2.ppen");
const appearanceXml = (xml: string) => /<course-appearance[^>]*\/>|<course-appearance[^>]*>[\s\S]*?<\/course-appearance>/.exec(xml)?.[0];
const withoutAppearance = (xml: string) => xml.replace(/<course-appearance[^>]*\/>|<course-appearance[^>]*>[\s\S]*?<\/course-appearance>/, "");
const set = (document: CourseSettingDocument, changes: Extract<CourseSettingEdit, { type: "SET_APPEARANCE" }>["changes"]) =>
  applyEdit(document, { type: "SET_APPEARANCE", changes }).document;
type Circle = Extract<OverprintPrimitive, { kind: "circle" }>;
type Text = Extract<OverprintPrimitive, { kind: "text" }>;

describe.skipIf(files.length === 0)("utseendet i Purple Pens testfiler", () => {
  it("oförändrade fält lämnar dokumentet och filen orörda", () => {
    for (const path of files) {
      const xml = readText(path);
      const { document } = readPpen(xml);
      const same = set(document, { ...appearanceOf(document) });
      expect(same, path).toBe(document);
      expect(set(document, {}), path).toBe(document);
      expect(writePpen(same)).toBe(writePpen(document));
    }
  });

  it("ändrad ringstorlek skrivs som Purple Pen och går fram och tillbaka", () => {
    for (const path of files) {
      const original = readPpen(readText(path)).document;
      const before = appearanceOf(original);
      const changed = set(original, { circleSize: 6 / 5.35, numberSize: 0.75 });
      const written = writePpen(changed);
      const element = appearanceXml(written)!;
      // Kvoterna först (Purple Pens ordning), som 32-bitarstal i kortaste form; scale-sizes och avbrottet alltid.
      expect(element, path).toMatch(new RegExp(`^<course-appearance control-circle-size-ratio="${formatFloat32(6 / 5.35)}" number-size-ratio="0.75" scale-sizes="${before.itemScaling}"`));
      expect(element).toContain(`auto-leg-gap-size="${before.autoLegGap === 3.5 ? "3.5" : formatFloat32(before.autoLegGap)}"`);
      const again = readPpen(written).document;
      expect(appearanceOf(again)).toEqual({ ...before, circleSize: Number(formatFloat32(6 / 5.35)), numberSize: 0.75 });
      // Resten av filen är som förut.
      expect(normalizedXml(withoutAppearance(written))).toEqual(normalizedXml(withoutAppearance(writePpen(original))));
      // Attribut som O-Tid inte tolkar följer med.
      const old = appearanceXml(writePpen(original)) ?? "";
      for (const name of ["number-font", "blend-purple", "blend-style", "number-outline-width", "purple-cyan", "number-bold"]) {
        const value = new RegExp(`${name}="([^"]*)"`).exec(old)?.[1];
        if (value !== undefined) expect(element, `${path} ${name}`).toContain(`${name}="${value}"`);
      }
    }
  });

  it("tillbaka till 1 tar bort kvoten, som Purple Pen", () => {
    const { document } = readPpen(readText(files[0]!));
    const back = set(set(document, { circleSize: 1.25, lineWidth: 1.5 }), { circleSize: 1, lineWidth: 1 });
    const element = appearanceXml(writePpen(back))!;
    expect(element).not.toContain("ratio");
    expect(appearanceOf(back)).toMatchObject({ circleSize: 1, lineWidth: 1 });
  });
});

describe("SET_APPEARANCE", () => {
  it("skriver scale-sizes-circle-gaps bara när det ändras", () => {
    const { b } = lineCourse(1, { mapScale: 15000 });
    expect(appearanceOf(b.document).circleGapsScaled).toBe(true);
    const scaled = set(b.document, { itemScaling: "None" });
    expect(appearanceXml(writePpen(scaled))).toContain('scale-sizes="None" scale-sizes-circle-gaps="true"');
    const old = set(scaled, { circleGapsScaled: false });
    expect(appearanceXml(writePpen(old))).not.toContain("scale-sizes-circle-gaps");
    expect(appearanceOf(readPpen(writePpen(old)).document).circleGapsScaled).toBe(false);
  });

  it("lägger till course-appearance när filen saknar det, på Purple Pens plats", () => {
    const { b } = lineCourse(1, { mapScale: 15000 });
    const without = { ...b.document, event: { ...b.document.event, raw: (b.document.event.raw ?? []).filter(raw => !raw.xml.startsWith("<course-appearance")) } };
    expect(appearanceOf(without).itemScaling).toBe("None");
    const xml = writePpen(set(without, { lineWidth: 2 }));
    expect(xml).toMatch(/<punch-card[^>]*\/>\s*<course-appearance line-width-ratio="2" scale-sizes="None" auto-leg-gap-size="3.5" \/>\s*<descriptions/);
  });

  it("avvisar mått utanför Purple Pens gränser och okänd skalning", () => {
    const { b } = lineCourse(1);
    const fails = (changes: Record<string, unknown>) => {
      try { set(b.document, changes as never); expect.unreachable(); } catch (error) {
        expect(error).toBeInstanceOf(CourseSettingEditError);
        expect((error as CourseSettingEditError).code).toBe("INVALID");
      }
    };
    fails({ circleSize: 0 });
    fails({ circleSize: 10 });            // 53,5 mm
    fails({ lineWidth: Number.NaN });
    fails({ numberSize: 0.2 });           // 0,8 mm
    fails({ autoLegGap: -1 });
    fails({ itemScaling: "Twice" });
    fails({ circleGapsScaled: "ja" });
    expect(appearanceOf(set(b.document, { circleSize: 50 / 5.35 })).circleSize).toBeCloseTo(50 / 5.35, 5);
  });

  it("syns direkt i banpåtrycket: ringen, linjen, numret och avståndet till ringen", () => {
    const { b, course } = lineCourse(2, { mapScale: 15000 });
    const before = layoutOverprint(b.document, { course });
    const after = layoutOverprint(set(b.document, { circleSize: 6 / 5.35, lineWidth: 2, numberSize: 1.5 }), { course });
    const ring = (p: readonly OverprintPrimitive[]) => p.find((x): x is Circle => x.kind === "circle" && x.role === "CONTROL")!;
    const number = (p: readonly OverprintPrimitive[]) => p.find((x): x is Text => x.kind === "text" && x.role === "NUMBER")!;
    // RelativeTo15000 på en 1:15 000-karta: kartans mm är papperets.
    expect(ring(before).diameter + ring(before).lineWidth).toBeCloseTo(5.35, 6);
    expect(ring(after).diameter + ring(after).lineWidth).toBeCloseTo(6.0, 6);
    expect(ring(after).lineWidth).toBeCloseTo(0.7, 6);
    expect(number(after).heightMm / number(before).heightMm).toBeCloseTo(1.5, 6);
    // Purple Pen: avståndet till ringen följer ringstorleken (CourseFormatter.CreateControlNumber).
    const sizes = sizesFor(set(b.document, { circleSize: 1.2 }), 15000);
    expect(sizes.numberDistance).toBeCloseTo(1.825 * 1.2, 6);
    expect(sizes.codeHeight).toBeCloseTo(3.0, 6);
    expect(sizesFor(set(b.document, { numberSize: 1.5 }), 15000).codeHeight).toBeCloseTo(4.5, 6);
  });

  it("avbrottet vid sträckor 0 stänger av de automatiska avbrotten", () => {
    // Två sträckor som korsar varandra: 1 (0,0) → 2 (40,40) → 3 (40,0) → 4 (0,40).
    const { b, course, controls } = lineCourse(4, { mapScale: 15000 });
    const at = [{ x: 0, y: 0 }, { x: 40, y: 40 }, { x: 40, y: 0 }, { x: 0, y: 40 }];
    controls.forEach((control, index) => b.edit({ type: "MOVE_CONTROL", control, at: at[index]! }));
    const pieces = (document: CourseSettingDocument) => layoutOverprint(document, { course }).filter(p => p.kind === "polyline" && p.role === "LEG").length;
    expect(pieces(b.document)).toBeGreaterThan(pieces(set(b.document, { autoLegGap: 0 })));
    expect(pieces(set(b.document, { autoLegGap: 0 }))).toBe(Object.keys(b.document.courseControls).length - 1);
  });
});

describe("måtten på papperet och varningarna", () => {
  it("räknar mm på papperet för skalningarna, som Purple Pen", () => {
    const { b, course } = lineCourse(1, { mapScale: 15000 });
    b.edit({ type: "UPDATE_COURSE", course, changes: { printScale: 10000 } });
    const relative = b.document;  // RelativeTo15000
    expect(paperSizesFor(relative, 10000).circle).toBeCloseTo(5.35 * 1.5, 6);
    expect(paperSizesFor(relative, 15000).circle).toBeCloseTo(5.35, 6);
    const none = set(relative, { itemScaling: "None" });
    expect(paperSizesFor(none, 10000).circle).toBeCloseTo(5.35, 6);
    const map = set(relative, { itemScaling: "RelativeToMap" });
    expect(paperSizesFor(map, 10000).circle).toBeCloseTo(5.35 * 1.5, 6);
    expect(paperSizesFor(set(none, { circleSize: 6 / 5.35 }), 10000).circle).toBeCloseTo(6, 6);
    expect(paperSizesFor(set(none, { autoLegGap: 2 }), 10000).autoLegGap).toBeCloseTo(2, 6);
  });

  it("standarden: ISOM förstoras i 1:10 000 och 1:5 000, ISSprOM inte", () => {
    expect(standardPaperSizes("ISOM2017", 15000)).toEqual({ circle: 5.35, line: 0.35, number: 4 });
    expect(standardPaperSizes("ISOM2017", 10000).circle).toBeCloseTo(8.025, 6);
    expect(standardPaperSizes("ISOM2017", 5000).line).toBeCloseTo(1.05, 6);
    expect(standardPaperSizes("ISOM2017", 20000).circle).toBe(5.35);
    expect(standardPaperSizes("ISSPROM2019", 3000)).toEqual({ circle: 6.35, line: 0.35, number: 4 });
  });

  it("varnar när måtten går utanför standarden vid någon utskriftsskala", () => {
    const { b, course } = lineCourse(1, { mapScale: 15000 });
    b.edit({ type: "UPDATE_COURSE", course, changes: { printScale: 10000 } });
    expect(printScalesInUse(b.document)).toEqual([10000, 15000]);
    expect(appearanceWarnings(b.document)).toEqual([]);
    // Ingen skalning: 1:10 000 blir inte förstorad (ISOM 2.9.1).
    const none = set(b.document, { itemScaling: "None" });
    expect(appearanceWarnings(none).map(w => `${w.printScale}:${w.field}`)).toEqual(["10000:circle", "10000:line", "10000:number"]);
    // Mindre nummer: under ISOM:s 4,0 mm i båda skalorna.
    const small = set(b.document, { numberSize: 0.75 });
    expect(appearanceWarnings(small).map(w => `${w.printScale}:${w.field}:${w.actual.toFixed(2)}:${w.expected.toFixed(2)}`))
      .toEqual(["10000:number:4.50:6.00", "15000:number:3.00:4.00"]);
    // Sprint: 6,35 mm är standard.
    const sprint = lineCourse(1, { mapScale: 4000, sprint: true }).b.document;
    expect(appearanceWarnings(sprint)).toEqual([]);
    expect(appearanceWarnings(set(sprint, { circleSize: 1.1 }))[0]).toMatchObject({ field: "circle", printScale: 4000 });
  });
});

describe("samarbetet", () => {
  it("konfliktnycklar per fält: samma fält krockar, olika fält går igenom", () => {
    const { b } = lineCourse(1, { mapScale: 15000 });
    const base = b.document;
    expect(editTouches({ type: "SET_APPEARANCE", changes: { numberSize: 1.2, circleSize: 1.1 } }))
      .toEqual(["event:appearance:circleSize", "event:appearance:numberSize"]);
    const other = set(base, { circleSize: 1.2 });
    const same = replayEdits(other, [{ type: "SET_APPEARANCE", changes: { circleSize: 1.3 } }], { conflict: documentChanges(base, other) });
    expect(same.rejected.map(row => row.code)).toEqual(["CONFLICT"]);
    const different = replayEdits(other, [{ type: "SET_APPEARANCE", changes: { numberSize: 0.8 } }], { conflict: documentChanges(base, other) });
    expect(different.rejected).toEqual([]);
    expect(appearanceOf(different.document)).toMatchObject({ circleSize: 1.2, numberSize: 0.8 });
    // Banans etikett är ett vanligt fält på banan.
    expect(editTouches({ type: "UPDATE_COURSE", course: "1", changes: { labelKind: "SEQUENCE_AND_CODE" } })).toEqual(["course:1:labelKind"]);
  });
});
