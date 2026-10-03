import { buildForestWatchList, type ForestWatchEntryFacts } from "./forest-watch";

export interface StartCheckinConflictReviewFacts {
  readonly raceId: string;
  readonly entryId: string;
  readonly expectedSourceHash: string;
  readonly sourceHash: string;
  readonly expectedConflictRequestIds: readonly string[];
  readonly conflictRequestIds: readonly string[];
  readonly current: Omit<ForestWatchEntryFacts, "conflictingReports">;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash = /^[a-f0-9]{64}$/;
function validIds(value: readonly string[], allowEmpty: boolean): boolean {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.length <= 1000 &&
    value.every((id, index) => typeof id === "string" && uuid.test(id) && (index === 0 || value[index - 1]! < id));
}

/** Review changes only the unresolved-report set, never registered facts or result history. */
export function planStartCheckinConflictReview(input: StartCheckinConflictReviewFacts) {
  if (!input || !uuid.test(input.raceId) || !uuid.test(input.entryId) || !hash.test(input.expectedSourceHash) ||
    !hash.test(input.sourceHash) || !validIds(input.expectedConflictRequestIds, false) || !validIds(input.conflictRequestIds, true) ||
    !input.current || input.current.raceId !== input.raceId || input.current.entryId !== input.entryId) {
    throw new Error("Invalid conflict review facts");
  }
  // Validates every current fact and reuses the existing contradiction/follow-up rules.
  const [remaining] = buildForestWatchList(input.raceId, [{ ...input.current, conflictingReports: false }]);
  if (!remaining) throw new Error("Missing conflict review facts");
  if (input.conflictRequestIds.length === 0) return { kind: "CONFLICT" as const, reason: "NO_PENDING_CONFLICTS" as const };
  if (input.expectedSourceHash !== input.sourceHash || input.expectedConflictRequestIds.length !== input.conflictRequestIds.length ||
    input.expectedConflictRequestIds.some((id, index) => input.conflictRequestIds[index] !== id)) {
    return { kind: "CONFLICT" as const, reason: "BASIS_CHANGED" as const };
  }
  if (remaining.state === "CONFLICT") return { kind: "CONFLICT" as const, reason: "CONTRADICTORY_CURRENT_STATE" as const };
  return { kind: "REVIEW" as const, decision: "KEEP_CURRENT_STATE" as const,
    conflictRequestIds: [...input.conflictRequestIds], remainingForestState: remaining.state, needsFollowUp: remaining.needsFollowUp };
}
