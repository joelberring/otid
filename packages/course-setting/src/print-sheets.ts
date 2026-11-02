/**
 * Arken för utskriften, i samma ordning för webbläsarens förhandsvisning och serverns PDF (översynen 2026-11-02: valet
 * fanns tidigare på två ställen). En layoutmall (alla valda banor i ramarna, eller en löpare per ark med baksida) eller
 * en sida per bana ur `layoutCoursePage`. Arken grupperas per bana (eller per löpare, eller hela mallen), så att
 * förhandsvisningen kan märka dem och säga vilken bana som inte gick; utan `onError` kastas felet.
 */
import { layoutTemplateSheets, sheetOfPage, type LayoutTemplate, type Sheet, type SheetItem } from "./layout-template";
import { layoutCoursePage, type CoursePage } from "./page-layout";
import type { MapRect } from "./types";
import { trainingMapPasses } from "./training-passes";
import { trainingPieceSheets } from "./training-print";

export type SheetLayout =
  | { readonly kind: "TEMPLATE"; readonly template: LayoutTemplate; readonly perRunner?: boolean | undefined; readonly duplex?: boolean | undefined;
      readonly fill?: "FILL" | "REPEAT" | undefined }
  | { readonly kind: "COURSE"; readonly header?: boolean | undefined }
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

/** Träningsläget (ADR-0192 beslut 9): kartans pass på varje ram, så att förhandsvisningen och PDF:en ritar samma sak. */
function withMapPasses(document: Parameters<typeof layoutCoursePage>[0], groups: SheetGroup[]): SheetGroup[] {
  if (!document.training) return groups;
  const cache = new Map<string, ReturnType<typeof trainingMapPasses>>();
  return groups.map(group => ({ ...group, sheets: group.sheets.map(sheet => ({ ...sheet, frames: sheet.frames.map(frame => {
    const key = `${frame.course}|${frame.variant ?? ""}|${JSON.stringify(frame.mapArea)}`;
    if (!cache.has(key)) cache.set(key, trainingMapPasses(document, { course: frame.course, variant: frame.variant, view: frame.mapArea }));
    const passes = cache.get(key);
    return passes ? { ...frame, mapPasses: passes } : frame;
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
    const pages = layoutCoursePage(document, { course: item.course, ...(item.variant ? { variant: item.variant } : {}),
      ...(item.printScale ? { printScale: item.printScale } : {}), ...(item.printArea ? { printArea: item.printArea } : {}),
      mapBounds: options.mapBounds, header: layout.header, ...(item.training ? { training: item.training } : {}) });
    return { item: index, sheets: pages.map(sheetOfPage), pages };
  }));
  return groups;
}
