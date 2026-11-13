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
    const expected = importObjects(features, { mapping, toMap, bounds: input().bounds, stairSymbols: new Set() });
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

  it("ger `VectorParseError` för en fil som inte går att tolka", async () => {
    const session = new CandidateSession(() => fakeWorker().worker);
    await expect(session.baseMap({ parts: [{ name: "kurvor.dxf", body: "x\ny" }], merge: false }, () => undefined)).rejects.toThrow(/DXF/);
  });
});
