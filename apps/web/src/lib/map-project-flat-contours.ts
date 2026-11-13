import type { GeoJobView } from "@o-tid/contracts";
import { projectedToWgs84, wgs84ToProjected } from "@o-tid/map-file";
import { DEFAULT_FLAT_LEVEL, slopeGridOf, worldFileAffine, type PixelAffine } from "@o-tid/map-revision/base-map";
import type { BaseMapCalm } from "./map-project-candidates";

/**
 * «Lugna kurvor på flack mark» (ägaren 2026-11-13) i webben: lutningen läses ur laserkörningens fuktdjup, antingen ur
 * underlaget som redan ligger i kartan (reglaget) eller ur körningens filer (när grundkartan läses in). Regeln finns i
 * `@o-tid/map-revision/base-map` (`calmFlatContours`).
 */
const DEPTH_IMAGE = "fuktdjup.png", DEPTH_WORLD = "fuktdjup.pgw";

/** Bildens punkter (RGBA), eller inget när webbläsaren inte ger en rityta. */
export function bitmapPixels(image: ImageBitmap): ImageData | undefined {
  const canvas = document.createElement("canvas");
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, image.width, image.height);
}

/**
 * Var ett underlags bildpunkter ligger i kandidaternas koordinatsystem. `toSource` ger en bildpunkts hörn (kolumn, rad) i
 * kartans koordinatsystem (`mapCrs`); skiljer sig kandidaternas (`crs`) räknas bildens tre hörn om, och felet av att
 * sambandet inte är helt rätlinjigt är långt under en cell över ett kartblad.
 */
export function layerAffine(toSource: (column: number, row: number) => [number, number], width: number, height: number, mapCrs: number, crs: number): PixelAffine {
  const move = ([x, y]: [number, number]): [number, number] => {
    if (mapCrs === crs) return [x, y];
    const position = projectedToWgs84({ kind: "EPSG", code: mapCrs }, x, y);
    const point = wgs84ToProjected({ kind: "EPSG", code: crs }, position.latitude, position.longitude);
    return [point.easting, point.northing];
  };
  // Bildpunkternas mitt: första punkten, och den som skulle ligga en bildbredd respektive bildhöjd bort.
  const origin = move(toSource(0.5, 0.5)), across = move(toSource(width + 0.5, 0.5)), down = move(toSource(0.5, height + 0.5));
  return [(across[0] - origin[0]) / width, (down[0] - origin[0]) / height, origin[0], (across[1] - origin[1]) / width, (down[1] - origin[1]) / height, origin[1]];
}

/**
 * Lutningen ur körningens fuktdjup (bilden och världsfilen, SWEREF 99 TM) med förvalets nivå, för inläsningen av grundkartan.
 * Inget när körningen gjordes utan fuktigheten; `"failed"` när filerna finns men inte gick att läsa.
 */
export async function jobSlope(base: string, job: GeoJobView): Promise<BaseMapCalm | "failed" | undefined> {
  if (![DEPTH_IMAGE, DEPTH_WORLD].every(name => job.outputs.some(output => output.name === name))) return undefined;
  const file = (name: string) => fetch(`${base}/geo-jobs/${job.jobId}/outputs/${name}`, { credentials: "same-origin" }).catch(() => undefined);
  const [image, world] = await Promise.all([file(DEPTH_IMAGE), file(DEPTH_WORLD)]);
  if (!image?.ok || !world?.ok) return "failed";
  const affine = worldFileAffine(await world.text());
  const bitmap = await createImageBitmap(await image.blob()).catch(() => undefined);
  const pixels = bitmap && bitmapPixels(bitmap);
  bitmap?.close();
  return affine && pixels ? { grid: slopeGridOf(pixels), affine, level: DEFAULT_FLAT_LEVEL } : "failed";
}
