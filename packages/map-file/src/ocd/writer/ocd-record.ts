/**
 * Rena binära byggstenar för OCAD-objektposter och `TObjectIndex.rc`-rektanglar (v9–2018+).
 * Speglar all härdad Steg 1-logik (`ObjType = 4` 5-punkts textruta, roterad `rc` + `TBaseSym.Extent`, ändliga `delphiDate`,
 * `\r\n`-normaliserad UTF-16LE och bevarade höga koordinatflaggbitar).
 */
import { maxOf, minOf, normalizeAngle } from "../../geometry";
import type { MapObject, MapSymbol, StrokeStyle } from "../../model";
import { GeometryError } from "../../revision/geometry";
import { OBJECT_TYPE, type OcdVariant } from "../layout";

export const V9_OBJ = { objectStrings: 14, color: 16, lineWidth: 20 } as const;
export const V12_OBJ = {
  color: 8, lineWidth: 12, serverIdEnd: 24, created: 24, multiRep: 32, modified: 36, objectStrings: 50, databaseStrings: 52
} as const;
export const OCD_COORD_LIMIT = (1 << 23) - 1;
export const MAX_TEXT_WORDS = 0xffff;
const MODELED = 0x0f;

export interface RawPt { readonly x: number; readonly y: number; readonly xf: number; readonly yf: number }
interface Box { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }

export const ocdUnit = (value: number): number => {
  if (!Number.isFinite(value)) throw new GeometryError("Geometrin har en koordinat som inte är ett tal.");
  const result = Math.round(value * 100);
  if (Math.abs(result) > OCD_COORD_LIMIT) throw new GeometryError("Geometrin ligger utanför det område som OCAD kan lagra.");
  return result === 0 ? 0 : result;
};

export const clampOcd = (value: number): number => Math.max(-OCD_COORD_LIMIT, Math.min(OCD_COORD_LIMIT, Math.round(value)));
const ceilUnits = (mm: number): number => Math.ceil(mm * 100 - 1e-9);
export const angleUnits = (degrees: number): number => Math.round(normalizeAngle(degrees) * 10) % 3600;

/** Delphis TDateTime (dagar sedan 1899-12-30). Skriver aldrig `NaN`. */
export function delphiDate(iso: string): number {
  const parsed = Date.parse(iso);
  const ms = Number.isFinite(parsed) ? parsed : Date.now();
  return (ms - Date.UTC(1899, 11, 30)) / 86_400_000;
}

/** OCAD-text: UTF-16LE med `\r\n`-radbrytningar och avslutande `\0`, utfylld till hela 8 byte. */
export function encodeOcdTextBytes(text: string): Uint8Array {
  const value = `${text.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n")}\0`;
  const out = new Uint8Array(Math.ceil((value.length * 2) / 8) * 8);
  for (let i = 0; i < value.length; i++) {
    out[2 * i] = value.charCodeAt(i) & 0xff;
    out[2 * i + 1] = value.charCodeAt(i) >> 8;
  }
  return out;
}

/** Bygger en komplett OCAD-objektpost (huvud + koordinater + UTF-16-text). */
export function buildOcdObjectRecord(
  variant: OcdVariant, header: Uint8Array | undefined, symbol: number, type: number, angle: number,
  points: readonly RawPt[], text: Uint8Array, at: string, created: boolean
): Uint8Array {
  const layout = variant.object;
  const out = new Uint8Array(layout.coords + points.length * 8 + text.length);
  const view = new DataView(out.buffer);
  if (header) out.set(header.subarray(0, layout.coords));
  view.setInt32(0, symbol, true);
  view.setUint8(layout.type, type);
  view.setInt16(layout.angle, angle, true);
  view.setUint32(layout.coordCount, points.length, true);
  view.setUint16(layout.textCount, text.length / 8, true);
  if (variant.version >= 12) {
    if (created) view.setFloat64(V12_OBJ.created, delphiDate(at), true);
    view.setFloat64(V12_OBJ.modified, delphiDate(at), true);
  }
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    view.setInt32(layout.coords + 8 * i, (p.x << 8) | (p.xf & 0xff), true);
    view.setInt32(layout.coords + 8 * i + 4, (p.y << 8) | (p.yf & 0xff), true);
  }
  out.set(text, layout.coords + points.length * 8);
  return out;
}

/** Symbolens huvudfärg för OCAD:s indexpost och v12-huvud när inget mallobjekt finns. */
export function symbolPrimaryColor(symbol: MapSymbol | undefined): number {
  switch (symbol?.kind) {
    case "POINT": return symbol.elements[0]?.color ?? 0;
    case "LINE": return symbol.strokes[0]?.color ?? symbol.repeated?.elements[0]?.color ?? 0;
    case "AREA": return symbol.fill ?? symbol.hatches[0]?.color ?? symbol.pattern?.elements[0]?.color ?? symbol.border?.[0]?.color ?? 0;
    case "TEXT": return symbol.color;
    default: return 0;
  }
}

function rotateBox(box: Box, angleDegrees: number): Box {
  const angle = normalizeAngle(angleDegrees);
  if (angle === 0) return { minX: Math.floor(box.minX), minY: Math.floor(box.minY), maxX: Math.ceil(box.maxX), maxY: Math.ceil(box.maxY) };
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of [[box.minX, box.minY], [box.maxX, box.minY], [box.maxX, box.maxY], [box.minX, box.maxY]] as const) {
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry;
    if (ry > maxY) maxY = ry;
  }
  return { minX: Math.floor(minX + 1e-9), minY: Math.floor(minY + 1e-9), maxX: Math.ceil(maxX - 1e-9), maxY: Math.ceil(maxY - 1e-9) };
}

function pointExtent(symbol: MapSymbol | undefined): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x: number, y: number) => {
    const ux = Math.round(x * 100), uy = Math.round(y * 100);
    if (ux < minX) minX = ux;
    if (ux > maxX) maxX = ux;
    if (uy < minY) minY = uy;
    if (uy > maxY) maxY = uy;
  };
  if (symbol?.kind === "POINT") {
    for (const el of symbol.elements) {
      if (el.kind === "circle" || el.kind === "dot") {
        const half = (el.diameter + (el.kind === "circle" ? el.lineWidth : 0)) / 2;
        grow(el.center.x - half, el.center.y - half);
        grow(el.center.x + half, el.center.y + half);
      } else {
        const paths = el.kind === "line" ? [el.path] : el.rings;
        const pad = el.kind === "line" ? el.width / 2 : 0;
        for (const path of paths) for (const cmd of path) {
          grow(cmd.x - pad, cmd.y - pad);
          grow(cmd.x + pad, cmd.y + pad);
          if (cmd.type === "C") { grow(cmd.x1, cmd.y1); grow(cmd.x2, cmd.y2); }
        }
      }
    }
  }
  if (!Number.isFinite(minX) || minX === maxX || minY === maxY) {
    const ext = symbol?.extent !== undefined && symbol.extent > 0 ? Math.round(symbol.extent * 100) : 100;
    return { minX: -ext, minY: -ext, maxX: ext, maxY: ext };
  }
  return { minX: Math.min(0, minX), minY: Math.min(0, minY), maxX: Math.max(0, maxX), maxY: Math.max(0, maxY) };
}

function textLocalBox(symbol: MapSymbol | undefined, text: string): Box {
  const sizeMm = symbol?.kind === "TEXT" && symbol.size > 0 ? symbol.size : 2.5;
  const h = Math.max(10, Math.round(sizeMm * 100));
  const lineStep = symbol?.kind === "TEXT" && symbol.lineSpacing && symbol.lineSpacing > 0 ? symbol.lineSpacing : 1.15;
  const align = symbol?.kind === "TEXT" ? symbol.align ?? "left" : "left";
  const baseline = symbol?.kind === "TEXT" ? symbol.baseline ?? "alphabetic" : "alphabetic";
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const lineCount = Math.max(1, lines.length);
  const maxChars = Math.max(1, ...lines.map(line => line.length));
  const width = Math.max(h, Math.ceil(maxChars * h * 0.7));
  const minX = align === "center" ? -Math.ceil(width / 2) : align === "right" ? -width : 0;
  const maxX = align === "center" ? Math.ceil(width / 2) : align === "right" ? 0 : width;
  if (baseline === "top") return { minX, minY: -Math.ceil(((lineCount - 1) * lineStep + 1.3) * h), maxX, maxY: Math.ceil(0.1 * h) };
  if (baseline === "middle") return { minX, minY: -Math.ceil(((lineCount - 1) * lineStep + 0.65) * h), maxX, maxY: Math.ceil(0.65 * h) };
  return { minX, minY: -Math.ceil(((lineCount - 1) * lineStep + 0.3) * h), maxX, maxY: Math.ceil(1.1 * h) };
}

/** OCAD:s 5 punkter för oformaterad text (`ObjType = 4`): ankare + textrutans 4 roterade hörn (NV, NH, ÖH, ÖV). */
export function textBoxPoints(anchor: RawPt, symbol: MapSymbol | undefined, text: string, angleDegrees: number): RawPt[] {
  const local = textLocalBox(symbol, text);
  const rad = (normalizeAngle(angleDegrees) * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const corner = (lx: number, ly: number): RawPt => ({
    x: clampOcd(anchor.x + lx * cos - ly * sin),
    y: clampOcd(anchor.y + lx * sin + ly * cos),
    xf: 0, yf: 0
  });
  return [anchor, corner(local.minX, local.minY), corner(local.maxX, local.minY), corner(local.maxX, local.maxY), corner(local.minX, local.maxY)];
}

function strokeHalfWidthUnits(strokes: readonly StrokeStyle[] | undefined): number {
  let maxHalf = 0;
  for (const stroke of strokes ?? []) {
    const reach = Math.abs(stroke.offset ?? 0) + stroke.width / 2;
    if (reach > maxHalf) maxHalf = reach;
  }
  return maxHalf > 0 ? ceilUnits(maxHalf) : 0;
}

function lineOrAreaMargin(symbol: MapSymbol | undefined, degenerate: boolean): number {
  if (symbol?.extent !== undefined && symbol.extent > 0) return Math.round(symbol.extent * 100);
  if (symbol?.kind === "LINE") { const h = strokeHalfWidthUnits(symbol.strokes); return h > 0 ? h : degenerate ? 10 : 0; }
  if (symbol?.kind === "AREA") { const h = strokeHalfWidthUnits(symbol.border); return h > 0 ? h : degenerate ? 10 : 0; }
  return degenerate ? 10 : 0;
}

/** Beräknar komplett 16-byte `TObjectIndex.rc` (nedre vänstra och övre högra hörnet med rotation och `TBaseSym.Extent`). */
export function computeOcdObjectRect(points: readonly RawPt[], symbol: MapSymbol | undefined, object: MapObject, type: number): Uint8Array {
  const out = new Uint8Array(16);
  const view = new DataView(out.buffer);
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  let x0 = minOf(xs), y0 = minOf(ys), x1 = maxOf(xs), y1 = maxOf(ys);
  const symExtent = symbol?.extent !== undefined && symbol.extent > 0 ? Math.round(symbol.extent * 100) : 0;
  if (object.kind === "point") {
    const rotated = rotateBox(pointExtent(symbol), object.angle);
    x0 += rotated.minX; y0 += rotated.minY; x1 += rotated.maxX; y1 += rotated.maxY;
  } else if (object.kind === "text") {
    const framingPad = symbol?.kind === "TEXT" && symbol.framing && symbol.framing.width > 0 ? ceilUnits(symbol.framing.width / 2) : 0;
    const pad = Math.max(symExtent, framingPad);
    if (type === OBJECT_TYPE.text) {
      const anchor = points[0]!;
      const rotated = rotateBox(textLocalBox(symbol, object.text), object.angle);
      x0 = Math.min(x0, anchor.x + rotated.minX) - pad;
      y0 = Math.min(y0, anchor.y + rotated.minY) - pad;
      x1 = Math.max(x1, anchor.x + rotated.maxX) + pad;
      y1 = Math.max(y1, anchor.y + rotated.maxY) + pad;
    } else {
      const extra = pad > 0 ? pad : x0 === x1 || y0 === y1 ? 10 : 0;
      x0 -= extra; y0 -= extra; x1 += extra; y1 += extra;
    }
  } else {
    const margin = lineOrAreaMargin(symbol, x0 === x1 || y0 === y1);
    x0 -= margin; y0 -= margin; x1 += margin; y1 += margin;
  }
  view.setInt32(0, clampOcd(x0) << 8, true);
  view.setInt32(4, clampOcd(y0) << 8, true);
  view.setInt32(8, clampOcd(x1) << 8, true);
  view.setInt32(12, clampOcd(y1) << 8, true);
  return out;
}

export function readRawObjectPoints(record: Uint8Array, offset: number, count: number): RawPt[] {
  const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
  const out: RawPt[] = [];
  for (let i = 0; i < count; i++) {
    const x = view.getInt32(offset + 8 * i, true);
    const y = view.getInt32(offset + 8 * i + 4, true);
    out.push({ x: x >> 8, y: y >> 8, xf: x & 0xff, yf: y & 0xff });
  }
  return out;
}

/** Bevarar okända höga flaggbitar (`0xf0`) på punkter vars position inte ändrats. */
export function keepOriginalFlags(points: readonly RawPt[], original: readonly RawPt[]): RawPt[] {
  const exact = new Map<string, number[]>();
  for (let i = 0; i < original.length; i++) {
    const old = original[i]!;
    const key = `${old.x},${old.y},${old.xf & MODELED},${old.yf & MODELED}`;
    const list = exact.get(key);
    if (list) list.push(i); else exact.set(key, [i]);
  }
  const used = new Uint8Array(original.length);
  const matched = points.map(p => {
    const idx = exact.get(`${p.x},${p.y},${p.xf & MODELED},${p.yf & MODELED}`)?.shift();
    if (idx === undefined) return undefined;
    used[idx] = 1;
    return original[idx]!;
  });
  const byCoord = new Map<string, number[]>();
  for (let i = 0; i < original.length; i++) {
    if (used[i]) continue;
    const old = original[i]!;
    const key = `${old.x},${old.y}`;
    const list = byCoord.get(key);
    if (list) list.push(i); else byCoord.set(key, [i]);
  }
  return points.map((p, i) => {
    const exactMatch = matched[i];
    if (exactMatch) return exactMatch;
    const idx = byCoord.get(`${p.x},${p.y}`)?.shift();
    if (idx === undefined) return p;
    const old = original[idx]!;
    return { x: p.x, y: p.y, xf: (old.xf & ~MODELED) | (p.xf & MODELED), yf: (old.yf & ~MODELED) | (p.yf & MODELED) };
  });
}
