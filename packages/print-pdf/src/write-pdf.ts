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
  coursePlacement, decisionFor, descriptionSymbols, drawTrainingMap, passesKey, PDF_PRINT_CAPABILITIES, sourceMapColors, type DescriptionStandard, type OverprintPrimitive, type PrintProfile,
  type Sheet, type SheetFrame
} from "@o-tid/course-setting";
import { type MapColor, type MapObject, type ParsedMap, type Path } from "@o-tid/map-file";
import { ColorSpaces, Content, GS_KNOCKOUT, GS_OVERPRINT, num } from "./content";
import { descriptionOps, figureOps, textOps, type FigureContext, type Matrix } from "./figures";
import { Fonts, fontVariant, variantForFamily, type FontFiles, type FontVariant } from "./fonts";
import { PdfCanvas } from "./pdf-canvas";
import { BLACK, coursePaint, mapPaints, Plates, registrationPaint, WHITE, type Cmyk, type Paint, type PdfMode } from "./paint";

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
  /** Notiser till arrangören på svenska (förenklingar, avvikande dekorfärger, bilder som inte kunde skrivas). */
  readonly notes: readonly string[];
  /** Kartfärgerna (id) som ritas över banan när banan ligger i färgordningen (BL); tom = banan överst. */
  readonly overCourse: readonly number[];
}

/**
 * Banans plats i kartans färgordning (BL-profilerna, `courseLayer: "REFERENCE"`): färgerna som ritas över banan, ur det
 * godkända förslaget. `undefined` = banan överst (Purple Pens sätt, eller inget godkänt att gå efter).
 */
export function colorsOverCourse(map: Pick<ParsedMap, "colors">, profile: PrintProfile): ReadonlySet<number> | undefined {
  const table = profile.reference;
  if (profile.courseLayer !== "REFERENCE" || !table) return undefined;
  const placement = coursePlacement(table, sourceMapColors(map.colors), color => decisionFor(profile.colorDecisions, color)?.row);
  return placement.position === null || placement.above.size === 0 ? undefined : placement.above;
}

/** Figurerna som hör till banan i färgordningen: ringar, linjer, siffror och undre lila; beskrivningar, bilder och texter ligger överst. */
export function inCourseLayer(figure: OverprintPrimitive): boolean {
  if (figure.kind === "image" || figure.kind === "description") return false;
  if (figure.color !== "COURSE" && figure.color !== "COURSE_LOWER") return false;
  return !(figure.role === "SPECIAL" && figure.kind === "text");
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
    for (const item of sheet.paperItems ?? []) for (const part of item.parts) if (part.kind === "text") out.add(part.bold ? "bold" : "regular");
    for (const item of sheet.descriptions) description(item.layout);
    for (const frame of sheet.frames) figures(frame.figures);
  }
  if (map) {
    const used = new Set(map.objects.filter(object => object.kind === "text").map(object => object.symbol));
    for (const id of used) {
      const symbol = map.symbols.get(id);
      if (symbol?.kind === "TEXT") out.add(variantForFamily(symbol.fontFamily, symbol.bold, symbol.italic));
    }
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

  // Kartans utsnitt som Form XObject (koordinater: punkter från ramens nedre vänstra hörn).
  const forms = new Map<string, { name: string; stream: PDFRawStream; ref: PDFRef }>();
  // Banan i färgordningen: kartan i två utsnitt per ram, färgerna under banan (med papperets vitt) och färgerna över.
  const over = input.map ? colorsOverCourse(input.map, input.profile) : undefined;
  if (input.map && over) {
    const names = input.map.colors.filter(color => over.has(color.id)).sort((a, b) => a.rank - b.rank).map(color => color.name);
    notes.add(`Banan ligger i kartans färgordning enligt ${input.profile.reference?.title ?? "profilen"}: under ${names.length} kartfärger (${names.slice(0, 5).join(", ")}${names.length > 5 ? " m.fl." : ""}).`);
  }
  const mapForm = (frame: SheetFrame, part: "ALL" | "UNDER" | "OVER" = "ALL") => {
    const key = `${frameKey(frame)}|${part}`;
    const known = forms.get(key);
    if (known || !input.map) return known;
    const content = new Content(spaces);
    const w = frame.clip.width, h = frame.clip.height;
    const canvas = new PdfCanvas({ device: [PT_PER_MM, 0, 0, -PT_PER_MM, 0, h * PT_PER_MM], width: w, height: h, content, fonts,
      paintFor: (color: MapColor) => paints.get(color.id) ?? null });
    const onlyColors = part === "ALL" || !over ? undefined
      : new Set(input.map.colors.filter(color => (part === "OVER") === over.has(color.id)).map(color => color.id));
    // Träningsläget (ADR-0192 beslut 9): kartan i pass med klippning och filter, i båda delarna när banan ligger i färgordningen.
    const report = drawTrainingMap(canvas, cullMap(input.map, frame.mapArea), { pxPerMm: frame.transform.scale, origin: { x: frame.mapArea.minX, y: frame.mapArea.maxY },
      beforeColor: canvas.beforeColor, maxPatternInstances: input.maxPatternInstances ?? PDF_MAX_PATTERN_INSTANCES,
      ...(onlyColors ? { onlyColors } : {}), ...(part === "OVER" ? { background: false } : {}) }, frame.mapPasses);
    for (const text of report.simplifications) {
      if (/Dekorfärger och övertryck|standardtypsnitt/.test(text)) continue;
      notes.add(`Kartan: ${text}.`);
    }
    if (input.map.objects.some(object => object.kind === "text")) notes.add("Kartans texter skrivs med Roboto (inbäddat), vänsterställda som på skärmen.");
    overprintUsed ||= content.overprintUsed;
    const stream = document.context.flateStream(content.text(), { Type: "XObject", Subtype: "Form", BBox: [0, 0, w * PT_PER_MM, h * PT_PER_MM] });
    const created = { name: `Fm${forms.size}`, stream, ref: document.context.register(stream) };
    forms.set(key, created);
    return created;
  };

  const pages: ReturnType<PDFDocument["addPage"]>[] = [];
  for (const sheet of input.sheets) {
    const W = sheet.paper.widthMm, H = sheet.paper.heightMm;
    const page = document.addPage([W * PT_PER_MM, H * PT_PER_MM]);
    page.setTrimBox(0, 0, W * PT_PER_MM, H * PT_PER_MM);
    pages.push(page);
    const content = new Content(spaces);
    const figureContext: FigureContext = { content, fonts, course, symbols, image: imageFor, notes };
    // Papperets mm (y nedåt) → punkter (y uppåt).
    const paperMatrix: Matrix = [PT_PER_MM, 0, 0, -PT_PER_MM, 0, H * PT_PER_MM];
    const rect = (x: number, y: number, w: number, h: number) =>
      `${num(x * PT_PER_MM)} ${num((H - y - h) * PT_PER_MM)} ${num(w * PT_PER_MM)} ${num(h * PT_PER_MM)} re`;
    for (const frame of sheet.frames) {
      const { clip } = frame;
      const place = (form: { name: string } | undefined) => {
        if (!form) return;
        content.save();
        content.op(`${rect(clip.x, clip.y, clip.width, clip.height)} W n`);
        // Spegelorientering (ADR-0192 beslut 12): kartbilden vänds kring ramens mitt; figurerna är redan speglade.
        const a = frame.mirror ? -1 : 1, x0 = frame.mirror ? clip.x + clip.width : clip.x;
        content.op(`${a} 0 0 1 ${num(x0 * PT_PER_MM)} ${num((H - clip.y - clip.height) * PT_PER_MM)} cm /${form.name} Do`);
        content.restore();
      };
      // Kartans mm (y uppåt) → sidans mm (y nedåt) → punkter: x = K(s·x + tx), y = K(H − (−s·y + ty)).
      const s = frame.transform.scale;
      const mapMatrix: Matrix = [PT_PER_MM * s, 0, 0, PT_PER_MM * s, PT_PER_MM * frame.transform.translateX, PT_PER_MM * (H - frame.transform.translateY)];
      // Papperets klippning (ADR-0197): specialobjekten i `markingClip.refs` ritas klippta till polygonen, i målningsordning.
      const marked = new Set(frame.markingClip?.refs ?? []);
      const isMarking = (figure: OverprintPrimitive) => figure.role === "SPECIAL" && figure.kind !== "description" && figure.ref !== undefined && marked.has(figure.ref);
      const markingPath = frame.markingClip
        ? `${frame.markingClip.polygon.map((p, index) => `${num(p.x * PT_PER_MM)} ${num((H - p.y) * PT_PER_MM)} ${index === 0 ? "m" : "l"}`).join(" ")} h W n` : "";
      const figures = (list: readonly OverprintPrimitive[]) => {
        if (list.length === 0) return;
        content.save();
        content.op(`${rect(clip.x, clip.y, clip.width, clip.height)} W n`);
        if (marked.size === 0) figureOps(figureContext, mapMatrix, list);
        else {
          let run: OverprintPrimitive[] = [], runMarked = false;
          const flush = () => {
            if (run.length === 0) return;
            if (runMarked) { content.save(); content.op(markingPath); figureOps(figureContext, mapMatrix, run); content.restore(); }
            else figureOps(figureContext, mapMatrix, run);
            run = [];
          };
          for (const figure of list) {
            const m = isMarking(figure);
            if (m !== runMarked) { flush(); runMarked = m; }
            run.push(figure);
          }
          flush();
        }
        content.restore();
      };
      if (over) {
        // BL: kartans färger under banan, banan, kartans färger över banan, sist beskrivningar och texter.
        place(mapForm(frame, "UNDER"));
        figures(frame.figures.filter(inCourseLayer));
        place(mapForm(frame, "OVER"));
        figures(frame.figures.filter(figure => !inCourseLayer(figure)));
      } else {
        place(mapForm(frame));
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
          if (part.fill) { content.fill(part.fill === "BLACK" ? BLACK : WHITE); content.op(`${rect(part.x, part.y, part.width, part.height)} f`); }
          if (part.stroke) { content.stroke(BLACK); content.lineStyle(part.stroke * PT_PER_MM, 0, 0); content.op(`${rect(part.x, part.y, part.width, part.height)} S`); }
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
          const ops = textOps(figureContext, paperMatrix, part.text, part.at, part.heightMm, part.bold ? "bold" : "regular", part.align, { yDown: true });
          if (!ops) break;
          content.fill(BLACK);
          content.op(ops);
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
    overprintUsed ||= content.overprintUsed;
    const stream = document.context.flateStream(content.text());
    page.node.set(PDFName.of("Contents"), document.context.register(stream));
  }

  // Resurserna delas av alla sidor och utsnitt: färgrymderna, övertrycket, typsnitten och bilderna.
  const context = document.context;
  const colorSpaces: Record<string, PDFRef> = {};
  for (const entry of spaces.spaces) {
    const fn = tintFunction(document, entry.space.alternates);
    const value = entry.space.names.length === 1
      ? context.obj([PDFName.of("Separation"), PDFName.of(entry.space.names[0]!), PDFName.of("DeviceCMYK"), fn])
      : context.obj([PDFName.of("DeviceN"), entry.space.names.map(name => PDFName.of(name)), PDFName.of("DeviceCMYK"), fn]);
    colorSpaces[entry.name] = context.register(value);
  }
  const extGState = {
    [GS_OVERPRINT]: context.register(context.obj({ Type: "ExtGState", OP: true, op: true, OPM: 1 })),
    [GS_KNOCKOUT]: context.register(context.obj({ Type: "ExtGState", OP: false, op: false, OPM: 1 })),
    ...Object.fromEntries([...opacities].map(([name, value]) => [name, context.register(context.obj({ Type: "ExtGState", ca: value, CA: value }))]))
  };
  const fontDict = Object.fromEntries(fonts.all().map(font => [font.name, font.font.ref]));
  const shared = { ColorSpace: context.register(context.obj(colorSpaces)), ExtGState: context.register(context.obj(extGState)),
    Font: context.register(context.obj(fontDict)), ProcSet: [PDFName.of("PDF"), PDFName.of("Text"), PDFName.of("ImageB"), PDFName.of("ImageC")] };
  const formResources = context.register(context.obj(shared));
  const xobjects: Record<string, PDFRef> = {};
  for (const form of forms.values()) { form.stream.dict.set(PDFName.of("Resources"), formResources); xobjects[form.name] = form.ref; }
  for (const image of images.values()) if (image) xobjects[image.name] = image.ref;
  for (const image of paperImages.values()) if (image) xobjects[image.name] = image.ref;
  const pageResources = context.register(context.obj({ ...shared, XObject: context.register(context.obj(xobjects)) }));
  for (const page of pages) page.node.set(PDFName.of("Resources"), pageResources);

  // Dubbelsidigt: utskriftsdialogen föreslår vändning på långsidan (baksidorna ligger rätt i samma riktning som framsidan).
  if (input.sheets.some(sheet => sheet.back)) document.catalog.getOrCreateViewerPreferences().setDuplex(Duplex.DuplexFlipLongEdge);

  const bytes = await document.save({ useObjectStreams: false });
  return { bytes, pages: pages.length, plates: spaces.plates().filter(name => name !== "All"), overprint: overprintUsed, mapForms: forms.size,
    notes: [...notes], overCourse: over ? [...over] : [] };
}
