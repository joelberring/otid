import type { RaceMapSourceMetadata } from "@o-tid/contracts";
import { pixelToMm, type MapGeoreference, type ParsedMap, type RenderSize } from "@o-tid/map-file";

/**
 * Steg 59: det som webbläsaren skickar med kartfilen (utan canvas, så att det går att testa). Tre punkter (pixel → WGS 84)
 * räknas ur kartfilens georeferens i bildens hörn, så att den befintliga georeferensen i `race_map` används
 * (`deriveRasterGeoreference`). Utan georeferens, med okänt koordinatsystem eller när omräkningen misslyckas: null, och
 * arrangören sätter tre punkter som för en vanlig kartbild.
 */
export type ToWgs84 = (georeference: MapGeoreference, point: { x: number; y: number }) =>
  { latitude: number; longitude: number } | null | undefined;

type TiePoints = NonNullable<RaceMapSourceMetadata["tiePoints"]>;

export function cornerTiePoints(georeference: MapGeoreference | null, size: RenderSize, toWgs84: ToWgs84): TiePoints | null {
  if (!georeference || georeference.crs.kind !== "EPSG") return null;
  const pixels = [{ x: 0, y: 0 }, { x: size.width - 1, y: 0 }, { x: 0, y: size.height - 1 }];
  if (size.width < 2 || size.height < 2) return null;
  const points = [];
  for (const pixel of pixels) {
    let geo;
    try { geo = toWgs84(georeference, pixelToMm(size, pixel)); } catch { return null; }
    if (!geo || !Number.isFinite(geo.latitude) || !Number.isFinite(geo.longitude) || Math.abs(geo.latitude) > 90 || Math.abs(geo.longitude) > 180) {
      return null;
    }
    // Sju decimaler (ungefär 1 cm) räcker och blir läsbart i georeferensens fält.
    const round = (value: number) => Math.round(value * 1e7) / 1e7;
    points.push({ pixelX: pixel.x, pixelY: pixel.y, latitude: round(geo.latitude), longitude: round(geo.longitude) });
  }
  return points as unknown as TiePoints;
}

const clampText = (text: string, max: number) => text.trim().slice(0, max) || "–";

/** Metadata för uppladdningen; undefined när kartan saknar objekt eller skala. */
export function mapFileMetadata(map: ParsedMap, size: RenderSize, simplifications: readonly string[], toWgs84: ToWgs84)
  : RaceMapSourceMetadata | undefined {
  if (!map.bounds || !(map.scale >= 100 && map.scale <= 1_000_000)) return undefined;
  const reduced = size.reduced ? [`Kartan är stor och ritas med ${String(size.pxPerMm).replace(".", ",")} px per mm`] : [];
  const georeference = map.georeference && validGeoreference(map.georeference) ? map.georeference : null;
  return {
    formatVersion: 1, format: map.format, version: clampText(map.version, 80), scale: Math.round(map.scale),
    bounds: { ...map.bounds },
    georeference: georeference ? { scale: georeference.scale, crs: georeference.crs.kind === "EPSG" ? { kind: "EPSG", code: georeference.crs.code }
      : { kind: "UNKNOWN", description: georeference.crs.description.slice(0, 400) },
      refPoint: { ...georeference.refPoint }, mapRefPoint: { ...georeference.mapRefPoint }, grivationDegrees: georeference.grivationDegrees,
      combinedScaleFactor: georeference.combinedScaleFactor } : null,
    render: { pxPerMm: size.pxPerMm, originX: size.origin.x, originY: size.origin.y },
    summary: { objectCount: map.objects.length,
      warnings: map.warnings.slice(0, 200).map(warning => ({ code: clampText(warning.code, 80), count: Math.max(0, Math.round(warning.count)),
        text: clampText(warning.text, 300) })),
      simplifications: [...reduced, ...simplifications].slice(0, 50).map(text => clampText(text, 300)) },
    tiePoints: cornerTiePoints(georeference, size, toWgs84)
  };
}

function validGeoreference(georeference: MapGeoreference): boolean {
  const values = [georeference.scale, georeference.refPoint.easting, georeference.refPoint.northing, georeference.mapRefPoint.x,
    georeference.mapRefPoint.y, georeference.grivationDegrees, georeference.combinedScaleFactor];
  return values.every(Number.isFinite) && georeference.scale >= 100 && georeference.combinedScaleFactor >= 0.5 && georeference.combinedScaleFactor <= 2;
}
