/**
 * Träningsläget i editorn (ADR-0192): rena hjälpfunktioner för panelen och kartan. Ändringarna blir `PUT_TRAINING` med hela
 * delar; id slumpas så att två som arbetar samtidigt inte får samma.
 */
import {
  controlSequences, courseTrainingOf, presetFilter, sectionMarkerText, variations, type CourseSettingDocument, type CourseSettingEdit,
  type CourseTraining, type SectionForm, type TrainingSection
} from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import type { Language } from "./language";

/** Orden för kontroller som inte har nummer i valen och rubrikerna (bara visning; valen känns igen på id). */
export const CONTROL_WORDS = {
  sv: { start: "Start", finish: "Mål", crossing: "Passage", mapExchange: "Kartbyte", mapIssue: "Kartutdelning" },
  en: { start: "Start", finish: "Finish", crossing: "Crossing point", mapExchange: "Map exchange", mapIssue: "Map issue point" }
} as const satisfies Record<Language, Record<string, string>>;
type ControlWords = { readonly [K in keyof typeof CONTROL_WORDS.sv]: string };

export function newTrainingId(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return `t${Array.from(bytes, byte => byte.toString(36).padStart(2, "0")).join("").slice(0, 10)}`;
}

/** Ändringen som sätter banans träning (null = tar bort den). */
export const putCourseTraining = (course: string, value: CourseTraining | null): CourseSettingEdit =>
  ({ type: "PUT_TRAINING", courses: { [course]: value } });

/** Banans träning ändrad med `change`. */
export function changeCourseTraining(document: CourseSettingDocument, course: string, change: (current: CourseTraining) => CourseTraining): CourseSettingEdit {
  return putCourseTraining(course, change(courseTrainingOf(document, course)));
}

/** Ett nytt avsnitt av formen, från start till mål (eller efter det sista avsnittet). */
export function newSection(form: SectionForm, previous?: TrainingSection): TrainingSection {
  const base = { id: newTrainingId(), from: previous?.to ?? null, to: null, form, marker: { kind: previous ? "TEXT" : "NONE" } } as const;
  switch (form) {
    case "CORRIDOR": return { ...base, corridor: { shape: "ANGULAR", widthMeters: 60, smoothing: 0.5 }, filter: presetFilter("ALL") };
    case "WINDOW": return { ...base, window: { shape: "CIRCLE", radiusMeters: 60 }, filter: presetFilter("ALL") };
    case "BAND": return { ...base, bandMeters: 300, filter: presetFilter("CONTOURS") };
    case "NO_MAP": return { ...base, bandMeters: 300, filter: presetFilter("ALL") };
  }
}

/** Kontrollerna i banans ordning (första varianten) som val i listorna: banans kontroll-id och etikett ("Start", "3 (33)", "Mål"). */
export function courseControlChoices(document: CourseSettingDocument, course: string, words: ControlWords = CONTROL_WORDS.sv): { id: string; label: string; control: string }[] {
  const sequence = controlSequences(document, course, undefined)[0] ?? [];
  let ordinal = 0;
  return sequence.map(ccId => {
    const control = document.controls[document.courseControls[ccId]!.control]!;
    const label = control.kind === "START" ? words.start : control.kind === "FINISH" ? words.finish : control.kind === "NORMAL"
      ? `${++ordinal} (${control.code ?? "?"})` : control.kind === "CROSSING_POINT" ? words.crossing : control.kind === "MAP_EXCHANGE" ? words.mapExchange : words.mapIssue;
    return { id: ccId, label, control: control.id };
  });
}

/** Avsnittets rubrik. */
export function sectionLabel(document: CourseSettingDocument, course: string, section: TrainingSection, words: ControlWords = CONTROL_WORDS.sv): { from: string; to: string; marker: string } {
  const choices = courseControlChoices(document, course, words);
  const name = (id: string | null, fallback: string) => id === null ? fallback : choices.find(row => row.id === id)?.label
    ?? choices.find(row => row.control === document.courseControls[id]?.control)?.label ?? "?";
  return { from: name(section.from, words.start), to: name(section.to, words.finish), marker: sectionMarkerText(section) };
}

/** Sträckorna på banan (alla grenar) som linjer, för att träffa en sträcka med ett klick. */
export function courseLegLines(document: CourseSettingDocument, course: string): { from: string; to: string; points: Point[] }[] {
  const seen = new Set<string>();
  const out: { from: string; to: string; points: Point[] }[] = [];
  for (const sequence of controlSequences(document, course, undefined)) {
    for (let i = 0; i + 1 < sequence.length; i++) {
      const from = document.courseControls[sequence[i]!]!.control, to = document.courseControls[sequence[i + 1]!]!.control;
      const key = `${from}-${to}`;
      if (from === to || seen.has(key)) continue;
      seen.add(key);
      out.push({ from, to, points: [document.controls[from]!.at, ...(document.legs[key]?.bends ?? []), document.controls[to]!.at] });
    }
  }
  return out;
}

function nearestOnSegment(p: Point, a: Point, b: Point): { distance: number; point: Point } {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { distance: Math.hypot(p.x - point.x, p.y - point.y), point };
}

/** Sträckan närmast punkten inom `tolerance` mm. */
export function legAt(document: CourseSettingDocument, course: string, point: Point, tolerance: number): { from: string; to: string } | undefined {
  let best: { from: string; to: string; distance: number } | undefined;
  for (const leg of courseLegLines(document, course)) {
    for (let i = 0; i + 1 < leg.points.length; i++) {
      const near = nearestOnSegment(point, leg.points[i]!, leg.points[i + 1]!);
      if (near.distance <= tolerance && (!best || near.distance < best.distance)) best = { from: leg.from, to: leg.to, distance: near.distance };
    }
  }
  return best ? { from: best.from, to: best.to } : undefined;
}

/** Linjen längs banans sträckor (första varianten) med brytpunkterna. */
export function lineAlongLegs(document: CourseSettingDocument, course: string): Point[] {
  const out: Point[] = [];
  for (const leg of courseLegLines(document, course).slice(0)) {
    for (const point of out.length === 0 ? leg.points : leg.points.slice(1)) out.push(point);
  }
  return out;
}

/** Kepsens par ur banans vanliga kontroller: intill varandra eller första och andra halvan. */
export function makePairs(document: CourseSettingDocument, course: string, mode: "ADJACENT" | "HALVES"): (readonly [string, string])[] {
  const normal = courseControlChoices(document, course).filter(row => document.controls[row.control]?.kind === "NORMAL").map(row => row.id);
  const pairs: (readonly [string, string])[] = [];
  if (mode === "ADJACENT") for (let i = 0; i + 1 < normal.length; i += 2) pairs.push([normal[i]!, normal[i + 1]!]);
  else {
    const half = Math.floor(normal.length / 2);
    for (let i = 0; i < half; i++) pairs.push([normal[i]!, normal[i + half]!]);
  }
  return pairs;
}

/**
 * Åtgärderna för en stjärnbana: en ny bana start – C – udd – C – udd … – mål (Purple Pen tillåter samma kontroll flera
 * gånger), i ett ångra-steg. `courseId` är id som den nya banan får (nästa lediga).
 */
export function starCourseEdits(document: CourseSettingDocument, name: string, center: string, spokes: readonly string[]): { edits: CourseSettingEdit[]; courseId: string } {
  const courseId = String(Math.max(0, ...document.courses.map(course => Number(course.id) || 0)) + 1);
  const edits: CourseSettingEdit[] = [{ type: "ADD_COURSE", name }];
  for (const spoke of spokes) {
    edits.push({ type: "INSERT_COURSE_CONTROL", course: courseId, control: center });
    edits.push({ type: "INSERT_COURSE_CONTROL", course: courseId, control: spoke });
  }
  edits.push({ type: "INSERT_COURSE_CONTROL", course: courseId, control: center });
  return { edits, courseId };
}

export function hasForks(document: CourseSettingDocument, course: string): boolean {
  return variations(document, course).length > 1;
}

/** Objektet utan ett valfritt fält (modellen använder frånvaro, inte `undefined`). */
export function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}
