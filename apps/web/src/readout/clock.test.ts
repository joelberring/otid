import { describe, expect, it } from "vitest";
import { chooseReadoutClock } from "./clock";
import { readoutText } from "./text-sv";

describe("klockan som tiderna löses mot (steg 45)", () => {
  it("använder stationens klocka vid vanlig avvikelse", () => {
    expect(chooseReadoutClock({ stationOffsetMs: 1_234.4 })).toEqual({ referenceOffsetMs: 1_234.4, clockSource: "station",
      clockOffsetMs: 1_234, stationIgnored: false });
    expect(chooseReadoutClock({ stationOffsetMs: -6 * 3_600_000 }).clockSource).toBe("station");
  });

  it("använder datorns klocka när stationen går mer än sex timmar fel, och sparar avvikelsen", () => {
    const wrong = -(2 * 365 * 86_400_000);
    expect(chooseReadoutClock({ stationOffsetMs: wrong })).toEqual({ referenceOffsetMs: 0, clockSource: "device",
      clockOffsetMs: wrong, stationIgnored: true });
    expect(chooseReadoutClock({ stationOffsetMs: 6 * 3_600_000 + 1 })).toMatchObject({ clockSource: "device", referenceOffsetMs: 0 });
  });

  it("datorns klocka utan station, och övningsstationens klocka oavsett avstånd", () => {
    expect(chooseReadoutClock({})).toEqual({ referenceOffsetMs: 0, clockSource: "device", stationIgnored: false });
    expect(chooseReadoutClock({ stationOffsetMs: 1, exerciseOffsetMs: 30 * 86_400_000 })).toMatchObject({ clockSource: "station",
      referenceOffsetMs: 30 * 86_400_000 });
  });

  it("beskedet säger hur fel klockan går och att datorns klocka gäller", () => {
    expect(readoutText.clockIgnored(-(3 * 1_440 + 125))).toBe("Stationens klocka går helt fel (3 dygn 2 h efter datorn). O-Tid räknar " +
      "stämplingstiderna mot datorns klocka i stället. Kontrollera att datorns klocka stämmer, och ställ stationens klocka innan nästa tävling.");
    expect(readoutText.clockIgnored(7 * 60 + 5)).toContain("(7 h 5 min före datorn)");
  });
});
