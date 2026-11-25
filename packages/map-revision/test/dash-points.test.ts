import { describe, expect, it } from "vitest";
import { GAP, type LineSymbol, type MapObject, type MapSymbol, type Path, type Point } from "@o-tid/map-file";
import {
  autoDashPointsPlan,
  isDashedLineSymbol,
  toggleDashPoint,
  toggleOrInsertDashPoint
} from "../src/dash-points";

function makeLineSymbol(
  id: string,
  codeText: string,
  main: number,
  sub: number,
  opts: { color?: number; dashSpec?: { mainLength: number; mainGap: number; endLength: number }; dash?: number[] } = {}
): LineSymbol {
  return {
    kind: "LINE",
    id,
    code: { text: codeText, main, sub },
    name: `Symbol ${codeText}`,
    hidden: false,
    strokes: [{
      color: opts.color ?? 1,
      width: 0.14,
      ...(opts.dashSpec ? { dashSpec: opts.dashSpec } : {}),
      ...(opts.dash ? { dash: opts.dash } : {})
    }]
  };
}

const SYM_FORM_LINE = makeLineSymbol("103", "103.0", 103, 0, {
  color: 2,
  dashSpec: { mainLength: 2.0, mainGap: 0.4, endLength: 1.0 }
});
const SYM_SLOPE_TAG = makeLineSymbol("104", "104.0", 104, 0, { color: 2 });
const SYM_TRAIL = makeLineSymbol("506", "506.0", 506, 0, {
  color: 1,
  dashSpec: { mainLength: 2.0, mainGap: 0.5, endLength: 1.0 }
});
const SYM_SMALL_PATH = makeLineSymbol("507", "507.0", 507, 0, {
  color: 1,
  dash: [1.0, 0.5]
});
const SYM_SOLID_ROAD = makeLineSymbol("501", "501.0", 501, 0, { color: 1 });

function evalCubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
  };
}

function makeSymbols(): Map<string, MapSymbol> {
  return new Map<string, MapSymbol>([
    [SYM_FORM_LINE.id, SYM_FORM_LINE],
    [SYM_SLOPE_TAG.id, SYM_SLOPE_TAG],
    [SYM_TRAIL.id, SYM_TRAIL],
    [SYM_SMALL_PATH.id, SYM_SMALL_PATH],
    [SYM_SOLID_ROAD.id, SYM_SOLID_ROAD]
  ]);
}

describe("isDashedLineSymbol", () => {
  it("recognizes LINE symbols with dashSpec or non-empty dash and rejects solid/non-line symbols", () => {
    expect(isDashedLineSymbol(SYM_FORM_LINE)).toBe(true);
    expect(isDashedLineSymbol(SYM_SMALL_PATH)).toBe(true);
    expect(isDashedLineSymbol(SYM_SOLID_ROAD)).toBe(false);
    expect(isDashedLineSymbol(SYM_SLOPE_TAG)).toBe(false);
    expect(isDashedLineSymbol(undefined)).toBe(false);
    const area: MapSymbol = { kind: "AREA", id: "401", code: { text: "401.0", main: 401, sub: 0 }, name: "Open", hidden: false, hatches: [] };
    expect(isDashedLineSymbol(area)).toBe(false);
  });
});

describe("toggleDashPoint & toggleOrInsertDashPoint", () => {
  it("toggles dash on anchor commands while preserving corner, gap and Bezier handles", () => {
    const path: Path = [
      { type: "M", x: 0, y: 0 },
      { type: "C", x1: 1, y1: 2, x2: 3, y2: 2, x: 4, y: 0, corner: true, gap: GAP.main }
    ];
    const added = toggleDashPoint(path, 1);
    expect(added[1]).toEqual({ type: "C", x1: 1, y1: 2, x2: 3, y2: 2, x: 4, y: 0, corner: true, gap: GAP.main, dash: true });
    const removed = toggleDashPoint(added, 1);
    expect(removed[1]).toEqual({ type: "C", x1: 1, y1: 2, x2: 3, y2: 2, x: 4, y: 0, corner: true, gap: GAP.main });
    expect("dash" in removed[1]!).toBe(false);
    expect(toggleDashPoint(path, 99)).toBe(path);
  });

  it("inserts on a straight L segment and toggles existing vertex on/off", () => {
    const path: Path = [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 10, y: 0, corner: true, gap: GAP.main }
    ];
    const inserted = toggleOrInsertDashPoint(path, { x: 4, y: 0.1 });
    expect(inserted.action).toBe("inserted");
    expect(inserted.point.x).toBeCloseTo(4, 5);
    expect(inserted.point.y).toBeCloseTo(0, 5);
    expect(inserted.path).toHaveLength(3);
    expect(inserted.path[1]).toEqual({ type: "L", x: 4, y: 0, gap: GAP.main, dash: true });
    expect(inserted.path[2]).toEqual({ type: "L", x: 10, y: 0, corner: true, gap: GAP.main });

    // Toggling near the newly inserted dash point removes it
    const toggledOff = toggleOrInsertDashPoint(inserted.path, { x: 4.1, y: -0.1 });
    expect(toggledOff.action).toBe("removed");
    expect(toggledOff.path).toHaveLength(3);
    expect(toggledOff.path[1]!.dash).toBeUndefined();

    // Toggling again re-adds it
    const toggledOn = toggleOrInsertDashPoint(toggledOff.path, { x: 4.05, y: 0 });
    expect(toggledOn.action).toBe("added");
    expect(toggledOn.path[1]!.dash).toBe(true);
  });

  it("splits a cubic Bezier C segment via De Casteljau with mathematically identical curve shape", () => {
    const p0: Point = { x: 0, y: 0 };
    const p1: Point = { x: 0, y: 6 };
    const p2: Point = { x: 8, y: 6 };
    const p3: Point = { x: 10, y: 0 };
    const path: Path = [
      { type: "M", x: p0.x, y: p0.y },
      { type: "C", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p3.x, y: p3.y, corner: true, gap: GAP.left }
    ];

    const splitTarget = evalCubic(p0, p1, p2, p3, 0.4);
    const res = toggleOrInsertDashPoint(path, { x: splitTarget.x, y: splitTarget.y + 0.05 });
    expect(res.action).toBe("inserted");
    expect(res.path).toHaveLength(3);

    const c1 = res.path[1]!;
    const c2 = res.path[2]!;
    expect(c1.type).toBe("C");
    expect(c2.type).toBe("C");
    expect(c1.dash).toBe(true);
    expect(c1.gap).toBe(GAP.left);
    expect(c2.corner).toBe(true);
    expect(c2.gap).toBe(GAP.left);

    if (c1.type === "C" && c2.type === "C") {
      // Find parameter tSplit where original curve equals c1 endpoint
      const mid = { x: c1.x, y: c1.y };
      expect(Math.hypot(mid.x - splitTarget.x, mid.y - splitTarget.y)).toBeLessThan(0.05);

      // Verify every point on the two halves lies on the original cubic Bezier within 1e-6 mm
      const sampleCurvePoint = (u: number, isFirst: boolean) => isFirst
        ? evalCubic(p0, { x: c1.x1, y: c1.y1 }, { x: c1.x2, y: c1.y2 }, mid, u)
        : evalCubic(mid, { x: c2.x1, y: c2.y1 }, { x: c2.x2, y: c2.y2 }, p3, u);

      // Estimate exact tSplit from x(t) monotonicity (strictly increasing in x here)
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 40; i += 1) {
        const m = (lo + hi) / 2;
        if (evalCubic(p0, p1, p2, p3, m).x < mid.x) lo = m;
        else hi = m;
      }
      const tSplit = (lo + hi) / 2;

      for (let i = 0; i <= 10; i += 1) {
        const u = i / 10;
        const a = sampleCurvePoint(u, true);
        const refA = evalCubic(p0, p1, p2, p3, u * tSplit);
        expect(Math.hypot(a.x - refA.x, a.y - refA.y)).toBeLessThan(1e-5);

        const b = sampleCurvePoint(u, false);
        const refB = evalCubic(p0, p1, p2, p3, tSplit + u * (1 - tSplit));
        expect(Math.hypot(b.x - refB.x, b.y - refB.y)).toBeLessThan(1e-5);
      }
    }
  });
});

describe("autoDashPointsPlan", () => {
  it("places styrpunkter on a smooth form line Bezier hairpin apex and at a touching slope tag (104.0)", () => {
    const symbols = makeSymbols();
    // Smooth form line: straight run from (0,0) to (10,0), then tight Bezier U-turn hairpin up to (11, 3) and back to (12, 0), then to (20, 0).
    const formLine: MapObject = {
      kind: "line",
      symbol: SYM_FORM_LINE.id,
      path: [
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 10, y: 0 },
        { type: "C", x1: 10, y1: 4, x2: 12, y2: 4, x: 12, y: 0 },
        { type: "L", x: 20, y: 0 }
      ]
    };
    // Slope tag touching at (5, 0) pointing downhill to (5, -0.8)
    const slopeTag: MapObject = {
      kind: "line",
      symbol: SYM_SLOPE_TAG.id,
      path: [
        { type: "M", x: 5, y: 0.05 },
        { type: "L", x: 5, y: -0.8 }
      ]
    };

    const plan = autoDashPointsPlan([formLine], [formLine, slopeTag], symbols);
    expect(plan.counts.objects).toBe(1);
    expect(plan.counts.slopeTags).toBe(1);
    expect(plan.counts.bends).toBeGreaterThanOrEqual(1);

    const entry = plan.entries[0]!;
    expect(entry.points.some(p => p.reason === "slopeTag" && Math.hypot(p.at.x - 5, p.at.y) < 0.2)).toBe(true);
    // Hairpin apex is at (11, 3) (t = 0.5 on the cubic Bezier)
    expect(entry.points.some(p => p.reason === "bend" && Math.hypot(p.at.x - 11, p.at.y - 3) < 0.25)).toBe(true);
    // Resulting path must have dash: true commands at both places
    if (entry.after.kind === "line") {
      const dashCmds = entry.after.path.filter(c => c.dash);
      expect(dashCmds.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("places 2 opposite styrpunkter on a closed form-line knoll loop", () => {
    const symbols = makeSymbols();
    const rx = 3.0;
    const ry = 1.5;
    const k = 0.5522847498;
    const knoll: MapObject = {
      kind: "line",
      symbol: SYM_FORM_LINE.id,
      path: [
        { type: "M", x: rx, y: 0 },
        { type: "C", x1: rx, y1: ry * k, x2: rx * k, y2: ry, x: 0, y: ry },
        { type: "C", x1: -rx * k, y1: ry, x2: -rx, y2: ry * k, x: -rx, y: 0 },
        { type: "C", x1: -rx, y1: -ry * k, x2: -rx * k, y2: -ry, x: 0, y: -ry },
        { type: "C", x1: rx * k, y1: -ry, x2: rx, y2: -ry * k, x: rx, y: 0 }
      ]
    };

    const plan = autoDashPointsPlan([knoll], [knoll], symbols);
    expect(plan.counts.objects).toBe(1);
    const entry = plan.entries[0]!;
    expect(entry.points.length).toBeGreaterThanOrEqual(2);
    // On an elongated ellipse (rx=3, ry=1.5), the 2 sharpest apices are at (+3, 0) and (-3, 0)
    const pA = entry.points[0]!.at;
    const pB = entry.points[1]!.at;
    expect(Math.hypot(pA.x - pB.x, pA.y - pB.y)).toBeGreaterThan(rx);
  });

  it("detects trail T-junction and X-crossing between 506.0 and 507.0", () => {
    const symbols = makeSymbols();
    const mainTrail: MapObject = {
      kind: "line",
      symbol: SYM_TRAIL.id,
      path: [
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 30, y: 0 }
      ]
    };
    // T-junction at x = 10
    const branchPath: MapObject = {
      kind: "line",
      symbol: SYM_SMALL_PATH.id,
      path: [
        { type: "M", x: 10, y: 0.2 },
        { type: "L", x: 10, y: 12 }
      ]
    };
    // X-crossing at x = 20
    const crossingPath: MapObject = {
      kind: "line",
      symbol: SYM_SMALL_PATH.id,
      path: [
        { type: "M", x: 20, y: -6 },
        { type: "L", x: 20, y: 6 }
      ]
    };

    const plan = autoDashPointsPlan([mainTrail], [mainTrail, branchPath, crossingPath], symbols);
    expect(plan.counts.objects).toBe(1);
    expect(plan.counts.junctions).toBe(2);
    const xs = plan.entries[0]!.points.map(p => p.at.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(10, 1);
    expect(xs[1]).toBeCloseTo(20, 1);
  });

  it("preserves existing manual styrpunkter when keepExisting is true and resets them when false", () => {
    const symbols = makeSymbols();
    const trail: MapObject = {
      kind: "line",
      symbol: SYM_TRAIL.id,
      path: [
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 5, y: 0, dash: true }, // manual dash point on a straight section
        { type: "L", x: 15, y: 0 },
        { type: "L", x: 15, y: 10 } // 90 deg bend at (15, 0)
      ]
    };

    const kept = autoDashPointsPlan([trail], [trail], symbols, { keepExisting: true });
    expect(kept.counts.objects).toBe(1);
    if (kept.entries[0]!.after.kind === "line") {
      expect(kept.entries[0]!.after.path[1]!.dash).toBe(true); // manual preserved
      expect(kept.entries[0]!.after.path[2]!.dash).toBe(true); // bend added
    }

    const reset = autoDashPointsPlan([trail], [trail], symbols, { keepExisting: false });
    expect(reset.counts.objects).toBe(1);
    if (reset.entries[0]!.after.kind === "line") {
      expect(reset.entries[0]!.after.path[1]!.dash).toBeUndefined(); // manual cleared
      expect(reset.entries[0]!.after.path[2]!.dash).toBe(true); // bend re-added
    }
  });

  it("enforces minimum spacing so clustered bends do not pile up styrpunkter", () => {
    const symbols = makeSymbols();
    // Zig-zag with 0.4 mm steps (all 90° bends, but way closer than default minSpacing ~1.56 mm)
    const zigzag: MapObject = {
      kind: "line",
      symbol: SYM_FORM_LINE.id,
      path: [
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 5, y: 0 },
        { type: "L", x: 5, y: 0.4 },
        { type: "L", x: 5.4, y: 0.4 },
        { type: "L", x: 5.4, y: 0 },
        { type: "L", x: 10, y: 0 }
      ]
    };

    const plan = autoDashPointsPlan([zigzag], [zigzag], symbols, { minSpacingMm: 2.0 });
    expect(plan.counts.objects).toBe(1);
    // Only 1 bend should survive inside the 1.2 mm cluster
    expect(plan.entries[0]!.points.length).toBe(1);
  });

  it("handles a 12,000-object map quickly via spatial pre-filtering", () => {
    const symbols = makeSymbols();
    const objects: MapObject[] = [];
    for (let i = 0; i < 12_000; i += 1) {
      const x = (i % 120) * 3;
      const y = Math.floor(i / 120) * 3;
      objects.push({
        kind: "line",
        symbol: i % 3 === 0 ? SYM_FORM_LINE.id : SYM_TRAIL.id,
        path: [
          { type: "M", x, y },
          { type: "L", x: x + 2, y: y + 0.5 }
        ]
      });
    }
    const start = performance.now();
    const plan = autoDashPointsPlan(objects.slice(0, 500), objects, symbols);
    const elapsed = performance.now() - start;
    expect(plan.counts.objects).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(1000);
  });
});
