/** Symboldatan: alla symboler i båda standarderna har ritning och namn, och väljarens ordning är Purple Pens. */
import { describe, expect, it } from "vitest";
import { DESCRIPTION_LANGUAGES, descriptionSymbols, symbolsForBox } from "../src";
import { symbolDb } from "../src/description-symbols";

/** Hjälpsymbolerna för texten (mått, "single"-varianterna) och texterna "@" ritas aldrig. */
const TEXT_ONLY = new Set(["9.1high", "9.1deep", "9.2", "9.3high", "9.3deep", "9.4", "10.1single", "10.2single", "11.15single"]);

describe("symbolerna ur symbols.xml", () => {
  it("har alla 201 symboler, fem språk och båda standarderna", () => {
    expect(symbolDb().data.symbols).toHaveLength(201);
    expect(DESCRIPTION_LANGUAGES.map(language => language.id).sort()).toEqual(["de", "en", "fi", "nb-NO", "sv"]);
    expect(descriptionSymbols("2004")).toHaveLength(180);
    expect(descriptionSymbols("2018")).toHaveLength(183);
  });

  for (const standard of ["2004", "2018"] as const) {
    it(`varje symbol i ${standard} har ritning och namn på svenska och engelska`, () => {
      const db = symbolDb();
      const ids = new Set(db.all(standard).filter(symbol => symbol.kind !== "@" && !TEXT_ONLY.has(symbol.id)).map(symbol => symbol.id));
      const drawn = new Map(descriptionSymbols(standard).map(symbol => [symbol.id, symbol]));
      expect([...ids].filter(id => !drawn.has(id))).toEqual([]);
      for (const symbol of drawn.values()) {
        expect(symbol.shapes.length, symbol.id).toBeGreaterThan(0);
        expect(symbol.names.sv?.trim(), `${symbol.id} sv`).toBeTruthy();
        expect(symbol.names.en?.trim(), `${symbol.id} en`).toBeTruthy();
        for (const shape of symbol.shapes) {
          const points = shape.kind === "circle" || shape.kind === "disc" ? [shape.center] : shape.points;
          for (const p of points) expect(Number.isFinite(p.x) && Number.isFinite(p.y), symbol.id).toBe(true);
          if (shape.kind === "bezier") expect((shape.points.length - 1) % 3, symbol.id).toBe(0);
        }
      }
    });
  }

  it("2018 ersätter 2004 där standarderna har olika ritning eller symbol", () => {
    const in2004 = new Map(descriptionSymbols("2004").map(symbol => [symbol.id, symbol]));
    const in2018 = new Map(descriptionSymbols("2018").map(symbol => [symbol.id, symbol]));
    expect(in2018.get("1.10")!.standard).toBe("2018");
    expect(in2004.get("1.10")!.standard).toBe("2004");
    expect(in2018.get("1.10")!.shapes).not.toEqual(in2004.get("1.10")!.shapes);
    expect(in2018.get("11.7")!.kind).toBe("F");
    expect(in2004.get("11.7")!.kind).toBe("G");
    for (const id of ["2.10", "5.25", "5.26", "15.6"]) {
      expect(in2018.has(id), id).toBe(true);
      expect(in2004.has(id), id).toBe(false);
    }
    expect(in2004.has("12.3")).toBe(true);
    expect(in2018.has("12.3")).toBe(false);
    expect(in2018.get("2.4")).toBe(in2018.get("2.4"));
    expect(in2018.get("5.26")!.names.sv).toBe("Järnväg");
  });

  it("väljarens rutor i Purple Pens ordning (E visar E och sedan D)", () => {
    const ids = (box: string) => symbolsForBox(box, "2018").map(symbol => symbol.id);
    expect(ids("C")).toEqual(["0.1N", "0.2NE", "0.1E", "0.2SE", "0.1S", "0.2SW", "0.1W", "0.2NW", "0.3", "0.4", "0.5"]);
    expect(ids("D")[0]).toBe("1.1");
    expect(ids("E").slice(0, 11)).toEqual(["8.1", "8.2", "8.3", "8.4", "8.5", "8.6", "8.7", "8.8", "8.9", "8.10", "8.11"]);
    expect(ids("E").slice(11)).toEqual(ids("D"));
    expect(ids("F")).toEqual(["10.1", "10.2", "11.7"]);
    expect(symbolsForBox("F", "2004").map(symbol => symbol.id)).toEqual(["10.1", "10.2"]);
    expect(ids("G")).toContain("11.15");
    expect(ids("H")).toEqual(["12.1", "12.2", "12.4"]);
    expect(ids("Z")).toEqual(["14.1", "14.2", "14.3"]);
    expect(ids("X")).toEqual(["13.3", "13.4"]);
    expect(ids("A")).toEqual([]);
  });
});
