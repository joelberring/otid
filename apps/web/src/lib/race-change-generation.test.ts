import { describe, expect, it } from "vitest";
import { createPublicRaceCache, onlyNewResults } from "./public-race-cache";
import { bumpRaceChangeGeneration, raceChangeGeneration, RESULT_WRITES } from "./race-change-generation";
import { createSharedRead } from "./shared-read";

const race = "10000000-0000-4000-8000-000000000154";

describe("steg 54: en ändring i arbetsytan syns direkt", () => {
  it("räknar upp generationen per tävling; avläsningar räknas som nya resultat", () => {
    const before = raceChangeGeneration(race);
    bumpRaceChangeGeneration(race);
    expect(raceChangeGeneration(race)).toBe(before + 1);
    expect(raceChangeGeneration("10000000-0000-4000-8000-000000000155")).toBe(0);
    expect(RESULT_WRITES.has("readouts")).toBe(true);
    expect(RESULT_WRITES.has("entry-status")).toBe(false);
  });

  it("Kvar i skogen delas inte förbi en ändring", async () => {
    let computed = 0;
    const shared = createSharedRead(2_000);
    const read = () => shared(`forest-watch:${race}:${raceChangeGeneration(race)}`, async () => ++computed);
    expect([await read(), await read()]).toEqual([1, 1]);
    bumpRaceChangeGeneration(race);
    expect(await read()).toBe(2);
  });

  it("efter en ändring ges ingen äldre lista, också när bara resultatmarkören annars skiljer", async () => {
    let marker = 1, value = "före";
    const cache = createPublicRaceCache({ version: async () => `v:${marker}:x:g${raceChangeGeneration(race)}`, versionTtlMs: 0,
      minIntervalMs: 0, staleAllowed: onlyNewResults, serveStaleMs: 60_000 });
    expect((await cache.read(race, "results", async () => value)).value).toBe("före");
    // Bara nya resultat: den äldre listan får ges direkt (märkt).
    marker = 2;
    const stale = await cache.read(race, "results", async () => { await new Promise((resolve) => setTimeout(resolve, 50)); return "nytt resultat"; });
    expect([stale.value, stale.stale]).toEqual(["före", true]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    // En ändring i arbetsytan (status) med samma markör: nästa läsning väntar in den nya listan.
    value = "efter ändringen"; bumpRaceChangeGeneration(race);
    const fresh = await cache.read(race, "results", async () => value);
    expect([fresh.value, fresh.stale]).toEqual(["efter ändringen", undefined]);
  });
});
