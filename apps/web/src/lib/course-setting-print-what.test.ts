import { describe, expect, it } from "vitest";
import type { MapBundleResponse } from "@o-tid/contracts";
import { applyEdit, type CourseSettingDocument, type CourseSettingEdit } from "@o-tid/course-setting";
import { classItems, layoutItems, proofItems, withCopies } from "./course-setting-print-what";
import { testDocument } from "./course-setting-test-document";

/** ADR-0217 beslut 8: vad Utskrift-fliken skriver ut och hur många. */
const apply = (document: CourseSettingDocument, ...edits: CourseSettingEdit[]) => edits.reduce((doc, edit) => applyEdit(doc, edit).document, document);
const setup = () => apply(testDocument(), { type: "ADD_LAYOUT", layout: { id: "aldre", name: "Äldre A4", scale: 7500, page: { width: 827, height: 1169, margins: 28, landscape: false } } },
  { type: "SET_CLASS_LAYOUTS", classes: { H70: "aldre" } });
const bundles = {
  reserve: { kind: "PERCENT", value: 10 },
  classes: [{ name: "H70", courseName: "Lång", variantCodes: [] }, { name: "H21", courseName: "Lång", variantCodes: [] }],
  rows: [...Array.from({ length: 12 }, () => ({ className: "H70", courseName: "Lång", variantCode: null })), { className: "H21", courseName: "Lång", variantCode: null }]
} as unknown as Pick<MapBundleResponse, "classes" | "rows" | "reserve">;

describe("utskriftens urval", () => {
  it("alla ark i en layout: huvudlayouten de valda banorna, en annan layout banorna med ark eller klasser", () => {
    const document = setup();
    expect(layoutItems(document, "MAIN", ["k"], false)).toEqual([{ course: "k" }]);
    expect(layoutItems(document, "aldre", ["k"], false)).toEqual([]);
    expect(layoutItems(document, "aldre", ["k"], false, bundles)).toEqual([{ course: "k", layout: "aldre" }]);
  });

  it("antal: anmälda + reserver per layout (12 + 2 i Äldre, 1 + 1 i huvudlayouten) eller eget", () => {
    const document = setup();
    expect(withCopies(document, bundles, [{ course: "k", layout: "aldre" }], { kind: "ENTERED" })).toHaveLength(14);
    expect(withCopies(document, bundles, [{ course: "k" }], { kind: "ENTERED" })).toHaveLength(2);
    expect(withCopies(document, bundles, [{ course: "k" }], { kind: "OWN", copies: 3 })).toHaveLength(3);
  });

  it("klasser: klassens bana i klassens layout; provark: ett av varje ark", () => {
    const document = setup();
    expect(classItems(document, bundles, ["H70"], { kind: "OWN", copies: 1 })).toEqual([{ course: "k", layout: "aldre" }]);
    expect(classItems(document, bundles, ["H21"], { kind: "ENTERED" })).toHaveLength(2);
    expect(proofItems(document, bundles)).toEqual([{ course: "k" }, { course: "k", layout: "aldre" }]);
  });
});
