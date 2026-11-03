/**
 * Kontrollbeskrivningen som figurer i mm (y nedåt), portad från Purple Pens DescriptionRenderer.cs (Render, RenderLine,
 * RenderColumnFText, UpdateThickLineCounter, textbrytningen i WrapText; mått ur Appearance.cs DescriptionAppearance; BSD,
 * Peter Golde). Purple Pen räknar varje ruta som 100 enheter; här blir 100 enheter `boxMm`.
 */
import type { SymbolData } from "./description-symbols";
import { formatDescription, type DescriptionLine, type DescriptionBoxValue } from "./description-format";
import type { DescriptionKind, DescriptionLayout, DescriptionLayoutOptions, DescriptionPrimitive } from "./description-types";
import type { CourseSettingDocument } from "./types";

/** Linjernas tjocklek i enheter (rutan = 100). */
const THICK = 5;
const THIN = 2.5;

interface Font { readonly em: number; readonly bold: boolean; readonly condensed: boolean }
/** Typsnitten (Roboto / Roboto Condensed) med höjd i enheter. */
const FONTS = {
  title: { em: 63, bold: true, condensed: true },
  columnA: { em: 63, bold: true, condensed: false },
  columnB: { em: 63, bold: false, condensed: true },
  columnF: { em: 50, bold: false, condensed: false },
  columnFSmall: { em: 45, bold: false, condensed: true },
  directive: { em: 63, bold: true, condensed: true },
  text: { em: 43, bold: false, condensed: true },
  key: { em: 52, bold: false, condensed: false },
  textLine: { em: 56, bold: true, condensed: true }
} satisfies Record<string, Font>;

/** Radavstånd och höjd över baslinjen som andel av em-höjden, ungefär som Robotos (Windows-mått, som Purple Pen får). */
const LINE_HEIGHT = 1.32;
const ASCENT = 1.05;

/**
 * Ungefärlig bredd av ett tecken i em. Paketet har inga typsnittsmått; bredden används bara för att bryta och krympa
 * text, och `maxWidth` i figuren låter ritaren trycka ihop det som ändå blir för brett.
 */
function charWidth(ch: string): number {
  if (" .,:;'|!ijl".includes(ch)) return 0.25;
  if ("frtI()-/[]".includes(ch)) return 0.34;
  if ("mwMW".includes(ch)) return 0.84;
  if (/[0-9]/.test(ch)) return 0.56;
  if (ch !== ch.toLowerCase()) return 0.64;
  return 0.54;
}

function textWidth(text: string, font: Font, em: number): number {
  let width = 0;
  for (const ch of text) width += charWidth(ch);
  return width * em * (font.bold ? 1.04 : 1) * (font.condensed ? 0.88 : 1);
}

type Align = "left" | "center" | "right";

class Painter {
  readonly primitives: DescriptionPrimitive[] = [];
  private originY = 0;
  private originX = 0;
  private ref: string | undefined;

  constructor(private readonly unit: number, private readonly offset: number) {}

  /** Raden som ritas nu: dess överkant (och vänsterkant i flera spalter) i enheter och kontrollen den hör till. */
  startLine(row: number, ref: string | undefined, left = 0): void {
    this.originY = row * 100;
    this.originX = left;
    this.ref = ref;
  }

  private x(units: number) { return this.offset + (this.originX + units) * this.unit; }
  private y(units: number) { return this.offset + (this.originY + units) * this.unit; }
  private withRef<T extends object>(item: T): T { return this.ref !== undefined ? { ...item, ref: this.ref } : item; }

  line(x1: number, y1: number, x2: number, y2: number, width: number): void {
    this.primitives.push({ kind: "line", from: { x: this.x(x1), y: this.y(y1) }, to: { x: this.x(x2), y: this.y(y2) }, width: width * this.unit });
  }

  symbol(symbol: SymbolData | null, left: number, right: number): void {
    if (!symbol) return;
    this.primitives.push(this.withRef({ kind: "symbol" as const, symbol: symbol.id, at: { x: this.x((left + right) / 2), y: this.y(50) }, size: 100 * this.unit }));
  }

  hit(left: number, right: number, ref: string, box?: string): void {
    this.primitives.push({
      kind: "hit", x: this.x(left), y: this.y(0), width: (right - left) * this.unit, height: 100 * this.unit, ref,
      ...(box !== undefined ? { box } : {})
    });
  }

  private text(text: string, font: Font, em: number, align: Align, left: number, right: number, centerY: number): void {
    const x = align === "left" ? left : align === "right" ? right : (left + right) / 2;
    const baseline = centerY - (LINE_HEIGHT * em) / 2 + ASCENT * em;
    this.primitives.push(this.withRef({
      kind: "text" as const, at: { x: this.x(x), y: this.y(baseline) }, text, heightMm: em * this.unit, align,
      maxWidth: (right - left) * this.unit, ...(font.bold ? { bold: true } : {}), ...(font.condensed ? { condensed: true } : {})
    }));
  }

  /** En rad text i rutan; för bred text krymps (RenderSingleLineText). */
  singleLine(text: string | null | undefined, font: Font, align: Align, left: number, top: number, right: number, bottom: number): void {
    if (text === null || text === undefined || text === "") return;
    const width = textWidth(text, font, font.em);
    const em = width <= right - left ? font.em : font.em * ((right - left) / width) * 0.95;
    this.text(text, font, em, align, left, right, (top + bottom) / 2);
  }

  /** Text som bryts på ord och krymps 5 % i taget tills den får plats (RenderWrappedText, WrapText). */
  wrapped(text: string | null | undefined, font: Font, left: number, right: number): void {
    if (text === null || text === undefined || text === "") return;
    let em = font.em;
    let lines = wrap(text, font, em, right - left);
    for (let i = 0; i < 60 && LINE_HEIGHT * em * lines.length > 100; i++) {
      em *= 0.95;
      lines = wrap(text, font, em, right - left);
    }
    const height = LINE_HEIGHT * em * lines.length;
    let top = 50 - height / 2;
    for (const line of lines) {
      this.text(line, font, em, "left", left, right, top + (LINE_HEIGHT * em) / 2);
      top += LINE_HEIGHT * em;
    }
  }
}

/** Dela texten i rader som får plats (ord, och bokstäver när ett ord inte får plats ensamt). */
function wrap(text: string, font: Font, em: number, width: number): string[] {
  const lines: string[] = [];
  let rest = text;
  while (rest !== "") {
    let line = "";
    let used = 0;
    let letters = false;
    while (rest !== "") {
      const segment = letters ? rest.charAt(0) : rest.startsWith(" ") ? " " : (/^[^ ]+/.exec(rest)?.[0] ?? rest.charAt(0));
      const segmentWidth = textWidth(segment, font, em);
      if (used + segmentWidth > width) {
        if (used === 0 && !letters) { letters = true; continue; }
        if (used > 0) break;
      }
      line += segment;
      rest = rest.slice(segment.length);
      used += segmentWidth;
    }
    if (rest !== "") {
      line = line.replace(/ +$/, "");
      rest = rest.replace(/^ +/, "");
    }
    lines.push(line);
  }
  return lines.length > 0 ? lines : [""];
}

const isSymbol = (value: DescriptionBoxValue | undefined): value is SymbolData => value !== null && value !== undefined && typeof value !== "string";
const asText = (value: DescriptionBoxValue | undefined): string | null => (typeof value === "string" ? value : null);

/** Ingen linje mellan två titelrader, eller mellan textrader av samma slag (DescriptionLine.NoBoundaryBetween). */
function noBoundaryBetween(a: DescriptionLine, b: DescriptionLine): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "TITLE" || a.kind === "SECONDARY_TITLE") return true;
  return a.kind === "TEXT" && a.textLineKind === b.textLineKind;
}

/** Måtten i F: "a/b" med snedstreck, "a|b" på två rader, "x" som gångertecken (RenderColumnFText). */
function columnF(painter: Painter, value: string, left: number, right: number): void {
  const text = value.replace(/x/g, "×");
  const bar = text.indexOf("|");
  const slash = text.indexOf("/");
  if (bar >= 0) {
    painter.singleLine(text.slice(0, bar), FONTS.columnFSmall, "center", left, 0, right, 50);
    painter.singleLine(text.slice(bar + 1), FONTS.columnFSmall, "center", left, 50, right, 100);
  } else if (slash >= 0) {
    painter.line(right, 0, left, 100, THIN);
    const w = right - left;
    painter.singleLine(text.slice(0, slash), FONTS.columnFSmall, "center", left, 0, left + w * 0.63, 50);
    painter.singleLine(text.slice(slash + 1), FONTS.columnFSmall, "center", left + w * 0.37, 50, left + w, 100);
  } else {
    painter.singleLine(text, FONTS.columnF, "center", left, 0, right, 100);
  }
}

const BOX_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

function renderLine(painter: Painter, line: DescriptionLine, kind: DescriptionKind, last: boolean, thick: boolean, noTopLine: boolean, columnHScore: boolean): void {
  const fullWidth = (kind === "SYMBOLS_AND_TEXT" ? 13 : 8) * 100;
  if (!noTopLine) painter.line(0, 0, fullWidth, 0, line.kind !== "NORMAL" || thick ? THICK : THIN);
  if (last) painter.line(0, 100, fullWidth, 100, THICK);
  const top = -THICK / 2;
  const bottom = 100 + THICK / 2;
  const vertical = (x: number, width: number) => painter.line(x, top, x, bottom, width);
  vertical(0, THICK);
  const wholeRow = line.kind === "TITLE" || line.kind === "SECONDARY_TITLE" || line.kind === "TEXT";
  if (!(kind === "SYMBOLS_AND_TEXT" && wholeRow)) vertical(800, THICK);
  if (kind === "SYMBOLS_AND_TEXT") vertical(1300, THICK);
  const boxes = line.boxes;
  switch (line.kind) {
    case "TITLE": case "SECONDARY_TITLE":
      painter.singleLine(asText(boxes[0]), FONTS.title, "center", 0, 0, fullWidth, 100);
      break;
    case "HEADER_2":
      vertical(300, THICK);
      painter.singleLine(asText(boxes[0]), FONTS.title, "center", 0, 0, 300, 100);
      painter.singleLine(asText(boxes[1]), FONTS.title, "center", 300, 0, 800, 100);
      break;
    case "HEADER_3":
      vertical(300, THICK);
      vertical(600, THICK);
      painter.singleLine(asText(boxes[0]), FONTS.title, "center", 0, 0, 300, 100);
      painter.singleLine(asText(boxes[1]), FONTS.title, "center", 300, 0, 600, 100);
      painter.singleLine(asText(boxes[2]), FONTS.title, "center", 600, 0, 800, 100);
      break;
    case "DIRECTIVE":
      if (kind === "TEXT") {
        painter.wrapped(line.textual, FONTS.text, 15, 785);
      } else {
        painter.symbol(isSymbol(boxes[0]) ? boxes[0] : null, 0, 800);
        painter.singleLine(asText(boxes[1]), FONTS.directive, "center", 300, 0, 500, 100);
        if (kind === "SYMBOLS_AND_TEXT") painter.wrapped(line.textual, FONTS.text, 815, 1285);
      }
      if (line.control !== undefined && !line.isLeg) {
        painter.hit(0, fullWidth, line.control);
        if (kind !== "TEXT" && isSymbol(boxes[0]) && "VXZ".includes(boxes[0].kind)) painter.hit(0, 800, line.control, "all");
      }
      break;
    case "NORMAL": {
      let show: (i: number) => boolean = () => true;
      if (kind === "TEXT") {
        vertical(100, THIN);
        vertical(200, THICK);
        if (columnHScore) vertical(700, THICK);
        painter.wrapped(line.textual, FONTS.text, 215, columnHScore ? 685 : 785);
        show = i => i < 2 || (columnHScore && i === 7);
      } else {
        for (const [x, width] of [[100, THIN], [200, THIN], [300, THICK], [400, THIN], [500, THIN], [600, THICK], [700, THIN]] as const) vertical(x, width);
        if (kind === "SYMBOLS_AND_TEXT") painter.wrapped(line.textual, FONTS.text, 815, 1285);
      }
      for (let i = 0; i < 8; i++) {
        if (!show(i)) continue;
        const value = boxes[i];
        if (isSymbol(value)) painter.symbol(value, i * 100, i * 100 + 100);
        else if (typeof value === "string") {
          if (i === 5) columnF(painter, value, 500, 600);
          else painter.singleLine(value, i === 0 ? FONTS.columnA : FONTS.columnB, "center", i * 100, 0, i * 100 + 100, 100);
        }
      }
      if (line.control !== undefined) {
        painter.hit(0, fullWidth, line.control);
        if (kind !== "TEXT") for (let i = 2; i < 8; i++) painter.hit(i * 100, i * 100 + 100, line.control, BOX_LETTERS[i]);
      }
      break;
    }
    case "KEY":
      painter.symbol(isSymbol(boxes[0]) ? boxes[0] : null, 100, 200);
      painter.singleLine(`= ${asText(boxes[1]) ?? ""}`, FONTS.key, "left", 200, 0, 800, 100);
      break;
    case "TEXT":
      painter.wrapped(asText(boxes[0]), FONTS.textLine, 20, fullWidth);
      if (line.control !== undefined && (line.textLineKind === "BEFORE_CONTROL" || line.textLineKind === "AFTER_CONTROL")) {
        painter.hit(0, fullWidth, line.control, line.textLineKind === "BEFORE_CONTROL" ? "before" : "after");
      }
      break;
  }
}

/** Tjock linje efter start och efter var tredje vanlig rad; alla andra rader nollställer (UpdateThickLineCounter). */
function nextThickCounter(line: DescriptionLine, counter: number): number {
  if (line.kind !== "NORMAL") return 0;
  if (isSymbol(line.boxes[0])) return 0;
  return counter + 1 === 3 ? 0 : counter + 1;
}

/** Mellanrummet mellan spalterna i rutor (DescriptionRenderer.columnGap). */
const COLUMN_GAP = 0.6;

/**
 * Spalt och rad för varje rad i beskrivningen (DescriptionRenderer.ColumnAndRow): de första spalterna får en rad mer när
 * raderna inte går jämnt ut.
 */
function columnsOf(count: number, columns: number): { row: number; column: number }[] {
  const length = Math.ceil(count / columns);
  const long = count % columns === 0 ? columns : count % columns;
  const out: { row: number; column: number }[] = [];
  let column = 0, row = 0;
  for (let index = 0; index < count; index++) {
    if (row >= (column < long ? length : length - 1)) { column++; row = 0; }
    out.push({ row, column });
    row++;
  }
  return out;
}

/** Rader till figurer (DescriptionRenderer.Render, också i flera spalter som på kartan). */
export function renderDescription(lines: readonly DescriptionLine[], kind: DescriptionKind, boxMm: number, columnHScore = false, columns = 1): DescriptionLayout {
  const unit = boxMm / 100;
  const offset = (THICK / 2) * unit;
  const painter = new Painter(unit, offset);
  const cells = kind === "SYMBOLS_AND_TEXT" ? 13 : 8;
  const count = Math.max(1, Math.min(Math.floor(columns), lines.length || 1));
  const places = columnsOf(lines.length, count);
  let counter = 0;
  lines.forEach((line, index) => {
    const { row, column } = places[index]!;
    if (column > 0 && row === 0) counter = 0;
    painter.startLine(row, line.control, column * (cells + COLUMN_GAP) * 100);
    const last = index === lines.length - 1 || places[index + 1]!.column !== column;
    const noTopLine = index !== 0 && row !== 0 && noBoundaryBetween(line, lines[index - 1]!);
    renderLine(painter, line, kind, last, counter === 0 || index === 0 || row === 0, noTopLine, columnHScore);
    counter = nextThickCounter(line, counter);
  });
  const width = (cells * count + COLUMN_GAP * (count - 1)) * boxMm;
  return { widthMm: width + 2 * offset, heightMm: Math.ceil(lines.length / count) * boxMm + 2 * offset, primitives: painter.primitives };
}

export function layout(document: CourseSettingDocument, options: DescriptionLayoutOptions): DescriptionLayout {
  const boxMm = options.boxMm ?? 6;
  if (!(Number.isFinite(boxMm) && boxMm > 0)) throw new RangeError("Rutans storlek måste vara positiv");
  const { lines, scoreColumn } = formatDescription(document, {
    course: options.course, variant: options.variant, language: options.language, createKey: options.kind === "SYMBOLS",
    ...(options.part !== undefined ? { part: options.part } : {})
  });
  return renderDescription(lines, options.kind, boxMm, options.kind === "TEXT" && scoreColumn === 7, options.columns ?? 1);
}
