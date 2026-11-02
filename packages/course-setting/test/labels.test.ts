import type { Point } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { applyEdit, controlLabelText, layoutOverprint, readPpen, writePpen, type CourseSettingDocument, type OverprintPrimitive } from "../src";
import { Builder, lineCourse } from "./build";

/** ADR-0180 beslut 12: texten vid kontrollen (banans `labelKind`) som Purple Pen, och att längre texter får plats. */
type Text = Extract<OverprintPrimitive, { kind: "text" }>;
type Circle = Extract<OverprintPrimitive, { kind: "circle" }>;
type Line = Extract<OverprintPrimitive, { kind: "polyline" }>;
const numbers = (p: readonly OverprintPrimitive[]) => p.filter((x): x is Text => x.kind === "text" && x.role === "NUMBER");
const withLabel = (document: CourseSettingDocument, course: string, labelKind: Parameters<typeof controlLabelText>[0]) =>
  applyEdit(document, { type: "UPDATE_COURSE", course, changes: { labelKind } }).document;

describe("controlLabelText", () => {
  it("ger Purple Pens texter (CourseFormatter.GetControlLabelText)", () => {
    const parts = { ordinals: [3], code: "145", points: 30 };
    expect(controlLabelText("SEQUENCE", parts)).toBe("3");
    expect(controlLabelText("CODE", parts)).toBe("145");
    expect(controlLabelText("SEQUENCE_AND_CODE", parts)).toBe("3-145");
    expect(controlLabelText("SCORE", parts)).toBe("30");
    expect(controlLabelText("CODE_AND_SCORE", parts)).toBe("145(30)");
    expect(controlLabelText("SEQUENCE_AND_SCORE", parts)).toBe("3(30)");
    expect(controlLabelText("SEQUENCE_AND_CODE", { ordinals: [3, 7], code: "31" })).toBe("3/7-31");
    expect(controlLabelText("CODE_AND_SCORE", { code: "31", points: 0 })).toBe("31");
    expect(controlLabelText("SCORE", { code: "31" })).toBeUndefined();
    expect(controlLabelText("SEQUENCE", { code: "31" })).toBeUndefined();
  });
});

describe("etiketten på kartan", () => {
  it("nummer och kod som på stafetter: 1-31, och går fram och tillbaka i .ppen", () => {
    const { b, course, controls } = lineCourse(3, { mapScale: 15000 });
    const document = withLabel(b.document, course, "SEQUENCE_AND_CODE");
    expect(numbers(layoutOverprint(document, { course })).map(t => t.text)).toEqual(controls.map((id, i) => `${i + 1}-${b.code(id)}`));
    expect(numbers(layoutOverprint(withLabel(document, course, "CODE"), { course })).map(t => t.text)).toEqual(controls.map(id => b.code(id)));
    const xml = writePpen(document);
    expect(xml).toContain('<labels label-kind="sequence-and-code" />');
    expect(readPpen(xml).document.courses[0]!.labelKind).toBe("SEQUENCE_AND_CODE");
    expect(writePpen(withLabel(document, course, "SEQUENCE"))).not.toContain("<labels");
  });

  it("en kontroll som besöks två gånger får båda numren", () => {
    const { b, course, controls } = lineCourse(2, { mapScale: 15000 });
    b.insert(course, controls[0]!);
    const texts = numbers(layoutOverprint(withLabel(b.document, course, "SEQUENCE_AND_CODE"), { course })).map(t => t.text).sort();
    expect(texts).toEqual([`1/3-${b.code(controls[0]!)}`, `2-${b.code(controls[1]!)}`].sort());
  });

  it("poängbanan: poäng, kod och poäng, och nummer flyttar poängen ur kolumn A som Purple Pen", () => {
    const b = new Builder({ mapScale: 15000 });
    b.control("START", 0, 0);
    const course = b.edit({ type: "ADD_COURSE", name: "Poäng", kind: "SCORE" });
    const ids = [b.control("NORMAL", 30, 0), b.control("NORMAL", 0, 30)];
    for (const id of ids) b.insert(course, id);
    const points = [20, 10];
    for (const [index, id] of ids.entries()) {
      const cc = b.cc(course, id);
      b.edit({ type: "PUT_OBJECTS", courseControls: { [cc]: { ...b.document.courseControls[cc]!, points: points[index] } } });
    }
    expect(b.document.courses[0]!.labelKind).toBe("CODE");
    const label = (kind: Parameters<typeof controlLabelText>[0]) =>
      numbers(layoutOverprint(withLabel(b.document, course, kind), { course })).map(t => t.text);
    expect(label("SCORE")).toEqual(["20", "10"]);
    expect(label("CODE_AND_SCORE")).toEqual([`${b.code(ids[0]!)}(20)`, `${b.code(ids[1]!)}(10)`]);
    // Numren i beskrivningens ordning: efter poäng.
    expect(label("SEQUENCE_AND_SCORE")).toEqual(["2(20)", "1(10)"]);
    expect(writePpen(withLabel(b.document, course, "SEQUENCE"))).toMatch(/<options [^>]*score-column="B"/);
    expect(() => applyEdit(lineCourse(1).b.document, { type: "UPDATE_COURSE", course: "1", changes: { labelKind: "SCORE" } })).toThrow();
  });
});

/** Rutan som texten täcker: siffrorna är 0,78 av höjden breda, "-" och "/" smalare (Roboto). */
function textBox(text: Text): { minX: number; maxX: number; minY: number; maxY: number } {
  const height = text.heightMm * 4 / 5.57;
  const width = [...text.text].reduce((sum, char) => sum + (/\d/.test(char) ? 0.78 : 0.4) * height, 0);
  return { minX: text.at.x - width / 2, maxX: text.at.x + width / 2, minY: text.at.y - height / 2, maxY: text.at.y + height / 2 };
}

function segmentHitsBox(a: Point, b: Point, box: ReturnType<typeof textBox>, margin: number): boolean {
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    if (x > box.minX - margin && x < box.maxX + margin && y > box.minY - margin && y < box.maxY + margin) return true;
  }
  return false;
}

function circleHitsBox(center: Point, radius: number, box: ReturnType<typeof textBox>): boolean {
  const x = Math.max(box.minX, Math.min(center.x, box.maxX));
  const y = Math.max(box.minY, Math.min(center.y, box.maxY));
  return Math.hypot(center.x - x, center.y - y) < radius;
}

describe("plats för längre etiketter", () => {
  it("12-145 krockar inte med ringar, sträckor eller andra nummer på en tät bana", () => {
    // Sicksack med 14 kontroller 15 mm isär (i 1:15 000 är ringen 5,35 mm och "12-145" 17 mm brett): numren måste välja sida.
    const b = new Builder({ mapScale: 15000 });
    b.control("START", -15, 0);
    const course = b.course("Stafett");
    const ids: string[] = [];
    for (let i = 0; i < 14; i++) {
      const id = b.control("NORMAL", i * 15, i % 2 === 0 ? 0 : 10);
      b.edit({ type: "SET_CONTROL_CODE", control: id, code: String(131 + i + (i === 11 ? 3 : 0)) });
      b.insert(course, id);
      ids.push(id);
    }
    b.control("FINISH", 14 * 15, 0);
    b.insert(course, Object.values(b.document.controls).find(control => control.kind === "FINISH")!.id);
    const document = withLabel(b.document, course, "SEQUENCE_AND_CODE");
    const figures = layoutOverprint(document, { course });
    const labels = numbers(figures);
    expect(labels.map(t => t.text)).toContain("12-145");
    const rings = figures.filter((x): x is Circle => x.kind === "circle");
    const legs = figures.filter((x): x is Line => x.kind === "polyline" && x.role === "LEG");
    for (const label of labels) {
      const box = textBox(label);
      for (const ring of rings) expect(circleHitsBox(ring.center, (ring.diameter + ring.lineWidth) / 2, box), `${label.text} och ringen`).toBe(false);
      for (const leg of legs) {
        for (let i = 1; i < leg.points.length; i++) {
          expect(segmentHitsBox(leg.points[i - 1]!, leg.points[i]!, box, leg.width / 2), `${label.text} och sträckan ${leg.ref}`).toBe(false);
        }
      }
      for (const other of labels) {
        if (other === label) continue;
        const b2 = textBox(other);
        const overlap = box.minX < b2.maxX && b2.minX < box.maxX && box.minY < b2.maxY && b2.minY < box.maxY;
        expect(overlap, `${label.text} och ${other.text}`).toBe(false);
      }
    }
  });

  it("ett flyttat nummer tas med när de andra placeras, också när det kommer senare på banan", () => {
    const { b, course, controls } = lineCourse(2, { mapScale: 15000 });
    const document = withLabel(b.document, course, "SEQUENCE_AND_CODE");
    const auto = numbers(layoutOverprint(document, { course }))[0]!;
    // Det andra numret flyttas till där det första annars hamnar.
    const moved = applyEdit(document, { type: "MOVE_NUMBER", course, courseControl: b.cc(course, controls[1]!), at: auto.at }).document;
    const [first, second] = numbers(layoutOverprint(moved, { course }));
    expect(second!.at).toEqual(auto.at);
    const a = textBox(first!), c = textBox(second!);
    expect(a.minX < c.maxX && c.minX < a.maxX && a.minY < c.maxY && c.minY < a.maxY).toBe(false);
  });
});
