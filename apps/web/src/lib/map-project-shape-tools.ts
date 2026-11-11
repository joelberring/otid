import { flattenPath, offsetPolyline, type MapObject, type Path, type Point } from "@o-tid/map-file";

/**
 * Ritlägets formverktyg efter jämförelsen med Mapper, OCAD och Illustrator (ägaren 2026-11-10): mät det markerade, fyll en
 * sluten linje till en yta eller gör en kant av en yta, och en parallell linje. Kartans mm; `scale` ger meter i terrängen.
 */
const toPath = (points: readonly Point[]): Path => points.map((at, index) => ({ type: index === 0 ? "M" as const : "L" as const, x: at.x, y: at.y }));
const ringArea = (points: readonly Point[]) => Math.abs(points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]!; return sum + a.x * b.y - b.x * a.y; }, 0)) / 2;
const length = (points: readonly Point[]) => points.reduce((sum, point, i) => i === 0 ? 0 : sum + Math.hypot(point.x - points[i - 1]!.x, point.y - points[i - 1]!.y), 0);

/** Längden (linje) eller ytan utan hål (yta) i terrängen. */
export function measureObject(object: MapObject, scale: number): { meters: number } | { squareMeters: number } | undefined {
  const factor = scale / 1000;
  if (object.kind === "line") return { meters: flattenPath(object.path).reduce((sum, part) => sum + length(part), 0) * factor };
  if (object.kind !== "area") return undefined;
  const [outer, ...holes] = object.rings.map(ring => flattenPath(ring).flat());
  if (!outer) return undefined;
  return { squareMeters: Math.max(0, ringArea(outer) - holes.reduce((sum, hole) => sum + ringArea(hole), 0)) * factor * factor };
}

/** En sluten linje blir en yta med ytsymbolen; en yta ger kantlinjer med linjesymbolen (en per ring). Annars inget. */
export function fillOrBorder(object: MapObject, symbol: { readonly id: string; readonly kind: string }): MapObject[] | undefined {
  if (object.kind === "line" && symbol.kind === "area") {
    const points = flattenPath(object.path)[0] ?? [];
    const closed = points.length > 3 && Math.hypot(points[0]!.x - points.at(-1)!.x, points[0]!.y - points.at(-1)!.y) < 0.05;
    return closed ? [{ kind: "area", symbol: symbol.id, rings: [object.path], angle: 0 }] : undefined;
  }
  if (object.kind === "area" && symbol.kind === "line") return object.rings.map(ring => ({ kind: "line", symbol: symbol.id, path: ring }));
  return undefined;
}

/** En linje parallellt med den markerade, `offsetMm` till höger (negativt: vänster); kurvor blir korta raka sträckor. */
export function parallelLine(object: MapObject, offsetMm: number): MapObject | undefined {
  if (object.kind !== "line") return undefined;
  const parts = flattenPath(object.path).map(part => offsetPolyline(part, offsetMm)).filter(part => part.length >= 2);
  return parts.length ? { ...object, path: parts.flatMap(part => toPath(part)) } : undefined;
}
