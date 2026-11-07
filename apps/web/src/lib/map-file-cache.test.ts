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

  it("en hämtning per sha256 när flera ber samtidigt; var och en får en egen kopia och förloppet, den som avbryter slutar vänta", async () => {
    const { backend, files } = memoryBackend();
    const cache = new MapFileCache(() => backend);
    const one = file(4000, 7);
    let release!: () => void;
    const fetchFile = vi.fn(async (progress: (fraction: number) => void) => {
      await new Promise<void>(resolve => { release = resolve; });
      progress(1);
      return { bytes: one.bytes.slice(0), fileName: one.fileName };
    });
    const seen: number[][] = [[], []];
    const controller = new AbortController();
    const first = cache.fetchOnce(one.sha256, fetchFile, { onProgress: fraction => seen[0]!.push(fraction) });
    const second = cache.fetchOnce(one.sha256, fetchFile, { onProgress: fraction => seen[1]!.push(fraction) });
    const gone = cache.fetchOnce(one.sha256, fetchFile, { signal: controller.signal });
    controller.abort();
    await expect(gone).rejects.toMatchObject({ name: "AbortError" });
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(fetchFile).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([[1], [1]]);
    // Egna kopior: den ena kan gå över till en Worker utan att den andra töms.
    expect(a.bytes).not.toBe(b.bytes);
    structuredClone(a.bytes, { transfer: [a.bytes] });
    expect(b.bytes.byteLength).toBe(4000);
    await vi.waitFor(() => expect(files.has(one.sha256)).toBe(true));
    // Efteråt börjar en ny hämtning.
    release = () => undefined;
    const again = cache.fetchOnce(one.sha256, fetchFile);
    release();
    await again;
    expect(fetchFile).toHaveBeenCalledTimes(2);
  });
});
