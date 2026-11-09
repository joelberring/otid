import { describe, expect, it } from "vitest";
import {
  EMPTY_LAYERS, layerOf, layerRows, layerSymbols, mergeSuggestions, standardFor, standardSymbols, withLayerFlag, withSymbolFlag
} from "./map-project-layer-model";
import type { CatalogSymbol } from "./map-project-protocol";

const symbol = (id: string, code: string, name: string, kind: CatalogSymbol["kind"], count: number): CatalogSymbol =>
  ({ id, code, name, kind, count, group: code.startsWith("4") ? "VEGETATION" : code.startsWith("1") ? "LANDFORMS" : "OTHER", icon: undefined });

describe("lagren efter normen", () => {
  const isom = standardSymbols("ISOM");
  const catalog = [symbol("a", "101.0", "Höjdkurva", "line", 40), symbol("b", "406", "Skog, löphindrande", "area", 12),
    symbol("c", "406.1", "Skog, långsamt löpbar", "area", 5), symbol("d", "950", "Egen", "point", 1), symbol("e", "406.0", "Skog", "area", 3)];

  it("lägger symbolerna i normens grupper och det som inte finns i normen för sig", () => {
    expect(standardFor(4000)).toBe("ISSPROM");
    expect(standardFor(10000)).toBe("ISOM");
    expect(layerOf(catalog[0]!, isom)).toBe("LANDFORMS");
    expect(layerOf(catalog[2]!, isom)).toBe("OUTSIDE");
    expect(layerRows(catalog, isom, EMPTY_LAYERS).map(row => [row.id, row.count])).toEqual([["LANDFORMS", 40], ["VEGETATION", 15], ["OUTSIDE", 6]]);
  });

  it("släcker, låser och tonar ned lager och underlager", () => {
    let state = withLayerFlag(EMPTY_LAYERS, catalog, isom, "VEGETATION", "locked", true);
    state = withLayerFlag(state, catalog, isom, "VEGETATION", "dimmed", true);
    state = withSymbolFlag(state, "e", "locked", false);
    state = withLayerFlag(state, catalog, isom, "OUTSIDE", "hidden", true);
    expect(layerSymbols(catalog, isom, state)).toEqual({ hidden: ["c", "d"], locked: ["b"], dimmed: ["b"] });
    // Ett nytt val för lagret gäller alla underlager igen.
    state = withLayerFlag(state, catalog, isom, "VEGETATION", "locked", true);
    expect(layerSymbols(catalog, isom, state).locked).toEqual(["b", "e"]);
  });

  it("föreslår att slå ihop symboler med samma nummer eller namn, in i den som följer normen", () => {
    expect(mergeSuggestions(catalog, isom).map(row => [row.from.id, row.to.id, row.reason])).toEqual([["e", "b", "SAME_CODE"]]);
  });
});
