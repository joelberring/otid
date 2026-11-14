import type { CourseSettingNote, CourseSettingSketchShape } from "@o-tid/contracts";
import type { CourseSettingDocument } from "@o-tid/course-setting";
import { mapPointToProjected, type MapGeoreference, type Point } from "@o-tid/map-file";
import { distanceToSketch, sketchBounds } from "./course-setting-sketch";
import { inLanguage } from "./in-language";

/**
 * ADR-0181 beslut 8: kartfelen till kartritaren. Kartritaren är inte alltid arrangör och kan tävla själv, så exporten får
 * inte avslöja banorna (banhemligheten, ADR-0176): bara kartan, kartfelets ritning eller punkt, texten och valda foton.
 * Inga ringar, sträckor, nummer, bannamn, kontrollkoder, vem som skrev eller när. Ett kartfel sitter alltid på en punkt
 * eller en ritning (servern tillåter inget annat), och utsnittet förskjuts slumpvis så att kartfelet inte står i mitten.
 * Ett kartfel nära en kontroll varnas för (och är inte med som förval), eftersom läget självt kan avslöja den.
 *
 * Allt räknas i webbläsaren; inget skickas till andra tjänster.
 */
export interface MapErrorGeometry {
  readonly shapes: readonly CourseSettingSketchShape[];
  /** En punkt (POINT) i stället för en ritning. */
  readonly point?: Point | undefined;
}

/** Kartfelen bland notiserna: slaget kartfel på en punkt eller en ritning. */
export function mapErrorNotes(notes: readonly CourseSettingNote[]): CourseSettingNote[] {
  return notes.filter(note => note.kind === "MAP_ERROR" && (note.target.kind === "POINT" || note.target.kind === "SKETCH"));
}

export function mapErrorGeometry(note: CourseSettingNote): MapErrorGeometry {
  if (note.target.kind === "SKETCH") return { shapes: note.target.shapes };
  if (note.target.kind === "POINT") return { shapes: [], point: note.target.at };
  throw new Error(inLanguage("Ett kartfel sitter på en punkt eller en ritning", "A map error is placed on a point or a drawing"));
}

function geometryDistance(geometry: MapErrorGeometry, at: Point): number {
  if (geometry.point) return Math.hypot(geometry.point.x - at.x, geometry.point.y - at.y);
  return distanceToSketch(geometry.shapes, at);
}

/** Inom så många meter från en kontroll (eller inom ringen om den är större) varnas kartfelet. */
export const NEAR_CONTROL_M = 50;

/**
 * Avståndet i meter till närmaste kontroll (start, mål och alla andra) när det är nära: inom ringen eller `NEAR_CONTROL_M`.
 * undefined = inte nära någon.
 */
export function nearControlMeters(geometry: MapErrorGeometry, document: CourseSettingDocument, metersPerMm: number): number | undefined {
  const ringMm = 3 * (document.event.allControlsPrintScale ?? document.event.mapScale) / document.event.mapScale;
  const limitMm = Math.max(ringMm, NEAR_CONTROL_M / metersPerMm);
  let best = Infinity;
  for (const control of Object.values(document.controls)) best = Math.min(best, geometryDistance(geometry, control.at));
  return best <= limitMm ? Math.max(1, Math.round(best * metersPerMm)) : undefined;
}

export interface CropRect { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }

/**
 * Kartutsnittet (mm) för ett kartfel: minst `widthMm` × `heightMm` (proportionerna behålls när ritningen är större) och
 * med kartfelet inom `marginMm` från kanten, men förskjutet slumpvis (`random` ger tal i [0, 1)) så att utsnittets mitt
 * inte ligger på kartfelet (och därmed inte på en kontroll i närheten).
 */
export function cropFor(geometry: MapErrorGeometry, random: () => number, options: { widthMm?: number; heightMm?: number; marginMm?: number } = {}): CropRect {
  const width0 = options.widthMm ?? 80, height0 = options.heightMm ?? 55, margin = options.marginMm ?? 8;
  const bounds = geometry.point ? { minX: geometry.point.x, maxX: geometry.point.x, minY: geometry.point.y, maxY: geometry.point.y }
    : sketchBounds(geometry.shapes) ?? { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const needX = bounds.maxX - bounds.minX + 2 * margin, needY = bounds.maxY - bounds.minY + 2 * margin;
  const factor = Math.max(1, needX / width0, needY / height0);
  const width = width0 * factor, height = height0 * factor;
  // Fritt utrymme runt kartfelet; mitten flyttas mellan 30 och 90 % av det åt ett slumpvis håll.
  const freeX = (width - needX) / 2, freeY = (height - needY) / 2;
  const shift = (free: number) => {
    const amount = 0.3 + 0.6 * random();
    return (random() < 0.5 ? -1 : 1) * amount * free;
  };
  const centerX = (bounds.minX + bounds.maxX) / 2 + shift(freeX), centerY = (bounds.minY + bounds.maxY) / 2 + shift(freeY);
  return { minX: centerX - width / 2, maxX: centerX + width / 2, minY: centerY - height / 2, maxY: centerY + height / 2 };
}

export interface ExportedMapError {
  /** Löpnumret i exporten (1, 2 …), inte notisens id. */
  readonly number: number;
  readonly text: string;
  readonly status: CourseSettingNote["status"];
  readonly geometry: MapErrorGeometry;
}

type Position = [number, number];
const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;

/**
 * GeoJSON med kartfelen. Med georeferens i kartans projicerade koordinatsystem (namngivet med `crs` om det är ett EPSG,
 * som QGIS och OCAD läser), annars i kartans mm (y uppåt, som i OCAD-filen). Egenskaperna är bara löpnummer, text,
 * status, färg och betydelse.
 */
export function mapErrorsGeoJson(items: readonly ExportedMapError[], georeference: MapGeoreference | null): Record<string, unknown> {
  const position = (point: Point): Position => {
    if (!georeference) return [round(point.x, 3), round(point.y, 3)];
    const projected = mapPointToProjected(georeference, point);
    return [round(projected.easting, 2), round(projected.northing, 2)];
  };
  const features = items.flatMap((item): Record<string, unknown>[] => {
    const properties = { nr: item.number, text: item.text, status: item.status };
    if (item.geometry.point) {
      return [{ type: "Feature", properties: { ...properties, form: "POINT", style: "MAP_ERROR", intent: null },
        geometry: { type: "Point", coordinates: position(item.geometry.point) } }];
    }
    return item.geometry.shapes.map((shape, index) => {
      const coordinates = shape.points.map(position);
      const geometry = shape.kind === "AREA" ? { type: "Polygon", coordinates: [[...coordinates, coordinates[0]!]] }
        : { type: "LineString", coordinates };
      return { type: "Feature", properties: { ...properties, part: index + 1, form: shape.kind, style: shape.style, intent: shape.intent }, geometry };
    });
  });
  const crs = georeference?.crs.kind === "EPSG" ? { type: "name", properties: { name: `urn:ogc:def:crs:EPSG::${georeference.crs.code}` } } : undefined;
  return { type: "FeatureCollection", name: "kartfel", ...(crs ? { crs } : {}),
    ...(georeference ? {} : { "otid:coordinates": "kartans mm (y uppåt), ingen georeferens" }), features };
}

/** Kartfelets ritning i utsnittets pixlar (y nedåt) för en bild som är `pxPerMm` per kartmm. */
export function cropTransform(crop: CropRect, pxPerMm: number): (point: Point) => { x: number; y: number } {
  return point => ({ x: (point.x - crop.minX) * pxPerMm, y: (crop.maxY - point.y) * pxPerMm });
}
