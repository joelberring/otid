import { describe, expect, it } from "vitest";
import {
  applyEdit, CourseSettingEditError, layoutOverprint, readPpen, replayEdits, SPECIAL_KIND_LIST, writePpen, type OverprintPrimitive, type SpecialInput
} from "../src";
import { lineCourse } from "./build";
import { normalizedXml, ppenFiles, readText } from "./helpers";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const square = (x: number, y: number, size = 10) => [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }];

/** Ett av varje slag. */
const INPUTS: Readonly<Record<string, SpecialInput>> = {
  "first-aid": { kind: "first-aid", points: [{ x: 0, y: 30 }] },
  water: { kind: "water", points: [{ x: 10, y: 30 }] },
  "optional-crossing-point": { kind: "optional-crossing-point", points: [{ x: 20, y: 30 }], orientation: 45, stretch: 1 },
  "forbidden-route": { kind: "forbidden-route", points: [{ x: 30, y: 30 }] },
  "registration-mark": { kind: "registration-mark", points: [{ x: 40, y: 30 }] },
  boundary: { kind: "boundary", points: [{ x: 0, y: 40 }, { x: 30, y: 45 }] },
  "out-of-bounds": { kind: "out-of-bounds", points: square(0, 50) },
  "dangerous-area": { kind: "dangerous-area", points: square(20, 50) },
  "temporary-construction": { kind: "temporary-construction", points: square(40, 50) },
  "white-out": { kind: "white-out", points: square(60, 50) },
  text: { kind: "text", points: [{ x: 0, y: 90 }, { x: 40, y: 80 }], text: "$(CourseName) $(PrintScale)", font: { name: "Arial", bold: true, italic: false, height: 3 }, color: "black" },
  descriptions: { kind: "descriptions", points: [{ x: 80, y: 90 }, { x: 84, y: 90 }] },
  image: { kind: "image", points: [{ x: 60, y: 90 }, { x: 70, y: 80 }], image: { format: "png", data: PNG } },
  line: { kind: "line", points: [{ x: 0, y: 100 }, { x: 20, y: 100 }, { x: 20, y: 110 }], color: "lower-purple", line: { kind: "double", width: 0.3, gapSize: 0.5, dashSize: 0 } },
  rectangle: { kind: "rectangle", points: [{ x: 30, y: 100 }, { x: 50, y: 110 }], color: "0.1,0.9,0,0", line: { kind: "dashed", width: 0.3, gapSize: 1, dashSize: 2, cornerRadius: 2 } },
  ellipse: { kind: "ellipse", points: [{ x: 60, y: 100 }, { x: 80, y: 110 }], line: { kind: "single", width: 0.35, gapSize: 0, dashSize: 0 } }
};

function withAll() {
  const { b, course } = lineCourse(3, { mapScale: 15000 });
  const ids: Record<string, string> = {};
  for (const [kind, input] of Object.entries(INPUTS)) ids[kind] = b.edit({ type: "ADD_SPECIAL", special: input });
  return { b, course, ids };
}

const byRef = (figures: readonly OverprintPrimitive[], ref: string) => figures.filter(figure => figure.role === "SPECIAL" && figure.ref === ref);

describe("specialobjekten (steg 64)", () => {
  it("ritar varje slag med rätt färgroll och mått", () => {
    const { b, ids } = withAll();
    expect(Object.keys(INPUTS).sort()).toEqual([...SPECIAL_KIND_LIST].sort());
    const figures = layoutOverprint(b.document, { course: "ALL_CONTROLS", printScale: 15000 });
    // Beskrivningen hör till papperet (paper-layout.ts) och ritas inte i kartan.
    for (const kind of SPECIAL_KIND_LIST) expect(byRef(figures, ids[kind]!).length, kind)[kind === "descriptions" ? "toBe" : "toBeGreaterThan"](0);
    const colors = (kind: string) => [...new Set(byRef(figures, ids[kind]!).map(figure => figure.color ?? "IMAGE"))].sort();
    expect(colors("first-aid")).toEqual(["COURSE_LOWER"]);
    expect(colors("water")).toEqual(["COURSE_LOWER"]);
    expect(colors("optional-crossing-point")).toEqual(["COURSE_LOWER"]);
    expect(colors("boundary")).toEqual(["COURSE_LOWER"]);
    expect(colors("forbidden-route")).toEqual(["COURSE"]);
    expect(colors("out-of-bounds")).toEqual(["COURSE"]);
    expect(colors("white-out")).toEqual(["WHITE"]);
    expect(colors("text")).toEqual(["BLACK"]);
    expect(colors("image")).toEqual(["IMAGE"]);
    expect(colors("line")).toEqual(["COURSE_LOWER"]);
    expect(colors("rectangle")).toEqual(["CUSTOM"]);
    // Förbjudet område: korsraster 0,2 mm med 1,2 mm mellan linjerna (ISOM 2017-2 709), klippt mot ytan.
    const hatch = byRef(figures, ids["out-of-bounds"]!);
    expect(hatch.every(figure => figure.kind === "polyline" && figure.width === 0.2)).toBe(true);
    for (const figure of hatch) if (figure.kind === "polyline") for (const p of figure.points) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-9); expect(p.x).toBeLessThanOrEqual(10 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(50 - 1e-9); expect(p.y).toBeLessThanOrEqual(60 + 1e-9);
    }
    // Två riktningar, ungefär 10·√2/1,2 linjer var.
    expect(hatch.length).toBeGreaterThan(18);
    expect(hatch.length).toBeLessThan(28);
    const boundary = byRef(figures, ids.boundary!)[0]!;
    expect(boundary.kind === "polyline" && boundary.width).toBe(0.7);
    const construction = byRef(figures, ids["temporary-construction"]!);
    expect(construction.some(figure => figure.kind === "polygon" && figure.tint === 0.5)).toBe(true);
    const text = byRef(figures, ids.text!)[0]!;
    expect(text.kind === "text" && text.text).toBe("Alla kontroller 1:15 000");
    expect(text.kind === "text" && text.align).toBe("left");
    const rect = byRef(figures, ids.rectangle!)[0]!;
    expect(rect.kind === "polyline" && rect.dash).toEqual([2, 1]);
    expect(rect.kind === "polyline" && rect.cmyk).toEqual([0.1, 0.9, 0, 0]);
    expect(byRef(figures, ids.line!).length).toBe(2);
    const image = byRef(figures, ids.image!)[0]!;
    expect(image.kind === "image" && image.mediaType).toBe("image/png");
    expect(image.kind === "image" && image.rect).toEqual({ minX: 60, minY: 80, maxX: 70, maxY: 90 });
  });

  it("ritar i målningsordning: vitt underst och banans lila överst", () => {
    const { b, course } = withAll();
    const figures = layoutOverprint(b.document, { course });
    const rank = (figure: OverprintPrimitive) => figure.kind === "image" ? 1 : ({ WHITE: 0, CUSTOM: 2, BLACK: 3, COURSE_LOWER: 4, COURSE: 5 } as const)[figure.color];
    for (let i = 1; i < figures.length; i++) expect(rank(figures[i]!)).toBeGreaterThanOrEqual(rank(figures[i - 1]!));
    expect(figures.at(-1)!.color).toBe("COURSE");
  });

  it("punktobjekten skalas med utskriftsskalan, linjer och text inte", () => {
    const { b, ids } = withAll();
    const at = (printScale: number, kind: string) => byRef(layoutOverprint(b.document, { course: "ALL_CONTROLS", printScale }), ids[kind]!);
    const width = (printScale: number) => { const f = at(printScale, "forbidden-route")[0]!; return f.kind === "polyline" ? f.width : 0; };
    // RelativeTo15000 på en 1:15 000-karta: samma storlek i alla skalor (Purple Pens förval för ISOM).
    expect(width(10000)).toBeCloseTo(width(15000), 9);
    const relative = applyEdit(b.document, { type: "PUT_OBJECTS", event: { ...b.document.event, raw: b.document.event.raw!.map(raw =>
      raw.xml.startsWith("<course-appearance") ? { xml: raw.xml.replace("RelativeTo15000", "None") } : raw) } }).document;
    const scaled = byRef(layoutOverprint(relative, { course: "ALL_CONTROLS", printScale: 10000 }), ids["forbidden-route"]!)[0]!;
    expect(scaled.kind === "polyline" && scaled.width).toBeCloseTo(0.35 * 10000 / 15000, 9);
    const line = byRef(layoutOverprint(relative, { course: "ALL_CONTROLS", printScale: 10000 }), ids.ellipse!)[0]!;
    expect(line.kind === "polyline" && line.width).toBe(0.35);
  });

  it("syns bara på sina banor; 0 = Alla kontroller", () => {
    const { b, course } = lineCourse(2);
    const other = b.course("B");
    const id = b.edit({ type: "ADD_SPECIAL", special: { kind: "white-out", points: square(0, 0), courses: [course] } });
    const all = b.edit({ type: "ADD_SPECIAL", special: { kind: "forbidden-route", points: [{ x: 5, y: 5 }], courses: ["0"] } });
    const visible = (view: string) => [...new Set(layoutOverprint(b.document, { course: view }).filter(f => f.role === "SPECIAL").map(f => f.ref))];
    expect(visible(course)).toEqual([id]);
    expect(visible(other)).toEqual([]);
    expect(visible("ALL_CONTROLS")).toEqual([all]);
    // Tas banan bort försvinner objektet som bara gällde den.
    expect(applyEdit(b.document, { type: "DELETE_COURSE", course }).document.specialObjects.map(s => s.id)).toEqual([all]);
  });

  it("skapa, flytta, ändra och ta bort", () => {
    const { b, course } = lineCourse(2);
    const id = b.edit({ type: "ADD_SPECIAL", special: { kind: "out-of-bounds", points: square(0, 0) } });
    b.edit({ type: "MOVE_SPECIAL", special: id, points: square(5, 5, 20) });
    expect(b.document.specialObjects[0]!.points[1]).toEqual({ x: 25, y: 5 });
    b.edit({ type: "UPDATE_SPECIAL", special: id, changes: { courses: [course] } });
    expect(b.document.specialObjects[0]!.courses).toEqual([course]);
    const text = b.edit({ type: "ADD_SPECIAL", special: { kind: "text", points: [{ x: 0, y: 10 }, { x: 30, y: 0 }], text: "Hej", font: { name: "Arial", bold: false, italic: false } } });
    b.edit({ type: "UPDATE_SPECIAL", special: text, changes: { text: "Hej då", color: "black" } });
    expect(b.document.specialObjects[1]).toMatchObject({ text: "Hej då", color: "black" });
    b.edit({ type: "DELETE_SPECIAL", special: id });
    expect(b.document.specialObjects.map(s => s.id)).toEqual([text]);
    const error = (edit: Parameters<typeof applyEdit>[1]) => { try { applyEdit(b.document, edit); return undefined; } catch (e) { return (e as CourseSettingEditError).code; } };
    expect(error({ type: "ADD_SPECIAL", special: { kind: "out-of-bounds", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } })).toBe("INVALID");
    expect(error({ type: "ADD_SPECIAL", special: { kind: "text", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } })).toBe("INVALID");
    expect(error({ type: "MOVE_SPECIAL", special: "99", points: [{ x: 0, y: 0 }] })).toBe("NOT_FOUND");
    expect(error({ type: "ADD_SPECIAL", special: { kind: "white-out", points: square(0, 0), courses: ["77"] } })).toBe("NOT_FOUND");
    // En bana har bara en beskrivning på kartan.
    b.edit({ type: "ADD_SPECIAL", special: { kind: "descriptions", points: [{ x: 0, y: 0 }, { x: 5, y: 0 }], courses: [course] } });
    expect(error({ type: "ADD_SPECIAL", special: { kind: "descriptions", points: [{ x: 50, y: 0 }, { x: 55, y: 0 }] } })).toBe("IN_USE");
  });

  it("går fram och tillbaka genom .ppen och skrivs som Purple Pen när de ändrats", () => {
    const { b } = withAll();
    const xml = writePpen(b.document);
    expect(xml).toContain('<special-object id="3" kind="optional-crossing-point" orientation="45" stretch="1">');
    expect(xml).toContain('<font name="Arial" bold="true" italic="false" height="3" />');
    expect(xml).toContain('<appearance line-kind="dashed" color="0.1,0.9,0,0" line-width="0.3" gap-size="1" dash-size="2" corner-radius="2" />');
    expect(xml).toContain(`<image-data format="png">${PNG}</image-data>`);
    const back = readPpen(xml).document;
    expect(back.specialObjects).toEqual(b.document.specialObjects);
    const changed = applyEdit(back, { type: "UPDATE_SPECIAL", special: back.specialObjects[10]!.id, changes: { text: "Ny" } }).document;
    const again = readPpen(writePpen(changed)).document.specialObjects[10]!;
    expect(again.text).toBe("Ny");
    expect(again.font).toEqual(back.specialObjects[10]!.font);
  });

  it("Purple Pens testfiler: specialobjekten ändras och flyttas utan att något annat tappas", () => {
    let count = 0;
    for (const path of ppenFiles()) {
      let document;
      try { document = readPpen(readText(path)).document; } catch { continue; }
      for (const special of document.specialObjects) {
        const moved = applyEdit(document, { type: "MOVE_SPECIAL", special: special.id, points: special.points.map(p => ({ x: p.x + 1, y: p.y })) }).document;
        const read = readPpen(writePpen(moved)).document;
        const fields = (item: object | undefined) => Object.fromEntries(Object.entries(item ?? {}).filter(([key]) => key !== "raw"));
        expect(fields(read.specialObjects.find(s => s.id === special.id))).toEqual(fields(moved.specialObjects.find(s => s.id === special.id)));
        // Det orörda står kvar (samma XML för alla andra objekt).
        expect(normalizedXml(writePpen(read))).toEqual(normalizedXml(writePpen(moved)));
        count++;
        break;
      }
    }
    expect(count).toBeGreaterThan(5);
  });

  it("tryckytan och Alla kontrollers skala skrivs som Purple Pen", () => {
    const { b, course } = lineCourse(2);
    const area = { automatic: false, restrictToPageSize: true, rect: { minX: -10, minY: -20, maxX: 100, maxY: 60 },
      page: { width: 827, height: 1169, margins: 28, landscape: true } };
    b.edit({ type: "SET_PRINT_AREA", course, area });
    b.edit({ type: "SET_PRINT_AREA", course: "ALL_CONTROLS", area: { automatic: true, restrictToPageSize: true } });
    b.edit({ type: "SET_EVENT", changes: { allControlsPrintScale: 7500 } });
    const xml = writePpen(b.document);
    expect(xml).toContain('<print-area automatic="false" restrict-to-page-size="true" left="-10" top="60" right="100" bottom="-20" page-width="827" page-height="1169" page-margins="28" page-landscape="true" />');
    expect(xml).toContain('<all-controls print-scale="7500" description-kind="symbols" />');
    const back = readPpen(xml).document;
    expect(back.courses.find(c => c.id === course)!.printArea).toEqual(area);
    expect(back.event.allControlsPrintScale).toBe(7500);
    expect(back.event.printArea).toMatchObject({ automatic: true, restrictToPageSize: true });
    expect(readPpen(writePpen(back)).document).toEqual(back);
    const cleared = applyEdit(back, { type: "SET_PRINT_AREA", course, area: null }).document;
    expect(writePpen(cleared).match(/<print-area/g)?.length).toBe(1);
  });

  it("uppspelning på en nyare version översätter specialobjektens id (steg 66)", () => {
    const { b } = lineCourse(2);
    const base = b.document;
    const authorAdd = applyEdit(base, { type: "ADD_SPECIAL", special: { kind: "forbidden-route", points: [{ x: 1, y: 1 }] } });
    const edits = [{ type: "ADD_SPECIAL" as const, special: { kind: "forbidden-route" as const, points: [{ x: 1, y: 1 }] } },
      { type: "MOVE_SPECIAL" as const, special: authorAdd.created!, points: [{ x: 9, y: 9 }] }];
    // Någon annan hann skapa ett specialobjekt med samma id.
    const other = applyEdit(base, { type: "ADD_SPECIAL", special: { kind: "water", points: [{ x: 5, y: 5 }] } }).document;
    const result = replayEdits(other, edits, { created: [{ controls: [], courseControls: [], courses: [], specialObjects: [authorAdd.created!] }, undefined] });
    expect(result.rejected).toEqual([]);
    expect(result.document.specialObjects.map(s => [s.kind, s.points[0]])).toEqual([["water", { x: 5, y: 5 }], ["forbidden-route", { x: 9, y: 9 }]]);
    expect(result.idMap.specialObjects).toEqual({ [authorAdd.created!]: "2" });
  });
});
