import type { MapObject, PathCommand } from "@o-tid/map-file";
import { samplePath } from "@o-tid/map-revision";
import polygonClipping, { type Polygon } from "polygon-clipping";

type Area = Extract<MapObject, { kind: "area" }>;
const isArea = (object: MapObject): object is Area => object.kind === "area";

export interface UnionResult {
  /** Den hopslagna ytan (den första ytans symbol och övriga egenskaper). */
  readonly object: MapObject;
  /** Vilka av de givna objekten som gick in i den (index); det första behålls. */
  readonly used: readonly number[];
}

/** En ring som punkter (bågar som korta sträckor, 0,1 mm), sluten. */
function ringPoints(ring: readonly PathCommand[]): [number, number][] {
  const points = samplePath(ring, 0.1).map(point => [point.x, point.y] as [number, number]);
  if (points.length && (points[0]![0] !== points[points.length - 1]![0] || points[0]![1] !== points[points.length - 1]![1])) points.push([...points[0]!]);
  return points;
}

/**
 * Ägaren 2026-11-11 («man vill kunna slå ihop ytor genom att högerklicka, verkar fungera med linjer»): de markerade ytorna
 * med samma symbol som överlappar eller rör vid varandra blir en yta (unionen, med eventuella hål). Ytor som inte hänger ihop
 * med de andra lämnas. Inget resultat när färre än två ytor går ihop.
 */
export function unionAreas(objects: readonly MapObject[]): UnionResult | undefined {
  const areas = objects.map((object, index) => ({ object, index })).filter((row): row is { object: Area; index: number } => isArea(row.object));
  for (const first of areas) {
    const same = areas.filter(row => row.object.symbol === first.object.symbol);
    if (same.length < 2) continue;
    const polygons = same.map(row => row.object.rings.map(ringPoints).filter(ring => ring.length >= 4) as Polygon);
    // Lägg till ytorna en i taget så länge resultatet är en enda yta.
    let current: Polygon = polygons[0]!;
    const used = [first.index];
    let progress = true;
    const left = same.slice(1).map((row, i) => ({ row, polygon: polygons[i + 1]! }));
    while (progress) {
      progress = false;
      for (const candidate of [...left]) {
        let merged;
        try { merged = polygonClipping.union(current, candidate.polygon); } catch { continue; }
        if (merged.length !== 1) continue;
        current = merged[0]!; used.push(candidate.row.index); left.splice(left.indexOf(candidate), 1); progress = true;
      }
    }
    if (used.length < 2) continue;
    const rings: PathCommand[][] = current.map(ring => ring.map(([x, y], i) => ({ type: i === 0 ? "M" as const : "L" as const, x, y })));
    return { object: { ...first.object, rings }, used };
  }
  return undefined;
}
