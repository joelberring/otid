/** Ändringarna i beskrivningen och hur de skrivs i .ppen (som Purple Pens EventDB.cs). */
import { describe, expect, it } from "vitest";
import {
  CourseSettingEditError, applyEdit, describeControl, layoutDescription, readPpen, writePpen, type CourseSettingDocument,
  type CourseSettingEdit
} from "../src";
import { lineCourse } from "./build";

const roundTrip = (document: CourseSettingDocument) => readPpen(writePpen(document)).document;

function expectInvalid(document: CourseSettingDocument, edit: CourseSettingEdit, message?: RegExp): void {
  try {
    applyEdit(document, edit);
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(CourseSettingEditError);
    expect((error as CourseSettingEditError).code).toBe("INVALID");
    if (message) expect((error as Error).message).toMatch(message);
  }
}

describe("SET_DESCRIPTION", () => {
  const { b, controls, finish } = lineCourse(2);
  const control = controls[0]!;

  it("sätter rutorna i Purple Pens ordning och skriver dem som description", () => {
    const { document } = applyEdit(b.document, {
      type: "SET_DESCRIPTION", control,
      boxes: [{ box: "F", text: "1" }, { box: "D", ref: "2.4" }, { box: "C", ref: "0.2SE" }]
    });
    expect(document.controls[control]!.descriptions).toEqual([{ box: "C", ref: "0.2SE" }, { box: "D", ref: "2.4" }, { box: "F", text: "1" }]);
    const xml = writePpen(document);
    expect(xml).toContain('<description box="C" iof-2004-ref="0.2SE" />');
    expect(xml).toContain('<description box="D" iof-2004-ref="2.4" />');
    expect(xml).toContain('<description box="F">1</description>');
    expect(roundTrip(document)).toEqual(document);
    expect(describeControl(document, control, "sv")).toBe("SÖ stenen, 1m hög");
    expect(describeControl(document, control, "en")).toBe("SE boulder, 1m high");
  });

  it("tom lista tar bort beskrivningen, tomma rutor hoppas över", () => {
    let { document } = applyEdit(b.document, { type: "SET_DESCRIPTION", control, boxes: [{ box: "D", ref: "1.9" }] });
    ({ document } = applyEdit(document, { type: "SET_DESCRIPTION", control, boxes: [{ box: "E" }, { box: "F", text: "" }] }));
    expect(document.controls[control]!.descriptions).toEqual([]);
    expect(writePpen(document)).not.toContain('box="D"');
  });

  it("E får även ett objekt ur D (två objekt), och 2018 har sina egna symboler", () => {
    const { document } = applyEdit(b.document, {
      type: "SET_DESCRIPTION", control, boxes: [{ box: "D", ref: "5.2" }, { box: "E", ref: "5.26" }, { box: "F", ref: "10.1" }]
    });
    expect(describeControl(document, control, "sv")).toBe("Korsningen mellan stigen och järnvägen");
  });

  it("validerar rutor, symboler, standard och text", () => {
    const doc = b.document;
    expectInvalid(doc, { type: "SET_DESCRIPTION", control, boxes: [{ box: "A", ref: "2.4" }] }, /Rutan A/);
    expectInvalid(doc, { type: "SET_DESCRIPTION", control, boxes: [{ box: "D", ref: "2.4" }, { box: "D", ref: "2.5" }] }, /två gånger/);
    expectInvalid(doc, { type: "SET_DESCRIPTION", control, boxes: [{ box: "C", ref: "2.4" }] }, /hör inte till/);
    expectInvalid(doc, { type: "SET_DESCRIPTION", control, boxes: [{ box: "D", ref: "99.9" }] }, /finns inte/);
    expectInvalid(doc, { type: "SET_DESCRIPTION", control, boxes: [{ box: "H", ref: "12.3" }] }, /standarden 2018/);
    expectInvalid(doc, { type: "SET_DESCRIPTION", control, boxes: [{ box: "G", text: "nära" }] }, /ruta F/);
    expectInvalid(doc, { type: "SET_DESCRIPTION", control, boxes: [{ box: "F", ref: "10.1", text: "2" }] }, /antingen/);
    expectInvalid(doc, { type: "SET_DESCRIPTION", control: finish, boxes: [{ box: "D", ref: "2.4" }] });
    expectInvalid(doc, { type: "SET_DESCRIPTION", control: finish, boxes: [{ box: "all", ref: "13.3" }] }, /hör inte till/);
    expect(() => applyEdit(doc, { type: "SET_DESCRIPTION", control: "999", boxes: [] })).toThrow(/finns inte/);
    const twoThousandFour = applyEdit(doc, { type: "SET_EVENT", changes: { descriptionStandard: "2004" } }).document;
    expect(applyEdit(twoThousandFour, { type: "SET_DESCRIPTION", control, boxes: [{ box: "H", ref: "12.3" }] }).document.controls[control]!.descriptions)
      .toEqual([{ box: "H", ref: "12.3" }]);
  });

  it("målet får en egen symbol i rutan all, och en ny kontroll får Purple Pens standardsymbol", () => {
    expect(b.document.controls[finish]!.descriptions).toEqual([{ box: "all", ref: "14.3" }]);
    const { document } = applyEdit(b.document, { type: "SET_DESCRIPTION", control: finish, boxes: [{ box: "all", ref: "14.2" }] });
    expect(writePpen(document)).toContain('<description box="all" iof-2004-ref="14.2" />');
    const crossing = applyEdit(document, { type: "ADD_CONTROL", kind: "CROSSING_POINT", at: { x: 5, y: 5 } });
    expect(crossing.document.controls[crossing.created!]!.descriptions).toEqual([{ box: "all", ref: "13.3" }]);
  });
});

describe("SET_DESCRIPTION_TEXT_LINE", () => {
  const { b, course, controls } = lineCourse(2);
  const control = controls[1]!;

  it("lägger till, byter och tar bort textrader före och efter, och skriver dem som Purple Pen", () => {
    let { document } = applyEdit(b.document, { type: "SET_DESCRIPTION_TEXT_LINE", control, location: "after", text: "Vätska efter kontrollen" });
    ({ document } = applyEdit(document, { type: "SET_DESCRIPTION_TEXT_LINE", control, location: "before", text: "Obs!|Två rader" }));
    expect(document.controls[control]).toMatchObject({ descriptionTextBefore: "Obs!|Två rader", descriptionTextAfter: "Vätska efter kontrollen" });
    const xml = writePpen(document);
    expect(xml).toMatch(/<description-text-line location="before">Obs!\|Två rader<\/description-text-line>\s*<description-text-line location="after">Vätska efter kontrollen<\/description-text-line>/);
    expect(roundTrip(document)).toEqual(document);
    const layout = layoutDescription(document, { course, kind: "SYMBOLS", language: "sv" });
    const texts = layout.primitives.filter(p => p.kind === "text").map(p => p.text);
    expect(texts).toEqual(expect.arrayContaining(["Obs!", "Två rader", "Vätska efter kontrollen"]));
    expect(layout.primitives.filter(p => p.kind === "hit" && p.ref === control && (p.box === "before" || p.box === "after")).map(p => p.kind === "hit" ? p.box : ""))
      .toEqual(["before", "before", "after"]);
    ({ document } = applyEdit(document, { type: "SET_DESCRIPTION_TEXT_LINE", control, location: "before", text: null }));
    ({ document } = applyEdit(document, { type: "SET_DESCRIPTION_TEXT_LINE", control, location: "after", text: "" }));
    expect(document.controls[control]!.descriptionTextBefore).toBeUndefined();
    expect("descriptionTextAfter" in document.controls[control]!).toBe(false);
    expect(writePpen(document)).not.toContain("description-text-line");
  });

  it("validerar läget och kontrollen", () => {
    expectInvalid(b.document, { type: "SET_DESCRIPTION_TEXT_LINE", control, location: "middle" as "before", text: "x" });
    expect(() => applyEdit(b.document, { type: "SET_DESCRIPTION_TEXT_LINE", control: "999", location: "before", text: "x" })).toThrow(/finns inte/);
  });
});
