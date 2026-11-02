import { describe, expect, it } from "vitest";
import type { CourseSettingDocument, DescriptionSuggestion, DescriptionSymbol } from "@o-tid/course-setting";
import { symbolLookup } from "./course-setting-description-draw";
import { ALL_CONTROLS } from "./course-setting-hit";
import {
  acceptEdit, acceptEmptyEdits, controlsInView, currentSuggestions, highlightShapes, previewDocument, shortText, suggestKey, suggestTargets
} from "./course-setting-suggest";
import { testDocument } from "./course-setting-test-document";

/** ADR-0180 beslut 12: förslagen i editorn – vilka kontroller som räknas, godta, förhandsvisning och texten i fältläget. */
const stone: DescriptionSuggestion = {
  boxes: [{ box: "D", ref: "2.4" }, { box: "G", ref: "11.1N" }], confidence: 0.9, level: "HIGH", reason: "Sten (ISOM 204) 2 m från centrum",
  features: [{ code: "204.0", name: "Sten", matchedBy: "NUMBER", geometry: "point", distanceMeters: 2, at: { x: 10, y: 0 }, shape: [[{ x: 10, y: 0 }]] }]
};
const knoll: DescriptionSuggestion = { ...stone, boxes: [{ box: "D", ref: "1.10" }], confidence: 0.5, level: "MEDIUM",
  features: [{ ...stone.features[0]!, shape: [[{ x: 1, y: 1 }, { x: 2, y: 2 }]] }] };
const withD = (document: CourseSettingDocument, id: string): CourseSettingDocument =>
  ({ ...document, controls: { ...document.controls, [id]: { ...document.controls[id]!, descriptions: [{ box: "D", ref: "5.2" }] } } });

describe("förslagen i editorn", () => {
  it("räknar för vyns vanliga kontroller utan detalj och för vald kontroll", () => {
    const document = withD(testDocument(), "b");
    expect(controlsInView(document, "k", undefined)).toEqual(["a", "b"]);
    expect(controlsInView(document, ALL_CONTROLS, undefined)).toEqual(["a", "b"]);
    expect(suggestTargets(document, "k", undefined, undefined).map(point => point.id)).toEqual(["a"]);
    expect(suggestTargets(document, "k", undefined, "b").map(point => point.id)).toEqual(["a", "b"]);
    expect(suggestTargets(document, "k", undefined, "s").map(point => point.id)).toEqual(["a"]);
  });
  it("nyckeln ändras när en kontroll flyttas; förslag för en flyttad kontroll gäller inte", () => {
    const document = testDocument();
    const points = suggestTargets(document, "k", undefined, undefined);
    const moved = { ...document, controls: { ...document.controls, a: { ...document.controls.a!, at: { x: 11, y: 0 } } } };
    expect(suggestKey(points, {})).not.toBe(suggestKey(suggestTargets(moved, "k", undefined, undefined), {}));
    const result = { points, suggestions: { a: [stone], b: [knoll] } };
    expect(Object.keys(currentSuggestions(result, document))).toEqual(["a", "b"]);
    expect(Object.keys(currentSuggestions(result, moved))).toEqual(["b"]);
  });
  it("godta ger SET_DESCRIPTION som behåller mått; godta alla tomma bara för kontroller utan detalj", () => {
    const document = testDocument();
    const measured = { ...document, controls: { ...document.controls, a: { ...document.controls.a!, descriptions: [{ box: "F", text: "1.5" }] } } };
    expect(acceptEdit(measured, "a", stone)).toEqual({ type: "SET_DESCRIPTION", control: "a",
      boxes: [{ box: "D", ref: "2.4" }, { box: "F", text: "1.5" }, { box: "G", ref: "11.1N" }] });
    expect(acceptEmptyEdits(withD(document, "b"), "k", undefined, { a: [stone], b: [knoll] })).toEqual([
      { type: "SET_DESCRIPTION", control: "a", boxes: stone.boxes }]);
  });
  it("förhandsvisar bästa förslaget bara där detalj saknas, utan att ändra dokumentet", () => {
    const document = withD(testDocument(), "b");
    const shown = previewDocument(document, { a: [stone, knoll], b: [knoll] });
    expect([...shown.preview]).toEqual(["a"]);
    expect(shown.document.controls.a!.descriptions).toEqual(stone.boxes);
    expect(shown.document.controls.b!.descriptions).toEqual([{ box: "D", ref: "5.2" }]);
    expect(document.controls.a!.descriptions).toEqual([]);
    expect(previewDocument(document, {}).document).toBe(document);
  });
  it("kort text för fältläget och objekten för markeringen", () => {
    const symbol = (id: string, sv: string): DescriptionSymbol => ({ id, kind: "D", names: { sv, en: sv }, shapes: [] });
    expect(shortText(stone, symbolLookup([symbol("2.4", "Sten"), symbol("11.1N", "Norra sidan")]))).toBe("sten, norra sidan");
    expect(highlightShapes(knoll)).toEqual([[{ x: 1, y: 1 }, { x: 2, y: 2 }]]);
    expect(highlightShapes(undefined)).toEqual([]);
  });
});
