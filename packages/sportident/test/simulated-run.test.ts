import { describe, expect, it } from "vitest";
import { cardTypeForNumber, normalizeCard, readSimulatedCard, simulatedRun, stationClock } from "../src";

const TIME_ZONE = "Europe/Stockholm";

describe("simulerat lopp", () => {
  it("räknar stationens klocka i tävlingens tidszon", () => {
    expect(stationClock(new Date("2026-10-01T17:45:00.000Z"), TIME_ZONE)).toEqual({ secondsOfDay: 19 * 3600 + 45 * 60, dayOfWeek: 4 });
    expect(stationClock(new Date("2026-12-31T23:30:00.000Z"), TIME_ZONE)).toEqual({ secondsOfDay: 30 * 60, dayOfWeek: 5 });
  });

  it("väljer bricktyp efter bricknummer", () => {
    expect(cardTypeForNumber(23_456)).toBe("SI5");
    expect(cardTypeForNumber(234_567)).toBe("SI5");
    expect(cardTypeForNumber(123_456)).toBeUndefined();
    expect(cardTypeForNumber(654_321)).toBe("SI6");
    expect(cardTypeForNumber(1_500_000)).toBe("SI9");
    expect(cardTypeForNumber(7_000_001)).toBe("SI10");
    expect(cardTypeForNumber(8_000_001)).toBe("SIAC");
    expect(cardTypeForNumber(3_000_000)).toBeUndefined();
    expect(cardTypeForNumber(0)).toBeUndefined();
  });

  it("läser ett helt lopp synkront genom protokollkoden för alla bricktyper", () => {
    const startAt = new Date("2026-10-01T16:00:00.000Z");
    const finishAt = new Date("2026-10-01T16:40:00.000Z");
    for (const cardNumber of [23_456, 234_567, 654_321, 2_100_000, 1_500_000, 4_100_000, 7_100_000, 8_100_000, 9_100_000]) {
      const { card, frames } = readSimulatedCard(simulatedRun(cardNumber, { startAt, finishAt, controlCodes: [31, 32, 33], timeZone: TIME_ZONE }));
      expect(frames.length).toBeGreaterThan(0);
      const normalized = normalizeCard(card, { reference: new Date("2026-10-01T16:45:00.000Z"), timeZone: TIME_ZONE });
      expect(normalized).toMatchObject({ cardNumber: String(cardNumber), startPunchedAt: startAt.toISOString(), finishPunchedAt: finishAt.toISOString() });
      expect(normalized.punches.map((punch) => [punch.code, punch.punchedAt])).toEqual([
        [31, "2026-10-01T16:10:00.000Z"], [32, "2026-10-01T16:20:00.000Z"], [33, "2026-10-01T16:30:00.000Z"]]);
    }
  });

  it("utelämnar mål när löparen inte stämplat mål", () => {
    const run = simulatedRun(8_100_000, { startAt: new Date("2026-10-01T16:00:00.000Z"), controlCodes: [], timeZone: TIME_ZONE });
    expect(run.finish).toBeUndefined();
    expect(readSimulatedCard(run).card.finish).toBeUndefined();
  });
});
