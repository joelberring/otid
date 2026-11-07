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

/** Hela ytan i vyn med marginal (px) på alla sidor. */
/** Det som ligger ovanpå kartan vid kanterna (verktygsraden, telefonens rader), i px. */
export interface Insets { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }
export const NO_INSETS: Insets = { left: 0, right: 0, top: 0, bottom: 0 };

/**
 * Hela ytan i bild, i den del av rutan som inte täcks av `insets` (ägarens fel 2026-11-03: starten låg under verktygsraden
 * och gick inte att ta tag i).
 */
export function fitBounds(bounds: Bounds, width: number, height: number, margin = 16, insets: Insets = NO_INSETS): Viewport {
  const spanX = Math.max(1, bounds.maxX - bounds.minX), spanY = Math.max(1, bounds.maxY - bounds.minY);
  const free = { width: width - insets.left - insets.right, height: height - insets.top - insets.bottom };
  // Lämnar överliggande delar för lite plats: hela rutan som förut.
  const use = free.width >= width * 0.4 && free.height >= height * 0.4 ? insets : NO_INSETS;
  const usableWidth = width - use.left - use.right, usableHeight = height - use.top - use.bottom;
  const pxPerMm = clamp(Math.min(Math.max(1, usableWidth - 2 * margin) / spanX, Math.max(1, usableHeight - 2 * margin) / spanY));
  return { centerX: (bounds.minX + bounds.maxX) / 2 - (use.left - use.right) / 2 / pxPerMm,
    centerY: (bounds.minY + bounds.maxY) / 2 + (use.top - use.bottom) / 2 / pxPerMm, pxPerMm, width, height };
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
  // Samma storlek: samma vy (B5, ADR-0218), så att ingen ny bild av hela kartan beställs i onödan.
  if (view.width === width && view.height === height) return view;
  return { ...view, width, height };
}

/** Hjulets steg som zoomfaktor (ett vanligt hjulsteg ≈ 100 px ger 1,25×). */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const pixels = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-Math.max(-400, Math.min(400, pixels)) * Math.log(1.25) / 100);
}

/**
 * Vad ett hjul- eller styrplatte-event ska göra. Nyp på styrplattan (och Ctrl/Cmd + hjul) kommer som `ctrlKey` och
 * zoomar. Två fingrar på styrplattan ger pixel-steg, ofta i sidled eller med decimaler, och panorerar som i andra
 * kartprogram. Ett vanligt mushjul (radsteg, eller stora heltalssteg rakt i höjdled) zoomar.
 */
export function wheelAction(event: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; metaKey?: boolean }):
  "zoom" | "pan" {
  if (event.ctrlKey || event.metaKey) return "zoom";
  if (event.deltaMode !== 0) return "zoom";
  const trackpad = event.deltaX !== 0 || !Number.isInteger(event.deltaY) || Math.abs(event.deltaY) < 50;
  return trackpad ? "pan" : "zoom";
}

/** Skalan i en ruta som en bitmapp ritats i: hur den ska ritas om till den nya vyn (för snabb panorering och zoom). */
export function bitmapPlacement(drawn: Viewport, view: Viewport): { x: number; y: number; width: number; height: number } {
  const origin = toScreen(view, topLeft(drawn));
  const scale = view.pxPerMm / drawn.pxPerMm;
  return { x: origin.x, y: origin.y, width: drawn.width * scale, height: drawn.height * scale };
}
