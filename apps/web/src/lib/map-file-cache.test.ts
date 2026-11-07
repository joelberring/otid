import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MapFileCache, type CachedMapFile, type MapCacheBackend, type MapCacheMeta } from "./map-file-cache";

function memoryBackend() {
  const files = new Map<string, CachedMapFile>();
  const meta = new Map<string, MapCacheMeta>();
  const backend: MapCacheBackend = {
    get: async sha256 => files.get(sha256),
    put: async (item, file) => { files.set(item.sha256, file); meta.set(item.sha256, item); },
    touch: async item => { meta.set(item.sha256, item); },
    list: async () => [...meta.values()],
    remove: async sha256s => { for (const sha256 of sha256s) { files.delete(sha256); meta.delete(sha256); } },
    clear: async () => { files.clear(); meta.clear(); }
  };
  return { backend, files, meta };
}

const file = (size: number, seed: number) => {
  const bytes = new Uint8Array(size).map((_, index) => (index * 31 + seed) % 251);
  return { bytes: bytes.buffer, fileName: `karta-${seed}.ocd`, sha256: createHash("sha256").update(bytes).digest("hex") };
};

describe("kartfilerna i webbläsaren per sha256 (ADR-0218)", () => {
  it("nyckeln är filens sha256: rätt fil kommer tillbaka, en fil med annat innehåll sparas inte", async () => {
    const { backend } = memoryBackend();
    const cache = new MapFileCache(() => backend);
    const one = file(1000, 1);
    expect(await cache.read(one.sha256)).toBeUndefined();
    expect(await cache.store(one.sha256, { bytes: one.bytes, fileName: one.fileName })).toBe(true);
    const back = await cache.read(one.sha256);
    expect(back?.fileName).toBe("karta-1.ocd");
    expect([...new Uint8Array(back!.bytes)]).toEqual([...new Uint8Array(one.bytes)]);
    // Fel sha256 för innehållet, och ogiltiga nycklar.
    const two = file(1000, 2);
    expect(await cache.store(one.sha256.replace(/^./, one.sha256[0] === "a" ? "b" : "a"), { bytes: two.bytes, fileName: "fel.ocd" })).toBe(false);
    expect(await cache.store("../x", { bytes: two.bytes, fileName: "fel.ocd" })).toBe(false);
    expect(await cache.read("../x")).toBeUndefined();
  });

  it("behåller de tre senast använda filerna", async () => {
    const { backend, meta } = memoryBackend();
    let now = 0;
    const cache = new MapFileCache(() => backend, () => ++now);
    const files = [1, 2, 3, 4].map(seed => file(500, seed));
    for (const item of files.slice(0, 3)) await cache.store(item.sha256, item);
    // Den första används igen och blir kvar; den andra är äldst när den fjärde kommer.
    await cache.read(files[0]!.sha256);
    await cache.store(files[3]!.sha256, files[3]!);
    expect(new Set(meta.keys())).toEqual(new Set([files[0]!.sha256, files[2]!.sha256, files[3]!.sha256]));
  });

  it("utan lager eller med fel i lagret hämtas filen som förut (inget kastas), och rensningen tömmer allt", async () => {
    const one = file(100, 5);
    expect(await new MapFileCache(() => undefined).read(one.sha256)).toBeUndefined();
    expect(await new MapFileCache(() => undefined).store(one.sha256, one)).toBe(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken = { ...memoryBackend().backend, get: async () => { throw new Error("QuotaExceededError"); },
      put: async () => { throw new Error("QuotaExceededError"); } };
    const cache = new MapFileCache(() => broken);
    expect(await cache.read(one.sha256)).toBeUndefined();
    expect(await cache.store(one.sha256, one)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    const { backend, files } = memoryBackend();
    const working = new MapFileCache(() => backend);
    await working.store(one.sha256, one);
    await working.clear();
    expect(files.size).toBe(0);
  });
});
