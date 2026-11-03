/** Kontrollerna under arbetet (ADR-0180 beslut 9). */
import { sizesFor } from "./appearance";
import { controlsInForbidden, forbiddenLegs } from "./barriers";
import { distance, nearestOnPath } from "./geometry";
import { courseVariantList, isInvertibleCode } from "./summary";
import type { CheckOptions, CourseCheck, CourseSettingDocument, DescriptionBox } from "./types";
import { enumerateCourseControls, enumerateLegs, legPath } from "./walk";
import { numberObstacleChecks } from "./number-notices";

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
      if (meters < minMeters) {
        checks.push({ kind: "CONTROLS_TOO_CLOSE", controls: [a.id, b.id], meters, limitMeters: minMeters });
      } else if (meters < similarMeters) {
        // Mellan gränserna går det bra med tydligt olika objekt: kolumn D avgör när båda har ett objekt.
        const feature = sameFeature(a.descriptions, b.descriptions);
        if (feature !== "DIFFERENT") checks.push({ kind: "CONTROLS_TOO_CLOSE", controls: [a.id, b.id], meters, limitMeters: similarMeters, feature });
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
    for (const [fromCc, toCc] of legs) {
      const from = document.courseControls[fromCc]!.control;
      const to = document.courseControls[toCc]!.control;
      if (from === to) {
        if (!seenTwice.has(from)) checks.push({ kind: "SAME_CONTROL_TWICE_IN_ROW", course: course.id, control: from });
        seenTwice.add(from);
      }
    }

    // Sträcka genom en annan kontrolls ring: per variant, eftersom en gafflad banas karta bara visar sin egen variants
    // kontroller (en annan grens ring syns inte på löparens karta).
    const sizes = sizesFor(document, course.printScale ?? document.event.mapScale);
    const radius = sizes.control / 2 + sizes.line / 2;
    const reported = new Set<string>();
    for (const variant of course.kind === "SCORE" ? [] : courseVariantList(document, course.id)) {
      const ids = variant.courseControls.map(id => document.courseControls[id]!.control);
      const inVariant = new Set(ids);
      for (let index = 1; index < ids.length; index++) {
        const from = ids[index - 1]!, to = ids[index]!;
        if (from === to) continue;
        const path = legPath(document, from, to);
        for (const other of inVariant) {
          if (other === from || other === to) continue;
          const key = `${from}-${to}-${other}`;
          if (reported.has(key)) continue;
          const control = document.controls[other];
          if (!control || control.kind !== "NORMAL") continue;
          if (nearestOnPath(control.at, path).distance < radius) {
            reported.add(key);
            checks.push({ kind: "LEG_THROUGH_CONTROL", course: course.id, from, to, control: other });
          }
        }
      }
    }
  }
  checks.push(...forbiddenChecks(document, options));
  if (options.numberObstacles) checks.push(...numberObstacleChecks(document, options.numberObstacles));
  for (const control of controls) if (!used.has(control.id)) checks.push({ kind: "UNUSED_CONTROL", control: control.id });
  return checks;
}

/**
 * Steg 64 och ADR-0199: förbjudna områden och spärrar (gräns, förbjuden väg). En kontroll i ett förbjudet område tvingar
 * löparen in i det. En fågelväg som korsar området är vanligt när det finns en väg runt: med vägvalet räknat (med
 * spärrarna) blir det bara något när ingen laglig väg finns; inte räknat blir det en notis (UNKNOWN).
 */
function forbiddenChecks(document: CourseSettingDocument, options: CheckOptions): CourseCheck[] {
  const checks: CourseCheck[] = [];
  const inside = new Set<string>();
  for (const course of document.courses) {
    for (const hit of controlsInForbidden(document, course.id)) {
      if (inside.has(`${hit.control}-${hit.special}`)) continue;
      inside.add(`${hit.control}-${hit.special}`);
      checks.push({ kind: "CONTROL_IN_FORBIDDEN", course: course.id, ...hit });
    }
    if (course.kind === "SCORE") continue;
    const byLeg = new Map<string, { from: string; to: string; specials: string[] }>();
    for (const hit of forbiddenLegs(document, course.id)) {
      const key = `${hit.from}-${hit.to}`;
      const leg = byLeg.get(key) ?? { from: hit.from, to: hit.to, specials: [] };
      leg.specials.push(hit.special);
      byLeg.set(key, leg);
    }
    for (const { from, to, specials } of byLeg.values()) {
      const route = options.legRoute?.(course.id, from, to);
      if (route?.reachable) continue;
      if (route) checks.push({ kind: "LEG_THROUGH_FORBIDDEN", course: course.id, from, to, special: specials[0]!, route: "NO_ROUTE", specials });
      else checks.push({ kind: "LEG_THROUGH_FORBIDDEN", course: course.id, from, to, special: specials[0]!, route: "UNKNOWN", specials });
    }
  }
  return checks;
}

/** Samma slags objekt enligt kolumn D (IOF), olika, eller okänt när någon av kontrollerna saknar objekt. */
function sameFeature(a: readonly DescriptionBox[], b: readonly DescriptionBox[]): "SAME" | "DIFFERENT" | "UNKNOWN" {
  const feature = (boxes: readonly DescriptionBox[]) => boxes.find(box => box.box === "D")?.ref;
  const fa = feature(a), fb = feature(b);
  if (fa === undefined || fb === undefined) return "UNKNOWN";
  return fa === fb ? "SAME" : "DIFFERENT";
}

/** Sista banans kontroll i huvudgrenen (den som ritas sist). */
function enumerateLastCourseControl(document: CourseSettingDocument, ccIds: readonly string[]): string | undefined {
  return ccIds.find(id => document.courseControls[id]?.next === undefined && !document.courseControls[id]?.split) ?? ccIds[ccIds.length - 1];
}
