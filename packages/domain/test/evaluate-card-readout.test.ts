import { describe, expect, it } from "vitest";
import { evaluateCardReadout, type NormalizedCardReadout, type RaceSnapshot } from "../src";

const ids = {
  race: "00000000-0000-4000-8000-000000000001",
  class: "00000000-0000-4000-8000-000000000002",
  course: "00000000-0000-4000-8000-000000000003",
  version: "00000000-0000-4000-8000-000000000004",
  entry: "00000000-0000-4000-8000-000000000005"
};

function snapshot(codes: number[] = [31, 32, 33], startRule: "FIXED" | "PUNCH" = "FIXED"): RaceSnapshot {
  return {
    race: { id: ids.race, eventId: "event", name: "Lopp", raceDate: "2026-08-30", snapshotVersion: 1 },
    classes: [{ id: ids.class, raceId: ids.race, name: "H21", courseVersionId: ids.version, startRule }],
    courses: [{
      id: ids.course,
      raceId: ids.race,
      name: "Bana 1",
      versions: [{
        id: ids.version,
        courseId: ids.course,
        version: 1,
        createdAt: "2026-08-30T08:00:00Z",
        controls: codes.map((code, index) => ({
          id: `cc-${index}`,
          courseVersionId: ids.version,
          controlId: `control-${code}`,
          sequence: index + 1,
          controlCode: code
        }))
      }]
    }],
    entries: [{
      id: ids.entry,
      raceId: ids.race,
      classId: ids.class,
      givenName: "Ada",
      familyName: "Löpare",
      fixedStartTime: "2026-08-30T10:00:00Z"
    }],
    cardAssignments: [{ id: "card", raceId: ids.race, entryId: ids.entry, cardNumber: "12345", active: true }],
    classControlNeutralizations: []
  };
}

function readout(codes: number[], overrides: Partial<NormalizedCardReadout> = {}): NormalizedCardReadout {
  return {
    id: "readout",
    raceId: ids.race,
    cardNumber: "12345",
    startPunchedAt: "2026-08-30T10:00:05Z",
    finishPunchedAt: "2026-08-30T10:40:00Z",
    punches: codes.map((code, index) => ({ code, punchedAt: `2026-08-30T10:${String(10 + index * 5).padStart(2, "0")}:00Z` })),
    rawMessageId: "raw",
    readAt: "2026-08-30T10:41:00Z",
    ...overrides
  };
}

describe("evaluateCardReadout", () => {
  it("en kontroll stämplad före den lottade starten får ingen sträcktid men räknas som stämplad (PLAN.md steg 13)", () => {
    const early = readout([31, 32, 33], { punches: [
      { code: 31, punchedAt: "2026-08-30T09:58:00Z" },
      { code: 32, punchedAt: "2026-08-30T10:12:00Z" },
      { code: 33, punchedAt: "2026-08-30T10:20:00Z" }] });
    const result = evaluateCardReadout(early, snapshot());
    expect(result).toMatchObject({ status: "OK", reason: "COMPLETE", startTime: "2026-08-30T10:00:00Z", elapsedMs: 40 * 60_000,
      missingControls: [] });
    // 31 är okänd; 32 räknas från starten (som efter en saknad stämpling), 33 från 32.
    expect(result.splits).toEqual([
      { controlCode: 32, occurrence: 1, elapsedMs: 12 * 60_000, legMs: 12 * 60_000 },
      { controlCode: 33, occurrence: 1, elapsedMs: 20 * 60_000, legMs: 8 * 60_000 }]);
    expect(result.splits.every(split => split.elapsedMs >= 0 && split.legMs >= 0)).toBe(true);
  });

  it("utelämnar sträcktider som ligger efter målet eller före föregående kända tid", () => {
    const result = evaluateCardReadout(readout([31, 32, 33], { punches: [
      { code: 31, punchedAt: "2026-08-30T10:15:00Z" },
      { code: 32, punchedAt: "2026-08-30T10:12:00Z" },
      { code: 33, punchedAt: "2026-08-30T10:45:00Z" }] }), snapshot());
    expect(result).toMatchObject({ status: "OK", elapsedMs: 40 * 60_000 });
    expect(result.splits).toEqual([{ controlCode: 31, occurrence: 1, elapsedMs: 15 * 60_000, legMs: 15 * 60_000 }]);
    // En felstämplad med tidig stämpling får heller inga negativa tider.
    const mp = evaluateCardReadout(readout([31, 33], { punches: [
      { code: 31, punchedAt: "2026-08-30T09:50:00Z" }, { code: 33, punchedAt: "2026-08-30T10:20:00Z" }] }), snapshot());
    expect(mp).toMatchObject({ status: "MP", reason: "MISSING_CONTROL", missingControls: [32] });
    expect(mp.splits).toEqual([{ controlCode: 33, occurrence: 1, elapsedMs: 20 * 60_000, legMs: 20 * 60_000 }]);
  });

  it("ger MP för saknad kontroll", () => {
    const result = evaluateCardReadout(readout([31, 33]), snapshot());
    expect(result).toMatchObject({ status: "MP", reason: "MISSING_CONTROL", missingControls: [32] });
  });

  it("tillåter en extra kontroll", () => {
    const result = evaluateCardReadout(readout([31, 91, 32, 33]), snapshot());
    expect(result).toMatchObject({ status: "OK", reason: "COMPLETE", extraPunches: [91] });
  });

  it("kräver varje förekomst av en upprepad kontrollkod", () => {
    expect(evaluateCardReadout(readout([31, 31, 32]), snapshot([31, 31, 32])).status).toBe("OK");
    expect(evaluateCardReadout(readout([31, 32]), snapshot([31, 31, 32]))).toMatchObject({
      status: "MP",
      reason: "MISSING_CONTROL",
      missingControls: [31]
    });
  });

  it("neutraliserar exakt en förekomst utan att göra en senare lika kod frivillig", () => {
    const value = { ...snapshot([31, 31, 32]), classControlNeutralizations: [{
      id: "neutralization", classId: ids.class, courseVersionId: ids.version,
      courseControlId: "cc-0", sequence: 1, controlCode: 31
    }] };
    expect(evaluateCardReadout(readout([31, 32]), value)).toMatchObject({
      status: "OK", reason: "COMPLETE", extraPunches: [],
      splits: [{ controlCode: 31, occurrence: 2 }, { controlCode: 32, occurrence: 1 }]
    });
    expect(evaluateCardReadout(readout([32]), value)).toMatchObject({ status: "MP", missingControls: [31] });
  });

  it("ger MP för fel ordning", () => {
    expect(evaluateCardReadout(readout([32, 31, 33]), snapshot())).toMatchObject({ status: "MP", reason: "WRONG_ORDER" });
  });

  it("förklarar okänd bricka", () => {
    expect(evaluateCardReadout(readout([31, 32, 33], { cardNumber: "999" }), snapshot())).toEqual({
      status: "UNKNOWN_CARD",
      reason: "UNKNOWN_CARD",
      missingControls: [],
      extraPunches: [],
      splits: []
    });
  });

  it("använder startstämpling när klassen kräver det", () => {
    expect(evaluateCardReadout(readout([31, 32, 33]), snapshot(undefined, "PUNCH"))).toMatchObject({
      status: "OK",
      elapsedMs: 2_395_000
    });
  });
});
