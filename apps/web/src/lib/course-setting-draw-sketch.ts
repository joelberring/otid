import type { CourseSettingSketchShape } from "@o-tid/contracts";
import type { Point } from "@o-tid/map-file";
import { SKETCH_COLORS } from "./course-setting-sketch";

/**
 * ADR-0181 beslut 8: notisernas ritningar på skärmen (aldrig i banpåtryck, PDF, .ppen eller överföring, beslut 1).
 * Slaget ger färgen, "är fel" ritas streckad och "ska vara här" heldragen med en pil i slutet; ytor fylls svagt. En vit
 * kant under linjen gör den läsbar på kartan, och formen (streckad, pil) bär beskedet utan färgen.
 */
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface SketchDrawOptions {
  /** Vald notis: bredare linje och en blå ram runt. */
  readonly selected?: boolean | undefined;
  /** Klar notis: tonad. */
  readonly done?: boolean | undefined;
  /** Linjens bredd i pixlar (förval 3). */
  readonly widthPx?: number | undefined;
}

function arrow(ctx: Context, from: { x: number; y: number }, to: { x: number; y: number }, size: number) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle - 0.45), to.y - size * Math.sin(angle - 0.45));
  ctx.lineTo(to.x - size * Math.cos(angle + 0.45), to.y - size * Math.sin(angle + 0.45));
  ctx.closePath();
  ctx.fill();
}

/** Ritar delarna med `at` (kartans mm → skärmens eller bildens pixlar). */
export function drawSketchShapes(ctx: Context, at: (point: Point) => { x: number; y: number }, shapes: readonly CourseSettingSketchShape[],
  options: SketchDrawOptions = {}) {
  const width = (options.widthPx ?? 3) * (options.selected ? 1.4 : 1);
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.globalAlpha = options.done ? 0.5 : 1;
  for (const shape of shapes) {
    const points = shape.points.map(at);
    if (points.length === 0) continue;
    const path = () => {
      ctx.beginPath();
      points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
      if (shape.kind === "AREA") ctx.closePath();
    };
    const color = options.done ? "rgb(110, 110, 110)" : SKETCH_COLORS[shape.style];
    if (shape.kind === "AREA") {
      path();
      ctx.fillStyle = color; ctx.globalAlpha = (options.done ? 0.5 : 1) * 0.18; ctx.fill();
      ctx.globalAlpha = options.done ? 0.5 : 1;
    }
    if (options.selected) {
      ctx.setLineDash([]); ctx.strokeStyle = "rgb(0, 110, 220)"; ctx.lineWidth = width + 7; ctx.globalAlpha *= 0.35; path(); ctx.stroke();
      ctx.globalAlpha = options.done ? 0.5 : 1;
    }
    ctx.setLineDash([]); ctx.strokeStyle = "rgba(255, 255, 255, 0.9)"; ctx.lineWidth = width + 3; path(); ctx.stroke();
    ctx.setLineDash(shape.intent === "WRONG" ? [width * 3, width * 2] : []);
    ctx.strokeStyle = color; ctx.lineWidth = width; path(); ctx.stroke();
    ctx.setLineDash([]);
    if (shape.intent === "RIGHT" && shape.kind === "LINE" && points.length >= 2) {
      ctx.fillStyle = color;
      arrow(ctx, points[points.length - 2]!, points[points.length - 1]!, Math.max(9, width * 4));
    }
  }
  ctx.restore();
}

/** En punkt som kartfel (exportens utsnitt): en ring med kryss i slagets färg. */
export function drawPointMark(ctx: Context, at: { x: number; y: number }, radiusPx: number, color = SKETCH_COLORS.MAP_ERROR) {
  ctx.save();
  ctx.lineWidth = 3;
  for (const [stroke, width] of [["rgba(255, 255, 255, 0.9)", 6], [color, 3]] as const) {
    ctx.strokeStyle = stroke; ctx.lineWidth = width;
    ctx.beginPath(); ctx.arc(at.x, at.y, radiusPx, 0, 2 * Math.PI); ctx.stroke();
  }
  ctx.restore();
}
