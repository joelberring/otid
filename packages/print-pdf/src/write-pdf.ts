/**
 * Steg 65 (ADR-0184): arken ur steg 64 (`Sheet`, ADR-0183) som PDF för tryckeriet eller kontorsskrivaren. Ingenting
 * räknas om: kartan ritas med `drawMap` (samma geometri som skärmen) som vektorer i en Form XObject per utsnitt, så att
 * samma utsnitt i hundra kartor per löpare skrivs en gång; banpåtrycket, beskrivningarna, texterna, bilderna, remsan och
 * skärmarkerna skrivs som de ligger i arket. Bibliotek: pdf-lib (MIT) för filens struktur, typsnitten (fontkit, MIT) och
 * bilderna; innehållsströmmarna, dekorfärgerna och övertrycket skrivs här.
 *
 * PDF/X och ICC skrivs inte (inte verifierade); filen påstår inget av det. Provtryck hos tryckeriet behövs.
 */
import { Duplex, PDFDocument, PDFName, type PDFRawStream, type PDFRef } from "pdf-lib";
import {
  cmykOfHex, courseLayerOf, descriptionSymbols, detectPressNorm, drawTrainingMap, effectiveSourceMapColors, mapColorAdjust, overColorBands, passesKey,
  PDF_PRINT_CAPABILITIES, pressOrder, usageCodes,
  type DescriptionStandard, type OverColorBand, type OverprintPrimitive, type PressNorm, type PrintProfile, type Sheet, type SheetFrame
} from "@o-tid/course-setting";
import { colorUsage, type MapColor, type MapObject, type ParsedMap, type Path } from "@o-tid/map-file";
import { ColorSpaces, Content, GS_KNOCKOUT, GS_OVERPRINT, num } from "./content";
import { descriptionOps, figureOps, textOps, type FigureContext, type Matrix } from "./figures";
import { Fonts, fontVariant, paperFontVariant, variantForFamily, type FontFiles, type FontVariant } from "./fonts";
import { PdfCanvas } from "./pdf-canvas";
import { BLACK, coursePaint, isWhiteInk, mapPaints, Plates, registrationPaint, WHITE, type Cmyk, type Paint, type PdfMode } from "./paint";

/** 1 mm i PDF-punkter. */
export const PT_PER_MM = 72 / 25.4;
/** Mönster i ytor ritas punkt för punkt upp till så här många per yta (skärmen: 20 000), annars som tonad yta. */
export const PDF_MAX_PATTERN_INSTANCES = 250_000;
/** Kartobjekt utanför utsnittet plus denna marginal (mm i kartan) tas inte med i utsnittets XObject. */
const CULL_MARGIN_MM = 20;

/** Vad PDF:en kan (förhandskontrollen, `colorPreflight`): äkta övertryck ja; PDF/X och ICC nej tills de verifierats. */
export const PDF_CAPABILITIES = PDF_PRINT_CAPABILITIES;

export interface WritePdfInput {
  readonly sheets: readonly Sheet[];
  /** Kartfilen; `null` = bara banpåtrycket. */
  readonly map: ParsedMap | null;
  readonly profile: PrintProfile;
  readonly mode: PdfMode;
  readonly fonts: FontFiles;
  /** Beskrivningarnas standard (symbolernas ritningar). */
  readonly descriptionStandard?: DescriptionStandard | undefined;
  readonly title?: string | undefined;
  readonly now?: Date | undefined;
  readonly maxPatternInstances?: number | undefined;
  /** Papperets bilder (ADR-0197) per sha256: PNG eller JPEG som de laddades upp. */
  readonly paperImages?: ReadonlyMap<string, { readonly mediaType: string; readonly bytes: Uint8Array }> | undefined;
}

export interface WritePdfResult {
  readonly bytes: Uint8Array;
  readonly pages: number;
  /** Dekorfärgernas plåtar i filen (utom /All för skärmarkerna). */
  readonly plates: readonly string[];
  readonly overprint: boolean;
  /** Utsnitt av kartan (Form XObject), en per unikt utsnitt. */
  readonly mapForms: number;
  /** Sidor vars innehåll återkommer och därför ligger en gång i filen (framsidan för flera löpare). */
  readonly sharedPages: number;
  /** Notiser till arrangören på svenska (förenklingar, avvikande dekorfärger, bilder som inte kunde skrivas). */
  readonly notes: readonly string[];
  /** Kartfärgerna (id) som ritas över banan när banan ligger i färgordningen (BL); tom = banan överst. */
  readonly overCourse: readonly number[];
}

/** Normen för kartan: profilens val, annars igenkänd ur skalan och symbolnumren (ADR-0211 beslut 3). */
export function pressNormFor(map: Pick<ParsedMap, "colors" | "scale"> & Partial<Pick<ParsedMap, "objects" | "symbols">>, profile: PrintProfile): PressNorm {
  if (profile.pressNorm) return profile.pressNorm;
  const usage = map.objects && map.symbols ? colorUsage(map as ParsedMap) : new Map();
  return detectPressNorm({ scale: map.scale, codes: usageCodes(usage.values()) });
}

/**
 * Banans plats i kartans färgordning (`courseLayer: "REFERENCE"`): kartfärgerna som ritas över banans undre lila, enligt
 * normen (ISOM eller ISSprOM, ADR-0211 beslut 3). `undefined` = banan överst (Purple Pens sätt).
 */
export function colorsOverCourse(map: Pick<ParsedMap, "colors" | "scale"> & Partial<Pick<ParsedMap, "objects" | "symbols">>, profile: PrintProfile): ReadonlySet<number> | undefined {
  if (profile.courseLayer !== "REFERENCE") return undefined;
  const usage = map.objects && map.symbols ? colorUsage(map as ParsedMap) : undefined;
  const adjust = mapColorAdjust(profile, map.colors);
  const over = pressOrder(effectiveSourceMapColors(map.colors, usage, adjust), pressNormFor(map, profile)).over;
  return over.size === 0 ? undefined : over;
}

/**
 * Vändningskanten för dubbelsidigt. Kartbytets delar (ADR-0203 beslut 7): alltid långsidan, också liggande delar och
 * blandade riktningar. Löparnas baksidor (ADR-0213): långsidan, eller kortsidan när alla baksidor är liggande, så att
 * texten inte hamnar upp och ned. Inga baksidor = inget förslag.
 */
export function duplexEdge(sheets: readonly { readonly back?: boolean | undefined; readonly paper: { readonly widthMm: number; readonly heightMm: number };
  readonly frames: readonly { readonly part?: number | undefined }[] }[]): "LONG" | "SHORT" | undefined {
  const backs = sheets.filter(sheet => sheet.back);
  if (backs.length === 0) return undefined;
  if (backs.some(sheet => sheet.frames.some(frame => frame.part !== undefined))) return "LONG";
  return backs.every(sheet => sheet.paper.widthMm > sheet.paper.heightMm) ? "SHORT" : "LONG";
}

/** Ytan som ett vitt specialobjekt eller en bild täcker, som väg i punkter (kartans mm genom `m`); tom för annat. */
function coverPath(figure: OverprintPrimitive, m: Matrix): string {
  const at = (p: { x: number; y: number }) => `${num(m[0] * p.x + m[2] * p.y + m[4])} ${num(m[1] * p.x + m[3] * p.y + m[5])}`;
  const ring = (points: readonly { x: number; y: number }[]) => `${points.map((p, index) => `${at(p)} ${index === 0 ? "m" : "l"}`).join(" ")} h`;
  if (figure.kind === "image") {
    const r = figure.rect;
    return ring([{ x: r.minX, y: r.minY }, { x: r.maxX, y: r.minY }, { x: r.maxX, y: r.maxY }, { x: r.minX, y: r.maxY }]);
  }
  if (figure.kind === "polygon") return figure.rings.filter(points => points.length >= 3).map(ring).join(" ");
  return "";
}

const base64Bytes = (data: string): Uint8Array => {
  const binary = atob(data);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
};

function pathBox(path: Path, box: number[]): void {
  for (const command of path) {
    if (command.type === "C") { box[0] = Math.min(box[0]!, command.x1, command.x2); box[2] = Math.max(box[2]!, command.x1, command.x2);
      box[1] = Math.min(box[1]!, command.y1, command.y2); box[3] = Math.max(box[3]!, command.y1, command.y2); }
    box[0] = Math.min(box[0]!, command.x); box[2] = Math.max(box[2]!, command.x); box[1] = Math.min(box[1]!, command.y); box[3] = Math.max(box[3]!, command.y);
  }
}

/** Kartan med bara objekten som kan synas i utsnittet (rutan plus marginal; texter med extra marginal). */
function cullMap(map: ParsedMap, area: SheetFrame["mapArea"]): ParsedMap {
  const objects = map.objects.filter((object: MapObject) => {
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    let margin = CULL_MARGIN_MM;
    if (object.kind === "point") { box[0] = box[2] = object.at.x; box[1] = box[3] = object.at.y; }
    else if (object.kind === "text") { box[0] = box[2] = object.at.x; box[1] = box[3] = object.at.y; margin = 200; }
    else if (object.kind === "line") pathBox(object.path, box);
    else for (const ring of object.rings) pathBox(ring, box);
    if (!Number.isFinite(box[0]!)) return false;
    return box[0]! - margin <= area.maxX && box[2]! + margin >= area.minX && box[1]! - margin <= area.maxY && box[3]! + margin >= area.minY;
  });
  return { ...map, objects };
}

/** Typsnitten som arken och kartans texter behöver (bara de bäddas in). */
function neededFonts(sheets: readonly Sheet[], map: ParsedMap | null): Set<FontVariant> {
  const out = new Set<FontVariant>(["regular"]);
  const description = (layout: Sheet["descriptions"][number]["layout"]) => {
    for (const primitive of layout.primitives) if (primitive.kind === "text") out.add(fontVariant({ bold: primitive.bold === true, condensed: primitive.condensed === true }));
  };
  const figures = (list: readonly OverprintPrimitive[]) => {
    for (const figure of list) {
      if (figure.kind === "text") out.add(figure.font ? variantForFamily(figure.font.family, figure.font.bold, figure.font.italic) : "regular");
      if (figure.kind === "description") description(figure.layout);
    }
  };
  for (const sheet of sheets) {
    for (const text of sheet.texts) out.add(text.bold ? "bold" : "regular");
    for (const item of sheet.paperItems ?? []) for (const part of item.parts) {
      if (part.kind === "text") out.add(paperFontVariant(part.font, part.bold, part.italic === true));
    }
    for (const item of sheet.descriptions) description(item.layout);
    for (const frame of sheet.frames) figures(frame.figures);
  }
  if (map) {
    const visit = (id: string, depth: number, seen: ReadonlySet<string>) => {
      if (depth > 8 || seen.has(id)) return;
      const symbol = map.symbols.get(id);
      if (!symbol) return;
      if (symbol.kind === "TEXT") out.add(variantForFamily(symbol.fontFamily, symbol.bold, symbol.italic));
      else if (symbol.kind === "COMBINED") {
        const next = new Set(seen).add(id);
        for (const part of symbol.parts) visit(part, depth + 1, next);
      }
    };
    const used = new Set(map.objects.filter(object => object.kind === "text").map(object => object.symbol));
    for (const id of used) visit(id, 0, new Set());
  }
  return out;
}

/** Utsnittets nyckel: samma kartyta, storlek och skala ger samma XObject (som förhandsvisningens `frameImageKey`). */
function frameKey(frame: SheetFrame): string {
  return `${frame.mapArea.minX.toFixed(3)},${frame.mapArea.maxY.toFixed(3)},${frame.clip.width.toFixed(3)},${frame.clip.height.toFixed(3)},${frame.transform.scale.toFixed(8)}${frame.mapPasses ? `|${passesKey(frame.mapPasses)}` : ""}`;
}

/** Funktionen från dekorfärgernas andelar till CMYK: typ 2 för en plåt, typ 4 (summan, högst 1) för flera. */
function tintFunction(document: PDFDocument, alternates: readonly Cmyk[]): PDFRef {
  const context = document.context;
  if (alternates.length === 1) {
    const cmyk = alternates[0]!;
    return context.register(context.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [cmyk.c, cmyk.m, cmyk.y, cmyk.k], N: 1 }));
  }
  const n = alternates.length;
  const channels = (["c", "m", "y", "k"] as const).map((channel, j) => {
    // Stacken: t1 … tn och j färdiga utdata; ti ligger på djupet (n − i + j) räknat från toppen (0), +1 för summan.
    const terms = alternates.map((cmyk, i) => `${n - (i + 1) + j + 1} index ${num(cmyk[channel])} mul add`).join(" ");
    return `0 ${terms} dup 1 gt { pop 1 } if`;
  });
  const code = `{ ${channels.join(" ")} ${n + 4} 4 roll ${Array.from({ length: n }, () => "pop").join(" ")} }`;
  return context.register(context.stream(code, { FunctionType: 4, Domain: Array.from({ length: n }, () => [0, 1]).flat(),
    Range: [0, 1, 0, 1, 0, 1, 0, 1] }));
}

const PDF_NAME_DELIMITERS = new Set([0x23, 0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const UTF8_ENCODER = new TextEncoder();

/**
 * UTF-8-säkert PDF-namn för dekorfärger enligt ISO 32000-1 §7.3.5: bytes < 0x21, > 0x7e eller PDF-delimiters kodas
 * med 2-siffrig `#XX`-hex så att `pdf-lib` inte skriver Latin-1 eller ogiltiga 4-hex-escapes (`#2013`).
 */
function pdfSpotName(name: string): PDFName {
  let encoded = "";
  for (const byte of UTF8_ENCODER.encode(name)) {
    encoded += byte < 0x21 || byte > 0x7e || PDF_NAME_DELIMITERS.has(byte)
      ? `#${byte.toString(16).toUpperCase().padStart(2, "0")}`
      : String.fromCharCode(byte);
  }
  return PDFName.of(encoded);
}

/** Papperets färg (#rrggbb) som CMYK utan övertryck. */
const hexPaint = (hex: string): Paint => ({ ink: { kind: "CMYK", cmyk: cmykOfHex(hex) }, overprint: false });

/** Rektangel med rundade hörn (papperets mm, y nedåt) som väg i punkter. */
function roundedRect(x: number, y: number, w: number, h: number, radius: number, pageHeight: number): string {
  const r = Math.min(radius, w / 2, h / 2), k = 0.5523 * r;
  const P = (px: number, py: number) => `${num(px * PT_PER_MM)} ${num((pageHeight - py) * PT_PER_MM)}`;
  return [`${P(x + r, y)} m`, `${P(x + w - r, y)} l`, `${P(x + w - r + k, y)} ${P(x + w, y + r - k)} ${P(x + w, y + r)} c`, `${P(x + w, y + h - r)} l`,
    `${P(x + w, y + h - r + k)} ${P(x + w - r + k, y + h)} ${P(x + w - r, y + h)} c`, `${P(x + r, y + h)} l`, `${P(x + r - k, y + h)} ${P(x, y + h - r + k)} ${P(x, y + h - r)} c`,
    `${P(x, y + r)} l`, `${P(x, y + r - k)} ${P(x + r - k, y)} ${P(x + r, y)} c`, "h"].join(" ");
}

export async function writeSheetsPdf(input: WritePdfInput): Promise<WritePdfResult> {
  const notes = new Set<string>();
  const document = await PDFDocument.create({ updateMetadata: false });
  const now = input.now ?? new Date();
  document.setTitle(input.title ?? "O-Tid banor");
  document.setProducer("O-Tid (pdf-lib)");
  document.setCreator("O-Tid banläggning");
  document.setCreationDate(now);
  document.setModificationDate(now);

  const fonts = new Fonts(input.fonts);
  await fonts.embed(document, neededFonts(input.sheets, input.map));

  // Bilderna (logotyper och specialobjektens bilder) bäddas in före ritningen.
  const images = new Map<string, { name: string; width: number; height: number; ref: PDFRef } | null>();
  const wanted: { mediaType: string; data: string }[] = [];
  for (const sheet of input.sheets) {
    for (const image of sheet.images) wanted.push(image);
    for (const frame of sheet.frames) for (const figure of frame.figures) if (figure.kind === "image") wanted.push(figure);
  }
  for (const image of wanted) {
    if (images.has(image.data)) continue;
    try {
      const bytes = base64Bytes(image.data);
      const embedded = image.mediaType === "image/png" ? await document.embedPng(bytes) : image.mediaType === "image/jpeg" ? await document.embedJpg(bytes) : undefined;
      if (!embedded) { notes.add(`Bilder i ${image.mediaType} kan inte skrivas till PDF:en (bara PNG och JPEG) och utelämnas.`); images.set(image.data, null); continue; }
      images.set(image.data, { name: `Im${images.size}`, width: embedded.width, height: embedded.height, ref: embedded.ref });
    } catch {
      notes.add("En bild gick inte att läsa och utelämnas.");
      images.set(image.data, null);
    }
  }
  // Papperets bilder (ADR-0197) ur bildlagret, en gång per bild.
  const paperImages = new Map<string, { name: string; ref: PDFRef } | null>();
  for (const sheet of input.sheets) for (const item of sheet.paperItems ?? []) for (const part of item.parts) {
    if (part.kind !== "image" || paperImages.has(part.image)) continue;
    const source = input.paperImages?.get(part.image);
    if (!source) { notes.add("En bild på papperet finns inte i bildlagret och utelämnas."); paperImages.set(part.image, null); continue; }
    try {
      const embedded = source.mediaType === "image/png" ? await document.embedPng(source.bytes) : await document.embedJpg(source.bytes);
      paperImages.set(part.image, { name: `Ip${paperImages.size}`, ref: embedded.ref });
    } catch {
      notes.add("En bild på papperet gick inte att läsa och utelämnas.");
      paperImages.set(part.image, null);
    }
  }
  if ([...images.values(), ...paperImages.values()].some(Boolean)) notes.add("Bilderna skrivs i RGB som de är; be tryckeriet kontrollera dem.");
  // Täckningen för papperets bilder (en ExtGState per värde).
  const opacities = new Map<string, number>();
  const imageFor = (_mediaType: string, data: string) => images.get(data) ?? undefined;

  const plates = new Plates(notes);
  // BL-profilerna vill ha CMYK (processfärger): PDF:en för tryck skrivs då med kartan i CMYK.
  const mode: PdfMode = input.mode === "PRESS" && input.profile.processColors ? "PROCESS" : input.mode;
  if (mode !== input.mode) notes.add(`Profilen ${input.profile.name} vill ha CMYK: kartan och banan skrivs som processfärger utan dekorfärger.`);
  const paintOptions = { mode, profile: input.profile };
  const course = coursePaint(paintOptions, plates);
  const paints = input.map ? mapPaints(input.map, paintOptions, plates, notes) : new Map<number, Paint | null>();
  plates.report();
  const registration = registrationPaint(paintOptions);
  const spaces = new ColorSpaces();
  const symbols = new Map(descriptionSymbols(input.descriptionStandard ?? "2018").map(symbol => [symbol.id, symbol]));
  let overprintUsed = false;
  let mapBlendUsed = false;

  // Kartans utsnitt som Form XObject (koordinater: punkter från ramens nedre vänstra hörn).
  const forms = new Map<string, { name: string; stream: PDFRawStream; ref: PDFRef } | null>();
  let formCount = 0;
  const adjust = input.map ? mapColorAdjust(input.profile, input.map.colors) : undefined;
  const hiddenColors = new Set<number>();
  for (const [id, paint] of paints) if (paint === null) hiddenColors.add(id);
  // Banan i färgordningen:
  // - OFFICE: ALL (knockout) → LOWER → OVER i sammanhängande INK/WHITE-band (varje INK-band är en isolerad
  //   DeviceCMYK-transparensgrupp med knockout inuti, placerad med /BM /Darken; WHITE-band placeras med knockout).
  // - PROCESS (inkl. BL): ren enpass-ordning UNDER → LOWER → OVER med knockout (noll 308–375 % TAC-blödning).
  // - PRESS: ALL → LOWER → OVER med kartfilens egna övertrycksflaggor (vitt alltid knockout).
  const over = input.map ? colorsOverCourse(input.map, input.profile) : undefined;
  const overBands: readonly OverColorBand[] = input.map && over && mode === "OFFICE"
    ? overColorBands(input.map.colors, over, adjust) : [];
  const norm: PressNorm = input.map ? pressNormFor(input.map, input.profile) : "ISOM";
  const numbersOnTop = input.profile.numbersOnTop ?? false;
  if (input.map && over) {
    const names = input.map.colors.filter(color => over.has(color.id) && !hiddenColors.has(color.id)).sort((a, b) => a.rank - b.rank).map(color => color.name);
    const how = mode === "OFFICE" ? "(lila syns genom dem, som övertryck)" : mode === "PROCESS" ? "(ren CMYK-ordning utan övertryck)" : "med kartans övertryck";
    notes.add(`Banan ligger i färgordningen enligt ${norm === "ISSPROM" ? "ISSprOM 2019-2" : "ISOM 2017-2"}: undre lila under ${names.length} kartfärger (${names.slice(0, 5).join(", ")}${names.length > 5 ? " m.fl." : ""}) ${how}, ${norm === "ISSPROM" || numbersOnTop ? "nummer och markeringar överst" : "numren i undre lila, markeringar överst"}.`);
  }
  const underIds = input.map && over && mode === "PROCESS"
    ? new Set(input.map.colors.filter(color => !over.has(color.id) && !hiddenColors.has(color.id)).map(color => color.id)) : undefined;
  const overIds = input.map && over
    ? new Set(input.map.colors.filter(color => over.has(color.id) && !hiddenColors.has(color.id)).map(color => color.id)) : undefined;

  interface MapFormSpec {
    readonly suffix: string;
    readonly onlyColors?: ReadonlySet<number> | undefined;
    readonly background: boolean;
    readonly forceKnockout: boolean;
    readonly isolatedGroup: boolean;
    readonly skipEmpty?: boolean | undefined;
  }

  const buildMapForm = (frame: SheetFrame, spec: MapFormSpec) => {
    const key = `${frameKey(frame)}|${spec.suffix}`;
    if (forms.has(key)) return forms.get(key) ?? undefined;
    if (!input.map) return undefined;
    const content = new Content(spaces);
    const w = frame.clip.width, h = frame.clip.height;
    const canvas = new PdfCanvas({
      device: [PT_PER_MM, 0, 0, -PT_PER_MM, 0, h * PT_PER_MM],
      width: w,
      height: h,
      content,
      fonts,
      paintFor: (color: MapColor) => {
        const paint = paints.get(color.id) ?? null;
        if (!paint) return null;
        if (spec.forceKnockout || isWhiteInk(paint.ink)) return paint.overprint ? { ...paint, overprint: false } : paint;
        return paint;
      }
    });
    // Träningsläget (ADR-0192 beslut 9): kartan i pass med klippning och filter; dolda färger filtreras före ritning.
    const report = drawTrainingMap(canvas, cullMap(input.map, frame.mapArea), {
      pxPerMm: frame.transform.scale,
      origin: { x: frame.mapArea.minX, y: frame.mapArea.maxY },
      beforeColor: canvas.beforeColor,
      maxPatternInstances: input.maxPatternInstances ?? PDF_MAX_PATTERN_INSTANCES,
      ...(spec.onlyColors ? { onlyColors: spec.onlyColors } : {}),
      ...(hiddenColors.size > 0 ? { excludeColors: hiddenColors } : {}),
      ...(spec.background ? {} : { background: false })
    }, frame.mapPasses);
    for (const text of report.simplifications) {
      if (/Dekorfärger och övertryck|standardtypsnitt/.test(text)) continue;
      notes.add(`Kartan: ${text}.`);
    }
    if (input.map.objects.some(object => object.kind === "text")) notes.add("Kartans texter skrivs med Roboto (inbäddat), vänsterställda som på skärmen.");
    if (spec.skipEmpty && canvas.painted === 0) {
      forms.set(key, null);
      return undefined;
    }
    if (mode !== "OFFICE") overprintUsed ||= content.overprintUsed;
    const stream = document.context.flateStream(content.text(), {
      Type: "XObject", Subtype: "Form", BBox: [0, 0, w * PT_PER_MM, h * PT_PER_MM],
      ...(spec.isolatedGroup ? { Group: document.context.obj({ S: PDFName.of("Transparency"), CS: PDFName.of("DeviceCMYK"), I: true }) } : {})
    });
    const created = { name: `Fm${formCount++}`, stream, ref: document.context.register(stream) };
    forms.set(key, created);
    return created;
  };

  const pages: ReturnType<PDFDocument["addPage"]>[] = [];
  const pageTexts: { page: ReturnType<PDFDocument["addPage"]>; ref: PDFRef; text: string; key: string }[] = [];
  for (const sheet of input.sheets) {
    const W = sheet.paper.widthMm, H = sheet.paper.heightMm;
    const page = document.addPage([W * PT_PER_MM, H * PT_PER_MM]);
    page.setTrimBox(0, 0, W * PT_PER_MM, H * PT_PER_MM);
    pages.push(page);
    const content = new Content(spaces);
    let pageHasTransparency = false;
    const figureContext: FigureContext = { content, fonts, course, symbols, image: imageFor, notes };
    // Papperets mm (y nedåt) → punkter (y uppåt).
    const paperMatrix: Matrix = [PT_PER_MM, 0, 0, -PT_PER_MM, 0, H * PT_PER_MM];
    const rect = (x: number, y: number, w: number, h: number) =>
      `${num(x * PT_PER_MM)} ${num((H - y - h) * PT_PER_MM)} ${num(w * PT_PER_MM)} ${num(h * PT_PER_MM)} re`;
    for (const frame of sheet.frames) {
      const { clip } = frame;
      const frameRect = rect(clip.x, clip.y, clip.width, clip.height);
      // "Vitt på utskriften" (ADR-0211 beslut 8): en separat `frameRect wp W* n` per polygon så överlappande ytor aldrig tar ut varandra.
      const whitePaths = (frame.whiteAreas ?? []).map(polygon =>
        `${polygon.map((p, index) => `${num(p.x * PT_PER_MM)} ${num((H - p.y) * PT_PER_MM)} ${index === 0 ? "m" : "l"}`).join(" ")} h`);
      const outsideWhiteClips = whitePaths.map(wp => `${frameRect} ${wp} W* n`);
      const paintWhite = () => {
        if (whitePaths.length === 0) return;
        content.save();
        content.op(`${frameRect} W n`);
        content.fill(WHITE);
        for (const wp of whitePaths) content.op(`${wp} f`);
        content.restore();
      };
      const place = (form: { name: string } | undefined, excludeWhite = false, clips: readonly string[] = [], blend = false) => {
        if (!form) return;
        content.save();
        content.op(`${frameRect} W n`);
        if (excludeWhite) for (const clipOp of outsideWhiteClips) content.op(clipOp);
        for (const extra of clips) content.op(extra);
        content.setOverprint(blend);
        if (blend && mode === "OFFICE") { mapBlendUsed = true; pageHasTransparency = true; }
        // Spegelorientering (ADR-0192 beslut 12): kartbilden vänds kring ramens mitt; figurerna är redan speglade.
        const a = frame.mirror ? -1 : 1, x0 = frame.mirror ? clip.x + clip.width : clip.x;
        content.op(`${a} 0 0 1 ${num(x0 * PT_PER_MM)} ${num((H - clip.y - clip.height) * PT_PER_MM)} cm /${form.name} Do`);
        content.restore();
      };
      // Kartans mm (y uppåt) → sidans mm (y nedåt) → punkter: x = K(s·x + tx), y = K(H − (−s·y + ty)).
      const s = frame.transform.scale;
      const mapMatrix: Matrix = [PT_PER_MM * s, 0, 0, PT_PER_MM * s, PT_PER_MM * frame.transform.translateX, PT_PER_MM * (H - frame.transform.translateY)];
      // Papperets klippning (ADR-0197): gruppera på exakt par `(inMarked, inWhite)` så omarkerade specialobjekt aldrig klipps av `markingPath`.
      const marked = new Set(frame.markingClip?.refs ?? []);
      const isSpecial = (figure: OverprintPrimitive) => figure.role === "SPECIAL" && figure.kind !== "description" && figure.ref !== undefined;
      const markingPolygon = frame.markingClip
        ? `${frame.markingClip.polygon.map((p, index) => `${num(p.x * PT_PER_MM)} ${num((H - p.y) * PT_PER_MM)} ${index === 0 ? "m" : "l"}`).join(" ")} h` : "";
      const markingPath = markingPolygon ? `${markingPolygon} W n` : "";
      const hasWhiteClips = outsideWhiteClips.length > 0;
      const clipKey = (figure: OverprintPrimitive): string => {
        if (!isSpecial(figure)) return "0:0";
        const inMarked = markingPath !== "" && marked.has(figure.ref!);
        return `${inMarked ? 1 : 0}:${hasWhiteClips ? 1 : 0}`;
      };
      const figures = (list: readonly OverprintPrimitive[]) => {
        if (list.length === 0) return;
        content.save();
        content.op(`${frameRect} W n`);
        if (marked.size === 0 && !hasWhiteClips) figureOps(figureContext, mapMatrix, list);
        else {
          let run: OverprintPrimitive[] = [], runKey = "0:0";
          const flush = () => {
            if (run.length === 0) return;
            if (runKey !== "0:0") {
              const [inMarked, inWhite] = runKey.split(":");
              content.save();
              if (inMarked === "1" && markingPath) content.op(markingPath);
              if (inWhite === "1") for (const clipOp of outsideWhiteClips) content.op(clipOp);
              figureOps(figureContext, mapMatrix, run);
              content.restore();
            } else figureOps(figureContext, mapMatrix, run);
            run = [];
          };
          for (const figure of list) {
            const key = clipKey(figure);
            if (key !== runKey) { flush(); runKey = key; }
            run.push(figure);
          }
          flush();
        }
        content.restore();
      };
      if (over) {
        const layer = (figure: OverprintPrimitive) => courseLayerOf(figure, norm, numbersOnTop);
        const beneath = frame.figures.filter(figure => layer(figure) === "BENEATH");
        const covers = beneath.map(figure => ({ ref: figure.ref, path: coverPath(figure, mapMatrix) })).filter(cover => cover.path !== "");
        const unmarkedCoverClips = covers.filter(cover => !marked.has(cover.ref ?? "")).map(cover => `${frameRect} ${cover.path} W* n`);
        const baseForm = mode === "PROCESS"
          ? buildMapForm(frame, { suffix: "UNDER", onlyColors: underIds, background: true, forceKnockout: false, isolatedGroup: false })
          : buildMapForm(frame, { suffix: "ALL", background: true, forceKnockout: mode === "OFFICE", isolatedGroup: false });
        place(baseForm);
        paintWhite();
        figures(beneath);
        figures(frame.figures.filter(figure => layer(figure) === "LOWER"));
        const placeOver = (excludeWhite: boolean, clips: readonly string[]) => {
          if (mode === "OFFICE") {
            overBands.forEach((band, index) => {
              const form = buildMapForm(frame, {
                suffix: `BAND:${index}:${band.kind}`,
                onlyColors: new Set(band.ids),
                background: false,
                forceKnockout: true,
                isolatedGroup: band.kind === "INK",
                skipEmpty: true
              });
              place(form, excludeWhite, clips, band.kind === "INK");
            });
          } else {
            const overForm = buildMapForm(frame, {
              suffix: "OVER",
              onlyColors: overIds,
              background: false,
              forceKnockout: mode === "PROCESS",
              isolatedGroup: false
            });
            place(overForm, excludeWhite, clips, false);
          }
        };
        // En täckning per klippning (jämn–udda mot ramen): överlappande ytor tar då inte ut varandra.
        placeOver(true, covers.map(cover => `${frameRect} ${cover.path} W* n`));
        // En täckning som papperets klippning skär (ADR-0197) syns bara innanför: utanför ritas kartan över banan (men inte i övriga omarkerade täckningar).
        for (const cover of covers) {
          if (markingPolygon && marked.has(cover.ref ?? "")) {
            placeOver(true, [`${cover.path} W* n`, `${frameRect} ${markingPolygon} W* n`, ...unmarkedCoverClips]);
          }
        }
        figures(frame.figures.filter(figure => layer(figure) === "UPPER"));
      } else {
        place(buildMapForm(frame, { suffix: "ALL", background: true, forceKnockout: mode === "OFFICE", isolatedGroup: false }));
        paintWhite();
        figures(frame.figures);
      }
    }
    for (const box of sheet.boxes) {
      content.fill(WHITE);
      content.op(`${rect(box.x, box.y, box.width, box.height)} f`);
      if (box.border) {
        content.stroke(BLACK);
        content.lineStyle(0.25 * PT_PER_MM, 0, 0);
        content.op(`${rect(box.x, box.y, box.width, box.height)} S`);
      }
    }
    for (const image of sheet.images) {
      const embedded = images.get(image.data);
      if (!embedded) continue;
      // Som förhandsvisningen (preserveAspectRatio meet): hela bilden i rutan, centrerad.
      const scale = Math.min(image.width / embedded.width, image.height / embedded.height);
      const w = embedded.width * scale, h = embedded.height * scale;
      const x = image.x + (image.width - w) / 2, y = image.y + (image.height - h) / 2;
      content.save();
      content.op(`${num(w * PT_PER_MM)} 0 0 ${num(h * PT_PER_MM)} ${num(x * PT_PER_MM)} ${num((H - y - h) * PT_PER_MM)} cm /${embedded.name} Do`);
      content.restore();
    }
    // Papperets element (ADR-0197): vita och svarta ytor, texter och bilder, som förhandsvisningen.
    for (const item of sheet.paperItems ?? []) for (const part of item.parts) {
      switch (part.kind) {
        case "rect": {
          // Ramar (ADR-0211 beslut 8): egna färger och rundade hörn.
          const path = part.radius ? roundedRect(part.x, part.y, part.width, part.height, part.radius, H) : rect(part.x, part.y, part.width, part.height);
          if (part.fillColor || part.fill) { content.fill(part.fillColor ? hexPaint(part.fillColor) : part.fill === "BLACK" ? BLACK : WHITE); content.op(`${path} f`); }
          if (part.stroke) { content.stroke(part.strokeColor ? hexPaint(part.strokeColor) : BLACK); content.lineStyle(part.stroke * PT_PER_MM, 0, 0); content.op(`${path} S`); }
          break;
        }
        case "line": {
          content.stroke(hexPaint(part.color));
          content.lineStyle(part.width * PT_PER_MM, 0, 0);
          content.op(`${num(part.x1 * PT_PER_MM)} ${num((H - part.y1) * PT_PER_MM)} m ${num(part.x2 * PT_PER_MM)} ${num((H - part.y2) * PT_PER_MM)} l S`);
          break;
        }
        case "polygon": {
          const path = `${part.points.map((p, index) => `${num(p.x * PT_PER_MM)} ${num((H - p.y) * PT_PER_MM)} ${index === 0 ? "m" : "l"}`).join(" ")} h`;
          content.fill(part.fill === "BLACK" ? BLACK : WHITE);
          content.op(`${path} f`);
          if (part.stroke) { content.stroke(BLACK); content.lineStyle(part.stroke * PT_PER_MM, 0, 0); content.op(`${path} S`); }
          break;
        }
        case "text": {
          const ops = textOps(figureContext, paperMatrix, part.text, part.at, part.heightMm, paperFontVariant(part.font, part.bold, part.italic === true),
            part.align, { yDown: true, tracking: part.tracking });
          if (!ops) break;
          content.fill(part.color ? hexPaint(part.color) : BLACK);
          content.op(ops);
          break;
        }
        // QR-kodens moduler (ägaren 2026-11-16): en enda fylld väg av rutor i svart, aldrig en rasterbild.
        case "cells": {
          if (part.rects.length === 0) break;
          content.fill(BLACK);
          content.op(`${part.rects.map(r => rect(r.x, r.y, r.width, r.height)).join(" ")} f`);
          break;
        }
        case "image": {
          const embedded = paperImages.get(part.image);
          if (!embedded) break;
          content.save();
          if (part.opacity < 1) {
            const name = `GA${Math.round(part.opacity * 100)}`;
            opacities.set(name, Math.round(part.opacity * 100) / 100);
            content.op(`/${name} gs`);
            pageHasTransparency = true;
          }
          content.op(`${num(part.width * PT_PER_MM)} 0 0 ${num(part.height * PT_PER_MM)} ${num(part.x * PT_PER_MM)} ${num((H - part.y - part.height) * PT_PER_MM)} cm /${embedded.name} Do`);
          content.restore();
          break;
        }
      }
    }
    for (const item of sheet.descriptions) {
      const local: Matrix = [PT_PER_MM, 0, 0, -PT_PER_MM, item.x * PT_PER_MM, (H - item.y) * PT_PER_MM];
      descriptionOps(figureContext, local, item.layout, BLACK);
    }
    for (const text of sheet.texts) {
      const ops = textOps(figureContext, paperMatrix, text.text, text.at, text.heightMm, text.bold ? "bold" : "regular", text.align,
        { yDown: true, rotation: text.rotation });
      if (!ops) continue;
      content.fill(text.color === "COURSE" ? course : BLACK);
      content.op(ops);
    }
    if (sheet.cutMarks.length > 0) {
      content.stroke(registration);
      content.lineStyle(0.15 * PT_PER_MM, 0, 0);
      content.op(`${sheet.cutMarks.map(mark => `${num(mark.x1 * PT_PER_MM)} ${num((H - mark.y1) * PT_PER_MM)} m ${num(mark.x2 * PT_PER_MM)} ${num((H - mark.y2) * PT_PER_MM)} l`).join(" ")} S`);
    }
    if (mode === "OFFICE") {
      if (content.overprintUsed) pageHasTransparency = true;
    } else {
      overprintUsed ||= content.overprintUsed;
    }
    if (pageHasTransparency) {
      page.node.set(PDFName.of("Group"), document.context.obj({ S: PDFName.of("Transparency"), CS: PDFName.of("DeviceCMYK") }));
    }
    // Innehållet registreras här som förut (samma objektordning, så att en fil utan återkommande sidor är byte för byte
    // densamma som tidigare); en sida som visar sig återkomma får sitt innehåll utbytt nedan.
    const ref = document.context.register(document.context.flateStream(content.text()));
    page.node.set(PDFName.of("Contents"), ref);
    pageTexts.push({ page, ref, text: content.text(), key: `${num(W)}x${num(H)}:${content.text()}` });
  }
  // Ägaren 2026-11-13 («skrivaren verkar behöva hantera varje sida för sig i stället för att skriva ut samma flera gånger»):
  // med en baksida per löpare är framsidan densamma på många ark. En sida vars innehåll återkommer läggs en enda gång i filen
  // som en Form XObject som alla de arken pekar på, så att en skrivare eller ett tryckerisystem som sparar återanvända block
  // tolkar den en gång. Sidor som bara finns en gång (baksidorna) skrivs som förut.
  const repeats = new Map<string, number>();
  for (const { key } of pageTexts) repeats.set(key, (repeats.get(key) ?? 0) + 1);
  const pageForms = new Map<string, { name: string; ref: PDFRef; stream: ReturnType<typeof document.context.flateStream> }>();
  for (const { page, ref, text, key } of pageTexts) {
    if ((repeats.get(key) ?? 0) < 2) continue;
    let form = pageForms.get(key);
    if (!form) {
      const { width, height } = page.getSize();
      const stream = document.context.flateStream(text, { Type: "XObject", Subtype: "Form", BBox: [0, 0, width, height] });
      form = { name: `Pg${pageForms.size + 1}`, ref: document.context.register(stream), stream };
      pageForms.set(key, form);
    }
    document.context.assign(ref, document.context.flateStream(`/${form.name} Do`));
  }

  // Resurserna delas av alla sidor och utsnitt: färgrymderna, övertrycket, typsnitten och bilderna.
  const context = document.context;
  const colorSpaces: Record<string, PDFRef> = {};
  for (const entry of spaces.spaces) {
    const fn = tintFunction(document, entry.space.alternates);
    const value = entry.space.names.length === 1
      ? context.obj([PDFName.of("Separation"), pdfSpotName(entry.space.names[0]!), PDFName.of("DeviceCMYK"), fn])
      : context.obj([PDFName.of("DeviceN"), entry.space.names.map(name => pdfSpotName(name)), PDFName.of("DeviceCMYK"), fn]);
    colorSpaces[entry.name] = context.register(value);
  }
  const extGState = {
    // Kontorsskrivaren: "övertrycket" är blandningen Darken (syns i alla visare och skrivare); tryck: äkta övertryck, ingen genomskinlighet.
    [GS_OVERPRINT]: context.register(mode === "OFFICE" ? context.obj({ Type: "ExtGState", BM: PDFName.of("Darken") })
      : context.obj({ Type: "ExtGState", OP: true, op: true, OPM: 1 })),
    [GS_KNOCKOUT]: context.register(mode === "OFFICE" ? context.obj({ Type: "ExtGState", BM: PDFName.of("Normal") })
      : context.obj({ Type: "ExtGState", OP: false, op: false, OPM: 1 })),
    ...Object.fromEntries([...opacities].map(([name, value]) => [name, context.register(context.obj({ Type: "ExtGState", ca: value, CA: value }))]))
  };
  const fontDict = Object.fromEntries(fonts.all().map(font => [font.name, font.font.ref]));
  const shared = { ColorSpace: context.register(context.obj(colorSpaces)), ExtGState: context.register(context.obj(extGState)),
    Font: context.register(context.obj(fontDict)), ProcSet: [PDFName.of("PDF"), PDFName.of("Text"), PDFName.of("ImageB"), PDFName.of("ImageC")] };
  const formResources = context.register(context.obj(shared));
  const xobjects: Record<string, PDFRef> = {};
  for (const form of forms.values()) { if (!form) continue; form.stream.dict.set(PDFName.of("Resources"), formResources); xobjects[form.name] = form.ref; }
  for (const image of images.values()) if (image) xobjects[image.name] = image.ref;
  for (const image of paperImages.values()) if (image) xobjects[image.name] = image.ref;
  // De återanvända sidorna ritar kartutsnitt och bilder själva; sidorna som pekar på dem behöver bara sidblocket.
  const contentResources = context.register(context.obj({ ...shared, XObject: context.register(context.obj(xobjects)) }));
  for (const form of pageForms.values()) form.stream.dict.set(PDFName.of("Resources"), contentResources);
  const pageResources = pageForms.size === 0 ? contentResources
    : context.register(context.obj({ ...shared, XObject: context.register(context.obj({ ...xobjects, ...Object.fromEntries([...pageForms.values()].map(form => [form.name, form.ref])) })) }));
  for (const page of pages) page.node.set(PDFName.of("Resources"), pageResources);

  // Dubbelsidigt: utskriftsdialogens förslag på vändningskant (`duplexEdge`).
  const edge = duplexEdge(input.sheets);
  if (edge) document.catalog.getOrCreateViewerPreferences().setDuplex(edge === "LONG" ? Duplex.DuplexFlipLongEdge : Duplex.DuplexFlipShortEdge);

  const bytes = await document.save({ useObjectStreams: false });
  if (mapBlendUsed) notes.add("Kontorsskrivaren: kartans färger över banan ritas så att lila syns genom dem som på tryck.");
  return { bytes, pages: pages.length, plates: spaces.plates().filter(name => name !== "All"), overprint: overprintUsed, mapForms: formCount, sharedPages: pageForms.size,
    notes: [...notes], overCourse: over ? [...over] : [] };
}
