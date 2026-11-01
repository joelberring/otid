import type { OverprintPrimitive } from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { noteMarkGeometry } from "./course-setting-note-marks";
import { toScreen, type Viewport } from "./course-setting-viewport";

/** Steg 66: notisernas markeringar och ett förslag ovanpå banan, i samma lager som banpåtrycket. */
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function line(ctx: Context, view: Viewport, points: readonly Point[], closed: boolean) {
  ctx.beginPath();
  points.forEach((point, index) => {
    const screen = toScreen(view, point);
    if (index === 0) ctx.moveTo(screen.x, screen.y); else ctx.lineTo(screen.x, screen.y);
  });
  if (closed) ctx.closePath();
}


/**
 * Notiserna som små flaggor upp till höger om punkten (öppna gula med "!", klara gråa med bock), med antalet när flera
 * sitter på samma ställe. Formen och tecknet bär beskedet, inte bara färgen.
 */
export function drawNoteMarks(ctx: Context, view: Viewport, marks: readonly { at: Point; status: "OPEN" | "DONE"; count: number; selected?: boolean }[]) {
  ctx.save();
  const { sizePx: size, offsetMm } = noteMarkGeometry(view.pxPerMm);
  for (const mark of marks) {
    const foot = toScreen(view, mark.at);
    const center = toScreen(view, { x: mark.at.x + offsetMm.x, y: mark.at.y + offsetMm.y });
    ctx.strokeStyle = "rgba(30, 30, 30, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(foot.x, foot.y); ctx.lineTo(center.x - size / 2, center.y + size / 2); ctx.stroke();
    ctx.fillStyle = mark.status === "OPEN" ? "rgb(255, 214, 10)" : "rgb(205, 205, 205)";
    ctx.beginPath(); ctx.rect(center.x - size / 2, center.y - size / 2, size, size); ctx.fill(); ctx.stroke();
    if (mark.selected) {
      ctx.lineWidth = 3; ctx.strokeStyle = "rgb(0, 110, 220)";
      ctx.strokeRect(center.x - size / 2 - 3, center.y - size / 2 - 3, size + 6, size + 6);
    }
    ctx.fillStyle = "rgb(20, 20, 20)";
    ctx.font = `bold ${Math.round(size * 0.6)}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(mark.count > 1 ? String(mark.count) : mark.status === "OPEN" ? "!" : "✓", center.x, center.y + 1);
  }
  ctx.restore();
}

export interface SuggestionDrawing {
  readonly primitives: readonly OverprintPrimitive[];
  readonly moved: readonly { readonly from: Point; readonly to: Point }[];
  readonly added: readonly { readonly at: Point }[];
  readonly removed: readonly { readonly at: Point }[];
  readonly radiusMm: number;
}

/** Förslagets banpåtryck streckat och tonat (grönt), pilar från gammalt till nytt läge, streckade ringar för nya, kryss för borttagna. */
export function drawSuggestion(ctx: Context, view: Viewport, suggestion: SuggestionDrawing) {
  const color = "rgb(0, 120, 90)";
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.setLineDash([6, 4]);
  for (const primitive of suggestion.primitives) {
    if (primitive.color === "WHITE") continue;
    if (primitive.kind === "circle") {
      const center = toScreen(view, primitive.center);
      ctx.lineWidth = Math.max(1.5, primitive.lineWidth * view.pxPerMm);
      ctx.beginPath(); ctx.arc(center.x, center.y, primitive.diameter / 2 * view.pxPerMm, 0, 2 * Math.PI); ctx.stroke();
    } else if (primitive.kind === "polyline") {
      ctx.lineWidth = Math.max(1.5, primitive.width * view.pxPerMm);
      line(ctx, view, primitive.points, primitive.closed === true); ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  const radius = Math.max(8, suggestion.radiusMm * view.pxPerMm);
  ctx.lineWidth = 3;
  for (const move of suggestion.moved) {
    const from = toScreen(view, move.from), to = toScreen(view, move.to);
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - 12 * Math.cos(angle - 0.4), to.y - 12 * Math.sin(angle - 0.4));
    ctx.lineTo(to.x - 12 * Math.cos(angle + 0.4), to.y - 12 * Math.sin(angle + 0.4));
    ctx.closePath(); ctx.fill();
  }
  ctx.setLineDash([4, 3]);
  for (const added of suggestion.added) {
    const at = toScreen(view, added.at);
    ctx.beginPath(); ctx.arc(at.x, at.y, radius + 5, 0, 2 * Math.PI); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgb(190, 0, 30)";
  for (const removed of suggestion.removed) {
    const at = toScreen(view, removed.at);
    ctx.beginPath();
    ctx.moveTo(at.x - radius, at.y - radius); ctx.lineTo(at.x + radius, at.y + radius);
    ctx.moveTo(at.x + radius, at.y - radius); ctx.lineTo(at.x - radius, at.y + radius);
    ctx.stroke();
  }
  ctx.restore();
}

/** Steg 66: vald rad i vägvalslistan – linjen markerad brett och gult under den vanliga ritningen. */
export function drawHighlightedRoute(ctx: Context, view: Viewport, points: readonly Point[]) {
  if (points.length < 2) return;
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255, 200, 0, 0.75)";
  ctx.lineWidth = 12;
  line(ctx, view, points, false); ctx.stroke();
  ctx.restore();
}
