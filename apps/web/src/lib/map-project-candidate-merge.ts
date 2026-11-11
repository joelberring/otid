import { projectedToWgs84, wgs84ToProjected } from "@o-tid/map-file";
import type { SourceData, SourceFeature, SourceGeometry } from "@o-tid/map-revision";

/**
 * Ägaren 2026-11-11 («när jag hämtar hyggen försvann allt annat»): en panel med reglage (hyggen, fukt, grönt) byter bara sina
 * egna lager i de kandidater som redan visas (t.ex. grundkartan), i stället för att ersätta allt. Lagren som matchar `own` tas
 * bort ur det som visas och de nya läggs till, omräknade till det visade koordinatsystemet om de skiljer sig.
 */
export function mergeCandidates(current: SourceData, next: SourceData, own: RegExp): SourceData {
  const from = next.crs, to = current.crs;
  const move = from && to && from !== to ? ([x, y]: readonly [number, number]): [number, number] => {
    const position = projectedToWgs84({ kind: "EPSG", code: from }, x, y);
    const point = wgs84ToProjected({ kind: "EPSG", code: to }, position.latitude, position.longitude);
    return [point.easting, point.northing];
  } : undefined;
  const moved = (geometry: SourceGeometry): SourceGeometry => !move ? geometry
    : geometry.kind === "point" ? { kind: "point", at: move(geometry.at) }
    : geometry.kind === "line" ? { ...geometry, points: geometry.points.map(move) } : { kind: "area", rings: geometry.rings.map(ring => ring.map(move)) };
  const added: SourceFeature[] = next.features.map(feature => ({ ...feature, geometry: moved(feature.geometry) }));
  return { ...current, features: [...current.features.filter(feature => !own.test(feature.layer)), ...added] };
}
