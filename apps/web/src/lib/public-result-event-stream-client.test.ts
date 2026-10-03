import { describe, expect, it } from "vitest";
import { startPublicResultEventStream } from "./public-result-event-stream-client";

class FakeEventSource {
  static current: FakeEventSource | undefined;
  readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();
  closed = false;
  constructor(readonly url: string) { FakeEventSource.current = this; }
  addEventListener(type: "refresh" | "reset", callback: (event: MessageEvent<string>) => void) { this.listeners.set(type, callback); }
  close() { this.closed = true; }
  emit(type: "refresh" | "reset", data: string) { this.listeners.get(type)?.({ data } as MessageEvent<string>); }
}

describe("TASK129 publikresultat-SSE-klient", () => {
  it("använder reset/refresh men ignorerar otillåten payload och behåller stängning", () => {
    let refreshes = 0;
    const stop = startPublicResultEventStream("10000000-0000-4000-8000-000000000001", FakeEventSource, () => { refreshes += 1; });
    const source = FakeEventSource.current;
    if (!source) throw new Error("Fake EventSource skapades inte");
    expect(source.url).toBe("/api/public/races/10000000-0000-4000-8000-000000000001/result-events");
    source.emit("reset", '{"formatVersion":1}');
    source.emit("refresh", '{"formatVersion":1,"entryId":"inte-tillåtet"}');
    source.emit("refresh", "inte-json");
    expect(refreshes).toBe(1);
    stop();
    expect(source.closed).toBe(true);
  });
});
