import type { MapGeoreference, MapObject, ParsedMap, Point } from "@o-tid/map-file";
import { importLayers, mapNorm, parseDxf, parseGeoJson, symbolObjectKind, VectorParseError, type MapBox, type SourceData } from "../index";
import { mergeCandidates } from "./candidate-merge";
import { computeCandidates, suggestedMapping, type CandidateSymbol } from "./candidates";
import { clearCutFeatures, type ClearCut } from "./clear-cuts";
import { calmFlatContours, flatLimitsAt, flatSlopeFrom, type PixelAffine, type SlopeGrid } from "./flat-contours";
import { cliffFeatures, cliffLimitsAt, defaultCliffLimits, readCliffCandidates } from "./cliff-choice";
import { chooseKnolls, knollFeatures, knollLimitsAt, readKnollCandidates } from "./knoll-choice";
import { mergeBaseMap } from "./merge";

/**
 * Ägaren 2026-11-13 («AI:n lägger in grundkartan»): hela vägen från laserjobbets filer till objekten som läggs i kartan, i
 * samma steg och med samma förval som när en människa trycker «Hämta grundkartan» och «Lägg in N objekt i kartan» i
 * webben: filerna tolkas, sätts ihop med OpenStreetMap och hyggena (`mergeBaseMap`), lagren får symbolerna som importen
 * föreslår ur namnen, och kandidaterna räknas ut (`computeCandidates`: kartans mm, klippta mot kartan och etappen, utanför
 * det bebyggda, generaliserade efter normen). Ren kod utan I/O.
 *
 * Skillnader mot webben: sparade lagerprofiler används inte (bara förslagen ur lagernamnen), och inget lager väljs bort.
 * Kurvorna på flack mark lugnas med samma förval som i webben när jobbets fuktdjup följer med (`flat`).
 */
type Ring = readonly Point[];

/** Områdets omslutande rektangel med en tiondel marginal (kartvyn för en ny tom karta). */
export function areaBounds(area: readonly Ring[]): MapBox {
  const points = area.flat();
  const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y)), maxY = Math.max(...points.map(point => point.y));
  const margin = Math.max(maxX - minX, maxY - minY) * 0.1;
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}

/** Rutan som kandidaterna klipps mot, som i editorn: grundfilens utbredning, eller området när grundfilen är tom. */
export function editorBounds(base: Pick<ParsedMap, "bounds" | "objects">, area: readonly Ring[] | null | undefined): MapBox {
  return base.objects.length === 0 && area?.[0]?.length ? areaBounds(area) : base.bounds ?? { minX: -100, minY: -100, maxX: 100, maxY: 100 };
}

/** Kartans symboler som importen ser dem: de som inte är gömda, i palettens ordning (efter numret). */
export function candidateSymbols(map: Pick<ParsedMap, "symbols">): CandidateSymbol[] {
  return [...map.symbols.values()].filter(symbol => !symbol.hidden)
    .map(symbol => [symbol.id, symbol.code.text, symbolObjectKind(map, symbol), symbol.name] as const)
    .sort((a, b) => a[1].localeCompare(b[1], "sv", { numeric: true }));
}

export interface BaseMapAssemblyInput {
  /** Jobbets filer i `baseMapOutputs` ordning, som text. */
  readonly parts: readonly { readonly name: string; readonly body: string }[];
  /** OpenStreetMap för jobbets ruta (longitud, latitud); utelämnat = gick inte att hämta. */
  readonly osm?: SourceData | undefined;
  /** Skogsstyrelsens hyggen för rutan; utelämnat = gick inte att hämta. */
  readonly cuts?: readonly ClearCut[] | undefined;
  /** Dagens datum (ÅÅÅÅ-MM-DD) och laserskanningens, för hyggenas ålder. */
  readonly today: string;
  readonly scannedAt: string | null;
  /** Mängden små kullar och branter på skalan 1–10 med jobbets `kullar.geojson` och `brantlinjer.geojson` (reglagen i webben). */
  readonly knolls?: { readonly level: number; readonly body: string } | undefined;
  readonly cliffs?: { readonly level: number; readonly body: string } | undefined;
  /**
   * «Lugna kurvor på flack mark» (ägaren 2026-11-13): nivån 0–10 med lutningen ur jobbets fuktdjup (`slopeGridOf`) och var
   * rutnätet ligger (`worldFileAffine`, SWEREF 99 TM). Utelämnat = jobbet har inget fuktdjup, och kurvorna lämnas som de är.
   */
  readonly flat?: { readonly level: number; readonly grid: SlopeGrid; readonly affine: PixelAffine } | undefined;
  readonly georeference: MapGeoreference;
  readonly symbols: readonly CandidateSymbol[];
  readonly bounds: MapBox;
  /** Kartans område och etappens gräns (kartans mm). */
  readonly area?: readonly Ring[] | undefined;
  readonly stage?: readonly Ring[] | undefined;
  /** Kartans bebyggda ytor (`builtPolygons`). */
  readonly built: readonly [number, number][][][];
}

export interface BaseMapSummary {
  /** Lagren i grundkartan: antal objekt i underlaget och symbolen de fick (null = inget förslag, lagret hoppades över). */
  readonly layers: { readonly layer: string; readonly features: number; readonly symbol: string | null }[];
  /** Objekten som läggs in, per symbolnummer. */
  readonly symbols: { readonly symbol: string; readonly objects: number }[];
  readonly objects: number;
  readonly skipped: {
    /** Lager utan symbolförslag och hur många objekt de hade. */
    readonly unmappedLayers: number; readonly unmappedFeatures: number;
    /** Det som filernas tolkning hoppade över (okända slag av objekt). */
    readonly unreadable: number;
    readonly outside: number; readonly duplicates: number; readonly short: number; readonly mismatched: number;
    /** Borttaget i det bebyggda och av normens generalisering. */
    readonly inBuilt: number; readonly belowNorm: number;
  };
  readonly clipped: number; readonly joined: number; readonly simplified: number;
  /** Hyggena efter ålder (när de gick att hämta). */
  readonly clearCuts?: { readonly fresh: number; readonly scrub: number; readonly young: number } | undefined;
  /** Valen bland kullar och branter (när en nivå angavs): så många valdes bland jobbets sparade. */
  readonly knolls?: { readonly level: number; readonly chosen: number; readonly candidates: number } | undefined;
  readonly cliffs?: { readonly level: number; readonly impassable: number; readonly passable: number; readonly candidates: number } | undefined;
  /** Hjälpkurvor (meter) och små ringar som togs bort på flack mark (när jobbet har fuktdjupet). */
  readonly flatContours?: { readonly level: number; readonly formlineMeters: number; readonly rings: number } | undefined;
}

const SWEREF99TM = 3006;

/** Grundkartans objekt i kartans mm och en sammanfattning, eller varför det inte gick. */
export function assembleBaseMap(input: BaseMapAssemblyInput): { objects: MapObject[]; summary: BaseMapSummary } | { problem: string } {
  const scale = input.georeference.scale;
  let read: { name: string; data: SourceData }[];
  let knollJson: unknown, cliffJson: unknown;
  try {
    read = input.parts.map(part => ({ name: part.name, data: part.name.endsWith(".geojson") ? parseGeoJson(part.body) : parseDxf(part.body) }));
    knollJson = input.knolls ? JSON.parse(input.knolls.body) : undefined;
    cliffJson = input.cliffs ? JSON.parse(input.cliffs.body) : undefined;
  } catch (error) {
    return { problem: error instanceof VectorParseError ? error.message : "En av laserjobbets filer gick inte att läsa." };
  }
  const cuts = input.cuts ? clearCutFeatures(input.cuts, input.today, input.scannedAt) : undefined;
  // Sprintkartor (ägaren 2026-11-13) får sprintnormens symboler och OpenStreetMaps vägar som belagda ytor.
  const symbols = input.symbols.map(([id, code, kind, name]) => ({ id, code, kind, name }));
  const norm = mapNorm({ scale, symbols });
  let data = mergeBaseMap(read, input.osm, scale, cuts && { features: cuts.features, afterScan: cuts.afterScan }, norm);
  read = [];
  // Hjälpkurvor och små ringar på flack mark tas bort, som när grundkartan läses in i webben.
  let flatContours: BaseMapSummary["flatContours"];
  if (input.flat) {
    const calmed = calmFlatContours(data.features, flatSlopeFrom(input.flat.grid, input.flat.affine), flatLimitsAt(input.flat.level));
    data = { ...data, features: calmed.features };
    flatContours = { level: input.flat.level, formlineMeters: calmed.formlineMeters, rings: calmed.rings };
  }
  // Reglagen för punkthöjder och branter: bara de egna lagren byts, som i panelerna (ett val utan något objekt ändrar inget).
  let knolls: BaseMapSummary["knolls"], cliffs: BaseMapSummary["cliffs"];
  if (input.knolls) {
    const candidates = readKnollCandidates(knollJson), points = chooseKnolls(candidates, knollLimitsAt(input.knolls.level));
    if (points.length > 0) data = mergeCandidates(data, { features: knollFeatures(points), skipped: 0, crs: SWEREF99TM }, /^dotknoll_laser$/);
    knolls = { level: input.knolls.level, chosen: points.length, candidates: candidates.length };
  }
  if (input.cliffs) {
    const candidates = readCliffCandidates(cliffJson);
    const chosen = cliffFeatures(candidates, cliffLimitsAt(input.cliffs.level, defaultCliffLimits(scale), scale));
    if (chosen.features.length > 0) data = mergeCandidates(data, { features: chosen.features, skipped: 0, crs: SWEREF99TM }, /^brant_/);
    cliffs = { level: input.cliffs.level, impassable: chosen.impassable, passable: chosen.passable, candidates: candidates.length };
  }
  const layers = importLayers(data);
  const mapping = suggestedMapping(layers, symbols, norm);
  const result = computeCandidates(data.features, { georeference: input.georeference, crs: data.crs ?? SWEREF99TM, mapping: [...mapping], skipped: [],
    symbols: input.symbols, bounds: input.bounds, clip: undefined, area: input.area, stage: input.stage, fit: undefined, normed: true,
    built: input.built, maskBuilt: true });
  if (!result) return { problem: "Grundkartans objekt gick inte att räkna om till kartan." };
  const codes = new Map(input.symbols.map(([id, code]) => [id, code.replace(/\.0$/, "")]));
  const counts = new Map<string, number>();
  for (const object of result.objects) { const code = codes.get(object.symbol) ?? object.symbol; counts.set(code, (counts.get(code) ?? 0) + 1); }
  const unmapped = layers.filter(layer => !mapping.has(layer.name));
  return { objects: result.objects, summary: {
    layers: layers.map(layer => ({ layer: layer.name, features: layer.count, symbol: codes.get(mapping.get(layer.name) ?? "") ?? null })),
    symbols: [...counts].map(([symbol, objects]) => ({ symbol, objects })).sort((a, b) => a.symbol.localeCompare(b.symbol, "sv", { numeric: true })),
    objects: result.objects.length,
    skipped: { unmappedLayers: unmapped.length, unmappedFeatures: unmapped.reduce((sum, layer) => sum + layer.count, 0), unreadable: data.skipped,
      outside: result.outside, duplicates: result.duplicates, short: result.short, mismatched: result.mismatched,
      inBuilt: result.builtMask?.removed ?? 0, belowNorm: result.generalized?.removed ?? 0 },
    clipped: result.clipped, joined: result.joined, simplified: result.generalized?.simplified ?? 0,
    ...(cuts ? { clearCuts: cuts.counts } : {}), ...(knolls ? { knolls } : {}), ...(cliffs ? { cliffs } : {}),
    ...(flatContours ? { flatContours } : {})
  } };
}
