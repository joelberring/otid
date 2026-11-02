/**
 * Arken för utskriften, i samma ordning för webbläsarens förhandsvisning och serverns PDF (översynen 2026-11-02: valet
 * fanns tidigare på två ställen). En layoutmall (alla valda banor i ramarna, eller en löpare per ark med baksida) eller
 * en sida per bana ur `layoutCoursePage`. Arken grupperas per bana (eller per löpare, eller hela mallen), så att
 * förhandsvisningen kan märka dem och säga vilken bana som inte gick; utan `onError` kastas felet.
 */
import { layoutTemplateSheets, sheetOfPage, type LayoutTemplate, type Sheet, type SheetItem } from "./layout-template";
import { layoutCoursePage, type CoursePage } from "./page-layout";
import type { MapRect } from "./types";

export type SheetLayout =
  | { readonly kind: "TEMPLATE"; readonly template: LayoutTemplate; readonly perRunner?: boolean | undefined; readonly duplex?: boolean | undefined;
      readonly fill?: "FILL" | "REPEAT" | undefined }
  | { readonly kind: "COURSE"; readonly header?: boolean | undefined };

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
  const groups: SheetGroup[] = [];
  const attempt = (item: number | undefined, make: () => SheetGroup) => {
    try { groups.push(make()); } catch (error) {
      if (!options.onError) throw error;
      options.onError({ item, error });
    }
  };
  const common = { mapBounds: options.mapBounds, ...(options.date ? { date: options.date } : {}) };
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
      mapBounds: options.mapBounds, header: layout.header });
    return { item: index, sheets: pages.map(sheetOfPage), pages };
  }));
  return groups;
}
