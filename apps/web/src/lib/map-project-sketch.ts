import type { Point } from "@o-tid/map-file";
import type { MapProjectSketchView } from "@o-tid/contracts";
import { toScreen, type Viewport } from "./course-setting-viewport";

/**
 * ADR-0219 (ägaren 2026-11-09, lagren fas 2): skisslagrens skisser. En linje på fri hand förenklas (Douglas–Peucker) innan den
 * sparas, och skisserna ritas ovanpå kartan i lagrets färg, nedtonade när lagret är tonat.
 */
export function simplifyStroke(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const a = points[first]!, b = points[last]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    let worst = -1, distance = 0;
    for (let i = first + 1; i < last; i++) {
      const p = points[i]!;
      const d = length === 0 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / length;
      if (d > distance) { distance = d; worst = i; }
    }
    if (worst >= 0 && distance > tolerance) { keep[worst] = 1; stack.push([first, worst], [worst, last]); }
  }
  return points.filter((_, index) => keep[index] === 1);
}

export interface DrawnSketchLayer { readonly color: string; readonly dimmed: boolean; readonly sketches: readonly MapProjectSketchView[] }

/** Skisserna: linjer 2,5 px, punkter som ringar och texter med vit kant, i lagrets färg. Den pågående linjen streckad. */
export function drawSketches(ctx: CanvasRenderingContext2D, view: Viewport, layers: readonly DrawnSketchLayer[], stroke?: { color: string; points: readonly Point[] }) {
  ctx.save();
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  for (const layer of layers) {
    ctx.globalAlpha = layer.dimmed ? 0.35 : 1;
    ctx.strokeStyle = layer.color; ctx.fillStyle = layer.color;
    for (const sketch of layer.sketches) {
      const points = sketch.points.map(([x, y]) => toScreen(view, { x, y }));
      if (sketch.kind === "LINE") {
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
        ctx.stroke();
        continue;
      }
      const at = points[0]!;
      if (sketch.kind === "POINT") { ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(at.x, at.y, 6, 0, Math.PI * 2); ctx.stroke(); continue; }
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.lineWidth = 3; ctx.strokeStyle = "#fff";
      ctx.strokeText(sketch.text ?? "", at.x + 4, at.y - 4);
      ctx.fillText(sketch.text ?? "", at.x + 4, at.y - 4);
      ctx.strokeStyle = layer.color;
    }
  }
  ctx.globalAlpha = 1;
  if (stroke && stroke.points.length > 1) {
    ctx.strokeStyle = stroke.color; ctx.lineWidth = 2.5; ctx.setLineDash([6, 4]);
    ctx.beginPath();
    stroke.points.map(point => toScreen(view, point)).forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
    ctx.stroke();
  }
  ctx.restore();
}
