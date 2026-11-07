import { describe, expect, it, vi } from "vitest";
import { serialRefresh, STREAM_OPEN_INTERVAL_MS, timerShouldFetch } from "./use-public-race-data";

describe("steg 51: sidans egen hämtning när resultatströmmen är öppen", () => {
  it("hämtar var femte sekund utan ström och bara som reserv (10 s) när strömmen väcker sidan", () => {
    expect(timerShouldFetch(false, 0, 5_000, 5_000)).toBe(true);
    expect(timerShouldFetch(true, 0, 5_000, 5_000)).toBe(false);
    expect(timerShouldFetch(true, 0, 9_000, 5_000)).toBe(false);
    expect(timerShouldFetch(true, 0, STREAM_OPEN_INTERVAL_MS, 5_000)).toBe(true);
    // Arbetsytans intervall (15 s) gäller som förut, även med öppen ström.
    expect(timerShouldFetch(true, 0, 15_000, 15_000)).toBe(true);
    expect(timerShouldFetch(true, 0, 30_000, 60_000)).toBe(false);
  });
});

describe("städrundan 2026-11-07: en väckning under en pågående hämtning", () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
  };

  it("tappas inte: sidan hämtar igen direkt efter den pågående hämtningen, en gång", async () => {
    const gates: ReturnType<typeof deferred>[] = [];
    const run = vi.fn(async () => { const gate = deferred(); gates.push(gate); await gate.promise; return "done" as const; });
    const refresh = serialRefresh(run);
    const first = refresh();
    expect(run).toHaveBeenCalledTimes(1);
    // Två väckningar och en timer medan den första hämtningen pågår: ingen ny hämtning samtidigt.
    void refresh(true); void refresh(true); void refresh();
    expect(run).toHaveBeenCalledTimes(1);
    gates[0]!.resolve();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    gates[1]!.resolve();
    await first;
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("utan väckning (bara timern) blir det ingen extra hämtning, och inte heller när servern bad sidan vänta", async () => {
    let release!: () => void;
    const timerOnly = vi.fn(() => new Promise<"done">(done => { release = () => done("done"); }));
    const refresh = serialRefresh(timerOnly);
    const first = refresh();
    void refresh();
    release();
    await first;
    expect(timerOnly).toHaveBeenCalledTimes(1);

    let busy!: () => void;
    const crowded = vi.fn(() => new Promise<"busy">(done => { busy = () => done("busy"); }));
    const again = serialRefresh(crowded);
    const pending = again();
    void again(true);
    busy();
    await pending;
    expect(crowded).toHaveBeenCalledTimes(1);
  });
});
