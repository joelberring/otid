import { describe, expect, it } from "vitest";
import {
  defaultRogainingPoints, evaluateCardReadout, rankClassResults, rescoreRogaining, rogainingPenalty, withProposedCourseVersion, withRogainingSettings,
  type NormalizedCardReadout, type RaceSnapshot, type RogainingRules
} from "../src";

const ids = {
  race: "00000000-0000-4000-8000-000000000001",
  class: "00000000-0000-4000-8000-000000000002",
  course: "00000000-0000-4000-8000-000000000003",
  version: "00000000-0000-4000-8000-000000000004",
  entry: "00000000-0000-4000-8000-000000000005"
};
const hour: RogainingRules = { timeLimitSeconds: 3_600, penaltyPointsPerMinute: 2 };

/** Rogainingklass med kontrollerna 31, 45, 52 och 102 (förval 3, 4, 5 och 10 poäng). 52 har ändrats till 7. */
function snapshot(rules: RogainingRules | null = hour, startRule: "FIXED" | "PUNCH" = "PUNCH"): RaceSnapshot {
  const controls = [31, 45, 52, 102];
  return {
    race: { id: ids.race, eventId: "event", name: "Lopp", raceDate: "2026-10-08", snapshotVersion: 1 },
    classes: [{ id: ids.class, raceId: ids.race, name: "Rogaining 1 h", courseVersionId: ids.version, startRule,
      ...(rules ? { rogaining: rules } : {}) }],
    courses: [{ id: ids.course, raceId: ids.race, name: "Kontroller", versions: [{ id: ids.version, courseId: ids.course, version: 1,
      createdAt: "2026-10-08T08:00:00Z", controls: controls.map((code, index) => ({ id: `cc-${index}`, courseVersionId: ids.version,
        controlId: `control-${code}`, sequence: index + 1, controlCode: code, ...(code === 52 ? { points: 7 } : {}) })) }] }],
    entries: [{ id: ids.entry, raceId: ids.race, classId: ids.class, givenName: "Ada", familyName: "Löpare",
      fixedStartTime: "2026-10-08T10:00:00Z" }],
    cardAssignments: [{ id: "card", raceId: ids.race, entryId: ids.entry, cardNumber: "12345", active: true }],
    classControlNeutralizations: []
  };
}

const at = (minute: number, second = 0) => new Date(Date.UTC(2026, 9, 8, 10, minute, second)).toISOString();

function readout(punches: [number, number][], finish: string | null = at(50), start: string | null = at(0)): NormalizedCardReadout {
  return { id: "readout", raceId: ids.race, cardNumber: "12345", ...(start ? { startPunchedAt: start } : {}),
    ...(finish ? { finishPunchedAt: finish } : {}), punches: punches.map(([code, minute]) => ({ code, punchedAt: at(minute) })),
    rawMessageId: "raw", readAt: at(55) };
}

describe("rogaining", () => {
  it("förvalet är kontrollkodens tiotal", () => {
    expect([31, 39, 45, 100, 102, 109, 110, 255, 99_999].map(defaultRogainingPoints)).toEqual([3, 3, 4, 10, 10, 10, 11, 25, 1_000]);
  });

  it("räknar valfria kontroller i valfri ordning med ändrade poäng", () => {
    const result = evaluateCardReadout(readout([[102, 10], [31, 20], [52, 30]]), snapshot());
    expect(result).toMatchObject({ status: "OK", reason: "COMPLETE", elapsedMs: 50 * 60_000, missingControls: [], extraPunches: [] });
    expect(result.rogaining).toEqual({ controlPoints: 20, penalty: 0, total: 20, timeLimitMs: 3_600_000, penaltyPointsPerMinute: 2,
      overtimeMinutes: 0,
      controls: [{ controlCode: 102, points: 10 }, { controlCode: 31, points: 3 }, { controlCode: 52, points: 7 }] });
    expect(result.splits).toEqual([
      { controlCode: 102, occurrence: 1, elapsedMs: 10 * 60_000, legMs: 10 * 60_000 },
      { controlCode: 31, occurrence: 1, elapsedMs: 20 * 60_000, legMs: 10 * 60_000 },
      { controlCode: 52, occurrence: 1, elapsedMs: 30 * 60_000, legMs: 10 * 60_000 }]);
  });

  it("dubbelstämpling räknas en gång", () => {
    const result = evaluateCardReadout(readout([[31, 10], [31, 11], [45, 20], [31, 30]]), snapshot());
    expect(result.rogaining?.controlPoints).toBe(7);
    expect(result.rogaining?.controls).toEqual([{ controlCode: 31, points: 3 }, { controlCode: 45, points: 4 }]);
    expect(result.extraPunches).toEqual([]);
  });

  it("stämplingar utanför kontrollmängden räknas inte", () => {
    const result = evaluateCardReadout(readout([[31, 10], [99, 15], [45, 20]]), snapshot());
    expect(result.rogaining?.controlPoints).toBe(7);
    expect(result.extraPunches).toEqual([99]);
    expect(result.status).toBe("OK");
  });

  it("straff per påbörjad minut: exakt på gränsen, en sekund över och 61 sekunder över", () => {
    expect(rogainingPenalty(3_600_000, hour)).toEqual({ overtimeMinutes: 0, penalty: 0 });
    expect(rogainingPenalty(3_601_000, hour)).toEqual({ overtimeMinutes: 1, penalty: 2 });
    expect(rogainingPenalty(3_661_000, hour)).toEqual({ overtimeMinutes: 2, penalty: 4 });
    const exact = evaluateCardReadout(readout([[102, 10]], at(60)), snapshot());
    expect(exact.rogaining).toMatchObject({ controlPoints: 10, penalty: 0, total: 10 });
    const oneSecond = evaluateCardReadout(readout([[102, 10]], at(60, 1)), snapshot());
    expect(oneSecond.rogaining).toMatchObject({ controlPoints: 10, overtimeMinutes: 1, penalty: 2, total: 8 });
    const sixtyOne = evaluateCardReadout(readout([[102, 10]], at(61, 1)), snapshot());
    expect(sixtyOne.rogaining).toMatchObject({ overtimeMinutes: 2, penalty: 4, total: 6 });
    expect(sixtyOne.status).toBe("OK");
  });

  it("en rättad måltid räknar om straffet men inte kontrollerna", () => {
    const score = evaluateCardReadout(readout([[102, 10]], at(50)), snapshot()).rogaining!;
    expect(rescoreRogaining(score, 3_661_000)).toEqual({ ...score, overtimeMinutes: 2, penalty: 4, total: 6 });
  });

  it("summan går aldrig under noll", () => {
    const late = evaluateCardReadout(readout([[31, 10]], at(70)), snapshot());
    expect(late.rogaining).toMatchObject({ controlPoints: 3, overtimeMinutes: 10, penalty: 20, total: 0 });
    expect(late.status).toBe("OK");
  });

  it("utan mål eller start blir det felstämplat utan poäng, som i vanliga klasser", () => {
    const noFinish = evaluateCardReadout(readout([[31, 10]], null), snapshot());
    expect(noFinish).toMatchObject({ status: "MP", reason: "MISSING_FINISH" });
    expect(noFinish.rogaining).toBeUndefined();
    const noStart = evaluateCardReadout(readout([[31, 10]], at(50), null), snapshot());
    expect(noStart).toMatchObject({ status: "MP", reason: "MISSING_START" });
    // Fast starttid gäller när klassen inte har stämplingsstart.
    expect(evaluateCardReadout(readout([[31, 10]], at(50), null), snapshot(hour, "FIXED")).rogaining?.total).toBe(3);
  });

  it("en klass utan rogaining bedöms som vanlig bana", () => {
    const result = evaluateCardReadout(readout([[102, 10], [31, 20]]), snapshot(null));
    expect(result.status).toBe("MP");
    expect(result.rogaining).toBeUndefined();
  });

  it("ändrade poäng och regler prövas med samma motor", () => {
    const changed = withRogainingSettings(snapshot(), { points: new Map([[31, 9], [52, null]]),
      classRules: new Map([[ids.class, { timeLimitSeconds: 2_400, penaltyPointsPerMinute: 1 }]]) });
    const result = evaluateCardReadout(readout([[31, 10], [52, 20]]), changed);
    expect(result.rogaining).toMatchObject({ controlPoints: 14, overtimeMinutes: 10, penalty: 10, total: 4 });
    const plain = withRogainingSettings(snapshot(), { classRules: new Map([[ids.class, null]]) });
    expect(plain.classes[0]!.rogaining).toBeUndefined();
  });

  it("en ny banversion behåller kontrollernas ändrade poäng", () => {
    const proposed = withProposedCourseVersion(snapshot(), ids.course, ids.version,
      { id: "proposed", version: 2, createdAt: "2026-10-08T09:00:00Z", controlCodes: [31, 52, 61] });
    const result = evaluateCardReadout(readout([[52, 10], [61, 20]]), proposed);
    expect(result.rogaining?.controls).toEqual([{ controlCode: 52, points: 7 }, { controlCode: 61, points: 6 }]);
  });
});

describe("rangordning på poäng", () => {
  const course = "00000000-0000-4000-8000-000000000009";
  const row = (key: string, score: number, elapsedMs: number, status: "OK" | "MP" = "OK") =>
    ({ key, status, score, elapsedMs, courseVersionId: course });

  it("flest poäng först, sedan kortast tid; lika poäng och tid delar plats", () => {
    expect(rankClassResults([
      row("d", 30, 3_500_000), row("a", 40, 3_590_000), row("b", 30, 3_000_000), row("c", 30, 3_500_000), row("e", 50, 0, "MP")
    ])).toEqual([
      { key: "a", rankingState: "RANKED", position: 1 },
      { key: "b", rankingState: "RANKED", position: 2 },
      { key: "c", rankingState: "RANKED", position: 3 },
      { key: "d", rankingState: "RANKED", position: 3 },
      { key: "e", rankingState: "NOT_RANKABLE_STATUS" }
    ]);
  });

  it("ogiltiga poäng avvisas", () => {
    expect(() => rankClassResults([row("a", -1, 1_000)])).toThrow("ogiltiga poäng");
  });
});
