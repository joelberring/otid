import {
  projectedToMapPoint, projectedToWgs84, wgs84ToMapPoint, type MapGeoreference, type Point
} from "@o-tid/map-file";

/**
 * ADR-0219 tillägget om underlagen (K4a): underlagens geometri utan React och utan webbläsare. En bilds georeferens är
 * världsfilens sex tal (pixelns mitt → koordinatsystemets enheter): x = a·kolumn + b·rad + c, y = d·kolumn + e·rad + f. På kartan
 * blir det en affin transform från bildens pixlar till kartans mm (y uppåt), räknad ur tre hörn via kartfilens georeferens
 * (samma koordinatsystem direkt, annars via WGS 84; EPSG:4326 är longitud och latitud i grader).
 */
export interface Affine { readonly a: number; readonly b: number; readonly c: number; readonly d: number; readonly e: number; readonly f: number }

export const WGS84 = 4326;
/** Största sidan på en bild som läggs upp (webbläsarna klarar större, men minnet i telefonen gör det inte). */
export const MAX_LAYER_SIDE = 8192;

/** Världsfilen (.pgw, .jgw, .tfw, .wld): sex tal på var sin rad i ordningen A, D, B, E, C, F. Undefined om den inte går att läsa. */
export function parseWorldFile(text: string): Affine | undefined {
  const numbers = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(Number);
  if (numbers.length < 6 || numbers.slice(0, 6).some(value => !Number.isFinite(value))) return undefined;
  const [a, d, b, e, c, f] = numbers as [number, number, number, number, number, number];
  return Math.abs(a * e - b * d) > 1e-18 ? { a, b, c, d, e, f } : undefined;
}

/** Världsfilen ur en GeoTIFF:s ursprung (hörnet på första pixeln) och upplösning (y negativ när norr är uppåt). */
export function affineFromOrigin(origin: readonly [number, number], resolution: readonly [number, number]): Affine {
  const [x0, y0] = origin, [rx, ry] = resolution;
  return { a: rx, b: 0, c: x0 + rx / 2, d: 0, e: ry, f: y0 + ry / 2 };
}

/** Samma bild med `factor` gånger så många pixlar på bredden och höjden (nedskalad bild: factor < 1). Mitten på första pixeln flyttas. */
export function scaledAffine(affine: Affine, factor: number): Affine {
  const a = affine.a / factor, b = affine.b / factor, d = affine.d / factor, e = affine.e / factor;
  // Hörnet (−0,5; −0,5) i gamla pixlar ska stå kvar: ny mitt = hörnet + en halv ny pixel.
  const cornerX = affine.c - (affine.a + affine.b) / 2, cornerY = affine.f - (affine.d + affine.e) / 2;
  return { a, b, c: cornerX + (a + b) / 2, d, e, f: cornerY + (d + e) / 2 };
}

const apply = (t: Affine, column: number, row: number) => ({ x: t.a * column + t.b * row + t.c, y: t.d * column + t.e * row + t.f });

/** Bildens punkt i kartans mm. Kastar om koordinatsystemet inte kan räknas. */
function toMap(georeference: MapGeoreference, crs: number, x: number, y: number): Point {
  if (crs === WGS84) return wgs84ToMapPoint(georeference, { latitude: y, longitude: x });
  if (georeference.crs.kind === "EPSG" && georeference.crs.code === crs) return projectedToMapPoint(georeference, { easting: x, northing: y });
  return wgs84ToMapPoint(georeference, projectedToWgs84({ kind: "EPSG", code: crs }, x, y));
}

/**
 * Bildens pixlar (mitten) → kartans mm, ur tre punkter (övre vänstra, övre högra och nedre vänstra pixeln), så att små
 * skillnader mellan koordinatsystemen fördelas över bilden. Kastar om koordinatsystemet inte kan räknas.
 */
export function layerToMap(layer: { width: number; height: number; crs: number; transform: Affine }, georeference: MapGeoreference): Affine {
  const corners = [[0, 0], [layer.width - 1, 0], [0, layer.height - 1]] as const;
  const [p0, p1, p2] = corners.map(([column, row]) => { const at = apply(layer.transform, column, row); return toMap(georeference, layer.crs, at.x, at.y); }) as [Point, Point, Point];
  const w = Math.max(1, layer.width - 1), h = Math.max(1, layer.height - 1);
  const a = (p1.x - p0.x) / w, d = (p1.y - p0.y) / w, b = (p2.x - p0.x) / h, e = (p2.y - p0.y) / h;
  return { a, b, c: p0.x, d, e, f: p0.y };
}

/** Bildens fyra hörn i kartans mm (för att se om underlaget alls ligger på kartan). */
export function layerCorners(toMapAffine: Affine, width: number, height: number): Point[] {
  return [[-0.5, -0.5], [width - 0.5, -0.5], [width - 0.5, height - 0.5], [-0.5, height - 0.5]].map(([column, row]) => apply(toMapAffine, column!, row!));
}

/**
 * Canvas-transformen som ritar bilden (pixel i, j) på skärmen: kartans mm → skärmens pixlar (vyns mitt och skala, y nedåt) efter
 * bildens pixlar → kartans mm. Bilden ritas med `drawImage(bild, −0,5, −0,5)` så att pixlarnas mitt hamnar rätt.
 */
export function screenTransform(toMapAffine: Affine, view: { centerX: number; centerY: number; pxPerMm: number; width: number; height: number })
  : [number, number, number, number, number, number] {
  const s = view.pxPerMm;
  return [s * toMapAffine.a, -s * toMapAffine.d, s * toMapAffine.b, -s * toMapAffine.e,
    s * (toMapAffine.c - view.centerX) + view.width / 2, view.height / 2 - s * (toMapAffine.f - view.centerY)];
}

/** Underlagen på kartan, i ordning, var och en med sin genomskinlighet (ADR-0219 K4a). */
export function drawLayers(ctx: CanvasRenderingContext2D, view: { centerX: number; centerY: number; pxPerMm: number; width: number; height: number },
  layers: readonly { readonly image: CanvasImageSource; readonly toMap: Affine; readonly opacity: number }[]) {
  for (const layer of layers) {
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.imageSmoothingQuality = "medium";
    ctx.transform(...screenTransform(layer.toMap, view));
    ctx.drawImage(layer.image, -0.5, -0.5);
    ctx.restore();
  }
}
