import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDxfMerger, dxfFrame, dxfMergeOptions, mergeGeoJson, type Box } from "../../../scripts/geo-merge.ts";
import { hasSeamEdge, signedArea, stageSeams, type SeamPoint } from "../../../scripts/geo-merge-seams.ts";
import { runMergeJobHelper, type HelperDeps } from "../../../scripts/geo-worker-helpers.ts";
import { parseDxf } from "../src/vector-parse";

const west: Box = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
const east: Box = { minX: 100, minY: 0, maxX: 200, maxY: 100 };
const twoHoriz: Box = { minX: 0, minY: 0, maxX: 200, maxY: 100 };

const south: Box = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
const north: Box = { minX: 0, minY: 100, maxX: 100, maxY: 200 };
const twoVert: Box = { minX: 0, minY: 0, maxX: 100, maxY: 200 };

const qSW: Box = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
const qSE: Box = { minX: 100, minY: 0, maxX: 200, maxY: 100 };
const qNW: Box = { minX: 0, minY: 100, maxX: 100, maxY: 200 };
const qNE: Box = { minX: 100, minY: 100, maxX: 200, maxY: 200 };
const fourGrid: Box = { minX: 0, minY: 0, maxX: 200, maxY: 200 };

const geoFile = (features: unknown[]) =>
  JSON.stringify({ type: "FeatureCollection", crs: { type: "name", properties: { name: "EPSG:3006" } }, features });

const dxfDoc = (entities: string) =>
  `0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;

const poly = (layer: string, points: readonly [number, number][], closed = false, elevation?: number) =>
  `0\nPOLYLINE\n8\n${layer}\n66\n1\n70\n${closed ? 1 : 0}\n${elevation === undefined ? "" : `38\n${elevation}\n`}${points
    .map(([x, y]) => `0\nVERTEX\n8\n${layer}\n10\n${x}\n20\n${y}\n`).join("")}0\nSEQEND\n`;

const lwpoly = (layer: string, points: readonly [number, number][], closed = false, elevation?: number) =>
  `0\nLWPOLYLINE\n8\n${layer}\n${elevation === undefined ? "" : `38\n${elevation}\n`}90\n${points.length}\n70\n${closed ? 1 : 0}\n${points
    .map(([x, y]) => `10\n${x}\n20\n${y}\n`).join("")}`;

function mergeDxfStages(name: string, stages: readonly { readonly text: string; readonly box: Box }[], union: Box): string {
  const merger = createDxfMerger(stages.map(s => s.box), union, dxfMergeOptions(name));
  const out: string[] = [dxfFrame(stages[0]!.text).head];
  for (let i = 0; i < stages.length; i += 1) {
    const lines = merger.addStage(stages[i]!.text, stages[i]!.box, i);
    if (lines.length) out.push(`${lines.join("\n")}\n`);
  }
  const tail = merger.finish();
  if (tail.length) out.push(`${tail.join("\n")}\n`);
  out.push("0\nENDSEC\n0\nEOF\n");
  return out.join("");
}

const closeRing = (pts: readonly [number, number][]): [number, number][] => [...pts, pts[0]!];
const openOf = (pts: readonly SeamPoint[]): SeamPoint[] =>
  pts.length > 1 && pts[0]![0] === pts.at(-1)![0] && pts[0]![1] === pts.at(-1)![1] ? pts.slice(0, -1) : [...pts];

describe("Etapp G5: skarvfri vatten-union (vatten.geojson)", () => {
  it("unionerar en sjö tvärs över en 2-etapps vertikal skarv utan inre strandlinjekant", () => {
    const lake = { type: "Feature", properties: { layer: "vatten" }, geometry: { type: "Polygon", coordinates: [closeRing([[40, 20], [160, 20], [160, 80], [40, 80]])] } };
    const merged = JSON.parse(mergeGeoJson([{ text: geoFile([lake]), box: west }, { text: geoFile([lake]), box: east }], twoHoriz)) as {
      features: { properties: { layer: string }; geometry: { type: string; coordinates: [number, number][][] } }[];
    };
    expect(merged.features).toHaveLength(1);
    const rings = merged.features[0]!.geometry.coordinates;
    expect(rings).toHaveLength(1);
    const outer = openOf(rings[0]!);
    expect(hasSeamEdge(outer, stageSeams([west, east], twoHoriz))).toBe(false);
    expect(Math.abs(signedArea(outer))).toBeCloseTo(120 * 60, 1);
  });

  it("unionerar en sjö med ö både helt i ena etappen och tvärs över skarvsnittet", () => {
    const outer = closeRing([[20, 10], [180, 10], [180, 90], [20, 90]]);
    const westIsland = closeRing([[35, 30], [35, 50], [55, 50], [55, 30]]);
    const seamIsland = closeRing([[85, 30], [85, 70], [115, 70], [115, 30]]);
    const lake = { type: "Feature", properties: { layer: "vatten" }, geometry: { type: "Polygon", coordinates: [outer, westIsland, seamIsland] } };
    const merged = JSON.parse(mergeGeoJson([{ text: geoFile([lake]), box: west }, { text: geoFile([lake]), box: east }], twoHoriz)) as {
      features: { geometry: { type: string; coordinates: [number, number][][] } }[];
    };
    const seams = stageSeams([west, east], twoHoriz);
    expect(merged.features).toHaveLength(1);
    const rings = merged.features[0]!.geometry.coordinates;
    expect(rings).toHaveLength(3); // 1 ytterkant + 2 ö-hål
    const outerOpen = openOf(rings[0]!);
    expect(hasSeamEdge(outerOpen, seams)).toBe(false);
    expect(signedArea(outerOpen)).toBeCloseTo(160 * 80, 1);
    const holeAreas = rings.slice(1).map(r => {
      const open = openOf(r);
      expect(hasSeamEdge(open, seams)).toBe(false);
      return Math.abs(signedArea(open));
    }).sort((a, b) => a - b);
    expect(holeAreas[0]).toBeCloseTo(20 * 20, 1);
    expect(holeAreas[1]).toBeCloseTo(30 * 40, 1);
  });

  it("hanterar konkav C-formad sjö som sluter en ö över skarven och små <=0,05 m avvikelser", () => {
    // Vänster C-halva + höger spegel-C (med 0,04 m avvikelse på skarven) bildar en sjö med ett ö-hål!
    const westC = {
      type: "Feature", properties: { layer: "vatten" },
      geometry: { type: "Polygon", coordinates: [closeRing([[40, 10], [100, 10], [100, 30], [70, 30], [70, 70], [100, 70], [100, 90], [40, 90]])] }
    };
    const eastC = {
      type: "Feature", properties: { layer: "vatten" },
      geometry: { type: "Polygon", coordinates: [closeRing([[100, 10.03], [160, 10], [160, 90], [100, 89.97], [100, 70.04], [130, 70], [130, 30], [100, 29.98]])] }
    };
    const merged = JSON.parse(mergeGeoJson([{ text: geoFile([westC]), box: west }, { text: geoFile([eastC]), box: east }], twoHoriz)) as {
      features: { geometry: { coordinates: [number, number][][] } }[];
    };
    const seams = stageSeams([west, east], twoHoriz);
    expect(merged.features).toHaveLength(1);
    const [outerRing, holeRing] = merged.features[0]!.geometry.coordinates;
    expect(merged.features[0]!.geometry.coordinates).toHaveLength(2);
    expect(hasSeamEdge(openOf(outerRing!), seams)).toBe(false);
    expect(hasSeamEdge(openOf(holeRing!), seams)).toBe(false);
    expect(Math.abs(signedArea(openOf(outerRing!)) - 120 * 80)).toBeLessThan(3);
    expect(Math.abs(Math.abs(signedArea(openOf(holeRing!))) - 60 * 40)).toBeLessThan(3);
  });

  it("unionerar en sjö (inkl. ö mitt i korset!) över 4-etapps kors-skarv", () => {
    const outer = closeRing([[20, 20], [180, 20], [180, 180], [20, 180]]);
    const centerIsland = closeRing([[80, 80], [80, 120], [120, 120], [120, 80]]);
    const lake = { type: "Feature", properties: { layer: "vatten" }, geometry: { type: "Polygon", coordinates: [outer, centerIsland] } };
    const stages = [qSW, qSE, qNW, qNE].map(box => ({ text: geoFile([lake]), box }));
    const merged = JSON.parse(mergeGeoJson(stages, fourGrid)) as {
      features: { geometry: { coordinates: [number, number][][] } }[];
    };
    const seams = stageSeams([qSW, qSE, qNW, qNE], fourGrid);
    expect(merged.features).toHaveLength(1);
    const [mergedOuter, mergedHole] = merged.features[0]!.geometry.coordinates;
    expect(merged.features[0]!.geometry.coordinates).toHaveLength(2);
    expect(hasSeamEdge(openOf(mergedOuter!), seams)).toBe(false);
    expect(hasSeamEdge(openOf(mergedHole!), seams)).toBe(false);
    expect(signedArea(openOf(mergedOuter!))).toBeCloseTo(160 * 160, 1);
    expect(Math.abs(signedArea(openOf(mergedHole!)))).toBeCloseTo(40 * 40, 1);
  });

  it("håller isär skilda polygonlager och skilda sjöar på samma horisontella skarv", () => {
    const lake1 = { type: "Feature", properties: { layer: "vatten" }, geometry: { type: "Polygon", coordinates: [closeRing([[10, 70], [30, 70], [30, 130], [10, 130]])] } };
    const lake2 = { type: "Feature", properties: { layer: "vatten" }, geometry: { type: "Polygon", coordinates: [closeRing([[60, 70], [80, 70], [80, 130], [60, 130]])] } };
    const marsh = { type: "Feature", properties: { layer: "sankmark" }, geometry: { type: "Polygon", coordinates: [closeRing([[30, 70], [60, 70], [60, 130], [30, 130]])] } };
    const merged = JSON.parse(mergeGeoJson([{ text: geoFile([lake1, lake2, marsh]), box: south }, { text: geoFile([lake1, lake2, marsh]), box: north }], twoVert)) as {
      features: { properties: { layer: string }; geometry: { coordinates: [number, number][][] } }[];
    };
    expect(merged.features).toHaveLength(3);
    expect(merged.features.filter(f => f.properties.layer === "vatten")).toHaveLength(2);
    expect(merged.features.filter(f => f.properties.layer === "sankmark")).toHaveLength(1);
  });
});

describe("Etapp G5: skarvfogning av kurvor, branter, diken, fuktstråk och stigar", () => {
  it("fogar öppna och slutna kurvor (LWPOLYLINE & POLYLINE) utan att blanda höjder eller korsa parallella linjer", () => {
    // Öppen kurva z=35 (med 0,6 m glapp på skarven), annan höjd z=40 i samma punkt, samt sluten kulle z=50 som delas vid x=100.
    const a = dxfDoc(
      lwpoly("contour", [[20, 50], [100, 50]], false, 35)
      + lwpoly("contour", [[20, 50.7], [100, 50.7]], false, 35)
      + lwpoly("contour", [[20, 50], [100, 50]], false, 40)
      + poly("depression", [[70, 20], [130, 20], [130, 35], [70, 35]], true, 50)
    );
    const b = dxfDoc(
      lwpoly("contour", [[180, 50], [100, 50.1]], false, 35) // vänd i etapp 2!
      + lwpoly("contour", [[100, 50.7], [180, 50.7]], false, 35)
      + lwpoly("contour", [[100, 50], [180, 50]], false, 40)
      + poly("depression", [[70, 20], [130, 20], [130, 35], [70, 35]], true, 50)
    );
    const parsed = parseDxf(mergeDxfStages("kurvor.dxf", [{ text: a, box: west }, { text: b, box: east }], twoHoriz));
    const z35 = parsed.features.filter(f => f.layer === "contour" && f.elevation === 35);
    const z40 = parsed.features.filter(f => f.layer === "contour" && f.elevation === 40);
    const dep = parsed.features.filter(f => f.layer === "depression" && f.elevation === 50);
    expect(z35).toHaveLength(2);
    expect(z40).toHaveLength(1);
    expect(dep).toHaveLength(1);
    expect(dep[0]!.geometry.kind === "line" && dep[0]!.geometry.closed).toBe(true);
    // Parallella z=35 ska kopplas till sin egen fortsättning (närmaste först): 50→50 och 50.7→50.7.
    const ys = z35.map(f => {
      const pts = f.geometry.kind === "line" ? f.geometry.points : [];
      return [pts[0]![1], pts.at(-1)![1]].sort((u, v) => u - v);
    }).sort((u, v) => u[0]! - v[0]!);
    expect(ys).toEqual([[50, 50], [50.7, 50.7]]);
  });

  it("fogar en kurva diagonalt genom en 4-etapps kors-skarv och en slinga genom alla 4 etapper", () => {
    const diag = lwpoly("contour", [[30, 30], [170, 170]], false, 15);
    const loop = lwpoly("formline", [[60, 60], [140, 60], [140, 140], [60, 140]], true, 22.5);
    const stages = [qSW, qSE, qNW, qNE].map(box => ({ text: dxfDoc(diag + loop), box }));
    const parsed = parseDxf(mergeDxfStages("kurvor.dxf", stages, fourGrid));
    const contours = parsed.features.filter(f => f.layer === "contour");
    const forms = parsed.features.filter(f => f.layer === "formline");
    expect(contours).toHaveLength(1);
    expect(contours[0]!.geometry.kind === "line" && [contours[0]!.geometry.points[0], contours[0]!.geometry.points.at(-1)]).toEqual([[30, 30], [170, 170]]);
    expect(forms).toHaveLength(1);
    expect(forms[0]!.geometry.kind === "line" && forms[0]!.geometry.closed).toBe(true);
  });

  it("KRITISKT: fogar riktade brantlinjer i brantlinjer.dxf ENDAST slut→start och vänder ALDRIG motriktade branter", () => {
    // 1. Medriktad brant österut (slut_A = start_B vid x=100, y=20) — ska fogas till 1 linje väst→öst!
    // 2. Motriktad brant (slut_A = slut_B vid x=100, y=50) — får ALDRIG vändas eller fogas!
    // 3. Motriktad brant (start_A = start_B vid x=100, y=80) — får ALDRIG vändas eller fogas!
    // 4. Olika lager (brant_opasserbar vs brant_passerbar vid y=35) — får ALDRIG fogas!
    const a = dxfDoc(
      poly("brant_opasserbar", [[50, 20], [100, 20]])
      + poly("brant_opasserbar", [[50, 50], [100, 50]])
      + poly("brant_passerbar", [[100, 80], [50, 80]])
      + poly("brant_opasserbar", [[50, 35], [100, 35]])
    );
    const b = dxfDoc(
      poly("brant_opasserbar", [[100, 20.4], [150, 20]])
      + poly("brant_opasserbar", [[150, 50], [100, 50]])
      + poly("brant_passerbar", [[100, 80], [150, 80]])
      + poly("brant_passerbar", [[100, 35], [150, 35]])
    );
    const parsed = parseDxf(mergeDxfStages("brantlinjer.dxf", [{ text: a, box: west }, { text: b, box: east }], twoHoriz));
    const atY = (targetY: number) => parsed.features.filter(f => f.geometry.kind === "line" && Math.abs(f.geometry.points[0]![1] - targetY) < 1);

    // 1. Medriktad brant fogad med bevarad riktning [50, 20] → [150, 20]
    const aligned = atY(20);
    expect(aligned).toHaveLength(1);
    expect(aligned[0]!.geometry.kind === "line" && [aligned[0]!.geometry.points[0], aligned[0]!.geometry.points.at(-1)]).toEqual([[50, 20], [150, 20]]);

    // 2. Slut-mot-slut vändes INTE
    const headToHead = atY(50);
    expect(headToHead).toHaveLength(2);
    expect(headToHead.map(f => f.geometry.kind === "line" ? [f.geometry.points[0], f.geometry.points.at(-1)] : []))
      .toEqual([[[50, 50], [100, 50]], [[150, 50], [100, 50]]]);

    // 3. Start-mot-start vändes INTE
    const tailToTail = atY(80);
    expect(tailToTail).toHaveLength(2);
    expect(tailToTail.map(f => f.geometry.kind === "line" ? [f.geometry.points[0], f.geometry.points.at(-1)] : []))
      .toEqual([[[100, 80], [50, 80]], [[100, 80], [150, 80]]]);

    // 4. Olika brantlager fogades INTE
    expect(atY(35)).toHaveLength(2);
  });

  it("fogar brantlinjer.geojson med bevarad riktning, viktad drop3/drop6 och summerad längd", () => {
    const westAligned = { type: "Feature", geometry: { type: "LineString", coordinates: [[50, 20], [100, 20]] }, properties: { drop3: 3.0, drop6: 5.0, length: 50 } };
    const eastAligned = { type: "Feature", geometry: { type: "LineString", coordinates: [[100, 20], [130, 20]] }, properties: { drop3: 4.0, drop6: 6.0, length: 30 } };
    // Realistiskt överlapp: samma 30 m-brant [85..115] i båda etapperna ska ge längd 30 (inte 60!).
    const sharedCliff = { type: "Feature", geometry: { type: "LineString", coordinates: [[85, 40], [115, 40]] }, properties: { drop3: 2.5, drop6: 4.0, length: 30 } };
    // Motriktad brant i GeoJSON: får inte fogas!
    const oppW = { type: "Feature", geometry: { type: "LineString", coordinates: [[50, 70], [100, 70]] }, properties: { drop3: 2.0, drop6: 3.0, length: 50 } };
    const oppE = { type: "Feature", geometry: { type: "LineString", coordinates: [[140, 70], [100, 70]] }, properties: { drop3: 2.0, drop6: 3.0, length: 40 } };

    // Lägg östra halvan FÖRST för att testa bakåtfogning utan vändning!
    const merged = JSON.parse(mergeGeoJson([
      { text: geoFile([eastAligned, sharedCliff, oppE]), box: east },
      { text: geoFile([westAligned, sharedCliff, oppW]), box: west }
    ], twoHoriz)) as { features: { properties: { drop3: number; drop6: number; length: number }; geometry: { coordinates: [number, number][] } }[] };

    const byY = (y: number) => merged.features.filter(f => Math.abs(f.geometry.coordinates[0]![1] - y) < 1);
    const aligned = byY(20);
    expect(aligned).toHaveLength(1);
    expect(aligned[0]!.geometry.coordinates).toEqual([[50, 20], [100, 20], [130, 20]]);
    expect(aligned[0]!.properties).toEqual({ drop3: 3.38, drop6: 5.38, length: 80 });

    const shared = byY(40);
    expect(shared).toHaveLength(1);
    expect(shared[0]!.geometry.coordinates).toEqual([[85, 40], [100, 40], [115, 40]]);
    expect(shared[0]!.properties).toEqual({ drop3: 2.5, drop6: 4.0, length: 30 });

    const opp = byY(70);
    expect(opp).toHaveLength(2);
    expect(opp.map(f => [f.geometry.coordinates[0], f.geometry.coordinates.at(-1)])).toEqual([[[140, 70], [100, 70]], [[50, 70], [100, 70]]]);
  });

  it("fogar diken.dxf, spar.dxf och fuktstrak i fukt.dxf över skarven", () => {
    const dA = dxfDoc(poly("dike", [[30, 30], [100, 30]]) + poly("fuktstrak_terrang", [[30, 60], [100, 60]]));
    const dB = dxfDoc(poly("dike", [[160, 30], [100, 30.3]]) + poly("fuktstrak_terrang", [[100, 60], [170, 60]]));
    const ditches = parseDxf(mergeDxfStages("diken.dxf", [{ text: dA, box: west }, { text: dB, box: east }], twoHoriz));
    expect(ditches.features).toHaveLength(2);
    expect(ditches.features.map(f => f.layer).sort()).toEqual(["dike", "fuktstrak_terrang"]);

    const sA = dxfDoc(poly("spar_laser", [[20, 40], [100, 40]]));
    const sB = dxfDoc(poly("spar_laser", [[100, 40.5], [180, 40]]));
    const tracks = parseDxf(mergeDxfStages("spar.dxf", [{ text: sA, box: west }, { text: sB, box: east }], twoHoriz));
    expect(tracks.features).toHaveLength(1);
    expect(tracks.features[0]!.geometry.kind === "line" && tracks.features[0]!.geometry.points.length).toBe(3);
  });
});

describe("Etapp G5: skarvfria DXF-ytor (vegetation, fukt, berg, belagt)", () => {
  it("unionerar vegetation.dxf per lager över 2- och 4-etapps skarv, bevarar hål och håller isär olika lager", () => {
    // gront_1 med skogshål som korsar skarven + angränsande oppen_mark (annat lager!) + orörd yta inne i etappen.
    const vegA = dxfDoc(
      poly("gront_1", [[20, 10], [180, 10], [180, 60], [20, 60]], true)
      + poly("gront_1", [[80, 25], [120, 25], [120, 45], [80, 45]], true) // hål skrivet moturs: ska ändå identifieras som hål!
      + poly("oppen_mark", [[20, 65], [100, 65], [100, 90], [20, 90]], true)
      + poly("gront_2", [[10, 10], [15, 10], [15, 15], [10, 15]], true)
    );
    const vegB = dxfDoc(
      poly("gront_1", [[20, 10], [180, 10], [180, 60], [20, 60]], true)
      + poly("gront_1", [[80, 25], [120, 25], [120, 45], [80, 45]], true)
      + poly("gront_1", [[100, 65], [180, 65], [180, 90], [100, 90]], true) // möter oppen_mark på skarven — får INTE slås ihop!
    );
    const seams = stageSeams([west, east], twoHoriz);
    const parsed = parseDxf(mergeDxfStages("vegetation.dxf", [{ text: vegA, box: west }, { text: vegB, box: east }], twoHoriz));
    const gront1 = parsed.features.filter(f => f.layer === "gront_1");
    const open = parsed.features.filter(f => f.layer === "oppen_mark");
    const gront2 = parsed.features.filter(f => f.layer === "gront_2");
    expect(open).toHaveLength(1);
    expect(gront2).toHaveLength(1);
    // gront_1: 1 sammanslagen ytterring (160×50) + 1 sammanslaget hål (40×20) + 1 separat ruta [100..180]×[65..90]
    expect(gront1).toHaveLength(3);
    const areas = gront1.map(f => {
      const pts = f.geometry.kind === "line" ? f.geometry.points : [];
      return Math.round(signedArea(pts));
    }).sort((a, b) => a - b);
    expect(areas).toEqual([-800, 2000, 8000]);
    // Den sammanslagna sjö/grönt-ytan och dess hål får inte ha några skarvkanter kvar på x = 100.
    const bigRings = gront1.filter(f => f.geometry.kind === "line" && (Math.abs(signedArea(f.geometry.points)) > 7000 || signedArea(f.geometry.points) < 0));
    expect(bigRings.every(f => f.geometry.kind === "line" && !hasSeamEdge(f.geometry.points, seams))).toBe(true);

    // 4-etapps kors-skarv på vegetation.dxf
    const cross = dxfDoc(poly("gront_3", [[40, 40], [160, 40], [160, 160], [40, 160]], true));
    const parsed4 = parseDxf(mergeDxfStages("vegetation.dxf", [qSW, qSE, qNW, qNE].map(box => ({ text: cross, box })), fourGrid));
    expect(parsed4.features).toHaveLength(1);
    const ring4 = parsed4.features[0]!.geometry.kind === "line" ? parsed4.features[0]!.geometry.points : [];
    expect(hasSeamEdge(ring4, stageSeams([qSW, qSE, qNW, qNE], fourGrid))).toBe(false);
    expect(Math.abs(signedArea(ring4))).toBeCloseTo(120 * 120, 1);
  });

  it("hanterar blandad fukt.dxf (blott/fuktigt som ytor + fuktstrak som linje), berg.dxf (yta + punkter) och belagt.dxf", () => {
    const fuktDoc = dxfDoc(
      poly("blott", [[40, 10], [160, 10], [160, 40], [40, 40]], true)
      + poly("fuktigt", [[30, 5], [170, 5], [170, 45], [30, 45]], true)
      + poly("fuktstrak", [[20, 75], [180, 75]], false)
    );
    const fukt = parseDxf(mergeDxfStages("fukt.dxf", [{ text: fuktDoc, box: west }, { text: fuktDoc, box: east }], twoHoriz));
    expect(fukt.features.filter(f => f.layer === "blott")).toHaveLength(1);
    expect(fukt.features.filter(f => f.layer === "fuktigt")).toHaveLength(1);
    const stream = fukt.features.filter(f => f.layer === "fuktstrak");
    expect(stream).toHaveLength(1);
    expect(stream[0]!.geometry.kind === "line" && !stream[0]!.geometry.closed && [stream[0]!.geometry.points[0], stream[0]!.geometry.points.at(-1)]).toEqual([[20, 75], [180, 75]]);

    const bergDoc = dxfDoc(
      poly("berg_i_dagen_laser", [[50, 20], [150, 20], [150, 50], [50, 50]], true)
      + "0\nPOINT\n8\ndotknoll_laser\n10\n40\n20\n80\n0\nPOINT\n8\ndotknoll_laser\n10\n100\n20\n80\n"
    );
    const berg = parseDxf(mergeDxfStages("berg.dxf", [{ text: bergDoc, box: west }, { text: bergDoc, box: east }], twoHoriz));
    expect(berg.features.filter(f => f.layer === "berg_i_dagen_laser")).toHaveLength(1);
    expect(berg.features.filter(f => f.layer === "dotknoll_laser")).toHaveLength(2);

    const belagtDoc = dxfDoc(poly("belagd_yta_laser", [[60, 20], [140, 20], [140, 70], [60, 70]], true));
    const belagt = parseDxf(mergeDxfStages("belagt.dxf", [{ text: belagtDoc, box: west }, { text: belagtDoc, box: east }], twoHoriz));
    expect(belagt.features).toHaveLength(1);
    expect(belagt.features[0]!.geometry.kind === "line" && Math.abs(signedArea(belagt.features[0]!.geometry.points))).toBeCloseTo(80 * 50, 1);
  });

  it("runMergeJobHelper kopplar ihop skarvfri vatten-, brant-, kurv- och vegetationssammanslagning end-to-end", async () => {
    const dir = await mkdtemp(join(tmpdir(), "otid-merge-seams-"));
    try {
      const lake = { type: "Feature", properties: { layer: "vatten" }, geometry: { type: "Polygon", coordinates: [closeRing([[40, 20], [160, 20], [160, 80], [40, 80]])] } };
      const cliffW = { type: "Feature", geometry: { type: "LineString", coordinates: [[60, 50], [100, 50]] }, properties: { drop3: 3.0, drop6: 4.5, length: 40 } };
      const cliffE = { type: "Feature", geometry: { type: "LineString", coordinates: [[100, 50], [140, 50]] }, properties: { drop3: 3.0, drop6: 4.5, length: 40 } };
      const files: Record<string, Record<string, string>> = {
        s1: {
          "vatten.geojson": geoFile([lake]),
          "brantlinjer.geojson": geoFile([cliffW]),
          "brantlinjer.dxf": dxfDoc(poly("brant_opasserbar", [[60, 50], [100, 50]])),
          "kurvor.dxf": dxfDoc(lwpoly("contour", [[20, 30], [100, 30]], false, 25)),
          "vegetation.dxf": dxfDoc(poly("gront_1", [[50, 10], [150, 10], [150, 40], [50, 40]], true))
        },
        s2: {
          "vatten.geojson": geoFile([lake]),
          "brantlinjer.geojson": geoFile([cliffE]),
          "brantlinjer.dxf": dxfDoc(poly("brant_opasserbar", [[100, 50], [140, 50]])),
          "kurvor.dxf": dxfDoc(lwpoly("contour", [[100, 30], [180, 30]], false, 25)),
          "vegetation.dxf": dxfDoc(poly("gront_1", [[50, 10], [150, 10], [150, 40], [50, 40]], true))
        }
      };
      const uploaded = new Map<string, string>();
      const deps: HelperDeps = {
        workdir: dir, dwgread: "dwgread", workerVersion: 44, outputMaxBytes: 100 * 1024 * 1024,
        webpOutputs: new Set(), rawTickOutputs: new Set(["branter.dxf", "stup.dxf"]),
        call: async (path, init) => {
          const stageMatch = /\/stages\/([^/]+)\/([^/]+)$/.exec(path);
          if (stageMatch) return new Response(files[stageMatch[1]!]?.[stageMatch[2]!] ?? "", { status: 200 });
          const outMatch = /\/outputs\/([^/]+)$/.exec(path);
          if (outMatch && init?.body instanceof Uint8Array) {
            uploaded.set(outMatch[1]!, Buffer.from(init.body).toString("utf8"));
            return new Response(null, { status: 200 });
          }
          return new Response(JSON.stringify({ action: "running" }), { status: 200 });
        },
        run: async () => undefined, toWebp: async () => undefined, sendFailure: async name => name,
        jobMemoryGb: () => 4, keepsRawTicks: () => false,
        createTelemetry: () => ({ sample: () => 100, phase: () => undefined, summary: () => ({}) }),
        isStopped: () => false, createStopped: () => new Error("stopped")
      };
      const outputs = ["vatten.geojson", "brantlinjer.geojson", "brantlinjer.dxf", "kurvor.dxf", "vegetation.dxf"];
      await runMergeJobHelper({
        jobId: "merge-job-1", tiles: [], clip: twoHoriz,
        merge: { stages: [{ jobId: "s1", clip: west, outputs }, { jobId: "s2", clip: east, outputs }] }
      }, deps);

      const waterOut = JSON.parse(uploaded.get("vatten.geojson")!) as { features: unknown[] };
      expect(waterOut.features).toHaveLength(1);
      const cliffOut = JSON.parse(uploaded.get("brantlinjer.geojson")!) as { features: { properties: { length: number } }[] };
      expect(cliffOut.features).toHaveLength(1);
      expect(cliffOut.features[0]!.properties.length).toBe(80);
      expect(parseDxf(uploaded.get("brantlinjer.dxf")!).features).toHaveLength(1);
      expect(parseDxf(uploaded.get("kurvor.dxf")!).features).toHaveLength(1);
      expect(parseDxf(uploaded.get("vegetation.dxf")!).features).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
