import { describe, expect, it } from "vitest";
import type { MapObject } from "@o-tid/map-file";
import { fitAffine, fitSimilarity, fitWarp, warpObject, warpObjects } from "../src";

/** ADR-0219 K6b: rätta kartan med passpunkter (likformig, affin, gummiduk). */
const p = (x: number, y: number) => ({ x, y });

describe("rätta kartan med passpunkter", () => {
  it("likformig: vridning, skala och flytt ur två punkter, utan spegling", () => {
    const turn = Math.PI / 6, scale = 1.02;
    const map = (point: { x: number; y: number }) => p(scale * (Math.cos(turn) * point.x - Math.sin(turn) * point.y) + 3,
      scale * (Math.sin(turn) * point.x + Math.cos(turn) * point.y) - 2);
    const pairs = [p(0, 0), p(100, 50)].map(from => ({ from, to: map(from) }));
    const t = fitSimilarity(pairs)!;
    const at = { x: t.a * 40 + t.b * 70 + t.c, y: t.d * 40 + t.e * 70 + t.f };
    expect(at.x).toBeCloseTo(map(p(40, 70)).x, 8);
    expect(at.y).toBeCloseTo(map(p(40, 70)).y, 8);
    expect(fitSimilarity(pairs.slice(0, 1))).toBeUndefined();
  });

  it("affin med minsta kvadrat och avvikelserna; tre punkter på en linje går inte", () => {
    const map = (point: { x: number; y: number }) => p(1.01 * point.x + 0.02 * point.y + 5, -0.01 * point.x + 0.99 * point.y + 1);
    const pairs = [p(0, 0), p(100, 0), p(0, 100), p(100, 100)].map(from => ({ from, to: map(from) }));
    const t = fitAffine(pairs)!;
    expect(t.a).toBeCloseTo(1.01, 9); expect(t.b).toBeCloseTo(0.02, 9); expect(t.c).toBeCloseTo(5, 9);
    expect(fitWarp(pairs, "affine")!.rms).toBeLessThan(1e-9);
    expect(fitAffine([p(0, 0), p(1, 1), p(2, 2)].map(from => ({ from, to: from })))).toBeUndefined();
  });

  it("gummiduk: punkterna hamnar exakt, långt bort nästan affint, och avvikelsen är den lokala böjningen", () => {
    const pairs = [{ from: p(0, 0), to: p(0, 0) }, { from: p(100, 0), to: p(100, 0) }, { from: p(0, 100), to: p(0, 100) },
      { from: p(100, 100), to: p(100, 100) }, { from: p(50, 50), to: p(51, 50) }];
    const warp = fitWarp(pairs, "rubber")!;
    for (const pair of pairs) {
      const at = warp.apply(pair.from);
      expect(at.x).toBeCloseTo(pair.to.x, 6); expect(at.y).toBeCloseTo(pair.to.y, 6);
    }
    // Nära mitten flyttas kartan nästan lika mycket, nära hörnen nästan inte alls.
    expect(warp.apply(p(52, 50)).x - 52).toBeGreaterThan(0.8);
    expect(Math.abs(warp.apply(p(2, 2)).x - 2)).toBeLessThan(0.15);
    expect(Math.max(...warp.residuals)).toBeGreaterThan(0.5);
  });

  it("objekten flyttas med kurvornas styrpunkter och punkternas vinkel; utanför rutan och det som inte rörs hoppas över", () => {
    const quarter = (point: { x: number; y: number }) => p(-point.y, point.x);
    const pairs = [p(0, 0), p(10, 0)].map(from => ({ from, to: quarter(from) }));
    const line: MapObject = { kind: "line", symbol: "s", path: [{ type: "M", x: 1, y: 0 }, { type: "C", x1: 2, y1: 0, x2: 3, y2: 1, x: 4, y: 1 }] };
    const moved = warpObject(line, fitWarp(pairs, "similarity")!.apply);
    const curve = moved.kind === "line" ? moved.path[1] : undefined;
    expect(curve?.type === "C" && [curve.x1, curve.y1, curve.x, curve.y].map(value => Math.round(value * 1e6) / 1e6)).toEqual([0, 2, -1, 4]);
    const point: MapObject = { kind: "point", symbol: "s", at: p(5, 0), angle: 10 };
    const turned = warpObject(point, fitWarp(pairs, "similarity")!.apply);
    expect(turned.kind === "point" && [turned.at.x, turned.at.y, turned.angle].map(value => Math.round(value * 1e6) / 1e6)).toEqual([0, 5, 100]);
    const still = [p(0, 0), p(10, 0)].map(from => ({ from, to: from }));
    const far: MapObject = { kind: "point", symbol: "s", at: p(500, 500), angle: 0 };
    expect(warpObjects([{ key: "a", object: point }], { pairs: still, kind: "similarity" }).changes).toEqual([]);
    const shifted = [p(0, 0), p(10, 0)].map(from => ({ from, to: p(from.x + 1, from.y) }));
    const result = warpObjects([{ key: "a", object: point }, { key: "b", object: far }], { pairs: shifted, kind: "similarity",
      within: { minX: 0, minY: -10, maxX: 100, maxY: 10 } });
    expect(result.changes.map(change => [change.key, change.moved])).toEqual([["a", expect.closeTo(1, 9)]]);
  });
});
