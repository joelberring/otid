/**
 * Arken för utskriften, i samma ordning för webbläsarens förhandsvisning och serverns PDF (översynen 2026-11-02: valet
 * fanns tidigare på två ställen). En layoutmall (alla valda banor i ramarna, eller en löpare per ark med baksida) eller
 * en sida per bana ur `layoutCoursePage`. Arken grupperas per bana (eller per löpare, eller hela mallen), så att
 * förhandsvisningen kan märka dem och säga vilken bana som inte gick; utan `onError` kastas felet.
 */
import { sheetLayoutSheets, sheetOfPage, type SheetLayout, type Sheet, type SheetItem } from "./sheet-layout";
import { countCourseParts } from "./course-parts";
import { layoutCoursePage, type CoursePage } from "./page-layout";
import type { MapRect, OverprintOptions } from "./types";
import { mirrorFigures } from "./training-mirror";
import { trainingMapPasses } from "./training-passes";
import { effectivePaper } from "./paper-items";
import { clipMapPasses, clipMarkings, paperClipRing } from "./paper-sheet";
import { whiteAreasOnFrame } from "./paper-white";
import { trainingPieceSheets } from "./training-print";
import { findPrintLayout, layoutDocument, sheetLayoutOfLayout, MAIN_LAYOUT, singleMapTemplate } from "./print-layouts";

export type PrintSheetsLayout =
  | { readonly kind: "TEMPLATE"; readonly template: SheetLayout; readonly perRunner?: boolean | undefined; readonly duplex?: boolean | undefined;
      readonly fill?: "FILL" | "REPEAT" | undefined }
  /** `duplex` (ADR-0203): en banas delar fram och bak (del 2 på baksidan av del 1), en tom baksida där det behövs. */
  | { readonly kind: "COURSE"; readonly header?: boolean | undefined; readonly duplex?: boolean | undefined }
  /** Träningsläget (ADR-0192 beslut 6): en liten kartbit per sträcka (minnes- och pusselorientering). */
  | { readonly kind: "PIECES" };

export interface SheetGroup {
  /** Banan eller löparen (index i `items`) som arken gäller; saknas = hela mallen med alla valda banor. */
  readonly item?: number | undefined;
  readonly sheets: readonly Sheet[];
  /** En sida per bana: sidorna som arken gjordes av (rubrik, ark n av m). */
  readonly pages?: readonly CoursePage[] | undefined;
}

export interface SheetGroupOptions {
  readonly mapBounds?: MapRect | undefined;
  readonly date?: string | undefined;
  /**
   * Ringklippen över kartdetaljer (ADR-0180 beslut 10, ADR-0211 beslut 1): samma gap som editorn ritar, räknade på kartfilen
   * (`printDetailGaps` i servern, kartans Worker i förhandsvisningen). Utan dem skrevs ringarna hela på papperet.
   */
  readonly detailGaps?: OverprintOptions["detailGaps"];
  /** Kartans hinder för numren (ADR-0211 beslut 4), räknade som detaljgapen. */
  readonly numberObstacles?: OverprintOptions["numberObstacles"];
  /** En grupp som inte gick att lägga ut (felet loggas av den som anropar); utan den kastas felet. */
  readonly onError?: ((failed: { readonly item?: number | undefined; readonly error: unknown }) => void) | undefined;
  /** ADR-0213: löparens variabler som platshållare i ramar utan löpare (förhandsvisningen av banor). */
  readonly runnerPlaceholders?: boolean | undefined;
}

export function printSheetGroups(document: Parameters<typeof layoutCoursePage>[0], layout: PrintSheetsLayout, items: readonly SheetItem[],
  options: SheetGroupOptions = {}): SheetGroup[] {
  if (!items.some(item => item.layout !== undefined && item.layout !== MAIN_LAYOUT)) return withMapPasses(document, sheetGroups(document, layout, items, options));
  // ADR-0217: arken per layout. Varje följd av kartor i samma layout läggs ut på dokumentet som utskriften ser det för
  // layouten (`layoutDocument`: layoutens skala och papper, arkets utsnitt, papper och justeringar) med layoutens "Kartor per ark".
  const out: SheetGroup[] = [];
  let start = 0;
  while (start < items.length) {
    const id = items[start]!.layout ?? MAIN_LAYOUT;
    let end = start;
    while (end < items.length && (items[end]!.layout ?? MAIN_LAYOUT) === id) end += 1;
    const run = items.slice(start, end), offset = start;
    start = end;
    let projected: Parameters<typeof layoutCoursePage>[0];
    try { projected = layoutDocument(document, id); } catch (error) {
      if (!options.onError) throw error;
      run.forEach((_, index) => options.onError!({ item: offset + index, error }));
      continue;
    }
    const onError = options.onError ? (failed: { item?: number | undefined; error: unknown }) =>
      options.onError!({ item: failed.item === undefined ? undefined : failed.item + offset, error: failed.error }) : undefined;
    const groups = withMapPasses(projected, sheetGroups(projected, printSheetsLayoutFor(document, id, layout), run, { ...options, onError }));
    out.push(...groups.map(group => group.item === undefined ? group : { ...group, item: group.item + offset }));
  }
  return out;
}

/**
 * Hur en layouts ark läggs ut (ADR-0217): huvudlayouten som valt i utskriften; en annan layout med sina "Kartor per ark",
 * annars en bana per ark på layoutens papper. En karta per löpare utan "Kartor per ark" får en karta på layoutens papper
 * med utskriftens remsa.
 */
function printSheetsLayoutFor(document: Parameters<typeof layoutCoursePage>[0], id: string, chosen: PrintSheetsLayout): PrintSheetsLayout {
  if (id === MAIN_LAYOUT || chosen.kind === "PIECES") return chosen;
  const found = findPrintLayout(document, id);
  const template = sheetLayoutOfLayout(document, id);
  const perRunner = chosen.kind === "TEMPLATE" && chosen.perRunner === true;
  if (template) return { kind: "TEMPLATE", template, perRunner, duplex: chosen.duplex, ...(chosen.kind === "TEMPLATE" && chosen.fill ? { fill: chosen.fill } : {}) };
  if (perRunner && found) return { kind: "TEMPLATE", template: singleMapTemplate(found, chosen.kind === "TEMPLATE" ? chosen.template.strips : []), perRunner, duplex: chosen.duplex };
  return { kind: "COURSE", header: chosen.kind === "COURSE" ? chosen.header : false, duplex: chosen.kind === "COURSE" ? chosen.duplex : false };
}

/**
 * Träningsläget (ADR-0192 beslut 9 och 12): kartans pass på varje ram, så att förhandsvisningen och PDF:en ritar samma sak,
 * och spegelvänd karta: banpåtrycket speglas kring ramens mitt och ramen märks så att kartbilden vänds. Papperets klippning
 * (ADR-0197) läggs på passen: kartan bara inom klippningen, utanför vitt eller tonat; banan klipps inte.
 */
function withMapPasses(document: Parameters<typeof layoutCoursePage>[0], groups: SheetGroup[]): SheetGroup[] {
  // Klippningen per bana och del (ADR-0203: en del ärver banans papper).
  const effective = (key: string) => effectivePaper(document, key.split("#")[0]!, key.includes("#") ? Number(key.split("#")[1]) : undefined);
  const anyClip = Object.keys(document.event.paperLayouts ?? {}).some(key => effective(key).clip);
  // "Vitt på utskriften" (ADR-0211 beslut 8) kan också komma ur en mall som banorna använder.
  const anyWhite = Object.keys(document.event.paperLayouts ?? {}).some(key => effective(key).whiteAreas.length > 0);
  if (!document.training && !anyClip && !anyWhite) return groups;
  const clipCache = new Map<string, ReturnType<typeof effectivePaper>["clip"]>();
  const clipOf = (course: string, part: number | undefined) => {
    const key = `${course}#${part ?? ""}`;
    if (!clipCache.has(key)) clipCache.set(key, effectivePaper(document, course, part).clip);
    return clipCache.get(key);
  };
  const training = document.training;
  const cache = new Map<string, ReturnType<typeof trainingMapPasses>>();
  return groups.map(group => ({ ...group, sheets: group.sheets.map(sheet => ({ ...sheet, frames: sheet.frames.map(frame => {
    const key = `${frame.course}|${frame.variant ?? ""}|${JSON.stringify(frame.mapArea)}`;
    if (!cache.has(key)) cache.set(key, training ? trainingMapPasses(document, { course: frame.course, variant: frame.variant, view: frame.mapArea }) : undefined);
    const mirror = training?.courses[frame.course]?.mirror === true;
    const clip = clipOf(frame.course, frame.part);
    const passes = clip ? clipMapPasses(cache.get(key), paperClipRing(clip, { ...frame, mirror }), clip.outside) : cache.get(key);
    const withPasses = passes ? { ...frame, mapPasses: passes } : frame;
    const axis = (frame.mapArea.minX + frame.mapArea.maxX) / 2;
    const mirrored = mirror ? { ...withPasses, mirror: true, figures: mirrorFigures(frame.figures, axis) } : withPasses;
    const whitened = whiteAreasOnFrame(document, mirrored, effectivePaper(document, frame.course, frame.part).whiteAreas, mirror);
    // Markeringarna utanför klippningen syns inte (om inte "Visa markeringar utanför utsnittet"); banan står hel.
    if (!clip || clip.showMarkings) return whitened;
    const marked = clipMarkings(document, whitened, clip, mirror);
    return { ...whitened, figures: marked.figures, ...(marked.markingClip.refs.length > 0 ? { markingClip: marked.markingClip } : {}) };
  }) })) }));
}

function sheetGroups(document: Parameters<typeof layoutCoursePage>[0], layout: PrintSheetsLayout, items: readonly SheetItem[],
  options: SheetGroupOptions): SheetGroup[] {
  const groups: SheetGroup[] = [];
  const attempt = (item: number | undefined, make: () => SheetGroup) => {
    try { groups.push(make()); } catch (error) {
      if (!options.onError) throw error;
      options.onError({ item, error });
    }
  };
  const gaps = { ...(options.detailGaps ? { detailGaps: options.detailGaps } : {}), ...(options.numberObstacles ? { numberObstacles: options.numberObstacles } : {}) };
  const common = { mapBounds: options.mapBounds, ...(options.date ? { date: options.date } : {}), ...gaps,
    ...(options.runnerPlaceholders ? { runnerPlaceholders: true } : {}) };
  if (layout.kind === "PIECES") {
    items.forEach((item, index) => attempt(index, () => ({ item: index, sheets: trainingPieceSheets(document, item, { mapBounds: options.mapBounds }) })));
    return groups;
  }
  if (layout.kind === "TEMPLATE") {
    if (layout.perRunner) {
      items.forEach((item, index) => attempt(index, () => ({ item: index,
        sheets: sheetLayoutSheets(document, layout.template, [item], { ...common, duplexBacks: layout.duplex }) })));
    } else {
      attempt(undefined, () => ({ sheets: sheetLayoutSheets(document, layout.template, items, { ...common, mode: layout.fill }) }));
    }
    return groups;
  }
  items.forEach((item, index) => attempt(index, () => {
    const pages = layoutCoursePage(document, { course: item.course, ...(item.variant ? { variant: item.variant } : {}), ...(item.part !== undefined ? { part: item.part } : {}),
      ...(item.printScale ? { printScale: item.printScale } : {}), ...(item.printArea ? { printArea: item.printArea } : {}),
      mapBounds: options.mapBounds, header: layout.header, ...gaps, ...(item.training ? { training: item.training } : {}), ...(options.date ? { date: options.date } : {}),
      ...(options.runnerPlaceholders ? { runnerPlaceholders: true } : {}) });
    return { item: index, sheets: pages.map(sheetOfPage), pages };
  }));
  return layout.duplex ? duplexParts(groups, items) : groups;
}

/**
 * Dubbelsidigt (ADR-0203): en banas ark (delarna i ordning) läggs fram–bak–fram …, så att del 2 hamnar på baksidan av del 1
 * (kartvändningen); har banan ett udda antal ark följer en tom baksida, så att nästa bana börjar på en framsida. Arken
 * på baksidan märks `back` (PDF:en föreslår vändning på långsidan).
 */
function duplexParts(groups: SheetGroup[], items: readonly SheetItem[]): SheetGroup[] {
  const out: SheetGroup[] = [];
  let run: SheetGroup[] = [];
  const flush = () => {
    let count = 0;
    for (const group of run) {
      out.push({ ...group, sheets: group.sheets.map(sheet => (count++ % 2 === 1 ? { ...sheet, back: true } : sheet)) });
    }
    const last = run[run.length - 1]?.sheets.at(-1);
    if (last && count % 2 === 1) {
      const blank: Sheet = { paper: last.paper, frames: [], texts: [], images: [], descriptions: [], boxes: [], cutMarks: [], back: true };
      const tail = out.pop()!;
      out.push({ ...tail, sheets: [...tail.sheets, blank] });
    }
    run = [];
  };
  let key: string | undefined;
  for (const group of groups) {
    const item = group.item === undefined ? undefined : items[group.item];
    const next = item ? `${item.course}|${item.variant ?? ""}|${item.runner ? JSON.stringify(item.runner) : ""}` : undefined;
    if (next !== key) flush();
    key = next;
    run.push(group);
  }
  flush();
  return out;
}

/**
 * Banorna med kartbyten (ADR-0203) delade i sina delar, en karta per del (som Purple Pens utskrift "parts separately"). En gafflad
 * bana utan vald variant och träningens kartor delas inte.
 */
export function expandPartItems(document: Parameters<typeof layoutCoursePage>[0], items: readonly SheetItem[]): SheetItem[] {
  return items.flatMap(item => {
    if (item.part !== undefined || item.training || item.course === "ALL_CONTROLS") return [item];
    const count = countCourseParts(document, item.course, item.variant);
    return count > 1 ? Array.from({ length: count }, (_, part) => ({ ...item, part })) : [item];
  });
}
