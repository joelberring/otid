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
  /**
   * Rogaining (ADR-0170 beslut 5): resultatets poäng. När någon kandidat i klassen har poäng rangordnas klassen
   * på poäng (högst först) och sedan tid; ett godkänt resultat utan poäng räknas då som noll poäng.
   */
  readonly score?: number;
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
  | "INVALID_ELAPSED_TIME"
  | "INVALID_SCORE";

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
  if (candidate.score !== undefined && !(Number.isSafeInteger(candidate.score) && candidate.score >= 0)) {
    throw new ClassRankingError("INVALID_SCORE", "Rankingkandidaten har ogiltiga poäng");
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
 *
 * Rogaining: when any candidate carries a score the class is ranked on score
 * (highest first), then elapsed time; equal score and time share the place.
 * Time behind is not derived for scored classes.
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
  const scored = candidates.some((candidate) => candidate.score !== undefined);
  const compareRanked = (left: ClassRankingCandidate, right: ClassRankingCandidate) =>
    (scored ? (right.score ?? 0) - (left.score ?? 0) : 0) || (left.elapsedMs as number) - (right.elapsedMs as number);
  const rankedByTime = [...rankedCandidates].sort((left, right) => compareRanked(left, right) || compareText(left.key, right.key));
  const rankingByKey = new Map<string, { position: number; timeBehindMs?: number }>();
  if (!hasMixedCourseVersions && rankedByTime.length > 0) {
    const fastestMs = rankedByTime[0]!.elapsedMs as number;
    let previous: ClassRankingCandidate | undefined;
    let position = 0;
    for (const [index, candidate] of rankedByTime.entries()) {
      if (!previous || compareRanked(previous, candidate) !== 0) position = index + 1;
      rankingByKey.set(candidate.key, scored ? { position } : { position, timeBehindMs: (candidate.elapsedMs as number) - fastestMs });
      previous = candidate;
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
      ...(ranking.timeBehindMs === undefined ? {} : { timeBehindMs: ranking.timeBehindMs })
    };
  });

  return output.sort((left, right) => {
    const leftCandidate = candidateByKey.get(left.key)!;
    const rightCandidate = candidateByKey.get(right.key)!;
    const leftRanked = left.rankingState === "RANKED";
    const rightRanked = right.rankingState === "RANKED";
    if (leftRanked !== rightRanked) return leftRanked ? -1 : 1;
    if (leftRanked && rightRanked) {
      const difference = compareRanked(leftCandidate, rightCandidate);
      if (difference !== 0) return difference;
    }
    if (leftCandidate.status !== rightCandidate.status) {
      return compareResultStatuses(leftCandidate.status, rightCandidate.status);
    }
    return compareText(left.key, right.key);
  });
}
