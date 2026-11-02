import { describe, expect, it } from "vitest";
import { moveToRaceDate } from "../src/race-clock";

const zone = "Europe/Stockholm";

describe("starttider till ett nytt datum (ADR-0188 beslut 3)", () => {
  it("behåller klockslaget en vecka senare", () => {
    expect(moveToRaceDate(new Date("2026-12-02T09:00:00Z"), "2026-12-02", "2026-12-09", zone)?.toISOString()).toBe("2026-12-09T09:00:00.000Z");
  });

  it("behåller klockslaget över sommartidens början", () => {
    // 10:00 vintertid (09:00 UTC) blir 10:00 sommartid (08:00 UTC).
    expect(moveToRaceDate(new Date("2026-03-21T09:00:00Z"), "2026-03-21", "2026-04-04", zone)?.toISOString()).toBe("2026-04-04T08:00:00.000Z");
  });

  it("låter en start efter midnatt stanna dagen efter det nya datumet", () => {
    // 00:30 natten efter 2026-12-02 blir 00:30 natten efter 2026-12-09.
    expect(moveToRaceDate(new Date("2026-12-02T23:30:00Z"), "2026-12-02", "2026-12-09", zone)?.toISOString()).toBe("2026-12-09T23:30:00.000Z");
  });

  it("flyttar bakåt och behåller sekunderna", () => {
    expect(moveToRaceDate(new Date("2026-12-09T09:01:30Z"), "2026-12-09", "2026-12-01", zone)?.toISOString()).toBe("2026-12-01T09:01:30.000Z");
  });

  it("flyttar ett klockslag som inte finns en timme fram", () => {
    // 02:30 finns inte 2026-03-29 i Stockholm.
    expect(moveToRaceDate(new Date("2026-03-22T01:30:00Z"), "2026-03-22", "2026-03-29", zone)?.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  it("avvisar ogiltiga datum", () => {
    expect(moveToRaceDate(new Date("2026-12-02T09:00:00Z"), "2026-12-02", "9 dec", zone)).toBeNull();
  });
});
