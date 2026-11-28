import { describe, expect, it } from "vitest";
import type { SourceFeature } from "../src";
import type { HeightField } from "../src/base-map/clear-contours";
import { alignCliffsToContours } from "../src/base-map/cliff-contour-fit";

/** Sluttning som stiger norrut (+y): z(x, y) = base + slope * y, så en brant väst->öst har uppför till vänster och nedför till höger. */
const northSlope = (slope = 0.8): Pick<HeightField, "heightAt"> => ({
  heightAt: (_x, y) => 20 + slope * y
});

const line = (layer: string, points: [number, number][], closed = false): SourceFeature => ({
  layer,
  geometry: { kind: "line", closed, points }
});

function segmentsCross(a: readonly [number, number], b: readonly [number, number], c: readonly [number, number], d: readonly [number, number]): boolean {
  const s = (p: readonly [number, number], q: readonly [number, number], r: readonly [number, number]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = s(c, d, a), d2 = s(c, d, b), d3 = s(a, b, c), d4 = s(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function crossingsBetween(a: readonly (readonly [number, number])[], b: readonly (readonly [number, number])[]): number {
  let count = 0;
  for (let i = 0; i < a.length - 1; i += 1) {
    for (let j = 0; j < b.length - 1; j += 1) {
      if (segmentsCross(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!)) count += 1;
    }
  }
  return count;
}

describe("brant-kurva-koppling (alignCliffsToContours)", () => {
  it("flyttar en slingrande parallell brant mjukt upp på krönsidan av en flyttad 101-kurva utan korsningar och inom 2,5 m", () => {
    // 101-kurva flyttad till y = 50; brant 201 slingrar över den mellan y = 49,3 och y = 50,7 (flera korsningar).
    const contour = line("contour", [[0, 50], [50, 50]]);
    const weavingCliff = line("brant_opasserbar", [
      [5, 50.6], [12, 49.3], [20, 50.7], [28, 49.4], [36, 50.5], [44, 49.5]
    ]);
    const out = alignCliffsToContours([contour, weavingCliff], northSlope(1.0), { scale: 15_000 });
    expect(out.alignedCliffs).toBe(1);
    expect(out.reversedCliffs).toBe(0);
    const cliff = out.features.find(f => f.layer === "brant_opasserbar")!;
    expect(cliff.geometry.kind).toBe("line");
    const pts = cliff.geometry.kind === "line" ? cliff.geometry.points : [];
    // Noll korsningar mot 101-kurvan, och hela branten ligger nu rent på uppförssidan (y >= 50,9).
    expect(crossingsBetween(pts, [[0, 50], [50, 50]])).toBe(0);
    for (const [, y] of pts) {
      expect(y).toBeGreaterThanOrEqual(50.9);
      expect(y).toBeLessThanOrEqual(52.5);
    }
    // Ritriktningen bevaras (väst -> öst, nedför åt söder till höger).
    expect(pts[pts.length - 1]![0]).toBeGreaterThan(pts[0]![0]);
  });

  it("anpassar en brant när en höjdkurva flyttats lite uppför över branten och håller sig klampad <= 2,5 m", () => {
    const shiftedContour = line("contour_index", [[0, 30.8], [40, 30.8]]);
    const cliff = line("brant_passerbar", [[5, 30], [20, 30], [35, 30]]);
    const out = alignCliffsToContours([shiftedContour, cliff], northSlope(0.9), { scale: 10_000 });
    expect(out.alignedCliffs).toBe(1);
    const moved = out.features.find(f => f.layer === "brant_passerbar")!;
    const pts = moved.geometry.kind === "line" ? moved.geometry.points : [];
    expect(crossingsBetween(pts, [[0, 30.8], [40, 30.8]])).toBe(0);
    for (const [, y] of pts) {
      expect(y).toBeGreaterThanOrEqual(31.8);
      expect(y - 30).toBeLessThanOrEqual(2.5 + 1e-6);
    }
  });

  it("rör inte branter som korsar en kurva brant (>45°) eller som redan ligger klart fria", () => {
    const contour = line("contour", [[0, 50], [60, 50]]);
    const crossCliff = line("brant_passerbar", [[20, 35], [20, 65]]);
    const clearCliff = line("brant_passerbar", [[5, 55], [40, 55]]);
    const out = alignCliffsToContours([contour, crossCliff, clearCliff], {
      heightAt: (x, y) => 20 + 0.8 * y - 0.8 * x
    }, { scale: 15_000 });
    expect(out.alignedCliffs).toBe(0);
    expect(out.features[1]).toBe(crossCliff);
    expect(out.features[2]).toBe(clearCliff);
  });

  it("skyddar mot att knuffa en brant över en smal åsrygg så taggarna aldrig vänds", () => {
    // Smal ås med topp vid y = 50,8: norr om 50,8 lutar marken NERÅT norrut, så en uppförsflytt till y = 52 skulle vända fallet!
    const ridgeField: Pick<HeightField, "heightAt"> = {
      heightAt: (_x, y) => 30 - Math.abs(y - 50.8) * 1.5
    };
    const contour = line("contour", [[0, 50.3], [40, 50.3]]);
    const cliff = line("brant_passerbar", [[5, 49.8], [20, 49.8], [35, 49.8]]);
    const out = alignCliffsToContours([contour, cliff], ridgeField, { scale: 15_000 });
    const result = out.features.find(f => f.layer === "brant_passerbar")!;
    const pts = result.geometry.kind === "line" ? result.geometry.points : [];
    // Oavsett om flytten halverades eller avvisades måste vänster (uppför) alltid vara högre än höger (nedför).
    const midY = pts[Math.floor(pts.length / 2)]![1];
    expect(ridgeField.heightAt(20, midY + 3)!).toBeGreaterThanOrEqual(ridgeField.heightAt(20, midY - 3)! - 1e-6);
  });

  it("klipper bort 103-hjälpkurvor inom 2,5 m från 201-branter, tar bort stumpar < 6 m men lämnar 103 vid 202 orörd", () => {
    const cliff201 = line("brant_opasserbar", [[20, 50], [40, 50]]);
    const cliff202 = line("brant_passerbar", [[20, 80], [40, 80]]);
    // Hjälpkurva som löper rakt över 201-branten: vänsterdel 0..17,5 (17,5 m -> kvar), mittdel på 201 bort, högerstump 42,5..46 (3,5 m < 6 m -> bort).
    const formOn201 = line("formline", [[0, 50.5], [46, 50.5]]);
    // Hjälpkurva rakt på 202-brant: ska INTE klippas.
    const formOn202 = line("formline", [[0, 80.5], [50, 80.5]]);
    // Sluten hjälpkurvering som nuddar 201 på sydkanten: klipps öppen till en sammanhängande båge utan falsk delning vid index 0.
    const closedForm = line("formline", [
      [30, 58], [40, 58], [40, 51], [20, 51], [20, 58]
    ], true);

    const out = alignCliffsToContours([cliff201, cliff202, formOn201, formOn202, closedForm], northSlope(0.5), { scale: 15_000 });
    expect(out.clippedFormlines).toBe(2);
    const formlines = out.features.filter(f => f.layer === "formline");
    // 1 bit kvar av formOn201 (vänsterdelen), 1 oförändrad formOn202, 1 öppen båge av closedForm.
    expect(formlines).toHaveLength(3);
    expect(formlines).toContain(formOn202);
    const leftBit = formlines.find(f => f.geometry.kind === "line" && f.geometry.points[0]![0] === 0 && f.geometry.points[0]![1] === 50.5)!;
    const leftPts = leftBit.geometry.kind === "line" ? leftBit.geometry.points : [];
    expect(leftPts[leftPts.length - 1]![0]).toBeLessThanOrEqual(17.6);
    const arc = formlines.find(f => f !== formOn202 && f !== leftBit)!;
    expect(arc.geometry.kind === "line" && arc.geometry.closed).toBe(false);
    // Inga punkter i klippta hjälpkurvor ligger inom 2,5 m från 201-branten.
    for (const f of [leftBit, arc]) {
      if (f.geometry.kind !== "line") continue;
      for (const [x, y] of f.geometry.points) {
        const cx = Math.max(20, Math.min(40, x));
        expect(Math.hypot(x - cx, y - 50)).toBeGreaterThanOrEqual(2.49);
      }
    }
  });

  it("upprätthåller hård nedförsinvariant: vänder upp-och-nedvända 201/202-branter mot höjdrastret (0 inverterade)", () => {
    // Sluttning stiger norrut (+y), så en brant öst -> väst har uppför till HÖGER (fel!) och måste vändas till väst -> öst.
    const inverted201 = line("brant_opasserbar", [[40, 20], [10, 20]]);
    const inverted202 = line("brant_passerbar", [[40, 40], [10, 40]]);
    const correct202 = line("brant_passerbar", [[10, 60], [40, 60]]);
    const out = alignCliffsToContours([inverted201, inverted202, correct202], northSlope(1.0), { scale: 4_000 });
    expect(out.reversedCliffs).toBe(2);
    const cliffs = out.features.filter(f => f.layer.startsWith("brant_"));
    for (const cliff of cliffs) {
      const pts = cliff.geometry.kind === "line" ? cliff.geometry.points : [];
      // Alla tre går nu väst -> öst så högerhandstaggarna pekar söderut (nedför).
      expect(pts[0]![0]).toBeLessThan(pts[pts.length - 1]![0]);
    }
  });
});
