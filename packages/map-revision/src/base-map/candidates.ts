import type { MapGeoreference, MapObject } from "@o-tid/map-file";
import {
  applyFit, clipObjectsToPolygon, generalizeCandidates, importObjects, sourcePointToMap, suggestSymbol,
  type ImportLayer, type ImportResult, type MapBox, type MapNorm, type SourceFeature, type TargetKind, type VectorFit
} from "../index";
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

/**
 * Förslagen på symbol för lagren ur deras namn (lager → symbolens id), som importen väljer innan någon ändrat något.
 * `symbols` är kartans symboler i palettens ordning; `norm` (`mapNorm`) ger sprintreglerna på en sprintkarta.
 */
export function suggestedMapping(layers: readonly ImportLayer[], symbols: readonly { readonly id: string; readonly code: string; readonly kind: string;
  readonly name?: string | undefined }[], norm: MapNorm = "ISOM"): Map<string, string> {
  return new Map(layers.flatMap(layer => { const id = suggestSymbol(layer, symbols, norm); return id ? [[layer.name, id] as const] : []; }));
}
