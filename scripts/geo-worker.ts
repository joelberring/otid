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
 *   OTID_LASCLIP               klipper laserfiler till en ruta (tools/lasclip, förval /opt/lasclip/lasclip)
 *   OTID_DWGREAD               LibreDWG:s dwgread för DWG-jobben (förval /opt/libredwg/bin/dwgread)
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
import { createReadStream } from "node:fs";
import { cliffsFromTicks, DEFAULT_CLIFF_RULES, hillshade, mergeGroundGrids, readGroundGrid, readTicks, steepAt, heightPng } from "./geo-cliffs.ts";
import { buildingLayer, featuresGeoJson, landCoverLayer, readGpkgFeatures, unzipFirst, type Geometry } from "./geo-gpkg.ts";
import { dwgFeatures, dwgObjects } from "./geo-dwg.ts";
import { moistureDxf, moistureFromHeightMaps, readHeightMap } from "./geo-moisture.ts";
import { groundShareAt, vegetationSignals, type VegetationSignals, mergePointStats, pointImages, readPointStats } from "./geo-points.ts";
import { maskOf, runStep, StepSkipped, type StepInput, type StepName } from "./geo-steps.ts";
import { decodeGrayPng, readWorldFile, vegetationFromTiles, type VegetationTile } from "./geo-vegetation.ts";
import { readWaterGrid, waterFromGrids } from "./geo-water.ts";

interface Job {
  readonly jobId: string; readonly kind: "PULLAUTIN" | "DWG"; readonly attempt: number;
  readonly tiles: readonly { readonly index: number; readonly id: string; readonly epsg: number | null }[];
  readonly settings: Readonly<Record<string, number>>;
  /** Grundkartan G1: laserdatan klipps till rutan (SWEREF 99 TM, med marginal) innan Karttapullautin körs. */
  readonly clip?: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } | null;
  /** G8: Lantmäteriets vektorprodukter (Marktäcke, Byggnad) att läsa till kandidater. */
  readonly extras?: readonly { readonly index: number; readonly kind: "LAND_COVER" | "BUILDINGS" }[];
  /** G4: branternas trösklar (null = Kungshatt-kedjans förval). */
  readonly cliffs?: { readonly minDrop: number; readonly impassableDrop: number } | null;
  /** K5c del 2: fuktigheten ur markmodellen (Karttapullautins höjdraster per ruta). */
  readonly moisture?: { readonly channelHa: number; readonly wetMeters: number; readonly moistMeters: number } | null;
  /** K5c del 3: vegetationen ur returerna som ytor (Karttapullautins klassbilder per ruta). */
  readonly vegetation?: { readonly minAreaM2: number } | null;
}

const env = process.env;
const origin = (env.OTID_GEO_ORIGIN ?? "").replace(/\/$/, "");
const token = env.OTID_GEO_WORKER_TOKEN ?? "";
const workerName = (env.OTID_GEO_WORKER_NAME || hostname()).replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 80) || "geo";
const pullauta = env.OTID_PULLAUTA || "/opt/pullauta/pullauta";
const defaultIni = env.OTID_PULLAUTA_INI || "/opt/pullauta/pullauta.default.ini";
const lasclip = env.OTID_LASCLIP || "/opt/lasclip/lasclip";
const dwgread = env.OTID_DWGREAD || "/opt/libredwg/bin/dwgread";
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

/** Minnet (GB) som jobbet behöver efter områdets yta; samma regel som geoJobMemoryGb i packages/contracts (ett test håller dem lika). */
export function jobMemoryGb(job: { readonly clip?: Job["clip"]; readonly tiles: readonly unknown[] }): number {
  const areaKm2 = job.clip ? Math.max(0, job.clip.maxX - job.clip.minX) * Math.max(0, job.clip.maxY - job.clip.minY) / 1e6 : job.tiles.length * 6.25;
  return areaKm2 <= 8 ? 4 : areaKm2 <= 45 ? 8 : 16;
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** Arbetarens version (samma som `GEO_WORKER_VERSION` i contracts; servern ger inga jobb till en äldre). */
export const WORKER_VERSION = 19;
/** Serverns gräns för en resultatfil (GEO_OUTPUT_MAX_BYTES i @o-tid/contracts). */
const OUTPUT_MAX_BYTES = 100 * 1024 * 1024;
const headers = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, "x-otid-geo-worker": workerName,
  "x-otid-geo-version": String(WORKER_VERSION), ...extra });

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${origin}${path}`, { ...init, headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) },
    signal: init.signal ?? AbortSignal.timeout(60_000) });
}

/** Grundinställningarna med jobbets ändringar och det som geo-arbetaren kräver (en ruta i taget, filerna sparas). */
export function iniWith(base: string, settings: Readonly<Record<string, number>>, keepTemp = false, vegetationClasses = false): string {
  // `greenscale` är O-Tids egen: en faktor på Karttapullautins gränser för grönt (`greenshades`), inte en rad i filen.
  const { greenscale, ...pullautin } = settings;
  const shades = greenscale && greenscale !== 1 ? /^\s*greenshades\s*=\s*([^\r\n#]+)/m.exec(base)?.[1]?.split("|").map(Number) : undefined;
  const fixed: Record<string, string | number> = { ...pullautin, ...(shades?.every(Number.isFinite)
    ? { greenshades: shades.map(value => value >= 99 ? value : Math.round(value * greenscale! * 1000) / 1000).join("|") } : {}), batch: 1, processes: 1, lazfolder: "./in", batchoutfolder: "./out", savetempfiles: 1,
    savetempfolders: keepTemp ? 1 : 0, output_dxf: 1, ...(vegetationClasses ? { vege_bitmode: 1 } : {}) };
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

function run(args: readonly string[], cwd: string, signal: AbortSignal, program = pullauta): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, stdio: ["ignore", "ignore", "pipe"], env: { ...env, RUST_LOG: "warn" } });
    let tail = "";
    child.stderr.on("data", (chunk: Buffer) => { tail = (tail + chunk.toString("utf8")).slice(-1500); });
    const abort = () => child.kill("SIGKILL");
    signal.addEventListener("abort", abort, { once: true });
    child.on("error", reject);
    child.on("close", code => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(new Stopped());
      else if (code === 0) resolve();
      else reject(new Error(`${program === pullauta ? "Karttapullautin" : program === lasclip ? "lasclip" : "dwgread"} avslutades med kod ${code}: ${tail.trim().split("\n").slice(-3).join(" ")}`));
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
    // Minnet i loggen vid varje livstecken, så att orsaken syns om arbetaren dör (docker logs på geoservern).
    console.log(`${job.jobId.slice(0, 8)} ${progress.step} ${progress.done}/${progress.total} ${Math.round(process.memoryUsage().rss / 1e6)} MB`);
  };
  const timer = setInterval(() => void beat(), 60_000);
  const set = async (step: string, done: number, total: number) => { progress = { step, done, total }; await beat(); if (control.signal.aborted) throw new Stopped(); };
  try {
    // Servern väljs efter jobbets storlek, men ett stort jobb kan köas medan en liten server redan är igång. Då sägs det
    // direkt, i stället för att minnet tar slut mitt i jobbet (serverns minne är lite mindre än det nominella, därav 0,85).
    const needGb = jobMemoryGb(job), haveGb = totalmem() / 2 ** 30;
    if (haveGb < needGb * 0.85) {
      throw new Error(`Området är för stort för geo-servern som är igång (${Math.round(haveGb)} GB minne, området behöver ${needGb} GB). `
        + "Kör om jobbet om en halvtimme, när servern har stängts av, eller dela området i etapper.");
    }
    await set("Hämtar laserdata", 0, job.tiles.length);
    for (const tile of job.tiles) {
      const response = await call(`/api/geo-worker/jobs/${job.jobId}/laser/${tile.index}`, { signal: AbortSignal.any([control.signal, AbortSignal.timeout(20 * 60_000)]) });
      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => undefined) as { error?: string; detail?: string } | undefined;
        throw new Error(`Laserrutan ${tile.id} kunde inte hämtas (${detail?.error ?? response.status}${detail?.detail ? `, ${detail.detail}` : ""})`);
      }
      const file = `ruta${String(tile.index).padStart(2, "0")}.laz`;
      // Grundkartan G1: rutan klipps till kartans område direkt efter hämtningen; en ruta helt utanför ger ingen fil.
      await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(join(dir, job.clip ? file : join("in", file))));
      if (job.clip) {
        await run([file, join("in", file), ...[job.clip.minX, job.clip.minY, job.clip.maxX, job.clip.maxY].map(String), `vatten${tile.index}.bin`, `mark${tile.index}.bin`, `punkter${tile.index}.bin`], dir,
          AbortSignal.any([control.signal, AbortSignal.timeout(20 * 60_000)]), lasclip);
        await rm(join(dir, file), { force: true });
      }
      await set("Hämtar laserdata", tile.index + 1, job.tiles.length);
    }
    if (job.clip && (await readdir(join(dir, "in"))).length === 0) throw new Error("Kartans område ligger utanför laserrutorna");
    await writeFile(join(dir, "pullauta.ini"), iniWith(await readFile(defaultIni, "utf8"), job.settings, !!job.moisture, !!job.vegetation));
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
    // Grundkartan G4: branternas korta streck blir linjer med nedför till höger (geo-cliffs.ts). Med lasclips markraster
    // (1 m) mäts fallet över varje linje, och det avgör om den är opasserbar, passerbar eller ingen brant.
    let cliffSummary: Record<string, number> = {};
    let groundShare: ((x: number, y: number) => number | undefined) | undefined, signals: VegetationSignals | undefined;
    const ticksOf = async (name: string) => readTicks(await readFile(join(dir, name), "utf8").catch(() => ""));
    const groundFiles = (await readdir(dir)).filter(name => /^mark\d+\.bin$/.test(name)).sort();
    const grounds = [];
    for (const name of groundFiles) grounds.push(readGroundGrid(new Uint8Array(await readFile(join(dir, name)))));
    const ground = grounds.length ? mergeGroundGrids(grounds) : undefined;
    const rules = job.cliffs ? { ...DEFAULT_CLIFF_RULES, minDrop: job.cliffs.minDrop, impassableDrop3: job.cliffs.impassableDrop,
      impassableDrop6: job.cliffs.impassableDrop * DEFAULT_CLIFF_RULES.impassableDrop6 / DEFAULT_CLIFF_RULES.impassableDrop3 } : DEFAULT_CLIFF_RULES;
    const cliffs = cliffsFromTicks(await ticksOf("merged_c3g.dxf"), await ticksOf("merged_c2g.dxf"), undefined, ground, rules);
    // Terrängskuggningen ur samma markraster, som ett underlag att tona.
    if (ground) {
      await set("Ritar terrängskuggningen", 0, 1);
      const shade = hillshade(ground);
      await writeFile(join(dir, "skuggning.png"), shade.png);
      await writeFile(join(dir, "skuggning.pgw"), shade.world);
      // Ägaren 2026-11-11 (lära av en väl ritad karta): markens höjd som bild, träningsdata via AI-kopplingen.
      // Egna beräkningar ur punktmolnet (geo-points.ts): vegetationens höjd, skikten, markträffarnas andel och intensitet.
      const pointFiles = (await readdir(dir)).filter(name => /^punkter\d+\.bin$/.test(name)).sort();
      if (pointFiles.length) {
        const tiles = [];
        for (const name of pointFiles) tiles.push(readPointStats(new Uint8Array(await readFile(join(dir, name)))));
        const stats = mergePointStats(tiles);
        groundShare = groundShareAt(stats); signals = vegetationSignals(stats);
        const images = pointImages(stats);
        for (const [name, bytes] of [["lasveg", images.veg], ["lasmark", images.ground], ["laskron", images.canopy]] as const) {
          await writeFile(join(dir, `${name}.png`), bytes);
          await writeFile(join(dir, `${name}.pgw`), images.world);
        }
      }
      const heights = heightPng(ground);
      await writeFile(join(dir, "hojd.png"), heights.png);
      await writeFile(join(dir, "hojd.pgw"), heights.world);
    }
    if (cliffs.summary.cliffs201 + cliffs.summary.cliffs202 > 0) {
      await writeFile(join(dir, "brantlinjer.dxf"), cliffs.dxf);
      cliffSummary = cliffs.summary;
    }
    // Grundkartan: vattnet ur lasclips raster (geo-water.ts), så att sjön varken blir blöt mark eller öppen mark.
    let water: ReturnType<typeof waterFromGrids> | undefined;
    const waterFiles = (await readdir(dir)).filter(name => /^vatten\d+\.bin$/.test(name)).sort();
    if (waterFiles.length > 0) {
      await set("Letar upp vattnet", 0, 1);
      const grids = [];
      for (const name of waterFiles) grids.push(readWaterGrid(new Uint8Array(await readFile(join(dir, name)))));
      water = waterFromGrids(grids);
      if (water.summary.waterAreas > 0) await writeFile(join(dir, "vatten.geojson"), water.geojson);
    }
    // G8: Lantmäteriets Marktäcke och Byggnad (zip med GeoPackage per kommun) inom rutan, som GeoJSON med importens lagernamn.
    // En produkt som kontot inte kommer åt hoppas över (jobbet går vidare) och sägs i sammanfattningen.
    const extraSummary: Record<string, number | string> = {};
    for (const extra of job.clip ? job.extras ?? [] : []) {
      const land = extra.kind === "LAND_COVER", label = land ? "marktacke" : "byggnader";
      await set(land ? "Läser marktäcket" : "Läser byggnaderna", 0, 1);
      const response = await call(`/api/geo-worker/jobs/${job.jobId}/laser/x${extra.index}`, { signal: AbortSignal.any([control.signal, AbortSignal.timeout(20 * 60_000)]) });
      if (!response.ok) {
        const detail = await response.json().catch(() => undefined) as { error?: string } | undefined;
        extraSummary[label] = String(detail?.error ?? response.status).slice(0, 60);
        continue;
      }
      try {
        const found = unzipFirst(new Uint8Array(await response.arrayBuffer()), /\.gpkg$/i);
        if (!found) { extraSummary[label] = "ingen GeoPackage"; continue; }
        const path = join(dir, `${label}.gpkg`);
        await writeFile(path, found.bytes);
        const features = await readGpkgFeatures(path, job.clip!);
        await rm(path, { force: true });
        // Sjön och havet finns redan ur lasern (skarpare strand); av marktäckets vatten tas bara det lasern inte har (gölar).
        const inLaserWater = (geometry: Geometry) => {
          if (!water || geometry.kind !== "area") return false;
          const ring = geometry.rings[0] ?? [];
          return ring.length > 0 && ring.filter(([x, y]) => [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]].some(([ax, ay]) => water.at(x + ax!, y + ay!))).length * 2 > ring.length;
        };
        const result = featuresGeoJson(features, land ? landCoverLayer : buildingLayer, (layer, geometry) => !(layer === "vatten" && inLaserWater(geometry)));
        if (result.total > 0) await writeFile(join(dir, `${label}.geojson`), result.geojson);
        extraSummary[label] = result.total;
      } catch (error) { extraSummary[label] = (error instanceof Error ? error.message : "fel").slice(0, 60); }
    }
    // K5c del 2: fuktigheten ur rutornas höjdraster (Karttapullautin sparar dem i temp_<ruta>_dir med savetempfolders).
    let moistureSummary: Record<string, number> = {};
    let wetAt: ((x: number, y: number) => boolean) | undefined;
    if (job.moisture) {
      await set("Räknar fuktigheten", 0, 1);
      const folders = (await readdir(dir)).filter(name => /^temp_.+_dir$/.test(name)).sort();
      const grids = [];
      for (const folder of folders) {
        const bytes = await readFile(join(dir, folder, "xyz2.hmap")).catch(() => undefined);
        if (bytes) grids.push(readHeightMap(new Uint8Array(bytes)));
      }
      if (grids.length === 0) throw new Error("Karttapullautin gav inget höjdraster för fuktigheten");
      const moisture = moistureFromHeightMaps(grids, job.moisture, water?.at, groundShare);
      await writeFile(join(dir, "fukt.png"), moisture.png);
      await writeFile(join(dir, "fukt.pgw"), moisture.world);
      await writeFile(join(dir, "fukt.dxf"), moisture.dxf);
      await writeFile(join(dir, "fuktdjup.png"), moisture.depthPng);
      moistureSummary = { wetHa: moisture.summary.wetHa, moistHa: moisture.summary.moistHa, channels: moisture.summary.channels };
      wetAt = moisture.wetAt;
    }
    // Ägaren 2026-11-11: diken ur terrängformen (geo-ditches.ts) och reliefen som underlag; de krokiga sänkorna behålls bara
    // där fuktigheten säger fuktigt.
    // Stegen nedan körs i egna trådar med tidsgräns (geo-steps.ts): ett steg som går över hoppas över, resten blir klart.
    const skippedSteps: string[] = [];
    const step = async <K extends StepName>(name: K, label: string, input: StepInput) => {
      await set(label, 0, 1);
      try { return await runStep(name, input, control.signal); }
      catch (error) {
        if (control.signal.aborted) throw new Stopped();
        if (!(error instanceof StepSkipped)) throw error;
        console.error(`Steget hoppas över, ${error.message}`);
        skippedSteps.push(name);
        return undefined;
      }
    };
    const waterData = water ? { grid: water.grid, mask: water.mask } : undefined;
    let ditchSummary: Record<string, number> = {};
    if (ground) {
      const found = await step("ditches", "Letar diken i terrängformen", { ground, water: waterData, wet: wetAt ? maskOf(ground, wetAt) : undefined });
      if (found) {
        await writeFile(join(dir, "relief.png"), found.png);
        await writeFile(join(dir, "relief.pgw"), found.world);
        const of = (name: string) => found.lines.filter(line => line.name === name).map(line => line.points);
        if (found.lines.length) await writeFile(join(dir, "diken.dxf"), moistureDxf([{ name: "dike", closed: false, parts: of("dike") },
          { name: "fuktstrak_terrang", closed: false, parts: of("fuktstrak_terrang") }]));
        ditchSummary = { ditches: of("dike").length, terrainChannels: of("fuktstrak_terrang").length };
      }
    }
    // K5c del 3: vegetationen ur klassbilderna i ./out (<ruta>_vege_bit.png, _undergrowth_bit.png och världsfilen).
    let vegetationSummary: Record<string, number> = {};
    let openAt: ((x: number, y: number) => boolean) | undefined, forestAt: ((x: number, y: number) => boolean) | undefined;
    if (job.vegetation) {
      await set("Räknar vegetationen", 0, 1);
      const out = join(dir, "out"), names = (await readdir(out)).filter(name => name.endsWith("_vege_bit.png")).sort();
      const tiles: VegetationTile[] = [];
      for (const name of names) {
        const stem = name.slice(0, -"_vege_bit.png".length);
        const world = await readFile(join(out, `${stem}_vege_bit.pgw`), "utf8").catch(() => undefined);
        if (!world) continue;
        const undergrowth = await readFile(join(out, `${stem}_undergrowth_bit.png`)).catch(() => undefined);
        tiles.push({ vege: decodeGrayPng(new Uint8Array(await readFile(join(out, name)))), world: readWorldFile(world),
          ...(undergrowth ? { undergrowth: decodeGrayPng(new Uint8Array(undergrowth)) } : {}) });
      }
      if (tiles.length === 0) throw new Error("Karttapullautin gav inga klassbilder för vegetationen");
      // Grönt spärras i stup och branta sluttningar (> 35°): lövlös laser ger falskt grönt där (Kungshatt-kedjan).
      const steep = ground ? steepAt(ground, 35) : undefined;
      const blocked = water || steep ? (x: number, y: number) => !!water?.at(x, y) || !!steep?.(x, y) : undefined;
      const vegetation = vegetationFromTiles(tiles, job.vegetation, blocked, signals);
      await writeFile(join(dir, "vegetation.dxf"), vegetation.dxf);
      await writeFile(join(dir, "vegetationsklasser.png"), vegetation.classPng);
      await writeFile(join(dir, "vegetationsklasser.pgw"), vegetation.world);
      vegetationSummary = vegetation.summary;
      openAt = vegetation.openAt; forestAt = vegetation.forestAt;
    }
    // Stenar ur markrastret, och berg i dagen där vegetationen är öppen (geo-rock.ts).
    let rockSummary: Record<string, number> = {};
    if (ground) {
      const stones = (await step("stones", "Letar stenar", { ground, water: waterData })) ?? { stones: [], capped: 0 };
      const rock = openAt ? (await step("rock", "Letar berg i dagen", { ground, water: waterData, open: maskOf(ground, openAt),
        forest: forestAt ? maskOf(ground, forestAt) : undefined }))?.rock ?? [] : [];
      const hills = (await step("knolls", "Letar små kullar", { ground, water: waterData, stones: stones.stones })) ?? { knolls: [], capped: 0 };
      if (stones.stones.length || rock.length || hills.knolls.length) {
        await writeFile(join(dir, "berg.dxf"), moistureDxf([{ name: "berg_i_dagen_laser", closed: true, parts: rock },
          ...(["sten", "stort_block"] as const).map(name => ({ name, closed: false, points: stones.stones.filter(stone => stone.name === name).map(stone => stone.at), parts: [] })),
          { name: "dotknoll_laser", closed: false, points: hills.knolls, parts: [] }]));
      }
      rockSummary = { boulders: stones.stones.length, knolls: hills.knolls.length, bareRockAreas: rock.length,
        ...(stones.capped + hills.capped ? { cappedPoints: stones.capped + hills.capped } : {}) };
    }
    const files = new Set(await readdir(dir));
    const uploads: (readonly [string, string, string])[] = [["karta.png", "merged.png", "image/png"], ["karta.pgw", "merged.pgw", "text/plain"],
      ...VECTOR_OUTPUTS.filter(([, source]) => files.has(source)).map(([name, source]) => [name, source, "application/dxf"] as const),
      ...(job.moisture ? [["fukt.png", "fukt.png", "image/png"], ["fukt.pgw", "fukt.pgw", "text/plain"], ["fukt.dxf", "fukt.dxf", "application/dxf"],
        ["fuktdjup.png", "fuktdjup.png", "image/png"], ["fuktdjup.pgw", "fukt.pgw", "text/plain"]] as const : []),
      ...(job.vegetation ? [["vegetation.dxf", "vegetation.dxf", "application/dxf"], ["vegetationsklasser.png", "vegetationsklasser.png", "image/png"],
        ["vegetationsklasser.pgw", "vegetationsklasser.pgw", "text/plain"]] as const : []),
      ...(files.has("skuggning.png") ? [["skuggning.png", "skuggning.png", "image/png"], ["skuggning.pgw", "skuggning.pgw", "text/plain"]] as const : []),
      ...(files.has("hojd.png") ? [["hojd.png", "hojd.png", "image/png"], ["hojd.pgw", "hojd.pgw", "text/plain"]] as const : []),
      ...["lasveg", "lasmark", "laskron"].filter(name => files.has(`${name}.png`)).flatMap(name => [[`${name}.png`, `${name}.png`, "image/png"], [`${name}.pgw`, `${name}.pgw`, "text/plain"]] as const),
      ...(files.has("brantlinjer.dxf") ? [["brantlinjer.dxf", "brantlinjer.dxf", "application/dxf"]] as const : []),
      ...(files.has("relief.png") ? [["relief.png", "relief.png", "image/png"], ["relief.pgw", "relief.pgw", "text/plain"]] as const : []),
      ...(files.has("diken.dxf") ? [["diken.dxf", "diken.dxf", "application/dxf"]] as const : []),
      ...(files.has("berg.dxf") ? [["berg.dxf", "berg.dxf", "application/dxf"]] as const : []),
      ...["marktacke.geojson", "byggnader.geojson"].filter(name => files.has(name)).map(name => [name, name, "application/geo+json"] as const),
      ...(files.has("vatten.geojson") ? [["vatten.geojson", "vatten.geojson", "application/geo+json"]] as const : [])];
    let done = 0;
    // En fil över serverns gräns (Karttapullautins råa brantstreck för många rutor blir över 100 MB) hoppas över i stället för
    // att hela jobbet faller; bara kartbilden måste med. Namnen står i jobbets sammanfattning.
    const skippedOutputs: string[] = [];
    for (const [name, source, mediaType] of uploads) {
      await set("Skickar resultatet", done, uploads.length);
      if (!files.has(source)) throw new Error(`Karttapullautin gav ingen ${source}`);
      const size = (await stat(join(dir, source))).size;
      if (size > OUTPUT_MAX_BYTES && !name.startsWith("karta.")) { skippedOutputs.push(name); done += 1; continue; }
      const bytes = await readFile(join(dir, source));
      const response = await call(`/api/geo-worker/jobs/${job.jobId}/outputs/${name}`, { method: "PUT", body: new Uint8Array(bytes),
        headers: { "content-type": mediaType, "content-length": String(bytes.byteLength) }, signal: AbortSignal.any([control.signal, AbortSignal.timeout(10 * 60_000)]) });
      if (!response.ok) throw new Error(`${name} kunde inte skickas (${response.status})`);
      done += 1;
    }
    const finished = await call(`/api/geo-worker/jobs/${job.jobId}/finish`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "DONE", summary: { worker: WORKER_VERSION, tiles: job.tiles.length, scale, memoryMb: Math.round(process.memoryUsage().rss / 1e6), serverMemoryMb: Math.round(totalmem() / 1e6), cores: cpus().length, ...(skippedOutputs.length ? { skippedOutputs: skippedOutputs.length } : {}), ...(skippedSteps.length ? { skippedSteps: skippedSteps.join(",") } : {}), ...(water ? { waterHa: water.summary.waterHa } : {}), ...cliffSummary, ...extraSummary, ...moistureSummary, ...ditchSummary, ...vegetationSummary, ...rockSummary } }) });
    console.log(`Geo-jobb ${job.jobId}: klart (${job.tiles.length} rutor, skala ${scale}, svar ${finished.status})`);
  } finally {
    clearInterval(timer);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * K6b: en DWG-ritning läses med LibreDWG (`dwgread -O JSON`, som får med skraffyrerna där baskartans ytor ligger) och blir
 * GeoJSON med lagrens namn (`geo-dwg.ts`). Resultatet skickas tillbaka som `ritning.geojson` och läses in som kandidater.
 */
async function runDwgJob(job: Job): Promise<void> {
  const dir = join(workdir, job.jobId);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const control = new AbortController();
  const beat = async (step: string) => {
    const response = await call(`/api/geo-worker/jobs/${job.jobId}/heartbeat`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ step, done: 0, total: 1 }) }).catch(() => undefined);
    const body = response?.ok ? await response.json().catch(() => undefined) as { action?: string } | undefined : undefined;
    if (body?.action === "stop") { control.abort(); throw new Stopped(); }
  };
  try {
    await beat("Hämtar ritningen");
    const input = await call(`/api/geo-worker/jobs/${job.jobId}/input`, { signal: AbortSignal.any([control.signal, AbortSignal.timeout(10 * 60_000)]) });
    if (!input.ok || !input.body) throw new Error(`Ritningen kunde inte hämtas (${input.status})`);
    await pipeline(Readable.fromWeb(input.body as import("node:stream/web").ReadableStream), createWriteStream(join(dir, "ritning.dwg")));
    await beat("Läser ritningen");
    await run(["-O", "JSON", "-o", "ritning.json", "ritning.dwg"], dir, AbortSignal.any([control.signal, AbortSignal.timeout(20 * 60_000)]), dwgread);
    const read = await dwgFeatures(dwgObjects(createReadStream(join(dir, "ritning.json"), { encoding: "utf8", highWaterMark: 1 << 20 }) as AsyncIterable<string>));
    if (read.features.length === 0) throw new Error("Ritningen har inga linjer, ytor eller punkter i modellrymden");
    const bytes = Buffer.from(JSON.stringify({ type: "FeatureCollection", features: read.features }));
    await beat("Skickar resultatet");
    const response = await call(`/api/geo-worker/jobs/${job.jobId}/outputs/ritning.geojson`, { method: "PUT", body: new Uint8Array(bytes),
      headers: { "content-type": "application/geo+json", "content-length": String(bytes.byteLength) }, signal: AbortSignal.any([control.signal, AbortSignal.timeout(10 * 60_000)]) });
    if (!response.ok) throw new Error(`ritning.geojson kunde inte skickas (${response.status})`);
    const finished = await call(`/api/geo-worker/jobs/${job.jobId}/finish`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "DONE", summary: { features: read.features.length, skipped: read.skipped } }) });
    console.log(`Geo-jobb ${job.jobId}: DWG klart (svar ${finished.status})`);
  } finally {
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
      try { await (job.kind === "DWG" ? runDwgJob(job) : runJob(job)); }
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
