import {
  assessLevel, controlFeatures, harderThan, isCourseLevel, legFeatures, levelControls, levelDeviations, levelLegPairs, prepareLevelMap,
  routeBarriers, suggestedCourseLevel, type CourseLevel, type CourseSettingDocument, type LegLevelFeatures, type LevelRank
} from "@o-tid/course-setting";
import type { ParsedMap } from "@o-tid/map-file";
import { analyseLeg, buildCostModel, type LegInput, type RouteChoiceSettings } from "@o-tid/route-choice";

/**
 * Ägaren 2026-11-08 (AI-banläggningsassistenten): nivåstödets mätningar (ADR-0212) på servern, samma beräkning som
 * banläggningens webbläsare gör (`route-choice-worker.ts`): vägvalen med "följ ledstänger", sträckornas och kontrollernas
 * drag och bedömningen per kontroll och sträcka mot banans målnivå. Ren kod; körs som kartjobb i utskriftsarbetaren.
 */
const RANK_NAMES: Readonly<Record<LevelRank, string>> = { 0: "GRON", 1: "VIT", 2: "GUL", 3: "ORANGE", 4: "VIOLETT", 5: "BLA/SVART" };
const LEVEL_RANK: Readonly<Record<CourseLevel, LevelRank>> = { GRON: 0, VIT: 1, GUL: 2, ORANGE: 3, VIOLETT: 4, BLA: 5, SVART: 5 };
/** Högst så många sträckor räknas i ett jobb (vägvalen tar tid). */
export const LEVEL_MAX_LEGS = 60;

export interface CourseLevelSummary {
  readonly courseId: string; readonly name: string;
  readonly target: CourseLevel | null;
  /** Ungefär var banan ligger: medianen och 85:e percentilen av kontroller och sträckor. */
  readonly measured: { readonly typical: string; readonly low: string; readonly high: string } | null;
  readonly harderThanTarget: { readonly controls: number; readonly legs: number } | null;
  readonly controls: readonly { readonly controlId: string; readonly code: string | null; readonly level: string; readonly rule: string | null;
    readonly values: Readonly<Record<string, number>>; readonly deviation: string | null }[];
  readonly legs: readonly { readonly fromControlId: string; readonly toControlId: string; readonly from: string; readonly to: string;
    readonly level: string; readonly rule: string | null; readonly values: Readonly<Record<string, number>>; readonly deviation: string | null;
    readonly bestMeters: number | null; readonly straightMeters: number }[];
  readonly skipped?: "SPRINT" | "SCORE" | "TOO_MANY_LEGS" | undefined;
}

function legInputOf(document: CourseSettingDocument, from: string, to: string, course: string): LegInput | undefined {
  const start = document.controls[from], end = document.controls[to];
  if (!start || !end) return undefined;
  const barriers = routeBarriers(document, course);
  const has = barriers.areas.length + barriers.lines.length + barriers.openings.length > 0;
  return { key: `${from}-${to}`, from: start.at, to: end.at, ...(has ? { barriers } : {}) };
}

const label = (document: CourseSettingDocument, id: string) => { const control = document.controls[id]; return control?.code ?? control?.kind ?? id; };

/** Mätningarna för banorna (eller en bana). Sprintkartor och poängbanor bedöms inte (ingen färgskala, ingen ordning). */
export function measureCourseLevels(map: ParsedMap, document: CourseSettingDocument, settings: RouteChoiceSettings, courseId?: string): CourseLevelSummary[] {
  const courses = document.courses.filter(course => !courseId || course.id === courseId).sort((a, b) => a.order - b.order);
  const sprint = (map.scale > 0 && map.scale <= 5000) || (document.event.overprintStandard === "ISSPROM2019" && document.event.mapScale <= 5000);
  const empty = (course: typeof courses[number], skipped: CourseLevelSummary["skipped"]): CourseLevelSummary => ({ courseId: course.id, name: course.name,
    target: course.level && isCourseLevel(course.level) ? course.level : suggestedCourseLevel(course) ?? null, measured: null, harderThanTarget: null,
    controls: [], legs: [], skipped });
  if (sprint) return courses.map(course => empty(course, "SPRINT"));
  const model = buildCostModel(map, settings);
  const prepared = prepareLevelMap(map);
  const known = new Map<string, { features: LegLevelFeatures | undefined; best: number | undefined; straight: number }>();
  return courses.map(course => {
    if (course.kind === "SCORE") return empty(course, "SCORE");
    const pairs = levelLegPairs(document, course.id);
    if (pairs.length > LEVEL_MAX_LEGS) return empty(course, "TOO_MANY_LEGS");
    const legs: LegLevelFeatures[] = [];
    const measured = new Map<string, { best: number | undefined; straight: number }>();
    for (const { from, to } of pairs) {
      const input = legInputOf(document, from, to, course.id);
      if (!input) continue;
      const cacheKey = `${input.key}|${JSON.stringify(input.barriers ?? null)}`;
      let leg = known.get(cacheKey);
      if (!leg) {
        const analysis = analyseLeg(model, { ...input, follow: true }, settings);
        leg = { best: analysis.best?.meters, straight: analysis.straightMeters,
          features: legFeatures(prepared, { key: input.key, from, to, best: analysis.best?.points, followRatio: analysis.following?.timeRatio,
            alternatives: analysis.alternatives.map(alternative => alternative.timeRatio) }) };
        known.set(cacheKey, leg);
      }
      measured.set(`${from}>${to}`, { best: leg.best, straight: leg.straight });
      if (leg.features) legs.push({ ...leg.features, from, to });
    }
    const controls = levelControls(document, course.id).map(control => controlFeatures(prepared, control));
    const assessment = assessLevel(controls, legs);
    const target = course.level && isCourseLevel(course.level) ? course.level : suggestedCourseLevel(course) ?? null;
    const deviations = target ? levelDeviations(assessment, target) : [];
    const deviationOf = (kind: "control" | "leg", key: string) => {
      const row = deviations.find(item => item.kind === kind && (kind === "control" ? item.control === key : `${item.from}>${item.to}` === key));
      return row ? `${row.deviation.direction}:${row.deviation.rule}` : null;
    };
    return {
      courseId: course.id, name: course.name, target,
      measured: { typical: RANK_NAMES[assessment.typical], low: RANK_NAMES[assessment.low], high: RANK_NAMES[assessment.high] },
      harderThanTarget: target ? harderThan(assessment, LEVEL_RANK[target]) : null,
      controls: assessment.controls.map(item => ({ controlId: item.features.control, code: document.controls[item.features.control]?.code ?? null,
        level: RANK_NAMES[item.verdict.rank], rule: item.verdict.rule ?? null, values: { ...item.verdict.values },
        deviation: deviationOf("control", item.features.control) })),
      legs: assessment.legs.map(item => {
        const from = item.features.from, to = item.features.to;
        const lengths = measured.get(`${from}>${to}`);
        return { fromControlId: from, toControlId: to, from: label(document, from), to: label(document, to), level: RANK_NAMES[item.verdict.rank],
          rule: item.verdict.rule ?? null, values: { ...item.verdict.values }, deviation: deviationOf("leg", `${from}>${to}`),
          bestMeters: lengths?.best !== undefined ? Math.round(lengths.best) : null, straightMeters: Math.round(lengths?.straight ?? 0) };
      })
    };
  });
}
