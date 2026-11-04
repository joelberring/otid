/**
 * Nivåstödet (ADR-0212) för en bana i banläggningen: indata ur dokumentet (kontrollerna med kolumn D och F, sträckorna i
 * alla varianter en gång), bedömningen ur de uppmätta värdena, sammanfattningen, avvikelserna mot målnivån som notiser i
 * Varningar och målnivån när en ny .ppen läses in. Ren logik; mätningen görs i vägvalens Worker (`level-features.ts`).
 */
import { classNamesOfCourse } from "./iof-export";
import { levelDeviation, judgeControl, judgeLeg, type LevelDeviation, type LevelVerdict } from "./level-rules";
import type { LevelControlInput } from "./level-features";
import { levelFromClassNames, levelRank, type ControlLevelFeatures, type CourseLevel, type LegLevelFeatures, type LevelRank } from "./level-types";
import type { Course, CourseCheck, CourseSettingDocument } from "./types";
import { enumerateCourseControls, findCourse, variations } from "./walk";

/** Banans kontroller att bedöma (vanliga kontroller, i alla varianter, en gång var). */
export function levelControls(document: CourseSettingDocument, courseId: string): LevelControlInput[] {
  const out = new Map<string, LevelControlInput>();
  for (const order of variantOrders(document, courseId)) for (const id of order) {
    const control = document.controls[document.courseControls[id]?.control ?? ""];
    if (!control || control.kind !== "NORMAL" || out.has(control.id)) continue;
    const d = control.descriptions.find(box => box.box === "D")?.ref;
    const f = control.descriptions.find(box => box.box === "F")?.text;
    out.set(control.id, { id: control.id, at: control.at, ...(d ? { d } : {}), ...(f ? { f } : {}) });
  }
  return [...out.values()];
}

function variantOrders(document: CourseSettingDocument, courseId: string): string[][] {
  const course = findCourse(document, courseId);
  if (course.kind === "SCORE") return [enumerateCourseControls(document, courseId)];
  const list = variations(document, courseId);
  return list.length === 0 ? [enumerateCourseControls(document, courseId)] : list.map(variation => enumerateCourseControls(document, courseId, variation.choices));
}

/** Banans sträckor (kontrollernas id), i alla varianter en gång var. Poängbanor har inga. */
export function levelLegPairs(document: CourseSettingDocument, courseId: string): { readonly from: string; readonly to: string }[] {
  if (findCourse(document, courseId).kind === "SCORE") return [];
  const seen = new Set<string>();
  const out: { from: string; to: string }[] = [];
  for (const order of variantOrders(document, courseId)) {
    for (let index = 1; index < order.length; index++) {
      const from = document.courseControls[order[index - 1]!]?.control, to = document.courseControls[order[index]!]?.control;
      if (!from || !to || from === to || seen.has(`${from}-${to}`)) continue;
      seen.add(`${from}-${to}`);
      out.push({ from, to });
    }
  }
  return out;
}

/** Målnivån som föreslås ur banans klasser (undertiteln) och namnet. */
export function suggestedCourseLevel(course: Course): CourseLevel | undefined {
  return levelFromClassNames(classNamesOfCourse(course)) ?? levelFromClassNames([course.name]);
}

export interface LevelItem<F> { readonly features: F; readonly verdict: LevelVerdict }

export interface LevelAssessment {
  readonly controls: readonly LevelItem<ControlLevelFeatures>[];
  readonly legs: readonly LevelItem<LegLevelFeatures>[];
  /** Ungefär: från medianen till 85:e percentilen av alla kontroller och sträckor. */
  readonly low: LevelRank;
  readonly high: LevelRank;
}

/** Bedömningen ur de uppmätta värdena. */
export function assessLevel(controls: readonly ControlLevelFeatures[], legs: readonly LegLevelFeatures[]): LevelAssessment {
  const judgedControls = controls.map(features => ({ features, verdict: judgeControl(features) }));
  const judgedLegs = legs.map(features => ({ features, verdict: judgeLeg(features) }));
  const ranks = [...judgedControls, ...judgedLegs].map(item => item.verdict.rank).sort((a, b) => a - b);
  const at = (share: number) => ranks.length === 0 ? 0 : ranks[Math.min(ranks.length - 1, Math.floor(share * ranks.length))]!;
  return { controls: judgedControls, legs: judgedLegs, low: at(0.5) as LevelRank, high: at(0.85) as LevelRank };
}

/** Hur många kontroller och sträckor som är svårare än nivån. */
export function harderThan(assessment: LevelAssessment, rank: LevelRank): { readonly controls: number; readonly legs: number } {
  return { controls: assessment.controls.filter(item => item.verdict.rank > rank).length, legs: assessment.legs.filter(item => item.verdict.rank > rank).length };
}

export interface LevelDeviationRow {
  readonly kind: "control" | "leg";
  readonly control?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly rank: LevelRank;
  readonly deviation: LevelDeviation;
}

/** Avvikelserna mot målnivån (svårare, och tydligt lättare från Gul). */
export function levelDeviations(assessment: LevelAssessment, target: CourseLevel): LevelDeviationRow[] {
  const goal = levelRank(target);
  const out: LevelDeviationRow[] = [];
  for (const item of assessment.controls) {
    const deviation = levelDeviation("control", item.features, item.verdict.rank, goal);
    if (deviation) out.push({ kind: "control", control: item.features.control, rank: item.verdict.rank, deviation });
  }
  for (const item of assessment.legs) {
    const deviation = levelDeviation("leg", item.features, item.verdict.rank, goal);
    if (deviation) out.push({ kind: "leg", from: item.features.from, to: item.features.to, rank: item.verdict.rank, deviation });
  }
  return out;
}

/** Avvikelserna som notiser i Varningar (ADR-0199): bara när banläggaren bett om det, och de går att godta. */
export function levelChecks(document: CourseSettingDocument, course: string, assessment: LevelAssessment): CourseCheck[] {
  const found = document.courses.find(row => row.id === course);
  if (!found?.level || !document.event.levelNotices) return [];
  const target = found.level;
  return levelDeviations(assessment, target).flatMap((row): CourseCheck[] => {
    const base = { kind: "LEVEL_DEVIATION" as const, course, target, direction: row.deviation.direction, rule: row.deviation.rule, rank: row.rank };
    if (row.kind === "control" && row.control && document.controls[row.control]) return [{ ...base, control: row.control }];
    if (row.kind === "leg" && row.from && row.to && document.controls[row.from] && document.controls[row.to]) return [{ ...base, from: row.from, to: row.to }];
    return [];
  });
}

/**
 * En ny .ppen ersätter banläggningen. Målnivån står inte i .ppen (Purple Pen har inget fält för den); en bana utan nivå får
 * nivån från samma bana i den nuvarande (samma id och namn, annars samma namn).
 */
export function carryCourseLevels(current: CourseSettingDocument, imported: CourseSettingDocument): CourseSettingDocument {
  let changed = false;
  const courses = imported.courses.map(course => {
    if (course.level) return course;
    const previous = current.courses.find(row => row.id === course.id && row.name === course.name) ?? current.courses.find(row => row.name === course.name);
    if (!previous?.level) return course;
    changed = true;
    return { ...course, level: previous.level };
  });
  const notices = current.event.levelNotices && !imported.event.levelNotices;
  if (!changed && !notices) return imported;
  return { ...imported, courses, event: notices ? { ...imported.event, levelNotices: true } : imported.event };
}
