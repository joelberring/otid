import { describe, expect, it } from "vitest";
import type { StartDrawSetupResponse } from "@o-tid/contracts";
import { startDrawAdvancedSv } from "../../i18n/start-draw-advanced-sv";
import { advancedFromSetup, advancedRequest, type DrawAdvanced } from "./start-draw-advanced";
import { buildDrawSettings, type DrawRow } from "./start-draw";
import { buildWaveShiftRequest, groupMassStartWaves, shiftClockByMinutes } from "./start-draw-waves";

const RACE_ID = "10000000-0000-4000-8000-000000000000";
const c1 = "10000000-0000-4000-8000-000000000001";
const c2 = "10000000-0000-4000-8000-000000000002";
const c3 = "10000000-0000-4000-8000-000000000003";
const c4 = "10000000-0000-4000-8000-000000000004";
const c5 = "10000000-0000-4000-8000-000000000005";

// 2026-11-28 i Europe/Stockholm är vintertid (UTC+1): 19:00 = 18:00Z, 19:10 = 18:10Z.
const T1900 = "2026-11-28T18:00:00.000Z";
const T1910 = "2026-11-28T18:10:00.000Z";
const T1914 = "2026-11-28T18:14:00.000Z";

const setup: StartDrawSetupResponse = {
  formatVersion: 1, raceId: RACE_ID, snapshotVersion: 4, raceDate: "2026-11-28", timeZone: "Europe/Stockholm",
  firstStartTime: T1900,
  classes: [
    { id: c1, name: "Hyperion herr", courseName: "Bana B", firstControlCode: 31, entryCount: 10, method: "MASS",
      intervalMinutes: 1, vacancies: { kind: "COUNT", value: 0 }, hasStartTimes: true, firstStartTime: T1910 },
    { id: c2, name: "Hyperion dam", courseName: "Bana B", firstControlCode: 31, entryCount: 8, method: "MASS",
      intervalMinutes: 1, vacancies: { kind: "COUNT", value: 0 }, hasStartTimes: true, firstStartTime: T1910 },
    { id: c3, name: "Superion herr", courseName: "Bana A", firstControlCode: 41, entryCount: 12, method: "MASS",
      intervalMinutes: 1, vacancies: { kind: "COUNT", value: 0 }, hasStartTimes: true, firstStartTime: T1900 },
    { id: c4, name: "Superion dam", courseName: "Bana A", firstControlCode: 41, entryCount: 9, method: "MASS",
      intervalMinutes: 1, vacancies: { kind: "COUNT", value: 0 }, hasStartTimes: true, firstStartTime: T1900 },
    { id: c5, name: "Öppen", courseName: "Bana C", firstControlCode: 51, entryCount: 5, method: "MINUTE",
      intervalMinutes: 2, vacancies: { kind: "COUNT", value: 0 }, hasStartTimes: true, firstStartTime: T1900 }
  ],
  settings: null, entries: []
};

const emptyAdvanced: DrawAdvanced = {
  groupControls: "1", maxPerMinute: "", maxPerMinutePerPen: "", lastStart: "", seeding: "LAST",
  classOrder: null, laterStarts: {}, seeds: {}
};

describe("masstartsvågor och tävlingsdagens vågflytt", () => {
  it("grupperar masstartsklasser kronologiskt per startvåg och utelämnar minutstart", () => {
    const waves = groupMassStartWaves(setup);
    expect(waves).toEqual([
      {
        startTime: T1900, clock: "19:00", entryCount: 21,
        classes: [{ id: c4, name: "Superion dam", entryCount: 9 }, { id: c3, name: "Superion herr", entryCount: 12 }]
      },
      {
        startTime: T1910, clock: "19:10", entryCount: 18,
        classes: [{ id: c2, name: "Hyperion dam", entryCount: 8 }, { id: c1, name: "Hyperion herr", entryCount: 10 }]
      }
    ]);
  });

  it("förskjuter klockslag framåt, bakåt och över midnatt", () => {
    expect(shiftClockByMinutes("19:10", 4, "2026-11-28", "Europe/Stockholm", T1910)).toBe("19:14");
    expect(shiftClockByMinutes("19.10", -5, "2026-11-28", "Europe/Stockholm", T1910)).toBe("19:05");
    expect(shiftClockByMinutes("2355", 10, "2026-11-28", "Europe/Stockholm", "2026-11-28T22:55:00.000Z")).toBe("00:05");
    expect(shiftClockByMinutes("ogiltig", 5, "2026-11-28", "Europe/Stockholm", T1910)).toBeNull();
  });

  it("bygger vågflyttningsbegäran med 19:14, 19.14 och 1914 och stoppar oförändrad eller ogiltig tid", () => {
    const [, wave1910] = groupMassStartWaves(setup);
    const built = buildWaveShiftRequest(setup, wave1910!, "19.14");
    expect(built).toEqual({
      firstStartTime: T1914, targetStartTime: T1914, targetClock: "19:14", deltaMinutes: 4, clubSeparation: false,
      classes: [
        { classId: c2, method: "MASS", intervalMinutes: 1, vacancies: { kind: "COUNT", value: 0 }, laterStart: { kind: "CLOCK", startTime: T1914 } },
        { classId: c1, method: "MASS", intervalMinutes: 1, vacancies: { kind: "COUNT", value: 0 }, laterStart: { kind: "CLOCK", startTime: T1914 } }
      ]
    });
    expect(buildWaveShiftRequest(setup, wave1910!, "1914")).toEqual(built);
    expect(buildWaveShiftRequest(setup, wave1910!, "19:10")).toBe("unchanged");
    expect(buildWaveShiftRequest(setup, wave1910!, "19:10:30")).toBe("invalid");
    expect(buildWaveShiftRequest(setup, wave1910!, "99:99")).toBe("invalid");
  });
});

describe("masstart i tabellen och klockslag lika med första start", () => {
  const massRow = (massStart: string, selected = true): DrawRow => ({
    method: "MASS", interval: "1", vacancies: "0", vacancyKind: "COUNT", massStart, selected
  });
  const minuteRow = (selected = false): DrawRow => ({
    method: "MINUTE", interval: "2", vacancies: "0", vacancyKind: "COUNT", massStart: "", selected
  });

  it("godtar klockslag lika med första start i Avancerat och sänker firstStartTime för tidigare masstartsvåg", () => {
    const rows: Record<string, DrawRow> = { [c1]: massRow("1910"), [c2]: massRow("19.10"), [c3]: massRow("19:00"),
      [c4]: massRow("19:00"), [c5]: minuteRow(false) };
    // Även när fältet Första start står på 19:10 sänks begärans firstStartTime automatiskt till 19:00!
    const settings = buildDrawSettings(setup, rows, "19:10", true, emptyAdvanced, startDrawAdvancedSv, "Ogiltig");
    expect(settings).toMatchObject({
      firstStartTime: T1900,
      classes: [
        { classId: c1, method: "MASS", laterStart: { kind: "CLOCK", startTime: T1910 } },
        { classId: c2, method: "MASS", laterStart: { kind: "CLOCK", startTime: T1910 } },
        { classId: c3, method: "MASS", laterStart: { kind: "CLOCK", startTime: T1900 } },
        { classId: c4, method: "MASS", laterStart: { kind: "CLOCK", startTime: T1900 } }
      ]
    });
    // Fungerar också om fältet Första start är tomt när alla valda klasser har masstartstid i tabellen.
    const withoutBase = buildDrawSettings(setup, rows, "", false, emptyAdvanced, startDrawAdvancedSv, "Ogiltig");
    expect(withoutBase).toMatchObject({ firstStartTime: T1900 });
  });

  it("ger radfel för ogiltig masstartstid och tillåter clock === firstStartTime för minutstart under Avancerat", () => {
    const badRows: Record<string, DrawRow> = { [c1]: massRow("25:99"), [c2]: massRow("19:10", false),
      [c3]: massRow("19:00", false), [c4]: massRow("19:00", false), [c5]: minuteRow(false) };
    expect(buildDrawSettings(setup, badRows, "19:00", true, emptyAdvanced, startDrawAdvancedSv, "Ogiltig")).toEqual({
      massErrors: { [c1]: "Ogiltig" }
    });

    const minuteRows: Record<string, DrawRow> = { [c1]: massRow("19:10", false), [c2]: massRow("19:10", false),
      [c3]: massRow("19:00", false), [c4]: massRow("19:00", false), [c5]: minuteRow(true) };
    const equalClock = advancedRequest(setup, minuteRows, {
      ...emptyAdvanced, laterStarts: { [c5]: { kind: "CLOCK", value: "19:00" } }
    }, T1900, new Set([c5]), startDrawAdvancedSv);
    expect("request" in equalClock && equalClock.request.laterStarts.get(c5)).toEqual({ kind: "CLOCK", startTime: T1900 });

    const earlierClock = advancedRequest(setup, minuteRows, {
      ...emptyAdvanced, laterStarts: { [c5]: { kind: "CLOCK", value: "18:55" } }
    }, T1900, new Set([c5]), startDrawAdvancedSv);
    expect("errors" in earlierClock && earlierClock.errors[`later:${c5}`]).toBe(startDrawAdvancedSv.errors.clock);

    // Sparade masstartsklockslag öppnar inte Avancerat som "ändrat".
    const loaded = advancedFromSetup({
      ...setup,
      settings: {
        rules: { groupControls: 1, maxPerMinute: null, maxPerMinutePerPen: null, lastStartTime: null, seeding: "LAST", classOrder: null },
        laterStarts: [{ classId: c1, laterStart: { kind: "CLOCK", startTime: T1910 } }]
      }
    });
    expect(loaded.laterStarts).toEqual({});
  });
});
