/**
 * Steg 63 (ADR-0180): kontrollbeskrivningarna utlagda tätt på A4 för att klippas. Beskrivningarna är smala och höga,
 * så de läggs i kolumner uppifrån och ned och kolumnerna från vänster till höger; en ny sida när bredden tar slut.
 * Varje beskrivning får tunna skärmarker i hörnen, i mellanrummet så att de inte syns på den urklippta lappen. En
 * beskrivning som är större än sidan krymps (och märks) hellre än att den klipps av. Allt i mm med y nedåt.
 */
export const A4 = { widthMm: 210, heightMm: 297 } as const;
export const BOX_SIZES_MM = [5, 5.5, 6, 6.5, 7] as const;
export const MAX_COPIES = 50;

export interface PrintItem {
  readonly key: string;
  readonly widthMm: number;
  readonly heightMm: number;
}

export interface PlacedItem extends PrintItem {
  readonly x: number;
  readonly y: number;
  /** 1 = verklig storlek; under 1 när beskrivningen inte får plats på en sida. */
  readonly scale: number;
}

export interface CutMark { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }

export interface PrintPage {
  readonly items: readonly PlacedItem[];
  readonly cutMarks: readonly CutMark[];
}

export interface PageOptions {
  readonly widthMm?: number;
  readonly heightMm?: number;
  /** Marginal runt sidan (skrivarna klarar sällan mindre än 5 mm). */
  readonly marginMm?: number;
  /** Mellanrum mellan beskrivningarna; skärmarkerna ryms i det. */
  readonly gapMm?: number;
}

/** Skärmarkernas avstånd från beskrivningen och längd (mm); linjebredden på utskriften. */
export const CUT_MARK = { offsetMm: 0.5, lengthMm: 1.5, widthMm: 0.1 } as const;

/** Skärmarker i beskrivningens fyra hörn: en vågrät och en lodrät linje utanför hörnet. */
export function cutMarks(item: { x: number; y: number; widthMm: number; heightMm: number; scale: number }, gapMm: number): CutMark[] {
  const offset = Math.min(CUT_MARK.offsetMm, gapMm / 4), length = Math.max(0, Math.min(CUT_MARK.lengthMm, gapMm / 2 - offset));
  if (length === 0) return [];
  const left = item.x, top = item.y, right = item.x + item.widthMm * item.scale, bottom = item.y + item.heightMm * item.scale;
  const marks: CutMark[] = [];
  for (const [x, dx] of [[left, -1], [right, 1]] as const) {
    for (const [y, dy] of [[top, -1], [bottom, 1]] as const) {
      marks.push({ x1: x + dx * offset, y1: y, x2: x + dx * (offset + length), y2: y });
      marks.push({ x1: x, y1: y + dy * offset, x2: x, y2: y + dy * (offset + length) });
    }
  }
  return marks;
}

export function layoutPages(items: readonly PrintItem[], options: PageOptions = {}): PrintPage[] {
  const width = options.widthMm ?? A4.widthMm, height = options.heightMm ?? A4.heightMm;
  const margin = options.marginMm ?? 8, gap = options.gapMm ?? 4;
  const right = width - margin, bottom = height - margin;
  const pages: PlacedItem[][] = [];
  let page: PlacedItem[] = [];
  let x = margin, y = margin, columnWidth = 0;
  const newPage = () => { if (page.length > 0) pages.push(page); page = []; x = margin; y = margin; columnWidth = 0; };
  for (const item of items) {
    const scale = Math.min(1, (right - margin) / item.widthMm, (bottom - margin) / item.heightMm);
    const w = item.widthMm * scale, h = item.heightMm * scale;
    // Får inte plats under den förra i kolumnen: nästa kolumn; får inte plats i bredd: nästa sida.
    if (y > margin && y + h > bottom + 1e-9) { x += columnWidth + gap; y = margin; columnWidth = 0; }
    if (x > margin && x + w > right + 1e-9) newPage();
    page.push({ ...item, x, y, scale });
    y += h + gap;
    columnWidth = Math.max(columnWidth, w);
  }
  newPage();
  return pages.map(placed => ({ items: placed, cutMarks: placed.flatMap(item => cutMarks(item, gap)) }));
}

/** Antal kopior: heltal 1–MAX_COPIES (fel inmatning blir 1). */
export function copiesOf(value: string | number): number {
  const number = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(MAX_COPIES, Math.max(1, Math.round(number))) : 1;
}

/** Ett filnamn av banans namn ("Lång 2.svg"), utan tecken som filsystemen inte tål. */
export function svgFileName(name: string, variant?: string): string {
  const printable = [...`${name}${variant ? ` ${variant}` : ""}`].filter(character => character.charCodeAt(0) >= 32).join("");
  const base = printable.replace(/[\\/:*?"<>|]+/g, "-").trim() || "kontrollbeskrivning";
  return `${base}.svg`;
}
