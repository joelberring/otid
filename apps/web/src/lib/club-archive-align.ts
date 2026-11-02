import type { RaceMapSourceMetadata } from "@o-tid/contracts";
import { controlBounds, moveDocumentPoints, type CourseSettingDocument } from "@o-tid/course-setting";
import { mapPointToProjected, projectedToMapPoint, type Point } from "@o-tid/map-file";

/**
 * ADR-0194 beslut 4: "Flytta banorna till senaste kartversionen". Jämför kartversionernas georeferens (koordinatsystem,
 * referenspunkt, vridning, skala) och yta. Samma georeferens: kontrollerna behåller sina lägen. Olika georeferens i samma
 * koordinatsystem: lägena räknas om via terrängens koordinater. Annars (ingen georeferens eller olika koordinatsystem):
 * arrangören ser banan på den nya kartan och kan förskjuta den innan den används.
 */
export type VersionFacts = Pick<RaceMapSourceMetadata, "bounds" | "georeference">;
type Georeference = NonNullable<RaceMapSourceMetadata["georeference"]>;

export type AlignmentKind = { kind: "SAME" } | { kind: "GEOREFERENCED" } | { kind: "MANUAL"; reason: "NO_GEOREFERENCE" | "DIFFERENT_CRS" };
export interface AlignmentCheck {
  readonly alignment: AlignmentKind;
  readonly extentChanged: boolean;
  /** Läget på den nya kartan före förskjutningen. */
  readonly move: (point: Point) => Point;
}

const close = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;

function sameCrs(a: Georeference, b: Georeference): boolean {
  if (a.crs.kind !== b.crs.kind) return false;
  return a.crs.kind === "EPSG" ? a.crs.code === (b.crs as { code: number }).code
    : a.crs.description === (b.crs as { description: string }).description;
}

export function sameGeoreference(a: Georeference, b: Georeference): boolean {
  return sameCrs(a, b) && a.scale === b.scale && close(a.refPoint.easting, b.refPoint.easting, 0.01) && close(a.refPoint.northing, b.refPoint.northing, 0.01)
    && close(a.mapRefPoint.x, b.mapRefPoint.x, 0.001) && close(a.mapRefPoint.y, b.mapRefPoint.y, 0.001)
    && close(a.grivationDegrees, b.grivationDegrees, 1e-6) && close(a.combinedScaleFactor, b.combinedScaleFactor, 1e-9);
}

export function checkAlignment(from: VersionFacts, to: VersionFacts): AlignmentCheck {
  const extentChanged = !(close(from.bounds.minX, to.bounds.minX, 0.5) && close(from.bounds.maxX, to.bounds.maxX, 0.5)
    && close(from.bounds.minY, to.bounds.minY, 0.5) && close(from.bounds.maxY, to.bounds.maxY, 0.5));
  const identity = (point: Point) => point;
  if (!from.georeference || !to.georeference) return { alignment: { kind: "MANUAL", reason: "NO_GEOREFERENCE" }, extentChanged, move: identity };
  if (!sameCrs(from.georeference, to.georeference)) return { alignment: { kind: "MANUAL", reason: "DIFFERENT_CRS" }, extentChanged, move: identity };
  if (sameGeoreference(from.georeference, to.georeference)) return { alignment: { kind: "SAME" }, extentChanged, move: identity };
  const source = from.georeference, target = to.georeference;
  return { alignment: { kind: "GEOREFERENCED" }, extentChanged,
    move: point => projectedToMapPoint(target, mapPointToProjected(source, point)) };
}

/** Dokumentet på den nya kartversionen: kontrollerna genom `check.move` och förskjutningen (mm). */
export function alignedDocument(document: CourseSettingDocument, check: AlignmentCheck, offset: { dx: number; dy: number }): CourseSettingDocument {
  if (check.alignment.kind === "SAME" && offset.dx === 0 && offset.dy === 0) return document;
  return moveDocumentPoints(document, point => { const moved = check.move(point); return { x: moved.x + offset.dx, y: moved.y + offset.dy }; });
}

/** Hamnar någon kontroll utanför den nya kartans yta? */
export function controlsOutside(document: CourseSettingDocument, bounds: VersionFacts["bounds"]): boolean {
  const area = controlBounds(document);
  if (!area) return false;
  return area.minX < bounds.minX || area.minY < bounds.minY || area.maxX > bounds.maxX || area.maxY > bounds.maxY;
}
