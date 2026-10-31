import { describe, expect, it } from "vitest";
import { parseSymbolCode, type MapSymbol } from "@o-tid/map-file";
import { analyseLeg, buildCostModel, classForCode, DEFAULT_SPEED_BY_CLASS, legGrid, resolveSettings } from "../src";
import { forest, m, MapBuilder, rect } from "./synthetic";

describe("standardtabellen och inställningarna", () => {
  it("slår upp exakt nummer, sedan huvudnummer, sedan standard", () => {
    const settings = resolveSettings({ version: 1, classBySymbol: { "406.1": "FIGHT", "999": "SLOW" } });
    expect(classForCode(settings, parseSymbolCode("406.1"))).toBe("FIGHT");
    expect(classForCode(settings, parseSymbolCode("406.0"))).toBe("SLOW");
    expect(classForCode(settings, parseSymbolCode("521.4"))).toBe("IMPASSABLE");
    expect(classForCode(settings, parseSymbolCode("999.3"))).toBe("SLOW");
    expect(classForCode(settings, parseSymbolCode("850.3"))).toBe("IGNORE");
    expect(classForCode(settings, parseSymbolCode("699"))).toBeUndefined();
  });

  it("fyller standardvärden och ersätter ogiltiga tal", () => {
    const settings = resolveSettings({ version: 1, speedByClass: { SLOW: 0.5, FAST: -1 }, climbFactor: 0, contourIntervalMeters: Number.NaN });
    expect(settings.speedByClass.SLOW).toBe(0.5);
    expect(settings.speedByClass.FAST).toBe(DEFAULT_SPEED_BY_CLASS.FAST);
    expect(settings.climbFactor).toBe(0);
    expect(settings.contourIntervalMeters).toBe(5);
    expect(settings.referencePaceSecondsPerKm).toBe(360);
  });
});

describe("buildCostModel", () => {
  it("listar okända symboler och låter kombinerade symboler ärva från delarna", () => {
    const builder = forest().area("699", rect(0, 0, 10, 10));
    const water: MapSymbol = { id: "w", code: parseSymbolCode("301.1"), name: "vatten", hidden: false, kind: "AREA", hatches: [] };
    const outline: MapSymbol = { id: "o", code: parseSymbolCode("301.2"), name: "kontur", hidden: false, kind: "LINE", strokes: [{ color: 0, width: 0.1 }] };
    const combined: MapSymbol = { id: "c", code: parseSymbolCode("777"), name: "egen sjö", hidden: false, kind: "COMBINED", parts: ["w", "o"] };
    for (const symbol of [water, outline, combined]) builder.symbols.set(symbol.id, symbol);
    builder.objects.push({ kind: "area", symbol: "c", rings: [rect(150, -100, 250, 100)], angle: 0 });
    const model = buildCostModel(builder.build());
    expect(model.unknownSymbols).toEqual([{ code: "699", name: "699", objects: 1 }]);
    expect(model.classes.find(row => row.code === "777")).toMatchObject({ cls: "IMPASSABLE", source: "INHERITED" });
    expect(model.classes.find(row => row.code === "405")).toMatchObject({ cls: "NORMAL", source: "STANDARD" });
    // Den egna sjön spärrar.
    const result = analyseLeg(model, { key: "x", from: m(0, 0), to: m(400, 0) });
    expect(result.best!.meters).toBeGreaterThan(420);
  });

  it("räknar inte dolda symboler och låter tävlingens tabell gälla", () => {
    const builder = new MapBuilder().area("405", rect(-2000, -2000, 2000, 2000)).area("410", rect(100, -1000, 300, 1000));
    const own = buildCostModel(builder.build(), { version: 1, classBySymbol: { "410": "IMPASSABLE" } });
    expect(own.classes.find(row => row.code === "410")).toMatchObject({ cls: "IMPASSABLE", source: "OWN" });
    const hidden = new MapBuilder().area("405", rect(-2000, -2000, 2000, 2000)).area("410", rect(100, -1000, 300, 1000));
    hidden.symbols.set("410", { ...hidden.symbols.get("410")!, hidden: true });
    const result = analyseLeg(buildCostModel(hidden.build()), { key: "x", from: m(0, 0), to: m(400, 0) });
    expect(result.best!.meters / result.straightMeters).toBeLessThan(1.02);
  });

  it("lägger stigen ovanpå vegetationen och spärrar ovanpå allt", () => {
    const model = buildCostModel(forest().area("410", rect(-500, -500, 500, 500)).line("506", 0.18, [-500, 0], [500, 0])
      .line("518", 0.25, [0, -500], [0, 500]).build());
    const grid = legGrid(model, { from: m(-100, 0), to: m(100, 0) });
    const at = (x: number, y: number) => {
      const col = Math.floor((x * 0.1 - grid.x0) / grid.cellMm), row = Math.floor((grid.yTop - y * 0.1) / grid.cellMm);
      return { ground: grid.ground[row * grid.width + col], track: grid.track[row * grid.width + col] };
    };
    expect(at(-50, 0)).toEqual({ ground: 4, track: 0 });
    expect(at(-50, 30).track).toBe(255);
    expect(at(0, 0).ground).toBe(5);
    expect(at(0, 0).track).toBe(255);
  });
});

describe("osäkerheten", () => {
  it("märker ABOUT_EQUAL när stigen och rakt fram är nästan lika bra", () => {
    // Rakt fram 400 m i 406 (0,7) = 571 m skog. Stigen i en båge (~ 452 m) med fart 1,25 = 362 m + korta bitar i 406.
    // Med bågens höjd vald så att de är nära lika byter bästa plats när stigen/406 ändras ±15 %.
    const near = buildCostModel(forest().area("406", rect(-1000, -1000, 1000, 1000))
      .line("506", 0.18, [0, 0], [60, 175], [340, 175], [400, 0]).build());
    const result = analyseLeg(near, { key: "x", from: m(0, 0), to: m(400, 0) });
    expect(result.verdict).toBe("ABOUT_EQUAL");
    // Tydligt bättre stig (tät skog rakt fram): robust.
    const clear = buildCostModel(forest().area("408", rect(-1000, -1000, 1000, 1000))
      .line("506", 0.18, [0, 0], [60, 175], [340, 175], [400, 0]).build());
    expect(analyseLeg(clear, { key: "x", from: m(0, 0), to: m(400, 0) }).verdict).not.toBe("ABOUT_EQUAL");
  });
});
