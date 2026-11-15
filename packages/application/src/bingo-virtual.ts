import type { BingoLeaderboard, VirtualCourseView, VirtualSettings } from "@o-tid/contracts";
import { courseControlOrder, type CourseSettingDocument } from "@o-tid/course-setting";
import type { schema } from "@o-tid/database";
import {
  duelPoints, duelScores, judgePunches, VIRTUAL_RULES, virtualResult, type JudgedPunch, type VirtualCourse, type VirtualPunch
} from "@o-tid/domain";

/**
 * Virtuella kontroller (ADR-0226) på bingons grund: banorna ur banläggningens dokument (kontrollerna i banans ordning med
 * läget i kartans mm), träningens inställningar och topplistan med dueller. Servern räknar om allt ur stämplingarna med
 * reglerna i `@o-tid/domain`.
 */
type RunnerRow = typeof schema.bingoRunners.$inferSelect;

/** Träningens inställningar med förvalen (radie 25 m, automatisk stämpling, 10 poäng per kontroll i duellen). */
export function virtualSettings(stored: { radiusM?: number; punch?: "AUTO" | "BUTTON"; points?: Record<string, number> } | null | undefined): VirtualSettings {
  return { radiusM: stored?.radiusM ?? VIRTUAL_RULES.defaultRadiusM, punch: stored?.punch ?? "AUTO", points: stored?.points ?? {} };
}

/**
 * Banorna för virtuella kontroller: alla banor med kontroller som inte är bingons grupper. Poängbana (SCORE) = valfri ordning.
 * Poängen per kontroll: ledarens värde per kod, annars banläggningens poäng, annars 10.
 */
export function virtualCourses(document: CourseSettingDocument | undefined, settings: VirtualSettings): VirtualCourseView[] {
  if (!document) return [];
  const training = document.training?.courses ?? {};
  return (document.courses ?? []).flatMap(course => {
    if (training[course.id]?.bingo) return [];
    const controls = courseControlOrder(document, course.id).flatMap(ccId => {
      const cc = document.courseControls[ccId];
      const control = cc ? document.controls[cc.control] : undefined;
      if (!cc || !control) return [];
      const kind = control.kind === "START" ? "START" as const : control.kind === "FINISH" ? "FINISH" as const : control.kind === "NORMAL" ? "CONTROL" as const : undefined;
      if (!kind) return [];
      const code = kind === "START" ? "S" : kind === "FINISH" ? "M" : control.code ?? "?";
      const points = kind === "CONTROL" ? settings.points[code] ?? cc.points ?? duelPoints(undefined, code) : 0;
      return [{ id: ccId, kind, code, x: control.at.x, y: control.at.y, points }];
    });
    if (!controls.some(control => control.kind === "CONTROL")) return [];
    return [{ course: course.id, name: course.name, order: course.kind === "SCORE" ? "SCORE" as const : "ORDERED" as const, controls }];
  });
}

const asCourse = (view: VirtualCourseView): VirtualCourse => ({ order: view.order, controls: view.controls });

/** Löparens giltiga stämplingar och resultat. */
export function virtualRunner(row: RunnerRow, course: VirtualCourseView | undefined, settings: VirtualSettings, metersPerMm: number) {
  const judged: JudgedPunch[] = course ? judgePunches(asCourse(course), row.punches as VirtualPunch[], row.startedAt.getTime(), settings.radiusM, metersPerMm) : [];
  const result = course ? virtualResult(judged, asCourse(course)) : { controls: 0, points: 0, finished: false, lastAt: null };
  const end = row.finishedAt?.getTime() ?? result.lastAt ?? row.startedAt.getTime();
  return { judged, result, seconds: Math.max(0, Math.round((end - row.startedAt.getTime()) / 1000)) };
}

/** Topplistan per bana och per duell (lagens poäng och vem som tog vilken kontroll först; inga positioner). */
export function virtualLeaderboard(rows: readonly RunnerRow[], courses: readonly VirtualCourseView[], settings: VirtualSettings, metersPerMm: number)
  : Pick<BingoLeaderboard, "groups" | "duels"> {
  const judged = new Map(rows.map(row => [row.id, virtualRunner(row, courses.find(course => course.course === row.groupCourse), settings, metersPerMm)]));
  const duelPointsOf = new Map<string, Record<string, number>>();
  const duels = [...new Set(rows.flatMap(row => row.duel ? [row.duel] : []))].sort().map(code => {
    const members = rows.filter(row => row.duel === code);
    const course = courses.find(item => item.course === members[0]!.groupCourse);
    const byId = new Map((course?.controls ?? []).map(control => [control.id, control]));
    const entries = members.map(row => ({ runner: row.name, team: row.team ?? row.name,
      punches: judged.get(row.id)!.judged.filter(punch => byId.get(punch.control)?.kind === "CONTROL").map(punch => ({ control: punch.control, at: punch.at })) }));
    const scored = duelScores(entries, control => byId.get(control)?.points ?? VIRTUAL_RULES.defaultPoints);
    duelPointsOf.set(code, scored.teams);
    return { code, course: course?.course ?? "",
      teams: Object.entries(scored.teams).map(([team, points]) => ({ team, points, runners: entries.filter(entry => entry.team === team).map(entry => entry.runner) }))
        .sort((a, b) => b.points - a.points || a.team.localeCompare(b.team, "sv")),
      taken: scored.controls.map(item => ({ ...item, code: byId.get(item.control)?.code ?? "?" })).sort((a, b) => a.at - b.at) };
  });
  const groups = courses.map(course => {
    const runners = rows.filter(row => row.groupCourse === course.course).map(row => {
      const { result, seconds } = judged.get(row.id)!;
      const duel = row.duel ? duelPointsOf.get(row.duel)?.[row.team ?? row.name] : undefined;
      return { name: row.name, cells: 0, status: row.status, seconds, distanceM: Math.round(row.distanceM), controls: result.controls, finished: result.finished,
        points: duel ?? result.points, ...(row.duel ? { duel: row.duel } : {}), ...(row.team ? { team: row.team } : {}) };
    }).sort((a, b) => Number(a.status === "ABANDONED") - Number(b.status === "ABANDONED")
      || (course.order === "SCORE" || a.duel || b.duel ? b.points - a.points : Number(b.finished) - Number(a.finished))
      || b.controls - a.controls || a.seconds - b.seconds || a.name.localeCompare(b.name, "sv"));
    return { course: course.course, name: course.name, cells: course.controls.filter(control => control.kind === "CONTROL").length, runners };
  });
  return { groups, duels };
}
