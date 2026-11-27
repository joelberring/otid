import { describe, expect, it } from "vitest";
import {
  applyMapRevision, GAP, newMapFile, objectRefOf, readMapFile, sha256Hex,
  type LineSymbol, type MapObject, type MapSymbol, type Path, type Point, type PointSymbol
} from "@o-tid/map-file";
import {
  autoDashPointsPlan,
  isDashPointCommand,
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

  it("hittar O-Tids 101.1-lutningsstreck (POINT) vid hjälpkurva och ignorerar 104 Jordbrant (ISOM 2017-2)", () => {
    const templateMap = readMapFile(newMapFile({ symbolSet: "ISOM2017-2", scale: 15000, refPoint: { easting: 670_000, northing: 6_580_000 } }), "ny.omap");
    const byCode = (code: string) => [...templateMap.symbols.values()].find(symbol => symbol.code.text === code)!;
    const s103 = byCode("103");
    const s101_1 = byCode("101.1") as PointSymbol;
    const s104 = byCode("104") as LineSymbol;
    expect(s101_1.kind).toBe("POINT");
    expect(s104.kind).toBe("LINE");
    expect(s104.repeated).toBeDefined();

    const formLine: MapObject = {
      kind: "line",
      symbol: s103.id,
      path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 20, y: 0 }]
    };
    // 101.1 punktsymbol med ankare på hjälpkurvan vid (6, 0) samt en andra vriden så spetsen nuddar vid (14, 0).
    const pointTagAtOrigin: MapObject = { kind: "point", symbol: s101_1.id, at: { x: 6, y: 0.05 }, angle: 0 };
    const pointTagAtTip: MapObject = { kind: "point", symbol: s101_1.id, at: { x: 14, y: 0.5 }, angle: 0 };
    // 104 Jordbrant (både lång 8 mm och kort 1,5 mm med tvärstreck): ska INTE skapa lutningsstrecks-styrpunkter!
    const longEarthBank: MapObject = {
      kind: "line",
      symbol: s104.id,
      path: [{ type: "M", x: 10, y: 0 }, { type: "L", x: 10, y: -8 }]
    };
    const shortEarthBank: MapObject = {
      kind: "line",
      symbol: s104.id,
      path: [{ type: "M", x: 17, y: 0 }, { type: "L", x: 17, y: -1.5 }]
    };

    const plan = autoDashPointsPlan([formLine], [formLine, pointTagAtOrigin, pointTagAtTip, longEarthBank, shortEarthBank], templateMap.symbols);
    expect(plan.counts.objects).toBe(1);
    expect(plan.counts.slopeTags).toBe(2);
    const xs = plan.entries[0]!.points.filter(p => p.reason === "slopeTag").map(p => p.at.x).sort((a, b) => a - b);
    expect(xs).toHaveLength(2);
    expect(xs[0]).toBeCloseTo(6, 1);
    expect(xs[1]).toBeCloseTo(14, 1);
    // Inga styrpunkter vid 104 Jordbrant (x = 10 eller x = 17).
    expect(plan.entries[0]!.points.some(p => Math.abs(p.at.x - 10) < 0.5 || Math.abs(p.at.x - 17) < 0.5)).toBe(false);
  });
});

describe("OMAP/Mapper styrpunkter round-trip (treatCornerAsDash)", () => {
  const OMAP_DASHED = `<?xml version="1.0" encoding="UTF-8"?>
<map xmlns="http://openorienteering.org/apps/mapper/xml/v2" version="9">
<georeferencing scale="10000"><ref_point x="0" y="0"/></georeferencing>
<colors count="1">
<color priority="0" name="Brun" c="0" m="0.56" y="1" k="0.18" opacity="1"><cmyk method="custom"/><rgb method="custom" r="0.82" g="0.36" b="0"/></color>
</colors>
<barrier version="6" required="0.6.0">
<symbols count="1" id="test">
<symbol type="2" id="0" code="103.0" name="Hjälpkurva"><line_symbol color="0" line_width="100" dashed="true" dash_length="2000" break_length="400" dashes_in_group="1" half_outer_dashes="true"/></symbol>
</symbols>
<parts count="1" current="0">
<part name="Karta"><objects count="1">
<object type="1" symbol="0"><coords count="4">0 0;5000 0;15000 0;15000 -10000;</coords></object>
</objects></part>
</parts>
<templates count="0" first_front_template="0"/>
</barrier>
</map>
`;

  it("skiljer på corner och dash i OCAD men hanterar corner som styrpunkt i OMAP", () => {
    const cornerOnly = { type: "L" as const, x: 5, y: 0, corner: true as const };
    const dashOnly = { type: "L" as const, x: 5, y: 0, dash: true as const };
    expect(isDashPointCommand(cornerOnly)).toBe(false);
    expect(isDashPointCommand(cornerOnly, true)).toBe(true);
    expect(isDashPointCommand(dashOnly)).toBe(true);
    expect(isDashPointCommand(dashOnly, true)).toBe(true);

    // OCAD (default): toggleDashPoint leaves corner untouched
    const ocdPath: Path = [{ type: "M", x: 0, y: 0 }, cornerOnly, { type: "L", x: 10, y: 0 }];
    const ocdOn = toggleDashPoint(ocdPath, 1);
    expect(ocdOn[1]).toEqual({ type: "L", x: 5, y: 0, corner: true, dash: true });
    const ocdOff = toggleDashPoint(ocdOn, 1);
    expect(ocdOff[1]).toEqual({ type: "L", x: 5, y: 0, corner: true });

    // OMAP (treatCornerAsDash = true): toggling off clears both corner and dash
    const omapOff = toggleDashPoint(ocdPath, 1, true);
    expect(omapOff[1]).toEqual({ type: "L", x: 5, y: 0 });
    expect("corner" in omapOff[1]!).toBe(false);
    expect("dash" in omapOff[1]!).toBe(false);
  });

  it("klarar full OMAP round-trip: lägg till -> spara -> läs tillbaka -> växla bort -> flags 32 borta, samt keepExisting: false", () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const meta = { author: "test", at: "2026-11-26T00:00:00Z" } as const;

    // 1. Read initial OMAP and add a dash point on vertex 1 (5, 0)
    const bytes0 = encoder.encode(OMAP_DASHED);
    const sha0 = sha256Hex(bytes0);
    const map0 = readMapFile(bytes0, "karta.omap", { sources: true });
    const line0 = map0.objects[0]!;
    expect(line0.kind).toBe("line");
    if (line0.kind !== "line") throw new Error("expected line");

    const added = toggleOrInsertDashPoint(line0.path, { x: 5, y: 0 }, 0.45, true);
    expect(added.action).toBe("added");
    expect(added.path[1]!.dash).toBe(true);

    // 2. Save via applyMapRevision and verify flags="32" is written
    const rev1 = applyMapRevision(bytes0, {
      baseFileSha256: sha0,
      format: "OMAP",
      changes: [{ ...meta, kind: "modify", ref: objectRefOf(sha0, line0)!, geometry: { kind: "line", path: added.path } }]
    });
    if (!rev1.ok) throw new Error(JSON.stringify(rev1.refusals));
    expect(decoder.decode(rev1.bytes)).toContain("5000 0 32;");

    // 3. Reload OMAP: Mapper reads flags="32" back as corner: true
    const sha1 = sha256Hex(rev1.bytes);
    const map1 = readMapFile(rev1.bytes, "karta.omap", { sources: true });
    const line1 = map1.objects[0]!;
    if (line1.kind !== "line") throw new Error("expected line");
    expect(line1.path[1]!.corner).toBe(true);
    expect(isDashPointCommand(line1.path[1]!, true)).toBe(true);

    // 4. Toggle OFF via toggleOrInsertDashPoint(..., true) -> both corner and dash cleared
    const removed = toggleOrInsertDashPoint(line1.path, { x: 5, y: 0 }, 0.45, true);
    expect(removed.action).toBe("removed");
    expect(removed.path[1]!.corner).toBeUndefined();
    expect(removed.path[1]!.dash).toBeUndefined();

    // 5. Save again and verify flags="32" is completely GONE
    const rev2 = applyMapRevision(rev1.bytes, {
      baseFileSha256: sha1,
      format: "OMAP",
      changes: [{ ...meta, kind: "modify", ref: objectRefOf(sha1, line1)!, geometry: { kind: "line", path: removed.path } }]
    });
    if (!rev2.ok) throw new Error(JSON.stringify(rev2.refusals));
    expect(decoder.decode(rev2.bytes)).not.toContain(" 32;");
    const map2 = readMapFile(rev2.bytes, "karta.omap", { sources: true });
    const line2 = map2.objects[0]!;
    if (line2.kind !== "line") throw new Error("expected line");
    expect(isDashPointCommand(line2.path[1]!, true)).toBe(false);

    // 6. On reloaded map1 (with corner: true at straight vertex 1), autoDashPointsPlan with keepExisting: false strips it
    const resetPlan = autoDashPointsPlan([line1], [line1], map1.symbols, { keepExisting: false, treatCornerAsDash: true });
    expect(resetPlan.counts.objects).toBe(1);
    const resetLine = resetPlan.entries[0]!.after;
    if (resetLine.kind !== "line") throw new Error("expected line");
    expect(resetLine.path[1]!.corner).toBeUndefined();
    expect(resetLine.path[1]!.dash).toBeUndefined();
    // 90° bend at vertex 2 (15, 0) gets a fresh dash point
    expect(resetLine.path[2]!.dash).toBe(true);

    const rev3 = applyMapRevision(rev1.bytes, {
      baseFileSha256: sha1,
      format: "OMAP",
      changes: [{ ...meta, kind: "modify", ref: objectRefOf(sha1, line1)!, geometry: { kind: "line", path: resetLine.path } }]
    });
    if (!rev3.ok) throw new Error(JSON.stringify(rev3.refusals));
    const xml3 = decoder.decode(rev3.bytes);
    expect(xml3).toContain(";5000 0;");
    expect(xml3).not.toContain(";5000 0 32;");
    expect(xml3).toContain(";15000 0 32;");
  });

  it("beskär Bézier- och polylinjebboxar korrekt på långa kurvor med korsningar och lutningsstreck", () => {
    // Bygg en lång hjälpkurva med 80 Bézier-segment och 30 lutningsstreck + 10 korsande stigar.
    const path: Path = [
      { type: "M", x: 0, y: 0 },
      ...Array.from({ length: 80 }, (_, i) => {
        const x0 = i * 3, x1 = (i + 1) * 3;
        return { type: "C" as const, x1: x0 + 1, y1: i % 2 === 0 ? 0.6 : -0.6, x2: x0 + 2, y2: i % 2 === 0 ? 0.6 : -0.6, x: x1, y: 0 };
      })
    ];
    const formLine: MapObject = { kind: "line", symbol: SYM_FORM_LINE.id, path };
    const tags: MapObject[] = [];
    for (let i = 2; i < 78; i += 4) {
      tags.push({ kind: "line", symbol: SYM_SLOPE_TAG.id, path: [{ type: "M", x: i * 3, y: 0 }, { type: "L", x: i * 3, y: -1.0 }] });
    }
    const trail: MapObject = { kind: "line", symbol: SYM_TRAIL.id, path: [{ type: "M", x: 0, y: 20 }, { type: "L", x: 240, y: 20 }] };
    const crossTrails: MapObject[] = Array.from({ length: 10 }, (_, k): MapObject => ({
      kind: "line", symbol: SYM_SMALL_PATH.id, path: [{ type: "M", x: 20 + k * 20, y: 15 }, { type: "L", x: 20 + k * 20, y: 25 }]
    }));
    const allObjects = [formLine, ...tags, trail, ...crossTrails];
    const plan = autoDashPointsPlan([formLine, trail], allObjects, makeSymbols(), { bends: false });
    expect(plan.counts.objects).toBe(2);
    expect(plan.counts.slopeTags).toBe(tags.length);
    expect(plan.counts.junctions).toBe(crossTrails.length);
  });
});
