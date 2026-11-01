import type { DescriptionLayout, OverprintPrimitive } from "@o-tid/course-setting";
import { CONDENSED_FONT, DESCRIPTION_FONT, descriptionNodes, type SvgNode, type SymbolLookup } from "./course-setting-description-draw";

/**
 * Steg 64: det som specialobjekten behöver på skärmen utöver ringar och linjer: färgrollerna som RGB, kontrollbeskrivningen
 * på kartan (samma noder som utskriften av beskrivningar) och bilderna. Färgerna här är bara för skärmen och utkastet ur
 * webbläsaren; trycket med dekorfärger kommer i steg 65.
 */
export const COURSE_PURPLE = "rgb(204, 0, 255)";

/** CMYK (0–1) som ungefärlig RGB på skärmen. */
export function cmykToRgb(cmyk: readonly [number, number, number, number]): string {
  const [c, m, y, k] = cmyk.map(value => Math.max(0, Math.min(1, value))) as [number, number, number, number];
  const channel = (value: number) => Math.round(255 * (1 - value) * (1 - k));
  return `rgb(${channel(c)}, ${channel(m)}, ${channel(y)})`;
}

/** Färgrollen som skärmfärg (undre och övre lila är samma lila på skärmen). */
export function screenColor(primitive: OverprintPrimitive): string {
  switch (primitive.color) {
    case "WHITE": return "#fff";
    case "BLACK": return "#000";
    case "CUSTOM": return primitive.cmyk ? cmykToRgb(primitive.cmyk) : COURSE_PURPLE;
    default: return COURSE_PURPLE;
  }
}

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const nodeCache = new WeakMap<DescriptionLayout, { symbols: SymbolLookup; nodes: SvgNode[] }>();

/** Beskrivningens noder (sparade per utläggning, så att kartan inte räknar om dem vid varje ritning). */
export function cachedDescriptionNodes(layout: DescriptionLayout, symbols: SymbolLookup): SvgNode[] {
  const cached = nodeCache.get(layout);
  if (cached && cached.symbols === symbols) return cached.nodes;
  const nodes = descriptionNodes(layout, symbols);
  nodeCache.set(layout, { symbols, nodes });
  return nodes;
}

/** Noderna (mm, y nedåt) i den transform som `ctx` har. */
export function drawSvgNodes(ctx: Context, nodes: readonly SvgNode[], color: string): void {
  for (const node of nodes) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    switch (node.tag) {
      case "path": {
        const path = new Path2D(node.d);
        if (node.fill) ctx.fill(path, "evenodd");
        else {
          ctx.lineWidth = node.strokeWidth ?? 0;
          ctx.lineCap = node.cap ?? "round";
          ctx.lineJoin = node.join ?? "round";
          ctx.miterLimit = 5;
          ctx.stroke(path);
        }
        break;
      }
      case "line":
        ctx.lineWidth = node.strokeWidth;
        ctx.lineCap = "butt";
        ctx.beginPath(); ctx.moveTo(node.x1, node.y1); ctx.lineTo(node.x2, node.y2); ctx.stroke();
        break;
      case "circle":
        ctx.beginPath(); ctx.arc(node.cx, node.cy, node.r, 0, 2 * Math.PI);
        if (node.fill) ctx.fill(); else { ctx.lineWidth = node.strokeWidth ?? 0; ctx.stroke(); }
        break;
      case "text": {
        ctx.font = `${node.bold ? "bold " : ""}${node.size}px ${node.condensed ? CONDENSED_FONT : DESCRIPTION_FONT}`;
        ctx.textAlign = node.anchor === "start" ? "left" : node.anchor === "end" ? "right" : "center";
        ctx.textBaseline = "alphabetic";
        if (node.textLength !== undefined) {
          const width = ctx.measureText(node.text).width;
          if (width > node.textLength) {
            ctx.save();
            ctx.translate(node.x, node.y);
            ctx.scale(node.textLength / width, 1);
            ctx.fillText(node.text, 0, 0);
            ctx.restore();
            break;
          }
        }
        ctx.fillText(node.text, node.x, node.y);
        break;
      }
      case "symbol": drawSvgNodes(ctx, node.children, color); break;
    }
  }
}

/** Bilderna i specialobjekten, avkodade en gång per data. */
const images = new Map<string, Promise<ImageBitmap | undefined>>();
const decoded = new Map<string, ImageBitmap>();

/** Bilden om den är avkodad; annars börjar avkodningen och `onReady` anropas när den är klar. */
export function specialImage(primitive: Extract<OverprintPrimitive, { kind: "image" }>, onReady?: () => void): ImageBitmap | undefined {
  const key = `${primitive.mediaType}:${primitive.data.length}:${primitive.data.slice(0, 64)}:${primitive.data.slice(-64)}`;
  const ready = decoded.get(key);
  if (ready) return ready;
  if (!images.has(key) && typeof createImageBitmap === "function") {
    const bytes = Uint8Array.from(atob(primitive.data), character => character.charCodeAt(0));
    images.set(key, createImageBitmap(new Blob([bytes], { type: primitive.mediaType })).then(bitmap => {
      decoded.set(key, bitmap);
      onReady?.();
      return bitmap;
    }, error => { console.error("Bilden i specialobjektet kunde inte läsas", error); return undefined; }));
  }
  return undefined;
}

type ToScreen = (point: { x: number; y: number }) => { x: number; y: number };

/**
 * Ytan eller linjen som ritas (streckad, med punkterna) och handtagen på valt specialobjekt. Bara på skärmen, aldrig i
 * banpåtrycket.
 */
export function drawSpecialEditing(ctx: Context, toScreen: ToScreen,
  editing: { drawing?: readonly { x: number; y: number }[] | undefined; handles?: readonly { x: number; y: number }[] | undefined }): void {
  ctx.save();
  const drawing = editing.drawing ?? [];
  if (drawing.length > 0) {
    ctx.strokeStyle = "rgb(0, 110, 220)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    drawing.forEach((point, index) => { const at = toScreen(point); if (index === 0) ctx.moveTo(at.x, at.y); else ctx.lineTo(at.x, at.y); });
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const [list, fill] of [[drawing, "rgb(0, 110, 220)"], [editing.handles ?? [], "#fff"]] as const) {
    for (const point of list) {
      const at = toScreen(point);
      ctx.fillStyle = fill;
      ctx.strokeStyle = "rgb(0, 110, 220)";
      ctx.lineWidth = 2;
      ctx.fillRect(at.x - 5, at.y - 5, 10, 10);
      ctx.strokeRect(at.x - 5, at.y - 5, 10, 10);
    }
  }
  ctx.restore();
}

/** Tryckytans ram på kartan (steg 64): papperets yta streckad, utanför tonat. */
export function drawPrintFrame(ctx: Context, toScreen: ToScreen, frames: readonly { minX: number; minY: number; maxX: number; maxY: number }[],
  size: { width: number; height: number }): void {
  if (frames.length === 0) return;
  ctx.save();
  ctx.fillStyle = "rgba(40, 40, 40, 0.25)";
  ctx.beginPath();
  ctx.rect(0, 0, size.width, size.height);
  const corners = frames.map(frame => [toScreen({ x: frame.minX, y: frame.maxY }), toScreen({ x: frame.maxX, y: frame.minY })] as const);
  for (const [a, b] of corners) ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.fill("evenodd");
  ctx.strokeStyle = "rgb(0, 110, 220)";
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 5]);
  for (const [a, b] of corners) ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.restore();
}
