import type { GeoJobView } from "@o-tid/contracts";

/**
 * Ägaren 2026-11-17: laserkörningens filer (bilderna med världsfiler, DXF-filerna) som en zip, så att underlaget kan öppnas i
 * QGIS eller lämnas vidare. Filerna hämtas en i taget genom samma väg som inläsningen använder och packas i webbläsaren;
 * servern håller aldrig hela körningen i minnet.
 */
export type GeoZipResult = { status: "ok"; fileName: string; bytes: Uint8Array } | { status: "failed"; name: string };

/** Zip-filens namn ur körningens namn: bara bokstäver, siffror, bindestreck och understreck. */
export function geoZipName(jobName: string): string {
  const stem = jobName.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${stem || "laser"}-underlag.zip`;
}

/** Storleken i MB med en decimal under 10 MB, annars heltal; minst 0,1. */
export function megabytes(byteSize: number, decimal = ","): string {
  const value = Math.max(0.1, byteSize / (1024 * 1024));
  return (value < 10 ? value.toFixed(1) : String(Math.round(value))).replace(".", decimal);
}

export const geoOutputsSize = (job: Pick<GeoJobView, "outputs">): number => job.outputs.reduce((sum, output) => sum + output.byteSize, 0);

export async function zipGeoOutputs(base: string, job: Pick<GeoJobView, "jobId" | "name" | "outputs">,
  progress: (done: number, total: number) => void = () => undefined, fetcher: typeof fetch = fetch): Promise<GeoZipResult> {
  const files: Record<string, Uint8Array> = {};
  for (const [index, output] of job.outputs.entries()) {
    progress(index, job.outputs.length);
    const response = await fetcher(`${base}/geo-jobs/${job.jobId}/outputs/${output.name}`, { credentials: "same-origin" }).catch(() => undefined);
    if (!response?.ok) return { status: "failed", name: output.name };
    files[output.name] = new Uint8Array(await response.arrayBuffer());
  }
  progress(job.outputs.length, job.outputs.length);
  const { zipSync } = await import("fflate");
  // Bilderna är redan komprimerade; nivå 0 håller webbläsaren snabb också för stora körningar.
  return { status: "ok", fileName: geoZipName(job.name), bytes: zipSync(files, { level: 0 }) };
}
