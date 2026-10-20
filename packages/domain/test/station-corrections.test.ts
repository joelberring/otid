import { describe, expect, it } from "vitest";
import { evaluateCardReadout, prepareReadoutForEvaluation, type NormalizedCardReadout, type RaceSnapshot,
  type StationTimeAdjustment } from "../src";

const ids = {
  race: "00000000-0000-4000-8000-000000000001",
  class: "00000000-0000-4000-8000-000000000002",
  course: "00000000-0000-4000-8000-000000000003",
  version: "00000000-0000-4000-8000-000000000004",
  entry: "00000000-0000-4000-8000-000000000005"
};
const HOUR = 3_600_000;

function snapshot(adjustments: StationTimeAdjustment[] = [], maxTimeMinutes?: number): RaceSnapshot {
  return {
    race: { id: ids.race, eventId: "event", name: "Lopp", raceDate: "2026-08-30", snapshotVersion: 1 },
    classes: [{ id: ids.class, raceId: ids.race, name: "H21", courseVersionId: ids.version, startRule: "FIXED",
      ...(maxTimeMinutes ? { maxTimeMinutes } : {}) }],
    courses: [{ id: ids.course, raceId: ids.race, name: "Bana 1", versions: [{ id: ids.version, courseId: ids.course, version: 1,
      createdAt: "2026-08-30T08:00:00Z", controls: [31, 32, 33].map((code, index) => ({ id: `cc-${index}`,
        courseVersionId: ids.version, controlId: `control-${code}`, sequence: index + 1, controlCode: code })) }] }],
    entries: [{ id: ids.entry, raceId: ids.race, classId: ids.class, givenName: "Ada", familyName: "Testsson",
      fixedStartTime: "2026-08-30T10:00:00Z" }],
    cardAssignments: [{ id: "card", raceId: ids.race, entryId: ids.entry, cardNumber: "12345", active: true }],
    ...(adjustments.length > 0 ? { stationTimeAdjustments: adjustments } : {})
  };
}

function readout(overrides: Partial<NormalizedCardReadout> = {}): NormalizedCardReadout {
  return { id: "readout", raceId: ids.race, cardNumber: "12345", startPunchedAt: "2026-08-30T10:00:05Z",
    finishPunchedAt: "2026-08-30T10:40:00Z", punches: [
      { code: 31, punchedAt: "2026-08-30T10:10:00Z" }, { code: 32, punchedAt: "2026-08-30T10:20:00Z" },
      { code: 33, punchedAt: "2026-08-30T10:30:00Z" }], rawMessageId: "raw", readAt: "2026-08-30T10:41:00Z", ...overrides };
}

const finish = (offsetMs: number): StationTimeAdjustment => ({ id: "adj-finish", station: "FINISH", offsetMs });
const control = (controlCode: number, offsetMs: number): StationTimeAdjustment =>
  ({ id: `adj-${controlCode}`, station: "CONTROL", controlCode, offsetMs });

describe("tidsjustering per station (steg 31)", () => {
  it("utan justering bedöms avläsningen exakt som förut", () => {
    const input = readout();
    expect(prepareReadoutForEvaluation(input, snapshot()).readout).toBe(input);
    expect(evaluateCardReadout(input, snapshot())).toEqual(evaluateCardReadout(input, { ...snapshot(), stationTimeAdjustments: [] }));
    expect(evaluateCardReadout(input, snapshot())).toMatchObject({ status: "OK", elapsedMs: 40 * 60_000 });
  });

  it("en justering för en station som brickan inte har ändrar inget", () => {
    const input = readout();
    const prepared = prepareReadoutForEvaluation(input, snapshot([control(99, -HOUR)]));
    expect(prepared.readout).toBe(input);
    expect(prepared.adjustments).toEqual([]);
  });

  it("målklockan en timme fel: totaltid och sträcka till mål blir rätt", () => {
    const wrong = readout({ finishPunchedAt: "2026-08-30T11:40:00Z" });
    expect(evaluateCardReadout(wrong, snapshot()).elapsedMs).toBe(100 * 60_000);
    const fixed = evaluateCardReadout(wrong, snapshot([finish(-HOUR)]));
    expect(fixed).toMatchObject({ status: "OK", elapsedMs: 40 * 60_000, finishTime: "2026-08-30T10:40:00.000Z" });
    expect(fixed.splits.map((split) => split.elapsedMs)).toEqual([10, 20, 30].map((minutes) => minutes * 60_000));
  });

  it("mål före start blir godkänt när målets klocka justeras", () => {
    const wrong = readout({ finishPunchedAt: "2026-08-30T09:40:00Z" });
    expect(evaluateCardReadout(wrong, snapshot())).toMatchObject({ status: "MP", reason: "INVALID_TIME_ORDER" });
    expect(evaluateCardReadout(wrong, snapshot([finish(HOUR)]))).toMatchObject({ status: "OK", elapsedMs: 40 * 60_000 });
  });

  it("en kontroll med fel klocka får rätt sträcktider", () => {
    const wrong = readout({ punches: [{ code: 31, punchedAt: "2026-08-30T10:10:00Z" },
      { code: 32, punchedAt: "2026-08-30T11:20:00Z" }, { code: 33, punchedAt: "2026-08-30T10:30:00Z" }] });
    expect(evaluateCardReadout(wrong, snapshot()).splits.map((split) => split.controlCode)).toEqual([31, 33]);
    const prepared = prepareReadoutForEvaluation(wrong, snapshot([control(32, -HOUR)]));
    expect(prepared.adjustments).toEqual([{ station: "CONTROL", controlCode: 32, offsetMs: -HOUR, punches: 1 }]);
    expect(wrong.punches[1]!.punchedAt).toBe("2026-08-30T11:20:00Z");
    expect(evaluateCardReadout(wrong, snapshot([control(32, -HOUR)])).splits.map((split) => split.legMs))
      .toEqual([10, 10, 10].map((minutes) => minutes * 60_000));
  });

  it("maxtiden avgörs med den justerade tiden", () => {
    const wrong = readout({ finishPunchedAt: "2026-08-30T11:40:00Z" });
    expect(evaluateCardReadout(wrong, snapshot([], 60)).status).toBe("OVERTIME");
    expect(evaluateCardReadout(wrong, snapshot([finish(-HOUR)], 60)).status).toBe("OK");
  });
});
