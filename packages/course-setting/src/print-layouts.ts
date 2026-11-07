/**
 * ADR-0217: layouterna ("paper space" som egen flik). En layout är papper, skala, mall för papperet och "Kartor per ark";
 * ett ark är bana × layout med eget utsnitt, papper och justerade nummer, och layouten har justerade ringavbrott.
 * Huvudlayouten är banans egna fält (skala, tryckyta, papper) och den enda som skrivs till .ppen.
 *
 * Utskriften räknar ett ark genom en projektion (`layoutDocument`): dokumentet med layoutens skala och papper och arkets
 * utsnitt, papper och justeringar i banornas och kontrollernas vanliga fält. Allt efter det är oförändrat, så ett dokument
 * utan layouter ger samma ark och samma PDF som förut.
 */
import type { Point } from "@o-tid/map-file";
import { BUILT_IN_TEMPLATES, type LayoutTemplate } from "./layout-template";
import { HUNDREDTH_INCH_MM } from "./page-layout";
import { legKey } from "./ppen-common";
import { validatePaperLayout, type CoursePaperLayout } from "./paper-items";
import type { CourseSettingDocument, PrintArea } from "./types";
import { CourseSettingEditError } from "./types";

/** Huvudlayouten: banans egna fält. */
export const MAIN_LAYOUT = "MAIN";
export const LAYOUT_LIMITS = { layouts: 20, states: 20, nameLength: 80, minScale: 500, maxScale: 100_000 } as const;

/** Papperet i 1/100 tum som Purple Pen (A4 = 827 × 1169), marginalen och riktningen (som `PrintArea.page`). */
export type PrintPage = NonNullable<PrintArea["page"]>;
/** Ett ringavbrott i grader moturs (som `CircleGap` utan skala: justeringen gäller layoutens skala). */
export interface LayoutArc { readonly startDegrees: number; readonly endDegrees: number }

export interface PrintLayout {
  readonly id: string;
  readonly name: string;
  /** Utskriftsskalan (t.ex. 7500). */
  readonly scale: number;
  readonly page: PrintPage;
  /** Mall för papperet (ADR-0197) som arken ärver tills de ändras. */
  readonly paperTemplate?: string | undefined;
  /** "Kartor per ark" (ADR-0183, en layoutmall); saknas = en bana per ark. */
  readonly layoutTemplate?: string | undefined;
  /** Justerade ringavbrott per kontroll; saknas = banläggningens. Tom lista = inga avbrott i layouten. */
  readonly circleGaps?: Readonly<Record<string, readonly LayoutArc[]>> | undefined;
  /** Justerade sträckavbrott per sträcka (`legKey`, mm från sträckans början); saknas = banläggningens. Tom lista = inga. */
  readonly legGaps?: Readonly<Record<string, readonly LayoutLegGap[]>> | undefined;
}

/** Ett avbrott i en sträcka (som `Leg.gaps`): start i mm från sträckans början och längd i mm. */
export interface LayoutLegGap { readonly start: number; readonly length: number }

/** Ett ark i en annan layout än huvudlayouten (bana × layout). */
export interface LayoutSheet {
  /** Utsnittet (tryckytan utan papper; papperet är layoutens); saknas = automatiskt. */
  readonly printArea?: PrintArea | undefined;
  /** Kartbytenas delar (ADR-0203), per del "0", "1" …; saknas = arkets. */
  readonly partPrintAreas?: Readonly<Record<string, PrintArea>> | undefined;
  /** Papperet (ADR-0197); saknas = layoutens mall. */
  readonly paper?: CoursePaperLayout | undefined;
  readonly partPapers?: Readonly<Record<string, CoursePaperLayout>> | undefined;
  /** Justerade nummer per banans kontroll (kartans mm); null = automatiskt i layouten. Saknas = banläggningens. */
  readonly numbers?: Readonly<Record<string, Point | null>> | undefined;
}

/** Huvudlayoutens namn och "Kartor per ark" (resten är banans fält). */
export interface MainLayoutSettings {
  readonly name?: string | undefined;
  readonly layoutTemplate?: string | undefined;
}

/** En layout som listan visar den: huvudlayouten har ingen egen skala (banans) och inget eget papper (banans). */
export interface LayoutEntry {
  readonly id: string;
  readonly name: string;
  readonly main: boolean;
  readonly scale?: number | undefined;
  readonly page?: PrintPage | undefined;
  readonly paperTemplate?: string | undefined;
  readonly layoutTemplate?: string | undefined;
}

const invalid = (message: string) => new CourseSettingEditError("INVALID", `Layouten: ${message}`);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const ID = /^[A-Za-z0-9_-]{1,40}$/;
export const AUTOMATIC_AREA: PrintArea = { automatic: true, restrictToPageSize: true };

export function validatePrintPage(page: unknown): PrintPage {
  const value = page as PrintPage | undefined;
  if (!value || ![value.width, value.height, value.margins].every(item => Number.isInteger(item) && item >= 0) || value.width < 100 || value.height < 100
    || value.width > 5000 || value.height > 5000 || value.margins * 2 >= Math.min(value.width, value.height) || typeof value.landscape !== "boolean") {
    throw invalid("papperets storlek eller marginal stämmer inte");
  }
  return { width: value.width, height: value.height, margins: value.margins, landscape: value.landscape };
}

export function validateArcs(value: unknown): LayoutArc[] {
  if (!Array.isArray(value) || value.length > 100) throw invalid("ringavbrotten");
  return value.map(arc => {
    const item = arc as LayoutArc;
    if (!finite(item.startDegrees) || !finite(item.endDegrees)) throw invalid("ringavbrotten");
    return { startDegrees: item.startDegrees, endDegrees: item.endDegrees };
  });
}

export function validateLegGaps(value: unknown): LayoutLegGap[] {
  if (!Array.isArray(value) || value.length > 1000) throw invalid("sträckavbrotten");
  return value.map(gap => {
    const item = gap as LayoutLegGap;
    if (!(finite(item.start) && item.start >= 0 && finite(item.length) && item.length > 0)) throw invalid("sträckavbrotten");
    return { start: item.start, length: item.length };
  });
}

/** Kontrollerar en layout (okända fält tas bort). */
export function validatePrintLayout(value: unknown): PrintLayout {
  if (typeof value !== "object" || value === null) throw invalid("inte ett objekt");
  const layout = value as PrintLayout;
  if (typeof layout.id !== "string" || !ID.test(layout.id) || layout.id === MAIN_LAYOUT) throw invalid("id");
  if (typeof layout.name !== "string" || layout.name.trim() === "" || layout.name.length > LAYOUT_LIMITS.nameLength) throw invalid("namnet");
  if (!finite(layout.scale) || layout.scale < LAYOUT_LIMITS.minScale || layout.scale > LAYOUT_LIMITS.maxScale) throw invalid("skalan");
  const out: { -readonly [K in keyof PrintLayout]: PrintLayout[K] } = { id: layout.id, name: layout.name.trim(), scale: layout.scale, page: validatePrintPage(layout.page) };
  for (const key of ["paperTemplate", "layoutTemplate"] as const) {
    const ref = layout[key];
    if (ref === undefined) continue;
    if (typeof ref !== "string" || ref === "" || ref.length > 200) throw invalid("mallen");
    out[key] = ref;
  }
  if (layout.legGaps !== undefined) {
    if (typeof layout.legGaps !== "object" || layout.legGaps === null || Object.keys(layout.legGaps).length > 50_000) throw invalid("sträckavbrotten");
    out.legGaps = Object.fromEntries(Object.entries(layout.legGaps).map(([leg, gaps]) => [leg, validateLegGaps(gaps)]));
  }
  if (layout.circleGaps !== undefined) {
    if (typeof layout.circleGaps !== "object" || layout.circleGaps === null || Object.keys(layout.circleGaps).length > 10_000) throw invalid("ringavbrotten");
    out.circleGaps = Object.fromEntries(Object.entries(layout.circleGaps).map(([control, arcs]) => [control, validateArcs(arcs)]));
  }
  return out;
}

function validArea(value: unknown): PrintArea {
  const area = value as PrintArea;
  if (typeof area !== "object" || area === null || typeof area.automatic !== "boolean" || typeof area.restrictToPageSize !== "boolean") throw invalid("utsnittet");
  if (area.rect) {
    const { minX, minY, maxX, maxY } = area.rect;
    if (![minX, minY, maxX, maxY].every(finite) || minX >= maxX || minY >= maxY) throw invalid("utsnittet är ingen rektangel");
  }
  return { automatic: area.automatic, restrictToPageSize: area.restrictToPageSize, ...(area.rect ? { rect: { ...area.rect } } : {}) };
}

const PART = /^(0|[1-9]\d?)$/;

/** Kontrollerar ett ark (okända fält tas bort; papperet ur layoutens papper räknas inte in i utsnittet). */
export function validateLayoutSheet(value: unknown): LayoutSheet {
  if (typeof value !== "object" || value === null) throw invalid("arket");
  const sheet = value as LayoutSheet;
  const out: { -readonly [K in keyof LayoutSheet]: LayoutSheet[K] } = {};
  if (sheet.printArea !== undefined) out.printArea = validArea(sheet.printArea);
  if (sheet.partPrintAreas !== undefined) {
    const entries = Object.entries(sheet.partPrintAreas ?? {});
    if (entries.some(([key]) => !PART.test(key))) throw invalid("delen");
    if (entries.length > 0) out.partPrintAreas = Object.fromEntries(entries.map(([key, area]) => [key, validArea(area)]));
  }
  if (sheet.paper !== undefined) out.paper = validatePaperLayout(sheet.paper);
  if (sheet.partPapers !== undefined) {
    const entries = Object.entries(sheet.partPapers ?? {});
    if (entries.some(([key]) => !PART.test(key))) throw invalid("delen");
    if (entries.length > 0) out.partPapers = Object.fromEntries(entries.map(([key, paper]) => [key, validatePaperLayout(paper)]));
  }
  if (sheet.numbers !== undefined) {
    const entries = Object.entries(sheet.numbers ?? {});
    if (entries.length > 10_000) throw invalid("numren");
    for (const [, at] of entries) if (at !== null && !(at && finite(at.x) && finite(at.y))) throw invalid("numrets läge");
    if (entries.length > 0) out.numbers = Object.fromEntries(entries.map(([key, at]) => [key, at === null ? null : { x: at.x, y: at.y }]));
  }
  return out;
}

// ── Läsning ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function printLayoutsOf(document: CourseSettingDocument): readonly PrintLayout[] {
  return document.event.layouts ?? [];
}

export function findPrintLayout(document: CourseSettingDocument, id: string): PrintLayout | undefined {
  return printLayoutsOf(document).find(layout => layout.id === id);
}

/** Huvudlayouten och de andra, i listans ordning. */
export function layoutEntries(document: CourseSettingDocument, mainName = "Huvudlayout"): LayoutEntry[] {
  const main = document.event.mainLayout;
  return [
    { id: MAIN_LAYOUT, name: main?.name ?? mainName, main: true, ...(main?.layoutTemplate ? { layoutTemplate: main.layoutTemplate } : {}) },
    ...printLayoutsOf(document).map(layout => ({ id: layout.id, name: layout.name, main: false, scale: layout.scale, page: layout.page,
      ...(layout.paperTemplate ? { paperTemplate: layout.paperTemplate } : {}), ...(layout.layoutTemplate ? { layoutTemplate: layout.layoutTemplate } : {}) }))
  ];
}

/** Arket i en annan layout (tomt om det inte finns eller inte ändrats). */
export function layoutSheetOf(document: CourseSettingDocument, layout: string, course: string): LayoutSheet {
  return document.event.layoutSheets?.[layout]?.[course] ?? {};
}

/** Klassens layout (`event.classLayouts`); huvudlayouten när klassen inte har någon eller layouten inte finns. */
export function classLayoutOf(document: CourseSettingDocument, className: string | null | undefined): string {
  if (!className) return MAIN_LAYOUT;
  const id = document.event.classLayouts?.[className];
  return id && findPrintLayout(document, id) ? id : MAIN_LAYOUT;
}

/** Justeringarna på ett ark: numren på arket och ringavbrotten för banans kontroller i layouten. */
export function layoutAdjustments(document: CourseSettingDocument, layout: string, course: string): { numbers: string[]; circleGaps: string[]; legGaps: string[] } {
  if (layout === MAIN_LAYOUT) return { numbers: [], circleGaps: [], legGaps: [] };
  const numbers = Object.keys(layoutSheetOf(document, layout, course).numbers ?? {}).filter(cc => document.courseControls[cc]);
  const gaps = findPrintLayout(document, layout)?.circleGaps ?? {};
  const controls = course === "ALL_CONTROLS" ? new Set(Object.keys(document.controls))
    : new Set(Object.values(document.courseControls).filter(cc => courseControlIds(document, course).has(cc.id)).map(cc => cc.control));
  const legs = course === "ALL_CONTROLS" ? new Set<string>() : new Set(courseLegKeys(document, course));
  return { numbers, circleGaps: Object.keys(gaps).filter(control => controls.has(control)),
    legGaps: Object.keys(findPrintLayout(document, layout)?.legGaps ?? {}).filter(leg => legs.has(leg)) };
}

/** Banans sträckor (`legKey`, kontrollernas id), alla grenar. */
export function courseLegKeys(document: CourseSettingDocument, course: string): string[] {
  const out = new Set<string>();
  for (const id of courseControlIds(document, course)) {
    const item = document.courseControls[id]!;
    const to = item.next !== undefined ? document.courseControls[item.next] : undefined;
    if (to && to.control !== item.control) out.add(legKey(item.control, to.control));
  }
  return [...out];
}

/** Banans kontroller (alla grenar), genom den länkade listan och gafflingarna. */
export function courseControlIds(document: CourseSettingDocument, course: string): Set<string> {
  const found = document.courses.find(item => item.id === course);
  const seen = new Set<string>();
  const stack = found?.first !== undefined ? [found.first] : [];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const item = document.courseControls[id];
    if (!item || seen.has(id)) continue;
    seen.add(id);
    if (item.next !== undefined) stack.push(item.next);
    if (item.split) stack.push(...item.split.branches, item.split.end);
  }
  return seen;
}

/** "Kartor per ark" för en layout (huvudlayoutens eller layoutens), om den finns. */
export function layoutTemplateOfLayout(document: CourseSettingDocument, layout: string): LayoutTemplate | undefined {
  const id = layout === MAIN_LAYOUT ? document.event.mainLayout?.layoutTemplate : findPrintLayout(document, layout)?.layoutTemplate;
  return id === undefined ? undefined : [...BUILT_IN_TEMPLATES, ...(document.event.layoutTemplates ?? [])].find(template => template.id === id);
}

/** En layoutmall med en karta på layoutens papper (för en karta per löpare när layouten inte har "Kartor per ark"). */
export function singleMapTemplate(layout: PrintLayout, strips: LayoutTemplate["strips"] = []): LayoutTemplate {
  const widthMm = layout.page.width * HUNDREDTH_INCH_MM, heightMm = layout.page.height * HUNDREDTH_INCH_MM;
  const margin = layout.page.margins * HUNDREDTH_INCH_MM;
  const [w, h] = layout.page.landscape ? [heightMm, widthMm] : [widthMm, heightMm];
  return { schemaVersion: 1, id: `layout-${layout.id}`, name: layout.name, paper: { name: "CUSTOM", widthMm, heightMm, landscape: layout.page.landscape },
    marginMm: margin, frames: [{ x: margin, y: margin, width: w - 2 * margin, height: h - 2 * margin }], texts: [], images: [], descriptions: [],
    strips: [...strips], cutMarks: false };
}

// ── Projektionen ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Dokumentet som utskriften ser det för en layout: layoutens skala för alla banor och Alla kontroller, arkets utsnitt med
 * layoutens papper, arkets papper (layoutens mall om arket inte har eget) i stället för huvudlayoutens, arkets nummer och
 * layoutens ringavbrott. Huvudlayouten (eller ingen) ger dokumentet oförändrat.
 */
export function layoutDocument(document: CourseSettingDocument, layout: string | undefined): CourseSettingDocument {
  if (layout === undefined || layout === MAIN_LAYOUT) return document;
  const found = findPrintLayout(document, layout);
  if (!found) throw new CourseSettingEditError("NOT_FOUND", `Layouten ${layout} finns inte`);
  const sheets = document.event.layoutSheets?.[layout] ?? {};
  const area = (value: PrintArea | undefined): PrintArea => ({ ...(value ?? AUTOMATIC_AREA), page: found.page });
  const courses = document.courses.map(course => {
    const sheet = sheets[course.id];
    const rest = { ...course };
    delete rest.partPrintAreas;
    const parts = sheet?.partPrintAreas ? Object.fromEntries(Object.entries(sheet.partPrintAreas).map(([key, value]) => [key, area(value)])) : undefined;
    return { ...rest, printScale: found.scale, printArea: area(sheet?.printArea), ...(parts ? { partPrintAreas: parts } : {}) };
  });
  // Papperet: arkets, annars layoutens mall; "Visa överlapp" gäller banan (ADR-0203) och följer huvudlayouten om arket inte har eget.
  const mainPapers = document.event.paperLayouts ?? {};
  const papers: Record<string, CoursePaperLayout> = {};
  const withTemplate = (paper: CoursePaperLayout | undefined, course: string): CoursePaperLayout => {
    const own = paper ?? {};
    const overlap = own.overlap ?? mainPapers[course]?.overlap;
    return { ...own, ...(own.template === undefined && found.paperTemplate ? { template: found.paperTemplate } : {}), ...(overlap ? { overlap } : {}) };
  };
  for (const course of ["ALL_CONTROLS", ...document.courses.map(item => item.id)]) {
    const sheet = sheets[course];
    const paper = withTemplate(sheet?.paper, course);
    if (Object.keys(paper).length > 0) papers[course] = paper;
    for (const [part, own] of Object.entries(sheet?.partPapers ?? {})) papers[`${course}#${part}`] = own;
  }
  const courseControls = { ...document.courseControls };
  let numbersChanged = false;
  for (const sheet of Object.values(sheets)) for (const [id, at] of Object.entries(sheet.numbers ?? {})) {
    const current = courseControls[id];
    if (!current) continue;
    const rest = { ...current };
    delete rest.numberAt;
    courseControls[id] = at === null ? rest : { ...rest, numberAt: at };
    numbersChanged = true;
  }
  const controls = { ...document.controls };
  let gapsChanged = false;
  for (const [id, arcs] of Object.entries(found.circleGaps ?? {})) {
    const current = controls[id];
    if (!current) continue;
    controls[id] = { ...current, circleGaps: arcs.map(arc => ({ scale: null, startDegrees: arc.startDegrees, endDegrees: arc.endDegrees })) };
    gapsChanged = true;
  }
  // Sträckavbrotten i layouten (en sträcka utan egen post i dokumentet får en).
  const legs = { ...document.legs };
  let legsChanged = false;
  for (const [key, gaps] of Object.entries(found.legGaps ?? {})) {
    const [from, to] = key.split("-");
    if (!from || !to || !document.controls[from] || !document.controls[to]) continue;
    legs[key] = { ...(legs[key] ?? { from, to, bends: [] }), gaps: gaps.map(gap => ({ start: gap.start, length: gap.length })) };
    legsChanged = true;
  }
  const event = { ...document.event, allControlsPrintScale: found.scale, printArea: area(sheets.ALL_CONTROLS?.printArea) };
  delete (event as { paperLayouts?: unknown }).paperLayouts;
  return { ...document, courses, event: Object.keys(papers).length > 0 ? { ...event, paperLayouts: papers } : event,
    ...(numbersChanged ? { courseControls } : {}), ...(gapsChanged ? { controls } : {}), ...(legsChanged ? { legs } : {}) };
}

/** Skalan för en bana i en layout (huvudlayouten: banans, annars kartans). */
export function layoutScaleOf(document: CourseSettingDocument, layout: string, course: string): number {
  if (layout !== MAIN_LAYOUT) {
    const found = findPrintLayout(document, layout);
    if (found) return found.scale;
  }
  if (course === "ALL_CONTROLS") return document.event.allControlsPrintScale ?? document.event.mapScale;
  return document.courses.find(item => item.id === course)?.printScale ?? document.event.mapScale;
}

/**
 * Klassernas layout ur ett sparat dokument (Kartor till starten, ADR-0217 beslut 6): klassnamn → layoutens id och namn, bara
 * för layouter som finns. Läser dokumentet försiktigt (det kommer ur databasen som JSON).
 */
export function classLayoutMap(document: unknown): Map<string, { id: string; name: string }> {
  const out = new Map<string, { id: string; name: string }>();
  const event = (document as { event?: { classLayouts?: unknown; layouts?: unknown } } | null | undefined)?.event;
  if (!event || typeof event.classLayouts !== "object" || event.classLayouts === null || !Array.isArray(event.layouts)) return out;
  const names = new Map<string, string>();
  for (const layout of event.layouts as unknown[]) {
    const row = layout as { id?: unknown; name?: unknown };
    if (typeof row?.id === "string" && typeof row.name === "string") names.set(row.id, row.name);
  }
  for (const [className, id] of Object.entries(event.classLayouts as Record<string, unknown>)) {
    if (typeof id === "string" && names.has(id)) out.set(className, { id, name: names.get(id)! });
  }
  return out;
}
