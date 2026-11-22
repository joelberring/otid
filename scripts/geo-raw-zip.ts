import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { crc32 } from "node:zlib";
import { cacheName } from "./geo-cache.ts";

type Box = { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };

/**
 * PLAN.md M6 (ägaren 2026-11-22): laserfilerna som körningen använde packas i en zip som laddas upp direkt till förrådet.
 * LAZ är redan komprimerat, så filerna lagras okomprimerade (metod 0). Zip-filen skrivs aldrig till disken: först räknas
 * varje fils CRC-32 och storlek, sedan strömmas zip-filen (med känd total längd, som objektlagringen kräver) direkt i
 * uppladdningen. Ingen Zip64: högst 4 GB totalt och 65 535 filer (servern säger nej till större).
 *
 * Bara Nodes egna moduler (geo-arbetaren körs direkt av Node).
 */
export interface RawZipEntry { readonly name: string; readonly path?: string; readonly bytes?: Uint8Array }
interface Planned { readonly name: Buffer; readonly path?: string | undefined; readonly bytes?: Uint8Array | undefined; readonly size: number; readonly crc: number; readonly offset: number }
export interface RawZipPlan { readonly entries: readonly Planned[]; readonly byteLength: number; readonly centralOffset: number; readonly centralLength: number }

const LIMIT = 0xffff_ffff;
const LOCAL = 30, CENTRAL = 46, END = 22;

async function crcOf(entry: RawZipEntry): Promise<{ size: number; crc: number }> {
  if (entry.bytes) return { size: entry.bytes.byteLength, crc: crc32(entry.bytes) };
  let crc = 0, size = 0;
  for await (const chunk of createReadStream(entry.path!)) { crc = crc32(chunk as Buffer, crc); size += (chunk as Buffer).byteLength; }
  if (size !== (await stat(entry.path!)).size) throw new Error(`${entry.name} ändrades medan den lästes`);
  return { size, crc };
}

/** Räknar ut zip-filen (CRC, storlekar och lägen) utan att skriva den. */
export async function planRawZip(files: readonly RawZipEntry[]): Promise<RawZipPlan> {
  if (files.length === 0 || files.length > 0xffff) throw new Error("Fel antal filer för zip-filen");
  const entries: Planned[] = [];
  let offset = 0;
  for (const file of files) {
    const { size, crc } = await crcOf(file);
    const name = Buffer.from(file.name, "utf8");
    entries.push({ name, path: file.path, bytes: file.bytes, size, crc, offset });
    offset += LOCAL + name.byteLength + size;
  }
  const centralLength = entries.reduce((sum, entry) => sum + CENTRAL + entry.name.byteLength, 0);
  const byteLength = offset + centralLength + END;
  if (byteLength > LIMIT) throw new Error("Laserdatan är större än 4 GB och får inte plats i en zip-fil");
  return { entries, byteLength, centralOffset: offset, centralLength };
}

/** Datum och tid i DOS-format (zip-filens tid för alla filer). */
function dosTime(date: Date): { time: number; day: number } {
  return { time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() };
}

function header(entry: Planned, central: boolean, stamp: { time: number; day: number }): Buffer {
  const head = Buffer.alloc((central ? CENTRAL : LOCAL) + entry.name.byteLength);
  let at = 0;
  const u32 = (value: number) => { head.writeUInt32LE(value >>> 0, at); at += 4; };
  const u16 = (value: number) => { head.writeUInt16LE(value, at); at += 2; };
  u32(central ? 0x02014b50 : 0x04034b50);
  if (central) u16(20); // skapad av version 2.0
  u16(20); u16(0x0800); u16(0); u16(stamp.time); u16(stamp.day); // version, UTF-8-namn, lagrad, tid
  u32(entry.crc); u32(entry.size); u32(entry.size); u16(entry.name.byteLength); u16(0);
  if (central) { u16(0); u16(0); u16(0); u32(0); u32(entry.offset); }
  entry.name.copy(head, at);
  return head;
}

/** Zip-filen som ström, exakt `plan.byteLength` byte. */
export async function* rawZipStream(plan: RawZipPlan, now = new Date()): AsyncGenerator<Uint8Array> {
  const stamp = dosTime(now);
  for (const entry of plan.entries) {
    yield header(entry, false, stamp);
    if (entry.bytes) { yield entry.bytes; continue; }
    let size = 0;
    for await (const chunk of createReadStream(entry.path!)) { size += (chunk as Buffer).byteLength; yield chunk as Buffer; }
    if (size !== entry.size) throw new Error(`${entry.name.toString("utf8")} ändrades medan zip-filen skickades`);
  }
  for (const entry of plan.entries) yield header(entry, true, stamp);
  const end = Buffer.alloc(END);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(plan.entries.length, 8); end.writeUInt16LE(plan.entries.length, 10);
  end.writeUInt32LE(plan.centralLength, 12); end.writeUInt32LE(plan.centralOffset, 16);
  yield end;
}

/** Texten som följer med i zip-filen: källan, villkoren och vad filerna är. */
export function rawZipReadme(input: { jobName: string; tiles: readonly string[]; clip: { minX: number; minY: number; maxX: number; maxY: number } | null; now: Date }): string {
  return [
    `Rå laserdata från O-Tid (körning ${input.jobName})`,
    `Packad ${input.now.toISOString().slice(0, 10)}.`,
    "",
    "Källa: Laserdata Nedladdning, skog © Lantmäteriet, CC BY 4.0. Ange källan ©Lantmäteriet när du använder datan.",
    "Lantmäteriets villkor för laserdata gäller den som hämtar. Laserdata kan innehålla personuppgifter.",
    "",
    input.clip
      ? `Filerna är klippta till rutan ${Math.round(input.clip.minX)}–${Math.round(input.clip.maxX)} E, ${Math.round(input.clip.minY)}–${Math.round(input.clip.maxY)} N (rutornas koordinatsystem, oftast SWEREF 99 TM).`
      : "Filerna är hela laserrutor (2,5 × 2,5 km).",
    `Rutorna: ${input.tiles.join(", ")}`,
    ""
  ].join("\r\n");
}

/**
 * PLAN.md M6: laserfilerna i `in/` (klippta till körningens ruta, annars hela rutorna) packas i en zip som strömmas direkt
 * till förrådets objektlagring med en försignerad länk från O-Tid; zip-filen skrivs aldrig till disken. Går det inte sägs det
 * till O-Tid (felet syns i körningen) och körningen fortsätter.
 */
export async function saveRawLaser(job: { readonly jobId: string; readonly tiles: readonly { readonly index: number; readonly id: string }[]; readonly clip: Box | null; readonly reach: Box | null },
  inDir: string, call: (path: string, init?: RequestInit) => Promise<Response>, signal: AbortSignal): Promise<void> {
  const report = (body: unknown) => call(`/api/geo-worker/jobs/${job.jobId}/raw-laser`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body) });
  const now = new Date();
  try {
    const names = (await readdir(inDir)).filter(name => /\.la[sz]$/i.test(name)).sort();
    if (names.length === 0) throw new Error("Inga laserfiler att spara");
    const entries = names.map(name => {
      const tile = job.tiles.find(row => row.index === Number(/(\d+)/.exec(name)?.[1]));
      const base = tile ? cacheName(tile.id).replace(/\.laz$/, "") : name.replace(/\.la[sz]$/i, "");
      return { name: `${base}${job.clip ? "_klippt" : ""}${/\.las$/i.test(name) ? ".las" : ".laz"}`, path: join(inDir, name) };
    });
    const readme = new TextEncoder().encode(rawZipReadme({ jobName: job.jobId, tiles: job.tiles.map(tile => tile.id), clip: job.reach, now }));
    const plan = await planRawZip([...entries, { name: "LASMIG.txt", bytes: readme }]);
    const started = await report({ step: "start", byteLength: plan.byteLength, files: plan.entries.length });
    if (!started.ok) {
      const error = (await started.json().catch(() => undefined) as { error?: string } | undefined)?.error;
      console.error(`Geo-jobb ${job.jobId}: rå laserdata sparas inte (${error ?? started.status})`);
      return;
    }
    const { uploadUrl } = await started.json() as { uploadUrl: string };
    for (let attempt = 1; ; attempt += 1) {
      let response: Response | undefined;
      try {
        response = await fetch(uploadUrl, { method: "PUT", headers: { "content-length": String(plan.byteLength), "content-type": "application/zip" },
          body: Readable.toWeb(Readable.from(rawZipStream(plan, now))) as unknown as BodyInit, duplex: "half",
          signal: AbortSignal.any([signal, AbortSignal.timeout(3 * 3600_000)]) } as RequestInit);
      } catch (error) {
        if (signal.aborted || attempt >= 3) throw error;
      }
      if (response?.ok) break;
      if (response && (attempt >= 3 || ![429, 500, 502, 503, 504].includes(response.status))) throw new Error(`uppladdningen till förrådet gav ${response.status}`);
      await sleep(attempt * 5_000);
    }
    const done = await report({ step: "done" });
    if (!done.ok) throw new Error(`förrådet tog inte emot zip-filen (${done.status})`);
    console.log(`Geo-jobb ${job.jobId}: rå laserdata sparad (${names.length} filer, ${Math.round(plan.byteLength / 1e6)} MB)`);
  } catch (error) {
    if (signal.aborted) throw error;
    const message = `Rå laserdata: ${error instanceof Error ? error.message : String(error)}`.slice(0, 480);
    console.error(`Geo-jobb ${job.jobId}: ${message}`);
    await report({ step: "failed", error: message }).catch(() => undefined);
  }
}
