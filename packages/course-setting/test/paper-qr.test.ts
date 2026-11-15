/** Papperets QR-kod (ägaren 2026-11-16): kontrollen, sparningen i layouten, adresserna och delarna som ritas. */
import { describe, expect, it } from "vitest";
import {
  layoutCoursePage, paperItemSize, paperLinksFor, paperQrModules, paperQrUrl, printSheetGroups, shortPaperAddress, validatePaperItem, validatePaperLayout,
  validPaperLinks, type PaperItem, type PaperPart
} from "../src";
import { lineCourse } from "./build";

const qr: PaperItem = { id: "q1", kind: "QR_CODE", at: { corner: "BOTTOM_RIGHT", x: 3, y: 3 }, sizeMm: 25, target: "RACE" };
const links = paperLinksFor("https://otid.berring.se/", "x2y3z4", true);

describe("papperet: QR-kod", () => {
  it("läses och skrivs: förvalet, egen adress, texten under och okända fält bort", () => {
    expect(validatePaperItem(qr)).toEqual(qr);
    expect(validatePaperItem({ ...qr, target: "CUSTOM", url: " https://example.se/anmälan?x=1 ", caption: "  Anmälan ", extra: 1 } as never)).toEqual({
      ...qr, target: "CUSTOM", url: "https://example.se/anm%C3%A4lan?x=1", caption: "Anmälan" });
    // Adressen sparas bara för en egen adress; tom text = ingen text under.
    expect(validatePaperItem({ ...qr, target: "OTID", url: "https://annan.se", caption: "" } as never)).toEqual({ ...qr, target: "OTID", caption: "" });
    const layout = validatePaperLayout({ items: [qr, { ...qr, id: "q2", target: "BINGO", sizeMm: 15, relativeTo: "PAGE" }] });
    expect(JSON.parse(JSON.stringify(layout))).toEqual(layout);
    expect(layout.items?.map(item => item.kind)).toEqual(["QR_CODE", "QR_CODE"]);
  });

  it("ogiltigt: adress som inte är https, mellanslag, för liten eller okänt mål", () => {
    for (const url of ["http://otid.berring.se", "javascript:alert(1)", "https://otid berring.se", "otid.berring.se", "https://user:pw@otid.berring.se", `https://x.se/${"a".repeat(300)}`]) {
      expect(() => validatePaperItem({ ...qr, target: "CUSTOM", url } as never), url).toThrow(/adress/);
    }
    expect(() => validatePaperItem({ ...qr, target: "CUSTOM" } as never)).toThrow(/adress/);
    expect(() => validatePaperItem({ ...qr, sizeMm: 14.9 })).toThrow(/storlek/);
    expect(() => validatePaperItem({ ...qr, sizeMm: 101 })).toThrow(/storlek/);
    expect(() => validatePaperItem({ ...qr, target: "ANNAN" } as never)).toThrow(/leder/);
    expect(() => validatePaperItem({ ...qr, caption: "två\nrader" })).toThrow(/texten/);
  });

  it("adresserna byggs ur den publika adressen; bingon bara när den är på", () => {
    expect(links).toEqual({ site: "https://otid.berring.se", race: "https://otid.berring.se/t/x2y3z4", bingo: "https://otid.berring.se/t/x2y3z4/bingo" });
    expect(paperLinksFor("http://127.0.0.1:3000", "abcdef", false)).toEqual({ site: "http://127.0.0.1:3000", race: "http://127.0.0.1:3000/t/abcdef" });
    expect(paperQrUrl({ target: "OTID" }, links)).toBe("https://otid.berring.se");
    expect(paperQrUrl({ target: "BINGO" }, paperLinksFor("https://otid.berring.se", "x2y3z4", false))).toBeUndefined();
    expect(paperQrUrl({ target: "RACE" }, undefined)).toBeUndefined();
    expect(shortPaperAddress(links.race!)).toBe("otid.berring.se/t/x2y3z4");
    expect(shortPaperAddress("https://otid.berring.se/")).toBe("otid.berring.se");
    expect(validPaperLinks({ ...links, okänt: 1 })).toEqual(links);
    expect(validPaperLinks({ site: "ftp://x" })).toBeUndefined();
  });

  it("delarna: vit botten, modulerna som vektorrutor med tyst zon och adressen kort under", () => {
    const built = lineCourse(3);
    built.b.edit({ type: "SET_PAPER_LAYOUT", course: built.course, layout: { items: [qr] } });
    const page = layoutCoursePage(built.b.document, { course: built.course, paperLinks: links })[0]!;
    const item = page.paperItems!.find(row => row.kind === "QR_CODE")!;
    const [background, cells, caption] = item.parts as [PaperPart, PaperPart, PaperPart];
    expect(background).toMatchObject({ kind: "rect", fill: "WHITE", width: 25 });
    expect(caption).toMatchObject({ kind: "text", text: "otid.berring.se/t/x2y3z4", align: "center" });
    if (cells.kind !== "cells") throw new Error("inga moduler");
    const { size, dark } = paperQrModules(links.race!);
    expect(cells.modules).toBe(size);
    const module = 25 / (size + 8);
    // Rutorna täcker exakt de svarta modulerna, och innanför den tysta zonen.
    const covered = cells.rects.reduce((sum, r) => sum + Math.round(r.width / module), 0);
    expect(covered).toBe(dark.reduce((sum: number, value) => sum + value, 0));
    expect(Math.min(...cells.rects.map(r => r.x)) - item.rect.x).toBeCloseTo(4 * module, 6);
    expect(item.rect.height).toBeCloseTo(paperItemSize(qr, undefined, links).height, 6);
    expect(item.rect.height).toBeGreaterThan(25);
  });

  it("utan känd adress: en ram med texten QR-kod i stället för en kod som leder fel; ingen text = bara koden", () => {
    const built = lineCourse(3);
    built.b.edit({ type: "SET_PAPER_LAYOUT", course: built.course, layout: { items: [{ ...qr, caption: "" }] } });
    const sheets = (options: Parameters<typeof printSheetGroups>[3]) =>
      printSheetGroups(built.b.document, { kind: "COURSE" }, [{ course: built.course }], options).flatMap(group => group.sheets);
    const without = sheets({})[0]!.paperItems!.find(row => row.kind === "QR_CODE")!;
    expect(without.parts.map(part => part.kind)).toEqual(["rect", "text"]);
    const shown = sheets({ paperLinks: links })[0]!.paperItems!.find(row => row.kind === "QR_CODE")!;
    expect(shown.parts.map(part => part.kind)).toEqual(["rect", "cells"]);
    expect(shown.rect.height).toBe(25);
  });
});
