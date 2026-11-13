import { parseDxf, parseGeoJson, VectorParseError, type MapNorm, type SourceData, type SourceFeature } from "@o-tid/map-revision";
import {
  calmFlatContours, computeCandidates, DEFAULT_ROCK_LEVEL, flatLimitsAt, flatSlopeFrom, joinStages, mergeBaseMap, rockAreasOfJob, withRockAreas,
  type CandidateInput, type CandidateResult, type clearCutFeatures, type FlatContourResult, type PhotoPixels, type PixelAffine, type SlopeGrid, type StageBox
} from "@o-tid/map-revision/base-map";

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
/**
 * Berg i dagen ur körningens bergbild (ägaren 2026-11-13): bildpunkterna (RGBA, `berg.png`), var rutnätet ligger (SWEREF 99 TM)
 * och nivån 1–10. Regeln ersätter laserns berg i dagen i berg.dxf med förvalet; reglaget «Berg i dagen med reglage» ändrar det sedan.
 */
export interface BaseMapRock { readonly pixels: PhotoPixels; readonly affine: PixelAffine; readonly level: number }
/** Berg i dagen ur bergbilden: nivån, antal ytor och hektar. */
export interface RockOutcome { readonly level: number; readonly areas: number; readonly hectares: number }
/** En etapps filer, dess klippruta i SWEREF 99 TM och (för «Lugna kurvor på flack mark») dess lutning och (för berg i dagen) dess bergbild. */
export interface BaseMapStage { readonly box: StageBox; readonly parts: readonly BaseMapPart[]; readonly slope?: Omit<BaseMapCalm, "level"> | undefined;
  readonly rock?: Omit<BaseMapRock, "level"> | undefined }
type Cuts = Pick<ReturnType<typeof clearCutFeatures>, "features" | "afterScan">;

/**
 * «Lugna kurvor på flack mark» (ägaren 2026-11-13) när grundkartan sätts ihop: lutningen ur laserkörningens fuktdjup, var
 * rutnätet ligger (SWEREF 99 TM) och nivån 0–10.
 */
export interface BaseMapCalm { readonly grid: SlopeGrid; readonly affine: PixelAffine; readonly level: number }
/** Det som lugnandet tog bort och satte dit (samma objekt som i svarets `data`), för reglaget efteråt. */
export type CalmOutcome = Pick<FlatContourResult, "removed" | "added" | "formlineMeters" | "rings"> & { readonly level: number };

/** Var inläsningen är: filerna tolkas en och en, sedan sätts grundkartan ihop. */
export type BaseMapStep = { readonly step: "read"; readonly done: number; readonly total: number } | { readonly step: "merge" };

export type CandidateRequest =
  /** Filerna tolkas; med `merge` sätts de ihop till grundkartan (med OpenStreetMap och hyggena), annars blir den första filen svaret. */
  | { readonly type: "base-map"; readonly id: number; readonly dataId: number; readonly parts: readonly BaseMapPart[]; readonly merge: boolean;
      /** En körning i etapper (ägaren 2026-11-13): varje etapps filer klipps till etappens ruta och läses ihop; `parts` är då tom. */
      readonly stages?: readonly BaseMapStage[] | undefined;
      readonly osm?: SourceData | undefined; readonly scale?: number | undefined; readonly cuts?: Cuts | undefined;
      /** Kartans norm (`mapNorm`): på en sprintkarta blir OpenStreetMaps belagda vägar ytor. */
      readonly norm?: MapNorm | undefined; readonly calm?: BaseMapCalm | undefined;
      /** Berg i dagen ur bergbilden i stället för berg.dxf:s (utan etapper; med etapper ligger den i varje etapp). */
      readonly rock?: BaseMapRock | undefined }
  /** Objekten för en fil som inte kom från Workern; sparas under `dataId`. */
  | { readonly type: "data"; readonly dataId: number; readonly features: readonly SourceFeature[] }
  | { readonly type: "forget"; readonly dataId: number }
  | { readonly type: "compute"; readonly id: number; readonly dataId: number; readonly input: CandidateInput };

export type CandidateResponse =
  | ({ readonly type: "progress"; readonly id: number } & BaseMapStep)
  | { readonly type: "base-map"; readonly id: number; readonly dataId: number; readonly data: SourceData; readonly calm?: CalmOutcome | undefined;
      readonly rock?: RockOutcome | undefined }
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
  const { id } = request;
  try {
    const stages: readonly { box: StageBox | undefined; parts: readonly BaseMapPart[]; rock?: BaseMapStage["rock"] }[] = request.stages ?? [{ box: undefined, parts: request.parts }];
    const total = stages.reduce((sum, stage) => sum + stage.parts.length, 0);
    let done = 0;
    const rock = { level: request.rock?.level ?? DEFAULT_ROCK_LEVEL, areas: 0, hectares: 0 };
    let rockUsed = false;
    const parsed = stages.map(stage => {
      const read = stage.parts.map(part => {
        post({ type: "progress", id, step: "read", done: ++done, total });
        return { name: part.name, data: part.name.endsWith(".geojson") ? parseGeoJson(part.body) : parseDxf(part.body) };
      });
      // Berg i dagen ur bergbilden i stället för berg.dxf:s (bara när grundkartan sätts ihop).
      const own = !request.merge ? undefined : request.stages ? stage.rock && { ...stage.rock, level: DEFAULT_ROCK_LEVEL } : request.rock;
      if (!own) return { box: stage.box, parts: read };
      const found = rockAreasOfJob(own.pixels, own.affine, own.level);
      rock.areas += found.areas; rock.hectares = Math.round((rock.hectares + found.hectares) * 100) / 100; rockUsed = true;
      return { box: stage.box, parts: withRockAreas(read, found.data) };
    });
    const read = request.stages ? joinStages(parsed.map(stage => ({ box: stage.box!, parts: stage.parts }))) : parsed[0]!.parts;
    if (request.merge) post({ type: "progress", id, step: "merge" });
    const merged: SourceData = request.merge ? mergeBaseMap(read, request.osm, request.scale, request.cuts, request.norm) : { ...read[0]!.data };
    // Hjälpkurvor och små ringar på flack mark tas bort direkt (förvalet), när körningen har fuktdjupet med lutningen.
    const calm = request.merge && request.calm ? request.calm : undefined;
    // Med etapper: varje etapps lutning där den har en, annars den gemensamma.
    const slopes = (request.stages ?? []).flatMap(stage => stage.slope ? [flatSlopeFrom(stage.slope.grid, stage.slope.affine)] : []);
    const slopeAt = calm && (slopes.length > 0
      ? (x: number, y: number) => { for (const at of slopes) { const value = at(x, y); if (value !== undefined) return value; } return undefined; }
      : flatSlopeFrom(calm.grid, calm.affine));
    const calmed = calm && slopeAt && calmFlatContours(merged.features, slopeAt, flatLimitsAt(calm.level));
    const data = calmed ? { ...merged, features: calmed.features } : merged;
    store.set(request.dataId, data.features);
    post({ type: "base-map", id, dataId: request.dataId, data, ...(rockUsed ? { rock } : {}),
      ...(calm && calmed ? { calm: { removed: calmed.removed, added: calmed.added, formlineMeters: calmed.formlineMeters, rings: calmed.rings, level: calm.level } } : {}) });
  } catch (error) {
    post({ type: "error", id, parse: error instanceof VectorParseError, message: error instanceof Error ? error.message : String(error) });
  }
}
