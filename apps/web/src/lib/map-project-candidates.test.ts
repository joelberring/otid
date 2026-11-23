import { describe, expect, it } from "vitest";
import type { MapGeoreference } from "@o-tid/map-file";
import { generalizeCandidates, importObjects, parseGeoJson, sourcePointToMap, type SourceFeature } from "@o-tid/map-revision";
import { handleCandidateRequest, type CandidateInput, type CandidateRequest, type CandidateResponse, type CandidateStore } from "./map-project-candidates";
import { CandidateSession } from "./map-project-candidates-client";
import { computeCandidates, mergeBaseMap } from "@o-tid/map-revision/base-map";

const georeference: MapGeoreference = { scale: 10000, crs: { kind: "EPSG", code: 3006 }, refPoint: { easting: 675000, northing: 6580000 },
  mapRefPoint: { x: 0, y: 0 }, grivationDegrees: 0, combinedScaleFactor: 1 };
const at = (x: number, y: number): [number, number] => [675000 + x, 6580000 + y];
const features: SourceFeature[] = [
  { layer: "stenar", geometry: { kind: "point", at: at(10, 10) } },
  { layer: "stenar", geometry: { kind: "point", at: at(200, 200) } },
  { layer: "kurvor", geometry: { kind: "line", closed: false, points: [at(0, 0), at(50, 5), at(100, 0), at(150, 8)] } },
  { layer: "kurvor", geometry: { kind: "line", closed: false, points: [at(0, 100), at(100, 120)] } },
  { layer: "kärr", geometry: { kind: "area", rings: [[at(0, 0), at(80, 0), at(80, 80), at(0, 80)]] } },
  { layer: "okänt", geometry: { kind: "point", at: at(5, 5) } }
];
const input = (more: Partial<CandidateInput> = {}): CandidateInput => ({ georeference, crs: 3006,
  mapping: [["stenar", "s"], ["kurvor", "k"], ["kärr", "m"]], skipped: [],
  symbols: [["s", "206.0", "point"], ["k", "101.0", "line"], ["m", "308.0", "area"], ["h", "520.0", "area"]],
  bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 }, clip: undefined, area: undefined, stage: undefined, fit: undefined,
  normed: false, built: [], maskBuilt: true, ...more });

describe("kandidaterna i Workern", () => {
  it("ger samma kandidater, i samma ordning, som importens uträkning gjorde på sidan", () => {
    const toMap = (x: number, y: number) => sourcePointToMap(georeference, 3006, x, y);
    const mapping = new Map([["stenar", { symbol: "s", kind: "point" as const }], ["kurvor", { symbol: "k", kind: "line" as const }],
      ["kärr", { symbol: "m", kind: "area" as const }]]);
    const expected = importObjects(features, { mapping, toMap, bounds: input().bounds, stairs: { symbols: [], scale: 10000 } });
    const result = computeCandidates(features, input());
    expect(result?.objects).toEqual(expected.objects);
    expect(result?.objects.length).toBeGreaterThan(0);
    expect(result?.generalized).toBeUndefined();
    expect(result?.builtMask).toBeUndefined();
    const general = generalizeCandidates(expected.objects, symbol => ({ s: "206.0", k: "101.0", m: "308.0" } as Record<string, string>)[symbol], 10000);
    expect(computeCandidates(features, input({ normed: true }))?.objects).toEqual(general.objects);
  });

  it("hoppar över valda bort lager och håller stenar och kärr utanför bebyggt", () => {
    expect(computeCandidates(features, input({ skipped: ["stenar", "kärr"] }))?.objects.map(object => object.symbol)).toEqual(["k", "k"]);
    // En tomt som täcker allt: stenen och kärret försvinner, kurvorna är kvar.
    const built: [number, number][][][] = [[[[-200, -200], [200, -200], [200, 200], [-200, 200], [-200, -200]]]];
    const masked = computeCandidates(features, input({ built }));
    expect(masked?.objects.map(object => object.symbol)).toEqual(["k", "k"]);
    expect(masked?.builtMask).toEqual({ removed: 3, clipped: 0 });
    expect(computeCandidates(features, input({ built, maskBuilt: false }))?.builtMask).toBeUndefined();
  });

  it("tolkar filerna med förlopp och sätter ihop grundkartan som `mergeBaseMap`", () => {
    const water = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { layer: "vatten" },
      geometry: { type: "Polygon", coordinates: [[at(0, 0), at(10, 0), at(10, 10), at(0, 0)]] } }] });
    const store: CandidateStore = new Map(), sent: CandidateResponse[] = [];
    handleCandidateRequest(store, { type: "base-map", id: 1, dataId: 2, merge: true, scale: 10000,
      parts: [{ name: "vatten.geojson", body: water }, { name: "marktacke.geojson", body: water }] }, response => sent.push(response));
    expect(sent.map(response => response.type === "progress" ? (response.step === "read" ? `read ${response.done}/${response.total}` : "merge") : response.type))
      .toEqual(["read 1/2", "read 2/2", "merge", "base-map"]);
    const done = sent.at(-1) as Extract<CandidateResponse, { type: "base-map" }>;
    const parsed = parseGeoJson(water);
    expect(done.data).toEqual(mergeBaseMap([{ name: "vatten.geojson", data: parsed }, { name: "marktacke.geojson", data: parsed }], undefined, 10000));
    expect(store.get(2)).toBe(done.data.features);
  });

  it("lugnar kurvorna på flack mark när lutningen följer med, och svarar med det borttagna", () => {
    const dxf = (layer: string, points: [number, number][]) => ["0", "SECTION", "2", "ENTITIES", "0", "LWPOLYLINE", "8", layer, "70", "0",
      ...points.flatMap(([x, y]) => ["10", String(x), "20", String(y)]), "0", "ENDSEC", "0", "EOF", ""].join("\n");
    const parts = [{ name: "kurvor.dxf", body: dxf("contour", [[0, 50], [300, 60]]) }, { name: "formlinjer.dxf", body: dxf("formline", [[0, 20], [300, 20]]) }];
    // 200 × 100 celler om 2 m med nedre vänstra hörnet i origo: 5° i västra halvan, 0,2° i östra.
    const columns = 200, rows = 100, steps = Uint8Array.from({ length: columns * rows }, (_, p) => p % columns < 100 ? 50 : 2);
    const calm = { grid: { columns, rows, steps }, affine: [2, 0, 1, 0, -2, 199] as const, level: 3 };
    const run = (request: Partial<Extract<CandidateRequest, { type: "base-map" }>>) => {
      const sent: CandidateResponse[] = [];
      handleCandidateRequest(new Map(), { type: "base-map", id: 1, dataId: 2, merge: true, scale: 10000, parts, ...request }, response => sent.push(response));
      return sent.at(-1) as Extract<CandidateResponse, { type: "base-map" }>;
    };
    const plain = run({}), calmed = run({ calm });
    expect(plain.calm).toBeUndefined();
    expect(calmed.calm).toMatchObject({ level: 3, rings: 0 });
    expect(calmed.calm!.formlineMeters).toBeGreaterThan(70);
    expect(calmed.calm!.removed.map(feature => feature.layer)).toEqual(["formline"]);
    // Resten av hjälpkurvan är samma objekt i svaret som i `added` (reglaget känner igen dem), och kurvan är orörd.
    expect(calmed.calm!.added).toHaveLength(1);
    expect(calmed.data.features).toContain(calmed.calm!.added[0]);
    expect(calmed.data.features.filter(feature => feature.layer === "contour")).toEqual(plain.data.features.filter(feature => feature.layer === "contour"));
    expect(calmed.data.features).toHaveLength(plain.data.features.length);
    // Utan sammansättning (en enskild fil) lugnas ingenting.
    expect(run({ merge: false, calm }).calm).toBeUndefined();
  });

  it("lägger «Tydligare kurvbild» ovanpå när markens höjd följer med, och svarar med det utbytta", () => {
    const dxf = (layer: string, points: [number, number][]) => ["0", "SECTION", "2", "ENTITIES", "0", "LWPOLYLINE", "8", layer, "70", "0",
      ...points.flatMap(([x, y]) => ["10", String(x), "20", String(y)]), "0", "ENDSEC", "0", "EOF", ""].join("\n");
    const parts = [{ name: "kurvor.dxf", body: dxf("contour", [[0, 150], [300, 150]]) }, { name: "formlinjer.dxf", body: dxf("formline", [[0, 100], [300, 100]]) }];
    // 300 × 300 celler om 1 m: marken stiger 0,3 m per meter norrut, med en sänka (−3 m) öster om x = 150.
    const size = 300, meters = Float32Array.from({ length: size * size }, (_, p) => (size - 1 - Math.floor(p / size)) * 0.3 - (p % size >= 150 ? 3 : 0));
    const clear = { parts: [{ grid: { columns: size, rows: size, meters }, affine: [1, 0, 0.5, 0, -1, 299.5] as const }], settings: { smooth: 0, formlines: 5, rings: 0 } };
    const run = (request: Partial<Extract<CandidateRequest, { type: "base-map" }>>) => {
      const sent: CandidateResponse[] = [];
      handleCandidateRequest(new Map(), { type: "base-map", id: 1, dataId: 2, merge: true, scale: 10000, parts, ...request }, response => sent.push(response));
      return sent.at(-1) as Extract<CandidateResponse, { type: "base-map" }>;
    };
    const plain = run({}), cleared = run({ clear });
    expect(plain.clear).toBeUndefined();
    expect(cleared.clear!.settings).toEqual(clear.settings);
    // Hjälpkurvan klipps kring kanten ner i sänkan, där marken ligger under omgivningen.
    expect(cleared.clear!.formlineMeters).toBeGreaterThan(20);
    expect(cleared.clear!.removed.map(feature => feature.layer)).toEqual(["formline"]);
    for (const piece of cleared.clear!.added) expect(cleared.data.features).toContain(piece);
    expect(cleared.clear!.suggested).toBeUndefined();
    // Utan angivna nivåer väljs förvalen efter terrängen (här brant: de vanliga förvalen), och svaret säger vilka.
    const auto = run({ clear: { parts: clear.parts } });
    expect(auto.clear!.settings).toEqual({ smooth: 5, formlines: 4, rings: 5 });
    expect(auto.clear!.suggested).toEqual(auto.clear!.settings);
    expect(run({ merge: false, clear }).clear).toBeUndefined();
  });

  it("negativ kurvbild: söker sänkorna ur markens höjd och sätter lutningsstreck efter höjden (ägaren 2026-11-15)", () => {
    const dxf = (layer: string, points: [number, number][], closed = false) => ["0", "SECTION", "2", "ENTITIES", "0", "LWPOLYLINE", "8", layer, "70", closed ? "1" : "0",
      ...points.flatMap(([x, y]) => ["10", String(x), "20", String(y)]), "0", "ENDSEC", "0", "EOF", ""].join("\n");
    // 300 × 300 celler om 1 m: en svag sluttning med en liten grop (0,8 m) vid (80, 200) och en stor sänka (1,6 m) vid (200, 100).
    const size = 300, holes = [[80, 99, 5, 0.8], [200, 199, 16, 1.6]] as const;
    const meters = Float32Array.from({ length: size * size }, (_, p) => {
      const column = p % size, row = Math.floor(p / size);
      return 50 + column * 0.01 - holes.reduce((sum, [c, r, radius, depth]) => { const d = Math.hypot(column - c, row - r); return sum + (d < radius ? depth * (1 - (d / radius) ** 2) : 0); }, 0);
    });
    const clear = { parts: [{ grid: { columns: size, rows: size, meters }, affine: [1, 0, 0.5, 0, -1, 299.5] as const }], settings: { smooth: 0, formlines: 0, rings: 0 } };
    const ring = Array.from({ length: 24 }, (_, i) => [200.5 + 11 * Math.cos(i * Math.PI / 12), 100.5 + 11 * Math.sin(i * Math.PI / 12)] as [number, number]);
    const run = (parts: { name: string; body: string }[], more: Partial<Extract<CandidateRequest, { type: "base-map" }>> = {}) => {
      const sent: CandidateResponse[] = [];
      handleCandidateRequest(new Map(), { type: "base-map", id: 1, dataId: 2, merge: true, scale: 10000, parts, clear, ...more }, response => sent.push(response));
      return sent.at(-1) as Extract<CandidateResponse, { type: "base-map" }>;
    };
    const contour = { name: "kurvor.dxf", body: dxf("contour", [[0, 20], [300, 20]]) };
    const layersOf = (response: ReturnType<typeof run>) => response.data.features.map(feature => feature.layer).sort();
    const found = run([contour]);
    expect(found.pits).toMatchObject({ level: 5, points: 1, rings: 1, scale: 10000 });
    expect(found.pits!.candidates).toHaveLength(2);
    expect(layersOf(found)).toEqual(["contour", "formline_grop", "lutningsstreck_grop", "udepression_laser"]);
    // En sluten hjälpkurva ur lasern runt den stora sänkan visar den redan: ingen egen ring, men ett lutningsstreck efter höjden.
    const shown = run([contour, { name: "formlinjer.dxf", body: dxf("formline", ring, true) }]);
    expect(shown.pits).toMatchObject({ points: 1, rings: 0, ticks: 1, byHeight: 1 });
    expect(layersOf(shown)).toEqual(["contour", "formline", "lutningsstreck", "udepression_laser"]);
    // Utan markens höjd, eller utan att grundkartan sätts ihop, söks ingenting.
    expect(run([contour], { clear: undefined }).pits).toBeUndefined();
    expect(run([contour], { merge: false }).pits).toBeUndefined();
  });

  it("små höjder som ring: en höjd mellan nivåerna får en ring på halva höjden och punkthöjden i den tas bort (ägaren 2026-11-15)", () => {
    const entity = (rows: string[]) => ["0", "SECTION", "2", "ENTITIES", ...rows, "0", "ENDSEC", "0", "EOF", ""].join("\n");
    // 300 × 300 celler om 1 m: en svag sluttning med en 2 m hög kulle (radie 12 m) vid (150, 150) och en knöl (0,7 m) vid (60, 60).
    const size = 300, bumps = [[150, 149, 12, 2], [60, 239, 5, 0.7]] as const;
    const meters = Float32Array.from({ length: size * size }, (_, p) => {
      const column = p % size, row = Math.floor(p / size);
      return 51 + column * 0.005 + bumps.reduce((sum, [c, r, radius, rise]) => { const d = Math.hypot(column - c, row - r); return sum + (d < radius ? rise * (1 - (d / radius) ** 2) : 0); }, 0);
    });
    const clear = { parts: [{ grid: { columns: size, rows: size, meters }, affine: [1, 0, 0.5, 0, -1, 299.5] as const }], settings: { smooth: 0, formlines: 0, rings: 0 } };
    const parts = [{ name: "kurvor.dxf", body: entity(["0", "LWPOLYLINE", "8", "contour", "70", "0", "10", "0", "20", "20", "10", "300", "20", "20"]) },
      { name: "knollar.dxf", body: entity(["0", "POINT", "8", "dotknoll", "10", "151", "20", "151", "0", "POINT", "8", "dotknoll", "10", "60.5", "20", "60.5"]) }];
    const sent: CandidateResponse[] = [];
    handleCandidateRequest(new Map(), { type: "base-map", id: 1, dataId: 2, merge: true, scale: 10000, parts, clear }, response => sent.push(response));
    const found = sent.at(-1) as Extract<CandidateResponse, { type: "base-map" }>;
    expect(found.hills).toMatchObject({ level: 5, rings: 1, contours: 0, scale: 10000 });
    expect(found.hills!.hidden.map(feature => feature.layer)).toEqual(["dotknoll"]);
    // Kullens topp ligger på 53,7 m: nivån 55 är för långt över, så ringen är en hjälpkurva. Knölens punkthöjd står kvar.
    expect(found.data.features.map(feature => feature.layer).sort()).toEqual(["contour", "dotknoll", "formline_hojd"]);
    const kept = found.data.features.find(feature => feature.layer === "dotknoll")!.geometry as { readonly at: readonly [number, number] };
    expect(kept.at[0]).toBeCloseTo(60.5, 1);
  });

  it("säger till när en fil inte går att tolka, och ger inget för objekt som glömts", () => {
    const store: CandidateStore = new Map(), sent: CandidateResponse[] = [];
    handleCandidateRequest(store, { type: "base-map", id: 1, dataId: 2, merge: false, parts: [{ name: "kurvor.dxf", body: "inte\nDXF\nalls" }] }, response => sent.push(response));
    expect(sent.at(-1)).toMatchObject({ type: "error", id: 1, parse: true });
    handleCandidateRequest(store, { type: "data", dataId: 3, features }, () => undefined);
    handleCandidateRequest(store, { type: "forget", dataId: 3 }, () => undefined);
    handleCandidateRequest(store, { type: "compute", id: 4, dataId: 3, input: input() }, response => sent.push(response));
    expect(sent.at(-1)).toEqual({ type: "computed", id: 4, result: null });
  });
});

/** En Worker i samma tråd: meddelandena hanteras efter en kort paus, som i webbläsaren. */
function fakeWorker() {
  const store: CandidateStore = new Map(), requests: CandidateRequest[] = [];
  const worker = { onmessage: null as ((event: MessageEvent<CandidateResponse>) => void) | null, onerror: null as unknown,
    terminate: () => undefined,
    postMessage(request: CandidateRequest) {
      requests.push(request);
      setTimeout(() => handleCandidateRequest(store, request, response => worker.onmessage?.({ data: response } as MessageEvent<CandidateResponse>)), 0);
    } };
  return { worker: worker as unknown as Worker, requests, store };
}

describe("kandidaternas Worker från sidan", () => {
  it("skickar en fils objekt en gång och använder bara den senaste uträkningen", async () => {
    const fake = fakeWorker(), session = new CandidateSession(() => fake.worker);
    const results: (number | undefined)[] = [];
    session.compute(features, input(), result => results.push(result?.objects.length));
    session.compute(features, input({ skipped: ["stenar"] }), result => results.push(result?.objects.length));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(fake.requests.filter(request => request.type === "data")).toHaveLength(1);
    expect(results).toEqual([computeCandidates(features, input({ skipped: ["stenar"] }))!.objects.length]);
  });

  it("läser grundkartan med stegen och räknar sedan utan att skicka objekten igen", async () => {
    const fake = fakeWorker(), session = new CandidateSession(() => fake.worker);
    const body = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { layer: "stenar" }, geometry: { type: "Point", coordinates: at(10, 10) } }] });
    const steps: string[] = [];
    const { data } = await session.baseMap({ parts: [{ name: "vatten.geojson", body }], merge: false }, step => steps.push(step.step));
    expect(steps).toEqual(["read"]);
    const result = await new Promise(resolve => session.compute(data.features, input({ mapping: [["stenar", "s"]] }), resolve));
    expect(fake.requests.filter(request => request.type === "data")).toHaveLength(0);
    expect(result).toBeTruthy();
  });

  it("läser en körning i etapper som en grundkarta: varje etapp klipps till sin ruta (ägaren 2026-11-13, Ornö södra)", async () => {
    const session = new CandidateSession(() => fakeWorker().worker);
    // Samma sten ligger i båda etappernas marginal; den ska komma med en gång, från etappen den ligger i.
    const stones = (points: [number, number][]) => JSON.stringify({ type: "FeatureCollection",
      features: points.map(coordinates => ({ type: "Feature", properties: { layer: "stenar" }, geometry: { type: "Point", coordinates } })) });
    const { data } = await session.baseMap({ parts: [], merge: false, stages: [
      { box: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, parts: [{ name: "stenar.geojson", body: stones([[10, 10], [120, 10]]) }] },
      { box: { minX: 100, minY: 0, maxX: 200, maxY: 100 }, parts: [{ name: "stenar.geojson", body: stones([[120, 10], [150, 10], [10, 10]]) }] }
    ] }, () => undefined);
    expect(data.features.map(feature => feature.geometry.kind === "point" ? feature.geometry.at[0] : undefined)).toEqual([10, 120, 150]);
  });

  it("ger `VectorParseError` för en fil som inte går att tolka", async () => {
    const session = new CandidateSession(() => fakeWorker().worker);
    await expect(session.baseMap({ parts: [{ name: "kurvor.dxf", body: "x\ny" }], merge: false }, () => undefined)).rejects.toThrow(/DXF/);
  });
});
