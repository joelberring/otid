import type { CourseCheck, CourseSettingDocument } from "@o-tid/course-setting";
import type { LegInput } from "@o-tid/route-choice";
import { courseSettingSv as text } from "../i18n/course-setting-sv";

/**
 * Steg 62: banläggningens klartext och vägvalens indata. Kontrollerna nämns med kod, banorna med namn. Kontrollerna som
 * `checkDocument` ger blir rader med texten och det som ska markeras på kartan.
 */
export function controlLabel(document: CourseSettingDocument, control: string): string {
  const point = document.controls[control];
  if (!point) return text.label.control(undefined);
  return point.kind === "NORMAL" ? text.label.control(point.code) : text.label[point.kind];
}

const courseName = (document: CourseSettingDocument, course: string) => document.courses.find(row => row.id === course)?.name ?? course;

export interface CheckRow {
  readonly key: string;
  readonly text: string;
  /** Kontrollerna att markera. */
  readonly controls: readonly string[];
  /** Banan att visa (saknas för det som gäller alla kontroller). */
  readonly course?: string | undefined;
}

export function checkRows(document: CourseSettingDocument, checks: readonly CourseCheck[]): CheckRow[] {
  const label = (control: string) => controlLabel(document, control);
  return checks.map((check, index): CheckRow => {
    const key = `${check.kind}-${index}`;
    switch (check.kind) {
      case "CONTROLS_TOO_CLOSE": return { key, controls: check.controls,
        text: text.checks.CONTROLS_TOO_CLOSE(label(check.controls[0]), label(check.controls[1]), check.meters, check.limitMeters) };
      case "DUPLICATE_CODE": return { key, controls: check.controls, text: text.checks.DUPLICATE_CODE(check.code, check.controls.length) };
      case "INVERTIBLE_CODE": return { key, controls: [check.control], text: text.checks.INVERTIBLE_CODE(check.code) };
      case "SAME_CONTROL_TWICE_IN_ROW": return { key, controls: [check.control], course: check.course,
        text: text.checks.SAME_CONTROL_TWICE_IN_ROW(courseName(document, check.course), label(check.control)) };
      case "LEG_THROUGH_CONTROL": return { key, controls: [check.from, check.to, check.control], course: check.course,
        text: text.checks.LEG_THROUGH_CONTROL(courseName(document, check.course), label(check.from), label(check.to), label(check.control)) };
      case "COURSE_WITHOUT_START_OR_FINISH": return { key, controls: [], course: check.course,
        text: text.checks.COURSE_WITHOUT_START_OR_FINISH(courseName(document, check.course)) };
      case "UNUSED_CONTROL": return { key, controls: [check.control], text: text.checks.UNUSED_CONTROL(label(check.control)) };
      case "MISSING_CODE": return { key, controls: [check.control], text: text.checks.MISSING_CODE(label(check.control)) };
    }
  });
}

/**
 * Vald sträcka som indata till vägvalsanalysen (steg 60): ändarna och banans övriga kontroller (för varningen om en
 * sträcka genom en annan ring). Nyckeln byter värde när en ände flyttas, så att en gammal analys inte visas för nya lägen.
 */
export function legInput(document: CourseSettingDocument, from: string, to: string, courseControls: readonly string[]): LegInput | undefined {
  const start = document.controls[from], end = document.controls[to];
  if (!start || !end) return undefined;
  const others = new Map<string, { code: string; at: { x: number; y: number } }>();
  for (const id of courseControls) {
    const control = document.courseControls[id]?.control;
    const point = control ? document.controls[control] : undefined;
    if (!point || point.kind !== "NORMAL" || control === from || control === to) continue;
    others.set(point.id, { code: point.code ?? point.id, at: point.at });
  }
  const key = `${from}-${to}@${start.at.x},${start.at.y};${end.at.x},${end.at.y}`;
  return { key, from: start.at, to: end.at, otherControls: [...others.values()] };
}

/** Sekunder som "m:ss". */
export function minutes(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
