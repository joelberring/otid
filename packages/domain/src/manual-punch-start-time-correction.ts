import type { EvaluationResult, SplitTime } from "./types";

/** A direct timed technical result eligible for an observed PUNCH-start correction. */
export type PunchedStartTimeCorrectableResult = EvaluationResult & {
  readonly status: "OK" | "MP";
  readonly reason: "COMPLETE" | "MISSING_CONTROL" | "WRONG_ORDER";
  readonly entryId: string;
  readonly classId: string;
  readonly courseVersionId: string;
  readonly startTime: string;
  readonly finishTime: string;
  readonly elapsedMs: number;
};

export type ManualPunchStartTimeCorrectionErrorCode =
  | "UNSUPPORTED_STATUS"
  | "UNSUPPORTED_REASON"
  | "INVALID_SOURCE_TIME"
  | "INVALID_SOURCE_SPLITS"
  | "INVALID_CORRECTED_START";

export class ManualPunchStartTimeCorrectionError extends Error {
  readonly code: ManualPunchStartTimeCorrectionErrorCode;

  constructor(code: ManualPunchStartTimeCorrectionErrorCode, message: string) {
    super(message);
    this.name = "ManualPunchStartTimeCorrectionError";
    this.code = code;
  }
}

function finiteTime(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new ManualPunchStartTimeCorrectionError("INVALID_SOURCE_TIME", "Källtiden är ogiltig");
  return parsed;
}

function sourceSplitTimes(source: PunchedStartTimeCorrectableResult, startMs: number, finishMs: number): readonly number[] {
  let previousElapsed = -1;
  return source.splits.map((split, index) => {
    if (!Number.isSafeInteger(split.elapsedMs) || !Number.isSafeInteger(split.legMs) || split.elapsedMs < 0 ||
      split.elapsedMs < previousElapsed || (index === 0 && split.legMs !== split.elapsedMs) ||
      (index > 0 && split.legMs !== split.elapsedMs - previousElapsed)) {
      throw new ManualPunchStartTimeCorrectionError("INVALID_SOURCE_SPLITS", "Källans split-tider är motsägelsefulla");
    }
    const absolute = startMs + split.elapsedMs;
    if (!Number.isSafeInteger(absolute) || absolute > finishMs) {
      throw new ManualPunchStartTimeCorrectionError("INVALID_SOURCE_SPLITS", "Källans split ligger utanför löptiden");
    }
    previousElapsed = split.elapsedMs;
    return absolute;
  });
}

/**
 * Rebase a fully observed PUNCH result onto a corrected start instant. Raw
 * punches are intentionally not available here: their observed history stays
 * outside the result revision. The stored split durations provide an exact
 * derived control timeline only after their internal consistency is proven.
 */
export function correctPunchedStartTime(
  source: PunchedStartTimeCorrectableResult,
  correctedStartTime: string
): PunchedStartTimeCorrectableResult {
  if (source.status !== "OK" && source.status !== "MP") {
    throw new ManualPunchStartTimeCorrectionError("UNSUPPORTED_STATUS", "Endast OK eller MP kan rättas");
  }
  if (source.reason !== "COMPLETE" && source.reason !== "MISSING_CONTROL" && source.reason !== "WRONG_ORDER") {
    throw new ManualPunchStartTimeCorrectionError("UNSUPPORTED_REASON", "Resultatets orsak kan inte rättas");
  }
  const sourceStartMs = finiteTime(source.startTime);
  const finishMs = finiteTime(source.finishTime);
  if (!Number.isSafeInteger(source.elapsedMs) || source.elapsedMs <= 0 || finishMs - sourceStartMs !== source.elapsedMs) {
    throw new ManualPunchStartTimeCorrectionError("INVALID_SOURCE_TIME", "Källans löptid motsvarar inte start och mål");
  }
  const correctedStartMs = finiteTime(correctedStartTime);
  if (correctedStartMs === sourceStartMs || correctedStartMs >= finishMs) {
    throw new ManualPunchStartTimeCorrectionError("INVALID_CORRECTED_START", "Korrigerad start måste skilja sig och ligga före mål");
  }
  const absoluteSplits = sourceSplitTimes(source, sourceStartMs, finishMs);
  if (absoluteSplits.some((splitMs) => correctedStartMs > splitMs)) {
    throw new ManualPunchStartTimeCorrectionError("INVALID_CORRECTED_START", "Korrigerad start får inte ligga efter en bevarad kontroll");
  }
  const elapsedMs = finishMs - correctedStartMs;
  if (!Number.isSafeInteger(elapsedMs) || elapsedMs <= 0) {
    throw new ManualPunchStartTimeCorrectionError("INVALID_CORRECTED_START", "Korrigerad löptid är ogiltig");
  }
  const splits: SplitTime[] = source.splits.map((split, index) => {
    const elapsed = absoluteSplits[index]! - correctedStartMs;
    const previous = index === 0 ? correctedStartMs : absoluteSplits[index - 1]!;
    const leg = absoluteSplits[index]! - previous;
    if (!Number.isSafeInteger(elapsed) || !Number.isSafeInteger(leg) || elapsed < 0 || leg < 0) {
      throw new ManualPunchStartTimeCorrectionError("INVALID_CORRECTED_START", "Korrigerad split-tid är ogiltig");
    }
    return { ...split, elapsedMs: elapsed, legMs: leg };
  });
  return { ...source, startTime: new Date(correctedStartMs).toISOString(), elapsedMs, splits };
}
