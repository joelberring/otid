import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { clearLeftovers } from "../../../scripts/geo-cache.ts";
import { planRawZip, rawZipStream, saveRawLaser } from "../../../scripts/geo-raw-zip.ts";

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(Buffer.from(chunk));
  return Buffer.concat(parts);
}

/** Läser zip-filen via den centrala katalogen, som en vanlig uppackare gör. */
function unzip(zip: Buffer): Map<string, Buffer> {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const crc = zip.readUInt32LE(at + 16), size = zip.readUInt32LE(at + 24), nameLength = zip.readUInt16LE(at + 28), offset = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    expect(zip.readUInt32LE(offset)).toBe(0x04034b50);
    const start = offset + 30 + zip.readUInt16LE(offset + 26);
    const data = zip.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);
    out.set(name, data);
    at += 46 + nameLength;
  }
  return out;
}

describe("rå laserdata i en zip (PLAN.md M6)", () => {
  it("ger en zip med exakt den längd som planen säger, och filerna oförändrade", async () => {
    const dir = await mkdtemp(join(tmpdir(), "otid-raw-"));
    const big = Buffer.alloc(300_000, 7);
    await writeFile(join(dir, "ruta00.laz"), big);
    await writeFile(join(dir, "ruta01.laz"), "LASF");
    const plan = await planRawZip([{ name: "24A_1.laz", path: join(dir, "ruta00.laz") }, { name: "24A_2.laz", path: join(dir, "ruta01.laz") },
      { name: "LÄSMIG.txt", bytes: new TextEncoder().encode("hej") }]);
    const zip = await collect(rawZipStream(plan));
    expect(zip.length).toBe(plan.byteLength);
    const files = unzip(zip);
    expect([...files.keys()]).toEqual(["24A_1.laz", "24A_2.laz", "LÄSMIG.txt"]);
    expect(files.get("24A_1.laz")!.equals(big)).toBe(true);
    expect(files.get("24A_2.laz")!.toString()).toBe("LASF");
  });

  it("laddar upp till länken från O-Tid och säger till när det är klart, eller när det inte gick", async () => {
    const dir = await mkdtemp(join(tmpdir(), "otid-raw-"));
    await writeFile(join(dir, "ruta00.laz"), "LASF123");
    const calls: { path: string; body: unknown }[] = [];
    const call = async (path: string, init: RequestInit = {}) => {
      const body = JSON.parse(init.body as string) as { step: string };
      calls.push({ path, body });
      return body.step === "start" ? Response.json({ uploadUrl: "http://127.0.0.1:1/förråd" }) : Response.json({ status: "ok" });
    };
    const job = { jobId: "11111111-1111-4111-8111-111111111111", tiles: [{ index: 0, id: "24A001_65775_6575_25" }], clip: null, reach: null };
    const realFetch = globalThis.fetch;
    let uploaded: Buffer | undefined;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      uploaded = await collect(init.body as unknown as AsyncIterable<Uint8Array>);
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    try { await saveRawLaser(job, dir, call, new AbortController().signal); } finally { globalThis.fetch = realFetch; }
    expect(calls.map(entry => (entry.body as { step: string }).step)).toEqual(["start", "done"]);
    expect([...unzip(uploaded!).keys()]).toEqual(["24A001_65775_6575_25.laz", "LASMIG.txt"]);
    globalThis.fetch = (async () => new Response(null, { status: 403 })) as unknown as typeof fetch;
    calls.length = 0;
    try { await saveRawLaser(job, dir, call, new AbortController().signal); } finally { globalThis.fetch = realFetch; }
    expect(calls.map(entry => entry.body)).toEqual([expect.objectContaining({ step: "start" }), { step: "failed", error: "Rå laserdata: uppladdningen till förrådet gav 403" }]);
  });

  it("tar bort kvarlämnade jobbkataloger och laserrutor men inget annat", async () => {
    const work = await mkdtemp(join(tmpdir(), "otid-work-")), cache = await mkdtemp(join(tmpdir(), "otid-cache-"));
    await mkdir(join(work, "0f8e1c2a-1111-4111-8111-111111111111", "in"), { recursive: true });
    await writeFile(join(work, "0f8e1c2a-1111-4111-8111-111111111111", "in", "ruta00.laz"), "x");
    await writeFile(join(work, "annat.txt"), "behålls");
    await writeFile(join(cache, "a.laz"), "x");
    await writeFile(join(cache, "b.laz.del"), "x");
    expect(await clearLeftovers(work, cache)).toBe(3);
    expect(await readdir(work)).toEqual(["annat.txt"]);
    expect(await readdir(cache)).toEqual([]);
  });
});
