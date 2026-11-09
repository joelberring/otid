/**
 * ADR-0219 K5 (ägaren 2026-11-08): geo-arbetaren. Körs på en egen geo-server (avbildningen deploy/geo.Dockerfile, med
 * Karttapullautin byggt ur källkoden) och talar bara HTTPS med O-Tid: hämtar nästa jobb, laserfilerna (servern hämtar dem hos
 * Lantmäteriet med jobbkontots egna uppgifter, som aldrig lämnar servern), kör Karttapullautin en ruta i taget (4 GB räcker)
 * och skickar tillbaka bilden och kurvorna. Inga portar öppnas på geo-servern.
 *
 * Bara Nodes egna moduler, så att filen kan köras direkt (`node geo-worker.ts`, typerna tas bort av Node).
 *
 * Miljön:
 *   OTID_GEO_ORIGIN            O-Tids adress, t.ex. https://otid.example.se
 *   OTID_GEO_WORKER_TOKEN      geo-arbetarens nyckel (samma som på servern)
 *   OTID_GEO_WORKER_NAME       namnet i loggen (förval datorns namn)
 *   OTID_PULLAUTA              Karttapullautin (förval /opt/pullauta/pullauta)
 *   OTID_PULLAUTA_INI          grundinställningarna (förval /opt/pullauta/pullauta.default.ini)
 *   OTID_GEO_WORKDIR           arbetskatalogen (förval /tmp/otid-geo); rensas efter varje jobb
 *   OTID_GEO_ONCE=1            ett jobb (eller tom kö) och sedan slut (testerna)
 *   OTID_GEO_EXIT_IDLE_MIN     sluta efter så många minuter utan jobb (0 = aldrig)
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { moistureFromHeightMaps, readHeightMap } from "./geo-moisture.ts";

interface Job {
  readonly jobId: string; readonly kind: "PULLAUTIN"; readonly attempt: number;
  readonly tiles: readonly { readonly index: number; readonly id: string; readonly epsg: number | null }[];
  readonly settings: Readonly<Record<string, number>>;
  /** K5c del 2: fuktigheten ur markmodellen (Karttapullautins höjdraster per ruta). */
  readonly moisture?: { readonly channelHa: number; readonly wetMeters: number; readonly moistMeters: number } | null;
}

const env = process.env;
const origin = (env.OTID_GEO_ORIGIN ?? "").replace(/\/$/, "");
const token = env.OTID_GEO_WORKER_TOKEN ?? "";
const workerName = (env.OTID_GEO_WORKER_NAME || hostname()).replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 80) || "geo";
const pullauta = env.OTID_PULLAUTA || "/opt/pullauta/pullauta";
const defaultIni = env.OTID_PULLAUTA_INI || "/opt/pullauta/pullauta.default.ini";
const workdir = env.OTID_GEO_WORKDIR || "/tmp/otid-geo";
const once = env.OTID_GEO_ONCE === "1";
const exitIdleMs = Math.max(0, Number(env.OTID_GEO_EXIT_IDLE_MIN ?? 0)) * 60_000;
/** Största bilden som blir ett underlag (samma som serverns gräns för underlag). */
const LAYER_MAX_BYTES = 40 * 1024 * 1024;
const LAYER_MAX_PIXELS = 30_000;
/** Resultatfilerna: namnet hos O-Tid → Karttapullautins sammanslagna fil. */
const VECTOR_OUTPUTS: readonly (readonly [string, string])[] = [
  ["kurvor.dxf", "merged_contours.dxf"], ["formlinjer.dxf", "merged_formlines.dxf"], ["branter.dxf", "merged_c2g.dxf"],
  ["stup.dxf", "merged_c3g.dxf"], ["knollar.dxf", "merged_dotknolls.dxf"]
];

class Stopped extends Error {}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const headers = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, "x-otid-geo-worker": workerName, ...extra });

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${origin}${path}`, { ...init, headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) },
    signal: init.signal ?? AbortSignal.timeout(60_000) });
}

/** Grundinställningarna med jobbets ändringar och det som geo-arbetaren kräver (en ruta i taget, filerna sparas). */
export function iniWith(base: string, settings: Readonly<Record<string, number>>, keepTemp = false): string {
  const fixed: Record<string, string | number> = { ...settings, batch: 1, processes: 1, lazfolder: "./in", batchoutfolder: "./out", savetempfiles: 1,
    savetempfolders: keepTemp ? 1 : 0, output_dxf: 1 };
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

function run(args: readonly string[], cwd: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(pullauta, args, { cwd, stdio: ["ignore", "ignore", "pipe"], env: { ...env, RUST_LOG: "warn" } });
    let tail = "";
    child.stderr.on("data", (chunk: Buffer) => { tail = (tail + chunk.toString("utf8")).slice(-1500); });
    const abort = () => child.kill("SIGKILL");
    signal.addEventListener("abort", abort, { once: true });
    child.on("error", reject);
    child.on("close", code => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(new Stopped());
      else if (code === 0) resolve();
      else reject(new Error(`Karttapullautin avslutades med kod ${code}: ${tail.trim().split("\n").slice(-3).join(" ")}`));
    });
  });
}

async function runJob(job: Job): Promise<void> {
  const dir = join(workdir, job.jobId);
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, "in"), { recursive: true });
  const control = new AbortController();
  let progress = { step: "Hämtar laserdata", done: 0, total: job.tiles.length };
  const beat = async () => {
    const response = await call(`/api/geo-worker/jobs/${job.jobId}/heartbeat`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(progress) }).catch(() => undefined);
    const body = response?.ok ? await response.json().catch(() => undefined) as { action?: string } | undefined : undefined;
    if (body?.action === "stop") control.abort();
  };
  const timer = setInterval(() => void beat(), 60_000);
  const set = async (step: string, done: number, total: number) => { progress = { step, done, total }; await beat(); if (control.signal.aborted) throw new Stopped(); };
  try {
    await set("Hämtar laserdata", 0, job.tiles.length);
    for (const tile of job.tiles) {
      const response = await call(`/api/geo-worker/jobs/${job.jobId}/laser/${tile.index}`, { signal: AbortSignal.any([control.signal, AbortSignal.timeout(20 * 60_000)]) });
      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => undefined) as { error?: string; detail?: string } | undefined;
        throw new Error(`Laserrutan ${tile.id} kunde inte hämtas (${detail?.error ?? response.status}${detail?.detail ? `, ${detail.detail}` : ""})`);
      }
      await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(join(dir, "in", `ruta${String(tile.index).padStart(2, "0")}.laz`)));
      await set("Hämtar laserdata", tile.index + 1, job.tiles.length);
    }
    await writeFile(join(dir, "pullauta.ini"), iniWith(await readFile(defaultIni, "utf8"), job.settings, !!job.moisture));
    await set("Karttapullautin", 0, 1);
    await run([], dir, control.signal);
    await set("Slår ihop rutorna", 0, 1);
    let scale = job.tiles.length > 4 ? 2 : 1;
    for (;;) {
      await run(["pngmerge", String(scale)], dir, control.signal);
      const head = new Uint8Array(await readFile(join(dir, "merged.png")).then(bytes => bytes.subarray(0, 32)));
      const size = pngSize(head), bytes = (await stat(join(dir, "merged.png"))).size;
      if ((size && Math.max(size.width, size.height) <= LAYER_MAX_PIXELS && bytes <= LAYER_MAX_BYTES) || scale >= 8) break;
      scale *= 2;
    }
    await run(["dxfmerge"], dir, control.signal);
    // K5c del 2: fuktigheten ur rutornas höjdraster (Karttapullautin sparar dem i temp_<ruta>_dir med savetempfolders).
    let moistureSummary: Record<string, number> = {};
    if (job.moisture) {
      await set("Räknar fuktigheten", 0, 1);
      const folders = (await readdir(dir)).filter(name => /^temp_.+_dir$/.test(name)).sort();
      const grids = [];
      for (const folder of folders) {
        const bytes = await readFile(join(dir, folder, "xyz2.hmap")).catch(() => undefined);
        if (bytes) grids.push(readHeightMap(new Uint8Array(bytes)));
      }
      if (grids.length === 0) throw new Error("Karttapullautin gav inget höjdraster för fuktigheten");
      const moisture = moistureFromHeightMaps(grids, job.moisture);
      await writeFile(join(dir, "fukt.png"), moisture.png);
      await writeFile(join(dir, "fukt.pgw"), moisture.world);
      await writeFile(join(dir, "fukt.dxf"), moisture.dxf);
      moistureSummary = { wetHa: moisture.summary.wetHa, moistHa: moisture.summary.moistHa, channels: moisture.summary.channels };
    }
    const files = new Set(await readdir(dir));
    const uploads: (readonly [string, string, string])[] = [["karta.png", "merged.png", "image/png"], ["karta.pgw", "merged.pgw", "text/plain"],
      ...VECTOR_OUTPUTS.filter(([, source]) => files.has(source)).map(([name, source]) => [name, source, "application/dxf"] as const),
      ...(job.moisture ? [["fukt.png", "fukt.png", "image/png"], ["fukt.pgw", "fukt.pgw", "text/plain"], ["fukt.dxf", "fukt.dxf", "application/dxf"]] as const : [])];
    let done = 0;
    for (const [name, source, mediaType] of uploads) {
      await set("Skickar resultatet", done, uploads.length);
      if (!files.has(source)) throw new Error(`Karttapullautin gav ingen ${source}`);
      const bytes = await readFile(join(dir, source));
      const response = await call(`/api/geo-worker/jobs/${job.jobId}/outputs/${name}`, { method: "PUT", body: new Uint8Array(bytes),
        headers: { "content-type": mediaType, "content-length": String(bytes.byteLength) }, signal: AbortSignal.any([control.signal, AbortSignal.timeout(10 * 60_000)]) });
      if (!response.ok) throw new Error(`${name} kunde inte skickas (${response.status})`);
      done += 1;
    }
    const finished = await call(`/api/geo-worker/jobs/${job.jobId}/finish`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "DONE", summary: { tiles: job.tiles.length, scale, ...moistureSummary } }) });
    console.log(`Geo-jobb ${job.jobId}: klart (${job.tiles.length} rutor, skala ${scale}, svar ${finished.status})`);
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
      try { await runJob(job); }
      catch (error) { if (!(error instanceof Stopped)) await fail(job, error); else console.log(`Geo-jobb ${job.jobId}: avbrutet`); }
      idleSince = Date.now();
      if (once) return;
      continue;
    }
    if (once) return;
    if (exitIdleMs && Date.now() - idleSince > exitIdleMs) { console.log("Inga jobb; geo-arbetaren slutar"); return; }
    await sleep(15_000);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
