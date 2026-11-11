import { describe, expect, it } from "vitest";
import { applyFit, fitToMap, samplePath, type FitPoint } from "../src/vector-fit";

/** Ett oregelbundet "kvarter": hus av olika storlek och en väg, så att bara rätt läge passar. */
function town(): FitPoint[] {
  const out: FitPoint[] = [];
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < 60; k++) {
    const x = random() * 200, y = random() * 200, w = 1 + random() * 4, h = 1 + random() * 4;
    const path = [{ type: "M", x, y }, { type: "L", x: x + w, y }, { type: "L", x: x + w, y: y + h }, { type: "L", x, y: y + h }, { type: "L", x, y }] as const;
    for (const at of samplePath(path, 0.5)) out.push({ at, kind: "building" });
  }
  for (const at of samplePath([{ type: "M", x: 0, y: 20 }, { type: "L", x: 80, y: 90 }, { type: "L", x: 200, y: 110 }], 1)) out.push({ at, kind: "road" });
  return out;
}

const move = (points: readonly FitPoint[], degrees: number, dx: number, dy: number) =>
  points.map(point => ({ kind: point.kind, at: applyFit({ scale: 1, rotation: degrees, dx, dy, medianMm: 0, share: 0, pairs: 0 }, point.at) }));

describe("Passa in mot kartan (ägaren 2026-11-10)", () => {
  const map = town();

  it("hittar en förskjutning och en liten vridning", () => {
    const fit = fitToMap(move(map, 0.6, 12, -7), map)!;
    const back = applyFit(fit, applyFit({ scale: 1, rotation: 0.6, dx: 12, dy: -7, medianMm: 0, share: 0, pairs: 0 }, { x: 100, y: 100 }));
    expect(back.x).toBeCloseTo(100, 1);
    expect(back.y).toBeCloseTo(100, 1);
    expect(fit.share).toBeGreaterThan(0.9);
  });

  it("hittar också en vridning på 14° (en missvisning åt fel håll)", () => {
    const fit = fitToMap(move(map, 14, 3, 2), map)!;
    expect(fit.rotation).toBeCloseTo(-14, 1);
    expect(fit.share).toBeGreaterThan(0.9);
  }, 20_000);

  it("ger inget när underlaget inte är samma område", () => {
    const other = move(town().map(point => ({ ...point, at: { x: 200 - point.at.y, y: point.at.x } })), 0, 500, 500);
    expect(fitToMap(other, map)).toBeUndefined();
  });
});
