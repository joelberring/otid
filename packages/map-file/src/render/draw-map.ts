import type {
  AreaSymbol, HatchStyle, LineSymbol, MapColor, MapObject, MapSymbol, ParsedMap, Path, Point, PointElement, StrokeStyle, TextSymbol
} from "../model";
import { flattenPath, offsetPolyline, pathsBox, placementsAlong, type Polyline } from "./geometry";

/**
 * Steg 59 (ADR-0179 beslut 2): kartan ritad för skärmen (inte för tryck) på en canvas i webbläsaren. Bara typerna för
 * canvas används; ingen DOM. Ritningen görs i filens färgordning: färgen med högst `rank` först och `rank` 0 sist, och
 * för varje färg alla delar av alla objekt som använder den (som OCAD och Mapper gör).
 *
 * Koordinater: kartans mm med y uppåt. `origin` är kartans punkt (mm) i bildens övre vänstra hörn, så att
 * pixel = ((x − origin.x)·pxPerMm, (origin.y − y)·pxPerMm).
 *
 * Vinklar i modellen är grader moturs (som hatch-vinkeln); objektens vinkel vrider punktsymboler, text och ytmönster.
 */
export type MapCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface DrawMapOptions {
  readonly pxPerMm: number;
  readonly origin: Point;
}

export interface DrawMapReport {
  /** Delar som ritats (en del = en färg i ett objekt). */
  readonly parts: number;
  /** Förenklingar i skärmbilden, på svenska för arrangören. */
  readonly simplifications: readonly string[];
}

/** Högst så många mönsterpunkter per yta; fler ritas som tonad yta (skärmen blir ändå en jämn ton). */
export const MAX_PATTERN_INSTANCES = 20_000;
/** Högst så många upprepade punktsymboler per linje. */
const MAX_REPEATS = 20_000;
const DEGREES = Math.PI / 180;

type Drawer = (ctx: MapCanvasContext) => void;

class Simplifications {
  private readonly patterns = new Set<string>();
  private readonly other = new Set<string>();
  pattern(code: string) { this.patterns.add(code); }
  add(text: string) { this.other.add(text); }
  list(): string[] {
    const codes = [...this.patterns].sort((a, b) => a.localeCompare(b, "sv-SE", { numeric: true }));
    const out = codes.length === 0 ? [] : [codes.length === 1 ? `Mönstret för ${codes[0]} ritas som tonad yta`
      : `Mönstren för ${codes.slice(0, 8).join(", ")}${codes.length > 8 ? " m.fl." : ""} ritas som tonade ytor`];
    return [...out, ...[...this.other].sort((a, b) => a.localeCompare(b, "sv-SE"))];
  }
}

function css(color: MapColor, alpha = 1): string {
  const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);
  const opacity = Math.min(1, Math.max(0, color.opacity * alpha));
  return `rgba(${channel(color.rgb.r)}, ${channel(color.rgb.g)}, ${channel(color.rgb.b)}, ${Math.round(opacity * 1000) / 1000})`;
}

function trace(ctx: MapCanvasContext, path: Path) {
  for (const command of path) {
    if (command.type === "M") ctx.moveTo(command.x, command.y);
    else if (command.type === "L") ctx.lineTo(command.x, command.y);
    else ctx.bezierCurveTo(command.x1, command.y1, command.x2, command.y2, command.x, command.y);
  }
}

function tracePolylines(ctx: MapCanvasContext, lines: readonly Polyline[]) {
  for (const line of lines) line.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
}

function strokeStyle(ctx: MapCanvasContext, stroke: StrokeStyle, color: MapColor) {
  ctx.strokeStyle = css(color);
  ctx.lineWidth = stroke.width;
  ctx.lineCap = stroke.cap ?? "butt";
  ctx.lineJoin = stroke.join ?? "miter";
  ctx.setLineDash(stroke.dash && stroke.dash.length > 0 && stroke.dash.every(value => value >= 0) && stroke.dash.some(value => value > 0)
    ? [...stroke.dash] : []);
}

/** En del av en punktsymbol, i symbolens egna mm (mittpunkten i origo, y uppåt). */
function drawElement(ctx: MapCanvasContext, element: PointElement, color: MapColor) {
  ctx.beginPath();
  if (element.kind === "circle") {
    ctx.arc(element.center.x, element.center.y, Math.max(0, (element.diameter - element.lineWidth) / 2), 0, Math.PI * 2);
    ctx.strokeStyle = css(color); ctx.lineWidth = element.lineWidth; ctx.setLineDash([]);
    ctx.stroke();
  } else if (element.kind === "dot") {
    ctx.arc(element.center.x, element.center.y, element.diameter / 2, 0, Math.PI * 2);
    ctx.fillStyle = css(color);
    ctx.fill();
  } else if (element.kind === "line") {
    trace(ctx, element.path);
    ctx.strokeStyle = css(color); ctx.lineWidth = element.width; ctx.lineCap = "butt"; ctx.lineJoin = "miter"; ctx.setLineDash([]);
    ctx.stroke();
  } else {
    for (const ring of element.rings) trace(ctx, ring);
    ctx.fillStyle = css(color);
    ctx.fill("evenodd");
  }
}

function placed(ctx: MapCanvasContext, at: Point, angleRadians: number, draw: () => void) {
  ctx.save();
  ctx.translate(at.x, at.y);
  if (angleRadians !== 0) ctx.rotate(angleRadians);
  draw();
  ctx.restore();
}

/** Samlar ritningen per färg. */
class Plan {
  readonly byColor = new Map<number, Drawer[]>();
  constructor(readonly colors: ReadonlyMap<number, MapColor>, readonly simplifications: Simplifications) {}
  add(colorId: number, drawer: (ctx: MapCanvasContext, color: MapColor) => void) {
    const color = this.colors.get(colorId);
    // En färg som inte finns i färgtabellen (t.ex. Mappers registerfärg för passmärken) ritas inte.
    if (!color) { this.simplifications.add("Delar i färger som saknas i färgtabellen (t.ex. passmärken) ritas inte"); return; }
    if (color.opacity <= 0) return;
    const list = this.byColor.get(colorId);
    const item: Drawer = ctx => drawer(ctx, color);
    if (list) list.push(item); else this.byColor.set(colorId, [item]);
  }
}

function elementsByColor(elements: readonly PointElement[]): Map<number, PointElement[]> {
  const out = new Map<number, PointElement[]>();
  for (const element of elements) {
    const list = out.get(element.color);
    if (list) list.push(element); else out.set(element.color, [element]);
  }
  return out;
}

function planPoint(plan: Plan, elements: readonly PointElement[], at: Point, angleDegrees: number) {
  for (const [colorId, parts] of elementsByColor(elements)) {
    plan.add(colorId, (ctx, color) => placed(ctx, at, angleDegrees * DEGREES, () => { for (const part of parts) drawElement(ctx, part, color); }));
  }
}

function planStroke(plan: Plan, stroke: StrokeStyle, paths: readonly Path[]) {
  if (!(stroke.width > 0)) return;
  plan.add(stroke.color, (ctx, color) => {
    ctx.beginPath();
    if (stroke.offset) tracePolylines(ctx, paths.flatMap(path => flattenPath(path).map(line => offsetPolyline(line, stroke.offset!))));
    else for (const path of paths) trace(ctx, path);
    strokeStyle(ctx, stroke, color);
    ctx.stroke();
  });
}

function planLine(plan: Plan, symbol: LineSymbol, paths: readonly Path[]) {
  for (const stroke of symbol.strokes) planStroke(plan, stroke, paths);
  const repeated = symbol.repeated;
  if (!repeated || repeated.elements.length === 0) return;
  const spacing = repeated.spacing > 0 ? repeated.spacing : 0;
  let places = paths.flatMap(path => flattenPath(path).flatMap(line => placementsAlong(line, spacing)));
  if (places.length > MAX_REPEATS) {
    places = places.slice(0, MAX_REPEATS);
    plan.simplifications.add(`Upprepade tecken längs ${symbol.code.text} ritas bara delvis`);
  }
  for (const [colorId, parts] of elementsByColor(repeated.elements)) {
    plan.add(colorId, (ctx, color) => {
      for (const place of places) placed(ctx, place.at, place.angle, () => { for (const part of parts) drawElement(ctx, part, color); });
    });
  }
}

function clipTo(ctx: MapCanvasContext, rings: readonly Path[]) {
  ctx.beginPath();
  for (const ring of rings) trace(ctx, ring);
  ctx.clip("evenodd");
}

function fillRings(ctx: MapCanvasContext, rings: readonly Path[], style: string) {
  ctx.beginPath();
  for (const ring of rings) trace(ctx, ring);
  ctx.fillStyle = style;
  ctx.fill("evenodd");
}

/** Linjer med jämnt avstånd över ytans ruta i hatch-vinkeln (plus objektets vinkel), klippta till ytan. */
function drawHatch(ctx: MapCanvasContext, rings: readonly Path[], hatch: HatchStyle, angleDegrees: number, color: MapColor) {
  const box = pathsBox(rings);
  if (!box) return;
  const angle = (hatch.angle + angleDegrees) * DEGREES;
  const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
  const radius = Math.hypot(box.maxX - box.minX, box.maxY - box.minY) / 2 + hatch.width;
  const count = Math.ceil(radius / hatch.spacing);
  ctx.save();
  clipTo(ctx, rings);
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.beginPath();
  for (let index = -count; index <= count; index += 1) {
    ctx.moveTo(-radius, index * hatch.spacing);
    ctx.lineTo(radius, index * hatch.spacing);
  }
  ctx.strokeStyle = css(color); ctx.lineWidth = hatch.width; ctx.lineCap = "butt"; ctx.setLineDash([]);
  ctx.stroke();
  ctx.restore();
}

/** Andel av rutan som mönstrets delar täcker, för den tonade ytan när mönstret är för tätt att rita. */
function coverage(parts: readonly PointElement[], dx: number, dy: number): number {
  let area = 0;
  for (const part of parts) {
    if (part.kind === "dot") area += Math.PI * (part.diameter / 2) ** 2;
    else if (part.kind === "circle") area += Math.PI * part.diameter * part.lineWidth;
    else if (part.kind === "line") area += part.width * flattenPath(part.path).reduce((sum, line) =>
      sum + line.slice(1).reduce((length, point, index) => length + Math.hypot(point.x - line[index]!.x, point.y - line[index]!.y), 0), 0);
    else { const box = pathsBox(part.rings); if (box) area += (box.maxX - box.minX) * (box.maxY - box.minY) * 0.6; }
  }
  return Math.min(1, Math.max(0.1, area / (dx * dy)));
}

function planArea(plan: Plan, symbol: AreaSymbol, rings: readonly Path[], angleDegrees: number) {
  if (rings.length === 0) return;
  if (symbol.fill !== undefined) plan.add(symbol.fill, (ctx, color) => fillRings(ctx, rings, css(color)));
  for (const hatch of symbol.hatches) {
    if (!(hatch.spacing > 0) || !(hatch.width > 0)) continue;
    plan.add(hatch.color, (ctx, color) => drawHatch(ctx, rings, hatch, angleDegrees, color));
  }
  const pattern = symbol.pattern;
  if (pattern && pattern.elements.length > 0 && pattern.dx > 0 && pattern.dy > 0) {
    const box = pathsBox(rings);
    if (box) {
      const radius = Math.hypot(box.maxX - box.minX, box.maxY - box.minY) / 2;
      const nx = Math.ceil(radius / pattern.dx), ny = Math.ceil(radius / pattern.dy);
      const instances = (2 * nx + 1) * (2 * ny + 1);
      const groups = elementsByColor(pattern.elements);
      if (instances > MAX_PATTERN_INSTANCES) {
        plan.simplifications.pattern(symbol.code.text);
        for (const [colorId, parts] of groups) {
          const alpha = coverage(parts, pattern.dx, pattern.dy);
          plan.add(colorId, (ctx, color) => fillRings(ctx, rings, css(color, alpha)));
        }
      } else {
        const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
        for (const [colorId, parts] of groups) {
          plan.add(colorId, (ctx, color) => {
            ctx.save();
            clipTo(ctx, rings);
            ctx.translate(cx, cy);
            // Rutnätets egen vinkel (symbolen) plus objektets vinkel.
            const rotation = (pattern.angle ?? 0) + angleDegrees;
            if (rotation !== 0) ctx.rotate(rotation * DEGREES);
            for (let i = -nx; i <= nx; i += 1) for (let j = -ny; j <= ny; j += 1) {
              placed(ctx, { x: i * pattern.dx, y: j * pattern.dy }, 0, () => { for (const part of parts) drawElement(ctx, part, color); });
            }
            ctx.restore();
          });
        }
      }
    }
  }
  if (symbol.border) for (const stroke of symbol.border) planStroke(plan, stroke, rings);
}

function planText(plan: Plan, symbol: TextSymbol, object: Extract<MapObject, { kind: "text" }>, options: DrawMapOptions) {
  if (!object.text.trim() || !(symbol.size > 0)) return;
  plan.add(symbol.color, (ctx, color) => {
    // Texten ritas i bildens pixlar (y nedåt) så att typsnittet inte speglas och får sin storlek i px.
    const px = (object.at.x - options.origin.x) * options.pxPerMm, py = (options.origin.y - object.at.y) * options.pxPerMm;
    const size = symbol.size * options.pxPerMm;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, px, py);
    if (object.angle !== 0) ctx.rotate(-object.angle * DEGREES);
    ctx.font = `${symbol.italic ? "italic " : ""}${symbol.bold ? "bold " : ""}${Math.round(size * 10) / 10}px ${fontFamily(symbol.fontFamily)}`;
    ctx.fillStyle = css(color);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    object.text.split(/\r?\n/).forEach((line, index) => ctx.fillText(line, 0, index * size * 1.15));
    ctx.restore();
  });
}

function fontFamily(name: string): string {
  const clean = name.replace(/["\\;{}]/g, "").trim();
  return clean ? `"${clean}", sans-serif` : "sans-serif";
}

/** Delarna i en kombinerad symbol (Mapper), utan cirklar och med ett tak för djupet. */
function resolveSymbols(symbols: ParsedMap["symbols"], id: string, depth = 0, seen = new Set<string>()): MapSymbol[] {
  const symbol = symbols.get(id);
  if (!symbol || symbol.hidden || depth > 8 || seen.has(id)) return [];
  if (symbol.kind !== "COMBINED") return [symbol];
  const next = new Set(seen).add(id);
  return symbol.parts.flatMap(part => resolveSymbols(symbols, part, depth + 1, next));
}

function planObject(plan: Plan, map: ParsedMap, object: MapObject, options: DrawMapOptions): number {
  let parts = 0;
  for (const symbol of resolveSymbols(map.symbols, object.symbol)) {
    switch (object.kind) {
      case "point":
        if (symbol.kind === "POINT") { planPoint(plan, symbol.elements, object.at, object.angle); parts += 1; }
        break;
      case "line":
        if (symbol.kind === "LINE") { planLine(plan, symbol, [object.path]); parts += 1; }
        else if (symbol.kind === "AREA") { planArea(plan, symbol, [object.path], 0); parts += 1; }
        break;
      case "area":
        if (symbol.kind === "AREA") { planArea(plan, symbol, object.rings, object.angle); parts += 1; }
        else if (symbol.kind === "LINE") { planLine(plan, symbol, object.rings); parts += 1; }
        break;
      case "text":
        if (symbol.kind === "TEXT") { planText(plan, symbol, object, options); parts += 1; }
        break;
    }
  }
  return parts;
}

/**
 * Ritar kartan på `ctx`. Bilden fylls först med vitt (papperet). Returnerar antalet ritade delar och förenklingarna.
 */
export function drawMap(ctx: MapCanvasContext, map: ParsedMap, options: DrawMapOptions): DrawMapReport {
  const simplifications = new Simplifications();
  simplifications.add("Text ritas med standardtypsnitt och vänsterställd");
  if (map.colors.some(color => color.spot)) simplifications.add("Dekorfärger och övertryck visas som vanliga färger");
  const colors = new Map(map.colors.map(color => [color.id, color]));
  const plan = new Plan(colors, simplifications);
  let parts = 0;
  for (const object of map.objects) parts += planObject(plan, map, object, options);
  const width = ctx.canvas.width, height = ctx.canvas.height;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  // Kartans mm (y uppåt) → bildens pixlar (y nedåt).
  ctx.setTransform(options.pxPerMm, 0, 0, -options.pxPerMm, -options.origin.x * options.pxPerMm, options.origin.y * options.pxPerMm);
  const order = [...map.colors].sort((left, right) => right.rank - left.rank || left.id - right.id);
  for (const color of order) {
    for (const drawer of plan.byColor.get(color.id) ?? []) drawer(ctx);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { parts, simplifications: simplifications.list() };
}
