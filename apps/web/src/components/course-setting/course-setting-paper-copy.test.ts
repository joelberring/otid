import { describe, expect, it } from "vitest";
import { applyEdit, effectivePaper, readPpen, type PaperItem } from "@o-tid/course-setting";
import { readFileSync } from "node:fs";
import { copyPaperItemsEdits } from "./course-setting-paper-copy";

/** Kopiera papperets element till andra banor (ägaren 2026-11-08: logotyperna till varje banvariant). */
describe("kopiera element till banor", () => {
  it("egna kopior med nya id:n på samma plats, en ändring per bana", () => {
    const xml = readFileSync(new URL("../../../../../fixtures/course-setting/kartfil.ppen", import.meta.url), "utf8");
    let document = readPpen(xml).document;
    const [first, second] = [...document.courses].sort((a, b) => a.order - b.order);
    if (!second) document = applyEdit(document, { type: "ADD_COURSE", name: "Kort" }).document;
    const target = [...document.courses].sort((a, b) => a.order - b.order).find(row => row.id !== first!.id)!;
    const logo: PaperItem = { id: "p1", kind: "TEXT", at: { corner: "BOTTOM_LEFT", x: 5, y: 5 }, text: "Centrum OK", sizeMm: 4, widthMm: 40, locked: true };
    const ring: PaperItem = { id: "p2", kind: "RECT", at: { corner: "BOTTOM_LEFT", x: 5, y: 15 }, widthMm: 10, heightMm: 10, strokeMm: 0.5, color: "#000000" };
    const edits = copyPaperItemsEdits(document, [logo, ring], [target.id]);
    expect(edits).toHaveLength(1);
    const after = edits.reduce((doc, edit) => applyEdit(doc, edit).document, document);
    const copied = effectivePaper(after, target.id).items.map(row => row.item);
    expect(copied.map(item => item.kind)).toEqual(["TEXT", "RECT"]);
    expect(new Set(copied.map(item => item.id)).size).toBe(2);
    expect(copied[0]).toMatchObject({ text: "Centrum OK", at: logo.at });
    expect(copied[0]!.locked).toBeUndefined();
  });
});
