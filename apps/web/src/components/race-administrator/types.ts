import type {
  AdministratorReturnRequest, AdministratorStartCorrectionRequest, ClassCapacityRequest, ClassEditRequest, EntryCardChangeRequest, EntryCardRentalChangeRequest, EntryCardRentalReturnChangeRequest,
  EntryCardRentalReuseRequest, EntryIdentityChangeRequest, EntryPaymentStatusChangeRequest, EntryRegistrationCandidatesResponse,
  EntryRegistrationRequest, EntryStartTimeChangeRequest, EntryTransferRequest, ManualClassCreateRequest,
  CourseEditRequest, ShortenedCourseClassTransferCandidate,
  ShortenedCourseClassTransferRequest, StartCheckinConflictReviewCandidate, StartCheckinConflictReviewRequest,
  UnknownReadoutResolutionCandidateResponse, UnknownReadoutResolutionRequest
} from "@o-tid/contracts";
import type { AdministratorDrawAttempt } from "../../lib/administrator-start-draw-client";
import type { AdministratorPublicationAttempt } from "../../lib/administrator-publication-client";
import type { ClassResultRecalculationAttempt } from "../../lib/class-result-recalculation-admin-client";
import type { DidNotFinishAttempt } from "../../lib/did-not-finish-admin-client";
import type { DidNotFinishWithdrawalAttempt } from "../../lib/did-not-finish-withdrawal-admin-client";
import type { DidNotStartAttempt } from "../../lib/did-not-start-admin-client";
import type { DidNotStartWithdrawalAttempt } from "../../lib/did-not-start-withdrawal-admin-client";
import type { OutOfCompetitionAttempt } from "../../lib/out-of-competition-admin-client";
import type { OutOfCompetitionWithdrawalAttempt } from "../../lib/out-of-competition-withdrawal-admin-client";
import type { ResultApprovalAttempt } from "../../lib/result-approval-admin-client";
import type { ResultApprovalWithdrawalAttempt } from "../../lib/result-approval-withdrawal-admin-client";
import type { ResultDisqualificationAttempt } from "../../lib/result-disqualification-admin-client";
import type { ResultDisqualificationWithdrawalAttempt } from "../../lib/result-disqualification-withdrawal-admin-client";
import type { ResultFinalizationAttempt } from "../../lib/result-finalization-admin-client";
import type { ResultRecalculationAttempt } from "../../lib/result-recalculation-admin-client";
import type { WithoutTimingAttempt } from "../../lib/without-timing-admin-client";
import type { WithoutTimingWithdrawalAttempt } from "../../lib/without-timing-withdrawal-admin-client";
import type { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";

/** Ett pågående ändringsförsök. Alla försök granskas innan de skickas och kan skickas om med samma id. */
export type ConflictReviewAttempt = { kind: "CONFLICT_REVIEW"; candidate: StartCheckinConflictReviewCandidate; request: StartCheckinConflictReviewRequest };
export type CourseClassRequest = { formatVersion: 1; requestId: string; expectedSnapshotVersion: number; courseName: string; className: string; startRule: "PUNCH" | "FIXED"; controlCodes: number[] };
export type CourseClassAttempt = { kind: "COURSE_CLASS"; request: CourseClassRequest };
export type ManualClassAttempt = { kind: "MANUAL_CLASS"; request: ManualClassCreateRequest; targetLabel: string };
export type CourseEditAttempt = { kind: "COURSE_EDIT"; request: CourseEditRequest };
export type ClassEditAttempt = { kind: "CLASS_EDIT"; request: ClassEditRequest };
export type ShortenedCourseClassTransferAttempt = { kind: "SHORTENED_COURSE_CLASS_TRANSFER";
  candidate: ShortenedCourseClassTransferCandidate; request: ShortenedCourseClassTransferRequest };
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
export type PaymentStatusAttempt = { kind: "PAYMENT_STATUS"; id: string; entryId: string; displayName: string;
  request: EntryPaymentStatusChangeRequest };
export type TimeAttempt = { kind: "TIME"; id: string; entryId: string; displayName: string; timeZone: string; request: EntryStartTimeChangeRequest };
export type RecalculationAttempt = { kind: "RECALCULATION"; value: ResultRecalculationAttempt; timeZone: string };
export type IdentityAttempt = { kind: "IDENTITY"; id: string; entryId: string; request: EntryIdentityChangeRequest };
export type RegistrationAttempt = { kind: "REGISTRATION"; id: string; className: string; timeZone: string; request: EntryRegistrationRequest; candidates: EntryRegistrationCandidatesResponse };
export type DnsAttempt = { kind: "DNS"; value: DidNotStartAttempt } | { kind: "DNS_WITHDRAWAL"; value: DidNotStartWithdrawalAttempt };
export type DnfAttempt = { kind: "DNF"; value: DidNotFinishAttempt } | { kind: "DNF_WITHDRAWAL"; value: DidNotFinishWithdrawalAttempt };
export type DsqAttempt = { kind: "DSQ"; value: ResultDisqualificationAttempt } | { kind: "DSQ_WITHDRAWAL"; value: ResultDisqualificationWithdrawalAttempt };
export type ApprovalAttempt = { kind: "APPROVAL"; value: ResultApprovalAttempt } | { kind: "APPROVAL_WITHDRAWAL"; value: ResultApprovalWithdrawalAttempt };
export type NtAttempt = { kind: "NT"; value: WithoutTimingAttempt } | { kind: "NT_WITHDRAWAL"; value: WithoutTimingWithdrawalAttempt };
export type OocAttempt = { kind: "OOC"; value: OutOfCompetitionAttempt } | { kind: "OOC_WITHDRAWAL"; value: OutOfCompetitionWithdrawalAttempt };
export type ReturnAttempt = { kind: "RETURN"; withdraw: boolean; name: string; request: AdministratorReturnRequest };
export type StartCorrectionAttempt = { kind: "START_CORRECTION"; name: string; request: AdministratorStartCorrectionRequest };
export type FinalizationAttempt = { kind: "FINALIZATION"; value: ResultFinalizationAttempt };

/** Det försök som just nu väntar på granskning eller kvitto. Bara ett åt gången. */
export type PendingAttempt = ConflictReviewAttempt | StartCorrectionAttempt | ReturnAttempt |
  AdministratorPublicationAttempt | AdministratorDrawAttempt | TransferAttempt | CapacityAttempt | CardAttempt | RentalAttempt |
  RentalReturnAttempt | RentalReuseAttempt | PaymentStatusAttempt | TimeAttempt | RecalculationAttempt |
  ClassResultRecalculationAttempt | IdentityAttempt | RegistrationAttempt | DnsAttempt | DnfAttempt | DsqAttempt |
  ApprovalAttempt | OocAttempt | NtAttempt | FinalizationAttempt | CourseClassAttempt | ManualClassAttempt |
  CourseEditAttempt | ClassEditAttempt |
  ShortenedCourseClassTransferAttempt | UnknownReadoutResolutionAttempt;

export type Action = "INFO" | "TRANSFER" | "CARD" | "PAYMENT" | "TIME" | "IDENTITY" | "REGISTRATION" | "HISTORY";
export type WorkflowMode = "OVERVIEW" | "PARTICIPANTS" | "BEFORE" | "DURING" | "AFTER";
export type PreparationArea = keyof typeof navigationText.preparation;
export type DuringArea = keyof typeof navigationText.during;
export type Operation = { generation: number; controller: AbortController; timer: ReturnType<typeof setTimeout> };

export function resultDuration(ms: number) {
  const seconds = Math.floor(ms / 1000), fraction = ms % 1000;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}${fraction ? `.${String(fraction).padStart(3, "0")}` : ""}`;
}

export function unknownReadoutTargetLabel(value: UnknownReadoutResolutionAttempt): string {
  return value.request.target === "NEW_ENTRY" ? `${value.request.familyName}, ${value.request.givenName}` : "Befintlig deltagare";
}

/** Tolkar kontrollkoder skrivna med mellanslag eller komma. Ger undefined om listan är tom, för lång eller ogiltig. */
export function parseControlCodes(input: string): number[] | undefined {
  const tokens = input.trim().split(/[\s,]+/).filter(Boolean);
  const codes = tokens.map(Number);
  if (!tokens.length || tokens.length > 1000 || codes.some(code => !Number.isInteger(code) || code <= 0 || code > 2147483647)) return undefined;
  return codes;
}
