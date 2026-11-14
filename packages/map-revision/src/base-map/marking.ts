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
  /** Symbolernas id i kartan: ramen (linje), loggan (punkt), texten och rubriken (text). */
  readonly symbols: { readonly frame: string; readonly logo: string; readonly text: string; readonly heading: string };
  /** Textens teckenhöjd och loggans diameter i mm på kartan (symbolsetets mått gånger skalans faktor). */
  readonly textSize: number; readonly logoSize: number;
  readonly heading: string;
  /** Styckena under rubriken; varje stycke bryts i rader. */
  readonly paragraphs: readonly string[];
  /** Hur mycket av kartans innehåll som ligger i en ruta (t.ex. antal objekt): rutan läggs i hörnet med minst. */
  readonly occupied?: ((box: MarkingBox) => number) | undefined;
}
export interface Marking { readonly objects: MapObject[]; /** Pappret ramen är gjord för, t.ex. «A3 liggande»; inget när kartan är större än A0. */ readonly paper: { readonly size: string; readonly landscape: boolean } | undefined;
  readonly frame: MarkingBox; readonly box: MarkingBox }

/** Pappersformaten (mm, stående). */
export const PAPERS = [["A4", 210, 297], ["A3", 297, 420], ["A2", 420, 594], ["A1", 594, 841], ["A0", 841, 1189]] as const;
/** Marginalen från papperets kant till ramen, och luften mellan ramen och kartans innehåll (mm). */
export const PAPER_MARGIN = 10, FRAME_INSET = 3;
/** Ett teckens medelbredd som andel av teckenhöjden (Arial, svensk text, med marginal). */
const CHAR_WIDTH = 0.52, LINE_HEIGHT = 1.3, BOX_CHARS = 100;

/** Ramen: det minsta pappret (stående eller liggande) som rymmer innehållet, annars innehållet med marginal. */
export function markingFrame(bounds: MarkingBox): Pick<Marking, "paper" | "frame"> {
  const width = bounds.maxX - bounds.minX, height = bounds.maxY - bounds.minY, cx = (bounds.minX + bounds.maxX) / 2, cy = (bounds.minY + bounds.maxY) / 2;
  const around = (w: number, h: number): MarkingBox => ({ minX: cx - w / 2, minY: cy - h / 2, maxX: cx + w / 2, maxY: cy + h / 2 });
  for (const [size, short, long] of PAPERS) {
    // Riktningen som ger mest luft åt den trängsta ledden.
    const fits = ([true, false] as const).flatMap(landscape => {
      const w = (landscape ? long : short) - 2 * PAPER_MARGIN, h = (landscape ? short : long) - 2 * PAPER_MARGIN;
      const slack = Math.min(w - width, h - height) - 2 * FRAME_INSET;
      return slack >= 0 ? [{ landscape, w, h, slack }] : [];
    }).sort((a, b) => b.slack - a.slack);
    if (fits[0]) return { paper: { size, landscape: fits[0].landscape }, frame: around(fits[0].w, fits[0].h) };
  }
  return { paper: undefined, frame: around(width + 2 * (PAPER_MARGIN + FRAME_INSET), height + 2 * (PAPER_MARGIN + FRAME_INSET)) };
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

export function mapMarking(input: MarkingInput): Marking {
  const { paper, frame } = markingFrame(input.bounds), { textSize: size, logoSize: logo, symbols } = input;
  const pad = size * 1.5, step = size * LINE_HEIGHT;
  const chars = Math.max(30, Math.min(BOX_CHARS, Math.floor((frame.maxX - frame.minX - 2 * FRAME_INSET - 2 * pad) / (size * CHAR_WIDTH))));
  const paragraphs = input.paragraphs.map(paragraph => wrapText(paragraph, chars)).filter(lines => lines.length > 0);
  const lineCount = paragraphs.reduce((sum, lines) => sum + lines.length, 0);
  const width = Math.max(chars * size * CHAR_WIDTH, logo + pad + input.heading.length * size * CHAR_WIDTH * 1.1) + 2 * pad;
  const height = 2 * pad + logo + lineCount * step + paragraphs.length * step * 0.5;
  // Hörnen i den ordning de väljs när de är lika tomma: nere till höger först.
  const corners = ([[1, -1], [-1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]): MarkingBox => {
    const minX = sx > 0 ? frame.maxX - FRAME_INSET - width : frame.minX + FRAME_INSET, minY = sy > 0 ? frame.maxY - FRAME_INSET - height : frame.minY + FRAME_INSET;
    return { minX, minY, maxX: minX + width, maxY: minY + height };
  });
  const loads = corners.map(corner => input.occupied?.(corner) ?? 0);
  const box = corners[loads.indexOf(Math.min(...loads))]!;

  const objects: MapObject[] = [{ kind: "line", symbol: symbols.frame, path: [
    { type: "M", x: frame.minX, y: frame.minY }, { type: "L", x: frame.maxX, y: frame.minY, corner: true }, { type: "L", x: frame.maxX, y: frame.maxY, corner: true },
    { type: "L", x: frame.minX, y: frame.maxY, corner: true }, { type: "L", x: frame.minX, y: frame.minY } ] }];
  const left = box.minX + pad, top = box.maxY - pad;
  objects.push({ kind: "point", symbol: symbols.logo, at: { x: left + logo / 2, y: top - logo / 2 }, angle: 0 });
  objects.push({ kind: "text", symbol: symbols.heading, at: { x: left + logo + pad, y: top - logo / 2 - size * 0.35 }, angle: 0, text: input.heading });
  let y = top - logo - step * 0.5;
  for (const lines of paragraphs) {
    for (const line of lines) { y -= step; objects.push({ kind: "text", symbol: symbols.text, at: { x: left, y }, angle: 0, text: line }); }
    y -= step * 0.5;
  }
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return { paper, frame, box, objects: objects.map((object): MapObject => object.kind === "line"
    ? { ...object, path: object.path.map(command => ({ ...command, x: round(command.x), y: round(command.y) })) }
    : object.kind === "area" ? object : { ...object, at: { x: round(object.at.x), y: round(object.at.y) } }) };
}
