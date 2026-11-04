/**
 * "Vitt på utskriften" (ADR-0211 beslut 8): ytor i kartramen som skrivs ut vita, det som ska skäras bort ur kartan utan att
 * kartfilen ändras. Banans figurer står kvar hela ovanpå; markeringarna följer klippningens regel (ADR-0197 punkt 11): en
 * punktsymbol i en vit yta står inte alls, övriga markeringar ritas inte i ytan (renderarna klipper dem jämn–udda).
 */
import type { SheetFrame } from "./layout-template";
import { POINT_MARKINGS, type PaperShape } from "./paper-items";
import { insidePolygon, shapePoints } from "./paper-shapes";
import type { CourseSettingDocument } from "./types";

export function whiteAreasOnFrame<F extends Pick<SheetFrame, "clip" | "transform" | "mapArea" | "figures">>(document: CourseSettingDocument, frame: F,
  areas: readonly PaperShape[], mirror = false): F & { whiteAreas?: SheetFrame["whiteAreas"] } {
  if (areas.length === 0) return frame;
  const polygons = areas.map(area => shapePoints(area).map(p => ({ x: frame.clip.x + p.x, y: frame.clip.y + p.y })));
  const t = frame.transform;
  const axis = (frame.mapArea.minX + frame.mapArea.maxX) / 2;
  const specials = new Map(document.specialObjects.map(special => [special.id, special]));
  const dropped = new Set<string>();
  for (const figure of frame.figures) {
    if (figure.role !== "SPECIAL" || figure.ref === undefined || figure.kind === "description") continue;
    const special = specials.get(figure.ref);
    if (!special || !POINT_MARKINGS.has(special.kind) || !special.points[0]) continue;
    const p = special.points[0];
    const x = mirror ? 2 * axis - p.x : p.x;
    const at = { x: t.scale * x + t.translateX, y: -t.scale * p.y + t.translateY };
    if (polygons.some(polygon => insidePolygon(at, polygon))) dropped.add(figure.ref);
  }
  const figures = dropped.size === 0 ? frame.figures : frame.figures.filter(figure => !(figure.role === "SPECIAL" && figure.ref !== undefined && dropped.has(figure.ref)));
  return { ...frame, figures, whiteAreas: polygons };
}
