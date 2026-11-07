import type { MapBundleResponse } from "@o-tid/contracts";
import {
  classLayoutOf, countCourseParts, findPrintLayout, layoutAdjustments, layoutDocument, layoutEntries, layoutSheetOf, MAIN_LAYOUT,
  printAreaOf, printSheetGroups, type CourseSettingDocument, type CourseSettingEdit, type CoursePaperLayout, type LayoutEntry, type MapRect, type OverprintOptions,
  type PrintLayout, type Sheet
} from "@o-tid/course-setting";
import { mapReserveCount } from "@o-tid/domain";
import { courseOutsideFrame, paperText } from "./course-setting-print-overview";

/**
 * ADR-0217: Layout-flikens logik utan React. Överblicken (banor × layouter), klasstabellen, ändringarna på ett ark i en
 * annan layout (papperets och ramens ändringar räknas på dokumentet som utskriften ser det för layouten och sparas på arket)
 * och en ny layouts förval.
 */
export type CellStatus = "FITS" | "OUTSIDE" | "OWN_AREA" | "PARTS";

export interface MatrixCell {
  readonly layout: string;
  readonly course: string;
  /** Arket finns: huvudlayouten alltid, en annan layout när arket lagts till eller en klass med banan har layouten. */
  readonly exists: boolean;
  readonly classes: readonly string[];
  /** Anmälda (och lediga tider) och reserver för klasserna i rutan, som Kartor till starten räknar. */
  readonly entered: number;
  readonly reserves: number;
  readonly status?: CellStatus | undefined;
  readonly parts: number;
  readonly scale?: number | undefined;
  readonly paper?: string | undefined;
  readonly adjustments: number;
}

export interface MatrixRow { readonly course: string; readonly name: string; readonly cells: readonly MatrixCell[] }

type Bundles = Pick<MapBundleResponse, "classes" | "rows" | "reserve">;

/** Klasserna (stafett: en rad per klass, inte per sträcka) med banan och layouten. */
export interface ClassRow { readonly name: string; readonly courseNames: readonly string[]; readonly layout: string }

export function classRows(document: CourseSettingDocument, bundles: Pick<MapBundleResponse, "classes"> | undefined): ClassRow[] {
  const byName = new Map<string, Set<string>>();
  for (const row of bundles?.classes ?? []) {
    const set = byName.get(row.name) ?? new Set<string>();
    set.add(row.courseName);
    byName.set(row.name, set);
  }
  // Klasser som bara finns i dokumentets val (t.ex. innan kartbuntarna lästs) står också med.
  for (const name of Object.keys(document.event.classLayouts ?? {})) if (!byName.has(name)) byName.set(name, new Set());
  return [...byName].sort(([a], [b]) => a.localeCompare(b, "sv-SE")).map(([name, courses]) => ({ name, courseNames: [...courses], layout: classLayoutOf(document, name) }));
}

/** Ett ark (bana × layout) som utskriften lägger ut det, eller undefined om det inte gick. */
export function sheetOf(document: CourseSettingDocument, course: string, layout: string, options: SheetAids): Sheet[] | undefined {
  try {
    return printSheetGroups(document, { kind: "COURSE" }, [{ course, layout }], { mapBounds: options.mapBounds, detailGaps: options.detailGaps,
      numberObstacles: options.numberObstacles }).flatMap(group => group.sheets);
  } catch { return undefined; }
}

export interface SheetAids {
  readonly mapBounds?: MapRect | undefined;
  readonly detailGaps?: OverprintOptions["detailGaps"];
  readonly numberObstacles?: OverprintOptions["numberObstacles"];
}

/** Rutans status: kartbyte, går utanför (flera sidor eller banan utanför ramen), eget utsnitt eller får plats. */
export function cellStatus(document: CourseSettingDocument, course: string, layout: string, sheets: readonly Sheet[] | undefined): { status?: CellStatus; parts: number } {
  const parts = course === "ALL_CONTROLS" ? 1 : safeParts(document, course);
  if (parts > 1) return { status: "PARTS", parts };
  if (!sheets || sheets.length === 0) return { parts };
  if (sheets.length > 1 || sheets.some(sheet => sheet.frames.some(frame => courseOutsideFrame(frame.figures, frame.mapArea)))) return { status: "OUTSIDE", parts };
  const area = printAreaOf(layoutDocument(document, layout), course);
  return { status: !area.automatic && area.rect ? "OWN_AREA" : "FITS", parts };
}

const safeParts = (document: CourseSettingDocument, course: string) => { try { return countCourseParts(document, course); } catch { return 1; } };

/** Kartor för klasserna i en ruta: per variant anmälda och lediga plus reserven (som `planMapBundles`). */
export function cellMaps(bundles: Bundles | undefined, courseName: string, classes: readonly string[]): { entered: number; reserves: number } {
  if (!bundles || classes.length === 0) return { entered: 0, reserves: 0 };
  const names = new Set(classes);
  const byVariant = new Map<string, number>();
  for (const row of bundles.classes) if (names.has(row.name) && row.courseName === courseName) for (const code of row.variantCodes) byVariant.set(code, byVariant.get(code) ?? 0);
  for (const row of bundles.rows) if (names.has(row.className) && row.courseName === courseName) byVariant.set(row.variantCode ?? "", (byVariant.get(row.variantCode ?? "") ?? 0) + 1);
  let entered = 0, reserves = 0;
  for (const count of byVariant.values()) { entered += count; reserves += mapReserveCount(count, bundles.reserve); }
  return { entered, reserves };
}

/** Överblicken: rader banor (och Alla kontroller sist), kolumner layouter. */
export function layoutMatrix(document: CourseSettingDocument, bundles: Bundles | undefined, mainName: string, aids: SheetAids = {},
  sheetsOf: (course: string, layout: string) => readonly Sheet[] | undefined = (course, layout) => sheetOf(document, course, layout, aids)): { columns: LayoutEntry[]; rows: MatrixRow[] } {
  const columns = layoutEntries(document, mainName);
  const classes = classRows(document, bundles);
  const courses = [...document.courses].sort((a, b) => a.order - b.order);
  const rows = courses.map(course => ({ course: course.id, name: course.name, cells: columns.map(column => {
    const cellClasses = classes.filter(row => row.layout === column.id && row.courseNames.includes(course.name)).map(row => row.name);
    const exists = column.main || cellClasses.length > 0 || document.event.layoutSheets?.[column.id]?.[course.id] !== undefined;
    const maps = cellMaps(bundles, course.name, cellClasses);
    if (!exists) return { layout: column.id, course: course.id, exists, classes: cellClasses, ...maps, parts: 1, adjustments: 0 };
    const sheets = sheetsOf(course.id, column.id);
    const { status, parts } = cellStatus(document, course.id, column.id, sheets);
    const adjust = layoutAdjustments(document, column.id, course.id);
    return { layout: column.id, course: course.id, exists, classes: cellClasses, ...maps, ...(status ? { status } : {}), parts,
      scale: sheets?.[0]?.frames[0]?.printScale, ...(sheets?.[0] ? { paper: paperText(sheets[0].paper) } : {}),
      adjustments: adjust.numbers.length + adjust.circleGaps.length + adjust.legGaps.length };
  }) }));
  return { columns, rows };
}

/**
 * Ändringarna från papperets och ramens paneler (räknade på `layoutDocument`) som de sparas för arket: med `printLayout`
 * och utan det som arket ärver (layoutens mall för papperet, banans överlapp). Ett nytt papper i ramens panel ändrar
 * layoutens papper (papperet hör till layouten). Huvudlayouten: oförändrade.
 */
export function sheetEdits(document: CourseSettingDocument, layout: string, edits: readonly CourseSettingEdit[]): CourseSettingEdit[] {
  if (layout === MAIN_LAYOUT) return [...edits];
  const found = findPrintLayout(document, layout);
  if (!found) return [...edits];
  const out: CourseSettingEdit[] = [];
  for (const edit of edits) {
    if (edit.type === "SET_PAPER_LAYOUT" && edit.printLayout === undefined) {
      out.push({ ...edit, printLayout: layout, layout: edit.layout ? inheritedRemoved(document, found, edit.course, edit.layout) : null });
    } else if (edit.type === "SET_PRINT_AREA" && edit.printLayout === undefined) {
      const page = edit.area?.page;
      if (page && edit.part === undefined && JSON.stringify(page) !== JSON.stringify(found.page)) out.push({ type: "UPDATE_LAYOUT", layout, changes: { page } });
      const area = edit.area ? { ...edit.area } : null;
      if (area) delete (area as { page?: unknown }).page;
      out.push({ ...edit, area, printLayout: layout });
    } else if (edit.type === "MOVE_NUMBER" && edit.printLayout === undefined) out.push({ ...edit, printLayout: layout });
    else out.push(edit);
  }
  return out;
}

function inheritedRemoved(document: CourseSettingDocument, layout: PrintLayout, course: string, paper: CoursePaperLayout): CoursePaperLayout {
  const out: { -readonly [K in keyof CoursePaperLayout]: CoursePaperLayout[K] } = { ...paper };
  if (out.template !== undefined && out.template === layout.paperTemplate && layoutSheetOf(document, layout.id, course).paper?.template === undefined) delete out.template;
  if (out.overlap !== undefined && out.overlap === document.event.paperLayouts?.[course]?.overlap) delete out.overlap;
  return out;
}

/** En ny layout: kartans skala, A4 stående med 7 mm marginal, och ett id som inte krockar med någon annans. */
export function newLayout(document: CourseSettingDocument, name: string, random: () => string = () => crypto.randomUUID().slice(0, 8)): PrintLayout {
  let id = `l-${random()}`;
  while (findPrintLayout(document, id)) id = `l-${random()}`;
  return { id, name, scale: document.event.mapScale, page: { width: 827, height: 1169, margins: 28, landscape: false } };
}

/** Skalan som "1:7 500". */
export const scaleText = (scale: number) => `1:${Math.round(scale).toLocaleString("sv-SE").replace(/\s/g, " ")}`;
