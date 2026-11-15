import { describe, expect, it } from "vitest";
import type { SourceFeature } from "../src";
import { suggestSymbol } from "../src";
import { elongatedAngle, elongateKnolls, elongationOf, ELONGATED_KNOLL_LAYER } from "../src/base-map/elongated-knolls";
import { findHills } from "../src/base-map/hill-search";

/** En ellips med halvaxlarna `a` (längs `angle`) och `b`. */
const ellipse = (cx: number, cy: number, a: number, b: number, angle = 0): [number, number][] => Array.from({ length: 36 }, (_, i) => {
  const t = i * Math.PI / 18, x = a * Math.cos(t), y = b * Math.sin(t);
  return [cx + x * Math.cos(angle) - y * Math.sin(angle), cy + x * Math.sin(angle) + y * Math.cos(angle)];
});
const dot = (layer: string, x: number, y: number): SourceFeature => ({ layer, geometry: { kind: "point", at: [x, y] } });

describe("avlånga punkthöjder (ägaren 2026-11-15)", () => {
  it("mäter längd, bredd och riktning", () => {
    const shape = elongationOf(ellipse(0, 0, 6, 2, Math.PI / 4));
    expect(shape.length).toBeCloseTo(12, 0); expect(shape.width).toBeCloseTo(4, 0);
    expect(shape.angle).toBeCloseTo(Math.PI / 4, 1);
    expect(elongatedAngle(ellipse(0, 0, 4, 3))).toBeUndefined();
    expect(elongatedAngle(ellipse(0, 0, 5, 2.5))).toBeCloseTo(0, 1);
  });
  it("en punkthöjd med en avlång höjd bakom sig blir avlång och vriden efter den; runda och andra punkter står kvar", () => {
    const hills = [{ at: [0, 0] as const, ring: ellipse(0, 0, 6, 2, Math.PI / 2) }, { at: [50, 0] as const, ring: ellipse(50, 0, 4, 3.5) }];
    const features = [dot("dotknoll", 1, 2), dot("dotknoll_laser", 51, 0), dot("udepression", 0, 0), dot("dotknoll", 200, 0)];
    const out = elongateKnolls(features, hills);
    expect(out.map(feature => feature.layer)).toEqual([ELONGATED_KNOLL_LAYER, "dotknoll_laser", "udepression", "dotknoll"]);
    const geometry = out[0]!.geometry as { at: readonly [number, number]; toward: readonly [number, number] };
    expect(geometry.at).toEqual([1, 2]);
    // Längden går i nord–sydlig riktning: symbolens vinkel 90° (toward rakt österut).
    expect(geometry.toward[0] - geometry.at[0]).toBeCloseTo(5, 5); expect(geometry.toward[1] - geometry.at[1]).toBeCloseTo(0, 5);
    expect(out[1]).toBe(features[1]);
  });
  it("lagret får symbolen 110, de runda 109", () => {
    const symbols = [{ id: "s109", code: "109", kind: "point" }, { id: "s110", code: "110", kind: "point" }];
    const layer = (name: string) => ({ name, count: 1, points: 1, lines: 0, closedLines: 0, areas: 0 });
    expect(suggestSymbol(layer(ELONGATED_KNOLL_LAYER), symbols)).toBe("s110");
    expect(suggestSymbol(layer("dotknoll"), symbols)).toBe("s109");
  });
  it("höjdsökningen ger formen också för en liten höjd (0,6 m)", () => {
    const columns = 80, rows = 60, meters = new Float32Array(columns * rows);
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      const d = Math.hypot((column - 40) / 2.5, row - 30);
      meters[row * columns + column] = 100 + column * 0.002 + (d < 4 ? 0.6 * (1 - (d / 4) ** 2) : 0);
    }
    const [hill] = findHills({ columns, rows, meters }, [1, 0, 0.5, 0, -1, 59.5]);
    expect(hill?.ring).toBeDefined();
    // Längden går öst–väst (en axel: 0° och 180° är samma).
    expect(Math.abs(Math.sin(elongatedAngle(hill!.ring)!))).toBeLessThan(0.2);
  });
});
