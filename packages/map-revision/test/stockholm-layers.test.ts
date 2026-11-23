import { describe, expect, it } from "vitest";
import { SYMBOL_SETS } from "@o-tid/map-file";
import { isStockholmLayer, stockholmLayer, suggestSymbol, type MapNorm } from "../src";

/** K6b: Stockholms baskarta och parkkarta: lagernamnens grammatik till symboler (utkastet i planen) eller hoppa över. */
const symbols = ["521", "522", "532", "513", "516", "509", "511", "305", "306", "301", "401", "405", "408", "501"].flatMap(code =>
  ["area", "line"].map(kind => ({ id: `${kind}${code}`, code: `${code}.0`, kind })));
const layer = (name: string, shape: Partial<Record<"points" | "lines" | "closedLines" | "areas", number>>) =>
  ({ name, count: 1, points: 0, lines: 0, closedLines: 0, areas: 0, ...shape });

describe("Stockholms lagernamn", () => {
  it("känner igen grammatiken men inte vanliga namn", () => {
    expect(isStockholmLayer("MarkanlaggningStenmurglBOdefin")).toBe(true);
    expect(isStockholmLayer("ParkBelaggningAsfaltparkvaggyB")).toBe(true);
    expect(isStockholmLayer("BostadsbyggnadBostadsbyggnadgyBBefintl")).toBe(true);
    for (const name of ["HUS", "STAKET", "0153", "HusB", "contour_index", "Byggnad"]) expect(isStockholmLayer(name), name).toBe(false);
  });

  it("föreslår symboler efter utkastet och hoppar över överskottet", () => {
    const suggested = (name: string, shape: Parameters<typeof layer>[1]) => suggestSymbol(layer(name, shape), symbols);
    expect(suggested("BostadsbyggnadBostadsbyggnadgyBBefintl", { areas: 5 })).toBe("area521");
    expect(suggested("BostadsbyggnadBostadsbyggnadglBBefintl", { closedLines: 5 })).toBeUndefined();
    expect(suggested("ByggnadsanlaggningSkarmtakgyBBefintl", { areas: 2 })).toBe("area522");
    expect(suggested("TrafikanlaggningTerrangtrappaglBBefin", { lines: 40 })).toBe("line532");
    expect(suggested("MarkanlaggningStenmurglBOdefin", { lines: 3 })).toBe("line513");
    expect(suggested("MarkanlaggningStaketglBBefintlig", { lines: 3 })).toBe("line516");
    expect(suggested("SparnatSJNormalsparglBBefintlig", { lines: 3 })).toBe("line509");
    expect(suggested("ElnatHogspanningsledningglBBefint", { lines: 3 })).toBe("line511");
    expect(suggested("VattendragBackglBBefintlig", { lines: 3 })).toBe("line305");
    expect(suggested("ParkGrasytagyB0", { areas: 3 })).toBe("area401");
    expect(suggested("ParkNaturmarkTradbevuxengyB0", { areas: 3 })).toBe("area405");
    expect(suggested("ParkPlanteringBuskagegyB0", { areas: 3 })).toBe("area408");
    expect(suggested("ParkBelaggningAsfaltparkvaggyB0", { areas: 3 })).toBe("area501");
    for (const name of ["RegisterenhetFastighetglBBefintlig", "TrafikanlaggningBroglBSkymd", "MarkanlaggningSlantglBBefintlig",
      "HojdkurvaHojdkurvaglhBBefintlig", "AdressTextBefintligtB0", "ParkSnorojningglB0", "ParkTradsB0"]) {
      expect(stockholmLayer(name), name).toEqual({ kind: "skip" });
    }
  });

  it("trapplagren blir trappa (532), inte byggnad (ägaren 2026-11-23, Liljeholmen)", () => {
    for (const norm of ["ISOM", "ISSPROM"] as const) {
      const set = SYMBOL_SETS[norm === "ISOM" ? "ISOM2017-2" : "ISSPROM2019-2"].symbols.map(symbol => ({ id: symbol.code, code: symbol.code, kind: symbol.kind, name: symbol.name }));
      expect(suggestSymbol(layer("ByggnadsanlaggningTrappagyBOde", { closedLines: 38 }), set, norm), norm).toBe("532");
      expect(suggestSymbol(layer("ByggnadsanlaggningTrappaglBOde", { lines: 133, closedLines: 8 }), set, norm), norm).toBe("532");
      expect(suggestSymbol(layer("TrafikanlaggningTerrangtrappag", { lines: 12733, closedLines: 1038, points: 8 }), set, norm), norm).toBe("532");
    }
    expect(stockholmLayer("ByggnadsanlaggningTrappagyBOde")).toEqual({ kind: "symbol", rule: { line: ["532"], area: ["532"] } });
  });

  it("känner igen namn som DWG → DXF kortat till 30 tecken (ägaren 2026-11-23, Liljeholmen och Gröndal)", () => {
    const buildings = ["BostadsbyggnadFlerbostadshusgy", "OspecificeradbyggnadOspec_bygg", "OvrigbyggnadKomplementbyggnadg", "IndustribyggnadIndustribyggnad",
      "IndustribyggnadOspec_industrib", "VerksamhetsbyggnadKontorsbyggn", "VerksamhetsbyggnadHandelsbyggn", "VerksamhetsbyggnadHotellbyggna",
      "VerksamhetsbyggnadParkeringshu", "VerksamhetsbyggnadOspec_verksa", "SamhallsfunktionsbyggnadAllman", "SamhallsfunktionsbyggnadIdrott",
      "SamhallsfunktionsbyggnadVardby", "SamfundsbyggnadOspec_samfundsb", "ServicebyggnadOffentligtoalett", "ServicebyggnadMobilteknikbodgy"];
    for (const name of buildings) expect(stockholmLayer(name), name).toEqual({ kind: "symbol", rule: { area: ["521"] } });
    expect(stockholmLayer("ServicebyggnadRegnskyddgyBBefi")).toEqual({ kind: "symbol", rule: { area: ["522"], line: ["522"] } });
    expect(stockholmLayer("TrafikanlaggningTerrangtrappag")).toEqual({ kind: "symbol", rule: { line: ["532"], area: ["532"] } });
    expect(stockholmLayer("VagutbredningParkvagsutbrednin")).toEqual({ kind: "symbol", rule: { area: ["501"] } });
    expect(stockholmLayer("SjoSjogySOdefinierad")).toEqual({ kind: "symbol", rule: { area: ["301"] } });
    expect(stockholmLayer("SjoStrandglBOdefinierad")).toEqual({ kind: "symbol", rule: { line: ["301.1"] } });
    for (const name of ["GranslinjeFastighetsomradesgra", "GranslinjeKvarterstraktgransgb", "GranslinjeAgarlagenhetsutrymme", "GranslinjeFastighetsutrymmesgr",
      "GranslinjeTraktgransenligtJB1_", "KvarterKvarterenldetaljplan_ej", "KvarterKvarterenldetaljplangyB", "RattighetOfficialservitutgyBBe",
      "GatunamnGatunamntB2Odefinierad", "Hojdkurvatrimmad5mglhBBefintli", "Hojdkurvatrimmad10mglhBBefintl", "Hojdkurvatrimmad10mthBBefintli",
      "MiljoanlaggningAtervinningssta", "TeknikanlaggningMobiltelemastg", "OvriganlaggningOspec_anlaggnin", "VagutbredningVagillustrationgl",
      "TradGatutradsBOdefinierad", "TradParktradsBOdefinierad"]) {
      expect(stockholmLayer(name), name).toEqual(name.startsWith("Vagutbredning") ? { kind: "symbol", rule: { area: ["501"] } } : { kind: "skip" });
    }
  });

  it("gör aldrig fastighetsgränser till stigar och träden till 418 som förval, på skogs- och sprintkartor", () => {
    const sets: [MapNorm, keyof typeof SYMBOL_SETS][] = [["ISOM", "ISOM2017-2"], ["ISSPROM", "ISSPROM2019-2"]];
    for (const [norm, set] of sets) {
      const list = SYMBOL_SETS[set].symbols.map(symbol => ({ id: `${symbol.kind}${symbol.code}`, code: symbol.code, kind: symbol.kind, name: symbol.name }));
      for (const name of ["GranslinjeFastighetsomradesgra", "GranslinjeFastighetsutrymmesgr", "GranslinjeKvarterstraktgransgb"]) {
        expect(suggestSymbol(layer(name, { lines: 3652 }), list, norm), `${norm} ${name}`).toBeUndefined();
      }
      for (const name of ["TradGatutradsBOdefinierad", "TradParktradsBOdefinierad", "ParkTradsB0"]) {
        expect(suggestSymbol(layer(name, { points: 3000 }), list, norm), `${norm} ${name}`).toBeUndefined();
      }
      expect(suggestSymbol(layer("BostadsbyggnadFlerbostadshusgy", { areas: 1264 }), list, norm)).toBe("area521");
      expect(suggestSymbol(layer("Hojdkurvatrimmad5mglhBBefintli", { lines: 1700 }), list, norm)).toBeUndefined();
    }
  });
});
