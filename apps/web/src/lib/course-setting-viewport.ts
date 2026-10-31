import type { Point } from "@o-tid/map-file";

/**
 * Steg 62: banläggningens kartvy utan React. Kartans mm har y uppåt (ADR-0180 beslut 3), skärmen y nedåt. Vyn är
 * kartpunkten i mitten, skalan (skärmpixlar per mm) och storleken i CSS-pixlar; zoom håller punkten under muspekaren
 * stilla.
 */
export interface Viewport {
  readonly centerX: number;
  readonly centerY: number;
  readonly pxPerMm: number;
  readonly width: number;
  readonly height: number;
}

export interface Bounds { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }

/** Från en hel karta på en mobil (0,2 px/mm) till enskilda symboler (80 px/mm). */
export const MIN_PX_PER_MM = 0.2, MAX_PX_PER_MM = 80;
const clamp = (value: number) => Math.min(MAX_PX_PER_MM, Math.max(MIN_PX_PER_MM, value));

export function toScreen(view: Viewport, point: Point): { x: number; y: number } {
  return { x: (point.x - view.centerX) * view.pxPerMm + view.width / 2, y: view.height / 2 - (point.y - view.centerY) * view.pxPerMm };
}

export function toMap(view: Viewport, screen: { x: number; y: number }): Point {
  return { x: view.centerX + (screen.x - view.width / 2) / view.pxPerMm, y: view.centerY - (screen.y - view.height / 2) / view.pxPerMm };
}

/** Kartpunkten i skärmens övre vänstra hörn (`origin` för `drawMap`). */
export function topLeft(view: Viewport): Point {
  return { x: view.centerX - view.width / 2 / view.pxPerMm, y: view.centerY + view.height / 2 / view.pxPerMm };
}

/** Kartytan som syns, i mm. */
export function visibleBounds(view: Viewport): Bounds {
  const origin = topLeft(view);
  return { minX: origin.x, maxY: origin.y, maxX: origin.x + view.width / view.pxPerMm, minY: origin.y - view.height / view.pxPerMm };
}

/** Hela ytan i vyn med marginal (px) på alla sidor. */
export function fitBounds(bounds: Bounds, width: number, height: number, margin = 16): Viewport {
  const spanX = Math.max(1, bounds.maxX - bounds.minX), spanY = Math.max(1, bounds.maxY - bounds.minY);
  const pxPerMm = clamp(Math.min(Math.max(1, width - 2 * margin) / spanX, Math.max(1, height - 2 * margin) / spanY));
  return { centerX: (bounds.minX + bounds.maxX) / 2, centerY: (bounds.minY + bounds.maxY) / 2, pxPerMm, width, height };
}

/** Zoomar med `factor` kring en skärmpunkt (standard: mitten); kartpunkten där står still. */
export function zoomAt(view: Viewport, factor: number, screen = { x: view.width / 2, y: view.height / 2 }): Viewport {
  const pxPerMm = clamp(view.pxPerMm * factor);
  const anchor = toMap(view, screen);
  return { ...view, pxPerMm, centerX: anchor.x - (screen.x - view.width / 2) / pxPerMm, centerY: anchor.y + (screen.y - view.height / 2) / pxPerMm };
}

/** Flyttar vyn så att kartan följer pekaren `dx`, `dy` skärmpixlar. */
export function panBy(view: Viewport, dx: number, dy: number): Viewport {
  return { ...view, centerX: view.centerX - dx / view.pxPerMm, centerY: view.centerY + dy / view.pxPerMm };
}

/** Ny storlek på ytan; mitten och skalan behålls. */
export function resize(view: Viewport, width: number, height: number): Viewport {
  return { ...view, width, height };
}

/** Hjulets steg som zoomfaktor (ett vanligt hjulsteg ≈ 100 px ger 1,25×). */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const pixels = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-Math.max(-400, Math.min(400, pixels)) * Math.log(1.25) / 100);
}

/** Skalan i en ruta som en bitmapp ritats i: hur den ska ritas om till den nya vyn (för snabb panorering och zoom). */
export function bitmapPlacement(drawn: Viewport, view: Viewport): { x: number; y: number; width: number; height: number } {
  const origin = toScreen(view, topLeft(drawn));
  const scale = view.pxPerMm / drawn.pxPerMm;
  return { x: origin.x, y: origin.y, width: drawn.width * scale, height: drawn.height * scale };
}
