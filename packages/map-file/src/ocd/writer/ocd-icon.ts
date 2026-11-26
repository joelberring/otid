/**
 * 22×22 `IconBits`-miniatyrer, `TBaseSym.Colors[0..13]` och `TBaseSym.Extent` för OCAD-symboler (v9–2018+).
 *
 * OCAD:s 8-bitars ikonpalett är en ren 5×5×5 RGB-kub (index 0..124): `Math.round(r * 4) * 25 + Math.round(g * 4) * 5 + Math.round(b * 4)`,
 * där 0 = svart, 124 = vit bakgrund. Bekräftat empiriskt mot riktiga OCAD 2018-symboler.
 */
import { rgbFromCmyk } from "../../color";
import type { MapColor, MapSymbol, PointElement, StrokeStyle } from "../../model";
import { SYMBOL, UNIT, type OcdVariant } from "../layout";
import { encodeWindows1252, SYMBOL_HEAD } from "./ocd-document";

export const ICON_SIZE = 22;
export const ICON_BG = 124; // (4, 4, 4) = vit i OCAD:s 5×5×5 RGB-kub

/** Mappar en kartfärg till OCAD:s 5×5×5 ikonpalett (0..124). */
export function ocdIconColorIndex(color: MapColor | undefined): number {
  if (!color) return 0;
  const rgb = color.rgb ?? rgbFromCmyk(color.cmyk);
  const r = Math.max(0, Math.min(4, Math.round(rgb.r * 4)));
  const g = Math.max(0, Math.min(4, Math.round(rgb.g * 4)));
  const b = Math.max(0, Math.min(4, Math.round(rgb.b * 4)));
  return r * 25 + g * 5 + b;
}

/** Skriver `nColors` (offset 26) och `Colors[0..13]` (offset 28..55) i `TBaseSym`. */
export function writeSymbolHeaderColors(symBytes: Uint8Array, colorIds: readonly number[]): void {
  const unique: number[] = [];
  for (const id of colorIds) {
    if (Number.isInteger(id) && id >= 0 && !unique.includes(id)) {
      unique.push(id);
      if (unique.length >= SYMBOL_HEAD.maxColors) break;
    }
  }
  const view = new DataView(symBytes.buffer, symBytes.byteOffset, symBytes.byteLength);
  view.setInt16(SYMBOL_HEAD.nColors, unique.length, true);
  for (let i = 0; i < SYMBOL_HEAD.maxColors; i++) {
    view.setInt16(SYMBOL_HEAD.colors + i * 2, unique[i] ?? 0, true);
  }
}

/** Skriver beskrivningen i `TBaseSym` (UTF-16LE vid offset 56 i v11+, 31-teckens Pascalsträng vid offset 56 i v9–10). */
export function writeSymbolDescription(symBytes: Uint8Array, description: string, variant: OcdVariant): void {
  if (variant.description.kind === "UTF16") {
    symBytes.fill(0, SYMBOL.description, SYMBOL.description + SYMBOL.descriptionBytes);
    const trimmed = description.slice(0, SYMBOL.descriptionBytes / 2 - 1);
    for (let i = 0; i < trimmed.length; i++) {
      const code = trimmed.charCodeAt(i);
      symBytes[SYMBOL.description + i * 2] = code & 0xff;
      symBytes[SYMBOL.description + i * 2 + 1] = code >> 8;
    }
  } else {
    symBytes.fill(0, SYMBOL.description, SYMBOL.description + 32);
    const encoded = encodeWindows1252(description).subarray(0, 31);
    symBytes[SYMBOL.description] = encoded.length;
    symBytes.set(encoded, SYMBOL.description + 1);
  }
}

/** Startoffset för 22×22 8-bitars `IconBits` i `TBaseSym`: 184 i v11+ (796 B huvud), 88 i v9–10 (572 B huvud). */
export function iconBitsOffset(variant: OcdVariant): number {
  return variant.symbolBody >= 796 ? SYMBOL_HEAD.iconBitsV11 : 88;
}

/** Räknar ut `TBaseSym.Extent` i OCAD-enheter (0,01 mm) för en `MapSymbol`. */
export function computeSymbolExtentUnits(symbol: MapSymbol): number {
  const ceilU = (mm: number) => Math.max(0, Math.ceil(mm * 100 - 1e-9));
  const elementExtent = (elements: readonly PointElement[]): number => {
    let maxR = 0;
    for (const el of elements) {
      if (el.kind === "circle" || el.kind === "dot") {
        const half = (el.diameter + (el.kind === "circle" ? el.lineWidth : 0)) / 2;
        maxR = Math.max(maxR, Math.abs(el.center.x) + half, Math.abs(el.center.y) + half);
      } else {
        const pad = el.kind === "line" ? el.width / 2 : 0;
        const paths = el.kind === "line" ? [el.path] : el.rings;
        for (const p of paths) {
          for (const cmd of p) {
            maxR = Math.max(maxR, Math.abs(cmd.x) + pad, Math.abs(cmd.y) + pad);
            if (cmd.type === "C") {
              maxR = Math.max(maxR, Math.abs(cmd.x1) + pad, Math.abs(cmd.y1) + pad, Math.abs(cmd.x2) + pad, Math.abs(cmd.y2) + pad);
            }
          }
        }
      }
    }
    return ceilU(maxR);
  };
  const strokeExtent = (strokes: readonly StrokeStyle[] | undefined): number => {
    let maxHalf = 0;
    for (const s of strokes ?? []) {
      const reach = Math.abs(s.offset ?? 0) + s.width / 2;
      if (reach > maxHalf) maxHalf = reach;
    }
    return ceilU(maxHalf);
  };
  switch (symbol.kind) {
    case "POINT": return Math.max(10, elementExtent(symbol.elements));
    case "LINE": return Math.max(
      strokeExtent(symbol.strokes),
      symbol.repeated ? elementExtent(symbol.repeated.elements) : 0,
      symbol.between ? elementExtent(symbol.between.elements) : 0,
      symbol.corner ? elementExtent(symbol.corner.elements) : 0,
      symbol.start ? elementExtent(symbol.start.elements) : 0,
      symbol.end ? elementExtent(symbol.end.elements) : 0
    );
    case "AREA": return strokeExtent(symbol.border);
    case "TEXT": return symbol.framing && symbol.framing.width > 0 ? ceilU(symbol.framing.width / 2) : 0;
    case "COMBINED": return 0;
  }
}

class IconCanvas {
  readonly pixels = new Uint8Array(ICON_SIZE * ICON_SIZE).fill(ICON_BG);

  set(x: number, y: number, idx: number): void {
    const ix = Math.round(x), iy = Math.round(y);
    if (ix >= 0 && ix < ICON_SIZE && iy >= 0 && iy < ICON_SIZE) {
      this.pixels[iy * ICON_SIZE + ix] = idx;
    }
  }

  fillRect(x0: number, y0: number, x1: number, y1: number, idx: number): void {
    const ax = Math.max(0, Math.round(Math.min(x0, x1)));
    const bx = Math.min(ICON_SIZE - 1, Math.round(Math.max(x0, x1)));
    const ay = Math.max(0, Math.round(Math.min(y0, y1)));
    const by = Math.min(ICON_SIZE - 1, Math.round(Math.max(y0, y1)));
    for (let y = ay; y <= by; y++) {
      for (let x = ax; x <= bx; x++) this.pixels[y * ICON_SIZE + x] = idx;
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, idx: number, thickness = 1): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    const r = Math.max(0, (thickness - 1) / 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = x0 + (x1 - x0) * t;
      const cy = y0 + (y1 - y0) * t;
      if (r <= 0.35) this.set(cx, cy, idx);
      else this.disc(cx, cy, r, idx);
    }
  }

  disc(cx: number, cy: number, radius: number, idx: number): void {
    const r = Math.max(0.5, radius);
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(ICON_SIZE - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(ICON_SIZE - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= (r + 0.3) ** 2) this.pixels[y * ICON_SIZE + x] = idx;
      }
    }
  }

  ring(cx: number, cy: number, radius: number, thickness: number, idx: number): void {
    const outer = radius + Math.max(0.5, thickness / 2);
    const inner = Math.max(0, radius - Math.max(0.5, thickness / 2));
    const x0 = Math.max(0, Math.floor(cx - outer)), x1 = Math.min(ICON_SIZE - 1, Math.ceil(cx + outer));
    const y0 = Math.max(0, Math.floor(cy - outer)), y1 = Math.min(ICON_SIZE - 1, Math.ceil(cy + outer));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= outer + 0.25 && d >= inner - 0.25) this.pixels[y * ICON_SIZE + x] = idx;
      }
    }
  }

  polygon(pts: readonly (readonly [number, number])[], idx: number): void {
    if (pts.length < 3) return;
    for (let y = 0; y < ICON_SIZE; y++) {
      const py = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i]!;
        const [x2, y2] = pts[(i + 1) % pts.length]!;
        if ((y1 <= py && y2 > py) || (y2 <= py && y1 > py)) {
          xs.push(x1 + ((py - y1) / (y2 - y1)) * (x2 - x1));
        }
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const a = Math.max(0, Math.floor(xs[i]!));
        const b = Math.min(ICON_SIZE - 1, Math.ceil(xs[i + 1]!));
        for (let x = a; x <= b; x++) this.pixels[y * ICON_SIZE + x] = idx;
      }
    }
  }
}

/** Rasteriserar en skarp 22×22-miniatyr (`IconBits`) för en `MapSymbol` i OCAD:s symbolpalett. */
export function renderOcdSymbolIcon(symbol: MapSymbol, colors: readonly MapColor[]): Uint8Array {
  const byId = new Map(colors.map(c => [c.id, c]));
  const colorIdx = (id: number) => ocdIconColorIndex(byId.get(id));
  const canvas = new IconCanvas();

  if (symbol.kind === "POINT") {
    const extMm = Math.max(0.4, computeSymbolExtentUnits(symbol) * UNIT);
    const scale = 8.5 / extMm;
    const tx = (x: number) => 10.5 + x * scale;
    const ty = (y: number) => 10.5 - y * scale;
    for (const el of symbol.elements) {
      const c = colorIdx(el.color);
      if (el.kind === "dot") {
        canvas.disc(tx(el.center.x), ty(el.center.y), Math.max(1.2, (el.diameter / 2) * scale), c);
      } else if (el.kind === "circle") {
        canvas.ring(tx(el.center.x), ty(el.center.y), Math.max(2, (el.diameter / 2) * scale), Math.max(1, el.lineWidth * scale), c);
      } else if (el.kind === "line") {
        const pts = el.path.map(cmd => [tx(cmd.x), ty(cmd.y)] as const);
        const w = Math.max(1, el.width * scale);
        for (let i = 1; i < pts.length; i++) canvas.line(pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1], c, w);
      } else if (el.kind === "area") {
        const outer = el.rings[0];
        if (outer) canvas.polygon(outer.map(cmd => [tx(cmd.x), ty(cmd.y)] as const), c);
      }
    }
    return canvas.pixels;
  }

  if (symbol.kind === "LINE") {
    if (symbol.rectangle) {
      const c = colorIdx(symbol.strokes[0]?.color ?? 0);
      canvas.line(3, 4, 18, 4, c, 1.5);
      canvas.line(18, 4, 18, 17, c, 1.5);
      canvas.line(18, 17, 3, 17, c, 1.5);
      canvas.line(3, 17, 3, 4, c, 1.5);
      return canvas.pixels;
    }
    const maxReach = Math.max(0.3, ...symbol.strokes.map(s => Math.abs(s.offset ?? 0) + s.width / 2));
    const scale = Math.min(10, 6 / maxReach);
    for (const stroke of symbol.strokes) {
      const c = colorIdx(stroke.color);
      const y = 10.5 - (stroke.offset ?? 0) * scale;
      const halfH = Math.max(0.5, (stroke.width * scale) / 2);
      if (stroke.dash && stroke.dash.length >= 2) {
        const dashPx = Math.max(3, Math.min(7, Math.round(stroke.dash[0]! * 3)));
        const gapPx = Math.max(2, Math.min(5, Math.round(stroke.dash[1]! * 3)));
        for (let x = 0; x < ICON_SIZE; x += dashPx + gapPx) {
          canvas.fillRect(x, y - halfH, Math.min(ICON_SIZE - 1, x + dashPx - 1), y + halfH, c);
        }
      } else {
        canvas.fillRect(0, y - halfH, ICON_SIZE - 1, y + halfH, c);
      }
    }
    if (symbol.repeated && symbol.repeated.elements.length > 0) {
      const c = colorIdx(symbol.repeated.elements[0]!.color);
      for (const x of [5, 11, 17]) canvas.fillRect(x, 6, x, 14, c);
    }
    return canvas.pixels;
  }

  if (symbol.kind === "AREA") {
    if (symbol.fill !== undefined) canvas.fillRect(2, 2, 19, 19, colorIdx(symbol.fill));
    for (const hatch of symbol.hatches) {
      const c = colorIdx(hatch.color);
      const rad = (hatch.angle * Math.PI) / 180;
      const dx = Math.cos(rad), dy = -Math.sin(rad);
      const nx = -dy, ny = dx;
      for (let d = -24; d <= 24; d += 4) {
        const cx = 10.5 + nx * d, cy = 10.5 + ny * d;
        canvas.line(cx - dx * 14, cy - dy * 14, cx + dx * 14, cy + dy * 14, c, 1);
      }
    }
    if (symbol.pattern && symbol.pattern.elements.length > 0) {
      const c = colorIdx(symbol.pattern.elements[0]!.color);
      for (const y of [5, 11, 17]) {
        for (const x of [5, 11, 17]) canvas.disc(x, y, 1, c);
      }
    }
    // Rensa marginaler utanför ytrutan (2..19) så hatch inte rinner ut.
    for (let i = 0; i < ICON_SIZE; i++) {
      for (const b of [0, 1, 20, 21]) {
        canvas.pixels[b * ICON_SIZE + i] = ICON_BG;
        canvas.pixels[i * ICON_SIZE + b] = ICON_BG;
      }
    }
    if (symbol.border && symbol.border.length > 0) {
      const c = colorIdx(symbol.border[0]!.color);
      canvas.line(2, 2, 19, 2, c, 1);
      canvas.line(19, 2, 19, 19, c, 1);
      canvas.line(19, 19, 2, 19, c, 1);
      canvas.line(2, 19, 2, 2, c, 1);
    }
    return canvas.pixels;
  }

  if (symbol.kind === "TEXT") {
    const c = colorIdx(symbol.color);
    const w = symbol.bold ? 2.2 : 1.3;
    if (symbol.framing) {
      const fc = colorIdx(symbol.framing.color);
      canvas.line(5, 18, 11, 4, fc, w + 2);
      canvas.line(17, 18, 11, 4, fc, w + 2);
      canvas.line(7, 13, 15, 13, fc, w + 2);
    }
    canvas.line(5, 18, 11, 4, c, w);
    canvas.line(17, 18, 11, 4, c, w);
    canvas.line(7, 13, 15, 13, c, w);
    return canvas.pixels;
  }

  return canvas.pixels;
}
