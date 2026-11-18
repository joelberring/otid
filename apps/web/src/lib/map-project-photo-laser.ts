import type { GeoJobList } from "@o-tid/contracts";
import { mosaicGrids, worldFileAffine, type GridPart, type PhotoLaser } from "@o-tid/map-revision/base-map";
import { clubRequest } from "./club-archive-client";
import { loadVegetation, type BasisJob } from "./map-project-drawing-basis";
import { bitmapPixels } from "./map-project-flat-contours";
import { DEPTH_STEP_METERS } from "./map-project-moisture-depth";
import { stageChoices } from "./map-project-stages";

/**
 * Ägaren 2026-11-18: «Tolka flygbild» läser laserkörningens vegetationshöjd (`lasveg.png`) och fuktdjup (`fuktdjup.png`) ur
 * den senaste klara körningen som har dem (en hel omgång etapper på en gång). Inget svar = ingen sådan körning.
 */
export async function loadPhotoLaser(base: string): Promise<PhotoLaser | undefined> {
  const result = await clubRequest(`${base}/geo-jobs`).catch(() => ({ status: 0, json: undefined }));
  const jobs = result.status === 200 ? (result.json as GeoJobList).jobs : [];
  const has = (job: BasisJob, name: string) => job.outputs.some(output => output.name === name);
  const done = jobs.filter(job => job.status === "DONE" && has(job, "lasveg.png") && has(job, "lasveg.pgw"));
  const chosen = stageChoices(done)[0]?.jobs;
  if (!chosen) return undefined;
  const vegetation = await loadVegetation(base, chosen);
  if (!vegetation) return undefined;
  return { vegetation, wet: await loadWet(base, chosen) };
}

async function loadWet(base: string, jobs: readonly BasisJob[]): Promise<GridPart | undefined> {
  const parts: GridPart[] = [];
  for (const job of jobs) {
    if (!["fuktdjup.png", "fuktdjup.pgw"].every(name => job.outputs.some(output => output.name === name))) continue;
    const file = (name: string) => fetch(`${base}/geo-jobs/${job.jobId}/outputs/${name}`, { credentials: "same-origin" }).then(r => r.ok ? r : undefined, () => undefined);
    const [image, world] = await Promise.all([file("fuktdjup.png"), file("fuktdjup.pgw")]);
    if (!image || !world) continue;
    const affine = worldFileAffine(await world.text());
    const bitmap = await createImageBitmap(await image.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" }).catch(() => undefined);
    const pixels = bitmap && bitmapPixels(bitmap);
    bitmap?.close();
    if (!affine || !pixels) continue;
    const meters = new Float32Array(pixels.width * pixels.height).fill(Number.NaN);
    for (let p = 0; p < meters.length; p += 1) if (pixels.data[p * 4 + 3]! >= 128) meters[p] = pixels.data[p * 4]! * DEPTH_STEP_METERS;
    parts.push({ grid: { columns: pixels.width, rows: pixels.height, meters }, affine });
  }
  return mosaicGrids(parts);
}
