/**
 * Banornas länkade listor: kontrollerna i ordning, sträckorna och varianterna med koder. Logiken är portad från Purple
 * Pens QueryEvent.cs (EnumCourseControlsToJoin, EnumLegs, GetVariantCodeMapping, GetVariations, GetAllVariations; BSD,
 * Peter Golde), så att koderna blir exakt desamma som i Purple Pens IOF-export.
 */
import type { Point } from "@o-tid/map-file";
import { invalid, legKey } from "./ppen-common";
import type { Course, CourseControl, CourseSettingDocument } from "./types";
import { CourseSettingEditError } from "./types";

export function findCourse(document: CourseSettingDocument, courseId: string): Course {
  const course = document.courses.find(candidate => candidate.id === courseId);
  if (!course) throw new CourseSettingEditError("NOT_FOUND", `Banan ${courseId} finns inte`);
  return course;
}

function courseControl(document: CourseSettingDocument, id: string): CourseControl {
  const found = document.courseControls[id];
  if (!found) throw invalid(`banans kontroll ${id} finns inte`);
  return found;
}

/** Skydd mot länkar som går runt i cirkel (en trasig fil får inte hänga webbläsaren). */
function guard(document: CourseSettingDocument): () => void {
  let steps = 0;
  const limit = 20 * (Object.keys(document.courseControls).length + 5);
  return () => {
    if (++steps > limit) throw invalid("en bana tar aldrig slut (länkarna går runt)");
  };
}

/**
 * Banans kontroller i ordning. Med `choices` (en variants val vid varje gaffling/slinga) följs den varianten, annars
 * tas alla grenar med i den ordning Purple Pen ritar dem.
 */
export function enumerateCourseControls(document: CourseSettingDocument, courseId: string, choices: readonly string[] | null = null): string[] {
  const course = findCourse(document, courseId);
  const out: string[] = [];
  const state = { choices: choices ?? [], index: 0, step: guard(document) };
  toJoin(document, course.first, undefined, state, false, out);
  return out;
}

interface WalkState { readonly choices: readonly string[]; index: number; readonly step: () => void }

function toJoin(document: CourseSettingDocument, start: string | undefined, join: string | undefined, state: WalkState, ignoreFirstSplit: boolean, out: string[]): void {
  let next = start;
  let first = true;
  while (next !== undefined && next !== join) {
    state.step();
    let current = courseControl(document, next);
    const split = current.split;
    if (split && !(first && ignoreFirstSplit)) {
      if (state.index < state.choices.length) {
        const choice = state.choices[state.index++]!;
        if (!split.branches.includes(choice)) throw new CourseSettingEditError("INVALID", `Varianten väljer ${choice} som inte är en gren`);
        next = choice;
        current = courseControl(document, next);
      } else {
        for (const branch of split.branches) if (branch !== next) toJoin(document, branch, split.end, state, true, out);
        if (split.kind === "FORK") {
          toJoin(document, next, split.end, state, true, out);
          next = split.end;
          if (next === join) break;
          continue;
        }
      }
    }
    out.push(next);
    next = current.next;
    first = false;
  }
}

/** Sträckorna som par av banans kontroller (EnumLegs). Poängbanor har inga sträckor. */
export function enumerateLegs(document: CourseSettingDocument, courseId: string, choices: readonly string[] | null = null): [string, string][] {
  if (findCourse(document, courseId).kind === "SCORE") return [];
  const legs: [string, string][] = [];
  for (const id of enumerateCourseControls(document, courseId, choices)) {
    const next = document.courseControls[id]?.next;
    if (next !== undefined) legs.push([id, next]);
  }
  return legs;
}

/** Bokstaven för varje grens första banans kontroll; slingans utgång får ingen bokstav (GetVariantCodeMapping). */
export function variantLetters(document: CourseSettingDocument, courseId: string): Map<string, string> {
  const letters = new Map<string, string>();
  let next = "A".charCodeAt(0);
  for (const id of enumerateCourseControls(document, courseId)) {
    const split = document.courseControls[id]?.split;
    if (!split) continue;
    split.branches.forEach((branch, index) => {
      if (split.kind === "LOOP" && index === 0) return;
      if (letters.has(branch)) return;
      letters.set(branch, String.fromCharCode(next));
      next = next === "Z".charCodeAt(0) ? "a".charCodeAt(0) : next + 1;
    });
  }
  return letters;
}

export interface Variation { readonly code: string; readonly choices: readonly string[] }

/** Alla varianter, sorterade på koden som Purple Pen (GetAllVariations). Ogafflad bana: tom lista. */
export function variations(document: CourseSettingDocument, courseId: string): Variation[] {
  const course = findCourse(document, courseId);
  if (course.kind === "SCORE") return [];
  const letters = variantLetters(document, courseId);
  const paths = variationPaths(document, course.first, new Set(), guard(document));
  if (paths.length === 1 && paths[0]!.length === 0) return [];
  const result = paths.map(choices => ({ code: choices.map(choice => letters.get(choice) ?? "").join(""), choices }));
  return stableSort(result, (a, b) => compareOrdinalIgnoreCase(a.code, b.code));
}

function variationPaths(document: CourseSettingDocument, start: string | undefined, visited: Set<string>, step: () => void): string[][] {
  const result: string[][] = [];
  let next = start;
  while (next !== undefined) {
    step();
    const current = courseControl(document, next);
    const split = current.split;
    if (split) {
      // En slinga får gå ut först när alla varv är gjorda.
      let allLoopsVisited = true;
      if (split.kind === "LOOP") for (let i = 1; i < split.branches.length; i++) if (!visited.has(split.branches[i]!)) allLoopsVisited = false;
      for (let i = allLoopsVisited ? 0 : 1; i < split.branches.length; i++) {
        const branch = split.branches[i]!;
        const afterSplit = courseControl(document, branch).next;
        if (afterSplit !== undefined && !visited.has(branch)) {
          visited.add(branch);
          const tails = variationPaths(document, afterSplit, visited, step);
          visited.delete(branch);
          for (const tail of tails) result.push([branch, ...tail]);
        }
      }
      break;
    }
    next = current.next;
  }
  if (result.length === 0) result.push([]);
  return result;
}

/** Som .NET:s OrdinalIgnoreCase: jämför tecknens koder efter versalisering. */
function compareOrdinalIgnoreCase(a: string, b: string): number {
  const x = a.toUpperCase();
  const y = b.toUpperCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

function stableSort<T>(items: T[], compare: (a: T, b: T) => number): T[] {
  return items.map((item, index) => ({ item, index }))
    .sort((a, b) => compare(a.item, b.item) || a.index - b.index)
    .map(entry => entry.item);
}

/** Sträckans linje i kartans mm: från kontrollens mitt via brytpunkterna till nästa kontrolls mitt. */
export function legPath(document: CourseSettingDocument, fromControl: string, toControl: string): Point[] {
  const from = document.controls[fromControl];
  const to = document.controls[toControl];
  if (!from || !to) throw invalid(`sträckan ${fromControl}–${toControl} saknar kontroll`);
  const bends = document.legs[legKey(fromControl, toControl)]?.bends ?? [];
  return [from.at, ...bends, to.at];
}

export function pathLength(points: readonly Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return length;
}

/** Längden i meter för en variant (eller alla grenar) med kartans skala (QueryEvent.ComputeLegLength). */
export function measuredLengthMeters(document: CourseSettingDocument, courseId: string, choices: readonly string[] | null): number {
  let mm = 0;
  for (const [a, b] of enumerateLegs(document, courseId, choices)) {
    mm += pathLength(legPath(document, document.courseControls[a]!.control, document.courseControls[b]!.control));
  }
  return mm * document.event.mapScale / 1000;
}
