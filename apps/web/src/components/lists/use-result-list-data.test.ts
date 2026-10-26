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
});
