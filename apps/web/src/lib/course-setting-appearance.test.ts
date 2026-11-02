import { appearanceOf, applyEdit, emptyDocument, layoutOverprint, type CourseSettingDocument } from "@o-tid/course-setting";
import { describe, expect, it } from "vitest";
import {
  APPEARANCE_PRESETS, appearanceEdit, formatMm, formatRatio, labelExample, labelKindEdits, labelKindsFor, overprintProbe, paperChange, parseDecimal,
  presetActive, presetsFor, ratioAllowed, referenceScale, relayCourses, scaleRows
} from "./course-setting-appearance";
import { describeEdit } from "./course-setting-suggestion";
import { testDocument } from "./course-setting-test-document";

/** ADR-0180 beslut 12: utseendet och etiketten i webben utan React. */
const apply = (document: CourseSettingDocument, edit: ReturnType<typeof appearanceEdit>) => (edit ? applyEdit(document, edit).document : document);
const preset = (id: string) => APPEARANCE_PRESETS.find(item => item.id === id)!;

/** En 1:15 000-karta med en bana i 1:10 000 (som O-Tids nya dokument: Relativt 1:15 000). */
function forest(): CourseSettingDocument {
  let document = emptyDocument({ title: "Natt", mapScale: 15000 });
  for (const edit of [
    { type: "ADD_CONTROL", kind: "START", at: { x: 0, y: 0 } }, { type: "ADD_CONTROL", kind: "NORMAL", at: { x: 30, y: 0 } },
    { type: "ADD_CONTROL", kind: "FINISH", at: { x: 60, y: 0 } }, { type: "ADD_COURSE", name: "Ungdom" }
  ] as const) document = applyEdit(document, edit).document;
  const course = document.courses[0]!.id;
  document = applyEdit(document, { type: "INSERT_COURSE_CONTROL", course, control: "2" }).document;
  return applyEdit(document, { type: "UPDATE_COURSE", course, changes: { printScale: 10000 } }).document;
}

describe("snabbval och mått", () => {
  it("snabbvalen: bara standardens och för sprint inga förstoringar", () => {
    expect(presetsFor("ISOM2017").map(item => item.id)).toEqual(["standard", "enlarged", "sprint-rings", "smaller-numbers"]);
    expect(presetsFor("ISSPROM2019").map(item => item.id)).toEqual(["standard", "smaller-numbers"]);
    expect(preset("sprint-rings").changes.circleSize! * 5.35).toBeCloseTo(6.35, 6);
    const document = forest();
    expect(presetActive(appearanceOf(document), preset("standard"))).toBe(true);
    expect(presetActive(appearanceOf(document), preset("enlarged"))).toBe(true);
    const larger = apply(document, appearanceEdit(document, preset("sprint-rings").changes));
    expect(presetActive(appearanceOf(larger), preset("standard"))).toBe(false);
    expect(presetActive(appearanceOf(larger), preset("sprint-rings"))).toBe(true);
    // Ett snabbval som redan gäller ger ingen ändring (inga tomma steg i ångra).
    expect(appearanceEdit(larger, preset("sprint-rings").changes)).toBeUndefined();
    expect(appearanceEdit(larger, { circleSize: 1, numberSize: 1 })).toEqual({ type: "SET_APPEARANCE", changes: { circleSize: 1 } });
  });

  it("visar vad kvoten ger på papperet vid vald banas skala: ring 8,03 → 9,53 mm", () => {
    const document = forest();
    const course = document.courses[0]!.id;
    expect(referenceScale(document, course)).toBe(10000);
    expect(referenceScale(document, "ALL_CONTROLS")).toBe(15000);
    const larger = apply(document, appearanceEdit(document, preset("sprint-rings").changes));
    const change = paperChange(larger, "circleSize", 10000);
    expect([formatMm(change.standard), formatMm(change.actual)]).toEqual(["8,03", "9,53"]);
    expect(formatMm(paperChange(larger, "circleSize", 15000).actual)).toBe("6,35");
    const none = apply(document, appearanceEdit(document, { itemScaling: "None", circleSize: 6 / 5.35 }));
    expect(formatMm(paperChange(none, "circleSize", 10000).actual)).toBe("6,0");
    expect(formatMm(paperChange(none, "lineWidth", 10000).actual)).toBe("0,35");
  });

  it("tabellen per skala varnar när 1:10 000 inte förstoras", () => {
    const document = forest();
    expect(scaleRows(document).map(row => [row.printScale, row.courses, row.warnings.length])).toEqual([[10000, ["Ungdom"], 0], [15000, ["Alla kontroller"], 0]]);
    const none = apply(document, appearanceEdit(document, { itemScaling: "None" }));
    expect(scaleRows(none)[0]!.warnings.map(item => item.field)).toEqual(["circle", "line", "number"]);
  });

  it("tal med komma eller punkt, Purple Pens gränser och formen i fältet", () => {
    expect(parseDecimal("1,25")).toBe(1.25);
    expect(parseDecimal(" 0.75 ")).toBe(0.75);
    expect(parseDecimal("")).toBeUndefined();
    expect(parseDecimal("stor")).toBeUndefined();
    expect(ratioAllowed("ISOM2017", "circleSize", 9)).toBe(true);     // 48 mm
    expect(ratioAllowed("ISOM2017", "circleSize", 10)).toBe(false);   // 53,5 mm
    expect(ratioAllowed("ISOM2017", "numberSize", 0.2)).toBe(false);  // 0,8 mm
    expect(formatRatio(6 / 5.35)).toBe("1.1215");
    expect(formatMm(0.7)).toBe("0,7");
    expect(formatMm(5.35)).toBe("5,35");
  });

  it("förslagets text och kartans attribut", () => {
    const document = testDocument();
    expect(describeEdit({ type: "SET_APPEARANCE", changes: { circleSize: 1.2, itemScaling: "RelativeTo15000" } }, document))
      .toBe("Utseende: ringstorlek 1,2, skalning relativt 1:15 000");
    expect(describeEdit({ type: "UPDATE_COURSE", course: "k", changes: { labelKind: "SEQUENCE_AND_CODE" } }, document))
      .toBe("Vid kontrollerna på Lång: nummer och kod");
    const probe = overprintProbe(layoutOverprint(applyEdit(document, { type: "UPDATE_COURSE", course: "k", changes: { labelKind: "SEQUENCE_AND_CODE" } }).document, { course: "k" }));
    expect(probe.labels).toBe("1-31 2-32");
    expect(Number(probe.ring)).toBeCloseTo(5.35, 3);
  });
});

describe("etiketten", () => {
  it("valen: poängvarianterna bara för poängbanor, exempel ur banan", () => {
    const document = testDocument();
    const course = document.courses[0]!;
    expect(labelKindsFor(course)).toEqual(["SEQUENCE", "CODE", "SEQUENCE_AND_CODE"]);
    expect(labelKindsFor({ ...course, kind: "SCORE" })).toHaveLength(6);
    expect(["SEQUENCE", "CODE", "SEQUENCE_AND_CODE"].map(kind => labelExample(document, course, kind as never))).toEqual(["1", "31", "1-31"]);
    expect(labelExample(document, { ...course, kind: "SCORE" }, "CODE_AND_SCORE")).toBe("31(30)");
    expect(labelExample(document, { ...course, id: "saknas", first: undefined }, "SEQUENCE_AND_CODE")).toBe("1-31");
  });

  it("samma etikett för alla stafettbanor i ett steg; de som har den hoppas över", () => {
    const base = testDocument();
    const relay = { teams: 10, legs: 3 };
    const document: CourseSettingDocument = { ...base, courses: [
      { ...base.courses[0]!, relay }, { ...base.courses[0]!, id: "m", name: "Mellan", order: 2, relay, labelKind: "SEQUENCE_AND_CODE" },
      { ...base.courses[0]!, id: "p", name: "Poäng", order: 3, kind: "SCORE", labelKind: "CODE" }
    ] };
    expect(relayCourses(document).map(course => course.id)).toEqual(["k", "m"]);
    expect(labelKindEdits(relayCourses(document), "SEQUENCE_AND_CODE")).toEqual([
      { type: "UPDATE_COURSE", course: "k", changes: { labelKind: "SEQUENCE_AND_CODE" } }
    ]);
    // Poäng finns bara för poängbanan.
    expect(labelKindEdits(document.courses, "SCORE").map(edit => edit.type === "UPDATE_COURSE" ? edit.course : "")).toEqual(["p"]);
  });
});
