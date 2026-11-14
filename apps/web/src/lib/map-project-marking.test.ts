import { applyMapRevision, newMapFile, readMapFile, sha256Hex, type MapObject, type MapRevisionChange } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { mapMarkingSv } from "../i18n/map-marking-sv";
import { baseMapMarking } from "./map-project-marking";
import type { CatalogSymbol } from "./map-project-protocol";

const facts = { host: "otid.berring.se", date: "2026-11-14", worker: 34, scale: 15000, scannedAt: "2023-03-30", settings: [["contour_interval", 5], ["formline", 2]] as const,
  calm: 3, clear: [5, 5, 5] as const };
const contour: MapObject = { kind: "line", symbol: "0", path: [{ type: "M", x: -100, y: -60 }, { type: "L", x: 100, y: 60 }] };

function catalogOf(scale: number, set: "ISOM2017-2" | "ISSPROM2019-2" = "ISOM2017-2") {
  const bytes = newMapFile({ symbolSet: set, scale, refPoint: { easting: 674000, northing: 6580000 } });
  const map = readMapFile(bytes, "ny.omap", { sources: true });
  const symbols = new Map<string, CatalogSymbol>([...map.symbols.values()].map(symbol => [symbol.id, { id: symbol.id, code: symbol.code.sub ? `${symbol.code.main}.${symbol.code.sub}` : String(symbol.code.main),
    name: symbol.name, kind: symbol.kind.toLowerCase() as CatalogSymbol["kind"], group: "OTHER", colors: [], count: 0 }]));
  return { bytes, map, symbols };
}

describe("kartans märkning när grundkartan läggs in", () => {
  it("ger ram, logga och ruta på en karta gjord ny i O-Tid, och objekten går att skriva till kartfilen", () => {
    const { bytes, symbols } = catalogOf(15000);
    const marking = baseMapMarking({ symbols, objects: [contour], bounds: undefined, scale: 15000, text: mapMarkingSv, facts })!;
    expect(marking.paper).toBe("A4 liggande");
    expect(marking.objects.map(object => object.kind).slice(0, 3)).toEqual(["line", "point", "text"]);
    const texts = marking.objects.flatMap(object => object.kind === "text" ? [object.text] : []);
    expect(texts[0]).toBe("Gjord med O-Tid");
    expect(texts.join(" ")).toContain("otid.berring.se · 2026-11-14 · geo-arbetaren 34");
    expect(texts.join(" ")).toContain("skannad 2023-03-30");
    expect(texts.join(" ")).toContain("Inställningar: skala 1:15 000 · ekvidistans (m) 5 · hjälpkurvor 2 · lugna kurvor 3 · tydligare kurvbild 5/5/5");
    expect(texts.join(" ")).toContain("samråd i förväg med markägare");
    // Hela vägen till filen: de nya objekten (också texterna) skrivs och läses tillbaka.
    const changes: MapRevisionChange[] = marking.objects.map((object, index) => ({ kind: "add", author: "test", at: "2026-11-14T12:00:00.000Z", id: `m${index}`, symbol: object.symbol,
      geometry: object.kind === "line" ? { kind: "line", path: object.path } : object.kind === "area" ? { kind: "area", rings: object.rings } : { kind: object.kind, at: object.at },
      ...(object.kind === "text" ? { text: object.text } : {}) }));
    const result = applyMapRevision(bytes, { baseFileSha256: sha256Hex(bytes), format: "OMAP", changes });
    expect(result.ok).toBe(true);
    if (result.ok) expect(readMapFile(result.bytes, "ny.omap").objects).toHaveLength(marking.objects.length);
  });
  it("förstorar texten på 1:10 000 och finns också på sprintkartor", () => {
    const small = baseMapMarking({ ...catalogOf(15000), objects: [contour], bounds: undefined, scale: 15000, text: mapMarkingSv, facts })!;
    const large = baseMapMarking({ ...catalogOf(10000), objects: [contour], bounds: undefined, scale: 10000, text: mapMarkingSv, facts })!;
    const step = (objects: readonly MapObject[]) => { const ys = objects.flatMap(object => object.kind === "text" ? [object.at.y] : []); return ys[2]! - ys[3]!; };
    expect(step(large.objects) / step(small.objects)).toBeCloseTo(1.5, 3);
    expect(baseMapMarking({ ...catalogOf(4000, "ISSPROM2019-2"), objects: [contour], bounds: undefined, scale: 4000, text: mapMarkingSv, facts })).toBeDefined();
  });
  it("ger inget på en karta utan märkningens symboler, eller som redan har en ram", () => {
    const { symbols } = catalogOf(15000);
    const without = new Map([...symbols].filter(([, symbol]) => !symbol.code.startsWith("99")));
    expect(baseMapMarking({ symbols: without, objects: [contour], bounds: undefined, scale: 15000, text: mapMarkingSv, facts })).toBeUndefined();
    const framed = new Map([...symbols].map(([id, symbol]) => [id, symbol.code === "990" ? { ...symbol, count: 1 } : symbol]));
    expect(baseMapMarking({ symbols: framed, objects: [contour], bounds: undefined, scale: 15000, text: mapMarkingSv, facts })).toBeUndefined();
  });
});
