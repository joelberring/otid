/**
 * Steg 64 (ADR-0183): layoutmallen som "paperspace". Mallen är papperet (format, riktning, marginal), en eller flera
 * kartramar och det som står på papperet: texter med platshållare, logotyper, beskrivningens plats, remsan med löparens
 * namn för en ihoprullad karta och skärmarker. Kartan med banpåtrycket ("modelspace") läggs i ramarna per bana, variant
 * eller löpare. Allt är data i papperets mm (y nedåt) som förhandsvisningen och steg 65:s PDF ritar likadant.
 */
import type { OverprintTraining, TrainingMapPass } from "./training-types";
import { placeDescription, type SheetDescription } from "./paper-layout";
import { expandPaperText, paperLayoutOf, sheetPaperItems, type MarkingClip, type SheetPaperItem } from "./paper-items";
import { runnerBackSheet } from "./runner-back";
import { countCourseParts } from "./course-parts";
import { layout, printScaleOf } from "./overprint";
import { figureBounds, HUNDREDTH_INCH_MM, PAPER_SIZES, printAreaOf, printRectangle, type CoursePage, type PaperName } from "./page-layout";
import type { CourseSettingDocument, MapRect, OverprintOptions, OverprintPrimitive, PrintArea } from "./types";
import { CourseSettingEditError } from "./types";

export const LAYOUT_TEMPLATE_SCHEMA_VERSION = 1;

export interface TemplateRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** Text på papperet. `at` = baslinjens start (vänster), mitt eller slut enligt `align`; vriden medurs i grader. */
export interface TemplateText {
  readonly x: number;
  readonly y: number;
  /** Med platshållare: {tävling}, {bana}, {variant}, {längd}, {stigning}, {skala}, {datum}, {klasser}, {löpare}, {klubb}, {klass}, {starttid}, {startnummer}. */
  readonly text: string;
  readonly sizeMm: number;
  readonly bold?: boolean | undefined;
  readonly align?: "left" | "center" | "right" | undefined;
  readonly rotation?: 0 | 90 | 180 | 270 | undefined;
  readonly color?: "BLACK" | "COURSE" | undefined;
  /** Kartramen vars bana och löpare platshållarna gäller (0 = första). */
  readonly frame?: number | undefined;
}

export interface TemplateImage extends TemplateRect { readonly mediaType: string; readonly data: string }

/** Beskrivningen för en rams bana på papperet: övre vänstra hörnet och rutans storlek. */
export interface TemplateDescription { readonly frame: number; readonly x: number; readonly y: number; readonly boxMm: number }

/** Remsan för en ihoprullad karta: vit list längs en kant med löparens uppgifter (enkelsidigt). */
export interface TemplateStrip {
  readonly edge: "top" | "bottom" | "left" | "right";
  readonly depthMm: number;
  readonly text: string;
  readonly sizeMm: number;
  readonly frame?: number | undefined;
}

export interface LayoutTemplate {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  /** Papperet stående i mm (A4 = 210 × 297) och riktningen. */
  readonly paper: { readonly name: PaperName | "CUSTOM"; readonly widthMm: number; readonly heightMm: number; readonly landscape: boolean };
  readonly marginMm: number;
  /** Kartramarna i papperets mm; tom = hela ytan innanför marginalen. */
  readonly frames: readonly TemplateRect[];
  readonly texts: readonly TemplateText[];
  readonly images: readonly TemplateImage[];
  readonly descriptions: readonly TemplateDescription[];
  readonly strips: readonly TemplateStrip[];
  readonly cutMarks: boolean;
}

/** Löparens uppgifter för platshållarna (steg 61:s kartbuntar); lediga kartor och reserver har inget namn. */
export interface RunnerInfo {
  readonly kind: "RUNNER" | "VACANT" | "RESERVE";
  readonly name: string | null;
  readonly club?: string | null | undefined;
  readonly className: string | null;
  /** Starttiden som den ska stå ("18:32"). */
  readonly startTime: string | null;
  readonly startNumber: number | null;
  /** ADR-0213: deltagaren (urvalet och kontrolltabellen; skrivs aldrig ut). */
  readonly entryId?: string | undefined;
  /** Stafett (ADR-0213): laget och sträckan. */
  readonly team?: { readonly number: number; readonly name: string } | undefined;
  readonly leg?: number | undefined;
}

export interface SheetItem {
  readonly course: string;
  readonly variant?: string | undefined;
  /** Kartbyten (ADR-0203): en del av banan; saknas = hela banan. */
  readonly part?: number | undefined;
  readonly printScale?: number | undefined;
  readonly printArea?: PrintArea | undefined;
  readonly runner?: RunnerInfo | undefined;
  /** Träningsläget (ADR-0192 beslut 7): vy, kepsens karta och avsnitt. Ett avsnitt ger automatisk tryckyta kring avsnittet. */
  readonly training?: OverprintTraining | undefined;
}

export interface SheetText {
  readonly text: string;
  readonly at: { readonly x: number; readonly y: number };
  readonly heightMm: number;
  readonly bold: boolean;
  readonly align: "left" | "center" | "right";
  readonly rotation: 0 | 90 | 180 | 270;
  readonly color: "BLACK" | "COURSE";
}

/** En kartram på arket: kartans utsnitt, transformen till papperet och banpåtrycket (som `CoursePage`). */
export interface SheetFrame extends Pick<CoursePage, "course" | "variant" | "part" | "title" | "mapScale" | "printScale" | "mapArea" | "clip" | "transform" | "figures"> {
  readonly runner?: RunnerInfo | undefined;
  /** Träningsläget (ADR-0192 beslut 9): kartan i pass med klippning och filter; saknas = kartan som vanligt. */
  readonly mapPasses?: readonly TrainingMapPass[] | undefined;
  /** Spegelorientering (ADR-0192 beslut 12): kartbilden vänds kring ramens lodräta mittlinje; figurerna är redan speglade. */
  readonly mirror?: boolean | undefined;
  /** Papperets klippning (ADR-0197): specialobjekten i `refs` ritas klippta till polygonen (papperets mm). */
  readonly markingClip?: MarkingClip | undefined;
  /**
   * "Vitt på utskriften" (ADR-0211 beslut 8): polygoner i papperets mm som skrivs ut vita över kartan. Banan ritas ovanpå
   * hel; markeringarna (specialobjekten) syns inte i dem.
   */
  readonly whiteAreas?: readonly (readonly { readonly x: number; readonly y: number }[])[] | undefined;
}

/**
 * Ett ark: papperet, kartramarna och det som står på papperet. `boxes` är vita ytor (remsan) under texterna;
 * `cutMarks` skärmarker i marginalen. Målningsordning: kartor, figurer per ram, vita ytor, bilder, papperets element, beskrivningar, texter.
 */
export interface Sheet {
  readonly paper: CoursePage["paper"];
  readonly frames: readonly SheetFrame[];
  readonly texts: readonly SheetText[];
  readonly images: readonly (TemplateRect & { readonly mediaType: string; readonly data: string })[];
  readonly descriptions: readonly SheetDescription[];
  readonly boxes: readonly (TemplateRect & { readonly border: boolean })[];
  readonly cutMarks: readonly { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }[];
  /** Papperets element per ram (ADR-0197): texter, bilder, skalstock, nordpil; ritas efter bilderna, före beskrivningarna. */
  readonly paperItems?: readonly SheetPaperItem[] | undefined;
  /** Arket är baksidan till föregående (dubbelsidigt). */
  readonly back?: boolean | undefined;
}

const invalid = (message: string) => new CourseSettingEditError("INVALID", `Layoutmallen: ${message}`);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Mall med `rows` × `columns` lika stora ramar och `gapMm` mellan dem. */
export function gridTemplate(id: string, name: string, paper: PaperName, landscape: boolean, rows: number, columns: number,
  options: { marginMm?: number; gapMm?: number; title?: boolean; strip?: boolean } = {}): LayoutTemplate {
  const size = PAPER_SIZES[paper];
  const widthMm = Math.round(size.width * HUNDREDTH_INCH_MM), heightMm = Math.round(size.height * HUNDREDTH_INCH_MM);
  const [w, h] = landscape ? [heightMm, widthMm] : [widthMm, heightMm];
  const margin = options.marginMm ?? 7, gap = options.gapMm ?? (rows * columns > 1 ? 8 : 0), title = options.title ? 8 : 0;
  const cell = { width: (w - 2 * margin - (columns - 1) * gap) / columns, height: (h - 2 * margin - (rows - 1) * gap) / rows };
  const frames: TemplateRect[] = [];
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    frames.push({ x: margin + column * (cell.width + gap), y: margin + row * (cell.height + gap) + title, width: cell.width, height: cell.height - title });
  }
  return {
    schemaVersion: 1, id, name, paper: { name: paper, widthMm, heightMm, landscape }, marginMm: margin, frames,
    texts: options.title ? frames.map((frame, index) => ({ x: frame.x, y: frame.y - 2, text: "{bana} {variant}  {längd}  {skala}", sizeMm: 4, bold: true, frame: index })) : [],
    images: [], descriptions: [],
    strips: options.strip ? [{ edge: "bottom", depthMm: 14, text: "{löpare}  {klass}  {starttid}  nr {startnummer}  {variant}", sizeMm: 6 }] : [],
    cutMarks: rows * columns > 1
  };
}

/** Färdiga mallar: en karta, två och fyra kartor per A4, två per A3 och en karta med remsa för rullad karta. */
export const BUILT_IN_TEMPLATES: readonly LayoutTemplate[] = [
  gridTemplate("a4-one", "A4, en karta", "A4", false, 1, 1),
  gridTemplate("a4-two", "A4 liggande, två kartor", "A4", true, 1, 2, { title: true }),
  gridTemplate("a4-four", "A4, fyra kartor", "A4", false, 2, 2, { title: true }),
  gridTemplate("a3-two", "A3 liggande, två kartor", "A3", true, 1, 2, { title: true }),
  gridTemplate("a4-strip", "A4, en karta med remsa (rullad karta)", "A4", false, 1, 1, { strip: true })
];

/** Kontrollerar en mall (ur JSON eller en ändring). Okänd `schemaVersion` avvisas. */
export function validateLayoutTemplate(value: unknown): LayoutTemplate {
  if (typeof value !== "object" || value === null) throw invalid("inte ett objekt");
  const template = value as LayoutTemplate;
  if (template.schemaVersion !== LAYOUT_TEMPLATE_SCHEMA_VERSION) throw invalid(`schemaVersion ${String(template.schemaVersion)} stöds inte`);
  if (typeof template.id !== "string" || template.id === "" || typeof template.name !== "string") throw invalid("saknar id eller namn");
  const paper = template.paper;
  if (!paper || !finite(paper.widthMm) || !finite(paper.heightMm) || paper.widthMm < 50 || paper.heightMm < 50 || paper.widthMm > 1200 || paper.heightMm > 1200) {
    throw invalid("papperets storlek");
  }
  if (!finite(template.marginMm) || template.marginMm < 0 || template.marginMm > 50) throw invalid("marginalen 0–50 mm");
  for (const list of [template.frames, template.texts, template.images, template.descriptions, template.strips]) {
    if (!Array.isArray(list) || list.length > 64) throw invalid("för många delar");
  }
  const rect = (item: TemplateRect, what: string) => {
    if (![item.x, item.y, item.width, item.height].every(finite) || item.width <= 0 || item.height <= 0) throw invalid(`${what} är ingen rektangel`);
  };
  template.frames.forEach(frame => rect(frame, "kartramen"));
  template.images.forEach(image => {
    rect(image, "bilden");
    if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(image.mediaType) || typeof image.data !== "string" || image.data.length > 400_000) throw invalid("bilden (PNG, JPEG, SVG eller WebP, högst 300 kB)");
  });
  for (const text of template.texts) if (!finite(text.x) || !finite(text.y) || typeof text.text !== "string" || !finite(text.sizeMm) || text.sizeMm <= 0) throw invalid("en text");
  for (const item of template.descriptions) if (!finite(item.x) || !finite(item.y) || !finite(item.boxMm) || item.boxMm <= 0 || !Number.isInteger(item.frame)) throw invalid("beskrivningen");
  for (const strip of template.strips) if (!["top", "bottom", "left", "right"].includes(strip.edge) || !finite(strip.depthMm) || strip.depthMm <= 0) throw invalid("remsan");
  if (typeof template.cutMarks !== "boolean") throw invalid("skärmarkerna");
  return template;
}

/** En mall ur JSON. */
export function parseLayoutTemplate(json: string): LayoutTemplate {
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw invalid("inte JSON"); }
  return validateLayoutTemplate(value);
}

export interface SheetOptions {
  /** FILL = de valda banorna i ramarna i ordning; REPEAT = varje bana i alla ramar på sitt eget ark. */
  readonly mode?: "FILL" | "REPEAT" | undefined;
  readonly mapBounds?: MapRect | undefined;
  readonly detailGaps?: OverprintOptions["detailGaps"];
  readonly numberObstacles?: OverprintOptions["numberObstacles"];
  /** Datumet för {datum} ("2026-12-09"). */
  readonly date?: string | undefined;
  readonly descriptionLanguage?: string | undefined;
  /** Dubbelsidigt: efter varje ark med en löpare kommer en baksida med namn, klass, startnummer, starttid och variant. */
  readonly duplexBacks?: boolean | undefined;
  /** ADR-0213: löparens variabler som platshållare i ramar utan löpare (förhandsvisningen). */
  readonly runnerPlaceholders?: boolean | undefined;
}

/** Platshållarna i mallens texter för en ram (okända lämnas kvar); samma variabler som papperets texter (`expandPaperText`). */
export function fillPlaceholders(text: string, document: CourseSettingDocument, frame: Pick<SheetFrame, "course" | "variant" | "printScale" | "runner"> | undefined,
  date?: string): string {
  return expandPaperText(text, document, frame, date).trim();
}

function withPlaceholders(frame: SheetFrame | undefined, options: SheetOptions): SheetFrame | undefined {
  return frame && options.runnerPlaceholders ? { ...frame, runnerPlaceholders: true } as SheetFrame : frame;
}

/** Kartramen för en bana: utsnittet lika stort som ramen i utskriftsskalan, kring banans tryckyta (eller automatiskt). */
function frameFor(document: CourseSettingDocument, item: SheetItem, rect: TemplateRect, options: SheetOptions): SheetFrame {
  const course = item.course;
  const found = course === "ALL_CONTROLS" ? undefined : document.courses.find(row => row.id === course);
  if (course !== "ALL_CONTROLS" && !found) throw new CourseSettingEditError("NOT_FOUND", `Banan ${course} finns inte`);
  const variant = item.variant || undefined;
  const printScale = printScaleOf(document, course, item.printScale);
  const ratio = printScale / document.event.mapScale;
  const part = item.part !== undefined && !item.training && countCourseParts(document, course, variant) > 1 ? item.part : undefined;
  const figures: OverprintPrimitive[] = layout(document, { course, ...(variant ? { variant } : {}), printScale, ...(options.detailGaps ? { detailGaps: options.detailGaps } : {}),
    ...(options.numberObstacles ? { numberObstacles: options.numberObstacles } : {}), ...(item.training ? { training: item.training } : {}), ...(part !== undefined ? { part, overlap: paperLayoutOf(document, course).overlap } : {}) });
  const area = item.training?.section ? { automatic: true, restrictToPageSize: true } : item.printArea ?? printAreaOf(document, course, part);
  const mapArea = printRectangle({ ...area, restrictToPageSize: true }, { width: rect.width * ratio, height: rect.height * ratio }, figureBounds(figures), options.mapBounds);
  const scale = 1 / ratio;
  const name = found?.name ?? "Alla kontroller";
  const base = variant ? `${name} – ${variant}` : name;
  return { course, ...(variant ? { variant } : {}), ...(part !== undefined ? { part } : {}), title: part !== undefined ? `${base} – del ${part + 1}` : base,
    mapScale: document.event.mapScale, printScale, mapArea,
    clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    transform: { scale, translateX: rect.x - mapArea.minX * scale, translateY: rect.y + mapArea.maxY * scale }, figures,
    ...(item.runner ? { runner: item.runner } : {}) };
}

/** Skärmarker i marginalen i ramarnas kantlinjer (inte där en ram går ut till papperets kant). */
function cutMarksFor(paper: { widthMm: number; heightMm: number }, frames: readonly TemplateRect[], marginMm: number): Sheet["cutMarks"] {
  const length = Math.min(5, marginMm - 1);
  if (length <= 0) return [];
  const xs = [...new Set(frames.flatMap(frame => [frame.x, frame.x + frame.width]).map(value => Math.round(value * 1000) / 1000))];
  const ys = [...new Set(frames.flatMap(frame => [frame.y, frame.y + frame.height]).map(value => Math.round(value * 1000) / 1000))];
  return [
    ...xs.flatMap(x => [{ x1: x, y1: 0.5, x2: x, y2: 0.5 + length }, { x1: x, y1: paper.heightMm - 0.5 - length, x2: x, y2: paper.heightMm - 0.5 }]),
    ...ys.flatMap(y => [{ x1: 0.5, y1: y, x2: 0.5 + length, y2: y }, { x1: paper.widthMm - 0.5 - length, y1: y, x2: paper.widthMm - 0.5, y2: y }])
  ];
}

/** Remsan som vit list och text, vriden längs vänster eller höger kant. */
function stripParts(strip: TemplateStrip, paper: { widthMm: number; heightMm: number }, margin: number, text: string): { box: TemplateRect; text: SheetText } {
  const d = strip.depthMm;
  const base = { text, heightMm: strip.sizeMm, bold: true, align: "center" as const, color: "BLACK" as const };
  switch (strip.edge) {
    case "top": return { box: { x: margin, y: margin, width: paper.widthMm - 2 * margin, height: d }, text: { ...base, at: { x: paper.widthMm / 2, y: margin + d / 2 + strip.sizeMm * 0.35 }, rotation: 0 } };
    case "bottom": return { box: { x: margin, y: paper.heightMm - margin - d, width: paper.widthMm - 2 * margin, height: d },
      text: { ...base, at: { x: paper.widthMm / 2, y: paper.heightMm - margin - d / 2 + strip.sizeMm * 0.35 }, rotation: 0 } };
    case "left": return { box: { x: margin, y: margin, width: d, height: paper.heightMm - 2 * margin },
      text: { ...base, at: { x: margin + d / 2 - strip.sizeMm * 0.35, y: paper.heightMm / 2 }, rotation: 90 } };
    case "right": return { box: { x: paper.widthMm - margin - d, y: margin, width: d, height: paper.heightMm - 2 * margin },
      text: { ...base, at: { x: paper.widthMm - margin - d / 2 + strip.sizeMm * 0.35, y: paper.heightMm / 2 }, rotation: 270 } };
  }
}

/**
 * Arken för mallen och de valda banorna (eller löparna). FILL lägger dem i ramarna i ordning (sista arket kan ha tomma
 * ramar); REPEAT ger ett ark per bana med banan i alla ramar. Med `duplexBacks` följer en baksida varje ark med löpare.
 */
export function layoutTemplateSheets(document: CourseSettingDocument, template: LayoutTemplate, items: readonly SheetItem[], options: SheetOptions = {}): Sheet[] {
  validateLayoutTemplate(template);
  const paper = { widthMm: template.paper.landscape ? template.paper.heightMm : template.paper.widthMm,
    heightMm: template.paper.landscape ? template.paper.widthMm : template.paper.heightMm, landscape: template.paper.landscape, marginMm: template.marginMm };
  const margin = template.marginMm;
  const rects = template.frames.length > 0 ? template.frames : [{ x: margin, y: margin, width: paper.widthMm - 2 * margin, height: paper.heightMm - 2 * margin }];
  const groups: SheetItem[][] = [];
  if ((options.mode ?? "FILL") === "REPEAT") for (const item of items) groups.push(rects.map(() => item));
  else for (let index = 0; index < items.length; index += rects.length) groups.push(items.slice(index, index + rects.length));
  const sheets: Sheet[] = [];
  for (const group of groups) {
    const frames = group.map((item, index) => frameFor(document, item, rects[index]!, options));
    const texts: SheetText[] = template.texts.map(text => ({
      text: fillPlaceholders(text.text, document, withPlaceholders(frames[text.frame ?? 0], options), options.date), at: { x: text.x, y: text.y }, heightMm: text.sizeMm,
      bold: text.bold ?? false, align: text.align ?? "left", rotation: text.rotation ?? 0, color: text.color ?? "BLACK"
    })).filter(text => text.text !== "");
    const boxes: (TemplateRect & { border: boolean })[] = [];
    for (const strip of template.strips) {
      const parts = stripParts(strip, paper, margin, fillPlaceholders(strip.text, document, withPlaceholders(frames[strip.frame ?? 0], options), options.date));
      boxes.push({ ...parts.box, border: true });
      if (parts.text.text !== "") texts.push(parts.text);
    }
    // Kontrollbeskrivningen per ram ur banans papper (`paper-layout.ts`); mallens egen plats gäller bara när banan inte har
    // någon utplacerad (äldre mallar).
    const descriptions = frames.flatMap((frame, index) => {
      if (group[index]?.training?.section) return [];
      const placed = placeDescription(document, frame, index, { language: options.descriptionLanguage,
        template: template.descriptions.find(item => item.frame === index) });
      return placed ? [placed] : [];
    });
    // Papperets element per ram; de som står i arkets hörn bara för första ramen.
    const page = { x: 0, y: 0, width: paper.widthMm, height: paper.heightMm };
    const items = frames.flatMap((frame, index) => group[index]?.training?.section ? []
      : sheetPaperItems(document, frame, index, { page, date: options.date, pageItems: index === 0, runnerPlaceholders: options.runnerPlaceholders }));
    const sheet: Sheet = { paper, frames, texts, images: template.images.map(image => ({ ...image })), descriptions, boxes,
      cutMarks: template.cutMarks ? cutMarksFor(paper, rects, margin) : [], ...(items.length > 0 ? { paperItems: items } : {}) };
    sheets.push(sheet);
    const runner = frames[0]?.runner;
    // ADR-0213: baksidan är ett eget ark med papperets element (förvalet som Kartor till startens baksida).
    if (options.duplexBacks && runner) sheets.push(runnerBackSheet(document, paper, frames[0]!, { date: options.date }));
  }
  return sheets;
}

/** En sida ur `layoutCoursePage` som ark (en ram, rubriken som text). */
export function sheetOfPage(page: CoursePage): Sheet {
  return {
    paper: page.paper,
    frames: [{ course: page.course, ...(page.variant ? { variant: page.variant } : {}), ...(page.part !== undefined ? { part: page.part } : {}), title: page.title, mapScale: page.mapScale, printScale: page.printScale,
      mapArea: page.mapArea, clip: page.clip, transform: page.transform, figures: page.figures }],
    texts: page.texts.map(text => ({ text: text.text, at: text.at, heightMm: text.heightMm, bold: text.bold, align: "left", rotation: 0, color: text.color })),
    images: [], descriptions: page.description ? [page.description] : [], boxes: [], cutMarks: [],
    ...(page.paperItems && page.paperItems.length > 0 ? { paperItems: page.paperItems } : {})
  };
}
