import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import { environmentNumber } from "./instance-role";

/**
 * Steg 54 (ADR-0177): lastavlastning för publiken. Tävlingen (arbetsytan, avläsningen, funktionärerna) går alltid före;
 * när publiken är fler än servern hinner med blir resultatredovisningen glesare i stället för att något slutar fungera.
 *
 * - **Tryck:** processens händelseloop ligger efter (p99 över `lagMs` den senaste sekunden) eller kön till publika anrop
 *   växer. Då ger cachen den senast färdiga listan längre (stale) och räknar om glesare, och resultatströmmen väcker
 *   publiken mer sällan (`public-race-cache.ts`, `public-result-event-stream.ts`).
 * - **Tak:** högst `limit` publika anrop åt gången; nästa väntar i en kö (högst `queue` anrop, högst `maxWaitMs`). Är
 *   kön full eller väntan för lång svarar servern 503 med Retry-After, och sidan försöker igen tyst med det den redan
 *   visar. Inloggade (arrangörer, funktionärer) räknas inte här.
 * - **Strömmar:** högst `streams` öppna resultatströmmar per instans; nästa får 503 och sidan hämtar själv tills den
 *   ansluter igen.
 */
export type PublicLoadOptions = {
  readonly limit: number;
  readonly queue: number;
  readonly maxWaitMs: number;
  readonly streams: number;
  readonly lagMs: number;
  readonly now?: () => number;
  /** Händelseloopens fördröjning (p99, ms) sedan förra anropet; förval `monitorEventLoopDelay`. */
  readonly loopLag?: () => number;
};

export type PublicSlot = { readonly kind: "admitted"; release: () => void } | { readonly kind: "busy"; readonly retryAfterSeconds: number };

export function createPublicLoad(options: PublicLoadOptions) {
  const now = options.now ?? Date.now;
  let active = 0, streams = 0;
  const waiting: { resolve: (slot: PublicSlot) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  let histogram: IntervalHistogram | undefined;
  const loopLag = options.loopLag ?? (() => {
    if (!histogram) { histogram = monitorEventLoopDelay({ resolution: 20 }); histogram.enable(); return 0; }
    const lag = histogram.percentile(99) / 1e6;
    histogram.reset();
    return lag;
  });
  let lag = { at: Number.NEGATIVE_INFINITY, value: 0 }, pressureUntil = Number.NEGATIVE_INFINITY;

  /** Under tryck? Mäts högst en gång per sekund; ett tryck varar minst 10 s, så att listorna inte växlar fram och tillbaka. */
  function pressure(): boolean {
    if (now() - lag.at >= 1_000) {
      lag = { at: now(), value: loopLag() };
      if (lag.value > options.lagMs || waiting.length > 0) pressureUntil = now() + 10_000;
    }
    return now() < pressureUntil;
  }

  const retryAfter = () => 2 + Math.floor(Math.random() * 4);
  const release = () => {
    const next = waiting.shift();
    if (next) { clearTimeout(next.timer); next.resolve({ kind: "admitted", release: once(release) }); return; }
    active -= 1;
  };

  /** En plats för ett publikt anrop (släpps med `release`), eller "busy" med sekunder till nästa försök. */
  function admit(): Promise<PublicSlot> {
    if (active < options.limit) { active += 1; return Promise.resolve({ kind: "admitted", release: once(release) }); }
    if (waiting.length >= options.queue) { pressureUntil = now() + 10_000; return Promise.resolve({ kind: "busy", retryAfterSeconds: retryAfter() }); }
    pressureUntil = now() + 10_000;
    return new Promise((resolve) => {
      const entry = { resolve, timer: setTimeout(() => {
        const index = waiting.indexOf(entry);
        if (index >= 0) waiting.splice(index, 1);
        resolve({ kind: "busy", retryAfterSeconds: retryAfter() });
      }, options.maxWaitMs) };
      waiting.push(entry);
    });
  }

  /** En öppen resultatström, eller null när taket är nått. Funktionen som ges tillbaka stänger den (en gång). */
  function openStream(): (() => void) | null {
    if (streams >= options.streams) return null;
    streams += 1;
    return once(() => { streams -= 1; });
  }

  return { admit, openStream, pressure, stats: () => ({ active, waiting: waiting.length, streams }) };
}

function once(run: () => void): () => void {
  let done = false;
  return () => { if (!done) { done = true; run(); } };
}

/** 503 för publiken: försök igen om en stund (sidan gör det tyst och visar det den har). */
export function publicBusyResponse(retryAfterSeconds: number): Response {
  return Response.json({ formatVersion: 1, error: "BUSY" }, { status: 503,
    headers: { "retry-after": String(retryAfterSeconds), "cache-control": "no-store" } });
}

const globalLoad = globalThis as typeof globalThis & { oTidPublicLoad?: ReturnType<typeof createPublicLoad> };

/** Processens lastavlastning, med gränserna ur miljön (docs/drift.md). */
export function publicLoad(): ReturnType<typeof createPublicLoad> {
  return globalLoad.oTidPublicLoad ??= createPublicLoad({
    limit: environmentNumber(process.env, "OTID_PUBLIC_CONCURRENCY", 24),
    queue: environmentNumber(process.env, "OTID_PUBLIC_QUEUE", 600),
    maxWaitMs: environmentNumber(process.env, "OTID_PUBLIC_MAX_WAIT_MS", 8_000),
    streams: environmentNumber(process.env, "OTID_PUBLIC_STREAMS_MAX", 3_000),
    lagMs: environmentNumber(process.env, "OTID_PUBLIC_LAG_MS", 150)
  });
}
