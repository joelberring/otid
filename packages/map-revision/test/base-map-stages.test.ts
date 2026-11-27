import { describe, expect, it } from "vitest";
import { clipFeaturesToBox, joinStages, stageSeams, unionStageAreas } from "../src/base-map";
import type { SourceFeature } from "../src";

const box = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
const boxEast = { minX: 100, minY: 0, maxX: 200, maxY: 100 };
const line = (points: [number, number][], closed = false, layer = "kurva"): SourceFeature => ({ layer, geometry: { kind: "line", points, closed } });
const area = (rings: [number, number][][], layer: string): SourceFeature => ({ layer, geometry: { kind: "area", rings } });
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const ringArea = (ring: readonly (readonly [number, number])[]) =>
  Math.abs(ring.reduce((sum, [x, y], i) => { const [nx, ny] = ring[(i + 1) % ring.length]!; return sum + x * ny - nx * y; }, 0)) / 2;

/** Kollar om någon kant i en polygon löper inuti etappsnittet x = seamX mellan yMin och yMax. */
function hasInternalSeamEdge(feature: SourceFeature, seamX: number, yMin: number, yMax: number): boolean {
  if (feature.geometry.kind !== "area") return false;
  return feature.geometry.rings.some(ring => ring.some((point, i) => {
    const next = ring[(i + 1) % ring.length]!;
    return Math.abs(point[0] - seamX) < 1e-4 && Math.abs(next[0] - seamX) < 1e-4
      && Math.min(point[1], next[1]) < yMax - 1e-3 && Math.max(point[1], next[1]) > yMin + 1e-3;
  }));
}

describe("etapperna som en grundkarta", () => {
  it("klipper punkter, linjer och ytor till etappens ruta", () => {
    const out = clipFeaturesToBox([
      { layer: "sten", geometry: { kind: "point", at: [50, 50] } },
      { layer: "sten", geometry: { kind: "point", at: [150, 50] } },
      line([[50, 50], [150, 50]]),
      { layer: "grönt", geometry: { kind: "area", rings: [[[50, 10], [150, 10], [150, 90], [50, 90]], [[120, 40], [140, 40], [140, 60]]] } }
    ], box);
    expect(out.map(feature => feature.geometry.kind)).toEqual(["point", "line", "area"]);
    const cut = out[1]!.geometry;
    expect(cut.kind === "line" && cut.points).toEqual([[50, 50], [100, 50]]);
    const clippedArea = out[2]!.geometry;
    // Ytterringen slutar vid kanten och hålet utanför rutan försvinner.
    expect(clippedArea.kind === "area" && clippedArea.rings.length).toBe(1);
    expect(clippedArea.kind === "area" && Math.max(...clippedArea.rings[0]!.map(([x]) => x))).toBe(100);
  });

  it("delar en sluten kurva som går över kanten i öppna bitar", () => {
    const out = clipFeaturesToBox([line([[80, 40], [120, 40], [120, 60], [80, 60]], true)], box);
    expect(out).toHaveLength(2);
    expect(out.every(feature => feature.geometry.kind === "line" && !feature.geometry.closed)).toBe(true);
  });

  it("slår ihop samma fil från alla etapper utan överlapp och fogar kurvor över skarven", () => {
    // Två etapper kant i kant vid x = 100; båda har bearbetats med marginal, så samma kurva finns i båda.
    const curve = line([[60, 50], [140, 50]]);
    const joined = joinStages([
      { box, parts: [{ name: "kurvor.dxf", data: { features: [curve], skipped: 0, crs: 3006 } }] },
      { box: boxEast, parts: [
        { name: "kurvor.dxf", data: { features: [curve], skipped: 1 } },
        { name: "branter.dxf", data: { features: [line([[150, 10], [160, 20]], false, "cliff2")], skipped: 0 } }
      ] }
    ]);
    expect(joined.map(part => part.name)).toEqual(["kurvor.dxf", "branter.dxf"]);
    const kurvor = joined[0]!.data;
    expect(kurvor.crs).toBe(3006);
    expect(kurvor.skipped).toBe(1);
    // Kurvan klipps per etapp och fogas skarvfri över x = 100.
    expect(kurvor.features.map(feature => feature.geometry.kind === "line" ? feature.geometry.points : [])).toEqual([[[60, 50], [100, 50], [140, 50]]]);
  });

  it("fogar brantlinjer (med bevarad riktning), diken, fuktstråk och spår över etappskarven", () => {
    const cliffSame = line([[70, 30], [130, 30]], false, "brant_opasserbar");
    const cliffLeft = line([[70, 70], [100, 70]], false, "brant_passerbar");
    const cliffRightReversed = line([[130, 70], [100, 70]], false, "brant_passerbar");
    const ditch = line([[60, 20], [140, 20]], false, "dike");
    const channel = line([[60, 40], [140, 40]], false, "fuktstrak");
    const track = line([[60, 80], [140, 80]], false, "spar_laser");
    const joined = joinStages([
      { box, parts: [
        { name: "brantlinjer.dxf", data: { features: [cliffSame, cliffLeft], skipped: 0 } },
        { name: "diken.dxf", data: { features: [ditch], skipped: 0 } },
        { name: "fukt.dxf", data: { features: [channel], skipped: 0 } },
        { name: "spar.dxf", data: { features: [track], skipped: 0 } }
      ] },
      { box: boxEast, parts: [
        { name: "brantlinjer.dxf", data: { features: [cliffSame, cliffRightReversed], skipped: 0 } },
        { name: "diken.dxf", data: { features: [ditch], skipped: 0 } },
        { name: "fukt.dxf", data: { features: [channel], skipped: 0 } },
        { name: "spar.dxf", data: { features: [track], skipped: 0 } }
      ] }
    ]);
    const byName = new Map(joined.map(part => [part.name, part.data.features]));
    const cliffs = byName.get("brantlinjer.dxf")!;
    // Likriktad brant fogas i exakt samma riktning; motriktade branter (huvud-mot-huvud vid x = 100) vänds INTE ihop.
    const impassable = cliffs.filter(feature => feature.layer === "brant_opasserbar");
    expect(impassable).toHaveLength(1);
    expect(impassable[0]!.geometry).toEqual({ kind: "line", closed: false, points: [[70, 30], [100, 30], [130, 30]] });
    const passable = cliffs.filter(feature => feature.layer === "brant_passerbar");
    expect(passable).toHaveLength(2);
    expect(passable.map(feature => feature.geometry.kind === "line" ? feature.geometry.points : [])).toEqual([[[70, 70], [100, 70]], [[130, 70], [100, 70]]]);

    expect(byName.get("diken.dxf")).toEqual([{ layer: "dike", geometry: { kind: "line", closed: false, points: [[60, 20], [100, 20], [140, 20]] } }]);
    expect(byName.get("fukt.dxf")).toEqual([{ layer: "fuktstrak", geometry: { kind: "line", closed: false, points: [[60, 40], [100, 40], [140, 40]] } }]);
    expect(byName.get("spar.dxf")).toEqual([{ layer: "spar_laser", geometry: { kind: "line", closed: false, points: [[60, 80], [100, 80], [140, 80]] } }]);
  });

  it("unionerar vegetation (401–410) rent över etappsnitt utan dubbelkant, med skilda klasser isär och hål intakta", () => {
    // DXF-stil (slutna linjer): ytterring 50–150 med ett hål inne i etapp 1 (60–80) och ett hål tvärs över snittet (90–110),
    // samt mörkare grönt (408) inne i det mittersta hålet.
    const vegFeatures: SourceFeature[] = [
      line(rect(50, 10, 150, 90), true, "gron_lattlopt"),
      line(rect(60, 30, 80, 70), true, "gron_lattlopt"),
      line(rect(90, 40, 110, 60), true, "gron_lattlopt"),
      line(rect(90, 40, 110, 60), true, "gron_svarlopt"),
      line(rect(10, 10, 30, 30), true, "oppen_mark")
    ];
    const joined = joinStages([
      { box, parts: [{ name: "vegetation.dxf", data: { features: vegFeatures, skipped: 0 } }] },
      { box: boxEast, parts: [{ name: "vegetation.dxf", data: { features: vegFeatures, skipped: 0 } }] }
    ]);
    const features = joined[0]!.data.features;
    const slow = features.filter(feature => feature.layer === "gron_lattlopt");
    const difficult = features.filter(feature => feature.layer === "gron_svarlopt");
    const open = features.filter(feature => feature.layer === "oppen_mark");
    expect(slow).toHaveLength(1);
    expect(difficult).toHaveLength(1);
    expect(open).toHaveLength(1);
    // Ingen dubbelkant längs snittet x = 100.
    expect(hasInternalSeamEdge(slow[0]!, 100, 10, 90)).toBe(false);
    expect(hasInternalSeamEdge(difficult[0]!, 100, 40, 60)).toBe(false);
    // Båda hålen i 406 (ett inne i etapp 1, ett tvärs över snittet) är helt intakta.
    const slowGeom = slow[0]!.geometry;
    expect(slowGeom.kind).toBe("area");
    if (slowGeom.kind === "area") {
      expect(slowGeom.rings).toHaveLength(3);
      expect(ringArea(slowGeom.rings[0]!)).toBeCloseTo(100 * 80, 2);
      const holeAreas = slowGeom.rings.slice(1).map(ringArea).sort((a, b) => a - b);
      expect(holeAreas[0]).toBeCloseTo(20 * 20, 2);
      expect(holeAreas[1]).toBeCloseTo(20 * 40, 2);
    }
    const diffGeom = difficult[0]!.geometry;
    expect(diffGeom.kind === "area" && ringArea(diffGeom.rings[0]!)).toBeCloseTo(20 * 20, 2);
  });

  it("unionerar fukt/sankmark (308/310), berg i dagen (214) och belagd yta (501) med hål över etappsnitt", () => {
    const fukt: SourceFeature[] = [
      line(rect(60, 10, 140, 50), true, "blott"),
      line(rect(60, 55, 140, 90), true, "fuktigt"),
      line([[60, 52], [140, 52]], false, "fuktstrak")
    ];
    const berg: SourceFeature[] = [
      area([rect(70, 20, 130, 80), rect(90, 40, 110, 60)], "berg_i_dagen")
    ];
    // Belagd yta i DXF-form: ytterring (moturs) och kvartershål (medurs) tvärs över skarven.
    const belagt: SourceFeature[] = [
      line(rect(50, 20, 150, 80), true, "belagd_yta_laser"),
      line([[85, 35], [85, 65], [115, 65], [115, 35]], true, "belagd_yta_laser")
    ];
    const joined = joinStages([
      { box, parts: [
        { name: "fukt.dxf", data: { features: fukt, skipped: 0 } },
        { name: "berg.dxf", data: { features: berg, skipped: 0 } },
        { name: "belagt.dxf", data: { features: belagt, skipped: 0 } }
      ] },
      { box: boxEast, parts: [
        { name: "fukt.dxf", data: { features: fukt, skipped: 0 } },
        { name: "berg.dxf", data: { features: berg, skipped: 0 } },
        { name: "belagt.dxf", data: { features: belagt, skipped: 0 } }
      ] }
    ]);
    const byName = new Map(joined.map(part => [part.name, part.data.features]));

    const fuktOut = byName.get("fukt.dxf")!;
    const wet = fuktOut.filter(feature => feature.layer === "blott");
    const moist = fuktOut.filter(feature => feature.layer === "fuktigt");
    const stream = fuktOut.filter(feature => feature.layer === "fuktstrak");
    expect(wet).toHaveLength(1);
    expect(moist).toHaveLength(1);
    expect(stream).toHaveLength(1);
    expect(hasInternalSeamEdge(wet[0]!, 100, 10, 50)).toBe(false);
    expect(hasInternalSeamEdge(moist[0]!, 100, 55, 90)).toBe(false);
    expect(wet[0]!.geometry.kind === "area" && ringArea(wet[0]!.geometry.rings[0]!)).toBeCloseTo(80 * 40, 2);
    expect(moist[0]!.geometry.kind === "area" && ringArea(moist[0]!.geometry.rings[0]!)).toBeCloseTo(80 * 35, 2);

    const bergOut = byName.get("berg.dxf")!;
    expect(bergOut).toHaveLength(1);
    expect(hasInternalSeamEdge(bergOut[0]!, 100, 20, 80)).toBe(false);
    expect(bergOut[0]!.geometry.kind === "area" && bergOut[0]!.geometry.rings).toHaveLength(2);
    expect(bergOut[0]!.geometry.kind === "area" && ringArea(bergOut[0]!.geometry.rings[1]!)).toBeCloseTo(20 * 20, 2);

    const belagtOut = byName.get("belagt.dxf")!;
    expect(belagtOut).toHaveLength(1);
    expect(hasInternalSeamEdge(belagtOut[0]!, 100, 20, 80)).toBe(false);
    expect(belagtOut[0]!.geometry.kind === "area" && belagtOut[0]!.geometry.rings).toHaveLength(2);
    expect(belagtOut[0]!.geometry.kind === "area" && ringArea(belagtOut[0]!.geometry.rings[0]!)).toBeCloseTo(100 * 60, 2);
    expect(belagtOut[0]!.geometry.kind === "area" && ringArea(belagtOut[0]!.geometry.rings[1]!)).toBeCloseTo(30 * 30, 2);
  });

  it("hanterar 4-etapps korsskarv med hål mitt över skärningspunkten och låter icke-snittytor och byggnader vara orörda", () => {
    const sw = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const se = { minX: 100, minY: 0, maxX: 200, maxY: 100 };
    const nw = { minX: 0, minY: 100, maxX: 100, maxY: 200 };
    const ne = { minX: 100, minY: 100, maxX: 200, maxY: 200 };
    const crossArea = area([rect(60, 60, 140, 140), rect(80, 80, 120, 120)], "oppen_mark_spridda_trad");
    const building = area([rect(80, 20, 120, 40)], "byggnad");
    const joined = joinStages([sw, se, nw, ne].map(stageBox => ({
      box: stageBox,
      parts: [
        { name: "vegetation.dxf", data: { features: [crossArea], skipped: 0 } },
        { name: "byggnader.geojson", data: { features: [building], skipped: 0 } }
      ]
    })));
    const veg = joined[0]!.data.features;
    expect(veg).toHaveLength(1);
    expect(veg[0]!.geometry.kind === "area" && veg[0]!.geometry.rings).toHaveLength(2);
    expect(veg[0]!.geometry.kind === "area" && ringArea(veg[0]!.geometry.rings[0]!)).toBeCloseTo(80 * 80, 2);
    expect(veg[0]!.geometry.kind === "area" && ringArea(veg[0]!.geometry.rings[1]!)).toBeCloseTo(40 * 40, 2);
    // Byggnader unioneras inte som markytor.
    expect(joined[1]!.data.features).toHaveLength(2);
  });

  it("fångar ogiltiga självskärande polygoner säkert med fallback och lämnar övriga snittytor oberörda", () => {
    const seams = stageSeams([box, boxEast]);
    expect(seams).toEqual([{ axis: "x", at: 100, from: 0, to: 100 }]);
    // Självskärande timglaspolygon (bowtie) som nuddar snittet x = 100.
    const bowtie = area([[[50, 10], [100, 40], [100, 10], [50, 40]]], "gron_lattlopt");
    const validRight = area([rect(100, 10, 140, 40)], "gron_lattlopt");
    // Ett helt friskt par på samma snitt högre upp (y = 60..90) ska ändå unioneras rent.
    const cleanLeft = area([rect(60, 60, 100, 90)], "gron_lattlopt");
    const cleanRight = area([rect(100, 60, 140, 90)], "gron_lattlopt");
    // Många inre polygoner långt från snittet hoppas över utan polygon-clipping.
    const interior = Array.from({ length: 300 }, (_, i) => area([rect(5 + (i % 15) * 4, 5 + Math.floor(i / 15) * 4, 7 + (i % 15) * 4, 7 + Math.floor(i / 15) * 4)], "gron_lattlopt"));

    const started = performance.now();
    const out = unionStageAreas([bowtie, validRight, cleanLeft, cleanRight, ...interior], seams);
    expect(performance.now() - started).toBeLessThan(1000);
    // Bowtie + validRight står kvar som fallback (2), cleanLeft+cleanRight blev 1, alla 300 inre kvar.
    expect(out).toHaveLength(303);
    expect(out).toContain(bowtie);
    expect(out).toContain(validRight);
    const mergedClean = out.find(feature => feature.geometry.kind === "area" && ringArea(feature.geometry.rings[0]!) > 2000);
    expect(mergedClean).toBeDefined();
    expect(hasInternalSeamEdge(mergedClean!, 100, 60, 90)).toBe(false);
  });
});
