import { crsFromEpsg, isSupportedEpsg, mapPointToWgs84, wgs84ToProjected, type MapGeoreference, type Point } from "@o-tid/map-file";
import { MAP_PROJECT_LAYER_MAX_BYTES } from "@o-tid/contracts";
import { affineFromOrigin, MAX_LAYER_SIDE, parseWorldFile, scaledAffine, WGS84, type Affine } from "./map-project-layers";

/**
 * ADR-0219 tillägget om underlagen (K4a): en egen bild görs klar för uppladdning i webbläsaren. En GeoTIFF (ortofoto, laserdata,
 * skannad karta) läses med geotiff (laddas först när den behövs), skalas ned till högst 8 192 pixlar per sida och blir en JPEG;
 * dess georeferens och koordinatsystem läses ur filen. En PNG eller JPEG behöver en världsfil (.pgw, .jgw, .wld) och skalas ned
 * om den är för stor. Allt görs i telefonen eller datorn; bara den färdiga bilden skickas.
 */
export interface PreparedLayer {
  readonly bytes: Blob; readonly crs: number; readonly transform: Affine; readonly width: number; readonly height: number;
  /** Ett förslag på namn (filens namn utan ändelse). */
  readonly name: string;
}
export type LayerFileProblem = "NO_IMAGE" | "NO_GEOREFERENCE" | "UNSUPPORTED_CRS" | "UNREADABLE" | "TOO_LARGE" | "OUTSIDE";
export class LayerFileError extends Error {
  constructor(readonly problem: LayerFileProblem) { super(problem); }
}

const IMAGE = /\.(png|jpe?g|tiff?)$/i;
const WORLD = /\.(pgw|pngw|jgw|jpgw|jpegw|tfw|tifw|tiffw|wld)$/i;
const JPEG_QUALITY = 0.85;
/** GeoTIFF:s nycklar: ett eget (inte EPSG) koordinatsystem. */
const USER_DEFINED = 32767;
const stem = (name: string) => name.replace(/\.[^.]+$/, "");

/**
 * En placering för en bild utan georeferens (K6b): bildens storlek i pixlar → koordinatsystem och världsfil. Bilden läggs då mitt
 * på kartan och rättas med passpunkter.
 */
export type Placement = (width: number, height: number) => { readonly crs: number; readonly transform: Affine };

/** Filerna som valts (bilden och kanske en världsfil) → bilden att skicka. `fallbackCrs` gäller när filen inte säger något. */
export async function prepareLayer(files: readonly File[], fallbackCrs: number | undefined, place?: Placement): Promise<PreparedLayer> {
  const image = files.find(file => IMAGE.test(file.name) || /^image\/(png|jpeg|tiff)$/.test(file.type));
  if (!image) throw new LayerFileError("NO_IMAGE");
  const worldFile = files.find(file => WORLD.test(file.name));
  const world = worldFile ? parseWorldFile(await worldFile.text()) : undefined;
  if (worldFile && !world) throw new LayerFileError("NO_GEOREFERENCE");
  const tiff = /\.tiff?$/i.test(image.name) || image.type === "image/tiff";
  const prepared = tiff ? await fromTiff(image, world, fallbackCrs, place) : await fromPicture(image, world, fallbackCrs, place);
  if (prepared.bytes.size > MAP_PROJECT_LAYER_MAX_BYTES) throw new LayerFileError("TOO_LARGE");
  return prepared;
}

function checkedCrs(crs: number | undefined): number {
  if (crs === undefined || !(crs === WGS84 || isSupportedEpsg(crs))) throw new LayerFileError("UNSUPPORTED_CRS");
  return crs;
}

/** Storleken inom 8 192 pixlar per sida och faktorn (1 = som den är). */
function fitted(width: number, height: number) {
  const factor = Math.min(1, MAX_LAYER_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)), factor };
}

async function encode(canvas: OffscreenCanvas | HTMLCanvasElement, type: "image/jpeg" | "image/png"): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality: JPEG_QUALITY });
  return new Promise((resolve, reject) => (canvas).toBlob(blob => blob ? resolve(blob) : reject(new LayerFileError("UNREADABLE")),
    type, JPEG_QUALITY));
}

/** En rityta med 2D-sammanhang (OffscreenCanvas där det finns). */
function surface(width: number, height: number): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext("2d");
    if (!ctx) throw new LayerFileError("UNREADABLE");
    return { canvas, ctx };
  }
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new LayerFileError("UNREADABLE");
  return { canvas, ctx };
}

async function fromPicture(file: File, given: Affine | undefined, fallbackCrs: number | undefined, place: Placement | undefined): Promise<PreparedLayer> {
  if (!given && !place) throw new LayerFileError("NO_GEOREFERENCE");
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new LayerFileError("UNREADABLE"); }
  try {
    const placed = given ? undefined : place!(bitmap.width, bitmap.height);
    const world = given ?? placed!.transform;
    const crs = checkedCrs(placed?.crs ?? fallbackCrs);
    const size = fitted(bitmap.width, bitmap.height);
    if (size.factor === 1) return { bytes: file, crs, transform: world, width: bitmap.width, height: bitmap.height, name: stem(file.name) };
    const { canvas, ctx } = surface(size.width, size.height);
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    const type = /png$/i.test(file.type) || /\.png$/i.test(file.name) ? "image/png" : "image/jpeg";
    return { bytes: await encode(canvas, type), crs, transform: scaledAffine(world, size.width / bitmap.width), width: size.width, height: size.height,
      name: stem(file.name) };
  } finally { bitmap.close(); }
}

/** Det GeoTIFF:en själv säger: världsfilen (om den är georefererad) och EPSG-koden (om den inte är egen). */
export function tiffGeoreference(image: { getGeoKeys(): unknown; getOrigin(): number[]; getResolution(): number[] })
  : { transform: Affine | undefined; crs: number | undefined } {
  const keys = (image.getGeoKeys() ?? {}) as Record<string, number | undefined>;
  let transform: Affine | undefined;
  try {
    const [x0, y0] = image.getOrigin() as [number, number], [rx, ry] = image.getResolution() as [number, number];
    // Rastertypen "punkt" (2): ursprunget är redan första pixelns mitt.
    transform = keys.GTRasterTypeGeoKey === 2 ? { a: rx, b: 0, c: x0, d: 0, e: ry, f: y0 } : affineFromOrigin([x0, y0], [rx, ry]);
  } catch { transform = undefined; }
  const crs = [keys.ProjectedCSTypeGeoKey, keys.GeographicTypeGeoKey].find(code => code !== undefined && code !== USER_DEFINED);
  return { transform, crs };
}

async function fromTiff(file: File, world: Affine | undefined, fallbackCrs: number | undefined, place: Placement | undefined): Promise<PreparedLayer> {
  const { fromArrayBuffer } = await import("geotiff");
  let tiff: Awaited<ReturnType<typeof fromArrayBuffer>>;
  try { tiff = await fromArrayBuffer(await file.arrayBuffer()); } catch { throw new LayerFileError("UNREADABLE"); }
  const image = await tiff.getImage();
  const width = image.getWidth(), height = image.getHeight();
  const georef = tiffGeoreference(image);
  const placed = world ?? georef.transform ? undefined : place?.(width, height);
  const transform = world ?? georef.transform ?? placed?.transform;
  if (!transform) throw new LayerFileError("NO_GEOREFERENCE");
  const crs = checkedCrs(placed?.crs ?? georef.crs ?? fallbackCrs);
  const size = fitted(width, height);
  let rgb: ArrayLike<number> & { width?: number };
  try { rgb = await image.readRGB({ interleave: true, width: size.width, height: size.height, resampleMethod: "bilinear" }) as unknown as ArrayLike<number>; }
  catch { throw new LayerFileError("UNREADABLE"); }
  // 16-bitarsbilder (vissa ortofoton) skalas till 8 bitar.
  const bits = Number(image.getBitsPerSample(0) ?? 8);
  const shift = bits > 8 ? 2 ** (bits - 8) : 1;
  const pixels = new Uint8ClampedArray(size.width * size.height * 4);
  for (let i = 0, j = 0; i < pixels.length; i += 4, j += 3) {
    pixels[i] = rgb[j]! / shift; pixels[i + 1] = rgb[j + 1]! / shift; pixels[i + 2] = rgb[j + 2]! / shift; pixels[i + 3] = 255;
  }
  const { canvas, ctx } = surface(size.width, size.height);
  ctx.putImageData(new ImageData(pixels, size.width, size.height), 0, 0);
  return { bytes: await encode(canvas, "image/jpeg"), crs, transform: size.factor === 1 ? transform : scaledAffine(transform, size.width / width),
    width: size.width, height: size.height, name: stem(file.name) };
}

/** Största sidan på ett hämtat ortofoto (en bildruta för en karta eller etapp; mindre än en egen fil för att gå fort). */
const REMOTE_SIDE = 4096;

/**
 * K4c: en del av en bild på nätet (COG, t.ex. Lantmäteriets ortofoto via serverns `asset`-anrop) blir ett underlag. Bara rutan
 * kring `area` (kartans mm) läses, i den översikt som räcker för upplösningen, så att bara några delar av filen hämtas.
 */
export async function prepareRemoteLayer(url: string, area: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number },
  georeference: MapGeoreference, name: string): Promise<PreparedLayer> {
  const { fromUrl } = await import("geotiff");
  let tiff: Awaited<ReturnType<typeof fromUrl>>;
  try { tiff = await fromUrl(url, { allowFullFile: false }); } catch { throw new LayerFileError("UNREADABLE"); }
  const full = await tiff.getImage();
  const georef = tiffGeoreference(full);
  if (!georef.transform) throw new LayerFileError("NO_GEOREFERENCE");
  const crs = checkedCrs(georef.crs);
  const t = georef.transform;
  // Rutans hörn i bildens system och sedan i bildens pixlar (hela upplösningen).
  const corners: Point[] = [{ x: area.minX, y: area.minY }, { x: area.maxX, y: area.minY }, { x: area.maxX, y: area.maxY }, { x: area.minX, y: area.maxY }];
  const system = crsFromEpsg(crs, "");
  const pixels = corners.map(corner => {
    const at = mapPointToWgs84(georeference, corner);
    const world = crs === WGS84 ? { easting: at.longitude, northing: at.latitude } : wgs84ToProjected(system, at.latitude, at.longitude);
    return { col: (world.easting - t.c) / t.a + 0.5, row: (world.northing - t.f) / t.e + 0.5 };
  });
  const width = full.getWidth(), height = full.getHeight();
  const x0 = Math.max(0, Math.floor(Math.min(...pixels.map(p => p.col)))), x1 = Math.min(width, Math.ceil(Math.max(...pixels.map(p => p.col))));
  const y0 = Math.max(0, Math.floor(Math.min(...pixels.map(p => p.row)))), y1 = Math.min(height, Math.ceil(Math.max(...pixels.map(p => p.row))));
  if (x1 - x0 < 2 || y1 - y0 < 2) throw new LayerFileError("OUTSIDE");
  const factor = Math.min(1, REMOTE_SIDE / Math.max(x1 - x0, y1 - y0));
  const outWidth = Math.max(1, Math.round((x1 - x0) * factor)), outHeight = Math.max(1, Math.round((y1 - y0) * factor));
  // Den minsta översikten som fortfarande har minst så många pixlar som behövs.
  let image = full, scale = 1;
  const count = await tiff.getImageCount();
  for (let index = 1; index < count; index += 1) {
    const candidate = await tiff.getImage(index);
    const ratio = candidate.getWidth() / width;
    if ((x1 - x0) * ratio >= outWidth && (y1 - y0) * ratio >= outHeight && ratio < scale) { image = candidate; scale = ratio; }
  }
  const window = [Math.floor(x0 * scale), Math.floor(y0 * scale), Math.max(Math.floor(x0 * scale) + 1, Math.ceil(x1 * scale)),
    Math.max(Math.floor(y0 * scale) + 1, Math.ceil(y1 * scale))];
  let rgb: ArrayLike<number>;
  try {
    rgb = await image.readRGB({ window, interleave: true, width: outWidth, height: outHeight, resampleMethod: "bilinear" }) as unknown as ArrayLike<number>;
  } catch { throw new LayerFileError("UNREADABLE"); }
  const bits = Number(full.getBitsPerSample(0) ?? 8);
  const shift = bits > 8 ? 2 ** (bits - 8) : 1;
  const data = new Uint8ClampedArray(outWidth * outHeight * 4);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    data[i] = rgb[j]! / shift; data[i + 1] = rgb[j + 1]! / shift; data[i + 2] = rgb[j + 2]! / shift; data[i + 3] = 255;
  }
  const { canvas, ctx } = surface(outWidth, outHeight);
  ctx.putImageData(new ImageData(data, outWidth, outHeight), 0, 0);
  // Fönstrets övre vänstra hörn i bildens system, och pixelns storlek i utbilden.
  const origin: [number, number] = [t.c - t.a / 2 + t.a * x0, t.f - t.e / 2 + t.e * y0];
  const transform = affineFromOrigin(origin, [t.a * (x1 - x0) / outWidth, t.e * (y1 - y0) / outHeight]);
  const bytes = await encode(canvas, "image/jpeg");
  if (bytes.size > MAP_PROJECT_LAYER_MAX_BYTES) throw new LayerFileError("TOO_LARGE");
  return { bytes, crs, transform, width: outWidth, height: outHeight, name };
}
