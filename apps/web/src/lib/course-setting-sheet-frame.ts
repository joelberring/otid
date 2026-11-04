import { HUNDREDTH_INCH_MM, PAPER_SIZES, type CourseSettingDocument, type CourseSettingEdit, type MapRect, type PaperName, type PrintArea, type Sheet,
  type SheetFrame } from "@o-tid/course-setting";

/**
 * ADR-0211 tillägg (grenen `utskrift-omtag-2`): papperet, riktningen, marginalen och kartramen ställs in på arket i
 * utskriften i stället för i editorns flik Utskrift. Ren logik: tryckytans papper ur arket och ändringarna när ramen
 * flyttas eller ändrar storlek på arket. Tryckytan är Purple Pens `print-area` som förut (kartans mm).
 */

export type PrintPage = NonNullable<PrintArea["page"]>;

/** Arkets papper i tryckytans enheter (1/100 tum, stående mått). Saknar tryckytan papper gäller det som arket har. */
export function pageOfSheet(area: PrintArea, sheet: Pick<Sheet, "paper">): PrintPage {
  if (area.page) return area.page;
  const { widthMm, heightMm, landscape, marginMm } = sheet.paper;
  const [w, h] = landscape ? [heightMm, widthMm] : [widthMm, heightMm];
  return { width: Math.round(w / HUNDREDTH_INCH_MM), height: Math.round(h / HUNDREDTH_INCH_MM), margins: Math.round(marginMm / HUNDREDTH_INCH_MM), landscape };
}

/** A3, A4 eller A5 om papperet är ett av dem. */
export function paperNameOf(page: Pick<PrintPage, "width" | "height">): PaperName | undefined {
  return (Object.keys(PAPER_SIZES) as PaperName[]).find(name => PAPER_SIZES[name].width === page.width && PAPER_SIZES[name].height === page.height);
}

/** Ändringen av banans (eller delens) tryckyta; `null` = som banans igen (delen) eller automatisk (banan). */
export function printAreaEdit(course: string, part: number | undefined, area: PrintArea | null): CourseSettingEdit {
  return { type: "SET_PRINT_AREA", course, area, ...(part !== undefined ? { part } : {}) };
}

/** Banans eller delens egen tryckyta (för "Som banans igen"). */
export function ownPrintArea(document: CourseSettingDocument, course: string, part: number | undefined): PrintArea | undefined {
  if (course === "ALL_CONTROLS") return document.event.printArea;
  const found = document.courses.find(row => row.id === course);
  return part !== undefined ? found?.partPrintAreas?.[String(part)] : found?.printArea;
}

/** Kartans mm per papperets mm i ramen. */
const ratioOf = (frame: Pick<SheetFrame, "transform">) => 1 / frame.transform.scale;

/** Ytan som ramen visar nu: den fasta ramen, annars ramens utsnitt (den automatiska tryckytan). */
function baseRect(area: PrintArea, frame: Pick<SheetFrame, "mapArea">): MapRect {
  return !area.automatic && area.rect ? area.rect : frame.mapArea;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const roundRect = (rect: MapRect): MapRect => ({ minX: round(rect.minX), minY: round(rect.minY), maxX: round(rect.maxX), maxY: round(rect.maxY) });

/**
 * Ramen flyttad `dx`, `dy` mm på papperet (åt höger och nedåt): ramen flyttas över kartan, så att den visar kartan längre
 * åt höger och nedåt. Tryckytan blir fast (som när ramen dras i Purple Pen) och behåller papperet; ramen står kvar mitt på
 * papperet som förut.
 */
export function movedFrameArea(area: PrintArea, page: PrintPage, frame: Pick<SheetFrame, "mapArea" | "transform">, dx: number, dy: number): PrintArea {
  const ratio = ratioOf(frame), rect = baseRect(area, frame);
  return { automatic: false, restrictToPageSize: area.automatic ? true : area.restrictToPageSize, page,
    rect: roundRect({ minX: rect.minX + dx * ratio, maxX: rect.maxX + dx * ratio, minY: rect.minY - dy * ratio, maxY: rect.maxY - dy * ratio }) };
}

/** Minsta ram på papperet i mm. */
export const MIN_FRAME_MM = 20;

/**
 * Ramen med ny storlek på papperet (`width` × `height` mm, högst det tryckbara papperet): övre vänstra hörnet står kvar på
 * kartan, ramen är inte längre lika stor som papperet (`restrictToPageSize` av) och står mitt på papperet.
 */
export function resizedFrameArea(area: PrintArea, page: PrintPage, frame: Pick<SheetFrame, "mapArea" | "transform">, sheet: Pick<Sheet, "paper">,
  width: number, height: number): PrintArea {
  const ratio = ratioOf(frame), rect = baseRect(area, frame);
  const printableW = sheet.paper.widthMm - 2 * sheet.paper.marginMm, printableH = sheet.paper.heightMm - 2 * sheet.paper.marginMm;
  const w = Math.max(MIN_FRAME_MM, Math.min(printableW, width)), h = Math.max(MIN_FRAME_MM, Math.min(printableH, height));
  return { automatic: false, restrictToPageSize: false, page,
    rect: roundRect({ minX: rect.minX, maxY: rect.maxY, maxX: rect.minX + w * ratio, minY: rect.maxY - h * ratio }) };
}
