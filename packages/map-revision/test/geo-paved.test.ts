import { describe, expect, it } from "vitest";
import { otsuThreshold, PAVED_AREA_TOLERANCE, pavedFromPoints, pavedLimit, pavedRings } from "../../../scripts/geo-paved";
import { POINT_BANDS, type PointStats } from "../../../scripts/geo-points";
import { ringArea } from "../../../scripts/geo-moisture";

/** Punktstatistik i 2 m-celler: `cell(x, y)` ger de åtta värdena (högst, antal, mark, 0,3–1 m, 1–3 m, över 3 m, intensitet, spridning). */
function stats(width: number, height: number, cell: (x: number, y: number) => readonly number[]): PointStats {
  const values = new Float32Array(width * height * POINT_BANDS);
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) values.set(cell(x, y), (x * height + y) * POINT_BANDS);
  return { minX: 674_000, minY: 6_570_000, cell: 2, width, height, values };
}
const NONE = [Number.NaN, 0, 0, 0, 0, 0, Number.NaN, Number.NaN];
/** Öppen mark med bara markträffar och intensiteten `value` (i bildens mått, alltså / 64). */
const ground = (value: number) => [0, 10, 10, 0, 0, 0, value * 64, 0.02];
const grass = (x: number, y: number) => ground(100 + ((x * 7 + y * 13) % 5) * 5);
const within = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

/** 160 × 160 m gräs med en gata (5 celler bred, tvärs över), en plan med en lucka, ett hus, mörk mark under träd och en liten fläck. */
const town = (x: number, y: number): readonly number[] => {
  if (within(x, y, 40, 40, 41, 41)) return NONE;                                  // lucka utan punkter mitt i planen
  if (within(x, y, 10, 0, 14, 79) || within(x, y, 30, 30, 49, 49)) return ground(23);
  if (within(x, y, 60, 10, 65, 15)) return [8, 10, 0, 0, 0, 10, Number.NaN, Number.NaN]; // hus: inga markträffar, allt över 3 m
  if (within(x, y, 60, 30, 65, 35)) return [5, 10, 9, 0, 0, 1, 23 * 64, 0.02];      // asfalt under en trädkrona
  if (within(x, y, 60, 50, 65, 55)) return [0.2, 10, 5, 5, 0, 0, 23 * 64, 0.02];    // mörkt men bara hälften markträffar
  if (within(x, y, 60, 60, 62, 62)) return ground(23);                             // 36 m²: för liten
  return grass(x, y);
};

describe("belagd yta ur laserns intensitet (ägaren 2026-11-13)", () => {
  it("två toppar ger gatan och planen med rätt yta; hus, träd och små fläckar tas inte med", () => {
    const result = pavedFromPoints(stats(80, 80, town));
    expect(result.darkPeak).toBe(23);
    // 2,5 × den mörka toppen, under Otsu-gränsen mitt emellan topparna.
    expect(result.limit).toBe(57.5);
    expect(result.otsu).toBeGreaterThan(57);
    const cells = result.mask.reduce((sum, value) => sum + value, 0);
    // Gatan 5 × 80 celler och planen 20 × 20 med luckan fylld; öppningen tar planens fyra hörnceller.
    expect(cells).toBe(400 + 396);
    expect(result.pavedHa).toBe(0.32);
    const at = (x: number, y: number) => result.mask[x * 80 + y];
    expect([at(12, 40), at(40, 40), at(35, 35)]).toEqual([1, 1, 1]);
    expect([at(62, 12), at(62, 32), at(62, 52), at(61, 61), at(20, 20)]).toEqual([0, 0, 0, 0, 0]);
    // Två ytor utan hål, i SWEREF 99 TM: planen och gatan som rektanglar med ungefär cellernas area och lägen.
    expect(result.source).toBe("generalized");
    expect(result.rings.map(ring => ring.length)).toEqual([4, 4]);
    const areas = result.rings.map(ring => ringArea(ring)).sort((a, b) => a - b);
    expect(Math.abs(areas[0]! - 1584)).toBeLessThan(1584 * 0.05);
    expect(Math.abs(areas[1]! - 1600)).toBeLessThan(1600 * 0.05);
    const xs = result.rings.flat().map(point => point[0]);
    expect(Math.abs(Math.min(...xs) - 674_020)).toBeLessThan(1);
    expect(Math.abs(Math.max(...xs) - 674_100)).toBeLessThan(1);
  });

  it("ett kvarter mitt i den belagda ytan blir ett hål (medurs ring)", () => {
    const result = pavedFromPoints(stats(80, 80, (x, y) => within(x, y, 10, 10, 59, 59) && !within(x, y, 25, 25, 44, 44) ? ground(23) : grass(x, y)));
    expect(result.rings).toHaveLength(2);
    expect(result.rings.map(ring => Math.sign(ringArea(ring))).sort()).toEqual([-1, 1]);
    // Ytterkanten minus hålet är maskens yta (50 × 50 celler utan 20 × 20, minus öppningens hörn).
    expect(Math.abs(result.rings.reduce((sum, ring) => sum + ringArea(ring), 0) - result.pavedHa * 10_000)).toBeLessThan(result.pavedHa * 10_000 * 0.05);
  });

  it("skyddet på helheten: gator och kvarter ger ringar med maskens yta, och en mask som utjämningen inte klarar ges som rasterkant", () => {
    // Ett gatunät: 8 m breda gator var 60:e meter åt båda håll, med kvarteren som hål.
    const size = 120, grid = { minX: 1, minY: 1, cell: 2, width: size, height: size };
    const streets = new Uint8Array(size * size);
    for (let x = 0; x < size; x += 1) for (let y = 0; y < size; y += 1) if ((x % 30 >= 13 && x % 30 < 17) || (y % 30 >= 13 && y % 30 < 17)) streets[x * size + y] = 1;
    const town = pavedRings(streets, grid);
    expect(town.source).toBe("generalized");
    expect(town.maskM2).toBe(streets.reduce((sum, value) => sum + value, 0) * 4);
    const outer = town.rings.filter(ring => ringArea(ring) > 0), holes = town.rings.filter(ring => ringArea(ring) < 0);
    expect(outer).toHaveLength(1);
    // De nio kvarteren mitt i nätet är hål (kvarteren längs kanten är öppna utåt).
    expect(holes).toHaveLength(9);
    for (const hole of holes) expect(Math.abs(Math.abs(ringArea(hole)) - 52 * 52)).toBeLessThan(52 * 52 * 0.08);
    const net = town.rings.reduce((sum, ring) => sum + ringArea(ring), 0);
    expect(Math.abs(net - town.maskM2)).toBeLessThanOrEqual(PAVED_AREA_TOLERANCE * town.maskM2);
    // Räknas hålen som ytor (omloppsriktningen struken) blir ytan mycket för stor: det är hålen som håller arean rätt.
    expect(town.rings.reduce((sum, ring) => sum + Math.abs(ringArea(ring)), 0)).toBeGreaterThan(1.5 * town.maskM2);
    // Smala remsor (två celler) försvinner i utjämningen: ringarnas yta stämmer inte med maskens, och rasterkanten gäller.
    const strips = new Uint8Array(size * size);
    for (let x = 10; x < 110; x += 1) for (let y = 10; y < 110; y += 1) if (y % 10 < 2) strips[x * size + y] = 1;
    const narrow = pavedRings(strips, grid);
    expect(narrow.source).toBe("raster");
    expect(narrow.rings).toHaveLength(10);
    expect(narrow.rings.reduce((sum, ring) => sum + ringArea(ring), 0)).toBe(narrow.maskM2);
  });

  it("en topp ger ingenting: bara gräs, eller för få öppna celler", () => {
    const meadow = pavedFromPoints(stats(80, 80, grass));
    expect(meadow).toMatchObject({ rings: [], pavedHa: 0, openCells: 6400, reason: "ingen mörk topp" });
    expect(meadow.limit).toBeUndefined();
    const small = pavedFromPoints(stats(20, 20, (x, y) => x < 6 ? ground(23) : grass(x, y)));
    expect(small).toMatchObject({ rings: [], pavedHa: 0, reason: "för få öppna celler" });
    // En mörk fläck på under 5 % av de öppna cellerna är ingen topp.
    const speck = pavedFromPoints(stats(80, 80, (x, y) => within(x, y, 10, 10, 19, 19) ? ground(23) : grass(x, y)));
    expect(speck).toMatchObject({ rings: [], reason: "för få mörka celler" });
  });

  it("vatten räknas inte som öppen mark", () => {
    const result = pavedFromPoints(stats(80, 80, town), x => x < 674_000 + 15 * 2);
    expect(result.mask.reduce((sum, value) => sum + value, 0)).toBe(396);
    expect(result.rings).toHaveLength(1);
  });

  it("gränsen: 2,5 × den mörka toppen, aldrig över Otsu-gränsen och aldrig under 1,5 × toppen", () => {
    const histogram = (...peaks: readonly (readonly [number, number])[]) => { const out = new Uint32Array(256); for (const [value, count] of peaks) out[value] = count; return out; };
    expect(otsuThreshold(histogram([23, 500], [130, 3000]))).toBe(76);
    expect(otsuThreshold(histogram([50, 10]))).toBeUndefined();
    expect(pavedLimit(histogram([23, 500], [130, 3000]))).toEqual({ limit: 57.5, darkPeak: 23, otsu: 76 });
    // Topparna nära varandra: Otsu-gränsen (70) ligger under 2,5 × 40 och gäller.
    expect(pavedLimit(histogram([40, 1000], [101, 3000]))).toEqual({ limit: 70, darkPeak: 40, otsu: 70 });
    // Otsu-gränsen under 1,5 × toppen: inga två toppar.
    expect(pavedLimit(histogram([60, 1000], [100, 3000])).limit).toBeUndefined();
    expect(pavedLimit(histogram([23, 50], [130, 3000])).limit).toBeUndefined();
    expect(pavedLimit(histogram([23, 100], [130, 1000])).limit).toBeUndefined();
  });
});
