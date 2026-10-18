import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_TOLERANCE_MS, decodeSiTime, decodeStationClock, encodeStationClock, resolveSiTime, SiTimeError, stationClockFromDate,
  stationClockToDate, wallClockToUtc
} from "../src";

const zone = "Europe/Stockholm";

describe("decodeSiTime", () => {
  it("returnerar undefined för tom tid", () => {
    expect(decodeSiTime(0xee, 0xee)).toBeUndefined();
    expect(decodeSiTime(0xee, 0xee, 0)).toBeUndefined();
  });

  it("läser AM/PM och veckodag", () => {
    expect(decodeSiTime(0x00, 0x3c, 0b0000_1101)).toEqual({ secondsIn12h: 60, pm: true, dayOfWeek: 6 });
    expect(decodeSiTime(0x00, 0x3c, 0b0000_0000)).toEqual({ secondsIn12h: 60, pm: false, dayOfWeek: 0 });
  });

  it("utelämnar okänd veckodag (111)", () => {
    expect(decodeSiTime(0x00, 0x3c, 0b0000_1110)).toEqual({ secondsIn12h: 60, pm: false });
  });
});

describe("wallClockToUtc", () => {
  it("räknar sommar- och vintertid", () => {
    expect(wallClockToUtc(2026, 7, 1, 12 * 3600, zone).toISOString()).toBe("2026-07-01T10:00:00.000Z");
    expect(wallClockToUtc(2026, 12, 1, 12 * 3600, zone).toISOString()).toBe("2026-12-01T11:00:00.000Z");
  });
});

describe("resolveSiTime", () => {
  it("SI5 utan AM/PM väljer senaste halvdygn före avläsningen", () => {
    // Avläsning 14:30 lokal tid. 10:00 kan vara 10:00 eller 22:00; 22:00 är i framtiden.
    const reference = new Date("2026-10-03T12:30:00Z");
    expect(resolveSiTime({ secondsIn12h: 10 * 3600 }, { reference, timeZone: zone }).toISOString()).toBe("2026-10-03T08:00:00.000Z");
    // 02:15 i 12h-format betyder 14:15 samma dag.
    expect(resolveSiTime({ secondsIn12h: 2 * 3600 + 15 * 60 }, { reference, timeZone: zone }).toISOString()).toBe("2026-10-03T12:15:00.000Z");
  });

  it("tål att stationens klocka går lite före datorns", () => {
    const reference = new Date("2026-10-03T12:30:00Z"); // 14:30
    const t = { secondsIn12h: 2 * 3600 + 35 * 60, pm: true, dayOfWeek: 6 }; // 14:35
    expect(resolveSiTime(t, { reference, timeZone: zone }).toISOString()).toBe("2026-10-03T12:35:00.000Z");
    expect(resolveSiTime(t, { reference, timeZone: zone, toleranceMs: 0 }).toISOString()).toBe("2026-09-26T12:35:00.000Z");
  });

  // PLAN.md steg 22: klockskillnad mellan kontrollenheter, avläsningsstation och dator.
  it("flyttar inte en stämpling 11 minuter 'i framtiden' en vecka eller tolv timmar bakåt", () => {
    expect(DEFAULT_TIME_TOLERANCE_MS).toBe(2 * 3_600_000);
    // Datorn tror att klockan är 12:08 lokal tid; målstämplingen är 12:20 (SI6+ med veckodag, och SI5 utan).
    const reference = new Date("2026-10-03T10:08:00Z");
    expect(resolveSiTime({ secondsIn12h: 20 * 60, pm: true, dayOfWeek: 6 }, { reference, timeZone: zone }).toISOString())
      .toBe("2026-10-03T10:20:00.000Z");
    expect(resolveSiTime({ secondsIn12h: 20 * 60 }, { reference, timeZone: zone }).toISOString()).toBe("2026-10-03T10:20:00.000Z");
    // Mer än toleransen före referensen tolkas som förra veckan (SI6+) respektive förra halvdygnet (SI5).
    expect(resolveSiTime({ secondsIn12h: 2 * 3600 + 30 * 60, pm: true, dayOfWeek: 6 }, { reference, timeZone: zone }).toISOString())
      .toBe("2026-09-26T12:30:00.000Z");
    expect(resolveSiTime({ secondsIn12h: 2 * 3600 + 30 * 60 }, { reference, timeZone: zone }).toISOString()).toBe("2026-10-03T00:30:00.000Z");
  });

  it("vägrar motsägelsefulla bricktider i stället för att gissa", () => {
    const reference = new Date("2026-10-03T10:08:00Z");
    expect(() => resolveSiTime({ secondsIn12h: 12 * 3600 }, { reference, timeZone: zone })).toThrow(SiTimeError);
    expect(() => resolveSiTime({ secondsIn12h: 60, dayOfWeek: 7 }, { reference, timeZone: zone })).toThrow(SiTimeError);
    expect(() => resolveSiTime({ secondsIn12h: 60 }, { reference: new Date(Number.NaN), timeZone: zone })).toThrow(SiTimeError);
  });
});

describe("stationens klocka (GET_TIME)", () => {
  it("kodar och tolkar klockan åt båda hållen", () => {
    const clock = { year: 2026, month: 10, day: 3, secondsOfDay: 14 * 3600 + 35 * 60 + 7, milliseconds: 500 };
    const bytes = encodeStationClock(clock, 6);
    expect(bytes).toEqual([26, 10, 3, 0b1101, (2 * 3600 + 35 * 60 + 7) >> 8, (2 * 3600 + 35 * 60 + 7) & 0xff, 128]);
    expect(decodeStationClock(Uint8Array.from(bytes))).toEqual(clock);
    expect(stationClockToDate(clock, zone).toISOString()).toBe("2026-10-03T12:35:07.500Z");
    const fromDate = stationClockFromDate(new Date("2026-10-03T12:35:07.500Z"), zone);
    expect(fromDate).toEqual({ clock, dayOfWeek: 6 });
  });

  it("ger undefined för korta eller orimliga svar", () => {
    expect(decodeStationClock(Uint8Array.from([26, 10, 3]))).toBeUndefined();
    expect(decodeStationClock(Uint8Array.from([26, 13, 3, 0, 0, 0, 0]))).toBeUndefined();
    expect(decodeStationClock(Uint8Array.from([26, 2, 30, 0, 0, 0, 0]))).toBeUndefined();
    expect(decodeStationClock(Uint8Array.from([26, 10, 3, 0, 0xee, 0xee, 0]))).toBeUndefined();
  });

  it("hanterar lopp över midnatt", () => {
    // Avläsning söndag 00:20; start lördag 23:40.
    const reference = new Date("2026-10-03T22:20:00Z");
    const start = { secondsIn12h: 11 * 3600 + 40 * 60, pm: true, dayOfWeek: 6 };
    expect(resolveSiTime(start, { reference, timeZone: zone }).toISOString()).toBe("2026-10-03T21:40:00.000Z");
    const sundayFinish = { secondsIn12h: 10 * 60, pm: false, dayOfWeek: 0 };
    expect(resolveSiTime(sundayFinish, { reference, timeZone: zone }).toISOString()).toBe("2026-10-03T22:10:00.000Z");
  });

  it("SI5 över midnatt väljer kvällen före", () => {
    const reference = new Date("2026-10-03T22:20:00Z"); // söndag 00:20
    expect(resolveSiTime({ secondsIn12h: 11 * 3600 + 40 * 60 }, { reference, timeZone: zone }).toISOString()).toBe("2026-10-03T21:40:00.000Z");
  });

  it("använder veckodagen för att hitta rätt dag", () => {
    const reference = new Date("2026-10-03T12:00:00Z"); // lördag
    const thursday = { secondsIn12h: 7 * 3600, pm: true, dayOfWeek: 4 }; // torsdag 19:00
    expect(resolveSiTime(thursday, { reference, timeZone: zone }).toISOString()).toBe("2026-10-01T17:00:00.000Z");
  });

  it("hanterar övergången till vintertid", () => {
    // Natten till söndag 25 oktober 2026 går klockan från 03:00 till 02:00.
    const reference = new Date("2026-10-25T10:00:00Z"); // 11:00 vintertid
    const t = { secondsIn12h: 10 * 3600, pm: false, dayOfWeek: 0 };
    expect(resolveSiTime(t, { reference, timeZone: zone }).toISOString()).toBe("2026-10-25T09:00:00.000Z");
  });
});
