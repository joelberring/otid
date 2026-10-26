import { afterEach, describe, expect, it, vi } from "vitest";
import { startPublicResultEventStream } from "./public-result-event-stream-client";

class FakeEventSource {
  static current: FakeEventSource | undefined;
  readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();
  closed = false;
  constructor(readonly url: string) { FakeEventSource.current = this; }
  addEventListener(type: "refresh" | "reset" | "open" | "error", callback: (event: MessageEvent<string>) => void) { this.listeners.set(type, callback); }
  close() { this.closed = true; }
  emit(type: "refresh" | "reset" | "open" | "error", data = "") { this.listeners.get(type)?.({ data } as MessageEvent<string>); }
}

describe("TASK129 publikresultat-SSE-klient", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("använder reset/refresh men ignorerar otillåten payload och behåller stängning", () => {
    vi.useFakeTimers();
    let refreshes = 0;
    const stop = startPublicResultEventStream("10000000-0000-4000-8000-000000000001", FakeEventSource, () => { refreshes += 1; },
      { spreadMs: 0, minGapMs: 0 });
    const source = FakeEventSource.current;
    if (!source) throw new Error("Fake EventSource skapades inte");
    expect(source.url).toBe("/api/public/races/10000000-0000-4000-8000-000000000001/result-events");
    source.emit("reset", '{"formatVersion":1}');
    source.emit("refresh", '{"formatVersion":1,"entryId":"inte-tillåtet"}');
    source.emit("refresh", "inte-json");
    vi.runAllTimers();
    expect(refreshes).toBe(1);
    stop();
    expect(source.closed).toBe(true);
  });

  it("steg 51: samlar täta väckningar och sprider hämtningen (högst en per minGapMs, slumpad fördröjning)", () => {
    vi.useFakeTimers({ now: 0 });
    const runs: number[] = [];
    const stop = startPublicResultEventStream("10000000-0000-4000-8000-000000000001", FakeEventSource, () => { runs.push(Date.now()); },
      { spreadMs: 1_000, minGapMs: 2_000, random: () => 0.5 });
    const source = FakeEventSource.current!;
    // Fem händelser på en sekund (målrusning) ger en hämtning efter den slumpade fördröjningen.
    for (let index = 0; index < 5; index += 1) { source.emit("refresh", '{"formatVersion":1}'); vi.advanceTimersByTime(200); }
    expect(runs).toEqual([500]);
    // Nästa händelse direkt efter: väntar tills två sekunder gått sedan förra hämtningen, plus spridningen.
    source.emit("refresh", '{"formatVersion":1}');
    vi.advanceTimersByTime(5_000);
    expect(runs).toEqual([500, 3_000]);
    // En väckning som väntar när sidan stängs ger ingen hämtning.
    source.emit("refresh", '{"formatVersion":1}');
    stop();
    vi.advanceTimersByTime(5_000);
    expect(runs).toEqual([500, 3_000]);
  });
});
