import { describe, expect, it } from "vitest";
import {
  correctPunchedStartTime,
  ManualPunchStartTimeCorrectionError,
  type EvaluationResult
} from "../src";

const source: EvaluationResult = {
  status: "OK", reason: "COMPLETE", entryId: "entry", classId: "class", courseVersionId: "course",
  startTime: "2026-09-20T08:00:00.000Z", finishTime: "2026-09-20T08:20:00.000Z", elapsedMs: 1_200_000,
  missingControls: [], extraPunches: [], splits: [
    { controlCode: 31, occurrence: 1, elapsedMs: 300_000, legMs: 300_000 },
    { controlCode: 32, occurrence: 1, elapsedMs: 600_000, legMs: 300_000 }
  ]
};

describe("TASK104 korrigerad PUNCH-start", () => {
  it("räknar om löptid och första sträckan men bevarar kontrollföljd, mål och senare sträckor", () => {
    const corrected = correctPunchedStartTime(source as Parameters<typeof correctPunchedStartTime>[0], "2026-09-20T07:59:00+00:00");
    expect(corrected).toMatchObject({ startTime: "2026-09-20T07:59:00.000Z", finishTime: source.finishTime,
      elapsedMs: 1_260_000, status: "OK", reason: "COMPLETE", missingControls: [], extraPunches: [] });
    expect(corrected.splits).toEqual([
      { controlCode: 31, occurrence: 1, elapsedMs: 360_000, legMs: 360_000 },
      { controlCode: 32, occurrence: 1, elapsedMs: 660_000, legMs: 300_000 }
    ]);
  });

  it("avvisar en start efter bevarad kontroll, oförändrad start och motsägelsefull källsplit", () => {
    for (const [value, code] of [
      ["2026-09-20T08:06:00.000Z", "INVALID_CORRECTED_START"],
      [source.startTime!, "INVALID_CORRECTED_START"]
    ] as const) expectFailure(() => correctPunchedStartTime(source as Parameters<typeof correctPunchedStartTime>[0], value), code);
    expectFailure(() => correctPunchedStartTime({ ...source, splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 300_000, legMs: 1 }] } as Parameters<typeof correctPunchedStartTime>[0], "2026-09-20T07:59:00.000Z"), "INVALID_SOURCE_SPLITS");
  });
});

function expectFailure(action: () => unknown, code: string): void {
  try { action(); throw new Error("Den motsägelsefulla starttiden accepterades"); }
  catch (error) { expect(error).toBeInstanceOf(ManualPunchStartTimeCorrectionError); if (error instanceof ManualPunchStartTimeCorrectionError) expect(error.code).toBe(code); }
}
