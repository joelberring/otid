import { describe, expect, it } from "vitest";
import { applyEdit, type CourseSettingDocument, type CourseSettingEdit } from "@o-tid/course-setting";
import { paperUndoFor } from "./course-setting-paper";
import { testDocument } from "./course-setting-test-document";

/** Ångra av papperet för en kartbytets del (ADR-0203) återställer delens papper, inte hela banans (städrundan, fas 3). */
const apply = (document: CourseSettingDocument, ...edits: CourseSettingEdit[]) => edits.reduce((doc, edit) => applyEdit(doc, edit).document, document);
const text = (id: string, value: string) => ({ id, kind: "TEXT" as const, at: { corner: "TOP_LEFT" as const, x: 1, y: 1 }, text: value, sizeMm: 4, widthMm: 30 });

describe("ångra papperet för en del", () => {
  it("återställer delens papper och lämnar banans orört", () => {
    const before = apply(testDocument(), { type: "SET_PAPER_LAYOUT", course: "k", layout: { items: [text("b", "Banans")] } },
      { type: "SET_PAPER_LAYOUT", course: "k", part: 1, layout: { items: [text("d", "Del 2 före")] } });
    const edit: CourseSettingEdit = { type: "SET_PAPER_LAYOUT", course: "k", part: 1, layout: { items: [text("d", "Del 2 efter")] } };
    const undo = paperUndoFor(before, [edit]);
    expect(undo).toEqual([{ type: "SET_PAPER_LAYOUT", course: "k", part: 1, layout: { items: [text("d", "Del 2 före")] } }]);
    const restored = apply(apply(before, edit), ...undo);
    expect(restored.event.paperLayouts).toEqual(before.event.paperLayouts);
  });

  it("en borttagen mall: delarna som ärvde av den får sitt papper tillbaka med delen", () => {
    const template = { schemaVersion: 1 as const, id: "m", name: "Mall", items: [] };
    const before = apply(testDocument(), { type: "PUT_PAPER_TEMPLATE", template }, { type: "SET_PAPER_LAYOUT", course: "k", part: 0, layout: { template: "m" } });
    const undo = paperUndoFor(before, [{ type: "DELETE_PAPER_TEMPLATE", id: "m" }]);
    expect(undo).toContainEqual({ type: "SET_PAPER_LAYOUT", course: "k", part: 0, layout: { template: "m" } });
  });
});
