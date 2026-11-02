/**
 * Steg 65: banpåtrycket (`OverprintPrimitive` i kartans mm) och kontrollbeskrivningarna (`DescriptionLayout` i mm med y
 * nedåt) som PDF-operatorer, med samma mått som förhandsvisningens SVG (`apps/web/src/lib/course-setting-print.ts`).
 * Ingenting räknas om: figurerna kommer ur `layoutTemplateSheets`/`layoutCoursePage` som de är.
 */
import { circleArcs, type DescriptionLayout, type DescriptionSymbol, type OverprintPrimitive, type SymbolShape } from "@o-tid/course-setting";
import { num, type Content } from "./content";
import { fontVariant, printable, variantForFamily, type Fonts } from "./fonts";
import { multiply } from "./pdf-canvas";
import { BLACK, customPaint, tinted, WHITE, type Paint } from "./paint";

export type Matrix = readonly [number, number, number, number, number, number];
type Pt = { readonly x: number; readonly y: number };

const apply = (m: Matrix, p: Pt): [number, number] => [m[0] * p.x + m[2] * p.y + m[4], m[1] * p.x + m[3] * p.y + m[5]];
/** Skalan i en likformig transform (linjebredder). */
const scaleOf = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

export interface FigureContext {
  readonly content: Content;
  readonly fonts: Fonts;
  readonly course: Paint;
  readonly symbols: ReadonlyMap<string, DescriptionSymbol>;
  /** Bilder per figur (`data` som nyckel) som PDF-objekt (`/Im0 …`) med sin storlek i bildpunkter. */
  readonly image: (mediaType: string, data: string) => { name: string; width: number; height: number } | undefined;
  readonly notes: Set<string>;
}

function polyline(m: Matrix, points: readonly Pt[], closed: boolean): string {
  const parts = points.map((point, index) => { const [x, y] = apply(m, point); return `${num(x)} ${num(y)} ${index === 0 ? "m" : "l"}`; });
  if (closed && parts.length > 0) parts.push("h");
  return parts.join(" ");
}

/** En båge (grader moturs i koordinaterna med y uppåt) som bézierkurvor, högst 90° per kurva. */
function arcPath(m: Matrix, center: Pt, radius: number, start: number, end: number, move: boolean): string {
  const sweep = (end - start) * Math.PI / 180;
  const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const step = sweep / pieces, k = (4 / 3) * Math.tan(step / 4);
  let angle = start * Math.PI / 180;
  const at = (a: number) => ({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  const out: string[] = [];
  if (move) { const [x, y] = apply(m, at(angle)); out.push(`${num(x)} ${num(y)} m`); }
  for (let index = 0; index < pieces; index += 1) {
    const next = angle + step;
    const c1 = { x: center.x + radius * (Math.cos(angle) - k * Math.sin(angle)), y: center.y + radius * (Math.sin(angle) + k * Math.cos(angle)) };
    const c2 = { x: center.x + radius * (Math.cos(next) + k * Math.sin(next)), y: center.y + radius * (Math.sin(next) - k * Math.cos(next)) };
    const [ax, ay] = apply(m, c1), [bx, by] = apply(m, c2), [ex, ey] = apply(m, at(next));
    out.push(`${num(ax)} ${num(ay)} ${num(bx)} ${num(by)} ${num(ex)} ${num(ey)} c`);
    angle = next;
  }
  return out.join(" ");
}


function paintOf(context: FigureContext, primitive: Exclude<OverprintPrimitive, { kind: "image" }>): Paint {
  switch (primitive.color) {
    case "COURSE": case "COURSE_LOWER": return context.course;
    case "WHITE": return WHITE;
    case "BLACK": return BLACK;
    case "CUSTOM": return customPaint(primitive.cmyk);
  }
}

/** Text i en transform med y uppåt: `at` = baslinjens punkt (efter justering), storleken i samma enheter. */
export function textOps(context: FigureContext, m: Matrix, text: string, at: Pt, size: number, variant: Parameters<Fonts["get"]>[0],
  align: "left" | "center" | "right", options: { yDown?: boolean; rotation?: number; maxWidth?: number | undefined } = {}): string | undefined {
  const clean = printable(text);
  if (clean.trim() === "" || !(size > 0)) return undefined;
  const font = context.fonts.get(variant);
  const width = font.font.widthOfTextAtSize(clean, size);
  const squeeze = options.maxWidth !== undefined && width > options.maxWidth && width > 0 ? options.maxWidth / width : 1;
  const shown = width * squeeze;
  const dx = align === "center" ? -shown / 2 : align === "right" ? -shown : 0;
  // Glyfernas y är uppåt på papperet: med y nedåt (papperets mm) pekar "upp" mot −y. Vridningen är medurs på papperet.
  const radians = (options.rotation ?? 0) * Math.PI / 180;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  const up = options.yDown ? [sin, -cos] : [-sin, cos];
  const local: Matrix = [size * squeeze * cos, size * squeeze * sin, size * up[0]!, size * up[1]!, at.x + dx * cos, at.y + dx * sin];
  const matrix = multiply(m, local);
  return `BT /${font.name} 1 Tf ${matrix.map(num).join(" ")} Tm ${font.font.encodeText(clean).toString()} Tj ET`;
}

/** En symbolform (ruta 200 × 200, y uppåt) med rutans mitt i `center` (mm, y nedåt) och sidan `size`. */
function shapeOps(context: FigureContext, m: Matrix, shape: SymbolShape, center: Pt, size: number, paint: Paint): void {
  const unit = size / 200;
  const at = (point: Pt): Pt => ({ x: center.x + point.x * unit, y: center.y - point.y * unit });
  const content = context.content;
  const s = scaleOf(m);
  switch (shape.kind) {
    case "polyline":
      content.stroke(paint);
      content.lineStyle(shape.width * unit * s, shape.ends === "flat" ? 0 : 1, shape.corners === "sharp" ? 0 : 1, [], 5);
      content.op(`${polyline(m, shape.points.map(at), shape.closed === true)} S`);
      break;
    case "polygon":
      content.fill(paint);
      content.op(`${polyline(m, shape.points.map(at), true)} f*`);
      break;
    case "circle": case "disc": {
      const c = at(shape.center);
      // Ruta med y nedåt: bågen ritas med vänd y (moturs blir medurs), det spelar ingen roll för en hel ring.
      const path = `${arcPath(m, c, shape.radius * unit, 0, 360, true)} h`;
      if (shape.kind === "disc") { content.fill(paint); content.op(`${path} f`); }
      else { content.stroke(paint); content.lineStyle(shape.width * unit * s, 1, 1); content.op(`${path} S`); }
      break;
    }
    case "bezier": {
      const points = shape.points.map(at);
      if (points.length === 0) return;
      const [x0, y0] = apply(m, points[0]!);
      const parts = [`${num(x0)} ${num(y0)} m`];
      for (let index = 1; index + 2 < points.length; index += 3) {
        const [ax, ay] = apply(m, points[index]!), [bx, by] = apply(m, points[index + 1]!), [cx, cy] = apply(m, points[index + 2]!);
        parts.push(`${num(ax)} ${num(ay)} ${num(bx)} ${num(by)} ${num(cx)} ${num(cy)} c`);
      }
      if (shape.filled) { content.fill(paint); content.op(`${parts.join(" ")} h f*`); }
      else { content.stroke(paint); content.lineStyle(shape.width * unit * s, shape.ends === "flat" ? 0 : 1, 1, [], 5); content.op(`${parts.join(" ")} S`); }
      break;
    }
  }
}

/**
 * Kontrollbeskrivningen: `m` tar beskrivningens mm (y nedåt, (0,0) i övre vänstra hörnet) till PDF:ens punkter.
 * Vit bakgrund (slår ut kartan under), linjer, symboler och texter i `paint` (svart eller banans färg).
 */
export function descriptionOps(context: FigureContext, m: Matrix, layout: DescriptionLayout, paint: Paint): void {
  const content = context.content;
  const s = scaleOf(m);
  content.fill(WHITE);
  content.op(`${polyline(m, [{ x: 0, y: 0 }, { x: layout.widthMm, y: 0 }, { x: layout.widthMm, y: layout.heightMm }, { x: 0, y: layout.heightMm }], true)} f`);
  for (const primitive of layout.primitives) {
    switch (primitive.kind) {
      case "line":
        content.stroke(paint);
        content.lineStyle(primitive.width * s, 0, 1);
        content.op(`${polyline(m, [primitive.from, primitive.to], false)} S`);
        break;
      case "symbol": {
        const symbol = context.symbols.get(primitive.symbol);
        if (!symbol) {
          context.notes.add(`Beskrivningssymbolen ${primitive.symbol} finns inte och skrivs som sitt id.`);
          const ops = textOps(context, m, primitive.symbol, { x: primitive.at.x, y: primitive.at.y + primitive.size * 0.12 }, primitive.size * 0.35, "regular", "center", { yDown: true });
          if (ops) { content.fill(paint); content.op(ops); }
          break;
        }
        for (const shape of symbol.shapes) shapeOps(context, m, shape, primitive.at, primitive.size, paint);
        break;
      }
      case "text": {
        const ops = textOps(context, m, primitive.text, primitive.at, primitive.heightMm, fontVariant({ bold: primitive.bold === true, condensed: primitive.condensed === true }),
          primitive.align, { yDown: true, maxWidth: primitive.maxWidth });
        if (ops) { content.fill(paint); content.op(ops); }
        break;
      }
      case "hit": break;
    }
  }
}

/**
 * Figurerna i en kartram i målningsordning. `m` tar kartans mm (y uppåt) till PDF:ens punkter; den är likformig (skala och
 * förflyttning), så ringar och bågar behåller sin form.
 */
export function figureOps(context: FigureContext, m: Matrix, figures: readonly OverprintPrimitive[]): void {
  const content = context.content;
  const s = scaleOf(m);
  for (const primitive of figures) {
    if (primitive.kind === "image") {
      const image = context.image(primitive.mediaType, primitive.data);
      if (!image) continue;
      const [x0, y0] = apply(m, { x: primitive.rect.minX, y: primitive.rect.minY });
      const [x1, y1] = apply(m, { x: primitive.rect.maxX, y: primitive.rect.maxY });
      content.save();
      content.op(`${num(x1 - x0)} 0 0 ${num(y1 - y0)} ${num(x0)} ${num(y0)} cm /${image.name} Do`);
      content.restore();
      continue;
    }
    const paint = paintOf(context, primitive);
    switch (primitive.kind) {
      case "circle": {
        const r = primitive.diameter / 2;
        content.stroke(paint);
        content.lineStyle(primitive.lineWidth * s, 0, 1);
        const parts = circleArcs(primitive.gaps).map(([start, end]) => arcPath(m, primitive.center, r, start, end, true) + (end - start >= 360 ? " h" : ""));
        content.op(`${parts.join(" ")} S`);
        break;
      }
      case "polyline":
        content.stroke(paint);
        content.lineStyle(primitive.width * s, primitive.cap === "round" ? 1 : 0, 1, (primitive.dash ?? []).map(value => value * s));
        content.op(`${polyline(m, primitive.points, primitive.closed === true)} S`);
        break;
      case "polygon":
        content.fill(primitive.tint !== undefined ? tinted(paint, primitive.tint) : paint);
        content.op(`${primitive.rings.map(ring => polyline(m, ring, true)).join(" ")} f*`);
        break;
      case "text": {
        // `at.y` är mitten av em-rutan (canvas "middle"): baslinjen ligger (över + under) / 2 lägre.
        const variant = primitive.font ? variantForFamily(primitive.font.family, primitive.font.bold, primitive.font.italic) : "regular";
        const font = context.fonts.get(variant);
        const baseline = { x: primitive.at.x, y: primitive.at.y - (font.ascent + font.descent) / 2 * primitive.heightMm };
        const ops = textOps(context, m, primitive.text, baseline, primitive.heightMm, variant, primitive.align === "left" ? "left" : "center");
        if (ops) { content.fill(paint); content.op(ops); }
        break;
      }
      case "description": {
        // Beskrivningens mm (y nedåt) från `topLeft` i kartans mm (y uppåt).
        const local: Matrix = [1, 0, 0, -1, primitive.topLeft.x, primitive.topLeft.y];
        descriptionOps(context, multiply(m, local), primitive.layout, paint);
        break;
      }
    }
  }
}
