/**
 * ADR-0217 beslut 7: ändringarna i Layout-fliken. Layouter, ark (bana × layout), justeringar, klassernas layout och sparade
 * lägen; `SET_PRINT_AREA`, `SET_PAPER_LAYOUT` och `MOVE_NUMBER` med `printLayout` ändrar ett ark i en annan layout än huvudlayouten.
 * Ångra går som för andra ändringar (`objectPatch` på händelsens fält); kollaborationsnycklarna (`layoutEditTouches`) är per
 * layout, ark, kontroll, klass och läge.
 */
import { BUILT_IN_TEMPLATES } from "./layout-template";
import { validatePaperLayout, type CoursePaperLayout } from "./paper-items";
import { restoreLayoutState, snapshotLayoutState, type LayoutState } from "./print-layout-states";
import {
  courseControlIds, findPrintLayout, LAYOUT_LIMITS, MAIN_LAYOUT, validateArcs, validateLayoutSheet, validatePrintLayout, validatePrintPage,
  type LayoutArc, type LayoutSheet, type MainLayoutSettings, type PrintLayout, type PrintPage
} from "./print-layouts";
import type { CourseSettingDocument, EditResult, PrintArea } from "./types";
import { CourseSettingEditError } from "./types";
import type { Point } from "@o-tid/map-file";

/** Ändringarna av en layout (null tar bort mallen). Huvudlayouten har bara namn och "Kartor per ark". */
export interface LayoutChanges {
  readonly name?: string | undefined;
  readonly scale?: number | undefined;
  readonly page?: PrintPage | undefined;
  readonly paperTemplate?: string | null | undefined;
  readonly layoutTemplate?: string | null | undefined;
}

export type LayoutEdit =
  | { readonly type: "ADD_LAYOUT"; readonly layout: PrintLayout }
  | { readonly type: "UPDATE_LAYOUT"; readonly layout: string; readonly changes: LayoutChanges }
  /** Tar bort layouten, dess ark och klassernas val av den (klasserna får huvudlayouten). */
  | { readonly type: "DELETE_LAYOUT"; readonly layout: string }
  /** Arket i en layout: lägg till (tomt = som layouten), ersätt eller ta bort (null). */
  | { readonly type: "PUT_LAYOUT_SHEET"; readonly layout: string; readonly course: string; readonly sheet: LayoutSheet | null }
  /** Ringavbrotten för en kontroll i layouten; null = som banläggningen igen. */
  | { readonly type: "SET_LAYOUT_CIRCLE_GAPS"; readonly layout: string; readonly control: string; readonly gaps: readonly LayoutArc[] | null }
  /** "Ta bort justeringar" på arket: arkets nummer och layoutens ringavbrott för banans kontroller. */
  | { readonly type: "CLEAR_LAYOUT_ADJUSTMENTS"; readonly layout: string; readonly course: string }
  /** Klassernas layout per klassnamn (null eller "MAIN" = huvudlayouten). */
  | { readonly type: "SET_CLASS_LAYOUTS"; readonly classes: Readonly<Record<string, string | null>> }
  | { readonly type: "SAVE_LAYOUT_STATE"; readonly id: string; readonly name: string; readonly savedAt: string }
  | { readonly type: "RESTORE_LAYOUT_STATE"; readonly id: string }
  | { readonly type: "DELETE_LAYOUT_STATE"; readonly id: string };

/** Fälten i händelsen som Layout-fliken äger (för kollaborationens värden). */
export const LAYOUT_EVENT_FIELDS: ReadonlySet<string> = new Set(["layouts", "layoutSheets", "classLayouts", "mainLayout", "layoutStates"]);

const invalid = (message: string) => new CourseSettingEditError("INVALID", message);
const notFound = (message: string) => new CourseSettingEditError("NOT_FOUND", message);
const ID = /^[A-Za-z0-9_-]{1,40}$/;

type Event = CourseSettingDocument["event"];
const withEvent = (document: CourseSettingDocument, changes: Partial<Record<keyof Event, unknown>>): CourseSettingDocument => {
  const event: Record<string, unknown> = { ...document.event };
  for (const [key, value] of Object.entries(changes)) {
    const empty = value === undefined || (Array.isArray(value) && value.length === 0) || (typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0);
    if (empty) delete event[key]; else event[key] = value;
  }
  return { ...document, event: event as Event };
};

function requireLayout(document: CourseSettingDocument, id: string): PrintLayout {
  const found = findPrintLayout(document, id);
  if (!found) throw notFound(`Layouten ${id} finns inte`);
  return found;
}

function requireCourse(document: CourseSettingDocument, course: string): void {
  if (course !== "ALL_CONTROLS" && !document.courses.some(item => item.id === course)) throw notFound(`Banan ${course} finns inte`);
}

function checkTemplates(document: CourseSettingDocument, layout: Pick<PrintLayout, "paperTemplate" | "layoutTemplate">): void {
  if (layout.paperTemplate !== undefined && !(document.event.paperTemplates ?? []).some(item => item.id === layout.paperTemplate)) {
    throw notFound(`Mallen ${layout.paperTemplate} finns inte`);
  }
  if (layout.layoutTemplate !== undefined && !layoutTemplateKnown(document, layout.layoutTemplate)) throw notFound(`Layoutmallen ${layout.layoutTemplate} finns inte`);
}

function layoutTemplateKnown(document: CourseSettingDocument, id: string): boolean {
  return [...BUILT_IN_TEMPLATES, ...(document.event.layoutTemplates ?? [])].some(item => item.id === id);
}

const putLayout = (document: CourseSettingDocument, layout: PrintLayout) =>
  withEvent(document, { layouts: (document.event.layouts ?? []).map(item => item.id === layout.id ? layout : item) });

/** Arken i layouten med ett ark ändrat (tomt ark står kvar: det finns; null tar bort det). */
function putSheet(document: CourseSettingDocument, layout: string, course: string, sheet: LayoutSheet | null): CourseSettingDocument {
  const all = { ...(document.event.layoutSheets ?? {}) };
  const sheets = { ...(all[layout] ?? {}) };
  if (sheet === null) delete sheets[course]; else sheets[course] = sheet;
  if (Object.keys(sheets).length > 0) all[layout] = sheets; else delete all[layout];
  return withEvent(document, { layoutSheets: all });
}

const sheetOf = (document: CourseSettingDocument, layout: string, course: string): LayoutSheet => document.event.layoutSheets?.[layout]?.[course] ?? {};

function withoutKey<T extends object>(object: T, key: keyof T): T {
  const rest = { ...object };
  delete rest[key];
  return rest;
}

function setRecord<T>(record: Readonly<Record<string, T>> | undefined, key: string, value: T | undefined): Record<string, T> | undefined {
  const next = { ...(record ?? {}) };
  if (value === undefined) delete next[key]; else next[key] = value;
  return Object.keys(next).length > 0 ? next : undefined;
}

function sheetWith<K extends keyof LayoutSheet>(sheet: LayoutSheet, key: K, value: LayoutSheet[K] | undefined): LayoutSheet {
  return value === undefined ? withoutKey(sheet, key) : { ...sheet, [key]: value };
}

/** Tryckytan för ett ark i en annan layout (papperet är layoutens och sparas inte på arket). */
export function setLayoutSheetArea(document: CourseSettingDocument, layout: string, course: string, area: PrintArea | null, part?: number): CourseSettingDocument {
  requireLayout(document, layout);
  requireCourse(document, course);
  const value = area ? validateLayoutSheet({ printArea: area }).printArea : undefined;
  const sheet = sheetOf(document, layout, course);
  const next = part === undefined ? sheetWith(sheet, "printArea", value)
    : sheetWith(sheet, "partPrintAreas", setRecord(sheet.partPrintAreas, String(part), value));
  return putSheet(document, layout, course, next);
}

/** Papperet för ett ark i en annan layout; null = layoutens mall igen. */
export function setLayoutSheetPaper(document: CourseSettingDocument, layout: string, course: string, paper: CoursePaperLayout | null, part?: number): CourseSettingDocument {
  requireLayout(document, layout);
  requireCourse(document, course);
  const value = paper ? validatePaperLayout(paper) : undefined;
  if (value?.template !== undefined && !(document.event.paperTemplates ?? []).some(item => item.id === value.template)) throw notFound(`Mallen ${value.template} finns inte`);
  const sheet = sheetOf(document, layout, course);
  const next = part === undefined ? sheetWith(sheet, "paper", value)
    : sheetWith(sheet, "partPapers", setRecord(sheet.partPapers, String(part), value));
  return putSheet(document, layout, course, next);
}

/** Ett justerat nummer på arket (kartans mm); null = som banläggningen igen. */
export function setLayoutSheetNumber(document: CourseSettingDocument, layout: string, course: string, courseControl: string, at: Point | null): CourseSettingDocument {
  requireLayout(document, layout);
  if (course === "ALL_CONTROLS") throw invalid("Alla kontroller har inga nummer att justera");
  requireCourse(document, course);
  if (!courseControlIds(document, course).has(courseControl)) throw notFound(`Banans kontroll ${courseControl} på banan`);
  if (at !== null && !(Number.isFinite(at.x) && Number.isFinite(at.y))) throw invalid("Numrets läge");
  const sheet = sheetOf(document, layout, course);
  return putSheet(document, layout, course, sheetWith(sheet, "numbers", setRecord(sheet.numbers, courseControl, at === null ? undefined : { x: at.x, y: at.y })));
}

export function applyLayoutEdit(document: CourseSettingDocument, edit: LayoutEdit): EditResult {
  switch (edit.type) {
    case "ADD_LAYOUT": {
      const layout = validatePrintLayout(edit.layout);
      const list = document.event.layouts ?? [];
      if (list.some(item => item.id === layout.id)) throw new CourseSettingEditError("IN_USE", `Layouten ${layout.id} finns redan`);
      if (list.length >= LAYOUT_LIMITS.layouts) throw invalid(`Högst ${LAYOUT_LIMITS.layouts} layouter`);
      checkTemplates(document, layout);
      return { document: withEvent(document, { layouts: [...list, layout] }), created: layout.id };
    }
    case "UPDATE_LAYOUT": {
      const changes = edit.changes;
      if (edit.layout === MAIN_LAYOUT) {
        if (changes.scale !== undefined || changes.page !== undefined || changes.paperTemplate !== undefined) {
          throw invalid("Huvudlayoutens skala och papper är banornas (ändras i banans egenskaper och på arket)");
        }
        const main: { -readonly [K in keyof MainLayoutSettings]: MainLayoutSettings[K] } = { ...(document.event.mainLayout ?? {}) };
        if (changes.name !== undefined) {
          const name = changes.name.trim();
          if (name.length > LAYOUT_LIMITS.nameLength) throw invalid("Namnet är för långt");
          if (name === "") delete main.name; else main.name = name;
        }
        if (changes.layoutTemplate !== undefined) {
          if (changes.layoutTemplate === null) delete main.layoutTemplate;
          else { checkTemplates(document, { layoutTemplate: changes.layoutTemplate }); main.layoutTemplate = changes.layoutTemplate; }
        }
        return { document: withEvent(document, { mainLayout: main }) };
      }
      const current = requireLayout(document, edit.layout);
      const next: Record<string, unknown> = { ...current };
      for (const key of ["name", "scale", "page", "paperTemplate", "layoutTemplate"] as const) {
        const value = changes[key];
        if (value === undefined) continue;
        if (value === null) delete next[key]; else next[key] = value;
      }
      if (changes.page !== undefined) next.page = validatePrintPage(changes.page);
      const layout = validatePrintLayout(next);
      checkTemplates(document, { ...(changes.paperTemplate ? { paperTemplate: layout.paperTemplate } : {}), ...(changes.layoutTemplate ? { layoutTemplate: layout.layoutTemplate } : {}) });
      return { document: putLayout(document, layout) };
    }
    case "DELETE_LAYOUT": {
      requireLayout(document, edit.layout);
      const sheets = { ...(document.event.layoutSheets ?? {}) };
      delete sheets[edit.layout];
      const classes = Object.fromEntries(Object.entries(document.event.classLayouts ?? {}).filter(([, layout]) => layout !== edit.layout));
      return { document: withEvent(document, { layouts: (document.event.layouts ?? []).filter(item => item.id !== edit.layout), layoutSheets: sheets, classLayouts: classes }) };
    }
    case "PUT_LAYOUT_SHEET": {
      requireLayout(document, edit.layout);
      requireCourse(document, edit.course);
      if (edit.sheet === null) return { document: putSheet(document, edit.layout, edit.course, null) };
      const sheet = validateLayoutSheet(edit.sheet);
      if (sheet.paper?.template !== undefined && !(document.event.paperTemplates ?? []).some(item => item.id === sheet.paper!.template)) {
        throw notFound(`Mallen ${sheet.paper.template} finns inte`);
      }
      return { document: putSheet(document, edit.layout, edit.course, sheet) };
    }
    case "SET_LAYOUT_CIRCLE_GAPS": {
      const layout = requireLayout(document, edit.layout);
      const control = document.controls[edit.control];
      if (!control) throw notFound(`Kontrollen ${edit.control} finns inte`);
      if (control.kind !== "NORMAL" && control.kind !== "FINISH") throw invalid("Bara kontroller och mål har ringavbrott");
      const gaps = edit.gaps === null ? undefined : validateArcs(edit.gaps);
      const circleGaps = setRecord(layout.circleGaps, edit.control, gaps);
      return { document: putLayout(document, circleGaps ? { ...layout, circleGaps } : withoutKey(layout, "circleGaps")) };
    }
    case "CLEAR_LAYOUT_ADJUSTMENTS": {
      const layout = requireLayout(document, edit.layout);
      requireCourse(document, edit.course);
      let next = document;
      const sheet = sheetOf(document, edit.layout, edit.course);
      if (sheet.numbers) next = putSheet(next, edit.layout, edit.course, withoutKey(sheet, "numbers"));
      if (layout.circleGaps) {
        const controls = edit.course === "ALL_CONTROLS" ? new Set(Object.keys(document.controls))
          : new Set([...courseControlIds(document, edit.course)].map(id => document.courseControls[id]!.control));
        const kept = Object.fromEntries(Object.entries(layout.circleGaps).filter(([control]) => !controls.has(control)));
        next = putLayout(next, Object.keys(kept).length > 0 ? { ...layout, circleGaps: kept } : withoutKey(layout, "circleGaps"));
      }
      return { document: next };
    }
    case "SET_CLASS_LAYOUTS": {
      const classes: Record<string, string> = { ...(document.event.classLayouts ?? {}) };
      const entries = Object.entries(edit.classes);
      if (entries.length > 2000) throw invalid("Högst 2 000 klasser");
      for (const [name, layout] of entries) {
        if (name.trim() === "" || name.length > 200) throw invalid("Klassens namn");
        if (layout === null || layout === MAIN_LAYOUT) { delete classes[name]; continue; }
        requireLayout(document, layout);
        classes[name] = layout;
      }
      return { document: withEvent(document, { classLayouts: classes }) };
    }
    case "SAVE_LAYOUT_STATE": {
      if (!ID.test(edit.id)) throw invalid("Lägets id");
      const name = edit.name.trim();
      if (name === "" || name.length > LAYOUT_LIMITS.nameLength) throw invalid("Lägets namn");
      if (Number.isNaN(Date.parse(edit.savedAt))) throw invalid("Tiden för läget");
      const list = (document.event.layoutStates ?? []).filter(item => item.id !== edit.id);
      if (list.length >= LAYOUT_LIMITS.states) throw invalid(`Högst ${LAYOUT_LIMITS.states} sparade lägen`);
      return { document: withEvent(document, { layoutStates: [...list, snapshotLayoutState(document, { id: edit.id, name, savedAt: edit.savedAt })] }), created: edit.id };
    }
    case "RESTORE_LAYOUT_STATE": {
      const state = (document.event.layoutStates ?? []).find(item => item.id === edit.id);
      if (!state) throw notFound(`Läget ${edit.id} finns inte`);
      return { document: restoreLayoutState(document, state) };
    }
    case "DELETE_LAYOUT_STATE": {
      const list = document.event.layoutStates ?? [];
      if (!list.some(item => item.id === edit.id)) throw notFound(`Läget ${edit.id} finns inte`);
      return { document: withEvent(document, { layoutStates: list.filter(item => item.id !== edit.id) }) };
    }
  }
}

/** Det automatiska läget "Från Purple Pen" efter en inläsning (ersätter det förra). */
export function withPpenState(document: CourseSettingDocument, savedAt: string, name = "Från Purple Pen"): CourseSettingDocument {
  const others = (document.event.layoutStates ?? []).filter(item => item.source !== "PPEN");
  const state: LayoutState = snapshotLayoutState(document, { id: "ppen", name, savedAt, source: "PPEN" });
  return withEvent(document, { layoutStates: [...others, state] });
}

/** Kollaborationens nycklar för ändringarna i Layout-fliken (se `editTouches`). */
export function layoutEditTouches(edit: LayoutEdit): string[] {
  switch (edit.type) {
    case "ADD_LAYOUT": return [`event:layouts:${edit.layout.id}`];
    case "UPDATE_LAYOUT": return Object.keys(edit.changes).sort().map(key => edit.layout === MAIN_LAYOUT ? `event:mainLayout:${key}` : `event:layouts:${edit.layout}:${key}`);
    case "DELETE_LAYOUT": return [`event:layouts:${edit.layout}`, `event:layoutSheets:${edit.layout}`, "event:classLayouts"];
    case "PUT_LAYOUT_SHEET": return [`event:layoutSheets:${edit.layout}:${edit.course}`];
    case "SET_LAYOUT_CIRCLE_GAPS": return [`event:layouts:${edit.layout}:circleGaps:${edit.control}`];
    case "CLEAR_LAYOUT_ADJUSTMENTS": return [`event:layoutSheets:${edit.layout}:${edit.course}:numbers`, `event:layouts:${edit.layout}:circleGaps`];
    case "SET_CLASS_LAYOUTS": return Object.keys(edit.classes).sort().map(name => `event:classLayouts:${name}`);
    case "SAVE_LAYOUT_STATE": case "DELETE_LAYOUT_STATE": return [`event:layoutStates:${edit.id}`];
    case "RESTORE_LAYOUT_STATE": return ["event:layouts", "event:layoutSheets", "event:classLayouts", "event:mainLayout", "event:paperLayouts", "event:paperTemplates",
      "event:layoutTemplates", "event:printArea", "event:printProfileId", "event:printProfiles"];
  }
}

/** Nyckeln för ett ark i en annan layout ("event:layoutSheets:<layout>:<bana>:…"). */
export function layoutSheetTouch(layout: string, course: string, ...rest: (string | number)[]): string {
  return [`event:layoutSheets:${layout}:${course}`, ...rest.map(String)].join(":");
}

/** Värdet bakom en nyckel i Layout-flikens fält (för konflikterna, `documentChanges`). */
export function layoutTouchValue(document: CourseSettingDocument, touch: string): unknown {
  const [, field, ...path] = touch.split(":");
  const event = document.event;
  if (field === "classLayouts") return path.length === 0 ? event.classLayouts : event.classLayouts?.[path.join(":")];
  let value: unknown = field === "layouts" ? event.layouts : field === "layoutStates" ? event.layoutStates : field === "layoutSheets" ? event.layoutSheets
    : field === "mainLayout" ? event.mainLayout : undefined;
  for (const key of path) {
    if (value === undefined || value === null) return undefined;
    value = Array.isArray(value) ? value.find(item => (item as { id?: string }).id === key) : (value as Record<string, unknown>)[key];
  }
  return value;
}

/**
 * En borttagen mall för papperet eller layoutmall ("Kartor per ark") försvinner också ur layouterna och arken: arken står
 * kvar utan mall med sina egna element (som banorna i huvudlayouten, ADR-0197 beslut 7).
 */
export function withoutTemplateInLayouts(document: CourseSettingDocument, kind: "PAPER" | "LAYOUT", id: string): CourseSettingDocument {
  const key = kind === "PAPER" ? "paperTemplate" : "layoutTemplate";
  const layouts = document.event.layouts?.map(layout => layout[key] === id ? withoutKey(layout, key) : layout);
  let next = layouts ? withEvent(document, { layouts }) : document;
  if (kind === "LAYOUT") {
    const main = document.event.mainLayout;
    return main?.layoutTemplate === id ? withEvent(next, { mainLayout: withoutKey(main, "layoutTemplate") }) : next;
  }
  const clean = (paper: CoursePaperLayout | undefined) => paper?.template === id ? withoutKey(withoutKey(paper, "template"), "hidden") : paper;
  const sheets = Object.fromEntries(Object.entries(document.event.layoutSheets ?? {}).map(([layout, byCourse]) => [layout,
    Object.fromEntries(Object.entries(byCourse).map(([course, sheet]) => {
      const paper = clean(sheet.paper);
      const parts = sheet.partPapers ? Object.fromEntries(Object.entries(sheet.partPapers).map(([part, value]) => [part, clean(value)!])) : undefined;
      return [course, { ...sheetWith(sheet, "paper", paper), ...(parts ? { partPapers: parts } : {}) }];
    }))]));
  if (document.event.layoutSheets) next = withEvent(next, { layoutSheets: sheets });
  return next;
}
