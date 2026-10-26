import { describe, expect, it } from "vitest";
import { STREAM_OPEN_INTERVAL_MS, timerShouldFetch } from "./use-public-race-data";

describe("steg 51: sidans egen hämtning när resultatströmmen är öppen", () => {
  it("hämtar var femte sekund utan ström och bara som reserv (15 s) när strömmen väcker sidan", () => {
    expect(timerShouldFetch(false, 0, 5_000, 5_000)).toBe(true);
    expect(timerShouldFetch(true, 0, 5_000, 5_000)).toBe(false);
    expect(timerShouldFetch(true, 0, 10_000, 5_000)).toBe(false);
    expect(timerShouldFetch(true, 0, STREAM_OPEN_INTERVAL_MS, 5_000)).toBe(true);
    // Arbetsytans intervall (15 s) gäller som förut, även med öppen ström.
    expect(timerShouldFetch(true, 0, 15_000, 15_000)).toBe(true);
    expect(timerShouldFetch(true, 0, 30_000, 60_000)).toBe(false);
  });
});
