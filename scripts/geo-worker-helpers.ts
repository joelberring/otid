/**
 * Hjälpfunktioner till geo-arbetaren (`scripts/geo-worker.ts`): strömmande sammanslagning av beskurna `.bin`-raster från
 * `lasclip`, 1 m → 2 m-nedsampling för fuktigheten utan `savetempfolders`, snabb 32-bytes PNG-storleksläsning, parallell
 * arbetarpool, samt sammanslagnings- och DWG-jobb.
 *
 * Bara Nodes egna moduler (körs direkt av Node i `deploy/geo.Dockerfile` utan transpilering).
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { totalmem } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGroundAccumulator, readGroundGrid, type GroundGrid } from "./geo-cliffs.ts";
import { dwgFeatures, dwgObjects } from "./geo-dwg.ts";
import { AREA_DXF, clipDxfEntities, decodePng, dxfFrame, encodeRawPng, mergeGeoJson, mosaicPng, readWorld, writeWorld, type Box } from "./geo-merge.ts";
import { createPointStatsAccumulator, readPointStats, type PointStats } from "./geo-points.ts";
import { slimDxf } from "./geo-slim.ts";
import type { WaterGrid } from "./geo-water.ts";

/** Karttapullautins renderingstäthet vid `scalefactor=1` (600 dpi i 1:10 000 = 600 / 254 px/m). */
const PULLAUTA_PX_PER_M = 600 / 254;

interface BinHeader { readonly minX: number; readonly minY: number; readonly cell: number; readonly width: number; readonly height: number }

async function readBinHeader(path: string, label: string): Promise<BinHeader> {
  const handle = await open(path, "r");
  try {
    const head = Buffer.alloc(40);
    const { bytesRead } = await handle.read(head, 0, 40, 0);
    if (bytesRead < 40) throw new Error(`${label} är för kort`);
    const view = new DataView(head.buffer, head.byteOffset, 40);
    const minX = view.getFloat64(0, true), minY = view.getFloat64(8, true), cell = view.getFloat64(16, true);
    const width = Number(view.getBigUint64(24, true)), height = Number(view.getBigUint64(32, true));
    if (!(cell > 0) || !(width > 0 && height > 0)) throw new Error(`${label} har fel storlek`);
    return { minX, minY, cell, width, height };
  } finally { await handle.close(); }
}

function unionHeaders(headers: readonly BinHeader[], label: string): BinHeader {
  const first = headers[0]!;
  let minX = first.minX, minY = first.minY;
  let maxX = first.minX + first.width * first.cell, maxY = first.minY + first.height * first.cell;
  for (const h of headers.slice(1)) {
    if (Math.abs(h.cell - first.cell) > 1e-9) throw new Error(`${label} har olika cellstorlek`);
    if (h.minX < minX) minX = h.minX;
    if (h.minY < minY) minY = h.minY;
    const x1 = h.minX + h.width * h.cell, y1 = h.minY + h.height * h.cell;
    if (x1 > maxX) maxX = x1;
    if (y1 > maxY) maxY = y1;
  }
  const width = Math.round((maxX - minX) / first.cell), height = Math.round((maxY - minY) / first.cell);
  if (!(width > 0 && height > 0)) throw new Error(`${label} har tomt rutnät`);
  return { minX, minY, cell: first.cell, width, height };
}

/**
 * Läser och slår ihop `mark*.bin` en fil i taget direkt in i `createGroundAccumulator` (och raderar varje fil direkt), med
 * stöd för beskurna per-ruta-raster från `lasclip` v2. Markhöjderna hamnar direkt i en `SharedArrayBuffer`.
 */
export async function streamMergeGroundFiles(dir: string, files: readonly string[], rounds = 4): Promise<GroundGrid | undefined> {
  if (files.length === 0) return undefined;
  const headers = await Promise.all(files.map(name => readBinHeader(join(dir, name), "Markrastret")));
  const acc = createGroundAccumulator(unionHeaders(headers, "Markrastren"));
  for (const name of files) {
    const path = join(dir, name);
    const bytes = new Uint8Array(await readFile(path));
    await rm(path, { force: true });
    acc.add(readGroundGrid(bytes));
  }
  return acc.finish(rounds, true);
}

/** Läser och slår ihop `punkter*.bin` strömmande en fil i taget via `createPointStatsAccumulator` och raderar varje fil. */
export async function streamMergePointFiles(dir: string, files: readonly string[]): Promise<PointStats | undefined> {
  if (files.length === 0) return undefined;
  if (files.length === 1) {
    const path = join(dir, files[0]!);
    const bytes = new Uint8Array(await readFile(path));
    await rm(path, { force: true });
    return readPointStats(bytes);
  }
  const headers = await Promise.all(files.map(name => readBinHeader(join(dir, name), "Punktstatistiken")));
  const acc = createPointStatsAccumulator(unionHeaders(headers, "Punktstatistikens rutor"));
  for (const name of files) {
    const path = join(dir, name);
    const bytes = new Uint8Array(await readFile(path));
    await rm(path, { force: true });
    acc.add(readPointStats(bytes));
  }
  return acc.finish();
}

/** Läser och slår ihop `vatten*.bin` strömmande en fil i taget (med stöd för beskurna per-ruta-raster) och raderar varje fil. */
export async function streamMergeWaterFiles(dir: string, files: readonly string[]): Promise<WaterGrid | undefined> {
  if (files.length === 0) return undefined;
  const headers = await Promise.all(files.map(name => readBinHeader(join(dir, name), "Vattenrastret")));
  const union = unionHeaders(headers, "Vattenrastren");
  const cells = new Uint8Array(union.width * union.height);
  for (let idx = 0; idx < files.length; idx += 1) {
    const path = join(dir, files[idx]!), h = headers[idx]!;
    const bytes = new Uint8Array(await readFile(path));
    await rm(path, { force: true });
    if (bytes.byteLength !== 40 + h.width * h.height) throw new Error("Vattenrastret har fel storlek");
    const dx = Math.round((h.minX - union.minX) / union.cell), dy = Math.round((h.minY - union.minY) / union.cell);
    for (let x = 0; x < h.width; x += 1) {
      const srcCol = 40 + x * h.height, dstCol = (x + dx) * union.height + dy;
      for (let y = 0; y < h.height; y += 1) {
        const bit = bytes[srcCol + y]!;
        if (bit) cells[dstCol + y] = cells[dstCol + y]! | bit;
      }
    }
  }
  return { ...union, cells };
}

/** Läser bara de första 32 byten ur en PNG-fil för att hämta bildmåtten (aldrig `readFile` på hela 50 MB-PNG:en). */
export async function readPngSize(path: string, parseSize: (bytes: Uint8Array) => { width: number; height: number } | undefined): Promise<{ width: number; height: number } | undefined> {
  const handle = await open(path, "r");
  try {
    const head = Buffer.alloc(32);
    const { bytesRead } = await handle.read(head, 0, 32, 0);
    return parseSize(head.subarray(0, bytesRead));
  } finally { await handle.close(); }
}

/** Räknar ut initial `pngmerge`-skala direkt ur klipprutans mått (`<= maxPixels`), i stället för att alltid gissa `scale = 1`. */
export function initialPngMergeScale(box: Box | null | undefined, tileCount: number, maxPixels: number): number {
  if (!box) return tileCount > 4 ? 2 : 1;
  const sidePx = Math.max(box.maxX - box.minX, box.maxY - box.minY) * PULLAUTA_PX_PER_M;
  let scale = 1;
  while (sidePx / scale > maxPixels && scale < 8) scale *= 2;
  const areaKm2 = Math.max(0, box.maxX - box.minX) * Math.max(0, box.maxY - box.minY) / 1e6;
  if (areaKm2 > 25 && scale < 2) scale = 2;
  return scale;
}

/**
 * Kontrollerar snabbt om en DXF redan är avrundad till centimeter utan indenterade gruppkoder (dvs. redan körd genom
 * `slimDxf` eller skriven av O-Tids `moistureDxf`), så sammanslagningen slipper dubbel `slimDxf`.
 */
export function isAlreadySlimDxf(text: string): boolean {
  if (text.length === 0) return true;
  // Karttapullautins DXF använder blankstegsutfyllda koder ("  0", " 10"); slimmade/egna DXF saknar inledande blanksteg.
  if (text.startsWith(" ")) return false;
  let at = 0, checked = 0;
  const nextLine = (): string | undefined => {
    if (at >= text.length) return undefined;
    const end = text.indexOf("\n", at);
    const raw = end === -1 ? text.slice(at) : text.slice(at, end);
    at = end === -1 ? text.length : end + 1;
    return raw.endsWith("\r") ? raw.slice(0, -1) : raw;
  };
  while (checked < 60) {
    const code = nextLine(), value = nextLine();
    if (code === undefined || value === undefined) break;
    if (code.length > 0 && code[0] === " ") return false;
    if (code === "10" || code === "20" || code === "11" || code === "21") {
      if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) return false;
      checked += 1;
    }
  }
  return checked > 0;
}

/** Kör högst `concurrency` uppgifter parallellt ur listan `items` (avbryter vid första kastade felet). */
export async function runPool<T>(items: readonly T[], concurrency: number, task: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const workers = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await task(items[index]!);
    }
  }));
}

export interface HelperDeps {
  readonly workdir: string;
  readonly dwgread: string;
  readonly workerVersion: number;
  readonly outputMaxBytes: number;
  readonly webpOutputs: ReadonlySet<string>;
  readonly rawTickOutputs: ReadonlySet<string>;
  readonly call: (path: string, init?: RequestInit) => Promise<Response>;
  readonly run: (args: readonly string[], cwd: string, signal: AbortSignal, program?: string) => Promise<void>;
  readonly toWebp: (dir: string, source: string, signal: AbortSignal) => Promise<string | undefined>;
  readonly sendFailure: (name: string, response: Response) => Promise<string>;
  readonly jobMemoryGb: (job: { readonly clip?: Box | null | undefined; readonly tiles: readonly unknown[] }) => number;
  readonly keepsRawTicks: (job: { readonly cliffs?: { readonly rawTicks?: boolean } | null | undefined }, hasCliffLines: boolean) => boolean;
  readonly createTelemetry: () => { sample: () => number; phase: (next?: string) => void; summary: () => Record<string, number> };
  readonly isStopped: (error: unknown) => boolean;
  readonly createStopped: () => Error;
}

export interface MergeJobInput {
  readonly jobId: string;
  readonly tiles: readonly unknown[];
  readonly clip?: Box | null | undefined;
  readonly cliffs?: { readonly rawTicks?: boolean } | null | undefined;
  readonly merge: { readonly stages: readonly { readonly jobId: string; readonly clip: Box; readonly outputs: readonly string[] }[] };
}

/**
 * Ägaren 2026-11-14: en körning som delades i etapper läggs ihop till en (geo-merge.ts). Etappernas filer hämtas från
 * O-Tid en sort i taget, läggs ihop och skickas tillbaka under den sammanlagda körningen; servern tar sedan bort etapperna.
 */
export async function runMergeJobHelper(job: MergeJobInput, deps: HelperDeps): Promise<void> {
  const stages = job.merge.stages, dir = join(deps.workdir, job.jobId), telemetry = deps.createTelemetry();
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const control = new AbortController();
  let progress = { step: "Lägger ihop etapperna", done: 0, total: 1 };
  const beat = async () => {
    const response = await deps.call(`/api/geo-worker/jobs/${job.jobId}/heartbeat`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(progress) }).catch(() => undefined);
    const body = response?.ok ? await response.json().catch(() => undefined) as { action?: string } | undefined : undefined;
    if (body?.action === "stop") control.abort();
    console.log(`${job.jobId.slice(0, 8)} ${progress.step} ${progress.done}/${progress.total} ${telemetry.sample()} MB`);
  };
  const timer = setInterval(() => void beat(), 60_000);
  const set = async (done: number, total: number) => { progress = { step: "Lägger ihop etapperna", done, total }; await beat(); if (control.signal.aborted) throw deps.createStopped(); };
  try {
    const needGb = deps.jobMemoryGb(job), haveGb = totalmem() / 2 ** 30;
    if (haveGb < needGb * 0.85) {
      throw new Error(`Etapperna är för stora att lägga ihop på geo-servern som är igång (${Math.round(haveGb)} GB minne, det behövs ${needGb} GB). `
        + "Välj «Lägg ihop etapperna» igen om en halvtimme, när servern har stängts av.");
    }
    const union: Box = job.clip ?? { minX: Math.min(...stages.map(stage => stage.clip.minX)), minY: Math.min(...stages.map(stage => stage.clip.minY)),
      maxX: Math.max(...stages.map(stage => stage.clip.maxX)), maxY: Math.max(...stages.map(stage => stage.clip.maxY)) };
    const names = [...new Set(stages.flatMap(stage => stage.outputs))].filter(name => !name.endsWith(".pgw") && !name.startsWith("indata.")).sort();
    const read = async (stage: typeof stages[number], name: string): Promise<Buffer> => {
      const response = await deps.call(`/api/geo-worker/jobs/${job.jobId}/stages/${stage.jobId}/${name}`, { signal: AbortSignal.any([control.signal, AbortSignal.timeout(10 * 60_000)]) });
      if (!response.ok) throw new Error(`${name} kunde inte hämtas från etappen (${response.status})`);
      return Buffer.from(await response.arrayBuffer());
    };
    const put = (name: string, bytes: Uint8Array, mediaType: string) => deps.call(`/api/geo-worker/jobs/${job.jobId}/outputs/${name}`, { method: "PUT", body: new Uint8Array(bytes),
      headers: { "content-type": mediaType, "content-length": String(bytes.byteLength) }, signal: AbortSignal.any([control.signal, AbortSignal.timeout(10 * 60_000)]) });
    const send = async (name: string, bytes: Uint8Array, mediaType: string) => {
      const response = await put(name, bytes, mediaType);
      if (!response.ok) throw new Error(await deps.sendFailure(name, response));
    };
    const skipped: string[] = [];
    let done = 0;
    for (const name of names) {
      await set(done, names.length);
      done += 1;
      const having = stages.filter(stage => stage.outputs.includes(name));
      if (deps.rawTickOutputs.has(name) && !deps.keepsRawTicks(job, stages.every(stage => stage.outputs.includes("brantlinjer.dxf")))) continue;
      telemetry.phase(name.endsWith(".png") ? "msPngMerge" : name.endsWith(".dxf") ? "msDxfMerge" : name.endsWith(".geojson") ? "msGeoJsonMerge" : undefined);
      try {
        if (name.endsWith(".png")) {
          const world = name.replace(/\.png$/, ".pgw");
          const parts = [];
          for (const stage of having) {
            if (!stage.outputs.includes(world)) continue;
            parts.push({ image: decodePng(await read(stage, name)), world: readWorld((await read(stage, world)).toString("utf8")), box: stage.clip });
          }
          if (parts.length === 0) continue;
          const merged = mosaicPng(parts, union), png = encodeRawPng(merged.image);
          await writeFile(join(dir, name), png);
          const webp = deps.webpOutputs.has(name) ? await deps.toWebp(dir, name, control.signal) : undefined;
          if (!webp && png.byteLength > deps.outputMaxBytes) { skipped.push(name); continue; }
          const sent = webp ? await put(name.replace(/\.png$/, ".webp"), await readFile(join(dir, webp)), "image/webp") : undefined;
          if (sent && !sent.ok && sent.status !== 400) throw new Error(await deps.sendFailure(name.replace(/\.png$/, ".webp"), sent));
          if (!sent?.ok) { if (png.byteLength > deps.outputMaxBytes) { skipped.push(name); continue; } await send(name, png, "image/png"); }
          await rm(join(dir, name), { force: true });
          await send(world, Buffer.from(writeWorld(merged.world)), "text/plain");
        } else if (name.endsWith(".dxf")) {
          const target = join(dir, name);
          let size = 0, first = true;
          const out = createWriteStream(target);
          const writeOut = (text: string) => new Promise<void>((resolve, reject) => { size += Buffer.byteLength(text); out.write(text, error => error ? reject(error) : resolve()); });
          for (const stage of having) {
            const raw = (await read(stage, name)).toString("utf8");
            // Redan slimmade etapp-DXF:er (centimeteravrundade utan indenterade koder) behöver inte köras genom slimDxf igen.
            const text = isAlreadySlimDxf(raw) ? raw : slimDxf(raw);
            if (first) await writeOut(dxfFrame(text).head);
            const lines = clipDxfEntities(text, stage.clip, union, { areas: AREA_DXF.has(name), first });
            for (let at = 0; at < lines.length; at += 200_000) await writeOut(`${lines.slice(at, at + 200_000).join("\n")}\n`);
            first = false;
          }
          await writeOut("0\nENDSEC\n0\nEOF\n");
          await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => error ? reject(error) : resolve()));
          if (size > deps.outputMaxBytes) { skipped.push(name); continue; }
          await send(name, await readFile(target), "application/dxf");
          await rm(target, { force: true });
        } else if (name.endsWith(".geojson")) {
          const parts = [];
          for (const stage of having) parts.push({ text: (await read(stage, name)).toString("utf8"), box: stage.clip });
          const bytes = Buffer.from(mergeGeoJson(parts, union));
          if (bytes.byteLength > deps.outputMaxBytes) { skipped.push(name); continue; }
          await send(name, bytes, "application/geo+json");
        }
      } catch (error) {
        if (deps.isStopped(error) || control.signal.aborted) throw deps.createStopped();
        if (name.startsWith("karta.") || /fick inte plats|kunde inte skickas|är för stor/.test(error instanceof Error ? error.message : "")) throw error;
        console.error(`Geo-jobb ${job.jobId}: ${name} lades inte ihop: ${error instanceof Error ? error.message : String(error)}`);
        skipped.push(name);
      } finally { telemetry.phase(); }
    }
    await set(names.length, names.length);
    const finished = await deps.call(`/api/geo-worker/jobs/${job.jobId}/finish`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "DONE", summary: { worker: deps.workerVersion, mergedStages: stages.length, memoryMb: telemetry.sample(), ...telemetry.summary(),
        ...(skipped.length ? { skippedOutputs: skipped.length, skippedOutputNames: skipped.join(",").slice(0, 400) } : {}) } }) });
    console.log(`Geo-jobb ${job.jobId}: ${stages.length} etapper ihoplagda (svar ${finished.status})`);
  } finally {
    clearInterval(timer);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * K6b: en DWG-ritning läses med LibreDWG (`dwgread -O JSON`, som får med skraffyrerna där baskartans ytor ligger) och blir
 * GeoJSON med lagrens namn (`geo-dwg.ts`).
 */
export async function runDwgJobHelper(job: { readonly jobId: string }, deps: HelperDeps): Promise<void> {
  const dir = join(deps.workdir, job.jobId);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const control = new AbortController();
  let step = "Hämtar ritningen";
  const beat = async (next: string = step) => {
    step = next;
    const response = await deps.call(`/api/geo-worker/jobs/${job.jobId}/heartbeat`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ step, done: 0, total: 1 }) }).catch(() => undefined);
    const body = response?.ok ? await response.json().catch(() => undefined) as { action?: string } | undefined : undefined;
    if (body?.action === "stop") { control.abort(); throw deps.createStopped(); }
  };
  const timer = setInterval(() => void beat().catch((error: unknown) => { if (!deps.isStopped(error)) console.warn("Livstecknet för DWG-jobbet misslyckades", error); }), 60_000);
  try {
    await beat("Hämtar ritningen");
    const input = await deps.call(`/api/geo-worker/jobs/${job.jobId}/input`, { signal: AbortSignal.any([control.signal, AbortSignal.timeout(10 * 60_000)]) });
    if (!input.ok || !input.body) throw new Error(`Ritningen kunde inte hämtas (${input.status})`);
    await pipeline(Readable.fromWeb(input.body as import("node:stream/web").ReadableStream), createWriteStream(join(dir, "ritning.dwg")));
    await beat("Läser ritningen");
    await deps.run(["-O", "JSON", "-o", "ritning.json", "ritning.dwg"], dir, AbortSignal.any([control.signal, AbortSignal.timeout(20 * 60_000)]), deps.dwgread);
    const read = await dwgFeatures(dwgObjects(createReadStream(join(dir, "ritning.json"), { encoding: "utf8", highWaterMark: 1 << 20 }) as AsyncIterable<string>));
    if (read.features.length === 0) throw new Error("Ritningen har inga linjer, ytor eller punkter i modellrymden");
    const bytes = Buffer.from(JSON.stringify({ type: "FeatureCollection", features: read.features }));
    await beat("Skickar resultatet");
    const response = await deps.call(`/api/geo-worker/jobs/${job.jobId}/outputs/ritning.geojson`, { method: "PUT", body: new Uint8Array(bytes),
      headers: { "content-type": "application/geo+json", "content-length": String(bytes.byteLength) }, signal: AbortSignal.any([control.signal, AbortSignal.timeout(10 * 60_000)]) });
    if (!response.ok) throw new Error(await deps.sendFailure("ritning.geojson", response));
    const finished = await deps.call(`/api/geo-worker/jobs/${job.jobId}/finish`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "DONE", summary: { features: read.features.length, skipped: read.skipped } }) });
    console.log(`Geo-jobb ${job.jobId}: DWG klart (svar ${finished.status})`);
  } finally {
    clearInterval(timer);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
