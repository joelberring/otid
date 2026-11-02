import type { Point } from "@o-tid/map-file";
import { toScreen, type Viewport } from "./course-setting-viewport";
import type { BranchLabel } from "./course-setting-forks";
import { handlePosition, type Rotatable } from "./course-setting-rotate";

/**
 * ADR-0180 beslut 13: det som bara finns på skärmen när man arbetar (aldrig i banpåtrycket): markeringen före ett klick
 * som lägger in en befintlig kontroll ("Lägg in 45"), vridhandtaget, grenarnas bokstäver och de oanvända kontrollerna
 * (grå streckade ringar med ett litet kryss).
 */
type Context = CanvasRenderingContext2D;

const BLUE = "rgb(0, 110, 220)";

function pill(ctx: Context, at: { x: number; y: number }, text: string, options: { stroke: string; bold?: boolean; fill?: string; color?: string }) {
  ctx.font = `${options.bold ? "bold " : ""}13px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = Math.max(20, ctx.measureText(text).width + 12), height = 20;
  ctx.fillStyle = options.fill ?? "rgba(255, 255, 255, 0.95)";
  ctx.strokeStyle = options.stroke;
  ctx.lineWidth = options.bold ? 2.5 : 1.5;
  ctx.beginPath();
  ctx.roundRect(at.x - width / 2, at.y - height / 2, width, height, 10);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = options.color ?? "rgb(20, 20, 20)";
  ctx.fillText(text, at.x, at.y + 0.5);
}

/** Ringen som tänds och texten bredvid (t.ex. "Lägg in 45") innan klicket. */
export function drawSnapHint(ctx: Context, view: Viewport, hint: { at: Point; radiusMm: number; text: string }) {
  const at = toScreen(view, hint.at);
  const radius = Math.max(10, hint.radiusMm * view.pxPerMm + 4);
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(at.x, at.y, radius, 0, 2 * Math.PI); ctx.stroke();
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(at.x, at.y, radius, 0, 2 * Math.PI); ctx.stroke();
  pill(ctx, { x: at.x, y: at.y - radius - 16 }, hint.text, { stroke: BLUE, bold: true, fill: BLUE, color: "white" });
  ctx.restore();
}

/** Vridhandtaget: linje från mitten och en rund knopp med pil. */
export function drawRotateHandle(ctx: Context, view: Viewport, target: Rotatable, active: boolean) {
  const center = toScreen(view, target.at);
  const handle = toScreen(view, handlePosition(target, view.pxPerMm));
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(center.x, center.y); ctx.lineTo(handle.x, handle.y); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = active ? BLUE : "white";
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(handle.x, handle.y, 9, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  ctx.fillStyle = active ? "white" : BLUE;
  ctx.font = "bold 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("↻", handle.x, handle.y + 0.5);
  if (active) pill(ctx, { x: handle.x, y: handle.y - 22 }, `${Math.round(target.orientation)}°`, { stroke: BLUE });
  ctx.restore();
}

/** Grenarnas bokstäver på kartan; grenen man arbetar i är kraftig. */
export function drawBranchLabels(ctx: Context, view: Viewport, labels: readonly BranchLabel[], active: string | undefined) {
  ctx.save();
  for (const label of labels) {
    const at = toScreen(view, label.at);
    const on = label.start === active;
    pill(ctx, at, label.letter, on ? { stroke: BLUE, bold: true, fill: BLUE, color: "white" } : { stroke: "rgb(150, 0, 150)", bold: true, color: "rgb(150, 0, 150)" });
  }
  ctx.restore();
}

/** Oanvända kontroller: grå streckad ring och ett litet kryss uppe till höger. */
export function drawUnused(ctx: Context, view: Viewport, points: readonly { at: Point; label: string }[], radiusMm: number) {
  const radius = Math.max(7, radiusMm * view.pxPerMm);
  ctx.save();
  for (const point of points) {
    const at = toScreen(view, point.at);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(at.x, at.y, radius, 0, 2 * Math.PI); ctx.stroke();
    ctx.strokeStyle = "rgb(110, 110, 110)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(at.x, at.y, radius, 0, 2 * Math.PI); ctx.stroke();
    ctx.setLineDash([]);
    const corner = { x: at.x + radius * 0.75, y: at.y - radius * 0.75 };
    ctx.fillStyle = "rgb(110, 110, 110)";
    ctx.beginPath(); ctx.arc(corner.x, corner.y, 6, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(corner.x - 2.5, corner.y - 2.5); ctx.lineTo(corner.x + 2.5, corner.y + 2.5);
    ctx.moveTo(corner.x + 2.5, corner.y - 2.5); ctx.lineTo(corner.x - 2.5, corner.y + 2.5);
    ctx.stroke();
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgb(90, 90, 90)";
    ctx.fillText(point.label, at.x + radius + 4, at.y + radius * 0.6);
  }
  ctx.restore();
}
