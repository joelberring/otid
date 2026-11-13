import { parseDxf, parseGeoJson, VectorParseError, type SourceData, type SourceFeature } from "@o-tid/map-revision";
import { computeCandidates, mergeBaseMap, type CandidateInput, type CandidateResult, type clearCutFeatures } from "@o-tid/map-revision/base-map";

/**
 * Ägaren 2026-11-12 («nu vet man inte om datorn hängt sig … varningar om att sidan inte svarar vid stora jobb»): det tunga när
 * kandidater läses in – grundkartans filer tolkas och sätts ihop (`mergeBaseMap`) och kandidaterna räknas ut (`computeCandidates`:
 * `importObjects`, masken för bebyggt och normens generalisering) – görs i en egen Worker (`map-project-candidates-worker.ts`)
 * i stället för på sidans tråd. Uträkningarna finns i `@o-tid/map-revision/base-map` (delade med servern); här finns
 * meddelandena, och Workern och sidan (`map-project-candidates-client.ts`) är skal.
 */
export type { CandidateInput, CandidateResult };

/** En resultatfil som text (DXF eller GeoJSON efter namnet). */
export interface BaseMapPart { readonly name: string; readonly body: string }
type Cuts = Pick<ReturnType<typeof clearCutFeatures>, "features" | "afterScan">;

/** Var inläsningen är: filerna tolkas en och en, sedan sätts grundkartan ihop. */
export type BaseMapStep = { readonly step: "read"; readonly done: number; readonly total: number } | { readonly step: "merge" };

export type CandidateRequest =
  /** Filerna tolkas; med `merge` sätts de ihop till grundkartan (med OpenStreetMap och hyggena), annars blir den första filen svaret. */
  | { readonly type: "base-map"; readonly id: number; readonly dataId: number; readonly parts: readonly BaseMapPart[]; readonly merge: boolean;
      readonly osm?: SourceData | undefined; readonly scale?: number | undefined; readonly cuts?: Cuts | undefined }
  /** Objekten för en fil som inte kom från Workern; sparas under `dataId`. */
  | { readonly type: "data"; readonly dataId: number; readonly features: readonly SourceFeature[] }
  | { readonly type: "forget"; readonly dataId: number }
  | { readonly type: "compute"; readonly id: number; readonly dataId: number; readonly input: CandidateInput };

export type CandidateResponse =
  | ({ readonly type: "progress"; readonly id: number } & BaseMapStep)
  | { readonly type: "base-map"; readonly id: number; readonly dataId: number; readonly data: SourceData }
  | { readonly type: "computed"; readonly id: number; readonly result: CandidateResult | null }
  /** `parse`: filen gick inte att tolka (meddelandet visas som det är). */
  | { readonly type: "error"; readonly id: number; readonly message: string; readonly parse: boolean };

/** Workerns minne: filernas objekt efter `dataId` (sidan säger till när de kan glömmas). */
export type CandidateStore = Map<number, readonly SourceFeature[]>;

/** Ett meddelande till Workern; svaren går till `post`. */
export function handleCandidateRequest(store: CandidateStore, request: CandidateRequest, post: (response: CandidateResponse) => void) {
  if (request.type === "data") { store.set(request.dataId, request.features); return; }
  if (request.type === "forget") { store.delete(request.dataId); return; }
  if (request.type === "compute") {
    const features = store.get(request.dataId);
    post({ type: "computed", id: request.id, result: features ? computeCandidates(features, request.input) ?? null : null });
    return;
  }
  const { id, parts } = request;
  try {
    const read: { name: string; data: SourceData }[] = [];
    for (const part of parts) {
      post({ type: "progress", id, step: "read", done: read.length + 1, total: parts.length });
      read.push({ name: part.name, data: part.name.endsWith(".geojson") ? parseGeoJson(part.body) : parseDxf(part.body) });
    }
    if (request.merge) post({ type: "progress", id, step: "merge" });
    const data: SourceData = request.merge ? mergeBaseMap(read, request.osm, request.scale, request.cuts) : { ...read[0]!.data };
    store.set(request.dataId, data.features);
    post({ type: "base-map", id, dataId: request.dataId, data });
  } catch (error) {
    post({ type: "error", id, parse: error instanceof VectorParseError, message: error instanceof Error ? error.message : String(error) });
  }
}
