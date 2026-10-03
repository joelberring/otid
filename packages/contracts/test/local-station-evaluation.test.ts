import { describe, expect, it } from "vitest";
import { evaluationResultSchema, localStationEvaluationSchema, simulatorPayloadSchema } from "../src";

const ids = {
  device: "10000000-0000-4000-8000-000000000001",
  race: "10000000-0000-4000-8000-000000000002",
  entry: "10000000-0000-4000-8000-000000000003",
  raceClass: "10000000-0000-4000-8000-000000000004",
  courseVersion: "10000000-0000-4000-8000-000000000005"
};

const okEvaluation = {
  status: "OK" as const,
  reason: "COMPLETE" as const,
  entryId: ids.entry,
  classId: ids.raceClass,
  courseVersionId: ids.courseVersion,
  startTime: "2026-08-31T10:00:00.000Z",
  finishTime: "2026-08-31T10:30:00.000Z",
  elapsedMs: 1_800_000,
  missingControls: [],
  extraPunches: [],
  splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 600_000, legMs: 600_000 }]
};

describe("local station evaluation contract", () => {
  it("accepts a strict, version-bound persisted evaluation", () => {
    const value = {
      formatVersion: 1 as const,
      deviceId: ids.device,
      localSequence: 7,
      raceId: ids.race,
      packageVersion: 3,
      packagePayloadSha256: "a".repeat(64),
      engineVersion: "0.1.0",
      snapshotVersion: 3,
      evaluation: okEvaluation
    };
    expect(localStationEvaluationSchema.parse(value)).toEqual(value);
  });

  it("rejects contradictory status/reason pairs and extra fields", () => {
    expect(evaluationResultSchema.safeParse({ ...okEvaluation, status: "MP" }).success).toBe(false);
    expect(evaluationResultSchema.safeParse({ ...okEvaluation, extra: true }).success).toBe(false);
    expect(localStationEvaluationSchema.safeParse({
      formatVersion: 1,
      deviceId: ids.device,
      localSequence: 1,
      raceId: ids.race,
      packageVersion: 1,
      packagePayloadSha256: "a".repeat(64),
      engineVersion: "0.1.0",
      snapshotVersion: 1,
      evaluation: { status: "UNKNOWN_CARD", reason: "UNKNOWN_CARD", missingControls: [], extraPunches: [], splits: [] },
      extra: true
    }).success).toBe(false);
  });

  it("keeps the simulator payload boundary strict like native storage", () => {
    const payload = {
      cardNumber: "12345",
      finishPunchedAt: "2026-08-31T10:30:00.000Z",
      punches: [{ code: 31, punchedAt: "2026-08-31T10:10:00.000Z" }]
    };
    expect(simulatorPayloadSchema.parse(payload)).toEqual(payload);
    expect(simulatorPayloadSchema.safeParse({ ...payload, unexpected: true }).success).toBe(false);
    expect(simulatorPayloadSchema.safeParse({
      ...payload,
      punches: [{ ...payload.punches[0], unexpected: true }]
    }).success).toBe(false);
  });
});
