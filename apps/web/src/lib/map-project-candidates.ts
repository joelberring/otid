import type { MapGeoreference, MapObject } from "@o-tid/map-file";
import {
  applyFit, clipObjectsToPolygon, generalizeCandidates, importObjects, parseDxf, parseGeoJson, sourcePointToMap, VectorParseError,
  type ImportResult, type SourceData, type SourceFeature, type TargetKind, type VectorFit
} from "@o-tid/map-revision";
import type { Bounds } from "./course-setting-viewport";
import { maskBuilt } from "./map-project-built-mask";
import { mergeBaseMap } from "./map-project-base-map";
import type { clearCutFeatures } from "./map-project-clear-cuts";

/**
 * Ägaren 2026-11-12 («nu vet man inte om datorn hängt sig … varningar om att sidan inte svarar vid stora jobb»): det tunga när
 * kandidater läses in – grundkartans filer tolkas och sätts ihop (`mergeBaseMap`) och kandidaterna räknas ut (`importObjects`,
 * masken för bebyggt och normens generalisering) – görs i en egen Worker (`map-project-candidates-worker.ts`) i stället för
 * på sidans tråd. Här finns uträkningarna och meddelandena; Workern och sidan (`map-project-candidates-client.ts`) är skal.
 */

/** Symbolen som uträkningen behöver: id, nummer och form (katalogens ikoner följer inte med till Workern). */
export type CandidateSymbol = readonly [id: string, code: string, kind: MapObject["kind"]];
type Ring = readonly { readonly x: number; readonly y: number }[];

/** Allt utom filens objekt som avgör kandidaterna (det som förr låg i `useMemo` i importen). */
export interface CandidateInput {
  readonly georeference: MapGeoreference;
  readonly crs: number;
  /** Lager → symbolens id, i samma ordning som i importen. */
  readonly mapping: readonly (readonly [string, string])[];
  readonly skipped: readonly string[];
  readonly symbols: readonly CandidateSymbol[];
  readonly bounds: Bounds | undefined;
  /** Etappens ruta (K4c); då klipper inte kartans område. */
  readonly clip: Bounds | undefined;
  /** Kartans område (polygonen i mm). */
  readonly area: readonly Ring[] | undefined;
  /** Etappens gräns för ett laserjobb för en etapp. */
  readonly stage: readonly Ring[] | undefined;
  readonly fit: VectorFit | undefined;
  readonly normed: boolean;
  /** Kartans bebyggda ytor och om kandidaterna ska hållas utanför dem. */
  readonly built: readonly [number, number][][][];
  readonly maskBuilt: boolean;
}

export type CandidateResult = ImportResult & {
  readonly generalized: { readonly removed: number; readonly simplified: number } | undefined;
  readonly builtMask: { readonly removed: number; readonly clipped: number } | undefined;
};

/** Kandidaterna ur filens objekt; `undefined` om uträkningen inte gick (som förr). */
export function computeCandidates(features: readonly SourceFeature[], input: CandidateInput): CandidateResult | undefined {
  const symbols = new Map(input.symbols.map(([id, code, kind]) => [id, { code, kind }] as const));
  const skipped = new Set(input.skipped);
  const targets = new Map<string, { symbol: string; kind: TargetKind }>();
  for (const [layer, id] of input.mapping) {
    if (skipped.has(layer)) continue;
    const kind = symbols.get(id)?.kind;
    if (kind === "point" || kind === "line" || kind === "area") targets.set(layer, { symbol: id, kind });
  }
  const { georeference, crs, fit, clip, stage } = input;
  try {
    // Trappan (532) byggs av baskartornas steglinjer.
    const stairSymbols = new Set(input.symbols.filter(([, code]) => code.replace(/\.0+$/, "") === "532").map(([id]) => id));
    const toMap = (x: number, y: number) => {
      const at = sourcePointToMap(georeference, crs, x, y);
      return fit ? applyFit(fit, at) : at;
    };
    const whole = importObjects(features, { mapping: targets, toMap, bounds: clip ?? input.bounds, stairSymbols,
      // Kartans område (polygonen) klipper också, utom när en etapp valts (den har sin ruta).
      polygon: clip ? undefined : input.area });
    const imported = stage?.[0] && stage[0].length >= 3 ? { ...whole, objects: clipObjectsToPolygon(whole.objects, stage).objects } : whole;
    // Ägaren 2026-11-12: inget av markens detaljer eller vegetationen i det som redan är ritat som tomtmark, asfalt eller hus.
    const masked = input.maskBuilt && input.built.length ? maskBuilt(imported.objects, input.built, symbol => { const code = symbols.get(symbol)?.code; return code ? Number(code.split(".")[0]) : undefined; }) : undefined;
    const kept = masked?.objects ?? imported.objects, builtMask = masked && masked.removed + masked.clipped > 0 ? { removed: masked.removed, clipped: masked.clipped } : undefined;
    if (!input.normed) return { ...imported, objects: kept, generalized: undefined, builtMask };
    // Ägaren 2026-11-11: kandidaterna generaliseras efter normen innan de läggs in (går att slå av i kandidatraden).
    const general = generalizeCandidates(kept, symbol => symbols.get(symbol)?.code, georeference.scale);
    return { ...imported, objects: general.objects, generalized: { removed: general.removed, simplified: general.simplified }, builtMask };
  } catch { return undefined; }
}

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
