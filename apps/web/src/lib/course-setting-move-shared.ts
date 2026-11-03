import { courseControlOrder, nextFreeCode, type CourseSettingDocument, type CourseSettingEdit } from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { ALL_CONTROLS } from "./course-setting-hit";

/**
 * Frågan när en delad kontroll flyttas långt i en bana (som Purple Pens MoveControlChoiceDialog): flytta i alla banor,
 * en ny kontroll bara i den här banan, eller avbryt. Bara vanliga kontroller (Purple Pen frågar inte för start, mål,
 * passage eller kartbyte): de har ingen kod och flyttas där de står för alla. Gränsen är som Purple Pens 50 m i terrängen
 * (inställbar i webbläsaren).
 */
export const DEFAULT_MOVE_THRESHOLD_M = 50;
export const MOVE_THRESHOLD_CHOICES = [10, 20, 30, 50, 100] as const;

export type MoveChoice = "ALL" | "NEW";

export interface SharedMove {
  readonly control: string;
  readonly code: string;
  readonly course: string;
  readonly courseName: string;
  readonly at: Point;
  readonly meters: number;
  /** De andra banorna som har kontrollen, i banlistans ordning. */
  readonly otherCourses: readonly string[];
  /** Banans kontroller som byts mot den nya. */
  readonly courseControls: readonly string[];
  /** Antal gånger kontrollen finns på banan. */
  readonly occurrences: number;
  /** Koden som den nya kontrollen får. */
  readonly newCode: string;
}

/** Avståndet i meter i terrängen (punkterna är mm på kartan). */
export function metersBetween(document: CourseSettingDocument, a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y) * document.event.mapScale / 1000;
}

function safeOrder(document: CourseSettingDocument, course: string, variant?: string): readonly string[] {
  try { return courseControlOrder(document, course, variant); } catch { return []; }
}

/**
 * Vilka av banans förekomster som byts. En förekomst som går att peka ut byts ensam: i en variant som bara visar den
 * (gaffling där kontrollen finns i flera grenar). En fjärilskontroll (slingans mitt eller samma kontroll flera gånger i
 * följd) ritas som en ring, så alla förekomster byts; slingans grenar är samma punkt.
 */
export function occurrencesToReplace(document: CourseSettingDocument, course: string, control: string, dragged?: string, variant?: string): string[] {
  const all = [...new Set(safeOrder(document, course))].filter(id => document.courseControls[id]?.control === control);
  if (all.length <= 1 || dragged === undefined || !all.includes(dragged)) return all;
  const split = document.courseControls[dragged]?.split;
  const group = new Set([dragged, ...(split?.kind === "LOOP" ? split.branches.filter(id => all.includes(id)) : [])]);
  // Utan variant ritas alla förekomster i samma ring: de går inte att skilja åt.
  if (variant === undefined) return all;
  const shown = new Set(safeOrder(document, course, variant));
  const visible = all.filter(id => shown.has(id));
  return visible.length > 0 && visible.every(id => group.has(id)) ? [...group] : all;
}

/**
 * Frågan för en flytt (undefined = ingen fråga): i en bana, vanlig kontroll, mer än `thresholdM` meter och kontrollen finns
 * i någon annan bana. `from` = läget innan dragningen började.
 */
export function sharedMoveQuestion(document: CourseSettingDocument, input: { view: string; control: string; from: Point; at: Point;
  courseControl?: string | undefined; variant?: string | undefined; thresholdM: number }): SharedMove | undefined {
  const { view, control, from, at } = input;
  if (view === ALL_CONTROLS) return undefined;
  const point = document.controls[control];
  const course = document.courses.find(row => row.id === view);
  if (!point || !course || point.kind !== "NORMAL") return undefined;
  const meters = metersBetween(document, from, at);
  // Mer än gränsen i hela meter: en flytt på precis 50 m frågar inte (musens halva pixlar avgör inte).
  if (Math.round(meters) <= input.thresholdM) return undefined;
  const courseControls = occurrencesToReplace(document, view, control, input.courseControl, input.variant);
  if (courseControls.length === 0) return undefined;
  const otherCourses = [...document.courses].sort((a, b) => a.order - b.order)
    .filter(row => row.id !== view && safeOrder(document, row.id).some(id => document.courseControls[id]?.control === control))
    .map(row => row.name);
  if (otherCourses.length === 0) return undefined;
  const occurrences = new Set(safeOrder(document, view).filter(id => document.courseControls[id]?.control === control)).size;
  return { control, code: point.code ?? "?", course: view, courseName: course.name, at, meters, otherCourses, courseControls, occurrences,
    newCode: nextFreeCode(document) };
}

/** Åtgärden för valet "Ny kontroll bara i banan". */
export function newControlEdit(question: SharedMove): CourseSettingEdit {
  return { type: "NEW_CONTROL_IN_COURSE", course: question.course, control: question.control, at: question.at,
    courseControls: [...question.courseControls], code: question.newCode };
}

/** Banornas namn för frågan, förkortad: "A, B, C och 4 till". */
export function courseNameList(names: readonly string[], max = 4): string {
  if (names.length <= max) return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} och ${names.at(-1)}`;
  return `${names.slice(0, max - 1).join(", ")} och ${names.length - (max - 1)} till`;
}

const THRESHOLD_KEY = "otid.banlaggning.flyttgrans";
const REMEMBER_KEY = "otid.banlaggning.flyttval";

/** Gränsen i meter (webbläsarens inställning, annars Purple Pens 50 m). */
export function readMoveThreshold(storage: Storage | undefined): number {
  try {
    const value = Number(storage?.getItem(THRESHOLD_KEY));
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_MOVE_THRESHOLD_M;
  } catch { return DEFAULT_MOVE_THRESHOLD_M; }
}

export function writeMoveThreshold(storage: Storage | undefined, meters: number): void {
  try { storage?.setItem(THRESHOLD_KEY, String(meters)); } catch (error) { console.info("Flyttgränsen sparades inte i webbläsaren", error); }
}

/** "Kom ihåg för den här sessionen": valet per tävling i flikens session. */
export function readRememberedChoice(storage: Storage | undefined, raceId: string): MoveChoice | undefined {
  try {
    const value = storage?.getItem(`${REMEMBER_KEY}.${raceId}`);
    return value === "ALL" || value === "NEW" ? value : undefined;
  } catch { return undefined; }
}

export function writeRememberedChoice(storage: Storage | undefined, raceId: string, choice: MoveChoice | undefined): void {
  try {
    if (choice) storage?.setItem(`${REMEMBER_KEY}.${raceId}`, choice); else storage?.removeItem(`${REMEMBER_KEY}.${raceId}`);
  } catch (error) { console.info("Valet för flyttade kontroller sparades inte i webbläsaren", error); }
}

/** Flikens session ("Kom ihåg") och webbläsarens lagring (gränsen); saknas eller blockerad = undefined. */
export function sessionStore(): Storage | undefined {
  try { return typeof window === "undefined" ? undefined : window.sessionStorage; } catch { return undefined; }
}

export function localStore(): Storage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}
