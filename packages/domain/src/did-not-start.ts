import type { DidNotStartResult, UUID } from "./types";

export interface DidNotStartResultInput {
  readonly entryId: UUID;
  readonly classId: UUID;
  readonly courseVersionId: UUID;
}

/**
 * Constructs the only manual result outcome introduced in TASK 006E.
 * Validation of the current entry/class/course/snapshot and actor intent is an
 * application concern; this pure constructor cannot infer a DNS from absence.
 */
export function createDidNotStartResult(input: DidNotStartResultInput): DidNotStartResult {
  return {
    status: "DNS",
    reason: "DID_NOT_START",
    entryId: input.entryId,
    classId: input.classId,
    courseVersionId: input.courseVersionId
  };
}
