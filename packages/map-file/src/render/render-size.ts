import type { ParsedMap, Point } from "../model";

/**
 * Steg 59: bildens storlek. Upplösning efter skala (cirka 8 px/mm för 1:10 000 och 1:15 000, 12 px/mm för sprint), men
 * aldrig större än 16 000 px per sida eller fler pixlar än att PNG:n rimligen håller sig under kartbildens gräns
 * (30 MB, `RACE_MAP_MAX_BYTES`). Webbläsaren ritar om med lägre upplösning om PNG:n ändå blir för stor.
 */
export const MAX_RENDER_SIDE = 16_000;
/** Pixlar per bild. En orienteringskarta som PNG blir sällan mer än 1 byte per pixel; 30 MB ger då marginal. */
export const MAX_RENDER_PIXELS = 28_000_000;
/** Vit kant runt objekten (mm). */
export const RENDER_MARGIN_MM = 2;

/** Upplösningen för skalan: 12 px/mm för sprint (≤ 1:5 000), 10 mellan sprint och 1:10 000, annars 8. */
export function preferredPxPerMm(scale: number): number {
  if (!(scale > 0)) return 8;
  if (scale <= 5_000) return 12;
  if (scale < 10_000) return 10;
  return 8;
}

export interface RenderSize {
  readonly width: number;
  readonly height: number;
  readonly pxPerMm: number;
  /** Kartans punkt (mm, y uppåt) i bildens övre vänstra hörn. */
  readonly origin: Point;
  /** Upplösningen sänktes för att hålla gränserna. */
  readonly reduced: boolean;
}

/**
 * Storleken för kartans yta (`bounds` plus kant) med önskad upplösning, nedskalad vid behov. Undefined när kartan saknar
 * objekt.
 */
export function renderSize(map: Pick<ParsedMap, "bounds">, pxPerMm: number,
  limits: { maxSide?: number; maxPixels?: number } = {}): RenderSize | undefined {
  const bounds = map.bounds;
  if (!bounds || !(pxPerMm > 0)) return undefined;
  const maxSide = limits.maxSide ?? MAX_RENDER_SIDE, maxPixels = limits.maxPixels ?? MAX_RENDER_PIXELS;
  const widthMm = Math.max(1, bounds.maxX - bounds.minX + 2 * RENDER_MARGIN_MM);
  const heightMm = Math.max(1, bounds.maxY - bounds.minY + 2 * RENDER_MARGIN_MM);
  let scale = pxPerMm;
  scale = Math.min(scale, maxSide / widthMm, maxSide / heightMm, Math.sqrt(maxPixels / (widthMm * heightMm)));
  // Jämna värden (två decimaler) så att samma fil ger samma bild.
  scale = Math.floor(scale * 100) / 100;
  if (!(scale > 0)) return undefined;
  const width = Math.max(1, Math.min(maxSide, Math.ceil(widthMm * scale)));
  const height = Math.max(1, Math.min(maxSide, Math.ceil(heightMm * scale)));
  return { width, height, pxPerMm: scale, origin: { x: bounds.minX - RENDER_MARGIN_MM, y: bounds.maxY + RENDER_MARGIN_MM },
    reduced: scale < pxPerMm };
}

/** Bildens pixel för en punkt i kartans mm. */
export function mmToPixel(render: { pxPerMm: number; origin: Point }, point: Point): Point {
  return { x: (point.x - render.origin.x) * render.pxPerMm, y: (render.origin.y - point.y) * render.pxPerMm };
}

/** Kartans mm för en pixel i bilden. */
export function pixelToMm(render: { pxPerMm: number; origin: Point }, pixel: Point): Point {
  return { x: render.origin.x + pixel.x / render.pxPerMm, y: render.origin.y - pixel.y / render.pxPerMm };
}
