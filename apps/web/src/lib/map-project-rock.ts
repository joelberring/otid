import type { GeoJobView } from "@o-tid/contracts";
import { worldFileAffine } from "@o-tid/map-revision/base-map";
import { bitmapPixels } from "./map-project-flat-contours";
import type { BaseMapRock } from "./map-project-candidates";

/**
 * «Berg i dagen med reglage» (ägaren 2026-11-13): när grundkartan läses in används laserkörningens bergbild (`berg.png`, med
 * världsfil, SWEREF 99 TM) med regeln och förvalets nivå i stället för berg.dxf:s berg i dagen. Regeln finns i
 * `@o-tid/map-revision/base-map` (`rockAreas`), och reglaget i panelen väljer sedan bland samma bildpunkter.
 */
const ROCK_IMAGE = "berg.png", ROCK_WORLD = "berg.pgw";

/**
 * Bergbilden ur körningens filer. Inget när körningen är äldre (utan bergbild); `"failed"` när filerna finns men inte gick att
 * läsa. Nivån sätts av anroparen.
 */
export async function jobRock(base: string, job: GeoJobView): Promise<Omit<BaseMapRock, "level"> | "failed" | undefined> {
  if (![ROCK_IMAGE, ROCK_WORLD].every(name => job.outputs.some(output => output.name === name))) return undefined;
  const file = (name: string) => fetch(`${base}/geo-jobs/${job.jobId}/outputs/${name}`, { credentials: "same-origin" }).catch(() => undefined);
  const [image, world] = await Promise.all([file(ROCK_IMAGE), file(ROCK_WORLD)]);
  if (!image?.ok || !world?.ok) return "failed";
  const affine = worldFileAffine(await world.text());
  const bitmap = await createImageBitmap(await image.blob()).catch(() => undefined);
  const pixels = bitmap && bitmapPixels(bitmap);
  bitmap?.close();
  return affine && pixels ? { pixels: { width: pixels.width, height: pixels.height, data: pixels.data }, affine } : "failed";
}
