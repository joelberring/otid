import type { Point } from "@o-tid/map-file";
import { toScreen, type Viewport } from "./course-setting-viewport";

/**
 * Ägarens önskemål från skogen (steg 66): ett tunt kryss i vald kontrolls mitt, svart med vit kant, så att mitten hamnar
 * rätt när cirkeln dras. Krysset ritas bara på skärmen i ett eget lager (aldrig i banpåtrycket, dolt vid utskrift).
 *
 * På pekskärm skymmer fingret kontrollen, så en dragning med fingret lyfts `LIFT_PX` uppåt: kontrollen hoppar upp en
 * bit när dragningen börjar och följer sedan fingret med samma förskjutning. En tunn linje visar var fingret är.
 */
export const LIFT_PX = 56;

/** Punkten som dragningen ska följa: för finger en bit ovanför fingret, annars pekaren. */
export function liftedPoint(at: { x: number; y: number }, pointerType: string): { x: number; y: number } {
  return pointerType === "touch" ? { x: at.x, y: at.y - LIFT_PX } : at;
}

export interface CenterCross {
  readonly at: Point;
  /** Under en dragning: längre armar som når utanför cirkeln. */
  readonly dragging: boolean;
}

/** Armarnas längd i skärmpixlar: kort i vila, utanför cirkeln medan man drar. */
export function crossArm(radiusPx: number, dragging: boolean): number {
  return dragging ? Math.max(14, radiusPx + 12) : Math.max(5, Math.min(8, radiusPx * 0.45));
}

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function drawCenterCross(ctx: Context, view: Viewport, cross: CenterCross, radiusMm: number, finger?: { x: number; y: number }) {
  const at = toScreen(view, cross.at);
  const arm = crossArm(radiusMm * view.pxPerMm, cross.dragging);
  ctx.save();
  ctx.lineCap = "butt";
  if (finger) {
    // Fingret och kontrollen: en tunn streckad linje, så att förskjutningen syns.
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    ctx.beginPath(); ctx.moveTo(finger.x, finger.y); ctx.lineTo(at.x, at.y); ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const [width, color] of [[3, "#fff"], [1, "#000"]] as const) {
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(at.x - arm, at.y); ctx.lineTo(at.x + arm, at.y);
    ctx.moveTo(at.x, at.y - arm); ctx.lineTo(at.x, at.y + arm);
    ctx.stroke();
  }
  ctx.restore();
}
