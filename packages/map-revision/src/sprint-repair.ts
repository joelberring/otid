import { flattenPath, type MapObject } from "@o-tid/map-file";
import type { SourceFeature } from "./index";
import { privateYardsOnly } from "./base-map/yards";
import { stairLines, stairsFromSteps, type StairSymbol } from "./stairs";

/**
 * «Rätta efter sprintnormen» i en befintlig karta (ägaren 2026-11-23: «måste jag köra om filen eller kan jag läsa in rätt
 * symbolbibliotek med en knapp?»). Två av stegen gäller objekten och räknas här, rent i kartans mm:
 * - `stairObjectsPlan`: trappsteg som redan ligger i kartan som egna linjer (en äldre import) blir trappor med samma
 *   gruppering som importen (`stairsFromSteps`); bara linjerna som blev steg ersätts, allt annat i 532 står kvar.
 * - `apartmentYardKeys`: 520-ytor (tomtmark ur grundkartan) som ett hus större än ett småhus står i eller skär in i, med samma
 *   regel som grundkartan nu har för sprintkartor (`privateYardsOnly`).
 */
export interface KeyedObject { readonly key: string; readonly object: MapObject }

export interface StairPlan {
  /** Steglinjerna som ersätts. */
  readonly remove: readonly string[];
  /** Trapporna som nya linjer (mittlinjen i trappsymbolen). */
  readonly add: readonly MapObject[];
  readonly stairs: number;
}

/** Trapporna ur kartans trappsteg (`lines`, kartans mm) i skalan `scale`; `symbols` är trappvarianterna, `chosen` förvalet. */
export function stairObjectsPlan(lines: readonly KeyedObject[], scale: number, symbols: readonly StairSymbol[], chosen: string): StairPlan {
  const inputs = lines.flatMap(row => row.object.kind === "line" ? flattenPath(row.object.path).map(points => ({ key: row.key, points })) : []);
  const found = stairsFromSteps(inputs.map(row => {
    const first = row.points[0], last = row.points[row.points.length - 1];
    const closed = row.points.length > 3 && !!first && !!last && first.x === last.x && first.y === last.y;
    return { points: row.points, closed, layer: "532" };
  }), scale);
  if (found.stairs.length === 0) return { remove: [], add: [], stairs: 0 };
  const remove = [...new Set(found.used.map(index => inputs[index]!.key))];
  const add = found.stairs.flatMap(stair => stairLines(stair, chosen, symbols)).map(({ symbol, path }): MapObject =>
    ({ kind: "line", symbol, path: path.map((point, index) => ({ type: index === 0 ? "M" as const : "L" as const, x: point.x, y: point.y })) }));
  return { remove, add, stairs: found.stairs.length };
}

/** Kartans yta i meter i terrängen (SWEREF-liknande), för reglerna som räknar i m². */
const toFeature = (object: MapObject, layer: string, metre: number): SourceFeature | undefined => object.kind !== "area" ? undefined
  : { layer, geometry: { kind: "area", rings: object.rings.map(path => flattenPath(path).flat().map(point => [point.x * metre, point.y * metre] as [number, number])) } };

/** Nycklarna till 520-ytorna kring flerbostadshus (hus över 400 m² i ytan eller in i den). */
export function apartmentYardKeys(yards: readonly KeyedObject[], houses: readonly KeyedObject[], scale: number): string[] {
  const metre = scale / 1000;
  const yardFeatures = yards.flatMap((row, index) => { const feature = toFeature(row.object, `tomtmark_${index}`, metre); return feature ? [feature] : []; });
  const houseFeatures = houses.flatMap(row => toFeature(row.object, "byggnad", metre) ?? []);
  const kept = new Set(privateYardsOnly(yardFeatures, houseFeatures).map(feature => feature.layer));
  return yards.filter((row, index) => row.object.kind === "area" && !kept.has(`tomtmark_${index}`)).map(row => row.key);
}
