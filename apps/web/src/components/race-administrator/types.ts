import type {
  AdministratorReturnRequest, AdministratorStartCorrectionRequest, ClassCapacityRequest, ClassEditRequest, EntryCardChangeRequest, EntryCardRentalChangeRequest, EntryCardRentalReturnChangeRequest,
  EntryCardRentalReuseRequest, EntryIdentityChangeRequest, EntryRegistrationCandidatesResponse,
  EntryRegistrationRequest, EntryStartTimeChangeRequest, EntryTransferRequest, ManualClassCreateRequest,
  CourseEditRequest, RogainingChangeRequest, StartDrawRequest, StartCheckinConflictReviewCandidate, StartCheckinConflictReviewRequest,
  UnknownReadoutResolutionCandidateResponse, UnknownReadoutResolutionRequest, EntryStatusRequest, EntryStatusResponse
} from "@o-tid/contracts";
import type { StatusChoice } from "../../lib/participant-status-choices";
import type { AdministratorPublicationAttempt } from "../../lib/administrator-publication-client";
import type { ClassResultRecalculationAttempt } from "../../lib/class-result-recalculation-admin-client";
import type { ResultFinalizationAttempt } from "../../lib/result-finalization-admin-client";
import type { ResultRecalculationAttempt } from "../../lib/result-recalculation-admin-client";
import { formatDuration } from "../../lib/clock-time";

/** Ett pågående ändringsförsök. Alla försök granskas innan de skickas och kan skickas om med samma id. */
export type ConflictReviewAttempt = { kind: "CONFLICT_REVIEW"; candidate: StartCheckinConflictReviewCandidate; request: StartCheckinConflictReviewRequest };
export type CourseClassRequest = { formatVersion: 1; requestId: string; courseName: string; className: string;
  startRule: "PUNCH" | "FIXED"; controlCodes: number[]; rogaining?: { timeLimitMinutes: number; penaltyPoints: number } };
export type CourseClassAttempt = { kind: "COURSE_CLASS"; request: CourseClassRequest };
export type ManualClassAttempt = { kind: "MANUAL_CLASS"; request: ManualClassCreateRequest; targetLabel: string };
export type CourseEditAttempt = { kind: "COURSE_EDIT"; request: CourseEditRequest };
export type ClassEditAttempt = { kind: "CLASS_EDIT"; request: ClassEditRequest };
export type RogainingAttempt = { kind: "ROGAINING"; request: RogainingChangeRequest };
export type StartDrawAttempt = { kind: "START_DRAW"; request: StartDrawRequest };
export type UnknownReadoutResolutionAttempt = { kind: "UNKNOWN_READOUT_RESOLUTION";
  candidate: UnknownReadoutResolutionCandidateResponse; request: UnknownReadoutResolutionRequest };
export type TransferAttempt = {
  kind: "TRANSFER"; id: string; entryId: string; displayName: string; previousClassId: string;
  previousClassName: string; className: string; request: EntryTransferRequest;
};
export type CapacityAttempt = { kind: "CAPACITY"; id: string; classId: string; className: string; entryCount: number; request: ClassCapacityRequest };
export type CardAttempt = { kind: "CARD"; id: string; entryId: string; displayName: string; request: EntryCardChangeRequest };
export type RentalAttempt = { kind: "CARD_RENTAL"; id: string; entryId: string; displayName: string; request: EntryCardRentalChangeRequest };
export type RentalReturnAttempt = { kind: "CARD_RENTAL_RETURN"; id: string; entryId: string; displayName: string;
  request: EntryCardRentalReturnChangeRequest };
export type RentalReuseAttempt = { kind: "CARD_RENTAL_REUSE"; id: string; entryId: string; displayName: string;
  sourceDisplayName: string; request: EntryCardRentalReuseRequest };
export type TimeAttempt = { kind: "TIME"; id: string; entryId: string; displayName: string; timeZone: string; request: EntryStartTimeChangeRequest };
export type RecalculationAttempt = { kind: "RECALCULATION"; value: ResultRecalculationAttempt; timeZone: string };
export type IdentityAttempt = { kind: "IDENTITY"; id: string; entryId: string; request: EntryIdentityChangeRequest };
export type RegistrationAttempt = { kind: "REGISTRATION"; id: string; className: string; timeZone: string; request: EntryRegistrationRequest; candidates: EntryRegistrationCandidatesResponse };
/** Ett beslut i "Ändra status" (ADR-0173: ett statusflöde) med underlaget det fattades mot. */
export type DecisionAttempt = { kind: "DECISION"; choice: Exclude<StatusChoice, "RECALCULATION">; entryId: string;
  request: EntryStatusRequest; restores: EntryStatusResponse["withdrawRestores"] };
export type ReturnAttempt = { kind: "RETURN"; withdraw: boolean; name: string; request: AdministratorReturnRequest };
export type StartCorrectionAttempt = { kind: "START_CORRECTION"; name: string; request: AdministratorStartCorrectionRequest };
export type FinalizationAttempt = { kind: "FINALIZATION"; value: ResultFinalizationAttempt };

/** Det försök som just nu väntar på granskning eller kvitto. Bara ett åt gången. */
export type PendingAttempt = ConflictReviewAttempt | StartCorrectionAttempt | ReturnAttempt |
  AdministratorPublicationAttempt | StartDrawAttempt | TransferAttempt | CapacityAttempt | CardAttempt | RentalAttempt |
  RentalReturnAttempt | RentalReuseAttempt | TimeAttempt | RecalculationAttempt |
  ClassResultRecalculationAttempt | IdentityAttempt | RegistrationAttempt | DecisionAttempt | FinalizationAttempt | CourseClassAttempt | ManualClassAttempt |
  CourseEditAttempt | ClassEditAttempt | RogainingAttempt |
  UnknownReadoutResolutionAttempt;

export type Action = "INFO" | "TRANSFER" | "CARD" | "TIME" | "IDENTITY" | "REGISTRATION" | "HISTORY";
export type Operation = { generation: number; controller: AbortController; timer: ReturnType<typeof setTimeout> };

/** Löptid i arbetsytan: m:ss eller h:mm:ss, utan millisekunder. */
export const resultDuration = formatDuration;

export function unknownReadoutTargetLabel(value: UnknownReadoutResolutionAttempt): string {
  return value.request.target === "NEW_ENTRY" ? `${value.request.familyName}, ${value.request.givenName}` : "Befintlig deltagare";
}

export { parseControlCodes } from "../../lib/form-validation";
