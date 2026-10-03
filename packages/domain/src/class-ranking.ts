import { compareResultStatuses, type StoredResultStatus } from "./result-status-order";

/**
 * A selected, historical result from one class. `key` is intentionally opaque:
 * adapters may use an internal identifier to join the derived result back to
 * their private projection, but the ranking function never interprets it.
 */
export interface ClassRankingCandidate {
  readonly key: string;
  readonly status: StoredResultStatus;
  readonly elapsedMs?: number;
  readonly courseVersionId: string;
}

export type ClassRankingState =
  | "RANKED"
  | "NOT_RANKABLE_STATUS"
  | "MIXED_COURSE_VERSIONS";

export interface ClassRankingResult {
  readonly key: string;
  readonly rankingState: ClassRankingState;
  readonly position?: number;
  readonly timeBehindMs?: number;
}

export type ClassRankingErrorCode =
  | "INVALID_KEY"
  | "DUPLICATE_KEY"
  | "INVALID_STATUS"
  | "INVALID_COURSE_VERSION"
  | "INVALID_ELAPSED_TIME";

/** A fail-closed validation error for stored-result projections. */
export class ClassRankingError extends Error {
  readonly code: ClassRankingErrorCode;

  constructor(code: ClassRankingErrorCode, message: string) {
    super(message);
    this.name = "ClassRankingError";
    this.code = code;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasValidElapsedMs(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validateCandidate(candidate: ClassRankingCandidate, keys: Set<string>): void {
  if (typeof candidate.key !== "string" || candidate.key.trim().length === 0) {
    throw new ClassRankingError("INVALID_KEY", "Rankingkandidat saknar en giltig resultatnyckel");
  }
  if (keys.has(candidate.key)) {
    throw new ClassRankingError("DUPLICATE_KEY", "Rankingkandidatens resultatnyckel förekommer flera gånger");
  }
  keys.add(candidate.key);
  if (candidate.status !== "OK" && candidate.status !== "MP" &&
      candidate.status !== "DSQ" && candidate.status !== "DNF" &&
      candidate.status !== "OOC" && candidate.status !== "NT" && candidate.status !== "DNS") {
    throw new ClassRankingError("INVALID_STATUS", "Rankingkandidaten har en okänd status");
  }
  if (typeof candidate.courseVersionId !== "string" || candidate.courseVersionId.trim().length === 0) {
    throw new ClassRankingError("INVALID_COURSE_VERSION", "Rankingkandidaten saknar historisk banversion");
  }
  if (candidate.elapsedMs !== undefined && !hasValidElapsedMs(candidate.elapsedMs)) {
    throw new ClassRankingError("INVALID_ELAPSED_TIME", "Rankingkandidaten har ogiltig sluttid");
  }
  if (candidate.status === "OK" && !hasValidElapsedMs(candidate.elapsedMs)) {
    throw new ClassRankingError("INVALID_ELAPSED_TIME", "OK-resultat måste ha en giltig sluttid");
  }
}

/**
 * Derives competition ranking for one already-selected historical class.
 *
 * The result list is in deterministic display order. `key` resolves output
 * rows back to the caller's projection and must not be serialised as public
 * data. Equal elapsed milliseconds deliberately remain a tie: keys are used
 * solely for stable presentation order.
 */
export function rankClassResults(
  candidates: readonly ClassRankingCandidate[]
): readonly ClassRankingResult[] {
  const keys = new Set<string>();
  for (const candidate of candidates) validateCandidate(candidate, keys);

  const rankedCandidates = candidates.filter((candidate) => candidate.status === "OK");
  const courseVersionIds = new Set(rankedCandidates.map((candidate) => candidate.courseVersionId));
  const hasMixedCourseVersions = courseVersionIds.size > 1;
  const candidateByKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const rankedByTime = [...rankedCandidates].sort((left, right) =>
    (left.elapsedMs as number) - (right.elapsedMs as number) || compareText(left.key, right.key)
  );
  const rankingByKey = new Map<string, { position: number; timeBehindMs: number }>();
  if (!hasMixedCourseVersions && rankedByTime.length > 0) {
    const fastestMs = rankedByTime[0]!.elapsedMs as number;
    let previousMs: number | undefined;
    let position = 0;
    for (const [index, candidate] of rankedByTime.entries()) {
      const elapsedMs = candidate.elapsedMs as number;
      if (elapsedMs !== previousMs) position = index + 1;
      rankingByKey.set(candidate.key, { position, timeBehindMs: elapsedMs - fastestMs });
      previousMs = elapsedMs;
    }
  }

  const output = candidates.map<ClassRankingResult>((candidate) => {
    if (candidate.status === "MP" || candidate.status === "DSQ" ||
        candidate.status === "DNF" || candidate.status === "OOC" || candidate.status === "NT" ||
        candidate.status === "DNS") {
      return { key: candidate.key, rankingState: "NOT_RANKABLE_STATUS" };
    }
    if (hasMixedCourseVersions) {
      return { key: candidate.key, rankingState: "MIXED_COURSE_VERSIONS" };
    }

    const ranking = rankingByKey.get(candidate.key);
    if (!ranking) {
      throw new ClassRankingError("INVALID_ELAPSED_TIME", "OK-resultat saknar härledd ranking");
    }
    return {
      key: candidate.key,
      rankingState: "RANKED",
      position: ranking.position,
      timeBehindMs: ranking.timeBehindMs
    };
  });

  return output.sort((left, right) => {
    const leftCandidate = candidateByKey.get(left.key)!;
    const rightCandidate = candidateByKey.get(right.key)!;
    const leftRanked = left.rankingState === "RANKED";
    const rightRanked = right.rankingState === "RANKED";
    if (leftRanked !== rightRanked) return leftRanked ? -1 : 1;
    if (leftRanked && rightRanked) {
      const elapsedDifference = (leftCandidate.elapsedMs as number) - (rightCandidate.elapsedMs as number);
      if (elapsedDifference !== 0) return elapsedDifference;
    }
    if (leftCandidate.status !== rightCandidate.status) {
      return compareResultStatuses(leftCandidate.status, rightCandidate.status);
    }
    return compareText(left.key, right.key);
  });
}
