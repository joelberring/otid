/**
 * Steg 64 (ADR-0180 beslut 11): utskriftslayouten för en bana. Ren funktion utan canvas eller DOM; webbläsarens
 * förhandsvisning och steg 65:s PDF ritar samma sidor. Tryckytan, papperet och uppdelningen på flera sidor följer Purple
 * Pens Controller.GetPrintAreaRectangle, PositionPrintInterval, CoreMapUtil.GetDefaultPageSize och
 * CoursePageLayout.LayoutPageDimension (BSD, Peter Golde); sidan räknas i mm med y nedåt.
 */
import { layout, printScaleOf } from "./overprint";
import { placeDescription, type SheetDescription } from "./paper-layout";
import { paperLayoutOf } from "./paper-items";
import { sheetPaperItems, type SheetPaperItem } from "./paper-sheet";
import { countCourseParts } from "./course-parts";
import { courseLength, excludedVariantCodes } from "./summary";
import { variations } from "./walk";
import type { CourseSettingDocument, MapRect, OverprintOptions, OverprintPrimitive, PrintArea } from "./types";
import { CourseSettingEditError } from "./types";

/** 1/100 tum i mm (Purple Pen räknar papperet i hundradels tum). */
export const HUNDREDTH_INCH_MM = 0.254;

/** Papperen som Purple Pen erbjuder (metriska), i 1/100 tum stående. */
export const PAPER_SIZES = {
  A2: { width: 1654, height: 2339 }, A3: { width: 1169, height: 1654 }, A4: { width: 827, height: 1169 }, A5: { width: 583, height: 827 },
  A6: { width: 413, height: 583 }
} as const;
export type PaperName = keyof typeof PAPER_SIZES;
/** Purple Pens förvalda marginal för kartor (7 mm). */
export const DEFAULT_MARGINS = 28;
/** Höjden som rubrikraden tar överst på sidan (mm). */
export const HEADER_MM = 7;

export interface CoursePageOptions {
  /** Banans id eller "ALL_CONTROLS". */
  readonly course: string;
  /** Variantkod (gafflad bana, stafett); saknas = alla grenar. */
  readonly variant?: string | undefined;
  /** Utskriftsskala; saknas = banans (eller Alla kontrollers), annars kartans. */
  readonly printScale?: number | undefined;
  /** Tryckyta i stället för den sparade (förhandsvisning medan den ändras). */
  readonly printArea?: PrintArea | undefined;
  /** Kartans yta (kartfilens gränser), för automatisk tryckyta och papper. */
  readonly mapBounds?: MapRect | undefined;
  /** Rubrikrad överst (tävling, bana, längd, skala). */
  readonly header?: boolean | undefined;
  readonly detailGaps?: OverprintOptions["detailGaps"];
  /** Kartans hinder för numren (ADR-0211 beslut 4). */
  readonly numberObstacles?: OverprintOptions["numberObstacles"];
  /** Träningsläget (ADR-0192 beslut 7); ett avsnitt ger automatisk tryckyta kring avsnittet. */
  readonly training?: OverprintOptions["training"];
  /** false = ingen kontrollbeskrivning på papperet (t.ex. editorns ram); saknas = som banans papper. */
  readonly descriptions?: boolean | undefined;
  /** Datumet för papperets {datum} (annars tävlingens värde i dokumentet). */
  /** ADR-0213: löparens variabler som platshållare (förhandsvisningen av banor). */
  readonly runnerPlaceholders?: boolean | undefined;
  readonly date?: string | undefined;
  /** Kartbyten (ADR-0203): en del av banan (0, 1 …) med delens tryckyta, beskrivning och papper; saknas = hela banan. */
  readonly part?: number | undefined;
}

/** En text på sidan (mm, y nedåt): `at` = vänsterkant och baslinje, `heightMm` = em-höjden. */
export interface PageText {
  readonly text: string;
  readonly at: { readonly x: number; readonly y: number };
  readonly heightMm: number;
  readonly bold: boolean;
  readonly color: "BLACK" | "COURSE";
}

/**
 * En sida. Kartans mm (y uppåt) blir sidans mm (y nedåt) med `transform`: x' = scale · x + translateX,
 * y' = −scale · y + translateY. Kartan och figurerna ritas klippta till `clip` (sidans mm); `mapArea` är samma yta i
 * kartans mm. `figures` är banpåtrycket med specialobjekten i kartans mm och i målningsordning (färgroll per figur).
 */
export interface CoursePage {
  readonly course: string;
  readonly variant?: string | undefined;
  /** "Bana A", "Bana A – AC" …; "Alla kontroller"; en del "Bana A – del 2". */
  readonly title: string;
  /** Kartbyten (ADR-0203): delen av banan. */
  readonly part?: number | undefined;
  readonly paper: { readonly widthMm: number; readonly heightMm: number; readonly landscape: boolean; readonly marginMm: number };
  readonly mapScale: number;
  readonly printScale: number;
  readonly mapArea: MapRect;
  readonly clip: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly transform: { readonly scale: number; readonly translateX: number; readonly translateY: number };
  readonly figures: readonly OverprintPrimitive[];
  readonly texts: readonly PageText[];
  /** Sidan i ordningen när banan behöver flera sidor (1-baserat), och hur många. */
  readonly sheet: number;
  readonly sheets: number;
  /** Kontrollbeskrivningen på papperet (bara första sidan), om banan har den (`paper-layout.ts`). */
  readonly description?: SheetDescription | undefined;
  /** Papperets element (ADR-0197), bara första sidan. */
  readonly paperItems?: readonly SheetPaperItem[] | undefined;
}

/** Ytan som figurerna täcker (ungefär: text som en ruta, beskrivningen som sin ruta). */
export function figureBounds(figures: readonly OverprintPrimitive[]): MapRect | undefined {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number, pad = 0) => {
    minX = Math.min(minX, x - pad); maxX = Math.max(maxX, x + pad); minY = Math.min(minY, y - pad); maxY = Math.max(maxY, y + pad);
  };
  for (const figure of figures) {
    switch (figure.kind) {
      case "circle": add(figure.center.x, figure.center.y, figure.diameter / 2 + figure.lineWidth / 2); break;
      case "polyline": for (const p of figure.points) add(p.x, p.y, figure.width / 2); break;
      case "polygon": for (const ring of figure.rings) for (const p of ring) add(p.x, p.y); break;
      case "text": add(figure.at.x, figure.at.y, figure.heightMm * Math.max(1, figure.text.length) * 0.3); break;
      case "image": add(figure.rect.minX, figure.rect.minY); add(figure.rect.maxX, figure.rect.maxY); break;
      case "description": add(figure.topLeft.x, figure.topLeft.y); add(figure.topLeft.x + figure.layout.widthMm, figure.topLeft.y - figure.layout.heightMm); break;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : undefined;
}

/**
 * Det minsta metriska papper som rymmer ytan i utskriftsskalan, liggande om ytan är bredare än hög, med 7 mm marginal om
 * den får plats (CoreMapUtil.GetDefaultPageSize). Utan yta: A4 stående utan marginal.
 */
export function defaultPage(area: MapRect | undefined, scaleRatio: number): NonNullable<PrintArea["page"]> {
  if (!area) return { ...PAPER_SIZES.A4, margins: 0, landscape: false };
  const w = area.maxX - area.minX, h = area.maxY - area.minY;
  const landscape = w > h;
  const needW = (landscape ? h : w) / scaleRatio * 100 / 25.4;
  const needH = (landscape ? w : h) / scaleRatio * 100 / 25.4;
  let best: { width: number; height: number } | undefined;
  for (const paper of Object.values(PAPER_SIZES)) {
    if (paper.width >= needW - 1 && paper.height >= needH - 1 && (!best || paper.width < best.width)) best = paper;
  }
  const paper = best ?? PAPER_SIZES.A4;
  const margins = paper.width - needW > DEFAULT_MARGINS * 2 && paper.height - needH > DEFAULT_MARGINS * 2 ? DEFAULT_MARGINS : 0;
  return { width: paper.width, height: paper.height, margins, landscape };
}

/** Bästa intervallet med bredden `width`: täck det viktiga, sedan det mindre viktiga, centrerat (PositionPrintInterval). */
export function positionInterval(width: number, highL: number, highR: number, lowL: number, lowR: number): [number, number] {
  const minL = Math.min(lowL, highL), maxR = Math.max(lowR, highR);
  if (maxR - minL <= width) { const mid = (minL + maxR) / 2; return [mid - width / 2, mid + width / 2]; }
  const mid = (highL + highR) / 2;
  const centered: [number, number] = [mid - width / 2, mid + width / 2];
  if (highR - highL > width) return centered;
  if (centered[0] >= lowL && centered[1] <= lowR) return centered;
  const marginL = Math.max(0, highL - lowL), marginR = Math.max(0, lowR - highR);
  return marginL < marginR ? [highL - marginL, highL - marginL + width] : [highR + marginR - width, highR + marginR];
}

/** Tryckytan i kartans mm (Controller.GetPrintAreaRectangle). `size` = det tryckbara papperet i kartans mm. */
export function printRectangle(area: PrintArea, size: { width: number; height: number }, objects: MapRect | undefined, map: MapRect | undefined): MapRect {
  let rect: MapRect;
  if (area.automatic || !area.rect) {
    const high = objects ? { minX: objects.minX - 1, minY: objects.minY - 1, maxX: objects.maxX + 1, maxY: objects.maxY + 1 } : undefined;
    const low = map ?? high ?? { minX: 0, minY: 0, maxX: size.width, maxY: size.height };
    const h = high ?? low;
    const [minX, maxX] = positionInterval(size.width, h.minX, h.maxX, low.minX, low.maxX);
    const [minY, maxY] = positionInterval(size.height, h.minY, h.maxY, low.minY, low.maxY);
    rect = { minX, minY, maxX, maxY };
  } else {
    rect = area.rect;
  }
  if (area.restrictToPageSize || area.automatic || !area.rect) {
    const cx = (rect.minX + rect.maxX) / 2, cy = (rect.minY + rect.maxY) / 2;
    rect = { minX: cx - size.width / 2, maxX: cx + size.width / 2, minY: cy - size.height / 2, maxY: cy + size.height / 2 };
  }
  return rect;
}

/**
 * En dimension på sidor (CoursePageLayout.LayoutPageDimension): får ytan plats centreras den, annars delas den på flera
 * sidor som överlappar minst 25,4 mm eller en sjättedel. Allt i papperets mm; `ratio` = kartans mm per papperets mm.
 */
export function pageDimension(mapStart: number, mapLength: number, printStart: number, printLength: number, ratio: number):
  { mapStart: number; mapLength: number; pageStart: number; pageLength: number }[] {
  const needed = mapLength / ratio;
  if (needed <= printLength + 0.0254) {
    return [{ mapStart, mapLength, pageStart: printStart + (printLength - needed) / 2, pageLength: needed }];
  }
  const minOverlap = Math.min(25.4, printLength / 6);
  const pages = Math.ceil((needed - minOverlap) / (printLength - minOverlap));
  const overlap = (pages * printLength - needed) / (pages - 1);
  const advance = (printLength - overlap) * ratio;
  return Array.from({ length: pages }, (_, i) => ({ mapStart: mapStart + i * advance, mapLength: printLength * ratio, pageStart: printStart, pageLength: printLength }));
}

/** Tryckytan för banan: den sparade, annars automatisk med fast storlek (Purple Pens förval). */
export function printAreaOf(document: CourseSettingDocument, course: string, part?: number): PrintArea {
  const found = course === "ALL_CONTROLS" ? undefined : document.courses.find(item => item.id === course);
  // Kartbyten (ADR-0203): delens tryckyta, annars banans (Purple Pens QueryEvent.GetPrintArea).
  const partArea = part !== undefined ? found?.partPrintAreas?.[String(part)] : undefined;
  const saved = course === "ALL_CONTROLS" ? document.event.printArea : partArea ?? found?.printArea;
  return saved ?? { automatic: true, restrictToPageSize: true };
}

/** Rubrikens längd och stigning ("4,3 km, 85 m"; ADR-0190): fast längd före uträknad, stigningen avrundad till 5 m som i beskrivningen. */
function lengthText(document: CourseSettingDocument, course: string, variant: string | undefined): string {
  const found = document.courses.find(item => item.id === course);
  if (!found) return "";
  const climb = found.climbMeters !== undefined && found.climbMeters >= 0 ? `, ${Math.round(found.climbMeters / 5) * 5} m` : "";
  if (found.kind === "SCORE" && found.lengthOverrideMeters === undefined) return climb.slice(2);
  const meters = courseLength(document, course, { variant }).meters;
  return `${(Math.round(meters / 100) / 10).toFixed(1).replace(".", ",")} km${climb}`;
}

/** Sidorna för en bana (en sida när ytan ryms på papperet, annars flera). */
export function layoutCoursePage(document: CourseSettingDocument, options: CoursePageOptions): CoursePage[] {
  const course = options.course;
  const variant = options.variant || undefined;
  const found = course === "ALL_CONTROLS" ? undefined : document.courses.find(item => item.id === course);
  if (course !== "ALL_CONTROLS" && !found) throw new CourseSettingEditError("NOT_FOUND", `Banan ${course} finns inte`);
  const printScale = printScaleOf(document, course, options.printScale);
  if (!(printScale > 0)) throw new CourseSettingEditError("INVALID", "Utskriftsskalan måste vara positiv");
  const mapScale = document.event.mapScale;
  const ratio = printScale / mapScale;
  const part = options.part !== undefined && countCourseParts(document, course, variant) > 1 ? options.part : undefined;
  const figures = layout(document, { course, ...(variant !== undefined ? { variant } : {}), printScale,
    ...(options.detailGaps ? { detailGaps: options.detailGaps } : {}), ...(options.numberObstacles ? { numberObstacles: options.numberObstacles } : {}), ...(options.training ? { training: options.training } : {}),
    ...(part !== undefined ? { part, overlap: paperLayoutOf(document, course).overlap } : {}) });
  const area = options.training?.section ? { automatic: true, restrictToPageSize: true } : options.printArea ?? printAreaOf(document, course, part);
  const objects = figureBounds(figures);
  const page = area.page ?? defaultPage(area.automatic || !area.rect ? options.mapBounds ?? objects : area.rect, ratio);
  const widthMm = (page.landscape ? page.height : page.width) * HUNDREDTH_INCH_MM;
  const heightMm = (page.landscape ? page.width : page.height) * HUNDREDTH_INCH_MM;
  const marginMm = page.margins * HUNDREDTH_INCH_MM;
  const header = options.header === true;
  const printable = { x: marginMm, y: marginMm + (header ? HEADER_MM : 0), width: widthMm - 2 * marginMm, height: heightMm - 2 * marginMm - (header ? HEADER_MM : 0) };
  // Ytans storlek i kartans mm: det tryckbara papperet (utan rubriken), med 0,001 mm marginal som Purple Pen.
  const size = { width: Math.max(0, printable.width * ratio - 0.001), height: Math.max(0, printable.height * ratio - 0.001) };
  const rect = printRectangle(area, size, objects, options.mapBounds);
  const columns = pageDimension(rect.minX, rect.maxX - rect.minX, printable.x, printable.width, ratio);
  // Uppifrån och ned: första sidan har kartans övre del.
  const rows = pageDimension(-rect.maxY, rect.maxY - rect.minY, printable.y, printable.height, ratio);
  const name = found?.name ?? "Alla kontroller";
  const base = variant ? `${name} – ${variant}` : name;
  const title = part !== undefined ? `${base} – del ${part + 1}` : base;
  const texts: PageText[] = header ? [{
    text: [document.event.title.replace(/\|/g, " "), title, found ? lengthText(document, course, variant) : "",
      `1:${Math.round(printScale).toLocaleString("sv-SE").replace(/\s/g, " ")}`].filter(Boolean).join("  ·  "),
    at: { x: marginMm, y: marginMm + HEADER_MM * 0.62 }, heightMm: 4.2, bold: true, color: "BLACK"
  }] : [];
  const pages: CoursePage[] = [];
  for (const row of rows) for (const column of columns) {
    const mapArea = { minX: column.mapStart, maxX: column.mapStart + column.mapLength, maxY: -row.mapStart, minY: -row.mapStart - row.mapLength };
    const clip = { x: column.pageStart, y: row.pageStart, width: column.pageLength, height: row.pageLength };
    const scale = 1 / ratio;
    const transform = { scale, translateX: clip.x - mapArea.minX * scale, translateY: clip.y + mapArea.maxY * scale };
    const description = pages.length === 0 && !options.training?.section && options.descriptions !== false
      ? placeDescription(document, { course, ...(variant !== undefined ? { variant } : {}), ...(part !== undefined ? { part } : {}), clip, transform, figures }, 0) : undefined;
    // Papperets element: första sidan, och de med "Alla sidor" på de följande (ägaren 2026-11-03).
    const paperItems = !options.training?.section && options.descriptions !== false
      ? sheetPaperItems(document, { course, ...(variant !== undefined ? { variant } : {}), ...(part !== undefined ? { part } : {}), printScale, clip }, 0,
        { page: { x: 0, y: 0, width: widthMm, height: heightMm }, date: options.date, firstPage: pages.length === 0, runnerPlaceholders: options.runnerPlaceholders }) : [];
    pages.push({
      course, ...(variant !== undefined ? { variant } : {}), ...(part !== undefined ? { part } : {}), title,
      paper: { widthMm, heightMm, landscape: page.landscape, marginMm }, mapScale, printScale, mapArea, clip, transform,
      figures, texts, sheet: pages.length + 1, sheets: rows.length * columns.length, ...(description ? { description } : {}),
      ...(paperItems.length > 0 ? { paperItems } : {})
    });
  }
  return pages;
}

/** Sidans transform på en punkt i kartans mm. */
export function toPage(page: Pick<CoursePage, "transform">, point: { x: number; y: number }): { x: number; y: number } {
  return { x: page.transform.scale * point.x + page.transform.translateX, y: -page.transform.scale * point.y + page.transform.translateY };
}

/** Varianterna att skriva ut för banan: en sida per variant eller alla grenar på en (""). Bortvalda skrivs inte ut (ADR-0198). */
export function printVariants(document: CourseSettingDocument, course: string, each: boolean): string[] {
  if (course === "ALL_CONTROLS" || !each) return [""];
  const excluded = excludedVariantCodes(document, course);
  const all = variations(document, course).map(item => item.code).filter(code => !excluded.has(code));
  return all.length > 0 ? all : [""];
}
