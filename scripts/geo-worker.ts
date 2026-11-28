/**
 * ADR-0219 K5 / Etapp G4B: geo-arbetaren. Körs på en egen geo-server (`deploy/geo.Dockerfile`) med både O-Tids egen
 * MIT-Rust-motor (`tools/otidgeo`) och oförändrad bildmotorfri Karttapullautin (`v2.15.4`). Talar bara HTTPS med O-Tid:
 * hämtar nästa jobb och laserfilerna (servern hämtar dem hos Lantmäteriet med kontots uppgifter, som aldrig lämnar servern),
 * kör vald motor + delad Rust-rastermotor (`otidgeo rasters`, med automatisk JS-fallback) och skickar tillbaka resultatet.
 *
 * Bara Nodes egna moduler, så att filen kan köras direkt (`node geo-worker.ts`, typerna tas bort av Node).
 *
 * Miljön:
 *   OTID_GEO_ORIGIN            O-Tids adress, t.ex. https://otid.example.se
 *   OTID_GEO_WORKER_TOKEN      geo-arbetarens nyckel (samma som på servern)
 *   OTID_GEO_WORKER_NAME       namnet i loggen (förval datorns namn)
 *   OTID_OTIDGEO               O-Tids egen MIT-Rust-motor (tools/otidgeo, förval /opt/otidgeo/otidgeo)
 *   OTID_PULLAUTA              Karttapullautin (förval /opt/pullauta/pullauta)
 *   OTID_PULLAUTA_INI          grundinställningarna (förval /opt/pullauta/pullauta.default.ini)
 *   OTID_LASCLIP               klipper laserfiler till en ruta (tools/lasclip, förval /opt/lasclip/lasclip)
 *   OTID_DWGREAD               LibreDWG:s dwgread för DWG-jobben (förval /opt/libredwg/bin/dwgread)
 *   OTID_CWEBP                 cwebp, som gör bilderna att titta på till WebP (förval cwebp; finns den inte skickas PNG)
 *   OTID_GEO_WORKDIR           arbetskatalogen (förval /tmp/otid-geo); rensas efter varje jobb
 *   OTID_GEO_ONCE=1            ett jobb (eller tom kö) och sedan slut (testerna)
 *   OTID_GEO_EXIT_IDLE_MIN     sluta efter så många minuter utan jobb (0 = aldrig)
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { cpus, hostname, totalmem } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { clearLeftovers, fromCache, toCache } from "./geo-cache.ts";
import { DEFAULT_CLIFF_RULES } from "./geo-cliffs.ts";
import { buildingLayer, featuresGeoJson, gpkgBytes, landCoverLayer, parcelLayer, readGpkgFeatures, type Geometry } from "./geo-gpkg.ts";
import type { Box } from "./geo-merge.ts";
import { moistureDxf } from "./geo-moisture.ts";
import {
  copyPresent, hasExecutable, listLaserInputs, otidgeoRastersArgs, otidgeoRunArgs, otidgeoVegArgs, pullautinPlan,
  resolveEngine, summaryFromRasters, vegetationFromClassPng, type GeoEngine, type RastersSummary
} from "./geo-otidgeo.ts";
import { pavedFromPoints } from "./geo-paved.ts";
import type { PointStats } from "./geo-points.ts";
import { saveRawLaser } from "./geo-raw-zip.ts";
import { slimDxf } from "./geo-slim.ts";
import { waterFromGrids } from "./geo-water.ts";
import {
  readPngSize, runDwgJobHelper, runJsRastersFallback, runMergeJobHelper, runPool,
  streamMergePointFiles, streamMergeWaterFiles, type HelperDeps
} from "./geo-worker-helpers.ts";

interface Job {
  readonly jobId: string; readonly kind: "PULLAUTIN" | "DWG"; readonly attempt: number;
  readonly engine?: GeoEngine | null;
  readonly tiles: readonly { readonly index: number; readonly id: string; readonly epsg: number | null }[];
  readonly settings: Readonly<Record<string, number>>;
  readonly clip?: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } | null;
  readonly reach?: Job["clip"];
  readonly extras?: readonly { readonly index: number; readonly kind: "LAND_COVER" | "BUILDINGS" | "PARCELS" }[];
  readonly cliffs?: { readonly minDrop: number; readonly impassableDrop: number; readonly impassableLength?: number; readonly tags?: boolean; readonly rawTicks?: boolean } | null;
  readonly moisture?: { readonly channelHa: number; readonly wetMeters: number; readonly moistMeters: number } | null;
  readonly vegetation?: { readonly minAreaM2: number } | null;
  readonly stage?: boolean;
  readonly rawLaser?: boolean;
  readonly merge?: { readonly stages: readonly { readonly jobId: string; readonly clip: Box; readonly outputs: readonly string[] }[] } | null;
}

const env = process.env;
const reachOf = (job: Job) => job.reach ?? job.clip;
const CACHE_DIR = env.OTID_GEO_CACHE_DIR ?? "/tmp/otid-laserrutor";
const origin = (env.OTID_GEO_ORIGIN ?? "").replace(/\/$/, "");
const token = env.OTID_GEO_WORKER_TOKEN ?? "";
const workerName = (env.OTID_GEO_WORKER_NAME || hostname()).replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 80) || "geo";
const otidgeo = env.OTID_OTIDGEO || "/opt/otidgeo/otidgeo";
const pullauta = env.OTID_PULLAUTA || "/opt/pullauta/pullauta";
const defaultIni = env.OTID_PULLAUTA_INI || "/opt/pullauta/pullauta.default.ini";
const lasclip = env.OTID_LASCLIP || "/opt/lasclip/lasclip";
const dwgread = env.OTID_DWGREAD || "/opt/libredwg/bin/dwgread";
const cwebp = env.OTID_CWEBP || "cwebp";
const workdir = env.OTID_GEO_WORKDIR || "/tmp/otid-geo";
const once = env.OTID_GEO_ONCE === "1";
const exitIdleMs = Math.max(0, Number(env.OTID_GEO_EXIT_IDLE_MIN ?? 0)) * 60_000;
const UPLOAD_CONCURRENCY = 4;
const VECTOR_OUTPUTS: readonly (readonly [string, string])[] = [
  ["kurvor.dxf", "merged_contours.dxf"], ["formlinjer.dxf", "merged_formlines.dxf"], ["branter.dxf", "merged_c2g.dxf"],
  ["stup.dxf", "merged_c3g.dxf"], ["knollar.dxf", "merged_dotknolls.dxf"]
];
const OTIDGEO_VECTOR_OUTPUTS: readonly string[] = ["kurvor.dxf", "formlinjer.dxf", "knollar.dxf"];
/** O-Tids egna DXF-filer (redan förenklade ≥ 0,75 m och avrundade till centimeter av `moistureDxf`). */
const OWN_DXF_OUTPUTS: ReadonlySet<string> = new Set([
  "fukt.dxf", "vegetation.dxf", "brantlinjer.dxf", "diken.dxf", "spar.dxf", "berg.dxf", "belagt.dxf"
]);

class Stopped extends Error {}

/** Minnet (GB) som jobbet behöver efter områdets yta; samma regel som geoJobMemoryGb i packages/contracts (ett test håller dem lika). */
export function jobMemoryGb(job: { readonly clip?: Job["clip"]; readonly tiles: readonly unknown[] }): number {
  const areaKm2 = job.clip ? Math.max(0, job.clip.maxX - job.clip.minX) * Math.max(0, job.clip.maxY - job.clip.minY) / 1e6 : job.tiles.length * 6.25;
  return areaKm2 <= 8 ? 4 : areaKm2 <= 45 ? 8 : 16;
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Mäter väggklockstid (ms) per fas och högsta observerade RSS (MB) under ett geo-jobb. */
export function createJobTelemetry(now = () => Date.now(), rssBytes = () => process.memoryUsage().rss) {
  const started = now(), phases: Record<string, number> = {};
  let peakRssMb = Math.round(rssBytes() / 1e6), active: { key: string; at: number } | undefined;
  const sample = () => { const mb = Math.round(rssBytes() / 1e6); if (mb > peakRssMb) peakRssMb = mb; return mb; };
  const phase = (next?: string) => {
    const t = now();
    if (active) phases[active.key] = (phases[active.key] ?? 0) + Math.max(0, Math.round(t - active.at));
    active = next ? { key: next, at: t } : undefined; sample();
  };
  return { sample, phase, summary: (): Record<string, number> => { phase(); return { ...phases, msTotal: Math.max(0, Math.round(now() - started)), peakRssMb }; } };
}

export const RAW_TICK_OUTPUTS: ReadonlySet<string> = new Set(["branter.dxf", "stup.dxf"]);
export function keepsRawTicks(job: { readonly cliffs?: { readonly rawTicks?: boolean } | null | undefined }, hasCliffLines: boolean): boolean {
  return job.cliffs?.rawTicks === true || !hasCliffLines;
}
/** Skalanpassade förval för brantklassning i geo-arbetaren (synkade med `cliff-choice.ts`). */
export const FOREST_CLIFF_RULES = { ...DEFAULT_CLIFF_RULES, minDrop: 2.0, minSlope: 39, impassableDrop3: 4.1, impassableDrop6: 4.1, impassableLength: 16, impassableSlope: 41, minSharpness: 0.56 } as const;
export const SPRINT_CLIFF_RULES = { ...DEFAULT_CLIFF_RULES, minDrop: 1.2, impassableDrop3: 3.4, impassableDrop6: 3.4, impassableLength: 10, impassableSlope: 40, minSharpness: 0.58 } as const;
export function isSprintJob(job: { readonly settings: Readonly<Record<string, number>> }): boolean {
  return (job.settings.contour_interval ?? 5) <= 3 || job.settings.paved === 1;
}
export function cliffRulesForJob(job: { readonly settings: Readonly<Record<string, number>>; readonly cliffs?: Job["cliffs"] }) {
  const base = isSprintJob(job) ? SPRINT_CLIFF_RULES : FOREST_CLIFF_RULES;
  if (!job.cliffs) return base;
  return {
    ...base,
    minDrop: job.cliffs.minDrop,
    impassableDrop3: job.cliffs.impassableDrop,
    impassableDrop6: job.cliffs.impassableDrop * base.impassableDrop6 / base.impassableDrop3,
    impassableLength: job.cliffs.impassableLength ?? base.impassableLength
  };
}
/** Arbetarens version (samma som `GEO_WORKER_VERSION` i contracts; servern ger inga jobb till en äldre). */
export const WORKER_VERSION = 46;

async function sendFailure(name: string, response: Response): Promise<string> {
  const error = (await response.json().catch(() => undefined) as { error?: string } | undefined)?.error;
  if (error === "STORAGE_QUOTA_EXCEEDED") return `${name} fick inte plats: kontots lagring för kartfiler är full. Ta bort äldre körningar eller höj OTID_MAP_QUOTA_ACCOUNT_MB på servern`;
  if (error === "MAP_FILE_TOO_LARGE") return `${name} är för stor för att sparas`;
  return `${name} kunde inte skickas (${response.status})`;
}
const OUTPUT_MAX_BYTES = 100 * 1024 * 1024;
const headers = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, "x-otid-geo-worker": workerName,
  "x-otid-geo-version": String(WORKER_VERSION), ...extra });

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${origin}${path}`, { ...init, headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) },
    signal: init.signal ?? AbortSignal.timeout(60_000) });
}

export function parallelTiles(tiles: number, cores: number, memoryGb: number, attempt = 1): number {
  if (attempt > 1) return 1;
  return Math.max(1, Math.min(tiles, cores, Math.floor((memoryGb * 0.85 - 2) / 1.5)));
}

/**
 * Grundinställningarna med jobbets ändringar och det som geo-arbetaren kräver (`outputDxf`: 0 i batch, 1 inför dxfmerge;
 * `contoursOnly`: `contoursonly=1` i bildmotorfri Karttapullautin; `formline === 3` mappas till `formline=2` + `formlinesteepness=0.25`).
 */
export function iniWith(
  base: string, settings: Readonly<Record<string, number>>, keepTemp = false, vegetationClasses = false,
  processes = 1, outputDxf = true, contoursOnly = false
): string {
  const OWN = new Set([
    "greenscale", "openshare", "denseshare", "knollshare", "rock", "paved",
    "smooth_m", "taubin", "min_loop_area", "min_clearance", "formline_gap", "formline_max_slope", "veg_smooth", "overview"
  ]);
  const greenscale = settings.greenscale;
  const pullautin: Record<string, number> = Object.fromEntries(Object.entries(settings).filter(([key]) => !OWN.has(key)));
  if (pullautin.formline === 3) {
    pullautin.formline = 2;
    if (pullautin.formlinesteepness === undefined) pullautin.formlinesteepness = 0.25;
  }
  const shades = greenscale && greenscale !== 1 ? /^\s*greenshades\s*=\s*([^\r\n#]+)/m.exec(base)?.[1]?.split("|").map(Number) : undefined;
  const fixed: Record<string, string | number> = {
    ...pullautin,
    ...(shades?.every(Number.isFinite) ? { greenshades: shades.map(value => value >= 99 ? value : Math.round(value * greenscale! * 1000) / 1000).join("|") } : {}),
    batch: 1, processes, lazfolder: "./in", batchoutfolder: "./out", savetempfiles: 1,
    savetempfolders: keepTemp ? 1 : 0, output_dxf: outputDxf ? 1 : 0,
    ...(vegetationClasses ? { vege_bitmode: 1 } : {}),
    ...(contoursOnly ? { contoursonly: 1 } : {})
  };
  const seen = new Set<string>();
  const lines = base.split(/\r?\n/).map(line => {
    const match = /^\s*([A-Za-z0-9_]+)\s*=/.exec(line);
    if (!match || !(match[1]! in fixed)) return line;
    seen.add(match[1]!);
    return `${match[1]}=${fixed[match[1]!]}`;
  });
  for (const [key, value] of Object.entries(fixed)) if (!seen.has(key)) lines.push(`${key}=${value}`);
  return lines.join("\n");
}

/** PNG:ens mått ur filhuvudet. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Miljön för programmen som tolkar opålitliga filer (otidgeo, pullauta, lasclip, cwebp, dwgread): utan arbetarens nyckel och hemligheter. */
export function childEnvironment(source: NodeJS.ProcessEnv = env): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = { ...source, RUST_LOG: "warn" };
  for (const key of Object.keys(clean)) if (/^OTID_.*(TOKEN|SECRET|PASSWORD|KEY)/.test(key)) delete clean[key];
  return clean;
}

const pullautaTimeoutMs = Math.max(1, Number(env.OTID_GEO_PULLAUTA_TIMEOUT_MIN) || 360) * 60_000;

function run(args: readonly string[], cwd: string, signal: AbortSignal, program = pullauta): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, stdio: ["ignore", "ignore", "pipe"], env: childEnvironment() });
    let tail = "";
    child.stderr.on("data", (chunk: Buffer) => { tail = (tail + chunk.toString("utf8")).slice(-1500); });
    const abort = () => child.kill("SIGKILL");
    signal.addEventListener("abort", abort, { once: true });
    child.on("error", reject);
    child.on("close", code => {
      signal.removeEventListener("abort", abort);
      const label = program === otidgeo ? "otidgeo" : program === pullauta ? "Karttapullautin" : program === lasclip ? "lasclip" : program === cwebp ? "cwebp" : "dwgread";
      if (signal.aborted) {
        if ((signal.reason as { name?: string } | undefined)?.name === "TimeoutError") reject(new Error(`${label} avbröts efter tidsgränsen`));
        else reject(new Stopped());
      } else if (code === 0) resolve();
      else reject(new Error(`${label} avslutades med kod ${code}: ${tail.trim().split("\n").slice(-3).join(" ")}`));
    });
  });
}

export const WEBP_OUTPUTS: ReadonlySet<string> = new Set(["karta.png", "skuggning.png", "relief.png"]);
const WEBP_MAX_SIDE = 16_383;

async function toWebp(dir: string, source: string, signal: AbortSignal): Promise<string | undefined> {
  const size = await readPngSize(join(dir, source), pngSize);
  if (!size || size.width > WEBP_MAX_SIDE || size.height > WEBP_MAX_SIDE) return undefined;
  const target = source.replace(/\.png$/, ".webp");
  try {
    await run(["-quiet", "-q", "80", "-alpha_q", "100", "-m", "4", source, "-o", target], dir, AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]), cwebp);
    const bytes = (await stat(join(dir, target))).size;
    return bytes > 0 && bytes < (await stat(join(dir, source))).size ? target : undefined;
  } catch (error) {
    if (signal.aborted) throw new Stopped();
    console.error(`${source} blev inte WebP: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function appendGeoJson(path: string, text: string): Promise<void> {
  const before = await readFile(path, "utf8").then(old => JSON.parse(old) as { features: unknown[] }).catch(() => undefined);
  if (!before) { await writeFile(path, text); return; }
  const added = JSON.parse(text) as { features: unknown[] };
  await writeFile(path, JSON.stringify({ type: "FeatureCollection", features: [...before.features, ...added.features] }));
}

const helperDeps: HelperDeps = {
  workdir, dwgread, workerVersion: WORKER_VERSION, outputMaxBytes: OUTPUT_MAX_BYTES,
  webpOutputs: WEBP_OUTPUTS, rawTickOutputs: RAW_TICK_OUTPUTS,
  call, run, toWebp, sendFailure, jobMemoryGb, keepsRawTicks, createTelemetry: createJobTelemetry,
  isStopped: error => error instanceof Stopped, createStopped: () => new Stopped(),
};

async function runJob(job: Job): Promise<void> {
  const dir = join(workdir, job.jobId), telemetry = createJobTelemetry(), engine = resolveEngine(job.engine);
  const hasOtidgeo = await hasExecutable(otidgeo);
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, "in"), { recursive: true });
  const control = new AbortController();
  let progress = { step: "Hämtar laserdata", done: 0, total: job.tiles.length };
  const beat = async () => {
    const response = await call(`/api/geo-worker/jobs/${job.jobId}/heartbeat`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(progress) }).catch(() => undefined);
    const body = response?.ok ? await response.json().catch(() => undefined) as { action?: string } | undefined : undefined;
    if (body?.action === "stop") control.abort();
    console.log(`${job.jobId.slice(0, 8)} ${progress.step} ${progress.done}/${progress.total} ${telemetry.sample()} MB`);
  };
  const timer = setInterval(() => void beat(), 60_000);
  const set = async (step: string, done: number, total: number) => { progress = { step, done, total }; await beat(); if (control.signal.aborted) throw new Stopped(); };
  try {
    const needGb = jobMemoryGb(job), haveGb = totalmem() / 2 ** 30;
    if (haveGb < needGb * 0.85) {
      throw new Error(`Området är för stort för geo-servern som är igång (${Math.round(haveGb)} GB minne, området behöver ${needGb} GB). `
        + "Kör om jobbet om en halvtimme, när servern har stängts av, eller dela området i etapper.");
    }
    if (engine === "otidgeo" && !hasOtidgeo) throw new Error(`otidgeo-motorn saknas eller är inte körbar (${otidgeo})`);
    telemetry.phase("msFetchClip"); await set("Hämtar laserdata", 0, job.tiles.length);
    const together = parallelTiles(job.tiles.length, cpus().length, totalmem() / 2 ** 30, job.attempt);
    let fetched = 0;
    await runPool(job.tiles, together, async tile => {
      const stem = `ruta${String(tile.index).padStart(2, "0")}`;
      const file = `${stem}.laz`, target = join(dir, job.clip ? file : join("in", file));
      if (!await fromCache(CACHE_DIR, tile.id, target)) {
        const response = await call(`/api/geo-worker/jobs/${job.jobId}/laser/${tile.index}`, { signal: AbortSignal.any([control.signal, AbortSignal.timeout(20 * 60_000)]) });
        if (!response.ok || !response.body) {
          const detail = await response.json().catch(() => undefined) as { error?: string; detail?: string } | undefined;
          throw new Error(`Laserrutan ${tile.id} kunde inte hämtas (${detail?.error ?? response.status}${detail?.detail ? `, ${detail.detail}` : ""})`);
        }
        await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(target));
        await toCache(CACHE_DIR, tile.id, target);
      }
      if (job.clip) {
        // Okomprimerad .las mellan lasclip och motorn när rå laserdata inte sparas (3× snabbare); behåll .laz vid rawLaser.
        const clipped = `${stem}.${job.rawLaser ? "laz" : "las"}`;
        await run([file, join("in", clipped), ...[reachOf(job)!.minX, reachOf(job)!.minY, reachOf(job)!.maxX, reachOf(job)!.maxY].map(String),
          `vatten${tile.index}.bin`, `mark${tile.index}.bin`, `punkter${tile.index}.bin`], dir,
          AbortSignal.any([control.signal, AbortSignal.timeout(20 * 60_000)]), lasclip);
        await rm(join(dir, file), { force: true });
      }
      fetched += 1;
      await set("Hämtar laserdata", fetched, job.tiles.length);
    });
    const laserInputs = await listLaserInputs(dir);
    if (job.clip && laserInputs.length === 0) throw new Error("Kartans område ligger utanför laserrutorna");
    if (job.rawLaser) {
      telemetry.phase("msRawLaser"); await set("Sparar rå laserdata", 0, 1);
      await saveRawLaser({ jobId: job.jobId, tiles: job.tiles, clip: job.clip ?? null, reach: reachOf(job) ?? null }, join(dir, "in"), call, control.signal)
        .catch(error => { if (control.signal.aborted) throw new Stopped(); throw error; });
    }

    let otidgeoVegReady = false;
    if (engine === "otidgeo") {
      // Läge A: egen MIT-Rust-motor (0 Karttapullautin, 0 rutskarvar).
      telemetry.phase("msOtidgeo"); await set("Räknar kurvor och vegetation", 0, 1);
      await run(otidgeoRunArgs(laserInputs, "out-otidgeo", { settings: job.settings, clip: reachOf(job), vegetation: job.vegetation }),
        dir, AbortSignal.any([control.signal, AbortSignal.timeout(pullautaTimeoutMs)]), otidgeo);
      const copied = await copyPresent(join(dir, "out-otidgeo"), dir, [
        "kurvor.dxf", "formlinjer.dxf", "knollar.dxf", "vegetationsklasser.png", "vegetationsklasser.pgw", "karta.png", "karta.pgw"
      ]);
      otidgeoVegReady = copied.includes("vegetationsklasser.png") && copied.includes("vegetationsklasser.pgw");
      telemetry.phase();
    } else {
      // Läge B: bildmotorfri Karttapullautin (contoursonly=1 + tvåstegs output_dxf, 0 pngmerge; otidgeo veg för vegetation).
      const baseIni = await readFile(defaultIni, "utf8");
      const keepTemp = !!job.moisture && !job.clip;
      const plan = pullautinPlan(job, hasOtidgeo);
      telemetry.phase("msPullauta");
      await writeFile(join(dir, "pullauta.ini"), iniWith(baseIni, job.settings, keepTemp, plan.kpVegeBitmode, together, false, plan.contoursOnly));
      await set("Karttapullautin", 0, 1);
      await run([], dir, AbortSignal.any([control.signal, AbortSignal.timeout(pullautaTimeoutMs)]));
      telemetry.phase("msDxfMerge");
      await writeFile(join(dir, "pullauta.ini"), iniWith(baseIni, job.settings, keepTemp, plan.kpVegeBitmode, together, true, plan.contoursOnly));
      await run(["dxfmerge"], dir, AbortSignal.any([control.signal, AbortSignal.timeout(60 * 60_000)]));
      telemetry.phase();
      if (plan.useOtidgeoVeg) {
        telemetry.phase("msOtidgeoVeg"); await set("Räknar vegetationen", 0, 1);
        await run(otidgeoVegArgs(laserInputs, "out-veg", { settings: job.settings, clip: reachOf(job), vegetation: job.vegetation }, true),
          dir, AbortSignal.any([control.signal, AbortSignal.timeout(pullautaTimeoutMs)]), otidgeo);
        const copied = await copyPresent(join(dir, "out-veg"), dir, ["vegetationsklasser.png", "vegetationsklasser.pgw"]);
        otidgeoVegReady = copied.includes("vegetationsklasser.png") && copied.includes("vegetationsklasser.pgw");
        telemetry.phase();
      }
    }

    const dirNames = await readdir(dir);
    const groundFiles = dirNames.filter(name => /^mark\d+\.bin$/.test(name)).sort();
    const waterFiles = dirNames.filter(name => /^vatten\d+\.bin$/.test(name)).sort();
    const pointFiles = dirNames.filter(name => /^punkter\d+\.bin$/.test(name)).sort();
    const rules = cliffRulesForJob(job);
    const rockMode = job.settings.rock ?? 1;

    let cliffSummary: Record<string, number> = {}, moistureSummary: Record<string, number> = {};
    let vegetationSummary: Record<string, number> = {}, ditchSummary: Record<string, number> = {}, rockSummary: Record<string, number> = {};
    let rastersSummary: Record<string, number> = {};
    const stepTimings: Record<string, number> = {}, skippedSteps: string[] = [];
    let water: ReturnType<typeof waterFromGrids> | undefined, pointStats: PointStats | undefined;
    let rustRastersDone = false;

    // Delad multi-trådad Rust-rasteracceleration (`otidgeo rasters`) för båda motorerna; faller automatiskt tillbaka på JS.
    if (hasOtidgeo && groundFiles.length > 0) {
      const present = new Set(dirNames);
      const rasterArgs = otidgeoRastersArgs({
        groundFiles, waterFiles, pointFiles,
        vegPng: job.vegetation && otidgeoVegReady ? "vegetationsklasser.png" : undefined,
        outDir: ".", heightRasters: true, pointImages: pointFiles.length > 0, waterGeoJson: waterFiles.length > 0,
        moisture: job.moisture ?? undefined,
        cliffs: {
          minDrop: rules.minDrop, impassableDrop: rules.impassableDrop3, impassableLength: rules.impassableLength,
          tags: job.cliffs?.tags === true,
          c3g: present.has("merged_c3g.dxf") ? "merged_c3g.dxf" : undefined,
          c2g: present.has("merged_c2g.dxf") ? "merged_c2g.dxf" : undefined
        },
        ditchesTracks: true,
        rock: { mode: rockMode, knolls: true, knollShare: job.settings.knollshare }
      });
      try {
        telemetry.phase("msRasters"); await set("Beräknar höjd, fukt och terräng", 0, 1);
        await run(rasterArgs, dir, AbortSignal.any([control.signal, AbortSignal.timeout(pullautaTimeoutMs)]), otidgeo);
        const rawSummary = JSON.parse(await readFile(join(dir, "rasters-summary.json"), "utf8")) as RastersSummary;
        rastersSummary = summaryFromRasters(rawSummary, {
          water: waterFiles.length > 0, moisture: !!job.moisture, cliffs: true, ditchesTracks: true, rock: true
        });
        rustRastersDone = true;
        telemetry.phase();
        for (const file of groundFiles) await rm(join(dir, file), { force: true });
        if (waterFiles.length > 0) {
          if (job.vegetation || job.settings.paved === 1 || (job.clip && job.extras?.some(extra => extra.kind === "LAND_COVER"))) {
            const mergedWater = await streamMergeWaterFiles(dir, waterFiles);
            if (mergedWater) water = waterFromGrids([mergedWater]);
          } else {
            for (const file of waterFiles) await rm(join(dir, file), { force: true });
          }
        }
        if (pointFiles.length > 0) {
          if (job.settings.paved === 1) pointStats = await streamMergePointFiles(dir, pointFiles);
          else for (const file of pointFiles) await rm(join(dir, file), { force: true });
        }
      } catch (error) {
        if (control.signal.aborted || error instanceof Stopped) throw new Stopped();
        telemetry.phase();
        console.error(`otidgeo rasters misslyckades, faller tillbaka på JS: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (rustRastersDone) {
      if (job.vegetation && otidgeoVegReady) {
        telemetry.phase("msVegetation"); await set("Räknar vegetationen", 0, 1);
        const veg = vegetationFromClassPng(
          new Uint8Array(await readFile(join(dir, "vegetationsklasser.png"))),
          await readFile(join(dir, "vegetationsklasser.pgw"), "utf8"),
          { vegSmooth: job.settings.veg_smooth, scale: isSprintJob(job) ? 4_000 : 15_000 }, water?.at
        );
        await writeFile(join(dir, "vegetation.dxf"), veg.dxf);
        vegetationSummary = veg.summary;
        telemetry.phase();
      }
    } else {
      const fb = await runJsRastersFallback({
        dir, groundFiles, waterFiles, pointFiles, otidgeoVegReady, rules, rockMode, job,
        signal: control.signal, telemetry, set, createStopped: () => new Stopped()
      });
      water = fb.water; pointStats = fb.pointStats; cliffSummary = fb.cliffSummary;
      moistureSummary = fb.moistureSummary; vegetationSummary = fb.vegetationSummary;
      ditchSummary = fb.ditchSummary; rockSummary = fb.rockSummary;
      Object.assign(stepTimings, fb.stepTimings); skippedSteps.push(...fb.skippedSteps);
    }

    const extraSummary: Record<string, number | string> = {};
    if (job.clip && job.extras?.length) telemetry.phase("msExtras");
    for (const extra of job.clip ? job.extras ?? [] : []) {
      const land = extra.kind === "LAND_COVER", label = land ? "marktacke" : extra.kind === "PARCELS" ? "fastigheter" : "byggnader";
      await set(land ? "Läser marktäcket" : extra.kind === "PARCELS" ? "Läser fastighetsindelningen" : "Läser byggnaderna", 0, 1);
      const response = await call(`/api/geo-worker/jobs/${job.jobId}/laser/x${extra.index}`, { signal: AbortSignal.any([control.signal, AbortSignal.timeout(20 * 60_000)]) });
      if (!response.ok) {
        const detail = await response.json().catch(() => undefined) as { error?: string } | undefined;
        extraSummary[label] = String(detail?.error ?? response.status).slice(0, 60);
        continue;
      }
      try {
        const found = gpkgBytes(new Uint8Array(await response.arrayBuffer()));
        if (!found) { extraSummary[label] = "ingen GeoPackage"; continue; }
        const path = join(dir, `${label}-${extra.index}.gpkg`);
        await writeFile(path, found);
        const features = await readGpkgFeatures(path, reachOf(job)!);
        await rm(path, { force: true });
        const inLaserWater = (geometry: Geometry) => {
          if (!water || geometry.kind !== "area") return false;
          const ring = geometry.rings[0] ?? [];
          return ring.length > 0 && ring.filter(([x, y]) => [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]].some(([ax, ay]) => water.at(x + ax!, y + ay!))).length * 2 > ring.length;
        };
        const result = featuresGeoJson(features, land ? landCoverLayer : extra.kind === "PARCELS" ? parcelLayer : buildingLayer,
          (layer, geometry) => !(layer === "vatten" && inLaserWater(geometry)));
        if (result.total > 0) await appendGeoJson(join(dir, `${label}.geojson`), result.geojson);
        extraSummary[label] = Number(extraSummary[label] ?? 0) + result.total;
      } catch (error) { extraSummary[label] = (error instanceof Error ? error.message : "fel").slice(0, 60); }
    }
    telemetry.phase();

    let pavedSummary: Record<string, number> = {};
    if (job.settings.paved === 1 && pointStats) {
      telemetry.phase("msPaved"); await set("Letar belagd yta", 0, 1);
      const paved = pavedFromPoints(pointStats, water?.at);
      if (paved.rings.length) await writeFile(join(dir, "belagt.dxf"), moistureDxf([{ name: "belagd_yta_laser", closed: true, parts: paved.rings }]));
      pavedSummary = { pavedHa: paved.pavedHa, ...(paved.limit !== undefined ? { pavedLimit: paved.limit } : {}) };
      telemetry.phase();
    }

    telemetry.phase("msUpload"); const files = new Set(await readdir(dir));
    const kartaUploads: (readonly [string, string, string])[] = files.has("karta.png") && files.has("karta.pgw")
      ? [["karta.png", "karta.png", "image/png"], ["karta.pgw", "karta.pgw", "text/plain"]]
      : files.has("merged.png") && files.has("merged.pgw")
        ? [["karta.png", "merged.png", "image/png"], ["karta.pgw", "merged.pgw", "text/plain"]]
        : [];
    const vectorUploads: (readonly [string, string, string])[] = engine === "otidgeo"
      ? OTIDGEO_VECTOR_OUTPUTS.filter(name => files.has(name)).map(name => [name, name, "application/dxf"] as const)
      : VECTOR_OUTPUTS.filter(([name, source]) => files.has(source) && (!RAW_TICK_OUTPUTS.has(name) || keepsRawTicks(job, files.has("brantlinjer.dxf"))))
          .map(([name, source]) => [name, source, "application/dxf"] as const);
    const uploads: (readonly [string, string, string])[] = [
      ...kartaUploads, ...vectorUploads,
      ...(job.moisture && files.has("fukt.png") ? [
        ["fukt.png", "fukt.png", "image/png"], ["fukt.pgw", "fukt.pgw", "text/plain"],
        ...(files.has("fukt.dxf") ? [["fukt.dxf", "fukt.dxf", "application/dxf"]] as const : []),
        ["fuktdjup.png", "fuktdjup.png", "image/png"],
        ["fuktdjup.pgw", files.has("fuktdjup.pgw") ? "fuktdjup.pgw" : "fukt.pgw", "text/plain"]
      ] as const : []),
      ...(job.vegetation && files.has("vegetationsklasser.png") ? [
        ...(files.has("vegetation.dxf") ? [["vegetation.dxf", "vegetation.dxf", "application/dxf"]] as const : []),
        ["vegetationsklasser.png", "vegetationsklasser.png", "image/png"], ["vegetationsklasser.pgw", "vegetationsklasser.pgw", "text/plain"]
      ] as const : []),
      ...(files.has("skuggning.png") ? [["skuggning.png", "skuggning.png", "image/png"], ["skuggning.pgw", "skuggning.pgw", "text/plain"]] as const : []),
      ...(files.has("hojd.png") ? [["hojd.png", "hojd.png", "image/png"], ["hojd.pgw", "hojd.pgw", "text/plain"]] as const : []),
      ...["lasveg", "lasmark", "laskron"].filter(name => files.has(`${name}.png`)).flatMap(name => [[`${name}.png`, `${name}.png`, "image/png"], [`${name}.pgw`, `${name}.pgw`, "text/plain"]] as const),
      ...(files.has("brantlinjer.dxf") ? [["brantlinjer.dxf", "brantlinjer.dxf", "application/dxf"]] as const : []),
      ...(files.has("relief.png") ? [["relief.png", "relief.png", "image/png"], ["relief.pgw", "relief.pgw", "text/plain"]] as const : []),
      ...(files.has("diken.dxf") ? [["diken.dxf", "diken.dxf", "application/dxf"]] as const : []),
      ...(files.has("spar.dxf") ? [["spar.dxf", "spar.dxf", "application/dxf"]] as const : []),
      ...(files.has("berg.dxf") ? [["berg.dxf", "berg.dxf", "application/dxf"]] as const : []),
      ...(files.has("berg.png") ? [["berg.png", "berg.png", "image/png"], ["berg.pgw", "berg.pgw", "text/plain"]] as const : []),
      ...(files.has("belagt.dxf") ? [["belagt.dxf", "belagt.dxf", "application/dxf"]] as const : []),
      ...["marktacke.geojson", "byggnader.geojson", "fastigheter.geojson", "kullar.geojson", "brantlinjer.geojson"].filter(name => files.has(name)).map(name => [name, name, "application/geo+json"] as const),
      ...(files.has("vatten.geojson") ? [["vatten.geojson", "vatten.geojson", "application/geo+json"]] as const : [])
    ];
    await set("Skickar resultatet", 0, uploads.length);
    let done = 0, lastBeatAt = Date.now();
    const skippedOutputs: string[] = [];
    await runPool(uploads, UPLOAD_CONCURRENCY, async ([pngName, pngSource, pngType]) => {
      if (control.signal.aborted) throw new Stopped();
      if (!files.has(pngSource)) throw new Error(`${engine === "otidgeo" ? "otidgeo" : "Karttapullautin"} gav ingen ${pngSource}`);
      const webp = !job.stage && WEBP_OUTPUTS.has(pngName) ? await toWebp(dir, pngSource, control.signal) : undefined;
      const needsSlim = pngType === "application/dxf" && !OWN_DXF_OUTPUTS.has(pngName) && engine !== "otidgeo";
      if (needsSlim) await writeFile(join(dir, `${pngSource}.slim`), slimDxf(await readFile(join(dir, pngSource), "utf8")));
      const put = async (name: string, given: string, mediaType: string): Promise<Response | "skipped"> => {
        const source = needsSlim ? `${given}.slim` : given;
        if ((await stat(join(dir, source))).size > OUTPUT_MAX_BYTES && !name.startsWith("karta.")) return "skipped";
        const bytes = await readFile(join(dir, source));
        return call(`/api/geo-worker/jobs/${job.jobId}/outputs/${name}`, { method: "PUT", body: new Uint8Array(bytes),
          headers: { "content-type": mediaType, "content-length": String(bytes.byteLength) }, signal: AbortSignal.any([control.signal, AbortSignal.timeout(10 * 60_000)]) });
      };
      let name: string = pngName, response = webp ? await put(pngName.replace(/\.png$/, ".webp"), webp, "image/webp") : undefined;
      if (response === undefined || (response !== "skipped" && response.status === 400)) response = await put(pngName, pngSource, pngType);
      else name = pngName.replace(/\.png$/, ".webp");
      if (response === "skipped") skippedOutputs.push(name);
      else if (!response.ok) throw new Error(await sendFailure(name, response));
      done += 1;
      progress = { step: "Skickar resultatet", done, total: uploads.length };
      if (Date.now() - lastBeatAt >= 5_000) { lastBeatAt = Date.now(); void beat(); }
    });
    if (control.signal.aborted) throw new Stopped();
    const finished = await call(`/api/geo-worker/jobs/${job.jobId}/finish`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "DONE", summary: { worker: WORKER_VERSION, engine, tiles: job.tiles.length, memoryMb: telemetry.sample(), serverMemoryMb: Math.round(totalmem() / 1e6), cores: cpus().length, parallelTiles: together, ...telemetry.summary(), ...rastersSummary, ...stepTimings, ...(skippedOutputs.length ? { skippedOutputs: skippedOutputs.length } : {}), ...(skippedSteps.length ? { skippedSteps: skippedSteps.join(",") } : {}), ...(!rustRastersDone && water ? { waterHa: water.summary.waterHa } : {}), ...cliffSummary, ...extraSummary, ...moistureSummary, ...ditchSummary, ...vegetationSummary, ...rockSummary, ...pavedSummary } }) });
    console.log(`Geo-jobb ${job.jobId}: klart (${job.tiles.length} rutor, motor ${engine}, svar ${finished.status})`);
  } finally {
    clearInterval(timer);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function fail(job: Job, error: unknown): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1900) || "Okänt fel";
  console.error(`Geo-jobb ${job.jobId}: ${message}`);
  await call(`/api/geo-worker/jobs/${job.jobId}/finish`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "FAILED", error: message }) }).catch(() => undefined);
}

async function main(): Promise<void> {
  if (!origin || token.length < 32) throw new Error("OTID_GEO_ORIGIN och OTID_GEO_WORKER_TOKEN (minst 32 tecken) krävs");
  console.log(`Geo-arbetaren startad (${workerName}) mot ${origin}`);
  const left = await clearLeftovers(workdir, CACHE_DIR);
  if (left > 0) console.log(`Geo-arbetaren: ${left} kvarlämnade filer och kataloger borttagna (laserdata sparas inte)`);
  let idleSince = Date.now();
  for (;;) {
    let response: Response;
    try { response = await call("/api/geo-worker/claim", { method: "POST" }); }
    catch (error) {
      if (once) throw error;
      console.error("O-Tid svarar inte; försöker igen om 30 s", error instanceof Error ? error.message : error);
      await sleep(30_000);
      continue;
    }
    if (response.status === 401) throw new Error("O-Tid tog inte emot geo-arbetarens nyckel");
    if (response.status === 200) {
      const { job } = await response.json() as { job: Job };
      try { await (job.kind === "DWG" ? runDwgJobHelper(job, helperDeps) : job.merge ? runMergeJobHelper({ ...job, merge: job.merge }, helperDeps) : runJob(job)); }
      catch (error) { if (!(error instanceof Stopped)) await fail(job, error); else console.log(`Geo-jobb ${job.jobId}: avbrutet`); }
      idleSince = Date.now();
      if (once) return;
      continue;
    }
    if (once) return;
    if (exitIdleMs && Date.now() - idleSince > exitIdleMs) { await clearLeftovers(workdir, CACHE_DIR); console.log("Inga jobb; geo-arbetaren slutar"); return; }
    await sleep(15_000);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
