import { describe, expect, it } from "vitest";
import { isStockholmLayer, stockholmLayer, suggestSymbol } from "../src";

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
});
