import { describe, expect, it } from "vitest";
import type { DescriptionLayout, DescriptionSymbol } from "@o-tid/course-setting";
import {
  descriptionTextLine, ppenDescriptionLanguage, readDescriptionSettings, refOfSelection, rowArea, targetOfRef, writeDescriptionSettings
} from "./course-setting-description";
import { descriptionNodes, descriptionSvg, symbolLookup, symbolNodes, symbolPoint, textNode } from "./course-setting-description-draw";
import {
  allowsText, boxValue, isPickerBox, moveActive, pickerOptions, readRecent, rememberRecent, sameBoxes, setBox, symbolBoxFor, symbolName, writeRecent
} from "./course-setting-description-picker";
import { copiesOf, cutMarks, layoutPages, svgFileName } from "./course-setting-description-print";
import { ALL_CONTROLS } from "./course-setting-hit";
import { testDocument } from "./course-setting-test-document";

/**
 * Steg 63: kontrollbeskrivningens rena moduler i webben – väljaren, utläggningen på A4, SVG-ritningen och kopplingen till
 * editorns val. Paketets symboler och utläggning ersätts här av små testdubbletter med kontraktets form.
 */
const symbol = (id: string, kind: string, sv: string, en: string, shapes: DescriptionSymbol["shapes"] = []): DescriptionSymbol =>
  ({ id, kind, names: { sv, en }, shapes });
const symbols = [
  symbol("2.4", "D", "Sten", "Boulder"), symbol("2.5", "D", "Stenfält", "Boulder field"), symbol("1.3", "D", "Kulle", "Hill"),
  symbol("5.1", "D", "Väg", "Road"), symbol("8.11", "G", "Mellan", "Between")
];

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
const broken = { getItem: () => { throw new Error("avstängd"); }, setItem: () => { throw new Error("full"); } };

describe("väljaren", () => {
  it("söker på namn på valt språk och på id, oberoende av stora bokstäver", () => {
    const names = (query: string, language = "sv") => pickerOptions(symbols, { box: "D", query, recent: [], language })
      .map(option => option.kind === "symbol" ? option.name : option.kind);
    expect(names("sten")).toEqual(["Sten", "Stenfält"]);
    expect(names("FÄLT")).toEqual(["Stenfält"]);
    expect(names("boulder f", "en")).toEqual(["Boulder field"]);
    expect(names("2.")).toEqual(["Sten", "Stenfält"]);
    expect(names("xyz")).toEqual([]);
    expect(symbolName(symbols[0]!, "de")).toBe("Boulder");
  });

  it("visar senast använda överst och Ingen sist när inget är sökt", () => {
    const options = pickerOptions(symbols, { box: "D", query: "", recent: ["5.1", "okänd", "1.3"], language: "sv" });
    expect(options.map(option => option.kind === "symbol" ? `${option.symbol.id}${option.recent ? "*" : ""}` : option.kind))
      .toEqual(["5.1*", "1.3*", "2.4", "2.5", "8.11", "none"]);
    // Senast använda följer sökningen.
    expect(pickerOptions(symbols, { box: "D", query: "sten", recent: ["2.5"], language: "sv" }).map(option => option.kind === "symbol" ? option.symbol.id : option.kind))
      .toEqual(["2.5", "2.4"]);
  });

  it("tar fri text i F (som paketet och Purple Pen) men inte i D eller G", () => {
    expect(allowsText("F")).toBe(true);
    expect(allowsText("G")).toBe(false);
    expect(allowsText("D")).toBe(false);
    expect(pickerOptions(symbols, { box: "F", query: " 4x4 ", recent: [], language: "sv" })[0]).toEqual({ kind: "text", text: "4x4" });
    expect(pickerOptions(symbols, { box: "D", query: "4x4", recent: [], language: "sv" })).toEqual([]);
  });

  it("minns de senaste utan dubbletter och tål trasig lagring", () => {
    expect(rememberRecent(["1.3", "2.4", "5.1"], "2.4")).toEqual(["2.4", "1.3", "5.1"]);
    expect(rememberRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
    const storage = new MemoryStorage();
    writeRecent(storage, { D: ["2.4"] });
    expect(readRecent(storage)).toEqual({ D: ["2.4"] });
    storage.setItem("otid.course-setting.recent-symbols", "[1,2]");
    expect(readRecent(storage)).toEqual({});
    expect(readRecent(broken)).toEqual({});
    expect(() => writeRecent(broken, { D: [] })).not.toThrow();
    expect(readRecent(undefined)).toEqual({});
  });

  it("flyttar markeringen med tangenterna och går runt", () => {
    expect(moveActive(0, "ArrowDown", 3)).toBe(1);
    expect(moveActive(2, "ArrowDown", 3)).toBe(0);
    expect(moveActive(0, "ArrowUp", 3)).toBe(2);
    expect(moveActive(1, "End", 3)).toBe(2);
    expect(moveActive(2, "Home", 3)).toBe(0);
    expect(moveActive(5, "a", 3)).toBe(2);
    expect(moveActive(0, "ArrowDown", 0)).toBe(0);
  });

  it("sätter, byter och tömmer en ruta i rutornas ordning", () => {
    const boxes = [{ box: "all", ref: "14.3" }, { box: "D", ref: "2.4" }];
    expect(setBox(boxes, "F", { text: "2m" })).toEqual([{ box: "all", ref: "14.3" }, { box: "D", ref: "2.4" }, { box: "F", text: "2m" }]);
    expect(setBox([{ box: "G", ref: "8.11" }], "C", { ref: "0.1N" })).toEqual([{ box: "C", ref: "0.1N" }, { box: "G", ref: "8.11" }]);
    expect(setBox(boxes, "D", null)).toEqual([{ box: "all", ref: "14.3" }]);
    expect(boxValue(boxes, "D")).toEqual({ box: "D", ref: "2.4" });
    expect(sameBoxes(setBox(boxes, "D", { ref: "2.4" }), boxes)).toBe(true);
    expect(sameBoxes(setBox(boxes, "D", { ref: "2.5" }), boxes)).toBe(false);
  });
});

describe("utläggningen på A4", () => {
  const item = (key: string, heightMm = 60) => ({ key, widthMm: 48, heightMm });

  it("lägger beskrivningarna i kolumner uppifrån och ned och börjar en ny sida när bredden tar slut", () => {
    const pages = layoutPages(Array.from({ length: 17 }, (_, index) => item(`b${index}`)));
    // 281 mm höjd: fyra à 60 mm (med 4 mm mellanrum) per kolumn; 194 mm bredd: tre kolumner à 48 mm.
    expect(pages.map(page => page.items.length)).toEqual([12, 5]);
    const first = pages[0]!.items;
    expect(first.slice(0, 5).map(row => [row.x, row.y])).toEqual([[8, 8], [8, 72], [8, 136], [8, 200], [60, 8]]);
    expect(first.every(row => row.x + row.widthMm <= 202 && row.y + row.heightMm <= 289 && row.scale === 1)).toBe(true);
    expect(pages[1]!.items[0]).toMatchObject({ key: "b12", x: 8, y: 8 });
  });

  it("krymper en beskrivning som är större än sidan", () => {
    const [page] = layoutPages([item("lång", 562)]);
    expect(page!.items[0]!.scale).toBeCloseTo(0.5);
    expect(layoutPages([])).toEqual([]);
  });

  it("ritar skärmmarker i hörnen, i mellanrummet och inte över beskrivningen", () => {
    const marks = cutMarks({ x: 10, y: 20, widthMm: 40, heightMm: 30, scale: 1 }, 4);
    expect(marks).toHaveLength(8);
    expect(marks[0]).toEqual({ x1: 9.5, y1: 20, x2: 8, y2: 20 });
    expect(marks[1]).toEqual({ x1: 10, y1: 19.5, x2: 10, y2: 18 });
    for (const mark of marks) {
      const insideX = Math.min(mark.x1, mark.x2) > 10 && Math.max(mark.x1, mark.x2) < 50;
      const insideY = Math.min(mark.y1, mark.y2) > 20 && Math.max(mark.y1, mark.y2) < 50;
      expect(insideX && insideY).toBe(false);
      expect(Math.max(Math.abs(mark.x2 - mark.x1), Math.abs(mark.y2 - mark.y1))).toBeLessThanOrEqual(2);
    }
    expect(cutMarks({ x: 0, y: 0, widthMm: 1, heightMm: 1, scale: 1 }, 0)).toEqual([]);
  });

  it("räknar kopior och filnamn", () => {
    expect(copiesOf("3")).toBe(3);
    expect(copiesOf("0")).toBe(1);
    expect(copiesOf("abc")).toBe(1);
    expect(copiesOf(400)).toBe(50);
    expect(svgFileName("Lång", "AB")).toBe("Lång AB.svg");
    expect(svgFileName("H21/D21: \"kort\"")).toBe("H21-D21- -kort-.svg");
    expect(svgFileName("")).toBe("kontrollbeskrivning.svg");
  });
});

describe("SVG-ritningen", () => {
  it("vänder symbolens ruta (y uppåt, 200 enheter) till papperets mm (y nedåt)", () => {
    expect(symbolPoint({ x: 0, y: 0 }, { x: 10, y: 20 }, 6)).toEqual({ x: 10, y: 20 });
    expect(symbolPoint({ x: 100, y: 100 }, { x: 10, y: 20 }, 6)).toEqual({ x: 13, y: 17 });
    expect(symbolPoint({ x: -100, y: -50 }, { x: 10, y: 20 }, 6)).toEqual({ x: 7, y: 21.5 });
  });

  it("ritar symbolens alla figurer med linjebredder i mm", () => {
    const nodes = symbolNodes([
      { kind: "polyline", points: [{ x: -50, y: 0 }, { x: 50, y: 0 }], width: 10 },
      { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }], width: 10, closed: true },
      { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }] },
      { kind: "circle", center: { x: 0, y: 50 }, radius: 50, width: 20 },
      { kind: "disc", center: { x: 0, y: 0 }, radius: 100 },
      { kind: "bezier", points: [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }], width: 10 },
      { kind: "bezier", points: [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }], width: 0, filled: true }
    ], { x: 3, y: 3 }, 6);
    expect(nodes).toEqual([
      { tag: "path", d: "M1.5 3 L4.5 3", fill: false, strokeWidth: 0.3 },
      { tag: "path", d: "M3 3 L6 3 L3 0 Z", fill: false, strokeWidth: 0.3 },
      { tag: "path", d: "M3 3 L6 3 L3 0 Z", fill: true },
      { tag: "circle", cx: 3, cy: 1.5, r: 1.5, fill: false, strokeWidth: 0.6 },
      { tag: "circle", cx: 3, cy: 3, r: 3, fill: true },
      { tag: "path", d: "M3 3 C3 0 6 0 6 3", fill: false, strokeWidth: 0.3 },
      { tag: "path", d: "M3 3 C3 0 6 0 6 3 Z", fill: true }
    ]);
  });

  it("krymper bara text som inte får plats", () => {
    const base = { kind: "text" as const, at: { x: 1, y: 2 }, heightMm: 3, align: "center" as const };
    expect(textNode({ ...base, text: "31", maxWidth: 6 })).toEqual({ tag: "text", x: 1, y: 2, text: "31", size: 3, bold: false, anchor: "middle" });
    expect(textNode({ ...base, text: "Kvällsträning på kartfilen", maxWidth: 30, bold: true })).toMatchObject({ textLength: 30, bold: true });
  });

  const layout: DescriptionLayout = { widthMm: 48, heightMm: 12, primitives: [
    { kind: "line", from: { x: 0, y: 0 }, to: { x: 48, y: 0 }, width: 0.5 },
    { kind: "text", at: { x: 3, y: 9 }, text: "1 <A&B>", heightMm: 3, align: "left" },
    { kind: "symbol", symbol: "2.4", at: { x: 21, y: 9 }, size: 6, ref: "c2" },
    { kind: "symbol", symbol: "9.9", at: { x: 27, y: 9 }, size: 6, ref: "c2" },
    { kind: "hit", x: 0, y: 6, width: 48, height: 6, ref: "c2" },
    { kind: "hit", x: 18, y: 6, width: 6, height: 6, ref: "c2", box: "D" }
  ] };
  const lookup = symbolLookup([symbol("2.4", "D", "Sten", "Boulder", [{ kind: "disc", center: { x: 0, y: 0 }, radius: 50 }])]);

  it("ritar linjer, text och symboler men inte de markerbara ytorna; okänd symbol syns som sitt id", () => {
    const nodes = descriptionNodes(layout, lookup);
    expect(nodes.map(node => node.tag)).toEqual(["line", "text", "symbol", "symbol"]);
    expect(nodes[2]).toEqual({ tag: "symbol", symbol: "2.4", ref: "c2", children: [{ tag: "circle", cx: 21, cy: 9, r: 1.5, fill: true }] });
    expect(nodes[3]).toMatchObject({ symbol: "9.9", children: [{ tag: "text", text: "9.9" }] });
  });

  it("skriver en fristående SVG i mm, svart på vitt och med texten skyddad", () => {
    const svg = descriptionSvg(layout, lookup, "Lång");
    expect(svg).toContain(`width="48mm" height="12mm" viewBox="0 0 48 12"`);
    expect(svg).toContain("<title>Lång</title>");
    expect(svg).toContain("1 &lt;A&amp;B&gt;");
    expect(svg).toContain(`<g data-symbol="2.4"><circle cx="21" cy="9" r="1.5" fill="#000"/></g>`);
    expect(svg.match(/#[0-9a-f]{3,6}/gi)!.every(color => color === "#000" || color === "#fff")).toBe(true);
    expect(svg).not.toContain("hit");
  });

  it("markerar raden för vald kontroll", () => {
    expect(rowArea(layout, "c2")).toEqual({ kind: "hit", x: 0, y: 6, width: 48, height: 6, ref: "c2" });
    expect(rowArea(layout, "c9")).toBeUndefined();
    expect(rowArea({ ...layout, primitives: layout.primitives.filter(row => row.kind !== "hit" || row.box) }, "c2"))
      .toEqual({ x: 18, y: 6, width: 6, height: 6 });
  });
});

describe("beskrivningen i editorn", () => {
  const document = testDocument();

  it("översätter en rad (kontrollens id) till editorns val och tillbaka", () => {
    expect(targetOfRef(document, "k", "a")).toEqual({ kind: "control", control: "a", courseControl: "c2" });
    expect(targetOfRef(document, ALL_CONTROLS, "a")).toEqual({ kind: "control", control: "a" });
    expect(targetOfRef(document, "k", "c2")).toBeUndefined();
    // Redan vald på banan: samma banans kontroll (en kontroll kan finnas två gånger).
    const chosen = { kind: "control" as const, control: "a", courseControl: "c9" };
    expect(targetOfRef(document, "k", "a", undefined, chosen)).toBe(chosen);
    expect(targetOfRef(document, "saknas", "a")).toEqual({ kind: "control", control: "a" });
    expect(refOfSelection({ kind: "control", control: "a", courseControl: "c2" })).toBe("a");
    expect(refOfSelection({ kind: "leg", from: "a", to: "b" })).toBeUndefined();
    expect(refOfSelection(undefined)).toBeUndefined();
  });

  it("ger rätt symbolslag för riktningsraden och inga rutor C–H på mål och passage", () => {
    expect(symbolBoxFor("all", "FINISH")).toBe("Z");
    expect(symbolBoxFor("all", "CROSSING_POINT")).toBe("X");
    expect(symbolBoxFor("all", "NORMAL")).toBeUndefined();
    expect(symbolBoxFor("D", "NORMAL")).toBe("D");
    expect(symbolBoxFor("D", "FINISH")).toBeUndefined();
    expect(isPickerBox("all")).toBe(true);
    expect(isPickerBox("B")).toBe(false);
    expect(isPickerBox("before")).toBe(false);
  });

  it("läser språket ur .ppen och textraderna ur kontrollen", () => {
    expect(ppenDescriptionLanguage(document)).toBeUndefined();
    const withLanguage = { ...document, event: { ...document.event, raw: [{ xml: `<descriptions lang="en" color="black" />` }] } };
    expect(ppenDescriptionLanguage(withLanguage)).toBe("en");
    const control = { ...document.controls.a!, raw: [{ xml: `<description-text line="after">Följ &amp; snitsel</description-text>` }] };
    expect(descriptionTextLine(control, "after")).toBe("Följ & snitsel");
    expect(descriptionTextLine(control, "before")).toBe("");
    expect(descriptionTextLine({ ...control, descriptionTextLines: { before: "Vatten" } } as typeof control, "before")).toBe("Vatten");
  });

  it("sparar språk och visningssätt per tävling, med filens språk som utgångsläge", () => {
    const storage = new MemoryStorage();
    const withLanguage = { ...document, event: { ...document.event, raw: [{ xml: `<descriptions lang="en" />` }] } };
    expect(readDescriptionSettings(storage, "r1", withLanguage)).toEqual({ language: "en", kind: "SYMBOLS" });
    expect(readDescriptionSettings(storage, "r1", document)).toEqual({ language: "sv", kind: "SYMBOLS" });
    writeDescriptionSettings(storage, "r1", { language: "sv", kind: "SYMBOLS_AND_TEXT" });
    expect(readDescriptionSettings(storage, "r1", withLanguage)).toEqual({ language: "sv", kind: "SYMBOLS_AND_TEXT" });
    expect(readDescriptionSettings(storage, "r2", document)).toEqual({ language: "sv", kind: "SYMBOLS" });
    storage.setItem("otid.course-setting.descriptions.r1", `{"language":"xx","kind":"ALL"}`);
    expect(readDescriptionSettings(storage, "r1", document)).toEqual({ language: "sv", kind: "SYMBOLS" });
    expect(readDescriptionSettings(broken, "r1", document)).toEqual({ language: "sv", kind: "SYMBOLS" });
    expect(() => writeDescriptionSettings(broken, "r1", { language: "sv", kind: "TEXT" })).not.toThrow();
  });
});
