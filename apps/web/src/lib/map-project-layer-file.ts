import { isSupportedEpsg } from "@o-tid/map-file";
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
export type LayerFileProblem = "NO_IMAGE" | "NO_GEOREFERENCE" | "UNSUPPORTED_CRS" | "UNREADABLE" | "TOO_LARGE";
export class LayerFileError extends Error {
  constructor(readonly problem: LayerFileProblem) { super(problem); }
}

const IMAGE = /\.(png|jpe?g|tiff?)$/i;
const WORLD = /\.(pgw|pngw|jgw|jpgw|jpegw|tfw|tifw|tiffw|wld)$/i;
const JPEG_QUALITY = 0.85;
/** GeoTIFF:s nycklar: ett eget (inte EPSG) koordinatsystem. */
const USER_DEFINED = 32767;
const stem = (name: string) => name.replace(/\.[^.]+$/, "");

/** Filerna som valts (bilden och kanske en världsfil) → bilden att skicka. `fallbackCrs` gäller när filen inte säger något. */
export async function prepareLayer(files: readonly File[], fallbackCrs: number | undefined): Promise<PreparedLayer> {
  const image = files.find(file => IMAGE.test(file.name) || /^image\/(png|jpeg|tiff)$/.test(file.type));
  if (!image) throw new LayerFileError("NO_IMAGE");
  const worldFile = files.find(file => WORLD.test(file.name));
  const world = worldFile ? parseWorldFile(await worldFile.text()) : undefined;
  if (worldFile && !world) throw new LayerFileError("NO_GEOREFERENCE");
  const tiff = /\.tiff?$/i.test(image.name) || image.type === "image/tiff";
  const prepared = tiff ? await fromTiff(image, world, fallbackCrs) : await fromPicture(image, world, fallbackCrs);
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

async function fromPicture(file: File, world: Affine | undefined, fallbackCrs: number | undefined): Promise<PreparedLayer> {
  if (!world) throw new LayerFileError("NO_GEOREFERENCE");
  const crs = checkedCrs(fallbackCrs);
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new LayerFileError("UNREADABLE"); }
  try {
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

async function fromTiff(file: File, world: Affine | undefined, fallbackCrs: number | undefined): Promise<PreparedLayer> {
  const { fromArrayBuffer } = await import("geotiff");
  let tiff: Awaited<ReturnType<typeof fromArrayBuffer>>;
  try { tiff = await fromArrayBuffer(await file.arrayBuffer()); } catch { throw new LayerFileError("UNREADABLE"); }
  const image = await tiff.getImage();
  const width = image.getWidth(), height = image.getHeight();
  const georef = tiffGeoreference(image);
  const transform = world ?? georef.transform;
  if (!transform) throw new LayerFileError("NO_GEOREFERENCE");
  const fileCrs = georef.crs;
  const crs = checkedCrs(fileCrs ?? fallbackCrs);
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
