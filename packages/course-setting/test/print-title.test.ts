import { describe, expect, it } from "vitest";
import { applyEdit, BUILT_IN_SHEET_LAYOUTS, fileTitleDiffers, printedTitle, printSheetGroups, type SheetLayout } from "../src";
import { lineCourse } from "./build";

/** Användartestet 2026-11-12: kartorna fick .ppen-filens titel ("Gafflingsurval på kartfilen") i stället för tävlingens namn. */
describe("rubriken på kartorna", () => {
  const fileTitled = () => {
    const { b, course } = lineCourse(3);
    b.edit({ type: "SET_EVENT", changes: { title: "Gafflingsurval på kartfilen" } });
    return { document: b.document, course };
  };

  it("tävlingens namn som förval, filens titel bara när den valts, filens titel utan tävlingens namn", () => {
    const { document } = fileTitled();
    expect(printedTitle(document, "Natt 2")).toBe("Natt 2");
    expect(printedTitle(document, undefined)).toBe("Gafflingsurval på kartfilen");
    expect(printedTitle(document, "  ")).toBe("Gafflingsurval på kartfilen");
    const chosen = applyEdit(document, { type: "SET_EVENT", changes: { printFileTitle: true } }).document;
    expect(printedTitle(chosen, "Natt 2")).toBe("Gafflingsurval på kartfilen");
    // Valet av filens titel med en tom titel i filen ger ändå tävlingens namn.
    const empty = applyEdit(chosen, { type: "SET_EVENT", changes: { title: "" } }).document;
    expect(printedTitle(empty, "Natt 2")).toBe("Natt 2");
  });

  it("skiljer sig: bara när både filen och tävlingen har ett namn och de är olika", () => {
    const { document } = fileTitled();
    expect(fileTitleDiffers(document, "Natt 2")).toBe(true);
    expect(fileTitleDiffers(document, "Gafflingsurval på kartfilen")).toBe(false);
    expect(fileTitleDiffers(document, undefined)).toBe(false);
    expect(fileTitleDiffers(applyEdit(document, { type: "SET_EVENT", changes: { title: "" } }).document, "Natt 2")).toBe(false);
  });

  it("valet är på eller av", () => {
    const { document } = fileTitled();
    expect(() => applyEdit(document, { type: "SET_EVENT", changes: { printFileTitle: "ja" as unknown as boolean } })).toThrow(/på eller av/);
  });

  it("sidhuvudet och mallens {tävling} får tävlingens namn i utskriftens ark (förhandsvisningen och PDF:en)", () => {
    const { document, course } = fileTitled();
    const pages = JSON.stringify(printSheetGroups(document, { kind: "COURSE", header: true }, [{ course }], { raceTitle: "Natt 2" }));
    expect(pages).toContain("Natt 2");
    expect(pages).not.toContain("Gafflingsurval");
    const base = BUILT_IN_SHEET_LAYOUTS.find(row => row.id === "a4-one")!;
    const template: SheetLayout = { ...base, texts: [{ x: 10, y: 10, text: "{tävling} – {bana}", sizeMm: 5, bold: true }] };
    for (const perRunner of [false, true]) {
      const sheets = JSON.stringify(printSheetGroups(document, { kind: "TEMPLATE", template, perRunner }, [{ course }], { raceTitle: "Natt 2" }));
      expect(sheets).toContain("Natt 2 – A");
      expect(sheets).not.toContain("Gafflingsurval");
    }
    // Utan tävlingens namn (eller med filens titel vald) står filens titel kvar.
    expect(JSON.stringify(printSheetGroups(document, { kind: "COURSE", header: true }, [{ course }]))).toContain("Gafflingsurval på kartfilen");
    const chosen = applyEdit(document, { type: "SET_EVENT", changes: { printFileTitle: true } }).document;
    expect(JSON.stringify(printSheetGroups(chosen, { kind: "COURSE", header: true }, [{ course }], { raceTitle: "Natt 2" }))).toContain("Gafflingsurval på kartfilen");
  });
});
