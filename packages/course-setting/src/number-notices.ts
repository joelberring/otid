/**
 * ADR-0211 beslut 4: notisen "Nummer 11 ligger delvis på ett hus". Bara nummer som banläggaren placerat själv
 * (`numberAt`); de automatiska undviker hindren när det finns plats. Numret prövas där det ritas på banans karta.
 */
import { areaCover } from "./number-obstacles";
import { layout } from "./overprint";
import { courseControlIds } from "./print-layouts";
import type { CourseCheck, CourseSettingDocument, OverprintOptions } from "./types";

/** Så stor del av numrets ruta får ligga på en mörk yta innan det blir en notis. */
export const NUMBER_OBSTACLE_NOTICE_COVER = 0.2;

function hasMovedNumberNearArea(document: CourseSettingDocument, courseId: string, obstacles: NonNullable<OverprintOptions["numberObstacles"]>): boolean {
  for (const id of courseControlIds(document, courseId)) {
    const cc = document.courseControls[id];
    if (cc?.numberAt !== undefined && (obstacles[cc.control]?.areas.length ?? 0) > 0) return true;
  }
  return false;
}

export function numberObstacleChecks(document: CourseSettingDocument, obstacles: NonNullable<OverprintOptions["numberObstacles"]>): CourseCheck[] {
  const out: CourseCheck[] = [];
  for (const course of [...document.courses].sort((a, b) => a.order - b.order)) {
    if (!hasMovedNumberNearArea(document, course.id, obstacles)) continue;
    let figures;
    try { figures = layout(document, { course: course.id, numberObstacles: obstacles }); } catch { continue; }
    for (const figure of figures) {
      if (figure.kind !== "text" || figure.role !== "NUMBER" || !figure.ref) continue;
      const cc = document.courseControls[figure.ref];
      if (!cc?.numberAt) continue;
      const height = figure.heightMm;
      const box = { cx: figure.at.x, cy: figure.at.y, w: Math.max(1, figure.text.length) * 0.78 * height, h: height };
      if (areaCover(box, obstacles[cc.control]) >= NUMBER_OBSTACLE_NOTICE_COVER) out.push({ kind: "NUMBER_ON_OBSTACLE", course: course.id, control: cc.control, text: figure.text });
    }
  }
  return out;
}
