import { describe, expect, it } from "vitest";
import { applyManualDecision, evaluateCardReadout, evaluateReadoutWithTimes, preparedReadoutTimes, prepareReadoutForEvaluation,
  resolveResultHistory, type ManualDecisionContext, type NormalizedCardReadout, type RaceSnapshot, type StationTimeAdjustment } from "../src";

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

describe("gamla stämplingar på en oröjd bricka (steg 31)", () => {
  const today = (time: string) => `2026-08-30T${time}Z`;
  const lastWeek = (time: string) => `2026-08-23T${time}Z`;

  it("vanlig avläsning bedöms exakt som förut", () => {
    const input = readout();
    const prepared = prepareReadoutForEvaluation(input, snapshot());
    expect(prepared.readout).toBe(input);
    expect(prepared.ignoredPunches).toBe(0);
    const withCheck = readout({ checkPunchedAt: today("09:55:00"), clearPunchedAt: today("09:54:00") });
    expect(prepareReadoutForEvaluation(withCheck, snapshot()).readout).toBe(withCheck);
    expect(evaluateCardReadout(withCheck, snapshot())).toMatchObject({ status: "OK", elapsedMs: 40 * 60_000 });
  });

  it("ett gammalt varv på samma koder ger inte längre godkänt när dagens varv saknar en kontroll", () => {
    const uncleared = readout({ punches: [{ code: 31, punchedAt: lastWeek("18:10:00") }, { code: 32, punchedAt: lastWeek("18:20:00") },
      { code: 33, punchedAt: lastWeek("18:30:00") }, { code: 31, punchedAt: today("10:10:00") }, { code: 33, punchedAt: today("10:30:00") }] });
    // Utan regeln (avläsningen utan lästid) räcker det gamla varvet till godkänt.
    const withoutReadAt = { cardNumber: uncleared.cardNumber, startPunchedAt: uncleared.startPunchedAt!,
      finishPunchedAt: uncleared.finishPunchedAt!, punches: uncleared.punches };
    expect(evaluateCardReadout(withoutReadAt, snapshot()).status).toBe("OK");
    expect(prepareReadoutForEvaluation(uncleared, snapshot())).toMatchObject({ ignoredPunches: 3, keptPunchIndexes: [3, 4] });
    expect(evaluateCardReadout(uncleared, snapshot())).toMatchObject({ status: "MP", reason: "MISSING_CONTROL", missingControls: [32] });
  });

  it("ett varv tidigare samma dag räknas inte när brickan har check i kväll", () => {
    const earlier = readout({ checkPunchedAt: today("09:55:00"), punches: [{ code: 31, punchedAt: today("07:10:00") },
      { code: 32, punchedAt: today("07:20:00") }, { code: 33, punchedAt: today("07:30:00") }, { code: 31, punchedAt: today("10:10:00") },
      { code: 33, punchedAt: today("10:30:00") }] });
    expect(evaluateCardReadout(earlier, snapshot())).toMatchObject({ status: "MP", missingControls: [32] });
    // Samma bricka utan check: varvet är inom 12 timmar och räknas (ingen grund att bortse från det).
    const noCheck = readout({ punches: earlier.punches });
    expect(evaluateCardReadout(noCheck, snapshot()).status).toBe("OK");
  });

  it("en kontroll med fel klocka (−1 h) samma kväll räknas inte som gammal", () => {
    const wrongClock = readout({ punches: [{ code: 31, punchedAt: today("10:10:00") }, { code: 32, punchedAt: today("09:20:00") },
      { code: 33, punchedAt: today("10:30:00") }] });
    expect(prepareReadoutForEvaluation(wrongClock, snapshot()).ignoredPunches).toBe(0);
    expect(evaluateCardReadout(wrongClock, snapshot()).status).toBe("OK");
    // Även med check: kontrollen ligger mitt bland kvällens stämplingar och räknas.
    expect(evaluateCardReadout({ ...wrongClock, checkPunchedAt: today("09:55:00") }, snapshot()).status).toBe("OK");
    // En check efter startstämplingen (fel klocka i checkenheten) används inte.
    const lateCheck = readout({ checkPunchedAt: today("10:20:00") });
    expect(prepareReadoutForEvaluation(lateCheck, snapshot()).ignoredPunches).toBe(0);
  });

  it("gammal start och gammalt mål räknas inte; med tidsjustering bedöms den justerade tiden", () => {
    const oldFinish = readout({ finishPunchedAt: lastWeek("18:40:00") });
    expect(evaluateCardReadout(oldFinish, snapshot())).toMatchObject({ status: "MP", reason: "MISSING_FINISH" });
    expect(prepareReadoutForEvaluation(oldFinish, snapshot()).ignoredPunches).toBe(1);
  });
});

/** Avläsningen utan målstämpling (glömde stämpla mål). */
function withoutFinish(overrides: Partial<NormalizedCardReadout> = {}): NormalizedCardReadout {
  return Object.fromEntries(Object.entries(readout(overrides)).filter(([key]) => key !== "finishPunchedAt")) as unknown as NormalizedCardReadout;
}

describe("manuell tid tillsammans med tävlingens rättningar (steg 31, A + B)", () => {
  it("arrangörens måltid justeras inte av målstationens justering; kontrollernas justering gäller", () => {
    const result = evaluateReadoutWithTimes(withoutFinish(), snapshot([finish(-HOUR), control(32, -HOUR)]),
      ids.entry, "2026-08-30T10:00:00Z", "2026-08-30T10:45:00Z");
    expect(result).toMatchObject({ status: "OK", elapsedMs: 45 * 60_000, finishTime: "2026-08-30T10:45:00Z" });
  });

  it("gamla stämplingar på oröjd bricka räknas inte heller med manuell tid", () => {
    const old = withoutFinish({ punches: [
      { code: 31, punchedAt: "2026-08-20T10:10:00Z" }, { code: 32, punchedAt: "2026-08-20T10:20:00Z" },
      { code: 33, punchedAt: "2026-08-20T10:30:00Z" }, { code: 31, punchedAt: "2026-08-30T10:10:00Z" },
      { code: 33, punchedAt: "2026-08-30T10:30:00Z" }] });
    const result = evaluateReadoutWithTimes(old, snapshot(), ids.entry, "2026-08-30T10:00:00Z", "2026-08-30T10:45:00Z");
    expect(result).toMatchObject({ status: "MP", missingControls: [32] });
  });
});

describe("rättad starttid med tidsjustering på start (steg 45)", () => {
  it("beslutet jämförs med den justerade startstämplingen, inte den råa", () => {
    const punchStart = (adjustments: StationTimeAdjustment[]): RaceSnapshot => {
      const base = snapshot(adjustments);
      return { ...base, classes: base.classes.map((raceClass) => ({ ...raceClass, startRule: "PUNCH" as const })) };
    };
    const startAdjusted = punchStart([{ id: "adj-start", station: "START", offsetMs: 2 * 60_000 }]);
    const input = readout();
    const outcome = evaluateCardReadout(input, startAdjusted);
    expect(outcome).toMatchObject({ status: "OK", startTime: "2026-08-30T10:02:05.000Z" });
    const times = preparedReadoutTimes(input, startAdjusted);
    expect(times).toEqual({ startPunchedAt: "2026-08-30T10:02:05.000Z", finishPunchedAt: "2026-08-30T10:40:00Z" });
    const history = resolveResultHistory([{ revision: 1, cause: "CARD_READOUT", evaluation: outcome, readoutId: "readout" }]);
    const base: ManualDecisionContext = { entryId: ids.entry, classId: ids.class, courseVersionId: ids.version, startRule: "PUNCH",
      isCurrent: () => true };
    const decision = { kind: "START_TIME", startTime: "2026-08-30T10:01:00.000Z" } as const;
    // Den råa stämplingen stämmer inte med bedömningens start, så rättningen gick aldrig att göra.
    expect(applyManualDecision(history, decision, { ...base, headStartPunchedAt: input.startPunchedAt! }))
      .toMatchObject({ ok: false, readiness: "UNSUPPORTED_RESULT" });
    const corrected = applyManualDecision(history, decision, { ...base, headStartPunchedAt: times.startPunchedAt });
    expect(corrected).toMatchObject({ ok: true });
    expect(corrected.ok && corrected.outcome).toMatchObject({ startTime: "2026-08-30T10:01:00.000Z", elapsedMs: 39 * 60_000 });
  });
});
