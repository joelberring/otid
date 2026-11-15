import type { MapObject } from "@o-tid/map-file";

/**
 * Ägaren 2026-11-14 («om alla nya kartor som skapas ska märkas … en ram som är större än kartan som får plats på A4/A3/A2
 * liggande/stående i samma färg som O-Tids logga samt loggan i ett hörn … en ruta med liten stil i ett hörn som passar»):
 * kartans märkning som vanliga kartobjekt – ramen, loggan och rutans text rad för rad. Ren räkning utan I/O; mått i kartans
 * mm med y uppåt.
 */
export interface MarkingBox { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }
export interface MarkingInput {
  /** Kartans innehåll (det som ska rymmas i ramen). */
  readonly bounds: MarkingBox;
  /** Symbolernas id i kartan: ramen (linje), loggan (punkt), texten och rubriken (text), och kartans namn överst (text, valfri). */
  readonly symbols: { readonly frame: string; readonly logo: string; readonly text: string; readonly heading: string; readonly title?: string | undefined };
  /** Textens teckenhöjd och loggans diameter i mm på kartan (symbolsetets mått gånger skalans faktor). */
  readonly textSize: number; readonly logoSize: number;
  readonly heading: string;
  /** Styckena under rubriken; varje stycke bryts i rader. */
  readonly paragraphs: readonly string[];
  /** Kartans namn överst i ramen, centrerat, med teckenhöjden `titleSize` (mm); utan namn ingen rad. */
  readonly title?: string | undefined; readonly titleSize?: number | undefined;
}
export interface Marking { readonly objects: MapObject[]; /** Pappret ramen ryms på, t.ex. «A3 liggande»; inget när ramen är större än A0. */ readonly paper: { readonly size: string; readonly landscape: boolean } | undefined;
  readonly frame: MarkingBox; readonly box: MarkingBox }

/** Pappersformaten (mm, stående). */
export const PAPERS = [["A4", 210, 297], ["A3", 297, 420], ["A2", 420, 594], ["A1", 594, 841], ["A0", 841, 1189]] as const;
/**
 * Marginalen från papperets kant till ramen, luften mellan ramen och det som står innanför (rutan, namnet), och (ägaren
 * 2026-11-15: «den lila ramen ska ligga lite närmare men alltid utanför kartan») luften mellan kartans innehåll och ramen (mm).
 */
export const PAPER_MARGIN = 10, FRAME_INSET = 3, FRAME_GAP = 5;
/** Ett teckens medelbredd som andel av teckenhöjden (Arial, svensk text, med marginal). */
const CHAR_WIDTH = 0.52, LINE_HEIGHT = 1.3, BOX_CHARS = 100;

/** Det minsta pappret (stående eller liggande) som rymmer en ruta på `width` × `height` mm med marginalen; inget över A0. */
export function paperFor(width: number, height: number): Marking["paper"] {
  for (const [size, short, long] of PAPERS) {
    const fits = ([true, false] as const).filter(landscape => (landscape ? long : short) - 2 * PAPER_MARGIN >= width && (landscape ? short : long) - 2 * PAPER_MARGIN >= height);
    // Liggande först när båda går (kartor är oftast breda); annars den som går.
    if (fits.length) return { size, landscape: fits.includes(true) && width >= height ? true : fits[0]! };
  }
  return undefined;
}

/** Texten bruten i rader om högst `chars` tecken (ett för långt ord får en egen rad). */
export function wrapText(text: string, chars: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > chars) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Ramen ligger `FRAME_GAP` mm utanför kartans innehåll. Överst inom ramen står kartans namn, nederst rutan med loggan och
 * texten, så att ingenting av märkningen ligger på kartan.
 */
export function mapMarking(input: MarkingInput): Marking {
  const { bounds, textSize: size, logoSize: logo, symbols } = input;
  const pad = size * 1.5, step = size * LINE_HEIGHT;
  const contentWidth = bounds.maxX - bounds.minX + 2 * FRAME_GAP;
  const chars = Math.max(30, Math.min(BOX_CHARS, Math.floor((contentWidth - 2 * FRAME_INSET - 2 * pad) / (size * CHAR_WIDTH))));
  const paragraphs = input.paragraphs.map(paragraph => wrapText(paragraph, chars)).filter(lines => lines.length > 0);
  const lineCount = paragraphs.reduce((sum, lines) => sum + lines.length, 0);
  const boxWidth = Math.max(chars * size * CHAR_WIDTH, logo + pad + input.heading.length * size * CHAR_WIDTH * 1.1) + 2 * pad;
  const boxHeight = 2 * pad + logo + lineCount * step + paragraphs.length * step * 0.5;
  const title = input.title?.trim(), titleSize = input.titleSize ?? size * 3;
  const titleHeight = title ? titleSize * 1.6 : 0;
  const minX = bounds.minX - FRAME_GAP;
  const frame: MarkingBox = { minX, maxX: Math.max(bounds.maxX + FRAME_GAP, minX + boxWidth + 2 * FRAME_INSET),
    minY: bounds.minY - FRAME_GAP - boxHeight - FRAME_INSET, maxY: bounds.maxY + FRAME_GAP + titleHeight };
  const box: MarkingBox = { minX: frame.minX + FRAME_INSET, minY: frame.minY + FRAME_INSET, maxX: frame.minX + FRAME_INSET + boxWidth, maxY: frame.minY + FRAME_INSET + boxHeight };

  const objects: MapObject[] = [{ kind: "line", symbol: symbols.frame, path: [
    { type: "M", x: frame.minX, y: frame.minY }, { type: "L", x: frame.maxX, y: frame.minY, corner: true }, { type: "L", x: frame.maxX, y: frame.maxY, corner: true },
    { type: "L", x: frame.minX, y: frame.maxY, corner: true }, { type: "L", x: frame.minX, y: frame.minY } ] }];
  if (title) {
    const width = title.length * titleSize * CHAR_WIDTH * 1.1;
    objects.push({ kind: "text", symbol: symbols.title ?? symbols.heading, at: { x: (frame.minX + frame.maxX) / 2 - width / 2, y: frame.maxY - titleSize * 1.25 }, angle: 0, text: title });
  }
  const left = box.minX + pad, top = box.maxY - pad;
  objects.push({ kind: "point", symbol: symbols.logo, at: { x: left + logo / 2, y: top - logo / 2 }, angle: 0 });
  objects.push({ kind: "text", symbol: symbols.heading, at: { x: left + logo + pad, y: top - logo / 2 - size * 0.35 }, angle: 0, text: input.heading });
  let y = top - logo - step * 0.5;
  for (const lines of paragraphs) {
    for (const line of lines) { y -= step; objects.push({ kind: "text", symbol: symbols.text, at: { x: left, y }, angle: 0, text: line }); }
    y -= step * 0.5;
  }
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return { paper: paperFor(frame.maxX - frame.minX, frame.maxY - frame.minY), frame, box, objects: objects.map((object): MapObject => object.kind === "line"
    ? { ...object, path: object.path.map(command => ({ ...command, x: round(command.x), y: round(command.y) })) }
    : object.kind === "area" ? object : { ...object, at: { x: round(object.at.x), y: round(object.at.y) } }) };
}
