import { describe, expect, it } from "vitest";
import {
  applyManualDecision, classifyRemainingRunners, compareResultStatuses, evaluateCardReadout, rankClassResults,
  resolveResultHistory, RESULT_ENGINE_VERSION, START_PUNCH_TOLERANCE_MS, startPunchNote, withMaxTime,
  type DecisionRevision, type NormalizedCardReadout, type RaceSnapshot
} from "../src";

const ids = {
  race: "00000000-0000-4000-8000-000000000001",
  class: "00000000-0000-4000-8000-000000000002",
  course: "00000000-0000-4000-8000-000000000003",
  version: "00000000-0000-4000-8000-000000000004",
  entry: "00000000-0000-4000-8000-000000000005"
};

function snapshot(options: { startRule?: "FIXED" | "PUNCH"; fixedStartTime?: string | null; maxTimeMinutes?: number;
  rogaining?: boolean } = {}): RaceSnapshot {
  const fixed = options.fixedStartTime === undefined ? "2026-08-30T10:02:00Z" : options.fixedStartTime;
  return {
    race: { id: ids.race, eventId: "event", name: "Lopp", raceDate: "2026-08-30", snapshotVersion: 1 },
    classes: [{ id: ids.class, raceId: ids.race, name: "H21", courseVersionId: ids.version, startRule: options.startRule ?? "FIXED",
      ...(options.maxTimeMinutes ? { maxTimeMinutes: options.maxTimeMinutes } : {}),
      ...(options.rogaining ? { rogaining: { timeLimitSeconds: 1800, penaltyPointsPerMinute: 1 } } : {}) }],
    courses: [{ id: ids.course, raceId: ids.race, name: "Lång", versions: [{ id: ids.version, courseId: ids.course, version: 1,
      createdAt: "2026-08-30T08:00:00Z", controls: [31, 32].map((code, index) => ({ id: `cc-${index}`, courseVersionId: ids.version,
        controlId: `control-${code}`, sequence: index + 1, controlCode: code })) }] }],
    entries: [{ id: ids.entry, raceId: ids.race, classId: ids.class, givenName: "Ada", familyName: "Löpare",
      ...(fixed ? { fixedStartTime: fixed } : {}) }],
    cardAssignments: [{ id: "card", raceId: ids.race, entryId: ids.entry, cardNumber: "12345", active: true }],
    classControlNeutralizations: []
  };
}

function readout(overrides: Partial<NormalizedCardReadout> = {}): NormalizedCardReadout {
  return { id: "readout", raceId: ids.race, cardNumber: "12345", startPunchedAt: "2026-08-30T10:04:12Z",
    finishPunchedAt: "2026-08-30T10:45:00Z", punches: [{ code: 31, punchedAt: "2026-08-30T10:15:00Z" },
      { code: 32, punchedAt: "2026-08-30T10:30:00Z" }], rawMessageId: "raw", readAt: "2026-08-30T10:46:00Z", ...overrides };
}

describe("startstämpling vid lottad start (PLAN.md steg 25)", () => {
  it("lottad tid är den officiella starten; startstämplingen ändrar inte tiden", () => {
    const result = evaluateCardReadout(readout(), snapshot());
    expect(result).toMatchObject({ status: "OK", startTime: "2026-08-30T10:02:00Z", elapsedMs: 43 * 60_000 });
    expect(RESULT_ENGINE_VERSION).toBe("0.4.0");
  });

  it("sen startstämpling över toleransen blir en varning med avvikelsen", () => {
    expect(startPunchNote({ startRule: "FIXED", fixedStartTime: "2026-08-30T10:02:00Z", startPunchedAt: "2026-08-30T10:04:12Z" }))
      .toEqual({ kind: "LATE", punchedAt: "2026-08-30T10:04:12.000Z", scheduledAt: "2026-08-30T10:02:00.000Z", deviationMs: 132_000 });
    expect(startPunchNote({ startRule: "FIXED", fixedStartTime: "2026-08-30T10:02:00Z", startPunchedAt: "2026-08-30T10:00:30Z" }))
      .toMatchObject({ kind: "EARLY", deviationMs: 90_000 });
  });

  it("inom toleransen, stämplingsstart och saknad stämpling ger ingen varning", () => {
    const within = new Date(Date.parse("2026-08-30T10:02:00Z") + START_PUNCH_TOLERANCE_MS).toISOString();
    expect(startPunchNote({ startRule: "FIXED", fixedStartTime: "2026-08-30T10:02:00Z", startPunchedAt: within })).toBeUndefined();
    expect(startPunchNote({ startRule: "PUNCH", fixedStartTime: "2026-08-30T10:02:00Z", startPunchedAt: "2026-08-30T10:09:00Z" }))
      .toBeUndefined();
    expect(startPunchNote({ startRule: "FIXED", fixedStartTime: "2026-08-30T10:02:00Z" })).toBeUndefined();
  });

  it("fast start utan lottad tid använder startstämplingen och får en notis", () => {
    const result = evaluateCardReadout(readout(), snapshot({ fixedStartTime: null }));
    expect(result).toMatchObject({ status: "OK", reason: "COMPLETE", startTime: "2026-08-30T10:04:12Z", elapsedMs: 40 * 60_000 + 48_000 });
    expect(startPunchNote({ startRule: "FIXED", startPunchedAt: "2026-08-30T10:04:12Z" }))
      .toEqual({ kind: "FROM_PUNCH", punchedAt: "2026-08-30T10:04:12.000Z" });
  });

  it("utan både lottad tid och startstämpling saknas starten som tidigare", () => {
    const withoutStart = { ...readout() };
    delete withoutStart.startPunchedAt;
    expect(evaluateCardReadout(withoutStart, snapshot({ fixedStartTime: null }))).toMatchObject({ status: "MP", reason: "MISSING_START" });
  });
});

describe("maxtid per klass (PLAN.md steg 25)", () => {
  it("godkänt över maxtiden blir OVERTIME med tid och sträcktider kvar; exakt maxtid är godkänt", () => {
    const over = evaluateCardReadout(readout(), snapshot({ maxTimeMinutes: 40 }));
    expect(over).toMatchObject({ status: "OVERTIME", reason: "MAX_TIME_EXCEEDED", elapsedMs: 43 * 60_000 });
    expect(over.splits).toHaveLength(2);
    expect(evaluateCardReadout(readout(), snapshot({ maxTimeMinutes: 43 }))).toMatchObject({ status: "OK" });
  });

  it("felstämpling går före maxtid och rogaining berörs inte", () => {
    const mispunched = readout({ punches: [{ code: 31, punchedAt: "2026-08-30T10:15:00Z" }] });
    expect(evaluateCardReadout(mispunched, snapshot({ maxTimeMinutes: 10 }))).toMatchObject({ status: "MP", reason: "MISSING_CONTROL" });
    expect(evaluateCardReadout(readout(), snapshot({ maxTimeMinutes: 10, rogaining: true, startRule: "PUNCH" })))
      .toMatchObject({ status: "OK", reason: "COMPLETE" });
  });

  it("ordnas direkt efter godkända och placeras inte", () => {
    expect(compareResultStatuses("OVERTIME", "OK")).toBeGreaterThan(0);
    expect(compareResultStatuses("OVERTIME", "MP")).toBeLessThan(0);
    const ranked = rankClassResults([
      { key: "a", status: "OVERTIME", elapsedMs: 3_000_000, courseVersionId: ids.version },
      { key: "b", status: "MP", elapsedMs: 1_000_000, courseVersionId: ids.version },
      { key: "c", status: "OK", elapsedMs: 2_000_000, courseVersionId: ids.version }]);
    expect(ranked.map((row) => [row.key, row.rankingState, row.position])).toEqual([
      ["c", "RANKED", 1], ["a", "NOT_RANKABLE_STATUS", undefined], ["b", "NOT_RANKABLE_STATUS", undefined]]);
  });

  it("en rättad måltid avgör på nytt om resultatet är över maxtid", () => {
    const technical = evaluateCardReadout(readout(), snapshot({ maxTimeMinutes: 40 }));
    const revision: DecisionRevision = { revision: 1, cause: "CARD_READOUT", evaluation: technical, readoutId: "readout" };
    const context = { entryId: ids.entry, classId: ids.class, courseVersionId: ids.version, startRule: "FIXED" as const,
      isCurrent: () => true, maxTimeMinutes: 40 };
    const corrected = applyManualDecision(resolveResultHistory([revision]), { kind: "FINISH_TIME", finishTime: "2026-08-30T10:41:00Z" }, context);
    expect(corrected.ok && corrected.outcome).toMatchObject({ status: "OK", reason: "COMPLETE", elapsedMs: 39 * 60_000 });
    const disqualified = applyManualDecision(resolveResultHistory([revision]), { kind: "DISQUALIFIED" }, context);
    expect(disqualified.ok && disqualified.outcome).toMatchObject({ status: "DSQ", elapsedMs: 43 * 60_000 });
    expect(withMaxTime({ status: "OK", reason: "MANUAL_APPROVAL", elapsedMs: 99 * 60_000 }, 40)).toMatchObject({ status: "OK" });
  });
});

describe("kvar i skogen efter tävlingen (PLAN.md steg 25)", () => {
  it("löpare utan resultat blir ej start, utom de som stämplat vid radio eller prickats av som startade", () => {
    expect(classifyRemainingRunners([
      { entryId: "a", hasResult: false, radioPunched: false, startCheckedIn: false },
      { entryId: "b", hasResult: true, radioPunched: false, startCheckedIn: false },
      { entryId: "c", hasResult: false, radioPunched: true, startCheckedIn: false },
      { entryId: "d", hasResult: false, radioPunched: false, startCheckedIn: true }
    ])).toEqual({ didNotStart: ["a"], missingAtFinish: ["c", "d"] });
    expect(() => classifyRemainingRunners([{ entryId: "a", hasResult: false, radioPunched: false, startCheckedIn: false },
      { entryId: "a", hasResult: false, radioPunched: false, startCheckedIn: false }])).toThrow();
  });
});
