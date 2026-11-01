import type { Point } from "@o-tid/map-file";
import { drawCenterCross } from "./course-setting-draw";
import { toScreen, type Viewport } from "./course-setting-viewport";

/**
 * Ägarens önskemål från skogen (steg 66): ett tunt kryss i vald kontrolls mitt, svart med vit kant, så att mitten hamnar
 * rätt när cirkeln dras (`drawCenterCross` i `drawMarks`, bara på skärmen). Medan man drar blir krysset större, i ett
 * eget lager som döljs vid utskrift.
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
  /** Under en dragning: armar som når utanför cirkeln. */
  readonly dragging: boolean;
}

/** Armarnas längd i skärmpixlar medan man drar: utanför cirkeln (i vila är armen 9 px, `drawMarks`). */
export function dragArm(radiusPx: number): number {
  return Math.max(14, radiusPx + 12);
}

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Under en dragning: krysset med långa armar (utanför cirkeln) och, när fingret drar, en tunn streckad linje från fingret.
 * I vila ritar `drawMarks` det korta krysset (samma `drawCenterCross`).
 */
export function drawDragGuide(ctx: Context, view: Viewport, cross: CenterCross, radiusMm: number, finger?: { x: number; y: number }) {
  if (!cross.dragging) return;
  const at = toScreen(view, cross.at);
  if (finger) {
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    ctx.beginPath(); ctx.moveTo(finger.x, finger.y); ctx.lineTo(at.x, at.y); ctx.stroke();
    ctx.restore();
  }
  drawCenterCross(ctx, at, dragArm(radiusMm * view.pxPerMm));
}
