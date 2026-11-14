import { GEO_JOB_MAX_TILES, type GeoClip, type GeoJobView } from "@o-tid/contracts";
import { validLaserBox, type Wgs84Box } from "@o-tid/map-revision";
import { SAMPLE_SIDE_M } from "./map-project-clip";

/**
 * Guiden «Ny grundkarta» (ägaren 2026-11-13: «rörigt», förstod inte ordningen): den rena logiken. Läget härleds ur det som
 * finns på servern och i editorn (uppgifterna, körningarna för området, kandidaterna), så att guiden står på rätt steg
 * också efter en omladdning.
 */
export const GUIDE_STEPS = ["area", "run", "wait", "review"] as const;
export type GuideStep = typeof GUIDE_STEPS[number];
/** Varför området inte ryms i en körning: rutan är för stor för sökningen, eller så blir det fler laserrutor än ett jobb tar. */
export type AreaTooLarge = "search" | "tiles";

/** Lantmäteriets laserrutor är 2,5 × 2,5 km i SWEREF 99 TM:s rutnät. */
const TILE_M = 2500;

/**
 * Hur stort området är för en körning. `box` är sökrutan (samma som laserpanelen skickar) och `clip` områdets ruta i
 * SWEREF 99 TM utan marginal. Antalet rutor är en uppskattning ur rutnätet tills sökningen har svarat (`found`).
 */
export function laserAreaSize(box: Wgs84Box, clip: GeoClip | undefined, found?: number): { tiles: number; km2: number | undefined; tooLarge: AreaTooLarge | undefined } {
  const estimate = clip ? (Math.floor((clip.maxX - 1) / TILE_M) - Math.floor(clip.minX / TILE_M) + 1) * (Math.floor((clip.maxY - 1) / TILE_M) - Math.floor(clip.minY / TILE_M) + 1) : 0;
  const tiles = found ?? estimate;
  return { tiles, km2: clip ? clipKm2(clip) : undefined, tooLarge: !validLaserBox(box) ? "search" : tiles > GEO_JOB_MAX_TILES ? "tiles" : undefined };
}
const clipKm2 = (clip: GeoClip) => (clip.maxX - clip.minX) * (clip.maxY - clip.minY) / 1_000_000;
/** Ytan en körning bearbetar: klipprutan, annars hela laserrutorna. */
const jobKm2 = (job: Pick<GeoJobView, "clip" | "tiles">) => job.clip ? clipKm2(job.clip) : job.tiles * (TILE_M / 1000) ** 2;

const ACTIVE: ReadonlySet<string> = new Set(["QUEUED", "RUNNING"]);
/**
 * En provruta (laserpanelens «Kör om» på 250 × 250 m) är ingen grundkarta för området. Den känns igen på storleken och på
 * att samma område har en körning med större ruta (den som kördes om); en mycket liten karta är alltså ingen provruta.
 */
const isSample = (job: GeoJobView, jobs: readonly GeoJobView[]) => !!job.clip && job.clip.maxX - job.clip.minX <= SAMPLE_SIDE_M && job.clip.maxY - job.clip.minY <= SAMPLE_SIDE_M
  && jobs.some(other => other.kind === "PULLAUTIN" && other.areaId === job.areaId && jobKm2(other) > jobKm2(job));
/**
 * En sammanslagning av etapper som misslyckats är ingen körning för guiden: etapperna är klara och läses in i webbläsaren
 * («Läs in alla etapper som en grundkarta»). Att köra om lasern hjälper inte (ägaren 2026-11-14, «Etappernas bilder har
 * olika upplösning»).
 */
const failedMerge = (job: GeoJobView) => !!job.mergedStages && job.status === "FAILED";
const newestFirst = (jobs: readonly GeoJobView[]) => jobs.filter(job => job.kind === "PULLAUTIN" && job.status !== "CANCELLED" && !failedMerge(job) && !isSample(job, jobs))
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/** Den senaste körningen för området (`null` = hela kartan); avbrutna och provrutor räknas inte. `ignore` är körningen som «Ny körning» lämnar bakom sig. */
export function latestAreaJob(jobs: readonly GeoJobView[], areaId: string | null, ignore?: string): GeoJobView | undefined {
  const job = newestFirst(jobs).find(row => (row.areaId ?? null) === areaId);
  return job && job.jobId !== ignore ? job : undefined;
}

/** Området guiden börjar på: där den senaste körningen gjordes (om delen finns kvar), annars hela kartan (""). */
export function guideDefaultArea(jobs: readonly GeoJobView[], areaIds: readonly string[]): string {
  const areaId = newestFirst(jobs)[0]?.areaId;
  return areaId && areaIds.includes(areaId) ? areaId : "";
}

export interface GuideInput {
  /** Uppgifterna till Lantmäteriet: inte lästa än, saknas eller sparade och läsbara. */
  readonly credential: "unknown" | "missing" | "ready";
  readonly tooLarge: AreaTooLarge | undefined;
  /** Den senaste körningen för området (`latestAreaJob`). */
  readonly job: Pick<GeoJobView, "status"> | undefined;
  /** Körningen har grundkartans filer (äldre körningar och körningar som bara gav bilden har dem inte). */
  readonly loadable: boolean;
  /** Körningens grundkarta visas som kandidater under kartan (inte inlagd än). */
  readonly candidates: boolean;
  /** Körningens grundkarta är inlagd i kartan eller lämnad som förslag. */
  readonly placed: boolean;
}
export type GuideDetail = "too-large" | "checking" | "credential" | "ready" | "failed" | "unusable" | "queued" | "running" | "load" | "candidates" | "placed";
export interface GuideState {
  /** Steget guiden står på; när allt är klart står den kvar på sista steget med `finished`. */
  readonly step: GuideStep; readonly detail: GuideDetail; readonly finished: boolean;
  readonly marks: Readonly<Record<GuideStep, "done" | "current" | "todo">>;
}

const at = (step: GuideStep, detail: GuideDetail, finished = false): GuideState => {
  const index = GUIDE_STEPS.indexOf(step);
  return { step, detail, finished, marks: Object.fromEntries(GUIDE_STEPS.map((name, i) =>
    [name, finished || i < index ? "done" : i === index ? "current" : "todo"])) as GuideState["marks"] };
};

/** Vilket steg guiden står på. En pågående eller klar körning går före allt annat: den finns oavsett vad som valts sedan. */
export function guideState(input: GuideInput): GuideState {
  const status = input.job?.status;
  if (status && ACTIVE.has(status)) return at("wait", status === "QUEUED" ? "queued" : "running");
  if (status === "DONE" && input.loadable) {
    if (input.candidates) return at("review", "candidates");
    return input.placed ? at("review", "placed", true) : at("review", "load");
  }
  if (input.tooLarge) return at("area", "too-large");
  if (input.credential !== "ready") return at("run", input.credential === "missing" ? "credential" : "checking");
  return at("run", status === "FAILED" ? "failed" : status === "DONE" ? "unusable" : "ready");
}

/**
 * GISSNINGAR, inte uppmätta värden: utan tidigare körningar i projektet räknas en körning ta 2 minuter per km² plus
 * 5 minuter för att geo-servern ska starta och hämta laserrutorna. Finns klara körningar i projektet används deras
 * takt i stället (medianen av minuter per km², från att de lades i kön till att de blev klara).
 */
const GUESS_MINUTES_PER_KM2 = 2, GUESS_START_MINUTES = 5;

/** Ungefär hur länge körningen tar i minuter (avrundat till fem), och om det bygger på projektets egna körningar. */
export function estimateMinutes(job: Pick<GeoJobView, "jobId" | "clip" | "tiles">, jobs: readonly GeoJobView[]): { minutes: number; basis: "history" | "guess" } {
  const rates = jobs.flatMap(row => {
    if (row.jobId === job.jobId || row.kind !== "PULLAUTIN" || row.status !== "DONE" || !row.finishedAt || isSample(row, jobs)) return [];
    const minutes = (Date.parse(row.finishedAt) - Date.parse(row.createdAt)) / 60_000, km2 = jobKm2(row);
    return minutes > 0 && km2 > 0 ? [minutes / km2] : [];
  }).sort((a, b) => a - b);
  const km2 = jobKm2(job);
  const raw = rates.length ? rates[Math.floor(rates.length / 2)]! * km2 : GUESS_START_MINUTES + GUESS_MINUTES_PER_KM2 * km2;
  return { minutes: Math.max(5, Math.round(raw / 5) * 5), basis: rates.length ? "history" : "guess" };
}
