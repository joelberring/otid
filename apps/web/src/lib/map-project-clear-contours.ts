import { heightGridOf, worldFileAffine, type HeightGrid, type PixelAffine } from "@o-tid/map-revision/base-map";
import { bitmapPixels, layerAffine } from "./map-project-flat-contours";

/**
 * «Tydligare kurvbild» (ägaren 2026-11-14) i webben: markens höjd läses ur laserkörningens `hojd.png` (cm som 24 bitar,
 * SWEREF 99 TM), när grundkartan läses in och i reglagens panel. Regeln finns i `@o-tid/map-revision/base-map` (`clearContours`).
 */
export const HEIGHT_IMAGE = "hojd.png", HEIGHT_WORLD = "hojd.pgw";
const JOB_CRS = 3006;
export interface HeightPart { readonly grid: HeightGrid; readonly affine: PixelAffine }

/**
 * Jobbets höjd i koordinatsystemet `crs`. Inget när körningen saknar höjdbilden; `"failed"` när den inte gick att läsa.
 * Höjden ligger i färgvärdena, så bilden läses utan färgomräkning och utan förmultiplicerad genomskinlighet.
 */
export async function jobHeights(base: string, job: { readonly jobId: string; readonly outputs: readonly { readonly name: string }[] }, crs = JOB_CRS): Promise<HeightPart | "failed" | undefined> {
  if (![HEIGHT_IMAGE, HEIGHT_WORLD].every(name => job.outputs.some(output => output.name === name))) return undefined;
  const file = (name: string) => fetch(`${base}/geo-jobs/${job.jobId}/outputs/${name}`, { credentials: "same-origin" }).catch(() => undefined);
  const [image, world] = await Promise.all([file(HEIGHT_IMAGE), file(HEIGHT_WORLD)]);
  if (!image?.ok || !world?.ok) return "failed";
  const affine = worldFileAffine(await world.text());
  const bitmap = await createImageBitmap(await image.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" }).catch(() => undefined);
  const pixels = bitmap && bitmapPixels(bitmap);
  bitmap?.close();
  if (!affine || !pixels) return "failed";
  const [a, b, c, d, e, f] = affine;
  // Världsfilen ger bildpunkternas mitt; `layerAffine` vill ha hörnen (0,5 = mitten av första punkten).
  return { grid: heightGridOf(pixels), affine: crs === JOB_CRS ? affine
    : layerAffine((column, line) => [a * (column - 0.5) + b * (line - 0.5) + c, d * (column - 0.5) + e * (line - 0.5) + f], pixels.width, pixels.height, JOB_CRS, crs) };
}
