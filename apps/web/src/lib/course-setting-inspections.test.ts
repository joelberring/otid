import { describe, expect, it } from "vitest";
import { applyEdit, layoutOverprint, writePpen } from "@o-tid/course-setting";
import { filterInspectionRows, inspectedPoints, inspectionRows, mergeInspections } from "./course-setting-inspections";
import { testDocument } from "./course-setting-test-document";

const bea = { accountId: "20000000-0000-4000-8000-000000000002", displayName: "Bea" };
const kim = { accountId: "20000000-0000-4000-8000-000000000003", displayName: "Kim" };

describe("steg 67: kollad per kontroll", () => {
  it("väntande bockar och avbockningar läggs ovanpå serverns, den senaste vinner", () => {
    const server = [{ control: "a", checkedAt: "2026-11-01T10:00:00.000Z", checkedBy: kim, at: { x: 10, y: 0 } }];
    const merged = mergeInspections(server, [
      { formatVersion: 1, control: "b", checked: true, at: "2026-11-01T10:05:00.000Z", position: { x: 20, y: 10 } },
      { formatVersion: 1, control: "a", checked: false, at: "2026-11-01T09:00:00.000Z", position: null }
    ], bea);
    expect(merged.get("a")?.checkedBy).toEqual(kim);
    expect(merged.get("b")).toMatchObject({ checkedBy: bea, pending: true });
    const later = mergeInspections(server, [{ formatVersion: 1, control: "a", checked: false, at: "2026-11-01T10:10:00.000Z", position: null }], bea);
    expect(later.has("a")).toBe(false);
  });

  it("listan: bara vanliga kontroller i nummerordning; ej kollade och flyttade efter kollen under filtret", () => {
    const document = applyEdit(testDocument(), { type: "MOVE_CONTROL", control: "b", at: { x: 20, y: 11 } }).document;
    const inspections = mergeInspections([
      { control: "a", checkedAt: "2026-11-01T10:00:00.000Z", checkedBy: kim, at: { x: 10, y: 0 } },
      { control: "b", checkedAt: "2026-11-01T10:00:00.000Z", checkedBy: kim, at: { x: 20, y: 10 } }
    ], [], bea);
    const rows = inspectionRows(document, ["s", "b", "a", "f"], inspections);
    expect(rows.map(row => [row.code, Boolean(row.inspection), row.movedSince])).toEqual([["31", true, false], ["32", true, true]]);
    expect(filterInspectionRows(rows, "UNCHECKED").map(row => row.code)).toEqual(["32"]);
    expect(filterInspectionRows(inspectionRows(document, ["a", "b"], new Map()), "UNCHECKED")).toHaveLength(2);
    expect(inspectedPoints(document, new Set(["a", "b"]), inspections)).toEqual([{ at: { x: 10, y: 0 }, moved: false },
      { at: { x: 20, y: 11 }, moved: true }]);
  });

  it("bockarna finns inte i dokumentet: banpåtrycket och .ppen är desamma", () => {
    const document = testDocument();
    const before = { overprint: layoutOverprint(document, { course: "k" }), ppen: writePpen(document) };
    mergeInspections([{ control: "a", checkedAt: "2026-11-01T10:00:00.000Z", checkedBy: kim, at: { x: 10, y: 0 } }], [], bea);
    expect(layoutOverprint(document, { course: "k" })).toEqual(before.overprint);
    expect(writePpen(document)).toBe(before.ppen);
  });
});
