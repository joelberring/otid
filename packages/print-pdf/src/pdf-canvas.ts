/**
 * Steg 65: en "canvas" som skriver PDF-operatorer, så att `drawMap` (`@o-tid/map-file`) ritar kartan som vektorer med
 * exakt samma geometri som på skärmen. Kanvasens transform (CTM) följs i JavaScript och punkterna skrivs i PDF:ens
 * koordinater; linjebredd och streckning räknas om med transformen när linjen ritas (som canvas gör). Färgen väljs av
 * `drawMap`:s `beforeColor` (kartfärgen som dekorfärg eller CMYK med övertryck), inte av CSS-strängen; CSS-strängens
 * alfa (mönster som tonad yta) blir en andel av färgen.
 */
import type { MapColor, MapDrawingContext } from "@o-tid/map-file";
import { num, type Content } from "./content";
import { variantForFamily, printable, type Fonts } from "./fonts";
import { tinted, type Paint } from "./paint";

type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(left: Matrix, right: Matrix): Matrix {
  const [a, b, c, d, e, f] = left, [A, B, C, D, E, F] = right;
  return [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
}
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function invert(m: Matrix): Matrix | undefined {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return undefined;
  const [a, b, c, d, e, f] = m;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}
/** Likformig (rotation, spegling och lika skala i båda led): linjebredden kan räknas om med en faktor. */
function similarity(m: Matrix): number | undefined {
  const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
  const dot = m[0] * m[2] + m[1] * m[3];
  if (sx === 0 || Math.abs(sx - sy) > 1e-6 * sx || Math.abs(dot) > 1e-6 * sx * sy) return undefined;
  return sx;
}

type Segment = { readonly op: "m" | "l"; readonly x: number; readonly y: number } | { readonly op: "c"; readonly p: readonly [number, number, number, number, number, number] };

interface CanvasState {
  ctm: Matrix; fillStyle: string; strokeStyle: string; lineWidth: number; lineCap: CanvasLineCap; lineJoin: CanvasLineJoin; dash: number[];
  font: string; textAlign: CanvasTextAlign; textBaseline: CanvasTextBaseline;
}

const CAP = { butt: 0, round: 1, square: 2 } as const;
const JOIN = { miter: 0, round: 1, bevel: 2 } as const;

/** Alfa ur `rgba(r, g, b, a)` (1 för andra former). */
function alphaOf(style: string): number {
  const match = /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/.exec(style);
  return match ? Math.min(1, Math.max(0, Number(match[1]))) : 1;
}

export interface PdfCanvasOptions {
  /** Kanvasens pixlar → PDF:ens punkter (y uppåt). */
  readonly device: Matrix;
  readonly width: number;
  readonly height: number;
  readonly content: Content;
  readonly fonts: Fonts;
  /** Kartfärgens färg att trycka (`null` = dold). */
  readonly paintFor: (color: MapColor) => Paint | null;
}

export class PdfCanvas implements MapDrawingContext {
  readonly canvas: { width: number; height: number };
  private state: CanvasState = { ctm: IDENTITY, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, lineCap: "butt", lineJoin: "miter", dash: [],
    font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic" };
  private readonly stack: CanvasState[] = [];
  private path: Segment[] = [];
  private current: [number, number] | undefined;
  private paint: Paint | null = null;
  private colorOpacity = 1;
  /** Ritade delar (vägar och texter), för rapporten och testerna. */
  painted = 0;

  constructor(private readonly options: PdfCanvasOptions) {
    this.canvas = { width: options.width, height: options.height };
  }

  /** `drawMap`:s `beforeColor`. */
  readonly beforeColor = (color: MapColor): void => {
    this.paint = this.options.paintFor(color);
    this.colorOpacity = color.opacity > 0 ? color.opacity : 1;
  };

  get fillStyle(): unknown { return this.state.fillStyle; }
  set fillStyle(value: unknown) { this.state.fillStyle = String(value); }
  get strokeStyle(): unknown { return this.state.strokeStyle; }
  set strokeStyle(value: unknown) { this.state.strokeStyle = String(value); }
  get lineWidth(): number { return this.state.lineWidth; }
  set lineWidth(value: number) { if (Number.isFinite(value) && value > 0) this.state.lineWidth = value; }
  get lineCap(): CanvasLineCap { return this.state.lineCap; }
  set lineCap(value: CanvasLineCap) { this.state.lineCap = value; }
  get lineJoin(): CanvasLineJoin { return this.state.lineJoin; }
  set lineJoin(value: CanvasLineJoin) { this.state.lineJoin = value; }
  get font(): string { return this.state.font; }
  set font(value: string) { this.state.font = value; }
  get textAlign(): CanvasTextAlign { return this.state.textAlign; }
  set textAlign(value: CanvasTextAlign) { this.state.textAlign = value; }
  get textBaseline(): CanvasTextBaseline { return this.state.textBaseline; }
  set textBaseline(value: CanvasTextBaseline) { this.state.textBaseline = value; }

  save(): void {
    this.stack.push({ ...this.state, dash: [...this.state.dash] });
    this.options.content.save();
  }
  restore(): void {
    const previous = this.stack.pop();
    if (!previous) return;
    this.state = previous;
    this.options.content.restore();
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void { this.state.ctm = [a, b, c, d, e, f]; }
  translate(x: number, y: number): void { this.state.ctm = multiply(this.state.ctm, [1, 0, 0, 1, x, y]); }
  rotate(angle: number): void {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    this.state.ctm = multiply(this.state.ctm, [cos, sin, -sin, cos, 0, 0]);
  }
  scale(x: number, y: number): void { this.state.ctm = multiply(this.state.ctm, [x, 0, 0, y, 0, 0]); }
  setLineDash(segments: number[]): void { this.state.dash = segments.filter(value => Number.isFinite(value) && value >= 0); }

  private toDevice(x: number, y: number): [number, number] {
    return apply(multiply(this.options.device, this.state.ctm), x, y);
  }

  beginPath(): void { this.path = []; this.current = undefined; }
  moveTo(x: number, y: number): void {
    const [px, py] = this.toDevice(x, y);
    this.path.push({ op: "m", x: px, y: py });
    this.current = [px, py];
  }
  lineTo(x: number, y: number): void {
    const [px, py] = this.toDevice(x, y);
    this.path.push({ op: this.current ? "l" : "m", x: px, y: py });
    this.current = [px, py];
  }
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
    if (!this.current) this.moveTo(cp1x, cp1y);
    const [ax, ay] = this.toDevice(cp1x, cp1y), [bx, by] = this.toDevice(cp2x, cp2y), [cx, cy] = this.toDevice(x, y);
    this.path.push({ op: "c", p: [ax, ay, bx, by, cx, cy] });
    this.current = [cx, cy];
  }
  /** Bågen som kubiska bézierkurvor (högst 90° per kurva) i användarens koordinater. */
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise = false): void {
    if (!(radius >= 0)) return;
    let sweep = endAngle - startAngle;
    if (!counterclockwise) { if (sweep < 0 || sweep > 2 * Math.PI) sweep = sweep >= 2 * Math.PI ? 2 * Math.PI : ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); }
    else { if (sweep > 0 || sweep < -2 * Math.PI) sweep = sweep <= -2 * Math.PI ? -2 * Math.PI : -((((-sweep) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)); }
    const startX = x + radius * Math.cos(startAngle), startY = y + radius * Math.sin(startAngle);
    if (this.current) this.lineTo(startX, startY); else this.moveTo(startX, startY);
    const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
    const step = sweep / pieces;
    const k = (4 / 3) * Math.tan(step / 4);
    let angle = startAngle;
    for (let index = 0; index < pieces; index += 1) {
      const next = angle + step;
      const [c0, s0, c1, s1] = [Math.cos(angle), Math.sin(angle), Math.cos(next), Math.sin(next)];
      this.bezierCurveTo(x + radius * (c0 - k * s0), y + radius * (s0 + k * c0), x + radius * (c1 + k * s1), y + radius * (s1 - k * c1),
        x + radius * c1, y + radius * s1);
      angle = next;
    }
  }

  private emitPath(transform?: Matrix): boolean {
    if (this.path.length === 0) return false;
    const out: string[] = [];
    const map = transform ? (x: number, y: number) => apply(transform, x, y) : (x: number, y: number): [number, number] => [x, y];
    for (const segment of this.path) {
      if (segment.op === "c") {
        const [ax, ay] = map(segment.p[0], segment.p[1]), [bx, by] = map(segment.p[2], segment.p[3]), [cx, cy] = map(segment.p[4], segment.p[5]);
        out.push(`${num(ax)} ${num(ay)} ${num(bx)} ${num(by)} ${num(cx)} ${num(cy)} c`);
      } else {
        const [px, py] = map(segment.x, segment.y);
        out.push(`${num(px)} ${num(py)} ${segment.op}`);
      }
    }
    this.options.content.op(out.join("\n"));
    return true;
  }

  private paintWith(style: string): Paint | null {
    if (!this.paint) return null;
    const alpha = alphaOf(style) / this.colorOpacity;
    return alpha >= 0.9995 ? this.paint : tinted(this.paint, alpha);
  }

  stroke(): void {
    const paint = this.paintWith(this.state.strokeStyle);
    if (!paint || this.path.length === 0) return;
    const content = this.options.content;
    const m = multiply(this.options.device, this.state.ctm);
    const factor = similarity(m);
    content.stroke(paint);
    const cap = CAP[this.state.lineCap], join = JOIN[this.state.lineJoin];
    if (factor !== undefined) {
      content.lineStyle(this.state.lineWidth * factor, cap, join, this.state.dash.map(value => value * factor));
      this.emitPath();
      content.op("S");
    } else {
      // Olika skala i x och y (t.ex. en sträckt hörnsymbol): linjen ritas i användarens koordinater som canvas gör.
      const inverse = invert(m);
      if (!inverse) return;
      content.save();
      content.op(`${m.map(num).join(" ")} cm`);
      content.lineStyle(this.state.lineWidth, cap, join, this.state.dash);
      this.emitPath(inverse);
      content.op("S");
      content.restore();
    }
    this.painted += 1;
  }

  fill(fillRule: CanvasFillRule = "nonzero"): void {
    const paint = this.paintWith(this.state.fillStyle);
    if (!paint || this.path.length === 0) return;
    this.options.content.fill(paint);
    this.emitPath();
    this.options.content.op(fillRule === "evenodd" ? "f*" : "f");
    this.painted += 1;
  }

  clip(fillRule: CanvasFillRule = "nonzero"): void {
    if (this.path.length === 0) {
      // Tom klippväg: inget syns (som canvas).
      this.options.content.op("0 0 m h W n");
      return;
    }
    this.emitPath();
    this.options.content.op(fillRule === "evenodd" ? "W* n" : "W n");
  }

  /** Bara bakgrunden använder fillRect: vit yta som slår ut (papperet i ramen). */
  fillRect(x: number, y: number, w: number, h: number): void {
    const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => this.toDevice(px!, py!));
    const style = this.state.fillStyle.trim().toLowerCase();
    const white = style === "#fff" || style === "#ffffff" || /^rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(style);
    const paint = white ? { ink: { kind: "CMYK" as const, cmyk: { c: 0, m: 0, y: 0, k: 0 } }, overprint: false } : this.paintWith(this.state.fillStyle);
    if (!paint) return;
    this.options.content.fill(paint);
    this.options.content.op(`${corners.map(([px, py], index) => `${num(px)} ${num(py)} ${index === 0 ? "m" : "l"}`).join(" ")} h f`);
  }

  /** Text med Roboto i kanvasens storlek (`font`: "bold 12px …"), baslinjen i (x, y) och y nedåt som canvas. */
  fillText(text: string, x: number, y: number): void {
    const paint = this.paintWith(this.state.fillStyle);
    const clean = printable(text);
    if (!paint || clean.trim() === "") return;
    const match = /(\d+(?:\.\d+)?)px/.exec(this.state.font);
    const size = match ? Number(match[1]) : 10;
    const family = /px\s+"?([^",]+)/.exec(this.state.font)?.[1];
    const font = this.options.fonts.get(variantForFamily(family, /\bbold\b/.test(this.state.font), /\bitalic\b/.test(this.state.font)));
    const width = font.font.widthOfTextAtSize(clean, size);
    const dx = this.state.textAlign === "center" ? -width / 2 : this.state.textAlign === "right" || this.state.textAlign === "end" ? -width : 0;
    const dy = this.state.textBaseline === "middle" ? (font.ascent + font.descent) / 2 * size : this.state.textBaseline === "top" ? font.ascent * size : 0;
    const matrix = multiply(multiply(this.options.device, this.state.ctm), [size, 0, 0, -size, x + dx, y + dy]);
    this.options.content.fill(paint);
    this.options.content.op(`BT /${font.name} 1 Tf ${matrix.map(num).join(" ")} Tm ${font.font.encodeText(clean).toString()} Tj ET`);
    this.painted += 1;
  }
}
