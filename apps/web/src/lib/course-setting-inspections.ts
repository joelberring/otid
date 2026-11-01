import type { CourseSettingInspection, CourseSettingInspectionRequest } from "@o-tid/contracts";
import type { CourseSettingDocument } from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { toScreen, type Viewport } from "./course-setting-viewport";

/**
 * Steg 67 (ADR-0181 beslut 6): "kollad" per kontroll i editorn. Serverns bockar med bockarna som väntar i telefonens kö
 * ovanpå (i den ordning de gjordes), listan med filtret "ej kollade" och markeringen på kartan. Markeringen ritas bara
 * på skärmen, aldrig i banpåtrycket eller trycket. Ren logik.
 */
export interface Inspection extends CourseSettingInspection {
  /** Bocken väntar i telefonens kö (inget nät). */
  readonly pending?: boolean | undefined;
}

/** Serverns bockar med de väntande ovanpå: en väntande bock ersätter, en väntande avbockning tar bort. */
export function mergeInspections(server: readonly CourseSettingInspection[], queued: readonly CourseSettingInspectionRequest[],
  me: CourseSettingInspection["checkedBy"]): ReadonlyMap<string, Inspection> {
  const result = new Map<string, Inspection>(server.map(row => [row.control, row]));
  for (const request of queued) {
    const current = result.get(request.control);
    if (current && Date.parse(current.checkedAt) > Date.parse(request.at)) continue;
    if (request.checked) result.set(request.control, { control: request.control, checkedAt: request.at, checkedBy: me, at: request.position, pending: true });
    else result.delete(request.control);
  }
  return result;
}

/** Kontrollen har flyttats mer än så här sedan den kollades (mm på kartan; 0,2 mm = 2 m i 1:10 000). */
const MOVED_MM = 0.2;

export interface InspectionRow {
  readonly control: string;
  readonly code: string;
  readonly inspection?: Inspection | undefined;
  /** Kontrollen har flyttats efter att den kollades. */
  readonly movedSince: boolean;
}

/** Kontrollerna (bara vanliga kontroller) i nummerordning, med bocken. `controls` = de som visas (bana eller alla). */
export function inspectionRows(document: CourseSettingDocument, controls: Iterable<string>, inspections: ReadonlyMap<string, Inspection>)
  : InspectionRow[] {
  const rows: InspectionRow[] = [];
  for (const id of new Set(controls)) {
    const control = document.controls[id];
    if (!control || control.kind !== "NORMAL") continue;
    const inspection = inspections.get(id);
    const movedSince = Boolean(inspection?.at && Math.hypot(inspection.at.x - control.at.x, inspection.at.y - control.at.y) > MOVED_MM);
    rows.push({ control: id, code: control.code ?? "?", inspection, movedSince });
  }
  return rows.sort((a, b) => a.code.localeCompare(b.code, "sv-SE", { numeric: true }) || a.control.localeCompare(b.control));
}

export type InspectionFilter = "UNCHECKED" | "ALL";
export const filterInspectionRows = (rows: readonly InspectionRow[], filter: InspectionFilter) =>
  filter === "ALL" ? rows : rows.filter(row => !row.inspection || row.movedSince);

/** Kontrollerna att markera på kartan som kollade (kontrollens läge nu). */
export function inspectedPoints(document: CourseSettingDocument, controls: ReadonlySet<string>, inspections: ReadonlyMap<string, Inspection>)
  : { at: Point; moved: boolean }[] {
  return inspectionRows(document, controls, inspections).filter(row => row.inspection)
    .map(row => ({ at: document.controls[row.control]!.at, moved: row.movedSince }));
}

/**
 * Den diskreta markeringen: en liten grön bock (orange om kontrollen flyttats sedan) snett nedanför ringen till höger, där
 * kontrollnumret sällan står. Bara på skärmen.
 */
export function drawInspected(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, view: Viewport,
  points: readonly { at: Point; moved: boolean }[], radiusMm: number) {
  if (points.length === 0) return;
  const offset = radiusMm * view.pxPerMm * 0.75 + 4;
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const point of points) {
    const at = toScreen(view, point.at);
    const x = at.x + offset, y = at.y + offset;
    ctx.beginPath(); ctx.arc(x, y, 7, 0, 2 * Math.PI);
    ctx.fillStyle = "#fff"; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = point.moved ? "#b45309" : "#15803d"; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 3.5, y); ctx.lineTo(x - 1, y + 2.8); ctx.lineTo(x + 3.8, y - 2.8);
    ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.restore();
}
