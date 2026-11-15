import { describe, expect, it } from "vitest";
import {
  EMPTY_LAYERS, layerOf, layerRows, layerSuggestions, layerSymbols, mergeSuggestions, standardFor, withGroupKey, standardSymbols, withLayerFlag, withSymbolFlag, withWorkFlag
} from "./map-project-layer-model";
import type { CatalogSymbol } from "./map-project-protocol";

const symbol = (id: string, code: string, name: string, kind: CatalogSymbol["kind"], count: number): CatalogSymbol =>
  ({ id, code, name, kind, count, group: code.startsWith("4") ? "VEGETATION" : code.startsWith("1") ? "LANDFORMS" : "OTHER", icon: undefined, colors: [] });

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
    expect(layerSymbols(catalog, isom, state)).toEqual({ hidden: ["c", "d"], locked: ["b"], dimmed: ["b"], shown: [] });
    // Ett nytt val för lagret gäller alla underlager igen.
    state = withLayerFlag(state, catalog, isom, "VEGETATION", "locked", true);
    expect(layerSymbols(catalog, isom, state).locked).toEqual(["b", "e"]);
  });

  it("föreslår att slå ihop symboler med samma nummer eller namn, in i den som följer normen", () => {
    expect(mergeSuggestions(catalog, isom).map(row => [row.from.id, row.to.id, row.reason])).toEqual([["e", "b", "SAME_CODE"]]);
  });

  it("arbetslager: släckt, låst eller tonat gäller symbolerna i lagret före huvudlagret, men inte före symbolens egna val", () => {
    const work = [{ layerId: "w1", codes: ["101", "406"] }, { layerId: "w2", codes: ["406"] }];
    let state = withWorkFlag(EMPTY_LAYERS, "w1", "hidden", true);
    expect(layerSymbols(catalog, isom, state, work).hidden).toEqual(["a", "b", "e"]);
    state = withWorkFlag(withWorkFlag(state, "w1", "hidden", false), "w2", "locked", true);
    state = withSymbolFlag(state, "e", "locked", false);
    expect(layerSymbols(catalog, isom, state, work)).toEqual({ hidden: [], locked: ["b"], dimmed: [], shown: [] });
  });

  it("skisslager ur kartfilen: dolda symboler i ett eget lager, släckt och låst tills man tänder det", () => {
    const sprint = standardSymbols("ISSPROM");
    const file = { ...symbol("h", "990.501.1", "GRUNDKARTA (CAD, dold): Step or edge of paved area", "line", 17637), fileHidden: true };
    const all = [symbol("k", "501.1", "Step or edge of paved area", "line", 1021), file];
    expect(layerOf(file, sprint)).toBe("FILE");
    expect(layerRows(all, sprint, EMPTY_LAYERS).find(row => row.id === "FILE")?.flags).toEqual({ hidden: true, locked: true, dimmed: false });
    expect(layerSymbols(all, sprint, EMPTY_LAYERS)).toMatchObject({ hidden: ["h"], shown: [] });
    // Tänt: ritas (shown) men är fortfarande låst; 0 tänder kartans lager men inte skisslagren.
    const on = withLayerFlag(EMPTY_LAYERS, all, sprint, "FILE", "hidden", false);
    expect(layerSymbols(all, sprint, on)).toMatchObject({ hidden: [], shown: ["h"], locked: ["h"] });
    expect(layerSymbols(all, sprint, withGroupKey(EMPTY_LAYERS, all, sprint, 0, false)).hidden).toEqual(["h"]);
  });

  it("föreslår att föra över skisslager efter nummer med prefix, namn efter kolon, utseende och DWG-lagrets namn", () => {
    const sprint = standardSymbols("ISSPROM");
    const edge = { ...symbol("k", "501.1", "Step or edge of paved area", "line", 1021), stroke: "#000000", width: 0.14 };
    const house = { ...symbol("b", "521", "Building", "area", 820), fill: "#808080" };
    const cad = { ...symbol("h", "990.501.1", "GRUNDKARTA (CAD, dold): Step or edge of paved area", "line", 17637), fileHidden: true,
      layers: [{ name: "VagavgransningInfartglBOdefini", count: 7906 }, { name: "TrafikanlaggningTerrangtrappag", count: 3957 }] };
    const named = { ...symbol("n", "990.521", "GRUNDKARTA (CAD, dold): Building", "area", 2605), fileHidden: true };
    const look = { ...symbol("l", "900.234", "CAD kontrollunderlag: Kant", "line", 3072), fileHidden: true, stroke: "#000000", width: 0.14 };
    const rows = mergeSuggestions([edge, house, cad, named, look], sprint).map(row => [row.from.id, row.to.id, row.reason]);
    expect(rows).toEqual([["h", "k", "CODE_SUFFIX"], ["n", "b", "CODE_SUFFIX"], ["l", "k", "SAME_LOOK"]]);
    const byLayer = layerSuggestions([edge, house, cad], (layer, kind) => kind === "line" && /Infart/.test(layer) ? "k" : undefined);
    expect(byLayer.map(row => [row.from.id, row.layer, row.to.id, row.count])).toEqual([["h", "VagavgransningInfartglBOdefini", "k", 7906]]);
    // Ett skisslager blir aldrig mål.
    expect(mergeSuggestions([cad, { ...cad, id: "h2", count: 3 }], sprint).every(row => !row.to.fileHidden)).toBe(true);
  });
});
