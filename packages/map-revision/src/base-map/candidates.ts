import type { MapGeoreference, MapObject } from "@o-tid/map-file";
import {
  applyFit, clipObjectsToPolygon, codeParts, generalizeCandidates, stairWidthOfName, importObjects, sourcePointToMap, suggestSymbol,
  type ImportLayer, type ImportResult, type MapBox, type MapNorm, type SourceFeature, type TargetKind, type VectorFit
} from "../index";
import { buildingOutlines } from "../building-outlines";
import { isPathCode, isPavedEdgeCode, pathsInRoadsPlan, smallEdgeRingKeys, waterInBuiltPlan, type CleanPlan, type CodedObject, type Shapes } from "../sprint-clean";
import { maskBuilt } from "./built-mask";

/**
 * Kandidaterna ur en inläsning (en vektorfil eller grundkartan): lagren får symboler, objekten räknas om till kartans mm,
 * klipps mot kartan och etappen, hålls utanför det bebyggda och generaliseras efter normen. Samma uträkning i webbläsarens
 * Worker (`map-project-candidates.ts` i webben) och på servern (AI-kopplingens `apply_base_map`).
 */

/** Symbolen som uträkningen behöver: id, nummer och form (katalogens ikoner följer inte med till Workern). */
export type CandidateSymbol = readonly [id: string, code: string, kind: MapObject["kind"], name?: string | undefined];
type Ring = readonly { readonly x: number; readonly y: number }[];

/** Allt utom filens objekt som avgör kandidaterna (det som förr låg i `useMemo` i importen). */
export interface CandidateInput {
  readonly georeference: MapGeoreference;
  readonly crs: number;
  /** Lager → symbolens id, i samma ordning som i importen. */
  readonly mapping: readonly (readonly [string, string])[];
  readonly skipped: readonly string[];
  readonly symbols: readonly CandidateSymbol[];
  readonly bounds: MapBox | undefined;
  /** Etappens ruta (K4c); då klipper inte kartans område. */
  readonly clip: MapBox | undefined;
  /** Kartans område (polygonen i mm). */
  readonly area: readonly Ring[] | undefined;
  /** Etappens gräns för ett laserjobb för en etapp. */
  readonly stage: readonly Ring[] | undefined;
  readonly fit: VectorFit | undefined;
  readonly normed: boolean;
  /** Kartans bebyggda ytor och om kandidaterna ska hållas utanför dem. */
  readonly built: readonly [number, number][][][];
  /** Åker och fruktodling (412, 413): inget berg i dagen eller öppen mark där (ägaren 2026-11-18). */
  readonly fields?: readonly [number, number][][][] | undefined;
  readonly maskBuilt: boolean;
  /**
   * Ägaren 2026-11-23: kantsymbolen (t.ex. 521.1) när kartans byggnad (521) är en yta utan egen kant; då får de inlästa husen
   * kantlinjer runt sammanhängande hus (`buildingOutlines`). Utelämnat = ingen kant läggs till.
   */
  readonly buildingEdge?: string | undefined;
  /**
   * Ägaren 2026-11-23 (sprintkartor, förval på): inga kärr, diken eller fuktstråk ur lasern och marktäcket inom `builtMetres` från
   * bebyggt, inga stigar i vägar och inga små kantringar (`sprint-clean.ts`). `built` och `roads` är kartans egna (t.ex. en
   * huvudkälla som redan lästs in), i kartans mm; kandidaternas egna hus, hårdgjorda ytor, kanter och tomter räknas också.
   */
  readonly sprintClean?: { readonly builtMetres: number; readonly built?: Shapes | undefined; readonly roads?: Shapes | undefined } | undefined;
}

/** Vad sprintreglerna tog bort: sankmark och vattendrag, stigar och små kantringar (objekt borttagna eller klippta). */
export interface SprintCleanOutcome { readonly water: number; readonly paths: number; readonly rings: number }

/**
 * Lagren med sankmark och vattendrag som räknats fram (lasern, marktäcket, NMD); OpenStreetMaps och huvudkällans vatten och
 * laserns sjöar står kvar. Också allt annat som får sankmarkens nummer (307–310).
 */
const DERIVED_WATER = /^(blott|fuktigt|fuktstrak.*|dike|sankmark_(vat|fast|oppen_nmd|misstankt_ooverkomlig))$/;
const isMarshCode = (code: string | undefined) => { const main = code ? codeParts(code).main : 0; return main >= 307 && main <= 310; };

/** Objekten efter en plan: borttagna utelämnas, klippta ersätts av sina delar. */
function applyPlan(rows: readonly CodedObject[], plan: CleanPlan): MapObject[] {
  const removed = new Set(plan.remove), replaced = new Map(plan.replace.map(entry => [entry.key, entry.objects]));
  return rows.flatMap(row => removed.has(row.key) ? [] : replaced.get(row.key) ?? [row.object]);
}

export type CandidateResult = ImportResult & {
  readonly generalized: { readonly removed: number; readonly simplified: number } | undefined;
  readonly builtMask: { readonly removed: number; readonly clipped: number } | undefined;
  /** Kantlinjer som lades till runt husen (`CandidateInput.buildingEdge`). */
  readonly outlines?: number | undefined;
  readonly sprintClean?: SprintCleanOutcome | undefined;
};

/** Kantlinjerna runt de inlästa husen (521) i kantsymbolen. */
function withBuildingEdges(objects: readonly MapObject[], edge: string | undefined, codeOf: (symbol: string) => string | undefined): { objects: MapObject[]; outlines: number } {
  if (!edge) return { objects: [...objects], outlines: 0 };
  const houses = objects.flatMap((object, index) => object.kind === "area" && codeParts(codeOf(object.symbol) ?? "").main === 521 ? [{ key: String(index), object }] : []);
  const plan = buildingOutlines(houses, [], edge);
  return { objects: [...objects, ...plan.add], outlines: plan.add.length };
}

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
    // Trappan (532, i ISSOM 529.2 «Trappa») byggs av baskartornas steglinjer; varianternas bredd ur namnet («Stairway, 1.6 m»).
    const stairSymbols = input.symbols.filter(([, code, kind, name]) => kind === "line"
      && (codeParts(code).main === 532 || (!!name && /trapp|stair/i.test(name) && !/kontur|kant|edge/i.test(name))))
      .map(([id, , , name]) => ({ id, widthMm: stairWidthOfName(name) }));
    const toMap = (x: number, y: number) => {
      const at = sourcePointToMap(georeference, crs, x, y);
      return fit ? applyFit(fit, at) : at;
    };
    const options = { mapping: targets, toMap, bounds: clip ?? input.bounds,
      stairs: { symbols: stairSymbols, scale: georeference.scale },
      // Kartans område (polygonen) klipper också, utom när en etapp valts (den har sin ruta).
      polygon: clip ? undefined : input.area };
    const clean = input.sprintClean;
    const codeOf = (symbol: string) => symbols.get(symbol)?.code;
    const coded = (objects: readonly MapObject[]): CodedObject[] => objects.map((object, index) => ({ key: String(index), code: codeOf(object.symbol) ?? "", object }));
    // Sprintkartor: de framräknade kärren och vattendragen läses in för sig och prövas mot allt annat bebyggt.
    const derived = clean ? features.filter(feature => DERIVED_WATER.test(feature.layer) || isMarshCode(codeOf(targets.get(feature.layer)?.symbol ?? ""))) : [];
    const wetSet = new Set(derived), rest = derived.length ? features.filter(feature => !wetSet.has(feature)) : features;
    let whole = importObjects(rest, options);
    let water = 0;
    if (clean && derived.length) {
      const wet = importObjects(derived, options), wetRows = coded(wet.objects);
      const plan = waterInBuiltPlan(wetRows, coded(whole.objects), georeference.scale, clean.builtMetres, clean.built);
      water = plan.remove.length + plan.replace.length;
      whole = { ...whole, objects: [...whole.objects, ...applyPlan(wetRows, plan)], outside: whole.outside + wet.outside, short: whole.short + wet.short,
        clipped: whole.clipped + wet.clipped, duplicates: whole.duplicates + wet.duplicates, mismatched: whole.mismatched + wet.mismatched };
    }
    const imported = stage?.[0] && stage[0].length >= 3 ? { ...whole, objects: clipObjectsToPolygon(whole.objects, stage).objects } : whole;
    // Ägaren 2026-11-12: inget av markens detaljer eller vegetationen i det som redan är ritat som tomtmark, asfalt eller hus.
    const fields = input.fields ?? [];
    const masked = input.maskBuilt && (input.built.length || fields.length) ? maskBuilt(imported.objects, input.built, symbol => { const code = symbols.get(symbol)?.code; return code ? Number(code.split(".")[0]) : undefined; }, fields) : undefined;
    const kept = masked?.objects ?? imported.objects, builtMask = masked && masked.removed + masked.clipped > 0 ? { removed: masked.removed, clipped: masked.clipped } : undefined;
    // Stigar i vägar och små kantringar efter generaliseringen (den kan foga ihop stigar och kanter).
    const tidy = (objects: readonly MapObject[]): { objects: MapObject[]; sprintClean?: SprintCleanOutcome } => {
      if (!clean) return { objects: [...objects] };
      const rows = coded(objects);
      const paths = pathsInRoadsPlan(rows.filter(row => isPathCode(row.code)), rows, georeference.scale, clean.roads);
      const rings = smallEdgeRingKeys(rows.filter(row => isPavedEdgeCode(row.code)));
      const plan = { remove: [...paths.remove, ...rings], replace: paths.replace };
      return { objects: applyPlan(rows, plan), sprintClean: { water, paths: paths.remove.length + paths.replace.length, rings: rings.length } };
    };
    if (!input.normed) {
      const tidied = tidy(kept), edged = withBuildingEdges(tidied.objects, input.buildingEdge, codeOf);
      return { ...imported, objects: edged.objects, generalized: undefined, builtMask, outlines: edged.outlines, sprintClean: tidied.sprintClean };
    }
    // Ägaren 2026-11-11: kandidaterna generaliseras efter normen innan de läggs in (går att slå av i kandidatraden).
    const general = generalizeCandidates(kept, codeOf, georeference.scale);
    // Kanten runt husen efter generaliseringen, så att den följer husens slutliga form.
    const tidied = tidy(general.objects);
    const edged = withBuildingEdges(tidied.objects, input.buildingEdge, codeOf);
    return { ...imported, objects: edged.objects, generalized: { removed: general.removed, simplified: general.simplified }, builtMask, outlines: edged.outlines,
      sprintClean: tidied.sprintClean };
  } catch { return undefined; }
}

/**
 * Förslagen på symbol för lagren ur deras namn (lager → symbolens id), som importen väljer innan någon ändrat något.
 * `symbols` är kartans symboler i palettens ordning; `norm` (`mapNorm`) ger sprintreglerna på en sprintkarta.
 */
export function suggestedMapping(layers: readonly ImportLayer[], symbols: readonly { readonly id: string; readonly code: string; readonly kind: string;
  readonly name?: string | undefined }[], norm: MapNorm = "ISOM"): Map<string, string> {
  return new Map(layers.flatMap(layer => { const id = suggestSymbol(layer, symbols, norm); return id ? [[layer.name, id] as const] : []; }));
}
