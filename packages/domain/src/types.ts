export type UUID = string;

export interface ExternalIdentity {
  readonly source: "iof" | "eventor";
  readonly externalId: string;
}

export interface Event {
  readonly id: UUID;
  readonly name: string;
  readonly startsOn: string;
  readonly timeZone: string;
}

export interface Race {
  readonly id: UUID;
  readonly eventId: UUID;
  readonly name: string;
  readonly raceDate: string;
  readonly snapshotVersion: number;
}

export type StartRule = "FIXED" | "PUNCH";

export interface RaceClass {
  readonly id: UUID;
  readonly raceId: UUID;
  readonly name: string;
  readonly courseVersionId: UUID;
  readonly startRule: StartRule;
  readonly externalIdentity?: ExternalIdentity;
}

export type ControlKind = "START" | "CONTROL" | "FINISH";

export interface Control {
  readonly id: UUID;
  readonly raceId: UUID;
  readonly code: number;
  readonly kind: ControlKind;
  readonly externalIdentity?: ExternalIdentity;
}

export interface CourseControl {
  readonly id: UUID;
  readonly courseVersionId: UUID;
  readonly controlId: UUID;
  readonly sequence: number;
  readonly controlCode: number;
}

export interface CourseVersion {
  readonly id: UUID;
  readonly courseId: UUID;
  readonly version: number;
  readonly controls: readonly CourseControl[];
  readonly createdAt: string;
}

export interface Course {
  readonly id: UUID;
  readonly raceId: UUID;
  readonly name: string;
  readonly externalIdentity?: ExternalIdentity;
  readonly versions: readonly CourseVersion[];
}

export interface Entry {
  readonly id: UUID;
  readonly raceId: UUID;
  readonly classId: UUID;
  readonly givenName: string;
  readonly familyName: string;
  readonly organisationName?: string;
  readonly fixedStartTime?: string;
  readonly externalIdentity?: ExternalIdentity;
}

export interface CardAssignment {
  readonly id: UUID;
  readonly raceId: UUID;
  readonly entryId: UUID;
  readonly cardNumber: string;
  readonly active: boolean;
}

/**
 * An immutable, class-scoped decision that makes one exact course-control
 * occurrence optional when evaluating future readouts.  It deliberately
 * identifies the occurrence instead of only its code: a course may contain
 * the same control code more than once.
 */
export interface ClassControlNeutralization {
  readonly id: UUID;
  readonly classId: UUID;
  readonly courseVersionId: UUID;
  readonly courseControlId: UUID;
  readonly sequence: number;
  readonly controlCode: number;
}

export interface Punch {
  readonly code: number;
  readonly punchedAt: string;
}

export interface EvaluationReadout {
  readonly cardNumber: string;
  readonly startPunchedAt?: string;
  readonly finishPunchedAt?: string;
  readonly punches: readonly Punch[];
}

export interface NormalizedCardReadout extends EvaluationReadout {
  readonly id: UUID;
  readonly raceId: UUID;
  readonly rawMessageId: UUID;
  readonly readAt: string;
}

export interface RaceSnapshot {
  readonly race: Race;
  readonly classes: readonly RaceClass[];
  readonly courses: readonly Course[];
  readonly entries: readonly Entry[];
  readonly cardAssignments: readonly CardAssignment[];
  readonly classControlNeutralizations: readonly ClassControlNeutralization[];
}

export type EvaluationStatus = "OK" | "MP" | "UNKNOWN_CARD";
export type EvaluationReason =
  | "COMPLETE"
  | "UNKNOWN_CARD"
  | "MISSING_START"
  | "MISSING_FINISH"
  | "MISSING_CONTROL"
  | "WRONG_ORDER"
  | "INVALID_TIME_ORDER";

export interface SplitTime {
  readonly controlCode: number;
  readonly occurrence: number;
  readonly elapsedMs: number;
  readonly legMs: number;
}

export interface EvaluationResult {
  readonly status: EvaluationStatus;
  readonly reason: EvaluationReason;
  readonly entryId?: UUID;
  readonly classId?: UUID;
  readonly courseVersionId?: UUID;
  readonly startTime?: string;
  readonly finishTime?: string;
  readonly elapsedMs?: number;
  readonly missingControls: readonly number[];
  readonly extraPunches: readonly number[];
  readonly splits: readonly SplitTime[];
}

/**
 * Versioned policy for an explicit, administrative declaration that an entry
 * did not start. This is deliberately separate from the card evaluation
 * engine: absence cannot be inferred from a card readout.
 */
export const DID_NOT_START_POLICY_VERSION = "did-not-start-v1";

export interface DidNotStartResult {
  readonly status: "DNS";
  readonly reason: "DID_NOT_START";
  readonly entryId: UUID;
  readonly classId: UUID;
  /** Current class-course provenance, not evidence of a completed course. */
  readonly courseVersionId: UUID;
}

/**
 * An explicit did-not-finish decision is a persisted-only status. The exact
 * technical target remains immutable provenance outside this outcome; no time
 * or control fact is copied into the DNF result itself.
 */
export interface DidNotFinishResult {
  readonly status: "DNF";
  readonly reason: "DID_NOT_FINISH";
  readonly entryId: UUID;
  readonly classId: UUID;
  readonly courseVersionId: UUID;
}

/**
 * An explicit without-timing decision preserves only the historical identity
 * of one completed technical result. Timing and control facts remain solely
 * in the immutable target revision and must not cross into this outcome.
 */
export interface WithoutTimingResult {
  readonly status: "NT";
  readonly reason: "WITHOUT_TIMING";
  readonly entryId: UUID;
  readonly classId: UUID;
  readonly courseVersionId: UUID;
}

/**
 * A manual out-of-competition result preserves the exact technical facts from
 * one OK/MP target while excluding the entry from competition ranking.
 */
export interface OutOfCompetitionResult extends Omit<EvaluationResult, "status" | "reason"> {
  readonly status: "OOC";
  readonly reason: "OUT_OF_COMPETITION";
  readonly entryId: UUID;
  readonly classId: UUID;
  readonly courseVersionId: UUID;
}

/**
 * A manual disqualification copies every verifiable competition fact from one
 * exact stored OK/MP result and changes only status and reason.
 */
export interface DisqualifiedResult extends Omit<EvaluationResult, "status" | "reason"> {
  readonly status: "DSQ";
  readonly reason: "MANUAL_DISQUALIFICATION";
  readonly entryId: UUID;
  readonly classId: UUID;
  readonly courseVersionId: UUID;
}

/**
 * A manual approval preserves every observed MP fact while recording that an
 * authorized operator accepted the result as rankable. It is never emitted by
 * the card evaluation engine.
 */
export interface ManuallyApprovedResult extends Omit<EvaluationResult, "status" | "reason"> {
  readonly status: "OK";
  readonly reason: "MANUAL_APPROVAL";
  readonly entryId: UUID;
  readonly classId: UUID;
  readonly courseVersionId: UUID;
  readonly startTime: string;
  readonly finishTime: string;
  readonly elapsedMs: number;
}

/** A persisted revision outcome, from either the card engine or a manual decision. */
export type ResultOutcome =
  | EvaluationResult
  | DidNotStartResult
  | DidNotFinishResult
  | WithoutTimingResult
  | OutOfCompetitionResult
  | DisqualifiedResult
  | ManuallyApprovedResult;

export type RevisionCause =
  | "CARD_READOUT"
  | "CLASS_CHANGE_RECALCULATION"
  | "EXPLICIT_RECALCULATION"
  | "MANUAL_DID_NOT_START"
  | "START_CHECKIN_DID_NOT_START"
  | "UNKNOWN_READOUT_RESOLUTION"
  | "MANUAL_DISQUALIFICATION"
  | "MANUAL_DISQUALIFICATION_WITHDRAWAL"
  | "MANUAL_RESULT_APPROVAL"
  | "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
  | "MANUAL_DID_NOT_FINISH"
  | "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
  | "MANUAL_OUT_OF_COMPETITION"
  | "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"
  | "MANUAL_WITHOUT_TIMING"
  | "MANUAL_WITHOUT_TIMING_WITHDRAWAL"
  | "MANUAL_FINISH_TIME_CORRECTION"
  | "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL"
  | "MANUAL_PUNCH_START_TIME_CORRECTION"
  | "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL";

export interface ResultRevision {
  readonly id: UUID;
  readonly raceId: UUID;
  readonly entryId: UUID;
  readonly readoutId?: UUID;
  readonly revision: number;
  readonly cause: RevisionCause;
  readonly evaluation: ResultOutcome;
  readonly engineVersion: string;
  readonly snapshotVersion: number;
  readonly courseVersionId: UUID;
  readonly published: boolean;
  readonly createdAt: string;
}
