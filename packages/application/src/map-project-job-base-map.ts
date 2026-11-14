import { randomUUID } from "node:crypto";
import { MAP_PROJECT_SYNC_MAX_EDITS, MCP_BASE_MAP_MAX_OBJECTS } from "@o-tid/contracts";
import type { Point } from "@o-tid/map-file";
import { newKey, type RevisionEdit, type SourceData } from "@o-tid/map-revision";
import {
  assembleBaseMap, builtPolygons, candidateSymbols, DEFAULT_FLAT_LEVEL, editorBounds, slopeGridOf, worldFileAffine, type BaseMapSummary, type ClearCut, type SoilArea,
  type PhotoPixels
} from "@o-tid/map-revision/base-map";
import type { LoadedProjectMap } from "./map-project-job-run";

/**
 * Ägaren 2026-11-13 («AI:n lägger in grundkartan», apply_base_map): kartjobbet BASE_MAP i utskriftsarbetaren. Laserjobbets
 * filer sätts ihop med OpenStreetMap och hyggena och räknas om till kartans objekt med samma kod som webbläsaren
 * (`assembleBaseMap` i `@o-tid/map-revision/base-map`), och objekten blir ändringar (ADD) i omgångar som var och en ryms i
 * ett förslag. Webben har prövat behörigheten, hämtat OpenStreetMap och hyggena och skickar med filernas innehållsnycklar
 * och etappens polygon. Ren kod utan I/O.
 */
type Polygon = readonly (readonly Point[])[];
/** Ett förslag hålls under synkens gränser: antal ändringar och storlek (som importen i webben). */
const MAX_PART_BYTES = 3 * 1024 * 1024;
/** Resultatet sparas på kartjobbets rad; större än så ska delas i etapper. */
const MAX_RESULT_BYTES = 48 * 1024 * 1024;

export interface BaseMapJobRequest {
  /** Laserjobbet och valen, för att hitta kartjobbet igen (`reusableProjectJob`). */
  readonly hash: string;
  readonly files: readonly { readonly name: string; readonly sha256: string }[];
  readonly knolls?: { readonly level: number; readonly sha256: string } | undefined;
  readonly cliffs?: { readonly level: number; readonly sha256: string } | undefined;
  readonly osm?: SourceData | undefined;
  readonly cuts?: readonly ClearCut[] | undefined;
  /** SGU:s torra mark och vatten (`soilForMarsh`): ingen sankmark på sand och grus. */
  readonly soil?: readonly SoilArea[] | undefined;
  readonly scannedAt: string | null;
  /** Jobbets fuktdjup (bilden och världsfilen), för «Lugna kurvor på flack mark» med förvalet; saknas det lämnas kurvorna. */
  readonly depth?: { readonly image: string; readonly world: string } | undefined;
  /** Jobbets bergbild (bilden och världsfilen): berg i dagen med förvalets nivå i stället för berg.dxf:s. */
  readonly rock?: { readonly image: string; readonly world: string } | undefined;
  readonly stage?: Polygon | undefined;
  /** Det som inte gick att hämta (osm, clear_cuts, soil), för svaret. */
  readonly missing: readonly string[];
}

export type BaseMapJobResult = { problem: string }
  | { summary: BaseMapSummary; missing: readonly string[]; parts: RevisionEdit[][] };

/**
 * Grundkartans objekt som ändringar i omgångar. `texts` är filernas innehåll efter innehållsnyckel och `depth` fuktdjupets
 * bildpunkter och `rock` bergbildens (när jobbet har dem och bilderna gick att läsa).
 */
export function runBaseMap(loaded: LoadedProjectMap, area: Polygon | null, request: BaseMapJobRequest, texts: ReadonlyMap<string, string>, now: Date,
  depth?: PhotoPixels, rock?: PhotoPixels): BaseMapJobResult {
  const georeference = loaded.base.georeference;
  if (!georeference) return { problem: "Kartan saknar georeferens, så grundkartan kan inte läggas in i den." };
  const body = (sha256: string) => texts.get(sha256);
  const parts = request.files.map(file => ({ name: file.name, body: body(file.sha256) }));
  const knolls = request.knolls && { level: request.knolls.level, body: body(request.knolls.sha256) };
  const cliffs = request.cliffs && { level: request.cliffs.level, body: body(request.cliffs.sha256) };
  if (parts.some(part => part.body === undefined) || (knolls && knolls.body === undefined) || (cliffs && cliffs.body === undefined)) {
    return { problem: "En av laserjobbets filer saknar innehåll." };
  }
  const affine = depth && request.depth ? worldFileAffine(texts.get(request.depth.world) ?? "") : undefined;
  const rockAffine = rock && request.rock ? worldFileAffine(texts.get(request.rock.world) ?? "") : undefined;
  const assembled = assembleBaseMap({
    ...(rock && rockAffine ? { rock: { pixels: rock, affine: rockAffine } } : {}),
    flat: depth && affine ? { level: DEFAULT_FLAT_LEVEL, grid: slopeGridOf(depth), affine } : undefined,
    parts: parts as { name: string; body: string }[], osm: request.osm, cuts: request.cuts, soil: request.soil, today: now.toISOString().slice(0, 10), scannedAt: request.scannedAt,
    knolls: knolls as { level: number; body: string } | undefined, cliffs: cliffs as { level: number; body: string } | undefined,
    georeference, symbols: candidateSymbols(loaded.base), bounds: editorBounds(loaded.base, area), area: area ?? undefined, stage: request.stage,
    built: builtPolygons(loaded.objects, symbol => loaded.base.symbols.get(symbol)?.code.main)
  });
  if ("problem" in assembled) return assembled;
  if (assembled.objects.length === 0) return { problem: "Grundkartan gav inga objekt inom kartan (ligger laserjobbet utanför kartans område?)." };
  if (assembled.objects.length > MCP_BASE_MAP_MAX_OBJECTS) {
    return { problem: `Grundkartan ger ${assembled.objects.length} objekt; högst ${MCP_BASE_MAP_MAX_OBJECTS} läggs in per anrop. Dela kartan i etapper och kör laserjobbet och apply_base_map en etapp i taget.` };
  }
  const at = now.toISOString();
  const out: RevisionEdit[][] = [];
  let current: RevisionEdit[] = [], size = 0, total = 0;
  for (const object of assembled.objects) {
    const edit: RevisionEdit = { editId: randomUUID(), key: newKey(randomUUID()), ref: null, base: null, kind: "ADD", state: { kind: "OBJECT", object }, at };
    const bytes = JSON.stringify(edit).length;
    if (current.length && (current.length >= MAP_PROJECT_SYNC_MAX_EDITS || size + bytes > MAX_PART_BYTES)) { out.push(current); current = []; size = 0; }
    current.push(edit); size += bytes; total += bytes;
    if (total > MAX_RESULT_BYTES) return { problem: "Grundkartan är för stor att lägga in i ett anrop. Dela kartan i etapper och kör laserjobbet och apply_base_map en etapp i taget." };
  }
  if (current.length) out.push(current);
  return { summary: assembled.summary, missing: request.missing, parts: out };
}
