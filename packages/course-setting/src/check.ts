/** Kontrollerna under arbetet (ADR-0180 beslut 9). */
import { sizesFor } from "./appearance";
import { distance, nearestOnPath } from "./geometry";
import { isInvertibleCode } from "./summary";
import type { CheckOptions, CourseCheck, CourseSettingDocument } from "./types";
import { enumerateCourseControls, enumerateLegs, legPath } from "./walk";

/** IOF:s riktvärden: under `min` för nära, under `similar` bara med tydligt olika objekt (sprint hälften). */
export const CONTROL_DISTANCE_LIMITS = {
  forest: { minMeters: 30, similarMeters: 60 },
  sprint: { minMeters: 15, similarMeters: 30 }
} as const;

export function checkCourseSetting(document: CourseSettingDocument, options: CheckOptions = {}): CourseCheck[] {
  const checks: CourseCheck[] = [];
  const defaults = document.event.overprintStandard === "ISSPROM2019" ? CONTROL_DISTANCE_LIMITS.sprint : CONTROL_DISTANCE_LIMITS.forest;
  const minMeters = options.minMeters ?? defaults.minMeters;
  const similarMeters = Math.max(minMeters, options.similarMeters ?? defaults.similarMeters);
  const controls = Object.values(document.controls);
  const normal = controls.filter(control => control.kind === "NORMAL");
  const metersPerMm = document.event.mapScale / 1000;

  for (let i = 0; i < normal.length; i++) {
    for (let j = i + 1; j < normal.length; j++) {
      const a = normal[i]!;
      const b = normal[j]!;
      const meters = distance(a.at, b.at) * metersPerMm;
      if (meters < similarMeters) {
        checks.push({ kind: "CONTROLS_TOO_CLOSE", controls: [a.id, b.id], meters, limitMeters: meters < minMeters ? minMeters : similarMeters });
      }
    }
  }

  const byCode = new Map<string, string[]>();
  for (const control of normal) {
    if (control.code === undefined || control.code.trim() === "") {
      checks.push({ kind: "MISSING_CODE", control: control.id });
      continue;
    }
    byCode.set(control.code, [...(byCode.get(control.code) ?? []), control.id]);
    if (document.event.numbering.disallowInvertible && isInvertibleCode(control.code)) {
      checks.push({ kind: "INVERTIBLE_CODE", code: control.code, control: control.id });
    }
  }
  for (const [code, ids] of byCode) if (ids.length > 1) checks.push({ kind: "DUPLICATE_CODE", code, controls: ids });

  const used = new Set<string>();
  for (const course of [...document.courses].sort((a, b) => a.order - b.order)) {
    const ccIds = enumerateCourseControls(document, course.id);
    const controlIds = ccIds.map(id => document.courseControls[id]!.control);
    for (const id of controlIds) used.add(id);
    const ofKind = (index: number | undefined) => index === undefined ? undefined : document.controls[controlIds[index]!]?.kind;
    const firstReal = controlIds.findIndex(id => document.controls[id]?.kind !== "MAP_ISSUE");
    const lastId = enumerateLastCourseControl(document, ccIds);
    if (ccIds.length === 0 || ofKind(firstReal) !== "START" || lastId === undefined || document.controls[document.courseControls[lastId]!.control]?.kind !== "FINISH") {
      checks.push({ kind: "COURSE_WITHOUT_START_OR_FINISH", course: course.id });
    }

    const legs = enumerateLegs(document, course.id);
    const seenTwice = new Set<string>();
    const seenLegs = new Set<string>();
    const sizes = sizesFor(document, course.printScale ?? document.event.mapScale);
    const radius = sizes.control / 2 + sizes.line / 2;
    const courseControlIds = new Set(controlIds);
    for (const [fromCc, toCc] of legs) {
      const from = document.courseControls[fromCc]!.control;
      const to = document.courseControls[toCc]!.control;
      if (from === to) {
        if (!seenTwice.has(from)) checks.push({ kind: "SAME_CONTROL_TWICE_IN_ROW", course: course.id, control: from });
        seenTwice.add(from);
        continue;
      }
      const key = `${from}-${to}`;
      if (seenLegs.has(key)) continue;
      seenLegs.add(key);
      const path = legPath(document, from, to);
      for (const other of courseControlIds) {
        if (other === from || other === to) continue;
        const control = document.controls[other];
        if (!control || control.kind !== "NORMAL") continue;
        if (nearestOnPath(control.at, path).distance < radius) {
          checks.push({ kind: "LEG_THROUGH_CONTROL", course: course.id, from, to, control: other });
        }
      }
    }
  }
  for (const control of controls) if (!used.has(control.id)) checks.push({ kind: "UNUSED_CONTROL", control: control.id });
  return checks;
}

/** Sista banans kontroll i huvudgrenen (den som ritas sist). */
function enumerateLastCourseControl(document: CourseSettingDocument, ccIds: readonly string[]): string | undefined {
  return ccIds.find(id => document.courseControls[id]?.next === undefined && !document.courseControls[id]?.split) ?? ccIds[ccIds.length - 1];
}
