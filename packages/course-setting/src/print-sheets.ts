/**
 * Arken för utskriften, i samma ordning för webbläsarens förhandsvisning och serverns PDF (översynen 2026-11-02: valet
 * fanns tidigare på två ställen). En layoutmall (alla valda banor i ramarna, eller en löpare per ark med baksida) eller
 * en sida per bana ur `layoutCoursePage`. Arken grupperas per bana (eller per löpare, eller hela mallen), så att
 * förhandsvisningen kan märka dem och säga vilken bana som inte gick; utan `onError` kastas felet.
 */
import { layoutTemplateSheets, sheetOfPage, type LayoutTemplate, type Sheet, type SheetItem } from "./layout-template";
import { countCourseParts } from "./course-parts";
import { layoutCoursePage, type CoursePage } from "./page-layout";
import type { MapRect } from "./types";
import { mirrorFigures } from "./training-mirror";
import { trainingMapPasses } from "./training-passes";
import { clipMapPasses, clipMarkings, effectivePaper, paperClipRing } from "./paper-items";
import { trainingPieceSheets } from "./training-print";

export type SheetLayout =
  | { readonly kind: "TEMPLATE"; readonly template: LayoutTemplate; readonly perRunner?: boolean | undefined; readonly duplex?: boolean | undefined;
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
  /** En grupp som inte gick att lägga ut (felet loggas av den som anropar); utan den kastas felet. */
  readonly onError?: ((failed: { readonly item?: number | undefined; readonly error: unknown }) => void) | undefined;
}

export function printSheetGroups(document: Parameters<typeof layoutCoursePage>[0], layout: SheetLayout, items: readonly SheetItem[],
  options: SheetGroupOptions = {}): SheetGroup[] {
  return withMapPasses(document, sheetGroups(document, layout, items, options));
}

/**
 * Träningsläget (ADR-0192 beslut 9 och 12): kartans pass på varje ram, så att förhandsvisningen och PDF:en ritar samma sak,
 * och spegelvänd karta: banpåtrycket speglas kring ramens mitt och ramen märks så att kartbilden vänds. Papperets klippning
 * (ADR-0197) läggs på passen: kartan bara inom klippningen, utanför vitt eller tonat; banan klipps inte.
 */
function withMapPasses(document: Parameters<typeof layoutCoursePage>[0], groups: SheetGroup[]): SheetGroup[] {
  // Klippningen per bana och del (ADR-0203: en del ärver banans papper).
  const anyClip = Object.keys(document.event.paperLayouts ?? {}).some(key => effectivePaper(document, key.split("#")[0]!, key.includes("#") ? Number(key.split("#")[1]) : undefined).clip);
  if (!document.training && !anyClip) return groups;
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
    // Markeringarna utanför klippningen syns inte (om inte "Visa markeringar utanför utsnittet"); banan står hel.
    if (!clip || clip.showMarkings) return mirrored;
    const marked = clipMarkings(document, mirrored, clip, mirror);
    return { ...mirrored, figures: marked.figures, ...(marked.markingClip.refs.length > 0 ? { markingClip: marked.markingClip } : {}) };
  }) })) }));
}

function sheetGroups(document: Parameters<typeof layoutCoursePage>[0], layout: SheetLayout, items: readonly SheetItem[],
  options: SheetGroupOptions): SheetGroup[] {
  const groups: SheetGroup[] = [];
  const attempt = (item: number | undefined, make: () => SheetGroup) => {
    try { groups.push(make()); } catch (error) {
      if (!options.onError) throw error;
      options.onError({ item, error });
    }
  };
  const common = { mapBounds: options.mapBounds, ...(options.date ? { date: options.date } : {}) };
  if (layout.kind === "PIECES") {
    items.forEach((item, index) => attempt(index, () => ({ item: index, sheets: trainingPieceSheets(document, item, { mapBounds: options.mapBounds }) })));
    return groups;
  }
  if (layout.kind === "TEMPLATE") {
    if (layout.perRunner) {
      items.forEach((item, index) => attempt(index, () => ({ item: index,
        sheets: layoutTemplateSheets(document, layout.template, [item], { ...common, duplexBacks: layout.duplex }) })));
    } else {
      attempt(undefined, () => ({ sheets: layoutTemplateSheets(document, layout.template, items, { ...common, mode: layout.fill }) }));
    }
    return groups;
  }
  items.forEach((item, index) => attempt(index, () => {
    const pages = layoutCoursePage(document, { course: item.course, ...(item.variant ? { variant: item.variant } : {}), ...(item.part !== undefined ? { part: item.part } : {}),
      ...(item.printScale ? { printScale: item.printScale } : {}), ...(item.printArea ? { printArea: item.printArea } : {}),
      mapBounds: options.mapBounds, header: layout.header, ...(item.training ? { training: item.training } : {}), ...(options.date ? { date: options.date } : {}) });
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
