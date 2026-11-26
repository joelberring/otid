import { afterEach, describe, expect, it, vi } from "vitest";
import { createResultListReader } from "./use-result-list-data";
import { PublicBusyError } from "../../lib/public-stale";

const raceId = "10000000-0000-4000-8000-000000000001";
const results = { formatVersion: 7, results: [] };
const noRelay = { formatVersion: 1, classes: [] };
const radioOff = { formatVersion: 1, raceId, enabled: false, timeZone: "Europe/Stockholm", classes: [], latest: [] };

function stubFetch(relay: unknown, radio: unknown, staleRelay = false) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url.split("/").at(-1)!);
    const body = url.endsWith("/results") ? results : url.endsWith("/relay-results") ? relay : radio;
    const headers: Record<string, string> = staleRelay && url.endsWith("/relay-results") ? { "x-otid-stale": "1" } : {};
    return new Response(JSON.stringify(body), { status: 200, headers });
  });
  return calls;
}

describe("steg 51: resultatlistans hämtning", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("hämtar stafett och radio varje gång bara när de har innehåll, annars var 30:e sekund", async () => {
    let clock = 0;
    const calls = stubFetch(noRelay, radioOff);
    const read = createResultListReader(() => clock);
    expect(await read(raceId)).toMatchObject({ relay: noRelay, radio: radioOff });
    expect(calls.splice(0)).toEqual(["results", "relay-results", "radio"]);
    clock = 10_000;
    expect(await read(raceId)).toMatchObject({ relay: noRelay, radio: radioOff });
    expect(calls.splice(0)).toEqual(["results"]);
    clock = 30_000;
    await read(raceId);
    expect(calls.splice(0)).toEqual(["results", "relay-results", "radio"]);
  });

  it("en tävling med radio påslagen hämtar radiotiderna varje gång", async () => {
    let clock = 0;
    const calls = stubFetch(noRelay, { ...radioOff, enabled: true });
    const read = createResultListReader(() => clock);
    await read(raceId);
    calls.splice(0);
    clock = 5_000;
    await read(raceId);
    expect(calls).toEqual(["results", "radio"]);
  });

  it("säger till när något svar gäller en äldre version, så att sidan hämtar igen strax", async () => {
    stubFetch(noRelay, radioOff, true);
    const onStale = vi.fn();
    await createResultListReader()(raceId, onStale);
    expect(onStale).toHaveBeenCalledTimes(1);
    stubFetch(noRelay, radioOff);
    const fresh = vi.fn();
    await createResultListReader()(raceId, fresh);
    expect(fresh).not.toHaveBeenCalled();
  });

  it("steg 54: 503 från servern blir 'försök igen om en stund' (inget felbesked), och servern kan be om längre väntan", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ formatVersion: 1, error: "BUSY" }), { status: 503, headers: { "retry-after": "4" } }));
    const busy = await createResultListReader(() => 0)(raceId).catch((error: unknown) => error);
    expect(busy).toBeInstanceOf(PublicBusyError);
    expect((busy as PublicBusyError).retryAfterMs).toBe(4_000);
    const waits: (number | undefined)[] = [];
    vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify(url.endsWith("/results") ? results : url.endsWith("/radio") ? radioOff : noRelay),
      { headers: url.endsWith("/results") ? { "x-otid-stale": "1", "x-otid-stale-retry": "5" } : {} }));
    await createResultListReader(() => 0)(raceId, (ms) => waits.push(ms));
    expect(waits).toEqual([5_000]);
  });

  it("skickar If-None-Match och återanvänder befintligt objekt utan JSON.parse/Zod vid 304 (inkl. svag W/)", async () => {
    let clock = 0;
    const seenHeaders: (string | null)[] = [];
    let calls = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (url.includes("/results")) seenHeaders.push(headers.get("if-none-match"));
      calls += 1;
      if (calls <= 3) {
        const body = url.includes("/results") ? results : url.endsWith("/relay-results") ? noRelay : radioOff;
        return new Response(JSON.stringify(body), { status: 200, headers: { etag: `W/"tag-${url.split("/").at(-1)}"` } });
      }
      // 304 har ingen kropp; skulle läsaren anropa .json() kastas fel.
      return new Response(null, { status: 304, headers: { etag: 'W/"tag-results"' } });
    });
    const read = createResultListReader(() => clock);
    const first = await read(raceId);
    expect(seenHeaders).toEqual([null]);
    clock = 5_000;
    const second = await read(raceId);
    expect(seenHeaders).toEqual([null, 'W/"tag-results"']);
    expect(second).toBe(first);
  });

  it("hämtar /results?splits=0 vid kompakt läge och tömmer If-None-Match vid byte till fullt /results", async () => {
    let wantSplits = false;
    const requests: { url: string; inm: string | null }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (url.includes("/results")) requests.push({ url, inm: headers.get("if-none-match") });
      const body = url.includes("/results") ? results : url.endsWith("/relay-results") ? noRelay : radioOff;
      const tag = url.includes("splits=0") ? 'W/"compact"' : 'W/"full"';
      if (headers.get("if-none-match") === tag) return new Response(null, { status: 304, headers: { etag: tag } });
      return new Response(JSON.stringify(body), { status: 200, headers: { etag: tag } });
    });
    const read = createResultListReader(() => 0, { splits: () => wantSplits });
    const first = await read(raceId);
    const second = await read(raceId);
    expect(second).toBe(first);
    // Användaren öppnar Sträcktider-fliken → URL ändras till fullt /results, ingen gammal ETag skickas!
    wantSplits = true;
    const full = await read(raceId);
    expect(full).not.toBe(first);
    expect(requests).toEqual([
      { url: `/api/public/races/${raceId}/results?splits=0`, inm: null },
      { url: `/api/public/races/${raceId}/results?splits=0`, inm: 'W/"compact"' },
      { url: `/api/public/races/${raceId}/results`, inm: null }
    ]);
  });
});
