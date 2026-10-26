import { describe, expect, it } from "vitest";
import { createPublicLoad, publicBusyResponse } from "./public-load";
import { createPublicRaceCache, onlyNewResults } from "./public-race-cache";
import { PublicBusyError, staleRetryMs, throwIfBusy } from "./public-stale";

const race = "10000000-0000-4000-8000-000000000054";
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const options = { limit: 2, queue: 2, maxWaitMs: 50, streams: 2, lagMs: 100 };

describe("steg 54: lastavlastning för publiken (ADR-0177)", () => {
  it("släpper in högst `limit` åt gången, köar nästa och svarar busy när kön är full", async () => {
    const load = createPublicLoad({ ...options, loopLag: () => 0 });
    const first = await load.admit(), second = await load.admit();
    expect([first.kind, second.kind]).toEqual(["admitted", "admitted"]);
    const queued = load.admit(), queued2 = load.admit();
    const full = await load.admit();
    expect(full.kind).toBe("busy");
    if (full.kind === "busy") expect(full.retryAfterSeconds).toBeGreaterThanOrEqual(2);
    expect(load.stats()).toMatchObject({ active: 2, waiting: 2 });
    if (first.kind === "admitted") { first.release(); first.release(); }
    expect((await queued).kind).toBe("admitted");
    // Den som väntat för länge får busy i stället för att hänga kvar.
    expect((await queued2).kind).toBe("busy");
    expect(load.stats().waiting).toBe(0);
  });

  it("räknar en kö eller en händelseloop som ligger efter som tryck, och trycket varar 10 s", () => {
    let now = 0, lag = 0;
    const load = createPublicLoad({ ...options, now: () => now, loopLag: () => lag });
    expect(load.pressure()).toBe(false);
    now = 1_000; lag = 400;
    expect(load.pressure()).toBe(true);
    now = 5_000; lag = 0;
    expect(load.pressure()).toBe(true);
    now = 12_000;
    expect(load.pressure()).toBe(false);
  });

  it("har ett tak för öppna strömmar; en stängd ström lämnar plats (en gång)", () => {
    const load = createPublicLoad({ ...options, loopLag: () => 0 });
    const a = load.openStream(), b = load.openStream();
    expect(a && b).toBeTruthy();
    expect(load.openStream()).toBeNull();
    a!(); a!();
    expect(load.stats().streams).toBe(1);
    expect(load.openStream()).not.toBeNull();
  });

  it("svarar 503 med Retry-After, och sidan känner igen det som 'försök igen' i stället för fel", async () => {
    const response = publicBusyResponse(4);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("4");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(() => throwIfBusy(new Response("{}"), response)).toThrow(PublicBusyError);
    try { throwIfBusy(response); } catch (error) { expect((error as PublicBusyError).retryAfterMs).toBe(4_000); }
    expect(() => throwIfBusy(new Response("{}"), undefined)).not.toThrow();
    expect(staleRetryMs(new Response(null, { headers: { "x-otid-stale-retry": "5" } }), new Response(null))).toBe(5_000);
    expect(staleRetryMs(new Response(null))).toBeUndefined();
  });

  it("under tryck ges den senast färdiga listan längre och glesare, med en längre väntan till nästa hämtning", async () => {
    let version = "a:1", busy = false, computed = 0;
    const cache = createPublicRaceCache({ version: async () => version, versionTtlMs: 0, minIntervalMs: 0, staleAllowed: onlyNewResults,
      pressure: () => busy, pressureStaleMs: 10_000, pressureIntervalMs: 200, pressureRetryMs: 5_000, waitMs: 1_000 });
    const compute = async () => { computed += 1; await delay(30); return version; };
    expect((await cache.read(race, "results", compute)).value).toBe("a:1");
    await delay(1_100);
    // Utan tryck: listan är äldre än 1 s, så anropet väntar på den nya.
    version = "a:2";
    expect((await cache.read(race, "results", compute)).value).toBe("a:2");
    await delay(1_100);
    busy = true; version = "a:3";
    const stale = await cache.read(race, "results", compute);
    expect([stale.value, stale.stale, stale.retryMs]).toEqual(["a:2", true, 5_000]);
    // Något annat än nya resultat (andra delen av versionen) väntar som förut, även under tryck.
    await delay(300);
    version = "b:3";
    expect((await cache.read(race, "results", compute)).value).toBe("b:3");
    expect(computed).toBeGreaterThanOrEqual(4);
  });

  it("tävlingens instans ger en uträkning högst en sjättedel av processen", async () => {
    let version = "a:1";
    const cache = createPublicRaceCache({ version: async () => version, versionTtlMs: 0, minIntervalMs: 0, serveStaleMs: 0,
      waitMs: 5_000, computeShare: 6 });
    const compute = async () => { await delay(40); return version; };
    await cache.read(race, "results", compute);
    version = "a:2";
    const started = Date.now();
    await cache.read(race, "results", compute);
    // Nästa uträkning tidigast 6 × 40 ms efter förra starten.
    expect(Date.now() - started).toBeGreaterThanOrEqual(180);
  });
});
