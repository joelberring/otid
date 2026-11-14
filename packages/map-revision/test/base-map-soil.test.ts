import { describe, expect, it } from "vitest";
import type { SourceFeature } from "../src";
import { classifySoil, isSoilWater, marshOffDrySoil, type SoilArea } from "../src/base-map";

describe("jordarternas klasser", () => {
  it("sand och grus som dränerar är torra", () => {
    for (const [code, text] of [[50, "Isälvssediment"], [51, "Isälvssediment, sten–block"], [55, "Isälvssediment, sand"], [57, "Isälvssediment, grus"],
      [33, "Svallsediment grus"], [34, "Klapper"], [13, "Flygsand"], [31, "Postglacial sand"], [28, "Postglacial finsand"]] as const) {
      expect(classifySoil(code, text), text).toBe("dry");
    }
  });
  it("torv, gyttja och gyttjelera är blöta", () => {
    for (const [code, text] of [[1, "Mossetorv"], [5, "Kärrtorv"], [6, "Gyttja"], [75, "Torv"], [16, "Gyttjelera"]] as const) expect(classifySoil(code, text), text).toBe("wet");
  });
  it("berg, blockmark, talus, morän, lera, silt, svämsediment och älvsediment är annan mark", () => {
    for (const [code, text] of [[888, "Berg"], [890, "Urberg"], [823, "Fanerozoisk diabas"], [66, "Blockmark"], [81, "Talus"], [82, "Vittringsjord"],
      [93, "Grusig morän"], [95, "Sandig morän"], [100, "Morän"], [17, "Postglacial lera"], [24, "Postglacial silt"], [39, "Silt"], [9060, "Glacial grovsilt–finsand"],
      [9, "Svämsediment, ler–silt"], [10, "Svämsediment, sand"], [8802, "Älvsediment"], [36, "Skaljord"], [200, "Fyllning"], [91, "Vatten"], [8114, "Oklassat område tidvis under vatten"]] as const) {
      expect(classifySoil(code, text), text).toBe("other");
    }
  });
  it("koden används när texten saknas", () => {
    expect(classifySoil(31, "")).toBe("dry");
    expect(classifySoil(5, null)).toBe("wet");
    expect(classifySoil(888, undefined)).toBe("other");
    expect(classifySoil(null, null)).toBe("other");
  });
  it("vatten känns igen på kod eller text", () => {
    expect(isSoilWater({ code: 91, text: "" })).toBe(true);
    expect(isSoilWater({ code: null, text: "Vatten" })).toBe(true);
    expect(isSoilWater({ code: 31, text: "Postglacial sand" })).toBe(false);
  });
});

const box = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const marsh = (layer: string, ring: [number, number][]): SourceFeature => ({ layer, geometry: { kind: "area", rings: [ring] } });
const soil = (cls: SoilArea["cls"], ring: [number, number][], code: number | null = null, text = ""): SoilArea => ({ rings: [ring], cls, code, text });
const areaOf = (features: readonly SourceFeature[]) => features.reduce((sum, feature) => {
  const ring = feature.geometry.kind === "area" ? feature.geometry.rings[0]! : [];
  return sum + Math.abs(ring.reduce((s, [x, y], i) => { const [nx, ny] = ring[(i + 1) % ring.length]!; return s + x * ny - nx * y; }, 0)) / 2;
}, 0);

describe("ingen sankmark på sand och grus", () => {
  it("sankmark på torr mark tas bort och resultatet säger hur många hektar", () => {
    const result = marshOffDrySoil([marsh("blott", box(0, 0, 100, 100))], [soil("dry", box(-50, -50, 150, 150), 31, "Postglacial sand")]);
    expect(result.features).toHaveLength(0);
    expect(result.removedHa).toBe(1);
  });
  it("sankmark på morän, lera och torv rörs inte", () => {
    const feature = marsh("fuktigt", box(0, 0, 100, 100));
    for (const area of [soil("other", box(-50, -50, 150, 150), 100, "Morän"), soil("other", box(-50, -50, 150, 150), 17, "Postglacial lera"),
      soil("wet", box(-50, -50, 150, 150), 5, "Kärrtorv")]) {
      const result = marshOffDrySoil([feature], [area]);
      expect(result.features).toEqual([feature]);
      expect(result.removedHa).toBe(0);
    }
  });
  it("bara den torra delen tas bort och resten behålls", () => {
    const result = marshOffDrySoil([marsh("blott", box(0, 0, 200, 100))], [soil("dry", box(-50, -50, 100, 150))]);
    expect(areaOf(result.features)).toBeCloseTo(10000, 0);
    expect(result.removedHa).toBe(1);
  });
  it("strandkärr inom 30 m från vatten blir kvar, men inte längre bort", () => {
    // Vatten vid x 0–10 (kartans vatten); torr mark runt allt; sankmark vid 10–40 (inom 30 m) och 100–140 (utanför).
    const water = { layer: "vatten", geometry: { kind: "area" as const, rings: [box(-100, 0, 10, 100)] } };
    const near = marsh("blott", box(10, 0, 40, 100)), far = marsh("blott", box(100, 0, 140, 100));
    const result = marshOffDrySoil([water, near, far], [soil("dry", box(-200, -200, 300, 300))], { water: [water] });
    expect(result.features.filter(feature => feature.layer === "blott")).toHaveLength(1);
    expect(areaOf(result.features.filter(feature => feature.layer === "blott"))).toBeGreaterThan(2000);
    expect(result.features).toContain(water);
    expect(result.features.some(feature => feature.layer === "blott" && feature.geometry.kind === "area" && feature.geometry.rings[0]!.some(([x]) => x >= 100))).toBe(false);
  });
  it("jordartskartans vatten (kod 91) ger också strandkärr", () => {
    const result = marshOffDrySoil([marsh("blott", box(10, 0, 40, 100))], [soil("dry", box(-200, -200, 300, 300)), soil("other", box(-100, 0, 10, 100), 91, "Vatten")]);
    expect(areaOf(result.features)).toBeGreaterThan(2000);
  });
  it("rester under minsta ytan tas bort", () => {
    // 20 x 100 m kvar (2000 m²) ryms; en rest på 3 x 100 m (300 m²) under 400 m² försvinner.
    const big = marshOffDrySoil([marsh("blott", box(0, 0, 100, 100))], [soil("dry", box(20, -50, 150, 150))]);
    expect(areaOf(big.features)).toBeCloseTo(2000, 0);
    const small = marshOffDrySoil([marsh("blott", box(0, 0, 100, 100))], [soil("dry", box(3, -50, 150, 150))]);
    expect(small.features).toHaveLength(0);
  });
  it("lager som inte är sankmark och ytor utan torr mark rörs inte", () => {
    const green = marsh("gron_lattlopt", box(0, 0, 100, 100)), far = marsh("blott", box(1000, 1000, 1100, 1100));
    const result = marshOffDrySoil([green, far], [soil("dry", box(0, 0, 100, 100))]);
    expect(result.features).toEqual([green, far]);
  });
  it("Lantmäteriets karterade sankmark rörs inte, bara laserns fuktsteg", () => {
    const other = marsh("sankmark_vat", box(0, 0, 100, 100));
    const result = marshOffDrySoil([other], [soil("dry", box(-50, -50, 150, 150))]);
    expect(result.features).toEqual([other]);
  });
});
