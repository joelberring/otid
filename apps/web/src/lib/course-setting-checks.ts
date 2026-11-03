import {
  checkAcceptable, checkKey, checkLevel, forbiddenLegs, isAccepted, type CheckLevel, type CheckOptions, type CourseCheck, type CourseSettingDocument
} from "@o-tid/course-setting";
import type { LegAnalysis, LegInput } from "@o-tid/route-choice";
import { courseSettingSv as text } from "../i18n/course-setting-sv";
import type { LegLength } from "./course-setting-route-length";
import { controlLabel, legInput } from "./course-setting-text";

/**
 * ADR-0199: fliken Varningar som rader. Samma fysiska sträcka eller kontroll på flera banor och varianter blir en rad
 * ("A, B, C: sträckan …") med samma nyckel; godta gäller då alla. Raderna grupperas per sort med fel först, sedan
 * varningar och notiser. Fliken räknar bara fel och varningar som inte är godtagna. Ren logik.
 */
export interface CheckRow {
  /** Nyckeln för att godta (`checkKey`); unik per nivå. */
  readonly key: string;
  readonly group: string;
  readonly level: CheckLevel;
  readonly acceptable: boolean;
  readonly accepted: boolean;
  readonly text: string;
  /** Kontrollerna att markera. */
  readonly controls: readonly string[];
  /** Banan att visa (den första i banornas ordning; saknas för det som gäller alla kontroller). */
  readonly course?: string | undefined;
  /** Sträckan att välja på kartan. */
  readonly leg?: { readonly from: string; readonly to: string } | undefined;
  /** Kontrollerna bakom raden (för att godta). */
  readonly checks: readonly CourseCheck[];
}

export interface CheckGroup {
  readonly id: string;
  readonly level: CheckLevel;
  readonly heading: string;
  readonly rows: readonly CheckRow[];
}

const GROUP_ORDER = ["LEG_NO_ROUTE", "CONTROL_IN_FORBIDDEN", "DUPLICATE_CODE", "MISSING_CODE", "COURSE_WITHOUT_START_OR_FINISH",
  "CONTROLS_TOO_CLOSE", "LEG_THROUGH_CONTROL", "SAME_CONTROL_TWICE_IN_ROW", "INVERTIBLE_CODE",
  "LEG_THROUGH_FORBIDDEN", "CONTROLS_NEAR", "UNUSED_CONTROL"];
const LEVELS: readonly CheckLevel[] = ["ERROR", "WARNING", "NOTICE"];

function groupOf(check: CourseCheck, level: CheckLevel): string {
  if (check.kind === "CONTROLS_TOO_CLOSE" && level === "NOTICE") return "CONTROLS_NEAR";
  return checkKey(check).split("/")[0]!;
}

const forbiddenWhat = (document: CourseSettingDocument, special: string) => {
  const kind = document.specialObjects.find(item => item.id === special)?.kind ?? "out-of-bounds";
  return text.checks.forbidden[kind] ?? kind;
};

function rowText(document: CourseSettingDocument, check: CourseCheck, courses: string): string {
  const label = (control: string) => controlLabel(document, control);
  switch (check.kind) {
    case "CONTROLS_TOO_CLOSE": return text.checks.CONTROLS_TOO_CLOSE(label(check.controls[0]), label(check.controls[1]), check.meters, check.limitMeters, check.feature);
    case "DUPLICATE_CODE": return text.checks.DUPLICATE_CODE(check.code, check.controls.length);
    case "INVERTIBLE_CODE": return text.checks.INVERTIBLE_CODE(check.code);
    case "SAME_CONTROL_TWICE_IN_ROW": return text.checks.SAME_CONTROL_TWICE_IN_ROW(courses, label(check.control));
    case "LEG_THROUGH_CONTROL": return text.checks.LEG_THROUGH_CONTROL(courses, label(check.from), label(check.to), label(check.control));
    case "LEG_THROUGH_FORBIDDEN": return check.route === "NO_ROUTE"
      ? text.checks.LEG_NO_ROUTE(courses, label(check.from), label(check.to), forbiddenWhat(document, check.special))
      : text.checks.LEG_THROUGH_FORBIDDEN(courses, label(check.from), label(check.to), forbiddenWhat(document, check.special));
    case "CONTROL_IN_FORBIDDEN": return text.checks.CONTROL_IN_FORBIDDEN(label(check.control), forbiddenWhat(document, check.special));
    case "COURSE_WITHOUT_START_OR_FINISH": return text.checks.COURSE_WITHOUT_START_OR_FINISH(courses);
    case "UNUSED_CONTROL": return text.checks.UNUSED_CONTROL(label(check.control));
    case "MISSING_CODE": return text.checks.MISSING_CODE(label(check.control));
  }
}

function controlsOf(check: CourseCheck): string[] {
  switch (check.kind) {
    case "CONTROLS_TOO_CLOSE": case "DUPLICATE_CODE": return [...check.controls];
    case "LEG_THROUGH_CONTROL": return [check.from, check.to, check.control];
    case "LEG_THROUGH_FORBIDDEN": return [check.from, check.to];
    case "COURSE_WITHOUT_START_OR_FINISH": return [];
    default: return [check.control];
  }
}

/** Raderna: en per nyckel och nivå, med banorna i banornas ordning. */
export function checkRows(document: CourseSettingDocument, checks: readonly CourseCheck[]): CheckRow[] {
  const order = new Map([...document.courses].sort((a, b) => a.order - b.order).map((course, index) => [course.id, index]));
  const merged = new Map<string, { level: CheckLevel; key: string; checks: CourseCheck[]; courses: Set<string> }>();
  for (const check of checks) {
    const level = checkLevel(check), key = checkKey(check);
    const id = `${level}|${key}`;
    const entry = merged.get(id) ?? { level, key, checks: [], courses: new Set<string>() };
    entry.checks.push(check);
    if ("course" in check) entry.courses.add(check.course);
    merged.set(id, entry);
  }
  const rows: CheckRow[] = [];
  for (const { level, key, checks: list, courses } of merged.values()) {
    const first = list[0]!;
    const sorted = [...courses].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
    const names = sorted.map(id => document.courses.find(course => course.id === id)?.name ?? id).join(", ");
    rows.push({ key, level, group: groupOf(first, level), acceptable: checkAcceptable(first), accepted: isAccepted(document, first),
      text: rowText(document, first, names), controls: controlsOf(first), course: sorted[0],
      leg: first.kind === "LEG_THROUGH_FORBIDDEN" || first.kind === "LEG_THROUGH_CONTROL" ? { from: first.from, to: first.to } : undefined,
      checks: list });
  }
  return rows;
}

/** Grupperna att visa (fel, varningar, notiser), de godtagna och antalet för fliken (fel och varningar). */
export function checkGroups(rows: readonly CheckRow[]): { groups: CheckGroup[]; accepted: CheckRow[]; count: number } {
  const open = rows.filter(row => !row.accepted);
  const groups: CheckGroup[] = [];
  for (const level of LEVELS) {
    const ids = [...new Set(open.filter(row => row.level === level).map(row => row.group))]
      .sort((a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
    for (const id of ids) groups.push({ id: `${level}:${id}`, level, heading: text.checks.groups[id] ?? id, rows: open.filter(row => row.level === level && row.group === id) });
  }
  return { groups, accepted: rows.filter(row => row.accepted), count: open.filter(row => row.level !== "NOTICE").length };
}

/**
 * Sträckorna vars fågelväg korsar ett förbjudet område, som indata till vägvalen (en gång per nyckel: samma sträcka med
 * samma spärrar på flera banor räknas en gång). Poängbanor har inga sträckor.
 */
export function forbiddenRouteLegs(document: CourseSettingDocument): LegInput[] {
  const out = new Map<string, LegInput>();
  for (const course of document.courses) {
    if (course.kind === "SCORE") continue;
    for (const hit of forbiddenLegs(document, course.id)) {
      const input = legInput(document, hit.from, hit.to, [], course.id);
      if (input && !out.has(input.key)) out.set(input.key, input);
    }
  }
  return [...out.values()];
}

/** Vägvalen som räknats (samma nycklar som `legInput`) som `CheckOptions.legRoute`. */
export function legRouteLookup(document: CourseSettingDocument, results: ReadonlyMap<string, LegLength>): NonNullable<CheckOptions["legRoute"]> {
  return (course, from, to) => {
    const input = legInput(document, from, to, [], course);
    const result = input ? results.get(input.key) : undefined;
    return result ? { reachable: result.best !== undefined } : undefined;
  };
}

/** Vald sträckas rad i vägvalspanelen när fågelvägen korsar ett förbjudet område (information, ingen varning). */
export function legForbiddenNotice(document: CourseSettingDocument, course: string, from: string, to: string, analysis: LegAnalysis | undefined): string | undefined {
  if (!analysis || !document.courses.some(item => item.id === course)) return undefined;
  const hit = forbiddenLegs(document, course).find(item => item.from === from && item.to === to);
  if (!hit) return undefined;
  const what = forbiddenWhat(document, hit.special);
  return analysis.best ? text.leg.aroundForbidden(what, analysis.best.meters - analysis.straightMeters) : text.leg.noRouteForbidden(what);
}
