/**
 * ADR-0217 beslut 8: sparade lägen. Ett läge är en namngiven ögonblicksbild av allt i Layout-fliken: layouterna, arken
 * (huvudlayoutens tryckytor och papper och de andra layouternas ark med justeringar), klassernas val, mallarna och
 * färgprofilen (vald profil och tävlingens egna profiler). Banorna ingår inte. "Återställ" är en vanlig ändring (kan ångras) och
 * "Jämför" säger vad som skiljer.
 */
import type { SheetLayout } from "./sheet-layout";
import type { CoursePaperLayout, PaperTemplate } from "./paper-items";
import type { PrintProfile } from "./print-profile";
import { MAIN_LAYOUT, type LayoutSheet, type MainLayoutSettings, type PrintLayout } from "./print-layouts";
import type { CourseSettingDocument, PrintArea } from "./types";

export interface LayoutStateAreas {
  readonly printArea?: PrintArea | undefined;
  readonly partPrintAreas?: Readonly<Record<string, PrintArea>> | undefined;
}

export interface LayoutState {
  readonly id: string;
  readonly name: string;
  /** När läget sparades (ISO). */
  readonly savedAt: string;
  /** PPEN = gjort automatiskt när en .ppen lästes in ("Från Purple Pen"). */
  readonly source?: "PPEN" | undefined;
  readonly layouts?: readonly PrintLayout[] | undefined;
  readonly layoutSheets?: Readonly<Record<string, Readonly<Record<string, LayoutSheet>>>> | undefined;
  readonly classLayouts?: Readonly<Record<string, string>> | undefined;
  readonly mainLayout?: MainLayoutSettings | undefined;
  readonly paperLayouts?: Readonly<Record<string, CoursePaperLayout>> | undefined;
  readonly paperTemplates?: readonly PaperTemplate[] | undefined;
  readonly layoutTemplates?: readonly SheetLayout[] | undefined;
  /** Huvudlayoutens tryckytor per bana (alla banor som fanns; tomt = automatisk) och Alla kontrollers. */
  readonly mainAreas: Readonly<Record<string, LayoutStateAreas>>;
  readonly allControlsArea?: PrintArea | undefined;
  readonly printProfileId?: string | undefined;
  /** Tävlingens egna profiler (kopiorna med besluten; de färdiga ändras aldrig). */
  readonly printProfiles?: readonly PrintProfile[] | undefined;
}

/** Händelsens fält som ett läge sätter (saknas i läget = tas bort). */
export const STATE_EVENT_FIELDS = ["layouts", "layoutSheets", "classLayouts", "mainLayout", "paperLayouts", "paperTemplates", "layoutTemplates"] as const;

/** Läget för dokumentet som det är nu. */
export function snapshotLayoutState(document: CourseSettingDocument, meta: { id: string; name: string; savedAt: string; source?: "PPEN" | undefined }): LayoutState {
  const event = document.event;
  const fields = Object.fromEntries(STATE_EVENT_FIELDS.flatMap(key => event[key] !== undefined ? [[key, event[key]]] : []));
  const mainAreas = Object.fromEntries(document.courses.map(course => [course.id, {
    ...(course.printArea ? { printArea: course.printArea } : {}), ...(course.partPrintAreas ? { partPrintAreas: course.partPrintAreas } : {}) }]));
  return { id: meta.id, name: meta.name, savedAt: meta.savedAt, ...(meta.source ? { source: meta.source } : {}), ...fields, mainAreas,
    ...(event.printArea ? { allControlsArea: event.printArea } : {}), ...(event.printProfileId ? { printProfileId: event.printProfileId } : {}),
    ...(event.printProfiles && event.printProfiles.length > 0 ? { printProfiles: event.printProfiles } : {}) };
}

/** Dokumentet med läget återställt. Banor som inte fanns när läget sparades rörs inte; övriga profiler står kvar. */
export function restoreLayoutState(document: CourseSettingDocument, state: LayoutState): CourseSettingDocument {
  const event: Record<string, unknown> = { ...document.event };
  for (const key of STATE_EVENT_FIELDS) {
    if (state[key] !== undefined) event[key] = state[key];
    else delete event[key];
  }
  if (state.allControlsArea) event.printArea = state.allControlsArea;
  else delete event.printArea;
  if (state.printProfileId) event.printProfileId = state.printProfileId;
  // Lägets egna profiler som de var; profiler som gjorts efter läget står kvar.
  if (state.printProfiles && state.printProfiles.length > 0) {
    const saved = new Map(state.printProfiles.map(profile => [profile.id, profile]));
    const current = document.event.printProfiles ?? [];
    event.printProfiles = [...current.map(profile => saved.get(profile.id) ?? profile),
      ...state.printProfiles.filter(profile => !current.some(item => item.id === profile.id))];
  }
  const courses = document.courses.map(course => {
    const areas = state.mainAreas[course.id];
    if (!areas) return course;
    const rest = { ...course };
    delete rest.printArea; delete rest.partPrintAreas;
    return { ...rest, ...(areas.printArea ? { printArea: areas.printArea } : {}), ...(areas.partPrintAreas ? { partPrintAreas: areas.partPrintAreas } : {}) };
  });
  return { ...document, courses, event: event as CourseSettingDocument["event"] };
}

export type LayoutStateDifference =
  | { readonly kind: "LAYOUT"; readonly layout: string; readonly name: string; readonly change: "ADDED" | "REMOVED" | "CHANGED" }
  | { readonly kind: "SHEET"; readonly layout: string; readonly course: string }
  | { readonly kind: "CLASS"; readonly className: string; readonly from: string; readonly to: string }
  | { readonly kind: "TEMPLATES" }
  | { readonly kind: "PROFILE" };

const same = (a: unknown, b: unknown) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
function sorted(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sorted);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, sorted(item)]));
}

/**
 * Vad som skiljer läget från dokumentet: layouter (nya, borttagna, ändrade), ark (huvudlayoutens tryckyta och papper per
 * bana, de andra layouternas ark), klassernas layout, mallarna och färgprofilen. "Nu" är dokumentet, "förut" läget.
 */
export function compareLayoutState(document: CourseSettingDocument, state: LayoutState): LayoutStateDifference[] {
  const now = snapshotLayoutState(document, { id: state.id, name: state.name, savedAt: state.savedAt });
  const out: LayoutStateDifference[] = [];
  const before = new Map((state.layouts ?? []).map(layout => [layout.id, layout]));
  const after = new Map((now.layouts ?? []).map(layout => [layout.id, layout]));
  if (!same(state.mainLayout, now.mainLayout)) out.push({ kind: "LAYOUT", layout: MAIN_LAYOUT, name: now.mainLayout?.name ?? "", change: "CHANGED" });
  for (const [id, layout] of after) {
    const old = before.get(id);
    if (!old) out.push({ kind: "LAYOUT", layout: id, name: layout.name, change: "ADDED" });
    else if (!same(old, layout)) out.push({ kind: "LAYOUT", layout: id, name: layout.name, change: "CHANGED" });
  }
  for (const [id, layout] of before) if (!after.has(id)) out.push({ kind: "LAYOUT", layout: id, name: layout.name, change: "REMOVED" });
  // Huvudlayoutens ark: tryckytan och papperet (banan och dess delar).
  const courses = new Set([...Object.keys(state.mainAreas), ...Object.keys(now.mainAreas)]);
  const paperKeys = (layouts: LayoutState["paperLayouts"], course: string) => Object.entries(layouts ?? {}).filter(([key]) => key === course || key.startsWith(`${course}#`));
  for (const course of ["ALL_CONTROLS", ...courses]) {
    const areas = course === "ALL_CONTROLS" ? [state.allControlsArea, now.allControlsArea] : [state.mainAreas[course], now.mainAreas[course]];
    if (course !== "ALL_CONTROLS" && (!state.mainAreas[course] || !now.mainAreas[course])) continue;
    if (!same(areas[0], areas[1]) || !same(paperKeys(state.paperLayouts, course), paperKeys(now.paperLayouts, course))) {
      out.push({ kind: "SHEET", layout: MAIN_LAYOUT, course });
    }
  }
  for (const layout of new Set([...Object.keys(state.layoutSheets ?? {}), ...Object.keys(now.layoutSheets ?? {})])) {
    const a = state.layoutSheets?.[layout] ?? {}, b = now.layoutSheets?.[layout] ?? {};
    for (const course of new Set([...Object.keys(a), ...Object.keys(b)])) if (!same(a[course], b[course])) out.push({ kind: "SHEET", layout, course });
  }
  const classes = new Set([...Object.keys(state.classLayouts ?? {}), ...Object.keys(now.classLayouts ?? {})]);
  for (const className of [...classes].sort((a, b) => a.localeCompare(b, "sv-SE"))) {
    const from = state.classLayouts?.[className] ?? MAIN_LAYOUT, to = now.classLayouts?.[className] ?? MAIN_LAYOUT;
    if (from !== to) out.push({ kind: "CLASS", className, from, to });
  }
  if (!same(state.paperTemplates, now.paperTemplates) || !same(state.layoutTemplates, now.layoutTemplates)) out.push({ kind: "TEMPLATES" });
  const ownBefore = new Map((state.printProfiles ?? []).map(profile => [profile.id, profile]));
  const profileChanged = [...ownBefore].some(([id, profile]) => !same(profile, (now.printProfiles ?? []).find(item => item.id === id)));
  if (state.printProfileId !== now.printProfileId || profileChanged) out.push({ kind: "PROFILE" });
  return out;
}
