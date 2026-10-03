"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { flushSync } from "react-dom";
import { parseIofResultListExportMetadata, iofResultListExportFilename, parseFrozenRaceFinalizations, validateFrozenIofResultListResponse } from "../lib/iof-result-list-export-admin-client";
import type { RaceResultFinalizationMetadata } from "@o-tid/contracts";
import { classStartDrawClassesResponseSchema, classStartDrawParametersSchema, classStartDrawPreviewResponseSchema,
  type ClassStartDrawClassesResponse } from "@o-tid/contracts";
import { manualClassCreateRequestSchema, manualClassCreateResponseSchema, type ManualClassCreateRequest } from "@o-tid/contracts";
import { manualClassNameCandidateSchema, manualClassNameChangeRequestSchema,
  manualClassNameChangeResponseSchema, type ManualClassNameCandidate,
  type ManualClassNameChangeRequest } from "@o-tid/contracts";
import { parseAdministratorDrawReceipt, type AdministratorDrawAttempt } from "../lib/administrator-start-draw-client";
import { classStartDrawSv as drawText } from "../i18n/class-start-draw-sv";
import { startListPublicationPreviewResponseSchema, startListPublicationRequestSchema, type StartListPublicationPreviewResponse } from "@o-tid/contracts";
import { parseAdministratorPublicationReceipt, type AdministratorPublicationAttempt } from "../lib/administrator-publication-client";
import { startListPublicationSv as publicationText } from "../i18n/start-list-publication-sv";
import { administratorForestWatchResponseSchema, type AdministratorForestWatchResponse } from "@o-tid/contracts";
import { ForestWatchReport } from "./forest-watch-report";
import { forestWatchSv as forestText } from "../i18n/forest-watch-sv";
import { administratorReturnRequestSchema, administratorReturnResponseSchema, canonicalAdministratorReturnRequest, type AdministratorReturnRequest } from "@o-tid/contracts";
import { administratorStartCorrectionRequestSchema, administratorStartCorrectionResponseSchema, canonicalAdministratorStartCorrectionRequest, type AdministratorStartCorrectionRequest } from "@o-tid/contracts";
import { checkinHistoryResponseSchema, type CheckinHistoryResponse } from "@o-tid/contracts";
import { CheckinHistoryTable } from "./checkin-history-table";
import { checkinHistorySv } from "../i18n/checkin-history-sv";
import { StartCheckinConflictReviewCandidateSchema, StartCheckinConflictReviewRequestSchema, StartCheckinConflictReviewResponseSchema,
  type StartCheckinConflictReviewCandidate, type StartCheckinConflictReviewRequest } from "@o-tid/contracts";
import { checkinConflictReviewSv as reviewText } from "../i18n/checkin-conflict-review-sv";
import { AdministratorConflictEvidence } from "./administrator-conflict-evidence";
import { ParticipantEntryClaimAdmin } from "./participant-entry-claim-admin";
import { RaceWorkspaceOverview } from "./race-workspace-overview";
import { RaceOperatorAccess } from "./race-operator-access";
import { readOrganizerCsrf } from "../lib/organizer-client";
import { RacePreparationGuide, type PreparationStepArea } from "./race-preparation-guide";
import { RaceParticipantFacts } from "./race-participant-facts";
import { RaceParticipantCourse } from "./race-participant-course";
import { RaceResultControls } from "./race-result-controls";
import { RaceWorkspaceSpeaker } from "./race-workspace-speaker";
import { RaceCourseOverview } from "./race-course-overview";
import { RaceClassOverview } from "./race-class-overview";
import { RacePreparationStartList } from "./race-preparation-start-list";
import { raceWorkspaceNavigationSv as navigationText } from "../i18n/race-workspace-navigation-sv";
type ConflictReviewAttempt = { kind: "CONFLICT_REVIEW"; candidate: StartCheckinConflictReviewCandidate; request: StartCheckinConflictReviewRequest };
type CourseClassRequest = { formatVersion: 1; requestId: string; expectedSnapshotVersion: number; courseName: string; className: string; startRule: "PUNCH" | "FIXED"; controlCodes: number[] };
type CourseClassAttempt = { kind: "COURSE_CLASS"; request: CourseClassRequest };
type ManualClassAttempt = { kind: "MANUAL_CLASS"; request: ManualClassCreateRequest; targetLabel: string };
type ManualClassNameAttempt = { kind: "MANUAL_CLASS_NAME"; classId: string; courseVersionId: string;
  request: ManualClassNameChangeRequest };
type CourseVersionRelinkAttempt = { kind: "COURSE_VERSION_RELINK"; preview: ManualCourseVersionClassRelinkPreview;
  request: ManualCourseVersionClassRelinkRequest };
type CourseResultBearingRelinkAttempt = { kind: "COURSE_RESULT_BEARING_RELINK";
  candidate: ManualCourseResultBearingRelinkCandidate; request: ManualCourseResultBearingRelinkRequest };
type ShortenedCourseClassTransferAttempt = { kind: "SHORTENED_COURSE_CLASS_TRANSFER";
  candidate: ShortenedCourseClassTransferCandidate; request: ShortenedCourseClassTransferRequest };
type UnknownReadoutResolutionAttempt = { kind: "UNKNOWN_READOUT_RESOLUTION";
  candidate: UnknownReadoutResolutionCandidateResponse; request: UnknownReadoutResolutionRequest };
function unknownReadoutTargetLabel(value: UnknownReadoutResolutionAttempt): string {
  return value.request.target === "NEW_ENTRY" ? `${value.request.familyName}, ${value.request.givenName}` : "Befintlig deltagare";
}
import { canRefreshForest } from "../lib/forest-auto-refresh";
import { createClassFinalizationAttempt, createRaceFinalizationAttempt, parseResultFinalizationCandidates,
  parseResultFinalizationResponse, isDefinitiveResultFinalizationRejection,
  type ResultFinalizationAttempt, type ResultFinalizationCandidates } from "../lib/result-finalization-admin-client";
import {
  entryTransferCandidatesSchema, entryTransferRequestSchema, entryTransferResponseSchema,
  classCapacityRequestSchema, classCapacityResponseSchema, type ClassCapacityRequest,
  classStartRulePreviewSchema, classStartRuleChangeRequestSchema, classStartRuleChangeResponseSchema,
  type ClassStartRulePreview, type ClassStartRuleChangeRequest,
  entryCardChangeRequestSchema, entryCardChangeResponseSchema, type EntryCardChangeRequest,
  entryCardRentalChangeRequestSchema, entryCardRentalChangeResponseSchema, type EntryCardRentalChangeRequest,
  entryCardRentalReturnChangeRequestSchema, entryCardRentalReturnChangeResponseSchema,
  type EntryCardRentalReturnChangeRequest,
  entryCardRentalReuseRequestSchema, entryCardRentalReuseResponseSchema,
  type EntryCardRentalReuseRequest,
  entryPaymentStatusChangeRequestSchema, entryPaymentStatusChangeResponseSchema,
  type EntryPaymentStatus, type EntryPaymentStatusChangeRequest,
  entryStartTimeChangeRequestSchema, entryStartTimeChangeResponseSchema, type EntryStartTimeChangeRequest,
  administratorEffectiveResultResponseSchema, type AdministratorEffectiveResultResponse,
  entryIdentityAdminListResponseSchema, entryIdentityChangeRequestSchema,
  type EntryIdentityAdminListResponse, type EntryIdentityChangeRequest,
  entryRegistrationRequestSchema, type EntryRegistrationRequest,
  entryRegistrationCandidatesResponseSchema, type EntryRegistrationCandidatesResponse,
  entryRegistrationStartSlotCandidatesSchema, type EntryRegistrationStartSlotCandidates,
  administratorEntryChangesResponseSchema, type AdministratorEntryChangesResponse,
  raceAdministratorLoginResponseSchema, entryTransferStartSlotCandidatesSchema,
  type EntryTransferCandidates, type EntryTransferRequest, type EntryTransferStartSlotCandidates
} from "@o-tid/contracts";
import { manualCourseClassCreateResponseSchema, manualCourseVersionClassRelinkPreviewSchema,
  manualCourseVersionClassRelinkRequestSchema, manualCourseVersionClassRelinkResponseSchema,
  manualCourseResultImpactResponseSchema, type ManualCourseVersionClassRelinkPreview,
  manualCourseResultBearingRelinkCandidateSchema, manualCourseResultBearingRelinkRequestSchema,
  manualCourseResultBearingRelinkResponseSchema, type ManualCourseVersionClassRelinkRequest,
  type ManualCourseResultImpactResponse, type ManualCourseResultBearingRelinkCandidate,
  type ManualCourseResultBearingRelinkRequest,
  shortenedCourseClassTransferCandidateSchema, shortenedCourseClassTransferRequestSchema,
  shortenedCourseClassTransferReceiptSchema, type ShortenedCourseClassTransferCandidate,
  type ShortenedCourseClassTransferRequest,
  unknownReadoutResolutionCandidateResponseSchema, unknownReadoutResolutionRequestSchema,
  unknownReadoutResolutionResponseSchema, type UnknownReadoutResolutionCandidateResponse,
  type UnknownReadoutResolutionRequest } from "@o-tid/contracts";
import { readRaceAdministratorCsrfCookie } from "../lib/race-administrator-cookies";
import { parseStartTimeFields } from "../lib/start-time-fields";
import { formatStartListTime } from "../lib/start-list-time";
import { createResultRecalculationAttempt, resultRecalculationBody, parseResultRecalculationResponse,
  parseResultRecalculationCandidates, type ResultRecalculationCandidates,
  type ResultRecalculationAttempt } from "../lib/result-recalculation-admin-client";
import { createClassResultRecalculationAttempt, classResultRecalculationBody, parseClassResultRecalculationCandidates,
  parseClassResultRecalculationResponse, type ClassResultRecalculationCandidates,
  type ClassResultRecalculationAttempt } from "../lib/class-result-recalculation-admin-client";
import { raceAdministratorSv as text } from "../i18n/race-administrator-sv";
import { sv } from "../i18n/sv";
import { parseIdentityReceipt } from "../lib/entry-identity-client";
import { parseRegistrationReceipt } from "../lib/entry-registration-client";
import { TargetClassStartTimes } from "./target-class-start-times";
import { ClassStartTimeFollowUp } from "./class-start-time-follow-up";
import { FixedStartSlotPlans } from "./fixed-start-slot-plans";
import { ClassResultRecalculationFollowUp } from "./class-result-recalculation-follow-up";
import { ClassResultRecalculation } from "./class-result-recalculation";
import { ClassControlNeutralization } from "./class-control-neutralization";
import { ManualFinishTimeCorrection } from "./manual-finish-time-correction";
import { ManualFinishTimeCorrectionWithdrawal } from "./manual-finish-time-correction-withdrawal";
import { ManualPunchStartTimeCorrection } from "./manual-punch-start-time-correction";
import { ManualPunchStartTimeCorrectionWithdrawal } from "./manual-punch-start-time-correction-withdrawal";
import { isStrictCoursePrefix } from "../lib/course-prefix";
import { administratorRosterResultFilters, filterAdministratorRoster, missingFixedStartTime,
  needsPaymentAttention, orderAdministratorRoster, type AdministratorRosterOrder,
  type AdministratorRosterResultFilter } from "../lib/administrator-roster-filter";
import { AdministratorEntryChanges } from "./administrator-entry-changes";
import { createDidNotStartAttempt, didNotStartBody, parseDidNotStartCandidates, parseDidNotStartResponse,
  type DidNotStartAttempt, type DidNotStartCandidates } from "../lib/did-not-start-admin-client";
import { createDidNotStartWithdrawalAttempt, parseDidNotStartWithdrawals, parseDidNotStartWithdrawalResponse,
  type DidNotStartWithdrawalAttempt, type DidNotStartWithdrawals } from "../lib/did-not-start-withdrawal-admin-client";
import styles from "./race-administrator-workspace.module.css";
import { createDidNotFinishAttempt, parseDidNotFinishCandidates, parseDidNotFinishResponse,
  type DidNotFinishAttempt, type DidNotFinishCandidates } from "../lib/did-not-finish-admin-client";
import { createDidNotFinishWithdrawalAttempt, parseDidNotFinishWithdrawals, parseDidNotFinishWithdrawalResponse,
  type DidNotFinishWithdrawalAttempt, type DidNotFinishWithdrawals } from "../lib/did-not-finish-withdrawal-admin-client";
import { createResultDisqualificationAttempt, parseResultDisqualificationCandidates, parseResultDisqualificationResponse,
  type ResultDisqualificationAttempt, type ResultDisqualificationCandidates } from "../lib/result-disqualification-admin-client";
import { createResultDisqualificationWithdrawalAttempt, parseResultDisqualificationWithdrawals, parseResultDisqualificationWithdrawalResponse,
  type ResultDisqualificationWithdrawalAttempt, type ResultDisqualificationWithdrawals } from "../lib/result-disqualification-withdrawal-admin-client";
import { createResultApprovalAttempt, parseResultApprovalCandidates, parseResultApprovalResponse,
  type ResultApprovalAttempt, type ResultApprovalCandidates } from "../lib/result-approval-admin-client";
import { createResultApprovalWithdrawalAttempt, parseResultApprovalWithdrawals, parseResultApprovalWithdrawalResponse,
  type ResultApprovalWithdrawalAttempt, type ResultApprovalWithdrawals } from "../lib/result-approval-withdrawal-admin-client";
import { createOutOfCompetitionAttempt, parseOutOfCompetitionCandidates, parseOutOfCompetitionResponse,
  type OutOfCompetitionAttempt, type OutOfCompetitionCandidates } from "../lib/out-of-competition-admin-client";
import { createOutOfCompetitionWithdrawalAttempt, parseOutOfCompetitionWithdrawals, parseOutOfCompetitionWithdrawalResponse,
  type OutOfCompetitionWithdrawalAttempt, type OutOfCompetitionWithdrawals } from "../lib/out-of-competition-withdrawal-admin-client";

type Attempt = {
  kind: "TRANSFER"; id: string; entryId: string; displayName: string; previousClassId: string;
  previousClassName: string; className: string; request: EntryTransferRequest;
};
type CapacityAttempt = { kind: "CAPACITY"; id: string; classId: string; className: string; entryCount: number; request: ClassCapacityRequest };
type StartRuleAttempt = { kind: "START_RULE"; preview: ClassStartRulePreview; request: ClassStartRuleChangeRequest };
type CardAttempt = { kind: "CARD"; id: string; entryId: string; displayName: string; request: EntryCardChangeRequest };
type RentalAttempt = { kind: "CARD_RENTAL"; id: string; entryId: string; displayName: string; request: EntryCardRentalChangeRequest };
type RentalReturnAttempt = { kind: "CARD_RENTAL_RETURN"; id: string; entryId: string; displayName: string;
  request: EntryCardRentalReturnChangeRequest };
type RentalReuseAttempt = { kind: "CARD_RENTAL_REUSE"; id: string; entryId: string; displayName: string;
  sourceDisplayName: string; request: EntryCardRentalReuseRequest };
type PaymentStatusAttempt = { kind: "PAYMENT_STATUS"; id: string; entryId: string; displayName: string;
  request: EntryPaymentStatusChangeRequest };
type TimeAttempt = { kind: "TIME"; id: string; entryId: string; displayName: string; timeZone: string; request: EntryStartTimeChangeRequest };
type RecalculationAttempt = { kind: "RECALCULATION"; value: ResultRecalculationAttempt; timeZone: string };
type IdentityAttempt = { kind: "IDENTITY"; id: string; entryId: string; request: EntryIdentityChangeRequest };
type RegistrationAttempt = { kind: "REGISTRATION"; id: string; className: string; timeZone: string; request: EntryRegistrationRequest; candidates: EntryRegistrationCandidatesResponse };
type DnsAttempt = { kind: "DNS"; value: DidNotStartAttempt } | { kind: "DNS_WITHDRAWAL"; value: DidNotStartWithdrawalAttempt };
type DnfAttempt = { kind: "DNF"; value: DidNotFinishAttempt } | { kind: "DNF_WITHDRAWAL"; value: DidNotFinishWithdrawalAttempt };
type DsqAttempt = { kind: "DSQ"; value: ResultDisqualificationAttempt } | { kind: "DSQ_WITHDRAWAL"; value: ResultDisqualificationWithdrawalAttempt };
type ApprovalAttempt = { kind: "APPROVAL"; value: ResultApprovalAttempt } | { kind: "APPROVAL_WITHDRAWAL"; value: ResultApprovalWithdrawalAttempt };
import { createWithoutTimingAttempt, parseWithoutTimingCandidates, parseWithoutTimingResponse, type WithoutTimingCandidates, type WithoutTimingAttempt } from "../lib/without-timing-admin-client";
import { createWithoutTimingWithdrawalAttempt, parseWithoutTimingWithdrawals, parseWithoutTimingWithdrawalResponse, type WithoutTimingWithdrawals, type WithoutTimingWithdrawalAttempt } from "../lib/without-timing-withdrawal-admin-client";
type NtAttempt = { kind: "NT"; value: WithoutTimingAttempt } | { kind: "NT_WITHDRAWAL"; value: WithoutTimingWithdrawalAttempt };
type OocAttempt = { kind: "OOC"; value: OutOfCompetitionAttempt } | { kind: "OOC_WITHDRAWAL"; value: OutOfCompetitionWithdrawalAttempt };
type Action = "INFO" | "TRANSFER" | "CARD" | "PAYMENT" | "TIME" | "RECALCULATION" | "IDENTITY" | "REGISTRATION" | "HISTORY" | "DNS" | "DNF" | "DSQ" | "APPROVAL" | "OOC" | "NT";
type WorkflowMode = "OVERVIEW" | "PARTICIPANTS" | "BEFORE" | "DURING" | "AFTER";
type PreparationArea = keyof typeof navigationText.preparation;
type DuringArea = keyof typeof navigationText.during;
type Operation = { generation: number; controller: AbortController; timer: ReturnType<typeof setTimeout> };
function resultDuration(ms: number) {
  const seconds = Math.floor(ms / 1000), fraction = ms % 1000;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}${fraction ? `.${String(fraction).padStart(3, "0")}` : ""}`;
}

export function RaceAdministratorWorkspace({ raceId, developmentAutoLogin = false }: { raceId: string; developmentAutoLogin?: boolean }) {
  const [expiresAt, setExpiresAt] = useState<string>();
  const [authenticated, setAuthenticated] = useState(false);
  const [data, setData] = useState<EntryTransferCandidates>();
  const [query, setQuery] = useState("");
  const [olderResultsOnly, setOlderResultsOnly] = useState(false);
  const [rentalCardsOnly, setRentalCardsOnly] = useState(false);
  const [paymentAttentionOnly, setPaymentAttentionOnly] = useState(false);
  const [resultState, setResultState] = useState<AdministratorRosterResultFilter>("ALL");
  const [missingFixedStartOnly, setMissingFixedStartOnly] = useState(false);
  const [rosterOrder, setRosterOrder] = useState<AdministratorRosterOrder>("NAME");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [rosterClassId, setRosterClassId] = useState("");
  const [wideTable, setWideTable] = useState(false);
  const [entryId, setEntryId] = useState("");
  const [checkinHistory, setCheckinHistory] = useState<CheckinHistoryResponse>();
  const [reviewCandidate, setReviewCandidate] = useState<StartCheckinConflictReviewCandidate>();
  const [reviewAttempt, setReviewAttempt] = useState<ConflictReviewAttempt>();
  const [reviewReason, setReviewReason] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const checkinHistoryPanel = useRef<HTMLDetailsElement>(null);
  const [classId, setClassId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startClock, setStartClock] = useState("");
  const [startOffset, setStartOffset] = useState("");
  const [transferStartSlots, setTransferStartSlots] = useState<EntryTransferStartSlotCandidates>();
  const [selectedTransferStartSlot, setSelectedTransferStartSlot] = useState("");
  const [registrationStartSlots, setRegistrationStartSlots] = useState<EntryRegistrationStartSlotCandidates>();
  const [selectedRegistrationStartSlot, setSelectedRegistrationStartSlot] = useState("");
  const [attempt, setAttempt] = useState<Attempt>();
  const [capacityAttempt, setCapacityAttempt] = useState<CapacityAttempt>();
  const [capacityClassId, setCapacityClassId] = useState("");
  const [capacityInput, setCapacityInput] = useState("");
  const [startRuleClassId, setStartRuleClassId] = useState("");
  const [courseWarningClassId, setCourseWarningClassId] = useState("");
  const [courseSelectionReason, setCourseSelectionReason] = useState<"MISSING" | "ASSIGNED" | "DIRECT">("DIRECT");
  const [selectedCourseTarget, setSelectedCourseTarget] = useState<{ raceId: string; snapshotVersion: number; courseVersionId: string }>();
  const coursesNavigationButton = useRef<HTMLButtonElement>(null);
  const coursesNavigationSelect = useRef<HTMLSelectElement>(null);
  const preparationNavigation = useRef<HTMLElement>(null);
  const [startRulePreview, setStartRulePreview] = useState<ClassStartRulePreview>();
  const [startRuleReason, setStartRuleReason] = useState("");
  const [startRuleConfirmed, setStartRuleConfirmed] = useState(false);
  const [startRuleAttempt, setStartRuleAttempt] = useState<StartRuleAttempt>();
  const [startRuleOpen, setStartRuleOpen] = useState(false);
  const [newCard, setNewCard] = useState("");
  const [cardAttempt, setCardAttempt] = useState<CardAttempt>();
  const [rentalAttempt, setRentalAttempt] = useState<RentalAttempt>();
  const [rentalReturnAttempt, setRentalReturnAttempt] = useState<RentalReturnAttempt>();
  const [rentalReuseAttempt, setRentalReuseAttempt] = useState<RentalReuseAttempt>();
  const [rentalReuseSourceId, setRentalReuseSourceId] = useState("");
  const [paymentStatusAttempt, setPaymentStatusAttempt] = useState<PaymentStatusAttempt>();
  const [paymentStatus, setPaymentStatus] = useState<EntryPaymentStatus>("PAID");
  const [timeAttempt, setTimeAttempt] = useState<TimeAttempt>();
  const [action, setAction] = useState<Action>("INFO");
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>("OVERVIEW");
  const [preparationArea, setPreparationArea] = useState<PreparationArea>("OVERVIEW");
  const [duringArea, setDuringArea] = useState<DuringArea>("OVERVIEW");
  const participantsVisible = workflowMode === "PARTICIPANTS" ||
    (workflowMode === "BEFORE" && preparationArea === "PARTICIPANTS") ||
    (workflowMode === "DURING" && duringArea === "PARTICIPANTS");
  const [participantActionPending, setParticipantActionPending] = useState(false);
  const [neutralizationPending, setNeutralizationPending] = useState(false);
  const [finishCorrectionPending, setFinishCorrectionPending] = useState(false);
  const [startCorrectionPending, setStartCorrectionPending] = useState(false);
  const [startWithdrawalPending, setStartWithdrawalPending] = useState(false);
  const [finishWithdrawalPending, setFinishWithdrawalPending] = useState(false);
  const [operatorAccessPending, setOperatorAccessPending] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"LIST" | "WORK">("LIST");
  const [printTarget, setPrintTarget] = useState<"FOREST" | "RENTAL">();
  const listPanel = useRef<HTMLElement | null>(null), workPanel = useRef<HTMLElement | null>(null);
  const drawPanel = useRef<HTMLDetailsElement>(null);
  const [recalculationCandidates, setRecalculationCandidates] = useState<ResultRecalculationCandidates>();
  const [recalculationAttempt, setRecalculationAttempt] = useState<RecalculationAttempt>();
  const [classRecalculationCandidates, setClassRecalculationCandidates] = useState<ClassResultRecalculationCandidates>();
  const [classRecalculationAttempt, setClassRecalculationAttempt] = useState<ClassResultRecalculationAttempt>();
  const [classRecalculationUnknown, setClassRecalculationUnknown] = useState(false);
  const [classRecalculationError, setClassRecalculationError] = useState("");
  const [classRecalculationSaved, setClassRecalculationSaved] = useState("");
  const [effectiveResult, setEffectiveResult] = useState<AdministratorEffectiveResultResponse>();
  const [effectiveResultError, setEffectiveResultError] = useState(false);
  const [identityCandidates, setIdentityCandidates] = useState<EntryIdentityAdminListResponse>();
  const [identityAttempt, setIdentityAttempt] = useState<IdentityAttempt>();
  const [registrationAttempt, setRegistrationAttempt] = useState<RegistrationAttempt>();
  const [confirmDistinctPerson, setConfirmDistinctPerson] = useState(false);
  const [entryChanges, setEntryChanges] = useState<AdministratorEntryChangesResponse>();
  const [dnsCandidates, setDnsCandidates] = useState<DidNotStartCandidates>();
  const [dnsWithdrawals, setDnsWithdrawals] = useState<DidNotStartWithdrawals>();
  const [dnsAttempt, setDnsAttempt] = useState<DnsAttempt>();
  const [dnfCandidates, setDnfCandidates] = useState<DidNotFinishCandidates>();
  const [dnfWithdrawals, setDnfWithdrawals] = useState<DidNotFinishWithdrawals>();
  const [dnfAttempt, setDnfAttempt] = useState<DnfAttempt>();
  const [dsqCandidates, setDsqCandidates] = useState<ResultDisqualificationCandidates>();
  const [dsqWithdrawals, setDsqWithdrawals] = useState<ResultDisqualificationWithdrawals>();
  const [dsqAttempt, setDsqAttempt] = useState<DsqAttempt>();
  const [approvalCandidates, setApprovalCandidates] = useState<ResultApprovalCandidates>();
  const [approvalWithdrawals, setApprovalWithdrawals] = useState<ResultApprovalWithdrawals>();
  const [approvalAttempt, setApprovalAttempt] = useState<ApprovalAttempt>();
  const [oocCandidates, setOocCandidates] = useState<OutOfCompetitionCandidates>();
  const [oocWithdrawals, setOocWithdrawals] = useState<OutOfCompetitionWithdrawals>();
  const [oocAttempt, setOocAttempt] = useState<OocAttempt>();
  const [ntCandidates, setNtCandidates] = useState<WithoutTimingCandidates>();
  const [ntWithdrawals, setNtWithdrawals] = useState<WithoutTimingWithdrawals>();
  const [ntAttempt, setNtAttempt] = useState<NtAttempt>();
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [organisationName, setOrganisationName] = useState("");
  const [unknown, setUnknown] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string>(text.checking);
  const [returnAttempt, setReturnAttempt] = useState<{ kind: "RETURN"; withdraw: boolean; name: string; request: AdministratorReturnRequest }>();
  const [startCorrection, setStartCorrection] = useState<{ kind: "START_CORRECTION"; name: string; request: AdministratorStartCorrectionRequest }>();
  const [targetStartState, setTargetStartState] = useState<AdministratorStartCorrectionRequest["targetStartState"]>("UNMARKED");
  const [forestData, setForestData] = useState<AdministratorForestWatchResponse>();
  const [forestClass, setForestClass] = useState("");
  const [forestQuery, setForestQuery] = useState("");
  const [forestSortByAge, setForestSortByAge] = useState(false);
  const [forestStale, setForestStale] = useState(true);
  const [forestAutoRefresh, setForestAutoRefresh] = useState(false);
  const [courseName, setCourseName] = useState("");
  const [courseClassName, setCourseClassName] = useState("");
  const [courseStartRule, setCourseStartRule] = useState<CourseClassRequest["startRule"]>("PUNCH");
  const [courseControls, setCourseControls] = useState("");
  const [courseClassReview, setCourseClassReview] = useState<CourseClassRequest>();
  const [courseClassAttempt, setCourseClassAttempt] = useState<CourseClassAttempt>();
  const [courseClassError, setCourseClassError] = useState("");
  const [manualClassName, setManualClassName] = useState("");
  const [manualClassCourseVersionId, setManualClassCourseVersionId] = useState("");
  const [manualClassStartRule, setManualClassStartRule] = useState<ManualClassCreateRequest["startRule"]>("PUNCH");
  const [manualClassReview, setManualClassReview] = useState<ManualClassAttempt>();
  const [manualClassAttempt, setManualClassAttempt] = useState<ManualClassAttempt>();
  const [manualClassError, setManualClassError] = useState("");
  const [classNameClassId, setClassNameClassId] = useState("");
  const [classNameCandidate, setClassNameCandidate] = useState<ManualClassNameCandidate>();
  const [classNameInput, setClassNameInput] = useState("");
  const [classNameReview, setClassNameReview] = useState<ManualClassNameAttempt>();
  const [classNameAttempt, setClassNameAttempt] = useState<ManualClassNameAttempt>();
  const [classNameError, setClassNameError] = useState("");
  const classNamePanel = useRef<HTMLDetailsElement>(null);
  const [courseRelinkClassId, setCourseRelinkClassId] = useState("");
  const [courseRelinkPreview, setCourseRelinkPreview] = useState<ManualCourseVersionClassRelinkPreview>();
  const [courseRelinkControls, setCourseRelinkControls] = useState("");
  const [courseRelinkConfirmed, setCourseRelinkConfirmed] = useState(false);
  const [courseRelinkAttempt, setCourseRelinkAttempt] = useState<CourseVersionRelinkAttempt>();
  const [courseRelinkError, setCourseRelinkError] = useState("");
  const [courseResultImpactClassId, setCourseResultImpactClassId] = useState("");
  const [courseResultImpact, setCourseResultImpact] = useState<ManualCourseResultImpactResponse>();
  const [courseResultImpactError, setCourseResultImpactError] = useState("");
  const [courseResultBearingClassId, setCourseResultBearingClassId] = useState("");
  const [courseResultBearingCandidate, setCourseResultBearingCandidate] = useState<ManualCourseResultBearingRelinkCandidate>();
  const [courseResultBearingControls, setCourseResultBearingControls] = useState("");
  const [courseResultBearingAcknowledged, setCourseResultBearingAcknowledged] = useState(false);
  const [courseResultBearingAttempt, setCourseResultBearingAttempt] = useState<CourseResultBearingRelinkAttempt>();
  const [courseResultBearingError, setCourseResultBearingError] = useState("");
  const [shortenedCourseClassId, setShortenedCourseClassId] = useState("");
  const [shortenedCourseCandidate, setShortenedCourseCandidate] = useState<ShortenedCourseClassTransferCandidate>();
  const [shortenedCourseName, setShortenedCourseName] = useState("");
  const [shortenedClassName, setShortenedClassName] = useState("");
  const [shortenedControlCount, setShortenedControlCount] = useState("1");
  const [shortenedEntryIds, setShortenedEntryIds] = useState<string[]>([]);
  const [shortenedCourseAttempt, setShortenedCourseAttempt] = useState<ShortenedCourseClassTransferAttempt>();
  const [shortenedCourseError, setShortenedCourseError] = useState("");
  const [unknownReadoutCandidate, setUnknownReadoutCandidate] = useState<UnknownReadoutResolutionCandidateResponse>();
  const [unknownReadoutFetchedAt, setUnknownReadoutFetchedAt] = useState<string>();
  const [unknownReadoutAttentionStale, setUnknownReadoutAttentionStale] = useState(true);
  const [unknownReadoutId, setUnknownReadoutId] = useState("");
  const [unknownReadoutTarget, setUnknownReadoutTarget] = useState<UnknownReadoutResolutionRequest["target"]>("EXISTING_ENTRY");
  const [unknownReadoutEntryId, setUnknownReadoutEntryId] = useState("");
  const [unknownReadoutClassId, setUnknownReadoutClassId] = useState("");
  const [unknownReadoutGivenName, setUnknownReadoutGivenName] = useState("");
  const [unknownReadoutFamilyName, setUnknownReadoutFamilyName] = useState("");
  const [unknownReadoutOrganisationName, setUnknownReadoutOrganisationName] = useState("");
  const [unknownReadoutAttempt, setUnknownReadoutAttempt] = useState<UnknownReadoutResolutionAttempt>();
  const [unknownReadoutError, setUnknownReadoutError] = useState("");
  const [forestOpen, setForestOpen] = useState(true);
  const forestPanel = useRef<HTMLDetailsElement>(null);
  const unknownReadoutPanel = useRef<HTMLDetailsElement>(null);
  const [publicationPreview, setPublicationPreview] = useState<StartListPublicationPreviewResponse>();
  const [publicationAttempt, setPublicationAttempt] = useState<AdministratorPublicationAttempt>();
  const [drawClasses, setDrawClasses] = useState<ClassStartDrawClassesResponse>();
  const [drawClassId, setDrawClassId] = useState("");
  const [drawFirst, setDrawFirst] = useState("");
  const [drawInterval, setDrawInterval] = useState("60");
  const [drawAttempt, setDrawAttempt] = useState<AdministratorDrawAttempt>();
  const [finalizationCandidates, setFinalizationCandidates] = useState<ResultFinalizationCandidates>();
  const [finalizationScope, setFinalizationScope] = useState("RACE");
  const [finalizationAttempt, setFinalizationAttempt] = useState<{ kind: "FINALIZATION"; value: ResultFinalizationAttempt }>();
  const [finalizations, setFinalizations] = useState<RaceResultFinalizationMetadata[]>();
  const [finalizationId, setFinalizationId] = useState("");
  const generation = useRef(0), deadline = useRef(0), busyRef = useRef(true);
  const pending = useRef<StartRuleAttempt | ConflictReviewAttempt | NonNullable<typeof startCorrection> | NonNullable<typeof returnAttempt> | AdministratorPublicationAttempt | AdministratorDrawAttempt | Attempt | CapacityAttempt | CardAttempt | RentalAttempt | RentalReturnAttempt | RentalReuseAttempt | PaymentStatusAttempt | TimeAttempt | RecalculationAttempt | ClassResultRecalculationAttempt | IdentityAttempt | RegistrationAttempt | DnsAttempt | DnfAttempt | DsqAttempt | ApprovalAttempt | OocAttempt | NtAttempt | { kind: "FINALIZATION"; value: ResultFinalizationAttempt } | CourseClassAttempt | ManualClassAttempt | ManualClassNameAttempt | CourseVersionRelinkAttempt | CourseResultBearingRelinkAttempt | ShortenedCourseClassTransferAttempt | UnknownReadoutResolutionAttempt | undefined>(undefined), sent = useRef(false);
  const operation = useRef<Operation | undefined>(undefined);
  const base = `/api/admin/races/${raceId}/administrator`;

  const invalidate = useCallback(() => {
    generation.current += 1;
    if (operation.current) { operation.current.controller.abort(); clearTimeout(operation.current.timer); }
    operation.current = undefined; busyRef.current = false;
  }, []);
  const lock = useCallback((discard = false) => {
    invalidate(); deadline.current = 0;
    setAuthenticated(false); setExpiresAt(undefined); setData(undefined);
    setParticipantActionPending(false);
    setFinalizations(undefined); setFinalizationId("");
    setForestData(undefined); setForestClass(""); setForestQuery(""); setForestStale(true);
    setForestAutoRefresh(false); setForestOpen(false);
    setForestSortByAge(false);
    setCourseName(""); setCourseClassName(""); setCourseControls(""); setCourseStartRule("PUNCH"); setCourseClassReview(undefined); setCourseClassError("");
    setManualClassName(""); setManualClassCourseVersionId(""); setManualClassStartRule("PUNCH"); setManualClassReview(undefined); setManualClassError("");
    setClassNameClassId(""); setClassNameCandidate(undefined); setClassNameInput(""); setClassNameReview(undefined); setClassNameError("");
    setCourseRelinkClassId(""); setCourseRelinkPreview(undefined); setCourseRelinkControls(""); setCourseRelinkConfirmed(false); setCourseRelinkError("");
    setCourseResultImpactClassId(""); setCourseResultImpact(undefined); setCourseResultImpactError("");
    setCourseResultBearingClassId(""); setCourseResultBearingCandidate(undefined); setCourseResultBearingControls(""); setCourseResultBearingAcknowledged(false); setCourseResultBearingError("");
    setShortenedCourseClassId(""); setShortenedCourseCandidate(undefined); setShortenedCourseName(""); setShortenedClassName(""); setShortenedControlCount("1"); setShortenedEntryIds([]); setShortenedCourseError("");
    setUnknownReadoutCandidate(undefined); setUnknownReadoutId(""); setUnknownReadoutTarget("EXISTING_ENTRY"); setUnknownReadoutEntryId(""); setUnknownReadoutClassId(""); setUnknownReadoutGivenName(""); setUnknownReadoutFamilyName(""); setUnknownReadoutOrganisationName(""); setUnknownReadoutError("");
    if (discard || !sent.current) setCourseClassAttempt(undefined);
    if (discard || !sent.current) setManualClassAttempt(undefined);
    if (discard || !sent.current) setClassNameAttempt(undefined);
    setPrintTarget(undefined);
    setReviewCandidate(undefined); setReviewReason(""); setReviewConfirmed(false);
    if (discard || !sent.current) setReviewAttempt(undefined);
    setCheckinHistory(undefined);
    if (discard || !sent.current) setReturnAttempt(undefined);
    if (discard || !sent.current) setStartCorrection(undefined);
    setPublicationPreview(undefined);
    if (discard || !sent.current) setPublicationAttempt(undefined);
    setDrawClasses(undefined); setDrawClassId(""); setDrawFirst(""); setDrawInterval("60");
    if (discard || !sent.current) setDrawAttempt(undefined);
    setFinalizationCandidates(undefined); setFinalizationScope("RACE");
    if (discard || !sent.current) setFinalizationAttempt(undefined);
    setOocCandidates(undefined); setOocWithdrawals(undefined);
    setNtCandidates(undefined); setNtWithdrawals(undefined);
    setEntryId(""); setClassId(""); setQuery(""); setOlderResultsOnly(false); setRentalCardsOnly(false);
    setResultState("ALL"); setPage(0); setBusy(false); setMessage(text.denied);
    setStartDate(""); setStartClock(""); setStartOffset(""); setTransferStartSlots(undefined); setSelectedTransferStartSlot(""); setRegistrationStartSlots(undefined); setSelectedRegistrationStartSlot("");
    setCapacityClassId(""); setCapacityInput(""); setNewCard(""); setRentalReuseSourceId(""); setPaymentStatus("PAID");
    setStartRuleClassId(""); setStartRulePreview(undefined); setStartRuleReason(""); setStartRuleConfirmed(false); setStartRuleOpen(false);
    if (discard || !sent.current) setWorkflowMode("OVERVIEW");
    setRecalculationCandidates(undefined);
    setEffectiveResult(undefined); setEffectiveResultError(false);
    setIdentityCandidates(undefined); setGivenName(""); setFamilyName(""); setOrganisationName("");
    setMobilePanel(discard || !sent.current ? "LIST" : "WORK");
    setEntryChanges(undefined);
    setDnsCandidates(undefined); setDnsWithdrawals(undefined);
    setDnfCandidates(undefined); setDnfWithdrawals(undefined);
    if (discard || !sent.current) { setDnfAttempt(undefined); setDsqAttempt(undefined); setApprovalAttempt(undefined); }
    setApprovalCandidates(undefined); setApprovalWithdrawals(undefined);
    setDsqCandidates(undefined); setDsqWithdrawals(undefined);
    if (discard || !sent.current) { pending.current = undefined; sent.current = false; setAttempt(undefined); setCapacityAttempt(undefined); setStartRuleAttempt(undefined); setCardAttempt(undefined); setRentalAttempt(undefined); setRentalReturnAttempt(undefined); setRentalReuseAttempt(undefined); setPaymentStatusAttempt(undefined); setTimeAttempt(undefined); setRecalculationAttempt(undefined); setIdentityAttempt(undefined); setRegistrationAttempt(undefined); setDnsAttempt(undefined); setOocAttempt(undefined); setNtAttempt(undefined); setCourseRelinkAttempt(undefined); setCourseResultBearingAttempt(undefined); setShortenedCourseAttempt(undefined); setUnknownReadoutAttempt(undefined); setUnknown(false); setAction("INFO"); }
    else setUnknown(true);
  }, [invalidate]);
  function begin(): Operation {
    setPublicationPreview(undefined);
    setDrawClasses(undefined);
    setFinalizationCandidates(undefined);
    setNtCandidates(undefined); setNtWithdrawals(undefined);
    setOocCandidates(undefined); setOocWithdrawals(undefined);
    setApprovalCandidates(undefined); setApprovalWithdrawals(undefined);
    setDsqCandidates(undefined); setDsqWithdrawals(undefined);
    setDnfCandidates(undefined); setDnfWithdrawals(undefined);
    setDnsCandidates(undefined); setDnsWithdrawals(undefined);
    setEntryChanges(undefined);
    setIdentityCandidates(undefined);
    setEffectiveResult(undefined); setEffectiveResultError(false);
    setRecalculationCandidates(undefined);
    return beginRequest();
  }
  function beginRequest(): Operation {
    setReviewCandidate(undefined); setReviewReason(""); setReviewConfirmed(false);
    setCheckinHistory(undefined);
    invalidate(); const controller = new AbortController();
    const op = { generation: generation.current, controller, timer: setTimeout(() => controller.abort(), 15_000) };
    operation.current = op; busyRef.current = true; setBusy(true); return op;
  }
  function current(op: Operation) { return op.generation === generation.current; }
  function finish(op: Operation) {
    clearTimeout(op.timer);
    if (current(op)) { operation.current = undefined; busyRef.current = false; setBusy(false); }
  }
  function assertCurrent(op: Operation) {
    if (!current(op) || op.controller.signal.aborted) throw new Error("Superseded request");
    if (deadline.current && deadline.current <= Date.now()) { lock(); throw new Error("Expired session"); }
  }
  function requireSession() {
    if (!deadline.current || deadline.current <= Date.now()) { lock(); return false; }
    return true;
  }
  function showMobilePanel(value: "LIST" | "WORK") {
    // Read viewport only for this explicit navigation event; CSS owns responsive visibility.
    if (window.matchMedia("(max-width: 720px)").matches) {
      flushSync(() => setMobilePanel(value));
      (value === "LIST" ? listPanel : workPanel).current?.focus();
    } else setMobilePanel(value);
  }
  function navigateMobile(value: "LIST" | "WORK") {
    if (busyRef.current || pending.current || !requireSession()) return;
    showMobilePanel(value);
  }
  async function request(path: string, op: Operation, init: RequestInit = {}) {
    const response = await fetch(`${base}${path}`, { ...init, credentials: "same-origin", cache: "no-store", signal: op.controller.signal });
    assertCurrent(op);
    if (response.status === 401 || response.status === 403) { lock(); throw new Error("Unauthorized"); }
    return response;
  }
  async function json(response: Response, op: Operation): Promise<unknown> {
    const value: unknown = await response.json(); assertCurrent(op); return value;
  }
  function csrf() {
    const token = readRaceAdministratorCsrfCookie(document.cookie, new URL(window.location.href));
    if (!token) { lock(); throw new Error("Missing CSRF"); }
    return token;
  }
  async function loadEffectiveResult(id: string, roster: EntryTransferCandidates, op: Operation) {
    setEffectiveResult(undefined); setEffectiveResultError(false);
    const entry = roster.entries.find((row) => row.id === id);
    if (!entry || pending.current) return;
    try {
      const response = await request(`/entries/${id}/effective-result`, op);
      if (!response.ok) throw new Error("Effective result unavailable");
      const value = administratorEffectiveResultResponseSchema.parse(await json(response, op));
      if (value.raceId !== raceId || value.entryId !== id || value.entryVersion !== entry.version ||
        value.currentClassId !== entry.classId || value.snapshotVersion !== roster.snapshotVersion || value.timeZone !== roster.timeZone) {
        throw new Error("Effective result scope mismatch");
      }
      setEffectiveResult(value);
    } catch { if (current(op)) { setEffectiveResult(undefined); setEffectiveResultError(true); } }
  }
  async function load(op: Operation, selectedId = entryId) {
    setDnsCandidates(undefined); setDnsWithdrawals(undefined);
    setEntryChanges(undefined);
    setIdentityCandidates(undefined);
    setRecalculationCandidates(undefined);
    const response = await request("/transfer-candidates", op);
    if (!response.ok) throw new Error("List unavailable");
    const value = entryTransferCandidatesSchema.parse(await json(response, op));
    if (value.raceId !== raceId) throw new Error("Scope mismatch");
    setCourseWarningClassId("");
    setSelectedCourseTarget(undefined);
    setData(value);
    if (selectedId) await loadEffectiveResult(selectedId, value, op);
    assertCurrent(op); return value;
  }
  async function loadTransferStartSlots(targetClassId: string) {
    const entry = data?.entries.find(row => row.id === entryId);
    const target = data?.classes.find(row => row.id === targetClassId);
    setTransferStartSlots(undefined); setSelectedTransferStartSlot("");
    if (!entry || !target || target.startRule !== "FIXED" || !requireSession()) return;
    const op = beginRequest();
    try {
      const response = await request(`/entries/${entry.id}/transfer-start-slot-candidates/${target.id}`, op);
      if (!response.ok) throw new Error("Transfer start slots unavailable");
      const value = entryTransferStartSlotCandidatesSchema.parse(await json(response, op));
      if (value.raceId !== raceId || value.entryId !== entry.id || value.targetClassId !== target.id ||
        value.snapshotVersion !== data?.snapshotVersion || value.targetCapacityVersion !== target.capacityVersion) {
        throw new Error("Transfer start slots scope mismatch");
      }
      setTransferStartSlots(value);
    } catch { if (current(op)) setTransferStartSlots(undefined); }
    finally { finish(op); }
  }
  async function loadRegistrationStartSlots(targetClassId: string) {
    const target = data?.classes.find(row => row.id === targetClassId);
    setRegistrationStartSlots(undefined); setSelectedRegistrationStartSlot("");
    if (!target || target.startRule !== "FIXED" || !requireSession()) return;
    const op = beginRequest();
    try {
      const response = await request(`/registration-start-slot-candidates/${target.id}`, op);
      if (!response.ok) throw new Error("Registration start slots unavailable");
      const value = entryRegistrationStartSlotCandidatesSchema.parse(await json(response, op));
      if (value.raceId !== raceId || value.targetClassId !== target.id || value.snapshotVersion !== data?.snapshotVersion ||
        value.targetCourseVersionId !== target.courseVersionId || value.timeZone !== data.timeZone) {
        throw new Error("Registration start slots scope mismatch");
      }
      setRegistrationStartSlots(value);
    } catch { if (current(op)) setRegistrationStartSlots(undefined); }
    finally { finish(op); }
  }
  /** ADR-0168: öppna tävlingen med det inloggade kontot (OWNER/ADMIN på eventet). */
  async function enterWithAccount(op: Operation) {
    let csrfToken: string;
    try { csrfToken = readOrganizerCsrf(document.cookie, new URL(window.location.href)); }
    catch { throw new Error("No account session"); }
    const response = await fetch(`/api/organizer/races/${encodeURIComponent(raceId)}/enter`, {
      method: "POST", credentials: "same-origin", cache: "no-store", signal: op.controller.signal,
      headers: { "x-otid-csrf": csrfToken } });
    if (!response.ok) throw new Error("Account enter failed");
    await session(op);
  }
  async function session(op: Operation, init: RequestInit = {}, development = false) {
    const response = await request(development ? "/development-session" : "/session", op, init);
    if (!response.ok) throw new Error("Session unavailable");
    const value = raceAdministratorLoginResponseSchema.parse(await json(response, op));
    if (value.raceId !== raceId || Date.parse(value.expiresAt) <= Date.now()) throw new Error("Invalid session");
    deadline.current = Date.parse(value.expiresAt); setExpiresAt(value.expiresAt);
    await load(op); assertCurrent(op); setAuthenticated(true); if (pending.current) setMobilePanel("WORK"); setMessage("");
  }
  useEffect(() => {
    const op = begin();
    void session(op, developmentAutoLogin ? { method: "POST" } : {}, developmentAutoLogin)
      .catch(() => developmentAutoLogin ? Promise.reject(new Error("Development session unavailable")) : enterWithAccount(op))
      .catch(() => { if (current(op)) lock(); }).finally(() => finish(op));
    const hide = () => flushSync(() => lock(true));
    const visible = () => { if (document.visibilityState === "visible" && deadline.current && deadline.current <= Date.now()) lock(); };
    window.addEventListener("pagehide", hide); document.addEventListener("visibilitychange", visible);
    return () => { invalidate(); deadline.current = 0; window.removeEventListener("pagehide", hide); document.removeEventListener("visibilitychange", visible); };
    // This private surface is remounted for each race; mutable form state must not restart login.
  }, [raceId, developmentAutoLogin]);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => lock(), Math.max(0, Date.parse(expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt, lock]);
  useEffect(() => {
    const clearPrintTarget = () => setPrintTarget(undefined);
    window.addEventListener("afterprint", clearPrintTarget);
    return () => window.removeEventListener("afterprint", clearPrintTarget);
  }, []);
  useEffect(() => {
    if (!forestData) return;
    const timer = setTimeout(() => setForestStale(true), 30_000);
    return () => clearTimeout(timer);
  }, [forestData]);
  useEffect(() => {
    if (!unknownReadoutFetchedAt) return;
    const timer = setTimeout(() => setUnknownReadoutAttentionStale(true), 30_000);
    return () => clearTimeout(timer);
  }, [unknownReadoutFetchedAt]);
  async function login(event: FormEvent) {
    event.preventDefault(); if (busyRef.current) return;
    const op = begin();
    try {
      if (developmentAutoLogin) await session(op, { method: "POST" }, true);
      else await enterWithAccount(op);
    } catch { if (current(op)) lock(); } finally { finish(op); }
  }
  function inspectManualClass(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || pending.current || !requireSession() || !data) return;
    setManualClassError("");
    const target = data.classes.find(row => row.courseVersionId === manualClassCourseVersionId);
    if (!target) { setManualClassError(text.manualClassMissingTarget); return; }
    const parsed = manualClassCreateRequestSchema.safeParse({
      formatVersion: 1, requestId: crypto.randomUUID(), expectedSnapshotVersion: data.snapshotVersion,
      courseVersionId: target.courseVersionId, className: manualClassName.trim(), startRule: manualClassStartRule,
    });
    if (!parsed.success) { setManualClassError(text.manualClassInvalid); return; }
    const targetOrdinal = data.classes.findIndex(row => row.courseVersionId === target.courseVersionId) + 1;
    setManualClassReview({ kind: "MANUAL_CLASS", request: parsed.data,
      targetLabel: text.manualClassTargetLabel(target.courseName, target.courseVersion, targetOrdinal) });
  }
  async function submitManualClass(value: ManualClassAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin();
    let committed = false;
    try {
      const token = csrf();
      const response = await request("/classes", op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token,
          "idempotency-key": `manual-class-create:${value.request.requestId}` },
        body: JSON.stringify(value.request) });
      if (!response.ok) throw new Error("Manual class unavailable");
      const receipt = manualClassCreateResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.requestId !== value.request.requestId ||
        receipt.request.formatVersion !== value.request.formatVersion ||
        receipt.request.requestId !== value.request.requestId ||
        receipt.request.expectedSnapshotVersion !== value.request.expectedSnapshotVersion ||
        receipt.request.courseVersionId !== value.request.courseVersionId ||
        receipt.request.className !== value.request.className ||
        receipt.request.startRule !== value.request.startRule ||
        receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion ||
        receipt.courseVersionId !== value.request.courseVersionId) throw new Error("Manual class receipt mismatch");
      committed = true;
      pending.current = undefined; sent.current = false;
      setManualClassAttempt(undefined); setManualClassReview(undefined); setManualClassError("");
      setManualClassName(""); setManualClassCourseVersionId(""); setManualClassStartRule("PUNCH");
      setMessage(text.manualClassSaved);
      await load(op);
    } catch {
      if (current(op)) {
        if (committed) { setManualClassError(text.manualClassSavedLoadError); setMessage(text.manualClassSavedLoadError); }
        else { pending.current = value; sent.current = true; setManualClassAttempt(value); setManualClassError(text.manualClassUnknown); }
      }
    } finally { finish(op); }
  }
  async function loadClassNameCandidate(classId: string) {
    if (busyRef.current || pending.current || !requireSession() || !data) return;
    const raceClass = data.classes.find(row => row.id === classId);
    if (!raceClass) return;
    setClassNameCandidate(undefined); setClassNameInput(""); setClassNameError("");
    const op = beginRequest();
    try {
      const response = await request(`/classes/${classId}/name`, op);
      if (!response.ok) throw new Error("Class name unavailable");
      const candidate = manualClassNameCandidateSchema.parse(await json(response, op));
      if (candidate.raceId !== raceId || candidate.classId !== classId ||
        candidate.snapshotVersion !== data.snapshotVersion ||
        candidate.className !== raceClass.name || candidate.courseVersionId !== raceClass.courseVersionId) {
        throw new Error("Class name candidate mismatch");
      }
      setClassNameCandidate(candidate); setClassNameInput(candidate.className);
    } catch { if (current(op)) setClassNameError(text.classNameLoadError); }
    finally { finish(op); }
  }
  function inspectClassName(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || pending.current || !requireSession() || !data || !classNameCandidate?.editable) return;
    setClassNameError("");
    const raceClass = data.classes.find(row => row.id === classNameCandidate.classId);
    if (!raceClass || raceClass.name !== classNameCandidate.className ||
      raceClass.courseVersionId !== classNameCandidate.courseVersionId ||
      data.snapshotVersion !== classNameCandidate.snapshotVersion) {
      setClassNameError(text.classNameStale); return;
    }
    const parsed = manualClassNameChangeRequestSchema.safeParse({
      formatVersion: 1, requestId: crypto.randomUUID(),
      expectedSnapshotVersion: classNameCandidate.snapshotVersion,
      expectedClassName: classNameCandidate.className, className: classNameInput.trim(),
    });
    if (!parsed.success) { setClassNameError(text.classNameInvalid); return; }
    setClassNameReview({ kind: "MANUAL_CLASS_NAME", classId: classNameCandidate.classId,
      courseVersionId: classNameCandidate.courseVersionId, request: parsed.data });
  }
  async function submitClassName(value: ManualClassNameAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin();
    let committed = false;
    try {
      const token = csrf();
      const response = await request(`/classes/${value.classId}/name`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token,
          "idempotency-key": `manual-class-name:${value.request.requestId}` },
        body: JSON.stringify(value.request) });
      if (!response.ok) throw new Error("Class name change unavailable");
      const receipt = manualClassNameChangeResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.classId !== value.classId ||
        receipt.courseVersionId !== value.courseVersionId ||
        receipt.requestId !== value.request.requestId ||
        receipt.previousClassName !== value.request.expectedClassName ||
        receipt.className !== value.request.className ||
        receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion ||
        receipt.request.formatVersion !== value.request.formatVersion ||
        receipt.request.requestId !== value.request.requestId ||
        receipt.request.expectedSnapshotVersion !== value.request.expectedSnapshotVersion ||
        receipt.request.expectedClassName !== value.request.expectedClassName ||
        receipt.request.className !== value.request.className) throw new Error("Class name receipt mismatch");
      committed = true;
      pending.current = undefined; sent.current = false;
      setClassNameAttempt(undefined); setClassNameReview(undefined); setClassNameCandidate(undefined);
      setClassNameInput(""); setClassNameError(""); setMessage(text.classNameSaved);
      await load(op);
    } catch {
      if (current(op)) {
        if (committed) { setClassNameError(text.classNameSavedLoadError); setMessage(text.classNameSavedLoadError); }
        else { pending.current = value; sent.current = true; setClassNameAttempt(value); setClassNameError(text.classNameUnknown); }
      }
    } finally { finish(op); }
  }
  function inspectCourseClass(event: FormEvent) {
    event.preventDefault();
    setCourseClassError("");
    const course = courseName.trim(), raceClass = courseClassName.trim();
    const tokens = courseControls.trim().split(/[\s,]+/).filter(Boolean);
    const codes = tokens.map(Number);
    if (!course || course.length > 160 || !raceClass || raceClass.length > 160) {
      setCourseClassError(text.courseClassInvalidName); return;
    }
    if (!tokens.length || tokens.length > 1000 || codes.some(code => !Number.isInteger(code) || code <= 0 || code > 2147483647)) {
      setCourseClassError(text.courseClassInvalidControls); return;
    }
    if (!data) { setCourseClassError(text.courseClassUnavailable); return; }
    const request: CourseClassRequest = { formatVersion: 1, requestId: crypto.randomUUID(),
      expectedSnapshotVersion: data.snapshotVersion, courseName: course, className: raceClass,
      startRule: courseStartRule, controlCodes: codes };
    setCourseClassReview(request); setCourseClassAttempt(undefined);
  }
  async function submitCourseClass(value: CourseClassAttempt) {
    if (busyRef.current || !requireSession() || (pending.current && pending.current !== value)) return;
    const op = begin();
    let committed = false;
    try {
      const token = csrf();
      const response = await request("/course-classes", op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `manual-course-class-create:${value.request.requestId}` },
        body: JSON.stringify(value.request) });
      if ([400, 409].includes(response.status)) throw new Error("Course class conflict");
      if (!response.ok) throw new Error("Course class unavailable");
      const receipt = manualCourseClassCreateResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.requestId !== value.request.requestId ||
        receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion ||
        JSON.stringify(receipt.request) !== JSON.stringify(value.request)) throw new Error("Course class receipt mismatch");
      committed = true;
      pending.current = undefined; sent.current = false; setCourseClassAttempt(undefined); setCourseClassReview(undefined); setCourseClassError("");
      setCourseName(""); setCourseClassName(""); setCourseControls(""); setMessage(text.courseClassSaved);
      await load(op);
    } catch {
      if (current(op)) {
        if (committed) { setCourseClassError(text.courseClassSavedLoadError); setMessage(text.courseClassSavedLoadError); }
        else { pending.current = value; sent.current = true; setCourseClassAttempt(value); setCourseClassError(text.courseClassUnknown); }
      }
    } finally { finish(op); }
  }
  async function loadCourseVersionRelinkPreview() {
    if (busyRef.current || pending.current || !requireSession() || !courseRelinkClassId) return;
    setCourseRelinkPreview(undefined); setCourseRelinkError(""); setCourseRelinkConfirmed(false); setCourseRelinkControls("");
    const op = begin();
    try {
      const response = await request(`/classes/${courseRelinkClassId}/course-version-link`, op);
      if (!response.ok) throw new Error("Course version preview unavailable");
      const value = manualCourseVersionClassRelinkPreviewSchema.parse(await json(response, op));
      if (value.raceId !== raceId || value.classId !== courseRelinkClassId) throw new Error("Course version preview scope mismatch");
      setCourseRelinkControls(value.controlCodes.join(", ")); setCourseRelinkPreview(value);
    } catch { if (current(op)) setCourseRelinkError(text.courseRelinkLoadError); }
    finally { finish(op); }
  }
  async function loadCourseResultImpact() {
    if (busyRef.current || pending.current || !requireSession() || !courseResultImpactClassId) return;
    setCourseResultImpact(undefined); setCourseResultImpactError("");
    const op = begin();
    try {
      const response = await request(`/classes/${courseResultImpactClassId}/course-result-impact`, op);
      if (!response.ok) throw new Error("Course result impact unavailable");
      const value = manualCourseResultImpactResponseSchema.parse(await json(response, op));
      if (value.raceId !== raceId || value.classId !== courseResultImpactClassId) throw new Error("Course result impact scope mismatch");
      setCourseResultImpact(value);
    } catch { if (current(op)) setCourseResultImpactError(text.courseResultImpactLoadError); }
    finally { finish(op); }
  }
  function inspectCourseVersionRelink(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || pending.current || !requireSession() || !courseRelinkPreview || !courseRelinkConfirmed) return;
    const tokens = courseRelinkControls.trim().split(/[\s,]+/).filter(Boolean);
    const codes = tokens.map(Number);
    if (!tokens.length || tokens.length > 1000 || codes.some(code => !Number.isInteger(code) || code <= 0 || code > 2147483647)) {
      setCourseRelinkError(text.courseRelinkInvalidControls); return;
    }
    const parsed = manualCourseVersionClassRelinkRequestSchema.safeParse({ formatVersion: 1, requestId: crypto.randomUUID(),
      expectedSnapshotVersion: courseRelinkPreview.snapshotVersion, courseId: courseRelinkPreview.courseId,
      classId: courseRelinkPreview.classId, expectedClassCourseVersionId: courseRelinkPreview.classCourseVersionId,
      controlCodes: codes });
    if (!parsed.success) { setCourseRelinkError(text.courseRelinkInvalidControls); return; }
    const value: CourseVersionRelinkAttempt = { kind: "COURSE_VERSION_RELINK", preview: courseRelinkPreview, request: parsed.data };
    pending.current = value; sent.current = false; setCourseRelinkAttempt(value); setCourseRelinkError("");
  }
  async function submitCourseVersionRelink(value: CourseVersionRelinkAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current; let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/classes/${value.preview.classId}/course-version-link`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token,
          "idempotency-key": `manual-course-version-link:${value.request.requestId}` }, body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setCourseRelinkError(text.courseRelinkUnknown); return; }
        pending.current = undefined; sent.current = false; setCourseRelinkAttempt(undefined); setCourseRelinkPreview(undefined);
        setCourseRelinkConfirmed(false); setCourseRelinkError(response.status === 409 ? text.courseRelinkConflict : text.courseRelinkBlocked); return;
      }
      if (!response.ok) throw new Error("Unknown course version outcome");
      const receipt = manualCourseVersionClassRelinkResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.classId !== value.preview.classId || receipt.courseId !== value.request.courseId ||
        receipt.requestId !== value.request.requestId || receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion ||
        receipt.previousCourseVersionId !== value.request.expectedClassCourseVersionId || JSON.stringify(receipt.request) !== JSON.stringify(value.request)) {
        throw new Error("Course version receipt mismatch");
      }
      committed = true; pending.current = undefined; sent.current = false; setCourseRelinkAttempt(undefined);
      setCourseRelinkPreview(undefined); setCourseRelinkConfirmed(false); setCourseRelinkControls(""); setUnknown(false);
      setData(undefined); setMessage(text.courseRelinkSaved); await load(op);
    } catch { if (current(op)) setCourseRelinkError(committed ? text.courseRelinkSavedLoadError : (wasUnknown ? text.courseRelinkUnknown : text.courseRelinkUnknown)); }
    finally { finish(op); }
  }
  async function loadCourseResultBearingCandidate() {
    if (busyRef.current || pending.current || !requireSession() || !courseResultBearingClassId) return;
    setCourseResultBearingCandidate(undefined); setCourseResultBearingError(""); setCourseResultBearingAcknowledged(false); setCourseResultBearingControls("");
    const op = begin();
    try {
      const response = await request(`/classes/${courseResultBearingClassId}/course-result-bearing-link`, op);
      if (!response.ok) throw new Error("Result bearing course candidate unavailable");
      const value = manualCourseResultBearingRelinkCandidateSchema.parse(await json(response, op));
      if (value.raceId !== raceId || value.classId !== courseResultBearingClassId) throw new Error("Result bearing course candidate scope mismatch");
      setCourseResultBearingCandidate(value);
    } catch { if (current(op)) setCourseResultBearingError(text.courseResultBearingLoadError); }
    finally { finish(op); }
  }
  function inspectCourseResultBearingRelink(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || pending.current || !requireSession() || !courseResultBearingCandidate || !courseResultBearingAcknowledged) return;
    const tokens = courseResultBearingControls.trim().split(/[\s,]+/).filter(Boolean), controlCodes = tokens.map(Number);
    if (!tokens.length || tokens.length > 1000 || controlCodes.some(code => !Number.isInteger(code) || code <= 0 || code > 2147483647)) {
      setCourseResultBearingError(text.courseRelinkInvalidControls); return;
    }
    if (courseResultBearingCandidate.historicalResultRevisionCount > 0 &&
        isStrictCoursePrefix(courseResultBearingCandidate.currentControlCodes, controlCodes)) {
      setCourseResultBearingError(text.courseResultBearingShortenedCourse); return;
    }
    const parsed = manualCourseResultBearingRelinkRequestSchema.safeParse({ formatVersion: 1, requestId: crypto.randomUUID(),
      expectedSnapshotVersion: courseResultBearingCandidate.snapshotVersion, expectedBasisHash: courseResultBearingCandidate.basisHash,
      courseId: courseResultBearingCandidate.courseId, classId: courseResultBearingCandidate.classId,
      expectedClassCourseVersionId: courseResultBearingCandidate.classCourseVersionId, controlCodes, acknowledgedImpact: true });
    if (!parsed.success) { setCourseResultBearingError(text.courseRelinkInvalidControls); return; }
    const value: CourseResultBearingRelinkAttempt = { kind: "COURSE_RESULT_BEARING_RELINK", candidate: courseResultBearingCandidate, request: parsed.data };
    pending.current = value; sent.current = false; setCourseResultBearingAttempt(value); setCourseResultBearingError("");
  }
  async function submitCourseResultBearingRelink(value: CourseResultBearingRelinkAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(), wasUnknown = sent.current; let committed = false;
    try {
      sent.current = true;
      const response = await request(`/classes/${value.candidate.classId}/course-result-bearing-link`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf(),
          "idempotency-key": `manual-course-result-bearing-link:${value.request.requestId}` }, body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setCourseResultBearingError(text.courseResultBearingUnknown); return; }
        pending.current = undefined; sent.current = false; setCourseResultBearingAttempt(undefined); setCourseResultBearingCandidate(undefined);
        setCourseResultBearingAcknowledged(false); setCourseResultBearingError(text.courseResultBearingConflict); return;
      }
      if (!response.ok) throw new Error("Unknown result bearing course outcome");
      const receipt = manualCourseResultBearingRelinkResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.classId !== value.candidate.classId || receipt.courseId !== value.request.courseId ||
        receipt.requestId !== value.request.requestId || receipt.sourceSnapshotVersion !== value.request.expectedSnapshotVersion ||
        receipt.sourceBasisHash !== value.request.expectedBasisHash || receipt.previousCourseVersionId !== value.request.expectedClassCourseVersionId ||
        JSON.stringify(receipt.request) !== JSON.stringify(value.request)) throw new Error("Result bearing course receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setCourseResultBearingAttempt(undefined);
      setCourseResultBearingCandidate(undefined); setCourseResultBearingAcknowledged(false); setCourseResultBearingControls(""); setUnknown(false);
      setData(undefined); setMessage(text.courseResultBearingSaved); await load(op);
    } catch { if (current(op)) setCourseResultBearingError(committed ? text.courseResultBearingSavedLoadError : text.courseResultBearingUnknown); }
    finally { finish(op); }
  }
  async function loadShortenedCourseCandidate() {
    if (busyRef.current || pending.current || !requireSession() || !shortenedCourseClassId) return;
    setShortenedCourseCandidate(undefined); setShortenedCourseError(""); setShortenedEntryIds([]); setShortenedControlCount("1");
    const op = begin();
    try {
      const response = await request(`/classes/${shortenedCourseClassId}/shortened-course-transfer`, op);
      if (!response.ok) throw new Error("Shortened course candidate unavailable");
      const value = shortenedCourseClassTransferCandidateSchema.parse(await json(response, op));
      if (value.raceId !== raceId || value.sourceClassId !== shortenedCourseClassId) throw new Error("Shortened course candidate scope mismatch");
      setShortenedCourseCandidate(value);
      setShortenedCourseName(`${value.sourceCourseName} kort`);
      setShortenedClassName(`${value.sourceClassName} kort`);
    } catch { if (current(op)) setShortenedCourseError(text.shortenedCourseLoadError); }
    finally { finish(op); }
  }
  function toggleShortenedEntry(entryId: string, checked: boolean) {
    setShortenedEntryIds(currentIds => checked ? [...currentIds, entryId].sort() : currentIds.filter(id => id !== entryId));
  }
  function inspectShortenedCourseTransfer(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || pending.current || !requireSession() || !shortenedCourseCandidate) return;
    const shortCourseName = shortenedCourseName.trim(), shortClassName = shortenedClassName.trim();
    const prefixLength = Number(shortenedControlCount);
    const entryIds = shortenedEntryIds.slice().sort();
    const request = shortenedCourseClassTransferRequestSchema.safeParse({ formatVersion: 1, requestId: crypto.randomUUID(),
      sourceClassId: shortenedCourseCandidate.sourceClassId,
      expectedSourceCourseVersionId: shortenedCourseCandidate.sourceCourseVersionId,
      expectedSourceStartRule: shortenedCourseCandidate.sourceStartRule,
      expectedSnapshotVersion: shortenedCourseCandidate.snapshotVersion, expectedBasisHash: shortenedCourseCandidate.basisHash,
      shortCourseName, shortClassName, expectedSourceControlCount: shortenedCourseCandidate.sourceControls.length,
      controlPrefix: shortenedCourseCandidate.sourceControls.slice(0, prefixLength), entryIds });
    if (!request.success) { setShortenedCourseError(text.shortenedCourseInvalid); return; }
    const value: ShortenedCourseClassTransferAttempt = { kind: "SHORTENED_COURSE_CLASS_TRANSFER", candidate: shortenedCourseCandidate, request: request.data };
    pending.current = value; sent.current = false; setShortenedCourseAttempt(value); setShortenedCourseError("");
  }
  async function submitShortenedCourseTransfer(value: ShortenedCourseClassTransferAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(), wasUnknown = sent.current; let committed = false;
    try {
      sent.current = true;
      const response = await request(`/classes/${value.candidate.sourceClassId}/shortened-course-transfer`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf(),
          "idempotency-key": `shortened-course-class-transfer:${value.request.requestId}` }, body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setShortenedCourseError(text.shortenedCourseUnknown); return; }
        pending.current = undefined; sent.current = false; setShortenedCourseAttempt(undefined); setShortenedCourseCandidate(undefined);
        setShortenedEntryIds([]); setShortenedCourseError(text.shortenedCourseConflict); return;
      }
      if (!response.ok) throw new Error("Unknown shortened course transfer outcome");
      const receipt = shortenedCourseClassTransferReceiptSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.requestId !== value.request.requestId ||
        receipt.sourceClassId !== value.candidate.sourceClassId || receipt.sourceCourseVersionId !== value.request.expectedSourceCourseVersionId ||
        receipt.sourceSnapshotVersion !== value.request.expectedSnapshotVersion || receipt.sourceBasisHash !== value.request.expectedBasisHash ||
        JSON.stringify(receipt.request) !== JSON.stringify(value.request)) throw new Error("Shortened course transfer receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setShortenedCourseAttempt(undefined);
      setShortenedCourseCandidate(undefined); setShortenedEntryIds([]); setShortenedCourseName(""); setShortenedClassName(""); setUnknown(false);
      setData(undefined); setMessage(text.shortenedCourseSaved); await load(op);
    } catch { if (current(op)) setShortenedCourseError(committed ? text.shortenedCourseSavedLoadError : text.shortenedCourseUnknown); }
    finally { finish(op); }
  }
  async function readUnknownReadoutCandidates(op: Operation) {
    const response = await request("/unknown-readout-resolution", op);
    if (!response.ok) throw new Error("Unknown readout candidates unavailable");
    const value = unknownReadoutResolutionCandidateResponseSchema.parse(await json(response, op));
    if (value.raceId !== raceId) throw new Error("Unknown readout candidate scope mismatch");
    setUnknownReadoutCandidate(value); setUnknownReadoutId(value.readouts[0]?.id ?? "");
    setUnknownReadoutEntryId(value.entries[0]?.id ?? ""); setUnknownReadoutClassId(value.classes[0]?.id ?? "");
    setUnknownReadoutFetchedAt(new Date().toISOString()); setUnknownReadoutAttentionStale(false);
  }
  async function loadUnknownReadoutCandidates() {
    if (busyRef.current || pending.current || !requireSession()) return;
    setUnknownReadoutCandidate(undefined); setUnknownReadoutFetchedAt(undefined); setUnknownReadoutAttentionStale(true);
    setUnknownReadoutId(""); setUnknownReadoutEntryId(""); setUnknownReadoutClassId(""); setUnknownReadoutError("");
    const op = begin();
    try { await readUnknownReadoutCandidates(op); }
    catch { if (current(op)) setUnknownReadoutError(text.unknownReadoutLoadError); }
    finally { finish(op); }
  }
  function inspectUnknownReadoutResolution() {
    if (!requireSession() || !unknownReadoutCandidate) return;
    const readout = unknownReadoutCandidate.readouts.find(row => row.id === unknownReadoutId);
    if (!readout) { setUnknownReadoutError(text.unknownReadoutInvalid); return; }
    const common = { formatVersion: 1 as const, requestId: crypto.randomUUID(), readoutId: readout.id,
      cardNumber: readout.cardNumber, expectedSnapshotVersion: unknownReadoutCandidate.snapshotVersion,
      expectedEngineVersion: unknownReadoutCandidate.engineVersion };
    const parsed = unknownReadoutTarget === "EXISTING_ENTRY" ? (() => {
      const entry = unknownReadoutCandidate.entries.find(row => row.id === unknownReadoutEntryId);
      return entry ? unknownReadoutResolutionRequestSchema.safeParse({ ...common, target: "EXISTING_ENTRY" as const,
        entryId: entry.id, expectedEntryVersion: entry.entryVersion, expectedClassId: entry.classId,
        expectedAssignment: entry.activeAssignment, expectedLatestResultRevision: entry.latestResultRevision }) : { success: false as const };
    })() : (() => {
      const raceClass = unknownReadoutCandidate.classes.find(row => row.id === unknownReadoutClassId);
      return raceClass ? unknownReadoutResolutionRequestSchema.safeParse({ ...common, target: "NEW_ENTRY" as const,
        classId: raceClass.id, expectedCourseVersionId: raceClass.courseVersionId,
        givenName: unknownReadoutGivenName.trim(), familyName: unknownReadoutFamilyName.trim(),
        organisationName: unknownReadoutOrganisationName.trim() || null }) : { success: false as const };
    })();
    if (!parsed.success) { setUnknownReadoutError(text.unknownReadoutInvalid); return; }
    const value: UnknownReadoutResolutionAttempt = { kind: "UNKNOWN_READOUT_RESOLUTION", candidate: unknownReadoutCandidate, request: parsed.data };
    pending.current = value; sent.current = false; setUnknownReadoutAttempt(value); setUnknownReadoutError("");
  }
  async function submitUnknownReadoutResolution(value: UnknownReadoutResolutionAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(), wasUnknown = sent.current; let committed = false;
    try {
      sent.current = true;
      const response = await request("/unknown-readout-resolution", op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf(),
          "idempotency-key": `unknown-readout-resolution:${value.request.requestId}` }, body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setUnknownReadoutError(text.unknownReadoutUnknown); return; }
        pending.current = undefined; sent.current = false; setUnknownReadoutAttempt(undefined); setUnknownReadoutCandidate(undefined);
        setUnknownReadoutError(text.unknownReadoutConflict); return;
      }
      if (!response.ok) throw new Error("Unknown readout resolution unavailable");
      const receipt = unknownReadoutResolutionResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.requestId !== value.request.requestId || receipt.readoutId !== value.request.readoutId ||
        receipt.cardNumber !== value.request.cardNumber || receipt.target !== value.request.target ||
        receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion || receipt.engineVersion !== value.request.expectedEngineVersion) {
        throw new Error("Unknown readout resolution receipt mismatch");
      }
      committed = true; pending.current = undefined; sent.current = false; setUnknownReadoutAttempt(undefined);
      setUnknownReadoutCandidate(undefined); setUnknownReadoutFetchedAt(undefined); setUnknownReadoutAttentionStale(true);
      setUnknownReadoutError(""); setUnknown(false); setData(undefined); setMessage(text.unknownReadoutSaved);
      await load(op);
    } catch { if (current(op)) setUnknownReadoutError(committed ? text.unknownReadoutSavedLoadError : text.unknownReadoutUnknown); }
    finally { finish(op); }
  }
  async function logout() {
    const hadPending = sent.current;
    const token = readRaceAdministratorCsrfCookie(document.cookie, new URL(window.location.href));
    lock(true); if (hadPending) setMessage(text.discarded);
    if (!token) { setMessage(`${text.logoutError}${hadPending ? ` ${text.discarded}` : ""}`); return; }
    const op = begin();
    try {
      // Logout must not route an unauthorized response through lock(), which would erase the pending-warning message.
      const response = await fetch(`${base}/session`, { method: "DELETE", credentials: "same-origin", cache: "no-store",
        signal: op.controller.signal, headers: { "x-otid-csrf": token } });
      assertCurrent(op);
      if (!response.ok && response.status !== 401) throw new Error("Logout failed");
    } catch { if (current(op)) setMessage(`${text.logoutError}${hadPending ? ` ${text.discarded}` : ""}`); }
    finally { finish(op); }
  }
  async function loadCheckinHistory(cursor?: string, selectedId = entryId) {
    if (busyRef.current || pending.current || !requireSession() || !selectedId) return;
    const op = begin(); setMessage("");
    try {
      const response = await request(`/entries/${selectedId}/checkin-history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, op);
      if (!response.ok) throw new Error("Checkin history unavailable");
      const value = checkinHistoryResponseSchema.parse(await json(response, op));
      if (value.raceId !== raceId || value.entryId !== selectedId) throw new Error("Checkin history scope mismatch");
      setCheckinHistory(value);
    } catch { if (current(op)) setMessage(checkinHistorySv.error); }
    finally { finish(op); }
  }
  async function loadConflictReview(selectedId = entryId) {
    if (busyRef.current || pending.current || !requireSession() || !selectedId) return;
    const op = begin(); setMessage("");
    try {
      const response = await request(`/conflict-reviews/${selectedId}`, op);
      if (!response.ok) throw new Error("Review unavailable");
      const value = StartCheckinConflictReviewCandidateSchema.parse(await json(response, op));
      if (value.source.raceId !== raceId || value.source.entryId !== selectedId) throw new Error("Review scope mismatch");
      setReviewCandidate(value);
    } catch { if (current(op)) setMessage(reviewText.failedRead); }
    finally { finish(op); }
  }
  async function submitConflictReview() {
    if (busyRef.current || !requireSession() || (pending.current && pending.current !== reviewAttempt)) return;
    if (!reviewAttempt && (!reviewCandidate || !reviewConfirmed || !reviewReason.trim() || !reviewCandidate.source.conflicts.length)) return;
    const value = reviewAttempt ?? { kind: "CONFLICT_REVIEW" as const, candidate: reviewCandidate!, request: StartCheckinConflictReviewRequestSchema.parse({
      formatVersion: 1, requestId: crypto.randomUUID(), entryId: reviewCandidate!.source.entryId,
      sourceHash: reviewCandidate!.sourceHash, conflictRequestIds: reviewCandidate!.source.conflicts.map(row => row.operation.requestId),
      decision: "KEEP_CURRENT_STATE", reason: reviewReason.trim()
    }) };
    pending.current = value; setReviewAttempt(value);
    const op = beginRequest(), wasSent = sent.current; let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request("/conflict-reviews", op, { method: "POST", headers: {
        "content-type": "application/json", "x-otid-csrf": token }, body: JSON.stringify(value.request) });
      if ([400, 404, 409, 413].includes(response.status) && !wasSent) {
        pending.current = undefined; sent.current = false; setReviewAttempt(undefined); setUnknown(false);
        setForestStale(true); setMessage(response.status === 413 ? reviewText.tooLarge : reviewText.stale); return;
      }
      if (!response.ok) throw new Error("Unknown review outcome");
      const receipt = StartCheckinConflictReviewResponseSchema.parse(await json(response, op)), intent = value.request;
      if (receipt.raceId !== raceId || receipt.entryId !== intent.entryId || receipt.requestId !== intent.requestId ||
        receipt.sourceHash !== intent.sourceHash || receipt.decision !== intent.decision ||
        receipt.conflictRequestIds.length !== intent.conflictRequestIds.length ||
        receipt.conflictRequestIds.some((id, index) => id !== intent.conflictRequestIds[index])) throw new Error("Review receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setReviewAttempt(undefined); setUnknown(false);
      setMessage(reviewText.saved); await readForest(op);
    } catch { if (current(op)) { setUnknown(!committed); setForestStale(true); setMessage(committed ? text.returnStoredLoadError : reviewText.pending); } }
    finally { finish(op); }
  }
  // Restart the idle interval after each render so the callback uses current UI/session state.
  useEffect(() => {
    if (!forestAutoRefresh || !authenticated || workflowMode !== "DURING" || duringArea !== "OVERVIEW" || !forestOpen || reviewCandidate) return;
    const timer = setInterval(() => {
      const editing = document.activeElement?.matches("input:not([type='checkbox']):not([type='button']):not([type='submit']), textarea, select, [contenteditable='true']") ?? false;
      if (canRefreshForest({ enabled: forestAutoRefresh, authenticated, reportOpen: forestOpen,
        visible: document.visibilityState === "visible", busy: busyRef.current, pending: !!pending.current,
        journalOpen: checkinHistoryPanel.current?.open ?? false, editing })) void loadForest();
    }, 15_000);
    return () => clearInterval(timer);
  });
  function prepareStartCorrection() {
    if (busyRef.current || pending.current || !requireSession() || !forestData || forestStale) return;
    const entry = forestData.entries.find(row => row.entryId === entryId);
    if (!entry || entry.startState === targetStartState) return;
    const value = { kind: "START_CORRECTION" as const, name: entry.displayName, request: administratorStartCorrectionRequestSchema.parse({
      formatVersion: 1, requestId: crypto.randomUUID(), entryId, packageVersion: forestData.snapshotVersion,
      expectedEntryVersion: entry.entryVersion, expectedRevision: entry.revision,
      targetStartState, observedAt: new Date().toISOString()
    }) };
    pending.current = value; sent.current = false; setUnknown(false); setStartCorrection(value); setMessage("");
  }
  async function submitStartCorrection(value: NonNullable<typeof startCorrection>) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = beginRequest(); const wasSent = sent.current; let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request("/start-correction", op, { method: "POST", headers: {
        "content-type": "application/json", "x-otid-csrf": token }, body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status) && !wasSent) {
        pending.current = undefined; sent.current = false; setStartCorrection(undefined); setUnknown(false);
        setForestStale(true); setMessage(text.startCorrectionConflict); return;
      }
      if (!response.ok) throw new Error("Unknown start correction outcome");
      const receipt = administratorStartCorrectionResponseSchema.parse(await json(response, op));
      if (receipt.receipt.raceId !== raceId || canonicalAdministratorStartCorrectionRequest(receipt.request).toString() !== canonicalAdministratorStartCorrectionRequest(value.request).toString()) throw new Error("Start receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setStartCorrection(undefined); setUnknown(false);
      setMessage(receipt.receipt.effect.kind === "CONFLICT" ? text.startCorrectionConflict : text.startCorrectionSaved);
      await readForest(op);
    } catch { if (current(op)) { setUnknown(!committed); setForestStale(true); setMessage(committed ? text.returnStoredLoadError : text.returnUnknown); } }
    finally { finish(op); }
  }
  function prepareReturn(withdraw = false) {
    if (busyRef.current || pending.current || !requireSession() || !forestData || forestStale) return;
    const entry = forestData.entries.find(row => row.entryId === entryId);
    if (!entry || entry.manualReturnRegistered !== withdraw) return;
    const value = { kind: "RETURN" as const, withdraw, name: entry.displayName, request: administratorReturnRequestSchema.parse({
      formatVersion: 1, requestId: crypto.randomUUID(), entryId, packageVersion: forestData.snapshotVersion,
      expectedEntryVersion: entry.entryVersion, expectedRevision: entry.revision,
      expectedStartState: entry.startState, observedAt: new Date().toISOString()
    }) };
    pending.current = value; sent.current = false; setUnknown(false); setReturnAttempt(value); setMessage("");
  }
  async function submitReturn(value: NonNullable<typeof returnAttempt>) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = beginRequest(); const wasSent = sent.current; let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(value.withdraw ? "/manual-return-withdrawal" : "/manual-return", op, { method: "POST", headers: {
        "content-type": "application/json", "x-otid-csrf": token }, body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status) && !wasSent) {
        pending.current = undefined; sent.current = false; setReturnAttempt(undefined); setUnknown(false);
        setForestStale(true); setMessage(text.returnConflict); return;
      }
      if (!response.ok) throw new Error("Unknown return outcome");
      const receipt = administratorReturnResponseSchema.parse(await json(response, op));
      if (receipt.receipt.raceId !== raceId || canonicalAdministratorReturnRequest(receipt.request).toString() !== canonicalAdministratorReturnRequest(value.request).toString()) throw new Error("Return receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setReturnAttempt(undefined); setUnknown(false);
      setMessage(receipt.receipt.effect.kind === "CONFLICT" ? text.returnConflict : value.withdraw ? text.returnWithdrawn : text.returnSaved);
      await readForest(op);
    } catch { if (current(op)) { setUnknown(!committed); setForestStale(true); setMessage(committed ? text.returnStoredLoadError : text.returnUnknown); } }
    finally { finish(op); }
  }
  async function readForest(op: Operation) {
    const response = await request("/forest-watch", op);
    if (!response.ok) throw new Error("Forest report unavailable");
    const value = administratorForestWatchResponseSchema.parse(await json(response, op));
    if (value.raceId !== raceId) throw new Error("Forest report scope mismatch");
    setForestData(value); setForestStale(false);
  }
  async function loadForest() {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = beginRequest(); setForestStale(true); setMessage("");
    try {
      await readForest(op);
    } catch { if (current(op)) setMessage(forestText.loadError); } finally { finish(op); }
  }
  async function loadRaceDayAttention() {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = beginRequest();
    setForestStale(true); setUnknownReadoutCandidate(undefined); setUnknownReadoutFetchedAt(undefined);
    setUnknownReadoutAttentionStale(true); setUnknownReadoutError(""); setMessage("");
    let forestLoaded = false, readoutsLoaded = false;
    try { await readForest(op); forestLoaded = true; }
    catch { if (!current(op)) return; }
    try { await readUnknownReadoutCandidates(op); readoutsLoaded = true; }
    catch { if (current(op)) setUnknownReadoutError(text.unknownReadoutLoadError); }
    finally {
      if (current(op) && (!forestLoaded || !readoutsLoaded)) setMessage(text.attentionPartialError);
      finish(op);
    }
  }
  async function readPublication(op: Operation) {
    const response = await request("/publication-preview", op);
    if (!response.ok) throw new Error("Publication preview unavailable");
    const value = startListPublicationPreviewResponseSchema.parse(await json(response, op));
    if (value.raceId !== raceId) throw new Error("Publication scope mismatch");
    setPublicationPreview(value);
  }
  async function loadPublication() {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = beginRequest(); setPublicationPreview(undefined); setMessage("");
    try { await readPublication(op); }
    catch { if (current(op)) setMessage(publicationText.loadError); } finally { finish(op); }
  }
  function preparePublication(action: "PUBLISH" | "WITHDRAW") {
    if (busyRef.current || pending.current || !requireSession() || !publicationPreview) return;
    try {
      const request = startListPublicationRequestSchema.parse(action === "PUBLISH" ? {
        formatVersion: 1, action, expectedRevision: publicationPreview.latestDecision?.revision ?? 0,
        expectedSnapshotVersion: publicationPreview.snapshotVersion, expectedSourceHash: publicationPreview.sourceHash
      } : { formatVersion: 1, action, expectedRevision: publicationPreview.latestDecision?.revision });
      const value: AdministratorPublicationAttempt = { kind: "PUBLICATION", id: crypto.randomUUID(), request,
        content: action === "PUBLISH" ? publicationPreview.content : null };
      pending.current = value; sent.current = false; setUnknown(false); setPublicationAttempt(value); setMessage("");
    } catch { setMessage(publicationText.error); }
  }
  async function submitPublication(value: AdministratorPublicationAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = beginRequest(); const wasSent = sent.current; let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request("/publication", op, { method: "POST", headers: {
        "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `start-list-publication:${value.id}` },
      body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status) && !wasSent) {
        pending.current = undefined; sent.current = false; setPublicationAttempt(undefined); setPublicationPreview(undefined);
        setUnknown(false); setMessage(publicationText.conflict); return;
      }
      if (!response.ok) throw new Error("Unknown publication outcome");
      parseAdministratorPublicationReceipt(await json(response, op), raceId, value);
      committed = true; pending.current = undefined; sent.current = false; setPublicationAttempt(undefined); setUnknown(false);
      setMessage(publicationText.saved); await readPublication(op);
    } catch { if (current(op)) { setUnknown(!committed); setMessage(committed ? `${publicationText.saved} ${publicationText.loadError}` : publicationText.unknown); } }
    finally { finish(op); }
  }
  async function loadDrawClasses(preselectClassId = "") {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = beginRequest(); setDrawClasses(undefined); setDrawClassId(""); setMessage("");
    try {
      const response = await request("/draw-classes", op);
      if (!response.ok) throw new Error("Draw classes unavailable");
      const value = classStartDrawClassesResponseSchema.parse(await json(response, op));
      if (value.raceId !== raceId) throw new Error("Draw scope mismatch");
      const selected = preselectClassId ? value.classes.find(row => row.id === preselectClassId && row.entryCount > 0) : undefined;
      if (preselectClassId && !selected) throw new Error("Selected class is no longer drawable");
      setDrawClasses(value); setDrawClassId(selected?.id ?? "");
    } catch { if (current(op)) setMessage(drawText.error); } finally { finish(op); }
  }
  function openClassDraw(classId: string) {
    if (busyRef.current || pending.current || !requireSession()) return;
    flushSync(() => { setStartRulePreview(undefined); setWorkflowMode("BEFORE"); setPreparationArea("DRAW"); });
    if (drawPanel.current) {
      drawPanel.current.open = true;
      drawPanel.current.querySelector("summary")?.focus();
      drawPanel.current.scrollIntoView({ block: "start" });
    }
    void loadDrawClasses(classId);
  }
  async function previewDraw(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || pending.current || !requireSession() || !drawClasses) return;
    const parameters = classStartDrawParametersSchema.safeParse({ algorithmVersion: "xorshift32-fisher-yates-v1",
      seed: drawClasses.seed, firstStartTime: drawFirst.trim(), intervalSeconds: Number(drawInterval) });
    if (!parameters.success || !drawClassId) { setMessage(drawText.invalid); return; }
    const op = beginRequest(); setMessage("");
    try {
      const response = await request("/draw-preview", op, { method: "POST", headers: {
        "content-type": "application/json", "x-otid-csrf": csrf() },
      body: JSON.stringify({ formatVersion: 1, classId: drawClassId, parameters: parameters.data }) });
      if (!response.ok) throw new Error("Draw preview unavailable");
      const preview = classStartDrawPreviewResponseSchema.parse(await json(response, op));
      if (preview.raceId !== raceId || preview.classId !== drawClassId ||
        JSON.stringify(preview.parameters) !== JSON.stringify(parameters.data)) throw new Error("Draw preview mismatch");
      const value: AdministratorDrawAttempt = { kind: "DRAW", id: crypto.randomUUID(), preview,
        request: { formatVersion: 1, classId: preview.classId, parameters: preview.parameters,
          expectedSnapshotVersion: preview.snapshotVersion, sourceHash: preview.sourceHash } };
      pending.current = value; sent.current = false; setUnknown(false); setDrawAttempt(value);
    } catch { if (current(op)) setMessage(drawText.error); } finally { finish(op); }
  }
  async function submitDraw(value: AdministratorDrawAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = beginRequest(); const wasSent = sent.current; let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request("/draw", op, { method: "POST", headers: {
        "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `class-start-draw:${value.id}` },
      body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status) && !wasSent) {
        pending.current = undefined; sent.current = false; setDrawAttempt(undefined); setDrawClasses(undefined);
        setUnknown(false); setMessage(drawText.conflict); return;
      }
      if (!response.ok) throw new Error("Unknown draw outcome");
      const receipt = parseAdministratorDrawReceipt(await json(response, op), raceId, value);
      if (receipt.entryCount !== value.preview.entries.length || receipt.changedEntryCount !== value.preview.entries.filter(row => row.changed).length) throw new Error("Draw count mismatch");
      committed = true; pending.current = undefined; sent.current = false; setDrawAttempt(undefined); setDrawClasses(undefined);
      setPublicationPreview(undefined);
      setFinalizationCandidates(undefined); setUnknown(false); setMessage(drawText.saved);
      await load(op);
    } catch { if (current(op)) { setUnknown(!committed); setMessage(committed ? `${drawText.saved} ${text.error}` : drawText.unknown); } }
    finally { finish(op); }
  }
  async function readFinalizationBasis(op: Operation) {
    const response = await request("/finalization-candidates", op);
    if (!response.ok) throw new Error("Finalization basis unavailable");
    const value = parseResultFinalizationCandidates(await json(response, op), raceId);
    setFinalizationCandidates(value);
  }
  async function loadFinalizationBasis() {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = beginRequest(); setFinalizationCandidates(undefined); setMessage("");
    try { await readFinalizationBasis(op); }
    catch { if (current(op)) setMessage(text.error); } finally { finish(op); }
  }
  function prepareFinalization() {
    if (busyRef.current || pending.current || !requireSession() || !finalizationCandidates) return;
    try {
      const value = finalizationScope === "RACE" ? createRaceFinalizationAttempt(finalizationCandidates)
        : createClassFinalizationAttempt(finalizationCandidates, finalizationScope);
      const attempt = { kind: "FINALIZATION" as const, value };
      pending.current = attempt; sent.current = false; setUnknown(false); setFinalizationAttempt(attempt); setMessage("");
    } catch { setMessage(text.error); }
  }
  async function submitFinalization(value: NonNullable<typeof finalizationAttempt>) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = beginRequest(); const wasSent = sent.current; let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request("/finalize", op, { method: "POST", headers: {
        "content-type": "application/json", "x-otid-csrf": token,
        "idempotency-key": `result-finalization:${value.value.requestId}` }, body: JSON.stringify(value.value.request) });
      if (isDefinitiveResultFinalizationRejection(response.status) && !wasSent) {
        pending.current = undefined; sent.current = false; setFinalizationAttempt(undefined); setFinalizationCandidates(undefined);
        setUnknown(false); setMessage(text.finalizationConflict); return;
      }
      if (!response.ok) throw new Error("Unknown finalization outcome");
      parseResultFinalizationResponse(await json(response, op), value.value, raceId);
      committed = true; pending.current = undefined; sent.current = false; setFinalizationAttempt(undefined); setUnknown(false);
      setFinalizations(undefined); setFinalizationId(""); setMessage(text.finalizationSaved);
      await readFinalizationBasis(op);
    } catch { if (current(op)) { setUnknown(!committed); setMessage(committed ? text.finalizationSavedLoadError : text.finalizationUnknown); } }
    finally { finish(op); }
  }
  async function saveExport(response: Response, filename: string, expectedHash: string, op: Operation) {
    const buffer = await response.arrayBuffer();
    const length = response.headers.get("content-length");
    if (!length || !/^\d+$/.test(length) || Number(length) !== buffer.byteLength) throw new Error("Export length mismatch");
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)), byte => byte.toString(16).padStart(2, "0")).join("");
    if (hash !== expectedHash) throw new Error("Export hash mismatch");
    assertCurrent(op);
    const objectUrl = URL.createObjectURL(new Blob([buffer], { type: "application/xml;charset=utf-8" }));
    try {
      const anchor = document.createElement("a");
      anchor.href = objectUrl; anchor.download = filename; anchor.rel = "noopener";
      document.body.append(anchor); anchor.click(); anchor.remove();
    } finally { URL.revokeObjectURL(objectUrl); }
  }
  async function loadFinalizations() {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = beginRequest(); setFinalizations(undefined); setFinalizationId(""); setMessage(text.exportLoadingHistory);
    try {
      const response = await request("/result-finalizations", op);
      if (!response.ok) throw new Error("History unavailable");
      const value = parseFrozenRaceFinalizations(await json(response, op), raceId);
      setFinalizations(value.finalizations); setFinalizationId(value.finalizations[0]?.id ?? ""); setMessage("");
    } catch { if (current(op)) setMessage(text.exportHistoryError); }
    finally { finish(op); }
  }
  async function downloadFinalization() {
    if (busyRef.current || pending.current || !requireSession()) return;
    const selected = finalizations?.find(row => row.id === finalizationId);
    if (!selected) return;
    const op = beginRequest(); setMessage(text.exportDownloading);
    try {
      const response = await request(`/result-finalizations/${selected.id}`, op);
      if (!response.ok) throw new Error("Frozen export unavailable");
      const filename = validateFrozenIofResultListResponse(response, selected);
      await saveExport(response, filename, selected.completeXmlSha256, op);
      assertCurrent(op); setMessage(text.exportCompleteDownloaded(selected.scopeRevision));
    } catch { if (current(op)) setMessage(text.exportError); }
    finally { finish(op); }
  }
  async function downloadResults() {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = beginRequest(); setMessage(text.exportDownloading);
    try {
      const response = await request("/result-export", op);
      if (response.status === 409) { setMessage(text.exportConflict); return; }
      if (!response.ok || response.headers.get("content-type") !== "application/xml; charset=utf-8") throw new Error("Export unavailable");
      const metadata = parseIofResultListExportMetadata(response, raceId);
      const filename = iofResultListExportFilename(response, raceId);
      await saveExport(response, filename, metadata.sha256, op);
      assertCurrent(op);
      setMessage(text.exportDownloaded(metadata.resultCount, metadata.omittedEntryCount, metadata.staleResultCount));
    } catch { if (current(op)) setMessage(text.exportError); }
    finally { finish(op); }
  }
  async function refresh() {
    if (busyRef.current || pending.current || !requireSession()) return;
    showMobilePanel("LIST");
    const op = begin(); setData(undefined); setEntryId(""); setClassId(""); setPage(0); setNewCard("");
    try { await load(op); setMessage(""); }
    catch { if (current(op)) setMessage(text.error); } finally { finish(op); }
  }
  function select(id: string, openJournal = false, reviewConflict = false, requestedAction?: Action) {
    if (busyRef.current || pending.current || !requireSession()) return;
    const nextAction = requestedAction ?? "INFO";
    setAction(nextAction);
    if (!openJournal) {
      if (!participantsVisible) {
        // Follow-up actions inside preparation must reveal their participant target before focusing it.
        setStartRulePreview(undefined);
        flushSync(() => {
          if (workflowMode === "BEFORE") setPreparationArea("PARTICIPANTS");
          else if (workflowMode === "DURING") setDuringArea("PARTICIPANTS");
          else setWorkflowMode("PARTICIPANTS");
        });
      }
      setWideTable(false);
      showMobilePanel("WORK");
    }
    setReviewCandidate(undefined); setReviewReason(""); setReviewConfirmed(false);
    const selectedEntry = data?.entries.find((entry) => entry.id === id);
    setEntryId(id); setClassId(""); setMessage(""); setNewCard(""); setRentalReuseSourceId(""); setPaymentStatus(selectedEntry?.paymentStatus ?? "PAID");
    setCheckinHistory(undefined);
    if (action === "REGISTRATION") { setGivenName(""); setFamilyName(""); setOrganisationName(""); }
    setStartDate(""); setStartClock(""); setStartOffset("");
    setRecalculationCandidates(undefined);
    if (openJournal) {
      if (checkinHistoryPanel.current) {
        checkinHistoryPanel.current.open = true;
        checkinHistoryPanel.current.querySelector("summary")?.focus();
        checkinHistoryPanel.current.scrollIntoView({ block: "start" });
      }
      if (reviewConflict) void loadConflictReview(id);
      else void loadCheckinHistory(undefined, id);
      return;
    }
    if (nextAction === "RECALCULATION") void loadRecalculation(id);
    else if (nextAction === "IDENTITY") void loadIdentity(id);
    else if (nextAction === "HISTORY") void loadHistory(id);
    else if (nextAction === "DNS") void loadDns(id);
    else if (nextAction === "DNF") void loadDnf(id);
    else if (nextAction === "DSQ") void loadDsq(id);
    else if (nextAction === "OOC") void loadOoc(id);
    else if (nextAction === "NT") void loadNt(id);
    else if (nextAction === "APPROVAL") void loadApproval(id);
    else if (data) {
      const op = begin(); void loadEffectiveResult(id, data, op).finally(() => finish(op));
    }
  }
  function openMissingStartTime(id: string) {
    if (busyRef.current || pending.current || !requireSession()) return;
    select(id, false, false, "TIME");
    window.requestAnimationFrame(() => workPanel.current?.focus());
  }
  function openRecalculation(id: string) {
    if (busyRef.current || pending.current || !requireSession()) return;
    select(id, false, false, "RECALCULATION");
    window.requestAnimationFrame(() => workPanel.current?.focus());
  }
  function chooseAction(value: Action) {
    if (busyRef.current || pending.current || !requireSession()) return;
    setAction(value); setClassId(""); setNewCard(""); setStartDate(""); setStartClock(""); setStartOffset(""); setMessage("");
    if (value === "PAYMENT") setPaymentStatus(data?.entries.find((entry) => entry.id === entryId)?.paymentStatus ?? "PAID");
    setRecalculationCandidates(undefined);
    setIdentityCandidates(undefined); setGivenName(""); setFamilyName(""); setOrganisationName("");
    setEntryChanges(undefined);
    setDnsCandidates(undefined); setDnsWithdrawals(undefined);
    if (value === "RECALCULATION") void loadRecalculation();
    if (value === "IDENTITY") void loadIdentity();
    if (value === "HISTORY") void loadHistory();
    if (value === "DNS") void loadDns();
    setDnfCandidates(undefined); setDnfWithdrawals(undefined);
    if (value === "DNF") void loadDnf();
    setDsqCandidates(undefined); setDsqWithdrawals(undefined);
    if (value === "DSQ") void loadDsq();
    setApprovalCandidates(undefined); setApprovalWithdrawals(undefined);
    if (value === "APPROVAL") void loadApproval();
    setOocCandidates(undefined); setOocWithdrawals(undefined);
    if (value === "OOC") void loadOoc();
    setNtCandidates(undefined); setNtWithdrawals(undefined);
    if (value === "NT") void loadNt();
  }
  async function loadApprovalBasis(op: Operation, selectedId: string) {
    const roster = await load(op, selectedId);
    const decisionResponse = await request("/approval-candidates", op);
    if (!decisionResponse.ok) throw new Error("APPROVAL candidates unavailable");
    const candidates = parseResultApprovalCandidates(await json(decisionResponse, op), raceId);
    const withdrawalResponse = await request("/approval-withdrawals", op);
    if (!withdrawalResponse.ok) throw new Error("APPROVAL withdrawals unavailable");
    const withdrawals = parseResultApprovalWithdrawals(await json(withdrawalResponse, op), raceId);
    if (candidates.snapshotVersion !== roster.snapshotVersion || withdrawals.snapshotVersion !== roster.snapshotVersion) throw new Error("APPROVAL snapshot mismatch");
    const entry = roster.entries.find((row) => row.id === selectedId);
    const raceClass = roster.classes.find((row) => row.id === entry?.classId);
    const candidate = candidates.entries.find((row) => row.id === selectedId);
    const active = withdrawals.entries.filter((row) => row.id === selectedId && row.state === "WITHDRAWABLE");
    if (active.length > 1 || (selectedId && (!entry || !raceClass || !candidate || [candidate, ...active].some((row) =>
      row.entryVersion !== entry.version || row.classId !== entry.classId || row.courseVersionId !== raceClass.courseVersionId)))) throw new Error("APPROVAL entry mismatch");
    setApprovalCandidates(candidates); setApprovalWithdrawals(withdrawals);
  }
  async function loadApproval(selectedId = entryId) {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = begin();
    try { await loadApprovalBasis(op, selectedId); setMessage(""); }
    catch { if (current(op)) setMessage(text.approvalLoadError); } finally { finish(op); }
  }
  async function loadDsqBasis(op: Operation, selectedId: string) {
    const roster = await load(op, selectedId);
    const decisionResponse = await request("/disqualification-candidates", op);
    if (!decisionResponse.ok) throw new Error("DSQ candidates unavailable");
    const candidates = parseResultDisqualificationCandidates(await json(decisionResponse, op), raceId);
    const withdrawalResponse = await request("/disqualification-withdrawals", op);
    if (!withdrawalResponse.ok) throw new Error("DSQ withdrawals unavailable");
    const withdrawals = parseResultDisqualificationWithdrawals(await json(withdrawalResponse, op), raceId);
    if (candidates.snapshotVersion !== roster.snapshotVersion || withdrawals.snapshotVersion !== roster.snapshotVersion) throw new Error("DSQ snapshot mismatch");
    const entry = roster.entries.find((row) => row.id === selectedId);
    const raceClass = roster.classes.find((row) => row.id === entry?.classId);
    const candidate = candidates.entries.find((row) => row.id === selectedId);
    const active = withdrawals.entries.filter((row) => row.id === selectedId && row.state === "WITHDRAWABLE");
    if (active.length > 1 || (selectedId && (!entry || !raceClass || !candidate || [candidate, ...active].some((row) =>
      row.entryVersion !== entry.version || row.classId !== entry.classId || row.courseVersionId !== raceClass.courseVersionId)))) throw new Error("DSQ entry mismatch");
    setDsqCandidates(candidates); setDsqWithdrawals(withdrawals);
  }
  async function loadDsq(selectedId = entryId) {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = begin();
    try { await loadDsqBasis(op, selectedId); setMessage(""); }
    catch { if (current(op)) setMessage(text.dsqLoadError); } finally { finish(op); }
  }
  async function loadNtBasis(op: Operation, selectedId: string) {
    const roster = await load(op, selectedId);
    const decisionResponse = await request("/without-timing-candidates", op);
    if (!decisionResponse.ok) throw new Error("NT candidates unavailable");
    const candidates = parseWithoutTimingCandidates(await json(decisionResponse, op), raceId);
    const withdrawalResponse = await request("/without-timing-withdrawals", op);
    if (!withdrawalResponse.ok) throw new Error("NT withdrawals unavailable");
    const withdrawals = parseWithoutTimingWithdrawals(await json(withdrawalResponse, op), raceId);
    if (candidates.snapshotVersion !== roster.snapshotVersion || withdrawals.snapshotVersion !== roster.snapshotVersion) throw new Error("NT snapshot mismatch");
    const entry = roster.entries.find((row) => row.id === selectedId);
    const raceClass = roster.classes.find((row) => row.id === entry?.classId);
    const candidate = candidates.entries.find((row) => row.id === selectedId);
    const active = withdrawals.entries.filter((row) => row.id === selectedId && row.state === "WITHDRAWABLE");
    if (active.length > 1 || (selectedId && (!entry || !raceClass || !candidate || [candidate, ...active].some((row) =>
      row.entryVersion !== entry.version || row.classId !== entry.classId || row.courseVersionId !== raceClass.courseVersionId)))) throw new Error("NT entry mismatch");
    setNtCandidates(candidates); setNtWithdrawals(withdrawals);
  }
  async function loadNt(selectedId = entryId) {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = begin();
    try { await loadNtBasis(op, selectedId); setMessage(""); }
    catch { if (current(op)) setMessage(text.ntLoadError); } finally { finish(op); }
  }
  async function loadOocBasis(op: Operation, selectedId: string) {
    const roster = await load(op, selectedId);
    const decisionResponse = await request("/out-of-competition-candidates", op);
    if (!decisionResponse.ok) throw new Error("OOC candidates unavailable");
    const candidates = parseOutOfCompetitionCandidates(await json(decisionResponse, op), raceId);
    const withdrawalResponse = await request("/out-of-competition-withdrawals", op);
    if (!withdrawalResponse.ok) throw new Error("OOC withdrawals unavailable");
    const withdrawals = parseOutOfCompetitionWithdrawals(await json(withdrawalResponse, op), raceId);
    if (candidates.snapshotVersion !== roster.snapshotVersion || withdrawals.snapshotVersion !== roster.snapshotVersion) throw new Error("OOC snapshot mismatch");
    const entry = roster.entries.find((row) => row.id === selectedId);
    const raceClass = roster.classes.find((row) => row.id === entry?.classId);
    const candidate = candidates.entries.find((row) => row.id === selectedId);
    const active = withdrawals.entries.filter((row) => row.id === selectedId && row.state === "WITHDRAWABLE");
    if (active.length > 1 || (selectedId && (!entry || !raceClass || !candidate || [candidate, ...active].some((row) =>
      row.entryVersion !== entry.version || row.classId !== entry.classId || row.courseVersionId !== raceClass.courseVersionId)))) throw new Error("OOC entry mismatch");
    setOocCandidates(candidates); setOocWithdrawals(withdrawals);
  }
  async function loadOoc(selectedId = entryId) {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = begin();
    try { await loadOocBasis(op, selectedId); setMessage(""); }
    catch { if (current(op)) setMessage(text.oocLoadError); } finally { finish(op); }
  }
  async function loadDnfBasis(op: Operation, selectedId: string) {
    const roster = await load(op, selectedId);
    const decisionResponse = await request("/did-not-finish-candidates", op);
    if (!decisionResponse.ok) throw new Error("DNF candidates unavailable");
    const candidates = parseDidNotFinishCandidates(await json(decisionResponse, op), raceId);
    const withdrawalResponse = await request("/did-not-finish-withdrawals", op);
    if (!withdrawalResponse.ok) throw new Error("DNF withdrawals unavailable");
    const withdrawals = parseDidNotFinishWithdrawals(await json(withdrawalResponse, op), raceId);
    if (candidates.snapshotVersion !== roster.snapshotVersion || withdrawals.snapshotVersion !== roster.snapshotVersion) throw new Error("DNF snapshot mismatch");
    const entry = roster.entries.find((row) => row.id === selectedId);
    const raceClass = roster.classes.find((row) => row.id === entry?.classId);
    const candidate = candidates.entries.find((row) => row.id === selectedId);
    const active = withdrawals.entries.filter((row) => row.id === selectedId && row.state === "WITHDRAWABLE");
    if (active.length > 1 || (selectedId && (!entry || !raceClass || !candidate || [candidate, ...active].some((row) =>
      row.entryVersion !== entry.version || row.classId !== entry.classId || row.courseVersionId !== raceClass.courseVersionId)))) throw new Error("DNF entry mismatch");
    setDnfCandidates(candidates); setDnfWithdrawals(withdrawals);
  }
  async function loadDnf(selectedId = entryId) {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = begin();
    try { await loadDnfBasis(op, selectedId); setMessage(""); }
    catch { if (current(op)) setMessage(text.dnfLoadError); } finally { finish(op); }
  }
  async function loadDnsBasis(op: Operation, selectedId: string) {
    const roster = await load(op, selectedId);
    const decisionResponse = await request("/did-not-start-candidates", op);
    if (!decisionResponse.ok) throw new Error("DNS candidates unavailable");
    const candidates = parseDidNotStartCandidates(await json(decisionResponse, op), raceId);
    const withdrawalResponse = await request("/did-not-start-withdrawals", op);
    if (!withdrawalResponse.ok) throw new Error("DNS withdrawals unavailable");
    const withdrawals = parseDidNotStartWithdrawals(await json(withdrawalResponse, op), raceId);
    if (candidates.snapshotVersion !== roster.snapshotVersion || withdrawals.snapshotVersion !== roster.snapshotVersion) throw new Error("DNS snapshot mismatch");
    const entry = roster.entries.find((row) => row.id === selectedId);
    const raceClass = roster.classes.find((row) => row.id === entry?.classId);
    const candidate = candidates.entries.find((row) => row.id === selectedId);
    const withdrawal = withdrawals.entries.find((row) => row.id === selectedId);
    if (selectedId && (!entry || !raceClass || !candidate || [candidate, ...(withdrawal ? [withdrawal] : [])].some((row) =>
      row.entryVersion !== entry.version || row.classId !== entry.classId || row.courseVersionId !== raceClass.courseVersionId))) throw new Error("DNS entry mismatch");
    setDnsCandidates(candidates); setDnsWithdrawals(withdrawals);
  }
  async function loadDns(selectedId = entryId) {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = begin();
    try { await loadDnsBasis(op, selectedId); setMessage(""); }
    catch { if (current(op)) setMessage(text.dnsLoadError); } finally { finish(op); }
  }
  async function loadHistory(selectedId = entryId, beforeVersion?: number) {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = begin();
    try {
      if (!selectedId) { setMessage(""); return; }
      const roster = await load(op, selectedId);
      const entry = roster.entries.find((row) => row.id === selectedId);
      if (!entry || (beforeVersion !== undefined && (!Number.isInteger(beforeVersion) || beforeVersion <= 0 || beforeVersion > 2_147_483_647))) throw new Error("Invalid history scope");
      const response = await request(`/entries/${selectedId}/changes${beforeVersion === undefined ? "" : `?beforeVersion=${beforeVersion}`}`, op);
      if (!response.ok) throw new Error("History unavailable");
      const value = administratorEntryChangesResponseSchema.parse(await json(response, op));
      if (value.raceId !== raceId || value.entryId !== selectedId || value.entryVersion !== entry.version ||
        value.snapshotVersion !== roster.snapshotVersion || value.timeZone !== roster.timeZone ||
        (beforeVersion !== undefined && (value.items.some((row) => row.entryVersionAfter >= beforeVersion) ||
          (value.nextBeforeVersion !== null && value.nextBeforeVersion >= beforeVersion)))) throw new Error("History response mismatch");
      setEntryChanges(value); setMessage("");
    } catch { if (current(op)) setMessage(text.historyError); }
    finally { finish(op); }
  }
  function newParticipant() {
    if (busyRef.current || pending.current || !requireSession()) return;
    setWideTable(false);
    chooseAction("REGISTRATION"); setEntryId(""); setEffectiveResult(undefined); setEffectiveResultError(false);
    showMobilePanel("WORK");
  }
  async function loadIdentity(selectedId = entryId) {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = begin(); setGivenName(""); setFamilyName(""); setOrganisationName("");
    try {
      const roster = await load(op, selectedId);
      const response = await request("/identity-candidates", op);
      if (!response.ok) throw new Error("Identity candidates unavailable");
      const candidates = entryIdentityAdminListResponseSchema.parse(await json(response, op));
      if (candidates.raceId !== raceId || candidates.snapshotVersion !== roster.snapshotVersion) throw new Error("Identity snapshot mismatch");
      const entry = roster.entries.find((row) => row.id === selectedId);
      const candidate = candidates.entries.find((row) => row.id === selectedId);
      if (selectedId && (!entry || !candidate || entry.classId !== candidate.classId || entry.version !== candidate.version)) throw new Error("Identity entry mismatch");
      setIdentityCandidates(candidates);
      if (candidate) { setGivenName(candidate.identity.givenName); setFamilyName(candidate.identity.familyName); setOrganisationName(candidate.identity.organisationName ?? ""); }
      setMessage("");
    } catch { if (current(op)) setMessage(text.identityLoadError); }
    finally { finish(op); }
  }
  async function loadRecalculation(selectedId = entryId) {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = begin(); setRecalculationCandidates(undefined);
    try {
      const roster = await load(op, selectedId);
      const response = await request("/recalculation-candidates", op);
      if (!response.ok) throw new Error("Recalculation candidates unavailable");
      const candidates = parseResultRecalculationCandidates(await json(response, op), raceId);
      if (candidates.snapshotVersion !== roster.snapshotVersion) throw new Error("Recalculation snapshot mismatch");
      setRecalculationCandidates(candidates); setMessage("");
    } catch { if (current(op)) setMessage(text.recalculationLoadError); }
    finally { finish(op); }
  }
  async function loadClassRecalculation(classId: string) {
    if (busyRef.current || pending.current || !requireSession() || !classId) return;
    const op = beginRequest(); setClassRecalculationCandidates(undefined); setClassRecalculationAttempt(undefined);
    setClassRecalculationError(""); setClassRecalculationSaved(""); setClassRecalculationUnknown(false);
    try {
      const response = await request(`/classes/${classId}/result-recalculation`, op);
      if (!response.ok) throw new Error("Class recalculation candidates unavailable");
      const value = parseClassResultRecalculationCandidates(await json(response, op), raceId);
      setClassRecalculationCandidates(value);
    } catch { if (current(op)) setClassRecalculationError(text.recalculationLoadError); }
    finally { finish(op); }
  }
  function prepareClassRecalculation(entryIds: string[]) {
    if (busyRef.current || pending.current || !requireSession() || !classRecalculationCandidates) return;
    try {
      const value = createClassResultRecalculationAttempt(classRecalculationCandidates, entryIds);
      pending.current = value; sent.current = false; setClassRecalculationAttempt(value);
      setClassRecalculationUnknown(false); setClassRecalculationError("");
    } catch { setClassRecalculationError(text.recalculationLoadError); }
  }
  async function submitClassRecalculation(value: ClassResultRecalculationAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = beginRequest(); const wasUnknown = sent.current; let committed = false;
    try {
      sent.current = true;
      const response = await request(`/classes/${value.classId}/result-recalculation`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf(), "idempotency-key": `class-result-recalculation:${value.requestId}` },
        body: JSON.stringify(classResultRecalculationBody(value)) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setClassRecalculationUnknown(true); setClassRecalculationError(text.classRecalculationUnknown); return; }
        pending.current = undefined; sent.current = false; setClassRecalculationAttempt(undefined); setClassRecalculationError(text.classRecalculationConflict); return;
      }
      if (!response.ok) throw new Error("Unknown class recalculation outcome");
      const receipt = parseClassResultRecalculationResponse(await json(response, op), value, raceId);
      committed = true; pending.current = undefined; sent.current = false; setClassRecalculationAttempt(undefined); setClassRecalculationUnknown(false);
      setClassRecalculationSaved(text.classRecalculationSaved(receipt.items.length));
      await load(op);
    } catch { if (current(op)) setClassRecalculationError(committed ? text.recalculationSavedLoadError : text.classRecalculationUnknown); }
    finally { finish(op); }
  }
  function prepare(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || pending.current || !requireSession()) return;
    const entry = data?.entries.find((row) => row.id === entryId);
    const target = data?.classes.find((row) => row.id === classId);
    const previous = data?.classes.find((row) => row.id === entry?.classId);
    if (!data || !entry || !target || !previous || entry.classId === target.id) { setMessage(text.invalid); return; }
    if (target.maxEntries !== null && target.entryCount >= target.maxEntries) { setMessage(text.classFull); return; }
    const selectedSlot = transferStartSlots?.targetClassId === target.id && transferStartSlots.plan.status === "AVAILABLE"
      ? transferStartSlots.plan.slots.find(slot => slot.fixedStartTime === selectedTransferStartSlot) : undefined;
    const fixedStartTime = target.startRule === "FIXED" ? selectedSlot?.fixedStartTime ?? parseStartTimeFields(startDate, startClock, startOffset) : null;
    if (target.startRule === "FIXED" && fixedStartTime === null) { setMessage(text.invalidTime); return; }
    const value: Attempt = { kind: "TRANSFER", id: crypto.randomUUID(), entryId: entry.id, displayName: entry.displayName,
      previousClassId: entry.classId, previousClassName: previous.name, className: target.name,
      request: entryTransferRequestSchema.parse({ formatVersion: 1, targetClassId: target.id,
        expectedEntryVersion: entry.version, expectedClassId: entry.classId,
        expectedSnapshotVersion: data.snapshotVersion, expectedFixedStartTime: entry.fixedStartTime,
        expectedTargetCourseVersionId: target.courseVersionId, expectedTargetStartRule: target.startRule,
        expectedTargetCapacityVersion: target.capacityVersion, fixedStartTime,
        assignedStartSlot: selectedSlot && transferStartSlots?.plan.status === "AVAILABLE"
          ? { drawRequestId: transferStartSlots.plan.drawRequestId, sourceHash: transferStartSlots.plan.sourceHash,
            fixedStartTime: selectedSlot.fixedStartTime } : null }) };
    pending.current = value; sent.current = false; setAttempt(value); setUnknown(false); setMessage("");
  }
  async function submit(value: Attempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current;
    let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/entries/${value.entryId}/transfer`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `entry-transfer:${value.id}` },
        body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.unknown); return; }
        pending.current = undefined; sent.current = false; setAttempt(undefined); setUnknown(false);
        setData(undefined); setEntryId(""); setClassId(""); setMessage(text.conflict); return;
      }
      if (!response.ok) throw new Error("Unknown outcome");
      const receipt = entryTransferResponseSchema.parse(await json(response, op));
      if (receipt.requestId !== value.id || receipt.raceId !== raceId || receipt.entryId !== value.entryId ||
        JSON.stringify(receipt.request) !== JSON.stringify(value.request)) throw new Error("Receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setAttempt(undefined); setUnknown(false);
      setData(undefined); setClassId(""); setMessage(text.saved); setNewCard("");
      setStartDate(""); setStartClock(""); setStartOffset("");
      await load(op, value.entryId); setEntryId(value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.savedLoadError : text.unknown); }
    } finally { finish(op); }
  }
  function prepareCapacity(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || pending.current || !requireSession()) return;
    const targetClass = data?.classes.find((row) => row.id === capacityClassId);
    const input = capacityInput.trim();
    if (!targetClass || (input !== "" && !/^\d{1,5}$/.test(input))) { setMessage(text.capacityInvalid); return; }
    const parsed = classCapacityRequestSchema.safeParse({ formatVersion: 1,
      expectedCapacityVersion: targetClass.capacityVersion, expectedMaxEntries: targetClass.maxEntries,
      maxEntries: input === "" ? null : Number(input) });
    if (!parsed.success || (parsed.data.maxEntries !== null && parsed.data.maxEntries < targetClass.entryCount)) {
      setMessage(text.capacityInvalid); return;
    }
    const value: CapacityAttempt = { kind: "CAPACITY", id: crypto.randomUUID(), classId: targetClass.id, className: targetClass.name,
      entryCount: targetClass.entryCount, request: parsed.data };
    pending.current = value; sent.current = false; setCapacityAttempt(value); setUnknown(false); setMessage("");
  }
  async function submitCapacity(value: CapacityAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current;
    let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/classes/${value.classId}/capacity`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `class-capacity:${value.id}` },
        body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.capacityUnknown); return; }
        pending.current = undefined; sent.current = false; setCapacityAttempt(undefined); setUnknown(false);
        setData(undefined); setEntryId(""); setClassId(""); setCapacityClassId(""); setCapacityInput("");
        setMessage(text.capacityConflict); return;
      }
      if (!response.ok) throw new Error("Unknown capacity outcome");
      const receipt = classCapacityResponseSchema.parse(await json(response, op));
      if (receipt.requestId !== value.id || receipt.raceId !== raceId || receipt.classId !== value.classId ||
        receipt.versionBefore !== value.request.expectedCapacityVersion ||
        receipt.previousMaxEntries !== value.request.expectedMaxEntries || receipt.maxEntries !== value.request.maxEntries) {
        throw new Error("Capacity receipt mismatch");
      }
      committed = true; pending.current = undefined; sent.current = false; setCapacityAttempt(undefined); setUnknown(false);
      setData(undefined); setCapacityClassId(""); setCapacityInput(""); setMessage(text.capacitySaved);
      await load(op);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.capacitySavedLoadError : text.capacityUnknown); }
    } finally { finish(op); }
  }
  async function loadStartRulePreview() {
    if (busyRef.current || pending.current || !requireSession() || !startRuleClassId) return;
    setStartRulePreview(undefined); setStartRuleReason(""); setStartRuleConfirmed(false); setMessage("");
    const op = begin();
    try {
      const response = await request(`/classes/${startRuleClassId}/start-rule`, op);
      if (!response.ok) throw new Error("Start-rule preview unavailable");
      const value = classStartRulePreviewSchema.parse(await json(response, op));
      if (value.raceId !== raceId || value.classId !== startRuleClassId) throw new Error("Start-rule preview scope mismatch");
      setStartRulePreview(value);
    } catch { if (current(op)) setMessage(text.startRuleLoadError); }
    finally { finish(op); }
  }
  function prepareStartRule(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || pending.current || !requireSession() || !startRulePreview || !startRuleConfirmed) return;
    const request = classStartRuleChangeRequestSchema.safeParse({ formatVersion: 1, requestId: crypto.randomUUID(),
      expectedSnapshotVersion: startRulePreview.snapshotVersion, expectedStartRule: startRulePreview.startRule,
      startRule: startRulePreview.startRule === "FIXED" ? "PUNCH" : "FIXED", reason: startRuleReason });
    if (!request.success) { setMessage(text.startRuleInvalid); return; }
    const value: StartRuleAttempt = { kind: "START_RULE", preview: startRulePreview, request: request.data };
    pending.current = value; sent.current = false; setStartRuleAttempt(value); setUnknown(false); setMessage("");
  }
  async function submitStartRule(value: StartRuleAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current; let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/classes/${value.preview.classId}/start-rule`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token }, body: JSON.stringify(value.request) });
      if ([400, 404, 409, 413].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.startRuleUnknown); return; }
        pending.current = undefined; sent.current = false; setStartRuleAttempt(undefined); setUnknown(false);
        setStartRulePreview(undefined); setMessage(text.startRuleConflict); return;
      }
      if (!response.ok) throw new Error("Unknown start-rule outcome");
      const receipt = classStartRuleChangeResponseSchema.parse(await json(response, op));
      if (receipt.requestId !== value.request.requestId || receipt.raceId !== raceId || receipt.classId !== value.preview.classId ||
        receipt.previousStartRule !== value.request.expectedStartRule || receipt.startRule !== value.request.startRule ||
        receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion) throw new Error("Start-rule receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setStartRuleAttempt(undefined); setUnknown(false);
      setStartRulePreview(undefined); setStartRuleClassId(value.preview.classId); setStartRuleReason(""); setStartRuleConfirmed(false);
      setData(undefined); setMessage(text.startRuleSaved); await load(op);
    } catch { if (current(op)) { setUnknown(!committed); setMessage(committed ? text.startRuleSavedLoadError : text.startRuleUnknown); } }
    finally { finish(op); }
  }
  function prepareCard(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || pending.current || !requireSession()) return;
    const entry = data?.entries.find((row) => row.id === entryId);
    if (!data || !entry || entry.multipleActiveAssignments) { setMessage(text.cardInvalid); return; }
    const parsed = entryCardChangeRequestSchema.safeParse({ formatVersion: 1,
      expectedEntryVersion: entry.version, expectedClassId: entry.classId,
      expectedSnapshotVersion: data.snapshotVersion,
      expectedAssignment: entry.activeAssignment ? { id: entry.activeAssignment.id, cardNumber: entry.activeAssignment.cardNumber } : null,
      cardNumber: newCard });
    if (!parsed.success || parsed.data.cardNumber === entry.activeAssignment?.cardNumber) { setMessage(text.cardInvalid); return; }
    const value: CardAttempt = { kind: "CARD", id: crypto.randomUUID(), entryId: entry.id,
      displayName: entry.displayName, request: parsed.data };
    pending.current = value; sent.current = false; setCardAttempt(value); setUnknown(false); setMessage("");
  }
  async function submitCard(value: CardAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current;
    let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/entries/${value.entryId}/card`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `entry-card-change:${value.id}` },
        body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.cardUnknown); return; }
        pending.current = undefined; sent.current = false; setCardAttempt(undefined); setUnknown(false);
        setData(undefined); setEntryId(""); setClassId(""); setNewCard(""); setMessage(text.cardConflict); return;
      }
      if (!response.ok) throw new Error("Unknown card outcome");
      const receipt = entryCardChangeResponseSchema.parse(await json(response, op));
      if (receipt.requestId !== value.id || receipt.raceId !== raceId || receipt.entryId !== value.entryId ||
        receipt.classId !== value.request.expectedClassId || receipt.activeAssignment.cardNumber !== value.request.cardNumber ||
        receipt.previousAssignment?.id !== value.request.expectedAssignment?.id ||
        receipt.previousAssignment?.cardNumber !== value.request.expectedAssignment?.cardNumber ||
        receipt.entryVersionBefore !== value.request.expectedEntryVersion ||
        receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion) throw new Error("Card receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setCardAttempt(undefined); setUnknown(false);
      setData(undefined); setClassId(""); setNewCard(""); setMessage(text.cardSaved);
      setStartDate(""); setStartClock(""); setStartOffset("");
      await load(op, value.entryId); setEntryId(value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.cardSavedLoadError : text.cardUnknown); }
    } finally { finish(op); }
  }
  function prepareRental() {
    if (busyRef.current || pending.current || !requireSession()) return;
    const entry = data?.entries.find((row) => row.id === entryId);
    if (!data || !entry || entry.multipleActiveAssignments || !entry.activeAssignment) {
      setMessage(text.rentalInvalid); return;
    }
    const parsed = entryCardRentalChangeRequestSchema.safeParse({ formatVersion: 1,
      expectedEntryVersion: entry.version, expectedClassId: entry.classId,
      expectedSnapshotVersion: data.snapshotVersion, expectedAssignment: {
        id: entry.activeAssignment.id, cardNumber: entry.activeAssignment.cardNumber,
        isRental: entry.activeAssignment.isRental
      },
      isRental: !entry.activeAssignment.isRental });
    if (!parsed.success) { setMessage(text.rentalInvalid); return; }
    const value: RentalAttempt = { kind: "CARD_RENTAL", id: crypto.randomUUID(), entryId: entry.id,
      displayName: entry.displayName, request: parsed.data };
    pending.current = value; sent.current = false; setRentalAttempt(value); setUnknown(false); setMessage("");
  }
  async function submitRental(value: RentalAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current; let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/entries/${value.entryId}/card-rental`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token,
          "idempotency-key": `entry-card-rental-change:${value.id}` }, body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.rentalUnknown); return; }
        pending.current = undefined; sent.current = false; setRentalAttempt(undefined); setUnknown(false);
        setData(undefined); setEntryId(""); setMessage(text.rentalConflict); return;
      }
      if (!response.ok) throw new Error("Unknown rental outcome");
      const receipt = entryCardRentalChangeResponseSchema.parse(await json(response, op));
      if (receipt.requestId !== value.id || receipt.raceId !== raceId || receipt.entryId !== value.entryId ||
        receipt.classId !== value.request.expectedClassId || receipt.assignment.id !== value.request.expectedAssignment.id ||
        receipt.assignment.cardNumber !== value.request.expectedAssignment.cardNumber ||
        receipt.previousIsRental !== value.request.expectedAssignment.isRental || receipt.isRental !== value.request.isRental ||
        receipt.entryVersionBefore !== value.request.expectedEntryVersion ||
        receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion) throw new Error("Rental receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setRentalAttempt(undefined); setUnknown(false);
      setData(undefined); setMessage(text.rentalSaved); await load(op, value.entryId); setEntryId(value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.rentalSavedLoadError : text.rentalUnknown); }
    } finally { finish(op); }
  }
  function prepareRentalReturn() {
    if (busyRef.current || pending.current || !requireSession()) return;
    const entry = data?.entries.find((row) => row.id === entryId);
    if (!data || !entry || entry.multipleActiveAssignments || !entry.activeAssignment?.isRental) {
      setMessage(text.rentalReturnInvalid); return;
    }
    const parsed = entryCardRentalReturnChangeRequestSchema.safeParse({ formatVersion: 1,
      expectedEntryVersion: entry.version, expectedClassId: entry.classId,
      expectedSnapshotVersion: data.snapshotVersion, expectedAssignment: entry.activeAssignment,
      rentalReturned: !entry.activeAssignment.rentalReturned });
    if (!parsed.success) { setMessage(text.rentalReturnInvalid); return; }
    const value: RentalReturnAttempt = { kind: "CARD_RENTAL_RETURN", id: crypto.randomUUID(), entryId: entry.id,
      displayName: entry.displayName, request: parsed.data };
    pending.current = value; sent.current = false; setRentalReturnAttempt(value); setUnknown(false); setMessage("");
  }
  async function submitRentalReturn(value: RentalReturnAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current; let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/entries/${value.entryId}/card-rental-return`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token,
          "idempotency-key": `entry-card-rental-return-change:${value.id}` }, body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.rentalReturnUnknown); return; }
        pending.current = undefined; sent.current = false; setRentalReturnAttempt(undefined); setUnknown(false);
        setData(undefined); setEntryId(""); setMessage(text.rentalReturnConflict); return;
      }
      if (!response.ok) throw new Error("Unknown rental return outcome");
      const receipt = entryCardRentalReturnChangeResponseSchema.parse(await json(response, op));
      if (receipt.requestId !== value.id || receipt.raceId !== raceId || receipt.entryId !== value.entryId ||
        receipt.classId !== value.request.expectedClassId || receipt.assignment.id !== value.request.expectedAssignment.id ||
        receipt.assignment.cardNumber !== value.request.expectedAssignment.cardNumber ||
        receipt.previousRentalReturned !== value.request.expectedAssignment.rentalReturned ||
        receipt.rentalReturned !== value.request.rentalReturned ||
        receipt.entryVersionBefore !== value.request.expectedEntryVersion ||
        receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion) throw new Error("Rental return receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setRentalReturnAttempt(undefined); setUnknown(false);
      setData(undefined); setMessage(text.rentalReturnSaved); await load(op, value.entryId); setEntryId(value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.rentalReturnSavedLoadError : text.rentalReturnUnknown); }
    } finally { finish(op); }
  }
  function prepareRentalReuse(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || pending.current || !requireSession()) return;
    const target = data?.entries.find((row) => row.id === entryId);
    const source = data?.entries.find((row) => row.activeAssignment?.id === rentalReuseSourceId);
    if (!data || !target || !source || target.id === source.id || target.multipleActiveAssignments ||
      target.activeAssignment || source.multipleActiveAssignments || !source.activeAssignment) {
      setMessage(text.rentalReuseInvalid); return;
    }
    const parsed = entryCardRentalReuseRequestSchema.safeParse({ formatVersion: 1,
      expectedSnapshotVersion: data.snapshotVersion,
      source: { entryId: source.id, classId: source.classId, entryVersion: source.version,
        assignment: source.activeAssignment },
      expectedTargetClassId: target.classId, expectedTargetEntryVersion: target.version });
    if (!parsed.success) { setMessage(text.rentalReuseInvalid); return; }
    const value: RentalReuseAttempt = { kind: "CARD_RENTAL_REUSE", id: crypto.randomUUID(), entryId: target.id,
      displayName: target.displayName, sourceDisplayName: source.displayName, request: parsed.data };
    pending.current = value; sent.current = false; setRentalReuseAttempt(value); setUnknown(false); setMessage("");
  }
  async function submitRentalReuse(value: RentalReuseAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current; let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/entries/${value.entryId}/card-rental-reuse`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token,
          "idempotency-key": `entry-card-rental-reuse:${value.id}` }, body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.rentalReuseUnknown); return; }
        pending.current = undefined; sent.current = false; setRentalReuseAttempt(undefined); setUnknown(false);
        setData(undefined); setEntryId(""); setRentalReuseSourceId(""); setMessage(text.rentalReuseConflict); return;
      }
      if (!response.ok) throw new Error("Unknown rental reuse outcome");
      const receipt = entryCardRentalReuseResponseSchema.parse(await json(response, op));
      if (receipt.requestId !== value.id || receipt.raceId !== raceId || receipt.target.entryId !== value.entryId ||
        receipt.target.classId !== value.request.expectedTargetClassId ||
        receipt.targetEntryVersionBefore !== value.request.expectedTargetEntryVersion ||
        receipt.source.entryId !== value.request.source.entryId || receipt.source.classId !== value.request.source.classId ||
        receipt.source.assignment.id !== value.request.source.assignment.id ||
        receipt.source.assignment.cardNumber !== value.request.source.assignment.cardNumber ||
        receipt.sourceEntryVersionBefore !== value.request.source.entryVersion ||
        receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion) throw new Error("Rental reuse receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setRentalReuseAttempt(undefined); setUnknown(false);
      setData(undefined); setRentalReuseSourceId(""); setMessage(text.rentalReuseSaved); await load(op, value.entryId); setEntryId(value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.rentalReuseSavedLoadError : text.rentalReuseUnknown); }
    } finally { finish(op); }
  }
  function preparePaymentStatus(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || pending.current || !requireSession()) return;
    const entry = data?.entries.find((row) => row.id === entryId);
    if (!entry) { setMessage(text.paymentStatusInvalid); return; }
    const parsed = entryPaymentStatusChangeRequestSchema.safeParse({ formatVersion: 1,
      expectedEntryVersion: entry.version, expectedClassId: entry.classId,
      expectedPaymentStatus: entry.paymentStatus, expectedPaymentStatusVersion: entry.paymentStatusVersion,
      paymentStatus });
    if (!parsed.success) { setMessage(text.paymentStatusInvalid); return; }
    const value: PaymentStatusAttempt = { kind: "PAYMENT_STATUS", id: crypto.randomUUID(), entryId: entry.id,
      displayName: entry.displayName, request: parsed.data };
    pending.current = value; sent.current = false; setPaymentStatusAttempt(value); setUnknown(false); setMessage("");
  }
  async function submitPaymentStatus(value: PaymentStatusAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current; let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/entries/${value.entryId}/payment-status`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token,
          "idempotency-key": `entry-payment-status-change:${value.id}` }, body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.paymentStatusUnknown); return; }
        pending.current = undefined; sent.current = false; setPaymentStatusAttempt(undefined); setUnknown(false);
        setData(undefined); setEntryId(""); setMessage(text.paymentStatusConflict); return;
      }
      if (!response.ok) throw new Error("Unknown payment status outcome");
      const receipt = entryPaymentStatusChangeResponseSchema.parse(await json(response, op));
      if (receipt.requestId !== value.id || receipt.raceId !== raceId || receipt.entryId !== value.entryId ||
        receipt.classId !== value.request.expectedClassId ||
        receipt.entryVersionAtChange !== value.request.expectedEntryVersion ||
        receipt.previousPaymentStatus !== value.request.expectedPaymentStatus ||
        receipt.paymentStatus !== value.request.paymentStatus ||
        receipt.paymentStatusVersionBefore !== value.request.expectedPaymentStatusVersion ||
        receipt.paymentStatusVersionAfter !== value.request.expectedPaymentStatusVersion + 1) {
        throw new Error("Payment status receipt mismatch");
      }
      committed = true; pending.current = undefined; sent.current = false; setPaymentStatusAttempt(undefined); setUnknown(false);
      setData(undefined); setMessage(text.paymentStatusSaved); await load(op, value.entryId); setEntryId(value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.paymentStatusSavedLoadError : text.paymentStatusUnknown); }
    } finally { finish(op); }
  }
  const selected = data?.entries.find((entry) => entry.id === entryId);
  const returnedRentalSources = data?.entries.filter((entry) => entry.id !== selected?.id &&
    !entry.multipleActiveAssignments && entry.activeAssignment?.isRental && entry.activeAssignment.rentalReturned) ?? [];
  function prepareTime(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || pending.current || !requireSession()) return;
    const entry = data?.entries.find((row) => row.id === entryId);
    const currentClass = data?.classes.find((row) => row.id === entry?.classId);
    const fixedStartTime = parseStartTimeFields(startDate, startClock, startOffset);
    if (!data || !entry || currentClass?.startRule !== "FIXED" || fixedStartTime === null || fixedStartTime === entry.fixedStartTime) {
      setMessage(text.timeInvalid); return;
    }
    const value: TimeAttempt = { kind: "TIME", id: crypto.randomUUID(), entryId: entry.id,
      displayName: entry.displayName, timeZone: data.timeZone,
      request: entryStartTimeChangeRequestSchema.parse({ formatVersion: 1, expectedEntryVersion: entry.version,
        expectedClassId: entry.classId, expectedSnapshotVersion: data.snapshotVersion,
        expectedFixedStartTime: entry.fixedStartTime, fixedStartTime }) };
    pending.current = value; sent.current = false; setTimeAttempt(value); setUnknown(false); setMessage("");
  }
  async function submitTime(value: TimeAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current;
    let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/entries/${value.entryId}/start-time`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `entry-start-time-change:${value.id}` },
        body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.timeUnknown); return; }
        pending.current = undefined; sent.current = false; setTimeAttempt(undefined); setUnknown(false);
        setData(undefined); setEntryId(""); setClassId(""); setMessage(text.timeConflict); return;
      }
      if (!response.ok) throw new Error("Unknown start time outcome");
      const receipt = entryStartTimeChangeResponseSchema.parse(await json(response, op));
      if (receipt.requestId !== value.id || receipt.raceId !== raceId || receipt.entryId !== value.entryId ||
        receipt.classId !== value.request.expectedClassId || receipt.previousFixedStartTime !== value.request.expectedFixedStartTime ||
        receipt.fixedStartTime !== value.request.fixedStartTime || receipt.entryVersionBefore !== value.request.expectedEntryVersion ||
        receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion) throw new Error("Start time receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setTimeAttempt(undefined); setUnknown(false);
      setData(undefined); setStartDate(""); setStartClock(""); setStartOffset(""); setMessage(text.timeSaved);
      await load(op, value.entryId); setEntryId(value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.timeSavedLoadError : text.timeUnknown); }
    } finally { finish(op); }
  }
  const selectedClass = data?.classes.find((row) => row.id === selected?.classId);
  const recalculationCandidate = recalculationCandidates?.entries.find((row) => row.id === entryId);
  const recalculationMatches = !!data && !!selected && !!recalculationCandidate &&
    recalculationCandidates?.snapshotVersion === data.snapshotVersion &&
    recalculationCandidate.classId === selected.classId && recalculationCandidate.entryVersion === selected.version &&
    recalculationCandidate.cardAssignmentId === (selected.activeAssignment?.id ?? null) &&
    (recalculationCandidate.readiness === "MULTIPLE_ACTIVE_ASSIGNMENTS") === selected.multipleActiveAssignments;
  function prepareRecalculation() {
    if (busyRef.current || pending.current || !requireSession()) return;
    if (!data || !recalculationCandidates || !recalculationMatches || recalculationCandidate?.readiness !== "READY") {
      setMessage(text.recalculationLoadError); return;
    }
    const value: RecalculationAttempt = { kind: "RECALCULATION", timeZone: data.timeZone,
      value: createResultRecalculationAttempt(recalculationCandidate, recalculationCandidates) };
    pending.current = value; sent.current = false; setRecalculationAttempt(value); setUnknown(false); setMessage("");
  }
  async function submitRecalculation(value: RecalculationAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current;
    let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/entries/${value.value.entryId}/recalculate`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `result-recalculation:${value.value.requestId}` },
        body: JSON.stringify(resultRecalculationBody(value.value)) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.recalculationUnknown); return; }
        pending.current = undefined; sent.current = false; setRecalculationAttempt(undefined); setUnknown(false);
        setRecalculationCandidates(undefined); setMessage(text.recalculationConflict); return;
      }
      if (!response.ok) throw new Error("Unknown recalculation outcome");
      const receipt = parseResultRecalculationResponse(await json(response, op), value.value, raceId);
      committed = true; pending.current = undefined; sent.current = false; setRecalculationAttempt(undefined); setUnknown(false);
      setRecalculationCandidates(undefined);
      setMessage(`${text.recalculationSaved} ${text.technicalRevision}: ${receipt.revision} · ${receipt.status}/${receipt.reason}`);
      await load(op, value.value.entryId); setEntryId(value.value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.recalculationSavedLoadError : text.recalculationUnknown); }
    } finally { finish(op); }
  }
  const target = data?.classes.find((row) => row.id === classId);
  const capacityClass = data?.classes.find((row) => row.id === capacityClassId);
  const identityCandidate = identityCandidates?.entries.find((row) => row.id === entryId);
  const identityMatches = !!data && !!selected && !!identityCandidate && identityCandidates?.snapshotVersion === data.snapshotVersion &&
    identityCandidate.classId === selected.classId && identityCandidate.version === selected.version;
  function prepareIdentity(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || pending.current || !requireSession()) return;
    if (!data || !identityMatches || !identityCandidate) { setMessage(text.identityLoadError); return; }
    const parsed = entryIdentityChangeRequestSchema.safeParse({ formatVersion: 1, expectedEntryVersion: identityCandidate.version,
      expectedClassId: identityCandidate.classId, expectedSnapshotVersion: data.snapshotVersion, expectedIdentity: identityCandidate.identity,
      identity: { givenName, familyName, organisationName: organisationName.trim() || null } });
    if (!parsed.success || (parsed.data.identity.givenName === parsed.data.expectedIdentity.givenName &&
      parsed.data.identity.familyName === parsed.data.expectedIdentity.familyName && parsed.data.identity.organisationName === parsed.data.expectedIdentity.organisationName)) {
      setMessage(text.identityInvalid); return;
    }
    const value: IdentityAttempt = { kind: "IDENTITY", id: crypto.randomUUID(), entryId: identityCandidate.id, request: parsed.data };
    pending.current = value; sent.current = false; setIdentityAttempt(value); setUnknown(false); setMessage("");
  }
  async function submitIdentity(value: IdentityAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current;
    let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/entries/${value.entryId}/identity`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `entry-identity-change:${value.id}` },
        body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.identityUnknown); return; }
        pending.current = undefined; sent.current = false; setIdentityAttempt(undefined); setUnknown(false);
        setData(undefined); setEntryId(""); setMessage(text.identityConflict); return;
      }
      if (!response.ok) throw new Error("Unknown identity outcome");
      parseIdentityReceipt(await json(response, op), raceId, value);
      committed = true; pending.current = undefined; sent.current = false; setIdentityAttempt(undefined); setUnknown(false);
      setData(undefined); setGivenName(""); setFamilyName(""); setOrganisationName(""); setQuery(""); setPage(0); setMessage(text.identitySaved);
      await load(op, value.entryId); setEntryId(value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.identitySavedLoadError : text.identityUnknown); }
    } finally { finish(op); }
  }
  const targetFull = !!target && target.maxEntries !== null && target.entryCount >= target.maxEntries;
  const approvalCandidate = approvalCandidates?.entries.find((row) => row.id === entryId);
  const approvalHistory = approvalWithdrawals?.entries.filter((row) => row.id === entryId) ?? [];
  const approvalActive = approvalHistory.filter((row) => row.state === "WITHDRAWABLE");
  const approvalWithdrawal = approvalActive.length === 1 ? approvalActive[0] : undefined;
  const approvalMatches = !!selected && !!selectedClass && !!data && approvalCandidates?.snapshotVersion === data.snapshotVersion &&
    approvalWithdrawals?.snapshotVersion === data.snapshotVersion && approvalCandidate?.entryVersion === selected.version &&
    approvalCandidate.classId === selected.classId && approvalCandidate.courseVersionId === selectedClass.courseVersionId && approvalActive.length <= 1;
  function prepareApproval(withdraw: boolean) {
    if (busyRef.current || pending.current || !requireSession() || !approvalMatches || !approvalCandidate || !approvalCandidates || !approvalWithdrawals) return;
    try {
      let value: ApprovalAttempt;
      if (withdraw) {
        if (!approvalWithdrawal) return;
        value = { kind: "APPROVAL_WITHDRAWAL", value: createResultApprovalWithdrawalAttempt(approvalWithdrawal, approvalWithdrawals) };
      } else value = { kind: "APPROVAL", value: createResultApprovalAttempt(approvalCandidate, approvalCandidates) };
      pending.current = value; sent.current = false; setApprovalAttempt(value); setUnknown(false); setMessage("");
    } catch { setMessage(text.approvalLoadError); }
  }
  async function submitApproval(value: ApprovalAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const wasUnknown = sent.current, op = begin();
    let committed = false;
    const saved = value.kind === "APPROVAL" ? text.approvalSaved : text.approvalWithdrawalSaved;
    try {
      const token = csrf(); sent.current = true;
      const endpoint = value.kind === "APPROVAL" ? "approval" : "approval-withdrawal";
      const response = await request(`/entries/${value.value.entryId}/${endpoint}`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `manual-result-${endpoint}:${value.value.requestId}` },
        body: JSON.stringify(value.value.request) });
      if ([400, 404, 409, 413].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.approvalUnknown); return; }
        pending.current = undefined; sent.current = false; setApprovalAttempt(undefined); setUnknown(false); setMessage(text.approvalConflict); return;
      }
      if (!response.ok) throw new Error("Unknown APPROVAL outcome");
      const payload = await json(response, op);
      if (value.kind === "APPROVAL") parseResultApprovalResponse(payload, value.value, raceId);
      else parseResultApprovalWithdrawalResponse(payload, value.value, raceId);
      committed = true; pending.current = undefined; sent.current = false; setApprovalAttempt(undefined); setUnknown(false);
      setMessage(saved); await loadApprovalBasis(op, value.value.entryId); setEntryId(value.value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? `${saved} ${text.dnsAfterReadError}` : text.approvalUnknown); }
    } finally { finish(op); }
  }
  const dsqCandidate = dsqCandidates?.entries.find((row) => row.id === entryId);
  const dsqHistory = dsqWithdrawals?.entries.filter((row) => row.id === entryId) ?? [];
  const dsqActive = dsqHistory.filter((row) => row.state === "WITHDRAWABLE");
  const dsqWithdrawal = dsqActive.length === 1 ? dsqActive[0] : undefined;
  const dsqMatches = !!selected && !!selectedClass && !!data && dsqCandidates?.snapshotVersion === data.snapshotVersion &&
    dsqWithdrawals?.snapshotVersion === data.snapshotVersion && dsqCandidate?.entryVersion === selected.version &&
    dsqCandidate.classId === selected.classId && dsqCandidate.courseVersionId === selectedClass.courseVersionId && dsqActive.length <= 1;
  function prepareDsq(withdraw: boolean) {
    if (busyRef.current || pending.current || !requireSession() || !dsqMatches || !dsqCandidate || !dsqCandidates || !dsqWithdrawals) return;
    try {
      let value: DsqAttempt;
      if (withdraw) {
        if (!dsqWithdrawal) return;
        value = { kind: "DSQ_WITHDRAWAL", value: createResultDisqualificationWithdrawalAttempt(dsqWithdrawal, dsqWithdrawals) };
      } else value = { kind: "DSQ", value: createResultDisqualificationAttempt(dsqCandidate, dsqCandidates) };
      pending.current = value; sent.current = false; setDsqAttempt(value); setUnknown(false); setMessage("");
    } catch { setMessage(text.dsqLoadError); }
  }
  async function submitDsq(value: DsqAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const wasUnknown = sent.current, op = begin();
    let committed = false;
    const saved = value.kind === "DSQ" ? text.dsqSaved : text.dsqWithdrawalSaved;
    try {
      const token = csrf(); sent.current = true;
      const endpoint = value.kind === "DSQ" ? "disqualification" : "disqualification-withdrawal";
      const response = await request(`/entries/${value.value.entryId}/${endpoint}`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `manual-${endpoint}:${value.value.requestId}` },
        body: JSON.stringify(value.value.request) });
      if ([400, 404, 409, 413].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.dsqUnknown); return; }
        pending.current = undefined; sent.current = false; setDsqAttempt(undefined); setUnknown(false); setMessage(text.dsqConflict); return;
      }
      if (!response.ok) throw new Error("Unknown DSQ outcome");
      const payload = await json(response, op);
      if (value.kind === "DSQ") parseResultDisqualificationResponse(payload, value.value, raceId);
      else parseResultDisqualificationWithdrawalResponse(payload, value.value, raceId);
      committed = true; pending.current = undefined; sent.current = false; setDsqAttempt(undefined); setUnknown(false);
      setMessage(saved); await loadDsqBasis(op, value.value.entryId); setEntryId(value.value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? `${saved} ${text.dnsAfterReadError}` : text.dsqUnknown); }
    } finally { finish(op); }
  }
  const ntCandidate = ntCandidates?.entries.find((row) => row.id === entryId);
  const ntHistory = ntWithdrawals?.entries.filter((row) => row.id === entryId) ?? [];
  const ntActive = ntHistory.filter((row) => row.state === "WITHDRAWABLE");
  const ntWithdrawal = ntActive.length === 1 ? ntActive[0] : undefined;
  const ntMatches = !!selected && !!selectedClass && !!data && ntCandidates?.snapshotVersion === data.snapshotVersion &&
    ntWithdrawals?.snapshotVersion === data.snapshotVersion && ntCandidate?.entryVersion === selected.version &&
    ntCandidate.classId === selected.classId && ntCandidate.courseVersionId === selectedClass.courseVersionId && ntActive.length <= 1;
  function prepareNt(withdraw: boolean) {
    if (busyRef.current || pending.current || !requireSession() || !ntMatches || !ntCandidate || !ntCandidates || !ntWithdrawals) return;
    try {
      let value: NtAttempt;
      if (withdraw) {
        if (!ntWithdrawal) return;
        value = { kind: "NT_WITHDRAWAL", value: createWithoutTimingWithdrawalAttempt(ntWithdrawal, ntWithdrawals) };
      } else value = { kind: "NT", value: createWithoutTimingAttempt(ntCandidate, ntCandidates) };
      pending.current = value; sent.current = false; setNtAttempt(value); setUnknown(false); setMessage("");
    } catch { setMessage(text.ntLoadError); }
  }
  async function submitNt(value: NtAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const wasUnknown = sent.current, op = begin();
    let committed = false;
    const saved = value.kind === "NT" ? text.ntSaved : text.ntWithdrawalSaved;
    try {
      const token = csrf(); sent.current = true;
      const endpoint = value.kind === "NT" ? "without-timing" : "without-timing-withdrawal";
      const response = await request(`/entries/${value.value.entryId}/${endpoint}`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `${endpoint}:${value.value.requestId}` },
        body: JSON.stringify(value.value.request) });
      if ([400, 404, 409, 413].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.ntUnknown); return; }
        pending.current = undefined; sent.current = false; setNtAttempt(undefined); setUnknown(false); setMessage(text.ntConflict); return;
      }
      if (!response.ok) throw new Error("Unknown NT outcome");
      const payload = await json(response, op);
      if (value.kind === "NT") parseWithoutTimingResponse(payload, value.value, raceId);
      else parseWithoutTimingWithdrawalResponse(payload, value.value, raceId);
      committed = true; pending.current = undefined; sent.current = false; setNtAttempt(undefined); setUnknown(false);
      setMessage(saved); await loadNtBasis(op, value.value.entryId); setEntryId(value.value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? `${saved} ${text.dnsAfterReadError}` : text.ntUnknown); }
    } finally { finish(op); }
  }
  const oocCandidate = oocCandidates?.entries.find((row) => row.id === entryId);
  const oocHistory = oocWithdrawals?.entries.filter((row) => row.id === entryId) ?? [];
  const oocActive = oocHistory.filter((row) => row.state === "WITHDRAWABLE");
  const oocWithdrawal = oocActive.length === 1 ? oocActive[0] : undefined;
  const oocMatches = !!selected && !!selectedClass && !!data && oocCandidates?.snapshotVersion === data.snapshotVersion &&
    oocWithdrawals?.snapshotVersion === data.snapshotVersion && oocCandidate?.entryVersion === selected.version &&
    oocCandidate.classId === selected.classId && oocCandidate.courseVersionId === selectedClass.courseVersionId && oocActive.length <= 1;
  function prepareOoc(withdraw: boolean) {
    if (busyRef.current || pending.current || !requireSession() || !oocMatches || !oocCandidate || !oocCandidates || !oocWithdrawals) return;
    try {
      let value: OocAttempt;
      if (withdraw) {
        if (!oocWithdrawal) return;
        value = { kind: "OOC_WITHDRAWAL", value: createOutOfCompetitionWithdrawalAttempt(oocWithdrawal, oocWithdrawals) };
      } else value = { kind: "OOC", value: createOutOfCompetitionAttempt(oocCandidate, oocCandidates) };
      pending.current = value; sent.current = false; setOocAttempt(value); setUnknown(false); setMessage("");
    } catch { setMessage(text.oocLoadError); }
  }
  async function submitOoc(value: OocAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const wasUnknown = sent.current, op = begin();
    let committed = false;
    const saved = value.kind === "OOC" ? text.oocSaved : text.oocWithdrawalSaved;
    try {
      const token = csrf(); sent.current = true;
      const endpoint = value.kind === "OOC" ? "out-of-competition" : "out-of-competition-withdrawal";
      const response = await request(`/entries/${value.value.entryId}/${endpoint}`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `${endpoint}:${value.value.requestId}` },
        body: JSON.stringify(value.value.request) });
      if ([400, 404, 409, 413].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.oocUnknown); return; }
        pending.current = undefined; sent.current = false; setOocAttempt(undefined); setUnknown(false); setMessage(text.oocConflict); return;
      }
      if (!response.ok) throw new Error("Unknown OOC outcome");
      const payload = await json(response, op);
      if (value.kind === "OOC") parseOutOfCompetitionResponse(payload, value.value, raceId);
      else parseOutOfCompetitionWithdrawalResponse(payload, value.value, raceId);
      committed = true; pending.current = undefined; sent.current = false; setOocAttempt(undefined); setUnknown(false);
      setMessage(saved); await loadOocBasis(op, value.value.entryId); setEntryId(value.value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? `${saved} ${text.dnsAfterReadError}` : text.oocUnknown); }
    } finally { finish(op); }
  }
  const dnfCandidate = dnfCandidates?.entries.find((row) => row.id === entryId);
  const dnfHistory = dnfWithdrawals?.entries.filter((row) => row.id === entryId) ?? [];
  const dnfActive = dnfHistory.filter((row) => row.state === "WITHDRAWABLE");
  const dnfWithdrawal = dnfActive.length === 1 ? dnfActive[0] : undefined;
  const dnfMatches = !!selected && !!selectedClass && !!data && dnfCandidates?.snapshotVersion === data.snapshotVersion &&
    dnfWithdrawals?.snapshotVersion === data.snapshotVersion && dnfCandidate?.entryVersion === selected.version &&
    dnfCandidate.classId === selected.classId && dnfCandidate.courseVersionId === selectedClass.courseVersionId && dnfActive.length <= 1;
  function prepareDnf(withdraw: boolean) {
    if (busyRef.current || pending.current || !requireSession() || !dnfMatches || !dnfCandidate || !dnfCandidates || !dnfWithdrawals) return;
    try {
      let value: DnfAttempt;
      if (withdraw) {
        if (!dnfWithdrawal) return;
        value = { kind: "DNF_WITHDRAWAL", value: createDidNotFinishWithdrawalAttempt(dnfWithdrawal, dnfWithdrawals) };
      } else value = { kind: "DNF", value: createDidNotFinishAttempt(dnfCandidate, dnfCandidates) };
      pending.current = value; sent.current = false; setDnfAttempt(value); setUnknown(false); setMessage("");
    } catch { setMessage(text.dnfLoadError); }
  }
  async function submitDnf(value: DnfAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const wasUnknown = sent.current, op = begin();
    let committed = false;
    const saved = value.kind === "DNF" ? text.dnfSaved : text.dnfWithdrawalSaved;
    try {
      const token = csrf(); sent.current = true;
      const endpoint = value.kind === "DNF" ? "did-not-finish" : "did-not-finish-withdrawal";
      const response = await request(`/entries/${value.value.entryId}/${endpoint}`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `${endpoint}:${value.value.requestId}` },
        body: JSON.stringify(value.value.request) });
      if ([400, 404, 409, 413].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.dnfUnknown); return; }
        pending.current = undefined; sent.current = false; setDnfAttempt(undefined); setUnknown(false); setMessage(text.dnfConflict); return;
      }
      if (!response.ok) throw new Error("Unknown DNF outcome");
      const payload = await json(response, op);
      if (value.kind === "DNF") parseDidNotFinishResponse(payload, value.value, raceId);
      else parseDidNotFinishWithdrawalResponse(payload, value.value, raceId);
      committed = true; pending.current = undefined; sent.current = false; setDnfAttempt(undefined); setUnknown(false);
      setMessage(saved); await loadDnfBasis(op, value.value.entryId); setEntryId(value.value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? `${saved} ${text.dnsAfterReadError}` : text.dnfUnknown); }
    } finally { finish(op); }
  }
  const dnsCandidate = dnsCandidates?.entries.find((row) => row.id === entryId);
  const dnsWithdrawal = dnsWithdrawals?.entries.find((row) => row.id === entryId);
  const dnsMatches = !!selected && !!selectedClass && !!data && dnsCandidates?.snapshotVersion === data.snapshotVersion &&
    dnsWithdrawals?.snapshotVersion === data.snapshotVersion && dnsCandidate?.entryVersion === selected.version &&
    dnsCandidate.classId === selected.classId && dnsCandidate.courseVersionId === selectedClass.courseVersionId;
  function prepareDns(withdraw: boolean) {
    if (busyRef.current || pending.current || !requireSession() || !dnsMatches || !dnsCandidate || !dnsCandidates || !dnsWithdrawals) return;
    try {
      const value: DnsAttempt = withdraw
        ? { kind: "DNS_WITHDRAWAL", value: createDidNotStartWithdrawalAttempt(dnsWithdrawal!, dnsWithdrawals) }
        : { kind: "DNS", value: createDidNotStartAttempt(dnsCandidate, dnsCandidates) };
      pending.current = value; sent.current = false; setDnsAttempt(value); setUnknown(false); setMessage("");
    } catch { setMessage(text.dnsLoadError); }
  }
  async function submitDns(value: DnsAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current;
    let committed = false;
    const saved = value.kind === "DNS" ? text.dnsSaved : text.dnsWithdrawalSaved;
    try {
      const token = csrf(); sent.current = true;
      const endpoint = value.kind === "DNS" ? "did-not-start" : "did-not-start-withdrawal";
      const response = await request(`/entries/${value.value.entryId}/${endpoint}`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `${endpoint}:${value.value.requestId}` },
        body: JSON.stringify(value.kind === "DNS" ? didNotStartBody(value.value) : value.value.request) });
      if ([400, 404, 409, 413].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.dnsUnknown); return; }
        pending.current = undefined; sent.current = false; setDnsAttempt(undefined); setUnknown(false); setMessage(text.dnsConflict); return;
      }
      if (!response.ok) throw new Error("Unknown DNS outcome");
      const payload = await json(response, op);
      if (value.kind === "DNS") parseDidNotStartResponse(payload, value.value, raceId);
      else parseDidNotStartWithdrawalResponse(payload, value.value, raceId);
      committed = true; pending.current = undefined; sent.current = false; setDnsAttempt(undefined); setUnknown(false);
      setMessage(saved); await loadDnsBasis(op, value.value.entryId); setEntryId(value.value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? `${saved} ${text.dnsAfterReadError}` : text.dnsUnknown); }
    } finally { finish(op); }
  }
  async function prepareRegistration(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || pending.current || !requireSession()) return;
    if (!data || !target || targetFull) { setMessage(text.registrationInvalid); return; }
    const selectedSlot = registrationStartSlots?.targetClassId === target.id && registrationStartSlots.plan.status === "AVAILABLE"
      ? registrationStartSlots.plan.slots.find(slot => slot.fixedStartTime === selectedRegistrationStartSlot) : undefined;
    const parsed = entryRegistrationRequestSchema.safeParse({ formatVersion: 1, classId: target.id,
      expectedCourseVersionId: target.courseVersionId, expectedStartRule: target.startRule, expectedSnapshotVersion: data.snapshotVersion,
      givenName, familyName, organisationName: organisationName.trim() || null, cardNumber: newCard.trim() || null,
      fixedStartTime: target.startRule === "FIXED" ? selectedSlot?.fixedStartTime ?? parseStartTimeFields(startDate, startClock, startOffset) : null,
      expectedTargetCapacityVersion: selectedSlot ? registrationStartSlots?.targetCapacityVersion : undefined,
      assignedStartSlot: selectedSlot && registrationStartSlots?.plan.status === "AVAILABLE" ? {
        drawRequestId: registrationStartSlots.plan.drawRequestId, sourceHash: registrationStartSlots.plan.sourceHash,
        fixedStartTime: selectedSlot.fixedStartTime } : null });
    if (!parsed.success) { setMessage(text.registrationInvalid); return; }
    const frozen = { kind: "REGISTRATION" as const, id: crypto.randomUUID(), className: target.name, timeZone: data.timeZone, request: parsed.data };
    const op = begin(); setConfirmDistinctPerson(false); setMessage(text.registrationSearching);
    try {
      const response = await request("/registration-candidates", op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf() },
        body: JSON.stringify({ formatVersion: 1, expectedSnapshotVersion: frozen.request.expectedSnapshotVersion,
          givenName: frozen.request.givenName, familyName: frozen.request.familyName, cardNumber: frozen.request.cardNumber }) });
      if (!response.ok) throw new Error("Registration candidate search failed");
      const candidates = entryRegistrationCandidatesResponseSchema.parse(await json(response, op));
      if (candidates.raceId !== raceId || candidates.snapshotVersion !== frozen.request.expectedSnapshotVersion) throw new Error("Registration candidate scope mismatch");
      const value: RegistrationAttempt = { ...frozen, candidates };
      pending.current = value; sent.current = false; setRegistrationAttempt(value); setUnknown(false); setMessage("");
    } catch { if (current(op)) setMessage(text.registrationSearchError); }
    finally { finish(op); }
  }
  async function submitRegistration(value: RegistrationAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    if (!sent.current && (value.candidates.candidates.some((row) => row.reasons.includes("CARD_ALREADY_ASSIGNED")) ||
      (value.candidates.candidates.some((row) => row.reasons.includes("SAME_NAME")) && !confirmDistinctPerson))) return;
    const op = begin(); const wasUnknown = sent.current;
    let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request("/registration", op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `entry-registration:${value.id}` },
        body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.registrationUnknown); return; }
        pending.current = undefined; sent.current = false; setRegistrationAttempt(undefined); setUnknown(false);
        setData(undefined); setMessage(text.registrationConflict); return;
      }
      if (!response.ok) throw new Error("Unknown registration outcome");
      const receipt = parseRegistrationReceipt(await json(response, op), raceId, value);
      committed = true; pending.current = undefined; sent.current = false; setRegistrationAttempt(undefined); setUnknown(false);
      setData(undefined); setGivenName(""); setFamilyName(""); setOrganisationName(""); setNewCard(""); setClassId("");
      setStartDate(""); setStartClock(""); setStartOffset(""); setQuery(""); setResultState("ALL");
      setPage(0); setAction("INFO"); setEntryId(receipt.entryId);
      setMessage(text.registrationSaved); await load(op, receipt.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.registrationSavedLoadError : text.registrationUnknown); }
    } finally { finish(op); }
  }
  function selectRegistrationCandidate(id: string) {
    if (busyRef.current || sent.current || unknown || !registrationAttempt || pending.current !== registrationAttempt || !requireSession()) return;
    const candidate = registrationAttempt.candidates.candidates.find((row) => row.entryId === id);
    if (!candidate || !data?.entries.some((row) => row.id === id && row.classId === candidate.classId)) return;
    pending.current = undefined; setRegistrationAttempt(undefined); setConfirmDistinctPerson(false);
    select(id);
  }
  const classesById = new Map(data?.classes.map((row) => [row.id, row]));
  const classNames = new Map(data?.classes.map((row) => [row.id, row.name]));
  const olderResultCount = data?.entries.filter((entry) => entry.resultFreshness === "OLDER_SNAPSHOT").length;
  const rentalEntries = data?.entries.filter((entry) => entry.activeAssignment?.isRental === true &&
    !entry.activeAssignment.rentalReturned) ?? [];
  const rentalCardCount = data ? rentalEntries.length : undefined;
  const paymentAttentionCount = data?.entries.filter((entry) => needsPaymentAttention(entry.paymentStatus)).length;
  const freeStartClassCount = data?.classes.filter((raceClass) => raceClass.startRule === "PUNCH").length;
  const fixedStartClassCount = data?.classes.filter((raceClass) => raceClass.startRule === "FIXED").length;
  const matches = filterAdministratorRoster(data?.entries ?? [], classNames, {
    query, olderResultsOnly, rentalCardsOnly, paymentAttentionOnly, resultState,
  }).filter(entry => (!rosterClassId || entry.classId === rosterClassId) &&
    (!missingFixedStartOnly || missingFixedStartTime(entry, classesById.get(entry.classId)?.startRule)));
  const filtered = orderAdministratorRoster(matches, classesById, rosterOrder);
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1), currentPage = Math.min(page, lastPage);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const selectedIndex = selected ? filtered.findIndex(entry => entry.id === selected.id) : -1;
  const selectedPage = selectedIndex < 0 ? -1 : Math.floor(selectedIndex / pageSize);
  const correctionPending = neutralizationPending || finishCorrectionPending || startCorrectionPending ||
    startWithdrawalPending || finishWithdrawalPending;
  const disabled = busy || participantActionPending || correctionPending || operatorAccessPending || !!startRuleAttempt || !!reviewAttempt || !!startCorrection || !!returnAttempt || !!publicationAttempt || !!drawAttempt || !!finalizationAttempt || !!attempt || !!capacityAttempt || !!cardAttempt || !!rentalAttempt || !!rentalReturnAttempt || !!rentalReuseAttempt || !!paymentStatusAttempt || !!timeAttempt || !!recalculationAttempt || !!identityAttempt || !!registrationAttempt || !!dnsAttempt || !!dnfAttempt || !!ntAttempt || !!oocAttempt || !!dsqAttempt || !!approvalAttempt || !!courseResultBearingAttempt || !!unknownReadoutAttempt || !!manualClassReview || !!manualClassAttempt || !!classNameReview || !!classNameAttempt;
  const workflowLocked = disabled || participantActionPending || !!pending.current || !!reviewCandidate ||
    !!courseClassReview || !!courseClassAttempt || !!manualClassReview || !!manualClassAttempt || !!classNameReview || !!classNameAttempt || !!courseRelinkPreview || !!courseRelinkAttempt || !!startRulePreview ||
    !!courseResultBearingCandidate || !!courseResultBearingAttempt || !!shortenedCourseCandidate ||
    !!shortenedCourseAttempt || !!classRecalculationAttempt;
  const manualClassTargets = data?.classes.filter((row, index, rows) =>
    rows.findIndex(candidate => candidate.courseVersionId === row.courseVersionId) === index) ?? [];
  const forestAttentionFresh = !!forestData && !forestStale;
  const unknownReadoutAttentionFresh = !!unknownReadoutCandidate && !!unknownReadoutFetchedAt && !unknownReadoutAttentionStale;
  const forestAttentionCounts = forestAttentionFresh ? {
    conflict: forestData.entries.filter(row => row.forestState === "CONFLICT").length,
    startedNoReturn: forestData.entries.filter(row => row.forestState === "STARTED_NO_RETURN").length,
    unconfirmed: forestData.entries.filter(row => row.forestState === "UNCONFIRMED").length
  } : undefined;
  function revealSelected() {
    if (workflowLocked || !selected || !data) return;
    const outsideFilters = selectedIndex < 0;
    const rows = outsideFilters ? orderAdministratorRoster(data.entries, classesById, rosterOrder) : filtered;
    const index = rows.findIndex(entry => entry.id === selected.id);
    if (index < 0) return;
    flushSync(() => {
      if (outsideFilters) {
        setQuery(""); setRosterClassId(""); setOlderResultsOnly(false); setRentalCardsOnly(false);
        setPaymentAttentionOnly(false); setMissingFixedStartOnly(false); setResultState("ALL");
      }
      setPage(Math.floor(index / pageSize));
    });
    showMobilePanel("LIST");
    requestAnimationFrame(() => listPanel.current?.querySelector('button[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  }
  function navigateParticipantSequence(offset: -1 | 1) {
    if (workflowLocked || selectedIndex < 0) return;
    const nextIndex = selectedIndex + offset;
    const next = filtered[nextIndex];
    if (!next) return;
    setPage(Math.floor(nextIndex / pageSize));
    select(next.id);
  }
  const eventsLabel = developmentAutoLogin ? navigationText.backToLocalEvents : navigationText.backToEvents;
  const eventsLink = workflowLocked
    ? <span className={styles.backUnavailable} aria-disabled="true" title={navigationText.backLocked}>{eventsLabel}</span>
    : <Link className={styles.backToEvents} href={developmentAutoLogin ? "/" : "/organizer"} prefetch={false}>{eventsLabel}</Link>;
  const startRuleClass = data?.classes.find(row => row.id === startRuleClassId);
  const classNameSelected = data?.classes.find(row => row.id === classNameClassId);
  const finalizationCandidate = finalizationScope === "RACE" ? finalizationCandidates?.race
    : finalizationCandidates?.classes.find(row => row.classId === finalizationScope);
  function navigateWorkflow(mode: WorkflowMode) {
    if (workflowLocked) return;
    setSelectedCourseTarget(undefined);
    if (mode !== "BEFORE") setCourseWarningClassId("");
    setWorkflowMode(mode);
    if (mode === "DURING" && duringArea === "OVERVIEW") void loadRaceDayAttention();
  }
  function openAttentionPanel(target: "FOREST" | "CONFLICT" | "STARTED_NO_RETURN" | "UNCONFIRMED" | "READOUT") {
    if (workflowLocked) return;
    const panel = target === "READOUT" ? unknownReadoutPanel.current : forestPanel.current;
    if (!panel) return;
    if (target !== "READOUT") {
      setForestClass(""); setForestQuery(""); setForestOpen(true);
    }
    panel.open = true;
    requestAnimationFrame(() => {
      const group = target === "FOREST" || target === "READOUT" ? undefined : panel.querySelector(`[data-forest-group="${target}"]`);
      panel.querySelector("summary")?.focus();
      (group ?? panel).scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }
  function followUp(filter: "OLDER_RESULTS" | "RENTAL_CARDS" | "PAYMENT") {
    if (workflowLocked) return;
    setQuery(""); setPage(0); setRosterClassId("");
    setOlderResultsOnly(filter === "OLDER_RESULTS");
    setRentalCardsOnly(filter === "RENTAL_CARDS");
    setPaymentAttentionOnly(filter === "PAYMENT");
    setResultState("ALL");
    setMissingFixedStartOnly(false);
    flushSync(() => setWorkflowMode("PARTICIPANTS"));
    showMobilePanel("LIST");
  }
  function openMissingFixedStart(classId: string) {
    if (workflowLocked) return;
    setCourseWarningClassId("");
    setQuery(""); setPage(0); setRosterClassId(classId);
    setOlderResultsOnly(false); setRentalCardsOnly(false); setPaymentAttentionOnly(false); setResultState("ALL");
    setMissingFixedStartOnly(true);
    flushSync(() => setWorkflowMode("PARTICIPANTS"));
    showMobilePanel("LIST");
    listPanel.current?.focus();
  }
  function openClassParticipants(classId: string) {
    if (workflowLocked || data?.classes.filter((row) => row.id === classId).length !== 1) return;
    setEntryId(""); setClassId(""); setAction("INFO"); setEffectiveResult(undefined); setEffectiveResultError(false);
    setQuery(""); setPage(0); setRosterClassId(classId);
    setOlderResultsOnly(false); setRentalCardsOnly(false); setPaymentAttentionOnly(false);
    setMissingFixedStartOnly(false); setResultState("ALL");
    setSelectedCourseTarget(undefined); setCourseWarningClassId("");
    flushSync(() => setWorkflowMode("PARTICIPANTS"));
    showMobilePanel("LIST");
    listPanel.current?.focus();
  }
  function openClassSetup(classId: string, fromCourse = false) {
    const raceClass = data?.classes.find(row => row.id === classId);
    if (workflowLocked || !raceClass) return;
    if (classNameClassId !== classId) {
      if (classNamePanel.current) classNamePanel.current.open = false;
      setClassNameCandidate(undefined); setClassNameInput(""); setClassNameReview(undefined); setClassNameError("");
    }
    setClassNameClassId(classId);
    setCapacityClassId(classId);
    setCapacityInput(raceClass.maxEntries === null ? "" : String(raceClass.maxEntries));
    setStartRuleClassId(classId);
    setStartRulePreview(undefined); setStartRuleReason(""); setStartRuleConfirmed(false);
    setRecalculationCandidates(undefined); setMessage("");
    flushSync(() => {
      setCourseWarningClassId(classId);
      setCourseSelectionReason(fromCourse ? "ASSIGNED" : "DIRECT");
      setWorkflowMode("BEFORE"); setPreparationArea("CLASSES");
    });
  }
  function openAssignedClass(classId: string) {
    openClassSetup(classId, true);
  }
  function openCourseWarningClass(classId: string) {
    if (workflowLocked || !data?.classes.some((row) => row.id === classId)) return;
    flushSync(() => {
      setCourseWarningClassId(classId); setCourseSelectionReason("MISSING");
      setWorkflowMode("BEFORE"); setPreparationArea("CLASSES");
    });
  }
  function returnToCourses() {
    if (workflowLocked) return;
    setSelectedCourseTarget(undefined);
    flushSync(() => { setCourseWarningClassId(""); setPreparationArea("COURSES"); });
    (window.matchMedia("(max-width: 720px)").matches ? coursesNavigationSelect : coursesNavigationButton).current?.focus();
  }
  function openPreparationStep(area: PreparationStepArea) {
    if (workflowLocked) return;
    setCourseWarningClassId("");
    setSelectedCourseTarget(undefined);
    flushSync(() => setPreparationArea(area));
    const target = window.matchMedia("(max-width: 720px)").matches
      ? coursesNavigationSelect.current
      : preparationNavigation.current?.querySelector<HTMLButtonElement>(`[data-preparation-area="${area}"]`);
    target?.focus();
  }
  function openCourseTarget(courseVersionId: string) {
    if (workflowLocked || !data) return;
    flushSync(() => {
      setCourseWarningClassId("");
      setSelectedCourseTarget({ raceId, snapshotVersion: data.snapshotVersion, courseVersionId });
      setWorkflowMode("BEFORE");
      setPreparationArea("COURSES");
    });
  }
  function openAssignedCourse(courseVersionId: string) {
    if (!selectedClass || selectedClass.courseVersionId !== courseVersionId) return;
    openCourseTarget(courseVersionId);
  }
  function openClassCourse(classId: string) {
    const matchingClasses = data?.classes.filter((row) => row.id === classId) ?? [];
    if (matchingClasses.length !== 1) return;
    openCourseTarget(matchingClasses[0]!.courseVersionId);
  }
  function printPrivate(target: "FOREST" | "RENTAL") {
    if (busyRef.current || pending.current || !requireSession() ||
      (target === "FOREST" ? !forestData : !data || rentalEntries.length === 0)) return;
    flushSync(() => setPrintTarget(target));
    window.print();
  }
  return <div className={styles.workspace} data-print-target={printTarget} data-authenticated={authenticated}>
    {developmentAutoLogin && !authenticated && <p className={styles.workflowHelp}>{navigationText.developmentAccess}</p>}
    {!authenticated && !developmentAutoLogin && <p>{text.introduction}</p>}
    <p className={styles.status} role="status" aria-live="polite">{message}</p>
    {!authenticated && <form className={`${styles.panel} ${styles.login}`} onSubmit={(event) => void login(event)}>
      {!developmentAutoLogin && <p>{text.accountLoginHelp} <Link href="/organizer" prefetch={false}>{text.accountLoginLink}</Link></p>}
      <button disabled={busy}>{developmentAutoLogin ? navigationText.openDevelopmentRace : text.login}</button>
    </form>}
    {authenticated && <>
      <div className={styles.workspaceChrome}>
        {data && <div className={styles.raceIdentity}>
          <div><div className={styles.identityTitle}>
            {eventsLink}
            <span className={styles.identityDivider} aria-hidden="true">›</span><h2>{data.eventName}</h2>
            {developmentAutoLogin && <span className={styles.developmentBadge} title={navigationText.developmentAccess}>{navigationText.developmentBadge}</span>}
          </div><p>{data.raceName} · <time dateTime={data.raceDate}>{data.raceDate}</time> · {data.timeZone}</p></div>
          <div className={styles.identityActions}>
            <button type="button" className="secondary" disabled={workflowLocked} onClick={() => void refresh()}>{text.refreshOverview}</button>
            <button className="secondary" disabled={workflowLocked} onClick={() => void logout()}>{text.logout}</button>
          </div>
        </div>}
        <div className={styles.toolbar}>
          {data && <section className={styles.statusStrip} aria-label={text.statusHeading}>
            <dl className={styles.statusMetrics}>
              <div><dt>{text.participants}</dt><dd>{data.entries.length}</dd></div>
              <div><dt>{text.classes}</dt><dd>{data.classes.length}</dd></div>
              <div><dt>{text.statusFreeStartClasses}</dt><dd>{freeStartClassCount}</dd></div>
              <div><dt>{text.statusFixedStartClasses}</dt><dd>{fixedStartClassCount}</dd></div>
              <div><dt>{text.statusOlderResults}</dt><dd>{olderResultCount}</dd></div>
              <div><dt>{text.statusOutstandingRentals}</dt><dd>{rentalCardCount}</dd></div>
            </dl>
            <p className={styles.statusBasis}>{text.statusBasis(data.snapshotVersion,
              formatStartListTime(data.generatedAt, data.timeZone))}</p>
          </section>}
          {!data && <div className={styles.identityActions}>
            {eventsLink}
            <button className="secondary" disabled={workflowLocked} onClick={() => void refresh()}>{text.refreshOverview}</button>
            <button className="secondary" disabled={workflowLocked} onClick={() => void logout()}>{text.logout}</button>
          </div>}
        </div>
      </div>
      <nav className={styles.workflowNavigation} aria-label={text.workflowNavigation}>
        {(["OVERVIEW", "BEFORE", "PARTICIPANTS", "DURING", "AFTER"] as const).map(mode => {
          const labels = { OVERVIEW: text.workflowOverview, PARTICIPANTS: text.workflowParticipants, BEFORE: text.workflowBefore,
            DURING: text.workflowDuring, AFTER: text.workflowAfter };
          const controls = { OVERVIEW: `workflow-${raceId}-overview`, PARTICIPANTS: `workflow-${raceId}-participants`, BEFORE: `workflow-${raceId}-before`,
            DURING: `workflow-${raceId}-during`, AFTER: `workflow-${raceId}-after` };
          return <button key={mode} type="button" className="secondary" aria-pressed={workflowMode === mode}
            aria-controls={controls[mode]} disabled={workflowLocked} onClick={() => navigateWorkflow(mode)}>{labels[mode]}</button>;
        })}
      </nav>
      <nav className={styles.mobileWorkflowNavigation} aria-label={text.workflowNavigation}>
        <label>{text.workflowNavigation}
          <select value={workflowMode} disabled={workflowLocked} onChange={event => navigateWorkflow(event.target.value as WorkflowMode)}>
            <option value="OVERVIEW">{text.workflowOverview}</option>
            <option value="BEFORE">{text.workflowBefore}</option>
            <option value="PARTICIPANTS">{text.workflowParticipants}</option>
            <option value="DURING">{text.workflowDuring}</option>
            <option value="AFTER">{text.workflowAfter}</option>
          </select>
        </label>
      </nav>
      {workflowMode === "BEFORE" && <nav ref={preparationNavigation} className={styles.subNavigation} aria-label={navigationText.preparationNavigation}>
        {(Object.keys(navigationText.preparation) as PreparationArea[]).map(area => <button key={area} type="button"
          ref={area === "COURSES" ? coursesNavigationButton : undefined}
          data-preparation-area={area}
          className={`${styles.preparationNavigationButton} secondary`} aria-label={navigationText.preparation[area]}
          aria-pressed={preparationArea === area} disabled={workflowLocked} onClick={() => { setCourseWarningClassId(""); setSelectedCourseTarget(undefined); setPreparationArea(area); }}>
          <span className={styles.preparationLabelDesktop} aria-hidden="true">{navigationText.preparation[area]}</span>
          <span className={styles.preparationLabelMobile} aria-hidden="true">{navigationText.preparationMobile[area]}</span>
        </button>)}
      </nav>}
      {workflowMode === "BEFORE" && <nav className={styles.mobileSubNavigation} aria-label={navigationText.preparationNavigation}>
        <label>{navigationText.preparationNavigation}
          <select ref={coursesNavigationSelect} value={preparationArea} disabled={workflowLocked}
            onChange={event => { setCourseWarningClassId(""); setSelectedCourseTarget(undefined); setPreparationArea(event.target.value as PreparationArea); }}>
            {(Object.keys(navigationText.preparation) as PreparationArea[]).map(area =>
              <option key={area} value={area}>{navigationText.preparation[area]}</option>)}
          </select>
        </label>
      </nav>}
      {workflowMode === "DURING" && <nav className={styles.subNavigation} aria-label={navigationText.duringNavigation}>
        {(Object.keys(navigationText.during) as DuringArea[]).map(area => <button key={area} type="button"
          className={`${styles.duringNavigationButton} secondary`} aria-label={navigationText.during[area]}
          aria-pressed={duringArea === area} disabled={workflowLocked}
          onClick={() => { setDuringArea(area); if (area === "OVERVIEW") void loadRaceDayAttention(); }}>
          <span className={styles.duringLabelDesktop} aria-hidden="true">{navigationText.during[area]}</span>
          <span className={styles.duringLabelMobile} aria-hidden="true">{navigationText.duringMobile[area]}</span>
        </button>)}
      </nav>}
      {workflowMode === "DURING" && <nav className={styles.mobileSubNavigation} aria-label={navigationText.duringNavigation}>
        <label>{navigationText.duringNavigation}
          <select value={duringArea} disabled={workflowLocked} onChange={event => {
            const area = event.target.value as DuringArea;
            setDuringArea(area);
            if (area === "OVERVIEW") void loadRaceDayAttention();
          }}>
            {(Object.keys(navigationText.during) as DuringArea[]).map(area =>
              <option key={area} value={area}>{navigationText.during[area]}</option>)}
          </select>
        </label>
      </nav>}
      {workflowLocked && <p className={styles.workflowHelp} role="status">{text.workflowHelp}</p>}
      <section className={styles.workflowGroup} id={`workflow-${raceId}-overview`} aria-label={text.workflowOverview}
        hidden={workflowMode !== "OVERVIEW"}>
        {data && <RaceWorkspaceOverview data={data} disabled={workflowLocked} onNavigate={navigateWorkflow}
          onFollowUp={followUp} onMissingFixedStart={openMissingFixedStart} onOpenClass={openClassSetup} />}
        {!workflowLocked && <nav className={styles.contextLinks} aria-label={text.overviewLinks}>
          <a href={`/admin/${raceId}/readout`}>{text.readoutLink}</a>
          <Link href={`/results/${raceId}`}>{text.publicResultsLink}</Link>
          <Link href={`/starts/${raceId}`}>{publicationText.publicLink}</Link>
        </nav>}
      </section>
      <section className={styles.workflowGroup} id={`workflow-${raceId}-before`} aria-label={navigationText.preparation.OVERVIEW}
        hidden={workflowMode !== "BEFORE" || preparationArea !== "OVERVIEW"}>
        {data && <RacePreparationGuide data={data} disabled={workflowLocked} onOpenArea={openPreparationStep}
          onMissingFixedStart={() => openMissingFixedStart("")} />}
      </section>
      <section className={styles.workflowGroup} aria-label={navigationText.preparation.COURSES}
        hidden={workflowMode !== "BEFORE" || preparationArea !== "COURSES"}>
      {workflowMode === "BEFORE" && preparationArea === "COURSES" && data &&
        <RaceCourseOverview raceId={raceId} classes={data.classes} disabled={workflowLocked} onOpenClass={openCourseWarningClass}
          onOpenAssignedClass={openAssignedClass}
          selectedCourseVersionId={selectedCourseTarget?.raceId === raceId && selectedCourseTarget.snapshotVersion === data.snapshotVersion
            ? selectedCourseTarget.courseVersionId : undefined} />}
      <details className={styles.courseClassPanel}>
        <summary>{text.courseClassTitle}</summary>
        <form className={styles.panel} onSubmit={inspectCourseClass}>
          <p>{text.courseClassHelp}</p>
          <div className={styles.courseClassFields}>
            <label>{text.courseName}<input value={courseName} maxLength={160} disabled={busy || !!courseClassAttempt}
              onChange={event => setCourseName(event.target.value)} required /></label>
            <label>{text.courseClassName}<input value={courseClassName} maxLength={160} disabled={busy || !!courseClassAttempt}
              onChange={event => setCourseClassName(event.target.value)} required /></label>
            <label>{text.courseStartRule}<select value={courseStartRule} disabled={busy || !!courseClassAttempt}
              onChange={event => setCourseStartRule(event.target.value as CourseClassRequest["startRule"])}>
              <option value="PUNCH">{text.courseFreeStart}</option><option value="FIXED">{text.courseFixedStart}</option>
            </select></label>
          </div>
          <label>{text.courseControls}<textarea value={courseControls} maxLength={12000} disabled={busy || !!courseClassAttempt}
            aria-describedby="course-class-controls-help" onChange={event => setCourseControls(event.target.value)} required rows={2} /></label>
          <p id="course-class-controls-help">{text.courseControlsHelp}</p>
          {courseClassError && <p className={styles.warning} role="alert">{courseClassError}</p>}
          {!courseClassReview && !courseClassAttempt && <button type="submit" disabled={busy}>{text.courseClassInspect}</button>}
          {courseClassReview && !courseClassAttempt && <section className={styles.review} role="alert" aria-live="polite">
            <h2>{text.courseClassReview}</h2>
            <p><strong>{text.courseName}:</strong> {courseClassReview.courseName}</p>
            <p><strong>{text.courseClassName}:</strong> {courseClassReview.className}</p>
            <p><strong>{text.courseControls}:</strong> {courseClassReview.controlCodes.join(" → ")}</p>
            <p><strong>{text.courseStartRule}:</strong> {courseClassReview.startRule === "PUNCH" ? text.courseFreeStart : text.courseFixedStart}</p>
            {courseClassReview.startRule === "FIXED" && <p>{text.courseFixedStartHelp}</p>}
            <p>{text.courseClassNotSaved}</p>
            <div className={styles.actions}>
              <button type="button" disabled={busy} onClick={() => {
                const value = { kind: "COURSE_CLASS" as const, request: courseClassReview };
                pending.current = value; sent.current = false; setCourseClassAttempt(value); void submitCourseClass(value);
              }}>{text.courseClassConfirm}</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => setCourseClassReview(undefined)}>{text.courseClassEdit}</button>
            </div>
          </section>}
          {courseClassAttempt && <div className={styles.actions}>
            <button type="button" disabled={busy} onClick={() => void submitCourseClass(courseClassAttempt)}>{text.courseClassConfirm}</button>
          </div>}
        </form>
      </details>
      <details className={styles.courseClassPanel}>
        <summary>{text.courseRelinkTitle}</summary>
        <form className={styles.panel} onSubmit={inspectCourseVersionRelink}>
          <p>{text.courseRelinkHelp}</p>
          <label>{text.courseRelinkClass}<select value={courseRelinkClassId} disabled={busy || !!courseRelinkAttempt}
            onChange={event => { setCourseRelinkClassId(event.target.value); setCourseRelinkPreview(undefined); setCourseRelinkError(""); }}>
            <option value="">{text.chooseClass}</option>
            {data?.classes.map(raceClass => <option key={raceClass.id} value={raceClass.id}>{raceClass.name}</option>)}
          </select></label>
          {!courseRelinkPreview && !courseRelinkAttempt && <button type="button" disabled={busy || !courseRelinkClassId}
            onClick={() => void loadCourseVersionRelinkPreview()}>{text.courseRelinkLoad}</button>}
          {courseRelinkPreview && !courseRelinkAttempt && <>
            <div className={styles.courseRelinkSummary}>
              <p><strong>{text.courseRelinkCourse}:</strong> {courseRelinkPreview.courseName}</p>
              <p><strong>{text.raceClass}:</strong> {courseRelinkPreview.className}</p>
              <p><strong>{text.courseRelinkVersion}:</strong> {courseRelinkPreview.classCourseVersion}</p>
              <p><strong>{text.courseRelinkEntries}:</strong> {courseRelinkPreview.entryCount} · <strong>{text.courseRelinkResults}:</strong> {courseRelinkPreview.resultRevisionCount}</p>
              <p><strong>{text.courseControls}:</strong> {courseRelinkPreview.controlCodes.join(" → ")}</p>
            </div>
            {courseRelinkPreview.resultRevisionCount > 0 && <p className={styles.warning} role="alert">{text.courseRelinkBlocked}</p>}
            <label>{text.courseRelinkControls}<textarea value={courseRelinkControls} maxLength={12000} disabled={busy}
              aria-describedby="course-relink-controls-help" onChange={event => setCourseRelinkControls(event.target.value)} required rows={2} /></label>
            <p id="course-relink-controls-help">{text.courseRelinkControlsHelp}</p>
            <label className={styles.confirmPerson}><input type="checkbox" checked={courseRelinkConfirmed} disabled={busy || !courseRelinkPreview.canRelink}
              onChange={event => setCourseRelinkConfirmed(event.target.checked)} />{text.courseRelinkAcknowledge}</label>
            {courseRelinkError && <p className={styles.warning} role="alert">{courseRelinkError}</p>}
            <button type="submit" disabled={busy || !courseRelinkPreview.canRelink || !courseRelinkConfirmed}>{text.courseRelinkInspect}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => { setCourseRelinkPreview(undefined); setCourseRelinkConfirmed(false); }}>{navigationText.closeCoursePreview}</button>
          </>}
          {courseRelinkAttempt && <section className={styles.review} role="alert" aria-live="polite">
            <h2>{text.courseRelinkReview}</h2>
            <p><strong>{text.raceClass}:</strong> {courseRelinkAttempt.preview.className}</p>
            <p><strong>{text.courseRelinkCourse}:</strong> {courseRelinkAttempt.preview.courseName} · {text.courseRelinkVersion} {courseRelinkAttempt.preview.classCourseVersion} → {courseRelinkAttempt.preview.classCourseVersion + 1}</p>
            <p><strong>{text.courseRelinkControls}:</strong> {courseRelinkAttempt.request.controlCodes.join(" → ")}</p>
            <p>{text.courseRelinkNotSaved}</p>
            <div className={styles.actions}>
              <button type="button" disabled={busy} onClick={() => void submitCourseVersionRelink(courseRelinkAttempt)}>{text.courseRelinkConfirm}</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; setCourseRelinkAttempt(undefined); }}>{text.courseRelinkEdit}</button>
            </div>
            {courseRelinkError && <p className={styles.warning} role="alert">{courseRelinkError}</p>}
          </section>}
        </form>
      </details>
      <details className={styles.courseClassPanel}>
        <summary>{text.courseResultImpactTitle}</summary>
        <section className={styles.panel} aria-live="polite">
          <p>{text.courseResultImpactHelp}</p>
          <label>{text.courseResultImpactClass}<select value={courseResultImpactClassId} disabled={busy}
            onChange={event => { setCourseResultImpactClassId(event.target.value); setCourseResultImpact(undefined); setCourseResultImpactError(""); }}>
            <option value="">{text.chooseClass}</option>
            {data?.classes.map(raceClass => <option key={raceClass.id} value={raceClass.id}>{raceClass.name}</option>)}
          </select></label>
          {!courseResultImpact && <button type="button" disabled={busy || !courseResultImpactClassId}
            onClick={() => void loadCourseResultImpact()}>{text.courseResultImpactLoad}</button>}
          {courseResultImpact && <>
            <div className={styles.courseRelinkSummary}>
              <p><strong>{text.courseRelinkCourse}:</strong> {courseResultImpact.course.name} · {text.courseRelinkVersion} {courseResultImpact.course.currentVersion}</p>
              <p><strong>{text.raceClass}:</strong> {courseResultImpact.className}</p>
              <p><strong>{text.courseControls}:</strong> {courseResultImpact.course.controlCodes.join(" → ")}</p>
              <p><strong>{text.courseResultImpactEntries}:</strong> {courseResultImpact.totals.entryCount} · <strong>{text.courseResultImpactEntriesWithResults}:</strong> {courseResultImpact.totals.entriesWithResults} · <strong>{text.courseResultImpactHistorical}:</strong> {courseResultImpact.totals.historicalResultRevisions}</p>
            </div>
            <p className={styles.warning}>{text.courseResultImpactNotSaved}</p>
            {courseResultImpact.entries.length === 0 ? <p>{text.courseResultImpactNoResults}</p> : <>
              <h2>{text.courseResultImpactLatest}</h2>
              <div className={styles.tableScroll}><table className={styles.table}>
                <thead><tr><th>{text.participants}</th><th>{text.courseResultImpactRevision}</th><th>{text.courseResultImpactStatus}</th><th>{text.courseResultImpactManualDecision}</th></tr></thead>
                <tbody>{courseResultImpact.entries.map(entry => <tr key={entry.entryId}>
                  <td>{entry.displayName}</td>
                  <td>{entry.latestResultRevision.revision} · {entry.latestResultRevision.published ? text.courseResultImpactPublished : text.courseResultImpactNotPublished}</td>
                  <td>{entry.latestResultRevision.status}</td>
                  <td>{entry.latestResultRevision.effectiveManualDecision}</td>
                </tr>)}</tbody>
              </table></div>
            </>}
          </>}
          {courseResultImpactError && <p className={styles.warning} role="alert">{courseResultImpactError}</p>}
        </section>
      </details>
      </section>
      <section className={styles.workflowGroup} id={`workflow-${raceId}-after`} aria-label={text.workflowAfter}
        hidden={workflowMode !== "AFTER"}>
      <p className={styles.workflowHelp}>{text.workflowAfterHelp}</p>
      <details className={styles.afterRecalculation} open={classRecalculationAttempt ? true : undefined}>
        <summary>{text.classRecalculationTitle}</summary>
        {data && <ClassResultRecalculation classes={data.classes.map((item) => ({ id: item.id, name: item.name }))}
          disabled={disabled} candidates={classRecalculationCandidates} attempt={classRecalculationAttempt}
          unknown={classRecalculationUnknown} error={classRecalculationError} saved={classRecalculationSaved}
          onLoad={(id) => void loadClassRecalculation(id)} onPrepare={prepareClassRecalculation}
          onSubmit={(value) => void submitClassRecalculation(value)} onRetry={() => classRecalculationAttempt && void submitClassRecalculation(classRecalculationAttempt)}
          onCancel={() => { pending.current = undefined; sent.current = false; setClassRecalculationAttempt(undefined); setClassRecalculationUnknown(false); }} />}
      </details>
      <section className={styles.afterFinalization} aria-labelledby={`finalization-${raceId}`}>
        <h2 id={`finalization-${raceId}`}>{text.finalizationHeading}</h2>
        <p className={styles.workflowHelp}>{text.finalizationHelp}</p>
        <button type="button" className="secondary" disabled={disabled} onClick={() => void loadFinalizationBasis()}>{text.finalizationLoad}</button>
        {finalizationCandidates && <>
          <label>{text.finalizationScope}<select value={finalizationScope} disabled={disabled} onChange={event => setFinalizationScope(event.target.value)}>
            <option value="RACE">{sv.resultFinalizationRaceScope}</option>
            {finalizationCandidates.classes.map(row => <option key={row.classId} value={row.classId}>{row.className}</option>)}
          </select></label>
          {finalizationCandidate && <>
            <p>{text.participants}: {finalizationCandidate.entryCount} · {text.snapshot}: {finalizationCandidates.snapshotVersion}</p>
            <p>{text.finalizationLatest}: {finalizationCandidate.latestFinalization?.scopeRevision ?? text.finalizationNone}</p>
            {finalizationCandidate.blockerCodes.length > 0 && <ul>{finalizationCandidate.blockerCodes.map(code => <li key={code}>{sv.resultFinalizationBlockers[code]}</li>)}</ul>}
            <button type="button" disabled={disabled || finalizationCandidate.blockerCodes.length > 0} onClick={prepareFinalization}>{text.finalizationReview}</button>
          </>}
        </>}
        {finalizationAttempt && <section className={styles.panel} role="alert" aria-label={text.finalizationReview}>
          <h3>{text.finalizationReview}: {finalizationAttempt.value.label}</h3>
          <p>{text.finalizationConsequence}</p>
          <p>{text.finalizationLatest}: {(finalizationAttempt.value.request.expectedLatestScopeRevision ?? 0) + 1}</p>
          <details key={finalizationAttempt.value.requestId}><summary>{text.finalizationDetails}</summary>
            <p>{text.snapshot}: {finalizationAttempt.value.request.expectedSnapshotVersion}</p>
            <p style={{ overflowWrap: "anywhere" }}>{finalizationAttempt.value.request.expectedBasisHash}</p>
          </details>
          {unknown && <p>{text.finalizationUnknown}</p>}
          <button type="button" disabled={busy} onClick={() => void submitFinalization(finalizationAttempt)}>{unknown ? text.retry : text.finalizationConfirm}</button>
          {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => {
            pending.current = undefined; sent.current = false; setFinalizationAttempt(undefined);
          }}>{text.cancel}</button>}
        </section>}
      </section>
      {!workflowLocked && <nav className={styles.contextLinks} aria-label={text.afterRouteLinks}>
        <Link href={`/admin/${raceId}/map`}>{text.mapReleaseLink}</Link>
        <Link href={`/admin/${raceId}/route-upload`}>{text.privateRouteLinksLink}</Link>
        <Link href={`/admin/${raceId}/route-preview`}>{text.privateRoutePreviewLink}</Link>
      </nav>}
      <details className={styles.courseClassPanel}>
        <summary>{text.courseResultBearingTitle}</summary>
        <form className={styles.panel} onSubmit={inspectCourseResultBearingRelink}>
          <p>{text.courseResultBearingHelp}</p>
          <label>{text.courseResultBearingClass}<select value={courseResultBearingClassId} disabled={busy || !!courseResultBearingAttempt}
            onChange={event => { setCourseResultBearingClassId(event.target.value); setCourseResultBearingCandidate(undefined); setCourseResultBearingError(""); }}>
            <option value="">{text.chooseClass}</option>
            {data?.classes.map(raceClass => <option key={raceClass.id} value={raceClass.id}>{raceClass.name}</option>)}
          </select></label>
          {!courseResultBearingCandidate && !courseResultBearingAttempt && <button type="button" disabled={busy || !courseResultBearingClassId}
            onClick={() => void loadCourseResultBearingCandidate()}>{text.courseResultBearingLoad}</button>}
          {courseResultBearingCandidate && !courseResultBearingAttempt && <>
            <div className={styles.courseRelinkSummary}>
              <p><strong>{text.courseRelinkCourse}:</strong> {courseResultBearingCandidate.courseName}</p>
              <p><strong>{text.raceClass}:</strong> {courseResultBearingCandidate.className}</p>
              <p><strong>{text.courseRelinkVersion}:</strong> {courseResultBearingCandidate.classCourseVersion}</p>
              <p><strong>{text.courseControls}:</strong> {courseResultBearingCandidate.currentControlCodes.join(" → ")}</p>
              <p><strong>{text.courseResultBearingEntries}:</strong> {courseResultBearingCandidate.entries.length} · <strong>{text.courseResultBearingHistorical}:</strong> {courseResultBearingCandidate.historicalResultRevisionCount}</p>
            </div>
            <p className={styles.warning}>{text.courseResultBearingHelp}</p>
            {courseResultBearingCandidate.entries.length > 0 && <div className={styles.tableScroll}><table className={styles.table}>
              <thead><tr><th>{text.participants}</th><th>{text.courseResultImpactRevision}</th><th>{text.courseResultImpactStatus}</th><th>{text.courseResultBearingDecision}</th></tr></thead>
              <tbody>{courseResultBearingCandidate.entries.map(entry => <tr key={entry.entryId}>
                <td>{data?.entries.find(value => value.id === entry.entryId)?.displayName ?? entry.entryId}</td>
                <td>{entry.latestResultRevision?.revision ?? text.noRevision}</td>
                <td>{entry.latestResultRevision ? `${entry.latestResultRevision.status}/${entry.latestResultRevision.reason}` : text.noRevision}</td>
                <td>{entry.effectiveManualDecision?.kind ?? "–"}</td>
              </tr>)}</tbody>
            </table></div>}
            <label>{text.courseResultBearingControls}<textarea value={courseResultBearingControls} maxLength={12000} disabled={busy}
              aria-describedby="course-result-bearing-controls-help" onChange={event => setCourseResultBearingControls(event.target.value)} required rows={2} /></label>
            <p id="course-result-bearing-controls-help">{text.courseRelinkControlsHelp}</p>
            <label className={styles.confirmPerson}><input type="checkbox" checked={courseResultBearingAcknowledged} disabled={busy}
              onChange={event => setCourseResultBearingAcknowledged(event.target.checked)} />{text.courseResultBearingAcknowledge}</label>
            {courseResultBearingError && <p className={styles.warning} role="alert">{courseResultBearingError}</p>}
            <button type="submit" disabled={busy || !courseResultBearingAcknowledged}>{text.courseResultBearingInspect}</button>
          </>}
          {courseResultBearingAttempt && <section className={styles.review} role="alert" aria-live="polite">
            <h2>{text.courseResultBearingReview}</h2>
            <p><strong>{text.raceClass}:</strong> {courseResultBearingAttempt.candidate.className} · {text.courseRelinkVersion} {courseResultBearingAttempt.candidate.classCourseVersion} → {courseResultBearingAttempt.candidate.classCourseVersion + 1}</p>
            <p><strong>{text.courseResultBearingControls}:</strong> {courseResultBearingAttempt.request.controlCodes.join(" → ")}</p>
            <p>{text.courseResultBearingHelp}</p><p>{text.courseResultBearingNotSaved}</p>
            <div className={styles.actions}>
              <button type="button" disabled={busy} onClick={() => void submitCourseResultBearingRelink(courseResultBearingAttempt)}>{text.courseResultBearingConfirm}</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; setCourseResultBearingAttempt(undefined); }}>{text.courseResultBearingEdit}</button>
            </div>
            {courseResultBearingError && <p className={styles.warning} role="alert">{courseResultBearingError}</p>}
          </section>}
        </form>
      </details>
      <details className={styles.courseClassPanel}>
        <summary>{text.shortenedCourseTitle}</summary>
        <form className={styles.panel} onSubmit={inspectShortenedCourseTransfer}>
          <p>{text.shortenedCourseHelp}</p>
          <label>{text.shortenedCourseSourceClass}<select value={shortenedCourseClassId} disabled={busy || !!shortenedCourseAttempt}
            onChange={event => { setShortenedCourseClassId(event.target.value); setShortenedCourseCandidate(undefined); setShortenedCourseError(""); setShortenedEntryIds([]); }}>
            <option value="">{text.chooseClass}</option>
            {data?.classes.map(raceClass => <option key={raceClass.id} value={raceClass.id}>{raceClass.name}</option>)}
          </select></label>
          {!shortenedCourseCandidate && !shortenedCourseAttempt && <button type="button" disabled={busy || !shortenedCourseClassId}
            onClick={() => void loadShortenedCourseCandidate()}>{text.shortenedCourseLoad}</button>}
          {shortenedCourseCandidate && !shortenedCourseAttempt && <>
            <div className={styles.courseRelinkSummary}>
              <p><strong>{text.shortenedCourseSourceCourse}:</strong> {shortenedCourseCandidate.sourceCourseName} · {text.raceClass}: {shortenedCourseCandidate.sourceClassName}</p>
              <p><strong>{text.courseStartRule}:</strong> {shortenedCourseCandidate.sourceStartRule === "PUNCH" ? text.courseFreeStart : text.courseFixedStart}</p>
              <p><strong>{text.courseControls}:</strong> {shortenedCourseCandidate.sourceControls.map(control => control.controlCode).join(" → ")}</p>
            </div>
            <div className={styles.courseClassFields}>
              <label>{text.shortenedCourseName}<input value={shortenedCourseName} maxLength={160} disabled={busy}
                onChange={event => setShortenedCourseName(event.target.value)} required /></label>
              <label>{text.shortenedCourseClassName}<input value={shortenedClassName} maxLength={160} disabled={busy}
                onChange={event => setShortenedClassName(event.target.value)} required /></label>
              <label>{text.shortenedCoursePrefix}<select value={shortenedControlCount} disabled={busy}
                onChange={event => setShortenedControlCount(event.target.value)}>
                {shortenedCourseCandidate.sourceControls.slice(0, -1).map((_, index) => <option key={index + 1} value={index + 1}>
                  {shortenedCourseCandidate.sourceControls.slice(0, index + 1).map(control => control.controlCode).join(" → ")}
                </option>)}
              </select></label>
            </div>
            {shortenedCourseCandidate.entries.length === 0 ? <p>{text.shortenedCourseNoEligibleEntries}</p> : <>
              <fieldset className={styles.shortenedEntries} disabled={busy}>
                <legend>{text.shortenedCourseEntries} ({shortenedEntryIds.length}/100)</legend>
                {shortenedCourseCandidate.entries.map(entry => <label key={entry.entryId}>
                  <input type="checkbox" checked={shortenedEntryIds.includes(entry.entryId)}
                    disabled={busy || (!shortenedEntryIds.includes(entry.entryId) && shortenedEntryIds.length >= 100)}
                    onChange={event => toggleShortenedEntry(entry.entryId, event.target.checked)} />
                  <span>{entry.displayName} · {entry.sourceResult.kind === "NO_RESULT" ? text.shortenedCourseNoResult : text.shortenedCourseMpResult}</span>
                </label>)}
              </fieldset>
              <p>{text.shortenedCourseConsequence}</p>
              {shortenedCourseError && <p className={styles.warning} role="alert">{shortenedCourseError}</p>}
              <button type="submit" disabled={busy || shortenedEntryIds.length === 0}>{text.shortenedCourseInspect}</button>
            </>}
          </>}
          {shortenedCourseError && !shortenedCourseCandidate && !shortenedCourseAttempt && <p className={styles.warning} role="alert">{shortenedCourseError}</p>}
          {shortenedCourseAttempt && <section className={styles.review} role="alert" aria-live="polite">
            <h2>{text.shortenedCourseReview}</h2>
            <p><strong>{text.raceClass}:</strong> {shortenedCourseAttempt.candidate.sourceClassName} → {shortenedCourseAttempt.request.shortClassName}</p>
            <p><strong>{text.shortenedCourseSourceCourse}:</strong> {shortenedCourseAttempt.candidate.sourceCourseName} → {shortenedCourseAttempt.request.shortCourseName}</p>
            <p><strong>{text.shortenedCoursePrefix}:</strong> {shortenedCourseAttempt.request.controlPrefix.map(control => control.controlCode).join(" → ")}</p>
            <ul className={styles.shortenedReviewList}>{shortenedCourseAttempt.request.entryIds.map(entryId => {
              const entry = shortenedCourseAttempt.candidate.entries.find(value => value.entryId === entryId);
              return <li key={entryId}>{entry?.displayName ?? entryId} · {entry?.sourceResult.kind === "NO_RESULT" ? text.shortenedCourseNoResult : text.shortenedCourseMpResult}</li>;
            })}</ul>
            <p>{text.shortenedCourseConsequence}</p><p>{text.shortenedCourseNotSaved}</p>
            <div className={styles.actions}>
              <button type="button" disabled={busy} onClick={() => void submitShortenedCourseTransfer(shortenedCourseAttempt)}>{text.shortenedCourseConfirm}</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; setShortenedCourseAttempt(undefined); }}>{text.shortenedCourseEdit}</button>
            </div>
            {shortenedCourseError && <p className={styles.warning} role="alert">{shortenedCourseError}</p>}
          </section>}
        </form>
      </details>
      </section>
      {workflowMode === "DURING" && duringArea === "SPEAKER" && <RaceWorkspaceSpeaker raceId={raceId} />}
      <section className={styles.workflowGroup} id={`workflow-${raceId}-during`} aria-label={text.workflowDuring}
        hidden={workflowMode !== "DURING" || duringArea !== "OVERVIEW"}>
      <p className={styles.workflowHelp}>{navigationText.duringHelp}</p>
      <section className={styles.attention} aria-labelledby={`attention-${raceId}`}>
        <div className={styles.attentionHeader}>
          <div><h2 id={`attention-${raceId}`}>{text.attentionTitle}</h2><p>{text.attentionHelp}</p></div>
          <button type="button" className="secondary" disabled={workflowLocked}
            onClick={() => void loadRaceDayAttention()}>{text.attentionRefresh}</button>
        </div>
        <p className={styles.attentionCaveat}>{text.attentionUncertainty}</p>
        <div className={styles.attentionSources}>
          <section className={styles.attentionSource} aria-labelledby={`attention-forest-${raceId}`}>
            <h3 id={`attention-forest-${raceId}`}>{text.attentionForestSource}</h3>
            {forestData && <p className={styles.attentionBasis}>{text.attentionForestBasis(forestData.snapshotVersion,
              formatStartListTime(forestData.generatedAt, forestData.timeZone))}</p>}
            {!forestAttentionFresh && <p className={styles.attentionUnavailable} role="status">{text.attentionForestUnavailable}</p>}
            <ul className={styles.attentionItems}>
              <li className={forestAttentionCounts?.conflict ? styles.attentionConflict : undefined}>
                <span>{text.attentionConflict}</span><strong>{forestAttentionCounts?.conflict ?? text.attentionUnknown}</strong>
                <button type="button" className="secondary" disabled={workflowLocked}
                  onClick={() => openAttentionPanel("CONFLICT")}>{text.attentionOpen}</button>
              </li>
              <li><span>{text.attentionStartedNoReturn}</span><strong>{forestAttentionCounts?.startedNoReturn ?? text.attentionUnknown}</strong>
                <button type="button" className="secondary" disabled={workflowLocked}
                  onClick={() => openAttentionPanel("STARTED_NO_RETURN")}>{text.attentionOpen}</button>
              </li>
              <li><span>{text.attentionUnconfirmed}</span><strong>{forestAttentionCounts?.unconfirmed ?? text.attentionUnknown}</strong>
                <button type="button" className="secondary" disabled={workflowLocked}
                  onClick={() => openAttentionPanel("UNCONFIRMED")}>{text.attentionOpen}</button>
              </li>
            </ul>
          </section>
          <section className={styles.attentionSource} aria-labelledby={`attention-readout-${raceId}`}>
            <h3 id={`attention-readout-${raceId}`}>{text.attentionReadoutSource}</h3>
            {unknownReadoutCandidate && unknownReadoutFetchedAt && <p className={styles.attentionBasis}>{text.attentionReadoutBasis(
              unknownReadoutCandidate.snapshotVersion, new Date(unknownReadoutFetchedAt).toLocaleTimeString("sv-SE"))}</p>}
            {!unknownReadoutAttentionFresh && <p className={styles.attentionUnavailable} role="status">{text.attentionReadoutUnavailable}</p>}
            <ul className={styles.attentionItems}><li>
              <span>{text.attentionUnknownReadouts}</span>
              <strong>{unknownReadoutAttentionFresh ? unknownReadoutCandidate?.readouts.length ?? text.attentionUnknown : text.attentionUnknown}</strong>
              <button type="button" className="secondary" disabled={workflowLocked}
                onClick={() => openAttentionPanel("READOUT")}>{text.attentionOpen}</button>
            </li></ul>
          </section>
        </div>
      </section>
      <details ref={unknownReadoutPanel} id={`unknown-readout-${raceId}`} className={styles.courseClassPanel}>
        <summary>{text.unknownReadoutTitle}</summary>
        <section className={styles.panel}>
          <p>{text.unknownReadoutHelp}</p>
          {!unknownReadoutCandidate && !unknownReadoutAttempt && <button type="button" disabled={busy}
            onClick={() => void loadUnknownReadoutCandidates()}>{text.unknownReadoutLoad}</button>}
          {unknownReadoutCandidate && !unknownReadoutAttempt && (unknownReadoutCandidate.readouts.length === 0 ? <p>{text.unknownReadoutNone}</p> : <>
            <label>{text.unknownReadoutSelect}<select value={unknownReadoutId} disabled={busy}
              onChange={event => setUnknownReadoutId(event.target.value)}>
              {unknownReadoutCandidate.readouts.map(readout => <option key={readout.id} value={readout.id}>
                {text.rosterCard} {readout.cardNumber} · {(readout.finishPunchedAt ? formatStartListTime(readout.finishPunchedAt, data?.timeZone ?? "UTC") : "–")}
              </option>)}
            </select></label>
            <label>{text.unknownReadoutTarget}<select value={unknownReadoutTarget} disabled={busy}
              onChange={event => setUnknownReadoutTarget(event.target.value === "NEW_ENTRY" ? "NEW_ENTRY" : "EXISTING_ENTRY")}>
              <option value="EXISTING_ENTRY">{text.unknownReadoutExisting}</option><option value="NEW_ENTRY">{text.unknownReadoutNew}</option>
            </select></label>
            {unknownReadoutTarget === "EXISTING_ENTRY" ? <label>{text.unknownReadoutEntry}<select value={unknownReadoutEntryId} disabled={busy}
              onChange={event => setUnknownReadoutEntryId(event.target.value)}>
              <option value="">{text.chooseEntry}</option>
              {unknownReadoutCandidate.entries.map(entry => <option key={entry.id} value={entry.id}>
                {entry.familyName}, {entry.givenName} · {unknownReadoutCandidate.classes.find(raceClass => raceClass.id === entry.classId)?.name ?? entry.classId}{entry.activeAssignment ? ` · ${text.rosterCard} ${entry.activeAssignment.cardNumber}` : ""}
              </option>)}
            </select></label> : <>
              <label>{text.unknownReadoutNewClass}<select value={unknownReadoutClassId} disabled={busy}
                onChange={event => setUnknownReadoutClassId(event.target.value)}><option value="">{text.chooseClass}</option>
                {unknownReadoutCandidate.classes.map(raceClass => <option key={raceClass.id} value={raceClass.id}>
                  {raceClass.name} · {raceClass.entryCount}{raceClass.maxEntries === null ? "" : `/${raceClass.maxEntries}`}
                </option>)}
              </select></label>
              <label>{text.unknownReadoutGivenName}<input value={unknownReadoutGivenName} maxLength={160} disabled={busy}
                onChange={event => setUnknownReadoutGivenName(event.target.value)} required /></label>
              <label>{text.unknownReadoutFamilyName}<input value={unknownReadoutFamilyName} maxLength={160} disabled={busy}
                onChange={event => setUnknownReadoutFamilyName(event.target.value)} required /></label>
              <label>{text.unknownReadoutOrganisation}<input value={unknownReadoutOrganisationName} maxLength={200} disabled={busy}
                onChange={event => setUnknownReadoutOrganisationName(event.target.value)} /></label>
            </>}
            <p className={styles.warning}>{text.unknownReadoutConsequence}</p>
            {unknownReadoutError && <p className={styles.warning} role="alert">{unknownReadoutError}</p>}
            <button type="button" disabled={busy || !!unknownReadoutAttempt} onClick={inspectUnknownReadoutResolution}>{text.unknownReadoutInspect}</button>
          </>)}
          {unknownReadoutAttempt && <section className={styles.review} role="alert" aria-live="polite">
            <h2>{text.unknownReadoutReview}</h2>
            <p><strong>{text.rosterCard}:</strong> {unknownReadoutAttempt.request.cardNumber} · {text.unknownReadoutSelect}: {unknownReadoutAttempt.candidate.readouts.find(row => row.id === unknownReadoutAttempt.request.readoutId)?.finishPunchedAt ?? "–"}</p>
            <p><strong>{text.unknownReadoutTarget}:</strong> {unknownReadoutTargetLabel(unknownReadoutAttempt)}</p>
            <p>{text.unknownReadoutConsequence}</p><p>{text.unknownReadoutNotSaved}</p>
            <div className={styles.actions}>
              <button type="button" disabled={busy} onClick={() => void submitUnknownReadoutResolution(unknownReadoutAttempt)}>{text.unknownReadoutConfirm}</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setUnknownReadoutAttempt(undefined); }}>{text.unknownReadoutEdit}</button>
            </div>
            {unknownReadoutError && <p className={styles.warning} role="alert">{unknownReadoutError}</p>}
          </section>}
        </section>
      </details>
      <details ref={forestPanel} id={`forest-watch-${raceId}`} open={forestOpen} onToggle={event => setForestOpen(event.currentTarget.open)}>
        <summary>{forestText.title}</summary>
        <p>{text.returnHelp}</p>
        <label><input type="checkbox" checked={forestAutoRefresh} disabled={disabled}
          onChange={event => setForestAutoRefresh(event.target.checked)} />{text.forestAutoRefresh}</label>
        {forestAutoRefresh && <p>{text.forestAutoRefreshHelp}</p>}
        <button type="button" className="secondary" disabled={disabled} onClick={() => void loadForest()}>{forestText.refresh}</button>
        {forestData && <button type="button" className="secondary" disabled={disabled}
          onClick={() => printPrivate("FOREST")}>{forestText.print}</button>}
        {forestData && <>
          <details className={styles.personReturn}>
          <summary>{text.returnSelected}: {forestData.entries.find(row => row.entryId === entryId)?.displayName ?? text.returnChoose}</summary>
          <p>{text.returnSelected}: {forestData.entries.find(row => row.entryId === entryId)?.displayName ?? text.returnChoose}</p>
          <button type="button" disabled={disabled || forestStale || !forestData.entries.some(row => row.entryId === entryId && !row.manualReturnRegistered)} onClick={() => prepareReturn()}>{text.returnReview}</button>
          <button type="button" className="secondary" disabled={disabled || forestStale || !forestData.entries.some(row => row.entryId === entryId && row.manualReturnRegistered)} onClick={() => prepareReturn(true)}>{text.returnWithdrawalReview}</button>
          <label>{text.startCorrectionTarget}<select value={targetStartState} disabled={disabled} onChange={event => setTargetStartState(administratorStartCorrectionRequestSchema.shape.targetStartState.parse(event.target.value))}>
            {(["UNMARKED", "STARTED", "REPORTED_NOT_STARTED"] as const).map(state => <option key={state} value={state}>{forestText.reports[state]}</option>)}
          </select></label>
          <button type="button" className="secondary" disabled={disabled || forestStale || !forestData.entries.some(row => row.entryId === entryId && row.startState !== targetStartState)} onClick={prepareStartCorrection}>{text.startCorrectionReview}</button>
          </details>
          <label>{forestText.raceClass}<select value={forestClass} disabled={disabled} onChange={event => setForestClass(event.target.value)}>
            <option value="">{forestText.allClasses}</option>
            {Array.from(new Map(forestData.entries.map(row => [row.classId, row.className]))).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select></label>
          <label>{forestText.search}<input type="search" value={forestQuery} disabled={disabled} onChange={event => setForestQuery(event.target.value)} /></label>
          <button type="button" className="secondary" disabled={disabled} onClick={() => { setForestQuery(""); setForestClass(""); }}>{forestText.clearFilters}</button>
          <label><input type="checkbox" checked={forestSortByAge} disabled={disabled}
            onChange={event => setForestSortByAge(event.target.checked)} />{forestText.ageSort}</label>
          <ForestWatchReport data={forestData} reportedStarts={forestData.reportedStarts} sortByAge={forestSortByAge} classId={forestClass} query={forestQuery} stale={forestStale} disabled={disabled} onOpenHistory={id => select(id, true)} onReviewConflict={id => select(id, true, true)} />
        </>}
      </details>
      </section>
      {forestData && <div className={styles.forestPrint} data-forest-print>
        <ForestWatchReport data={forestData} reportedStarts={forestData.reportedStarts} sortByAge={forestSortByAge} classId={forestClass} query={forestQuery} stale={forestStale} />
      </div>}
      {data && rentalEntries.length > 0 && <section className={styles.rentalPrint} data-rental-print aria-label={text.rentalPrintHeading}>
        <h1>{text.rentalPrintHeading}</h1>
        <p>{data.eventName} · {data.raceName} · {data.raceDate}</p>
        <p>{text.rentalPrintGenerated}: {formatStartListTime(data.generatedAt, data.timeZone)} · {data.timeZone}</p>
        <p>{text.rentalPrintCount}: {rentalEntries.length}</p>
        <p>{text.rentalPrintPrivacy}</p>
        <table><caption>{text.rentalPrintCaption}</caption><thead><tr>
          <th scope="col">{text.name}</th><th scope="col">{text.raceClass}</th><th scope="col">{text.rentalPrintCard}</th>
        </tr></thead><tbody>{rentalEntries.map(entry => <tr key={entry.id}>
          <td>{entry.displayName}{entry.organisationName ? <><br /><span>{entry.organisationName}</span></> : null}</td>
          <td>{classNames.get(entry.classId)}</td><td>{entry.activeAssignment!.cardNumber}</td>
        </tr>)}</tbody></table>
      </section>}
      <section className={styles.workflowGroup} aria-label={text.workflowDuring} hidden={workflowMode !== "DURING" || duringArea !== "OVERVIEW"}>
      <details ref={checkinHistoryPanel}>
        <summary>{checkinHistorySv.title}</summary>
        <p>{checkinHistorySv.help}</p>
        <p>{data?.entries.find(entry => entry.id === entryId)?.displayName ?? checkinHistorySv.choose}</p>
        <button type="button" className="secondary" disabled={disabled || !entryId} onClick={() => void loadCheckinHistory()}>{checkinHistorySv.latest}</button>
        <button type="button" className="secondary" disabled={disabled || !entryId} onClick={() => void loadConflictReview()}>{reviewText.load}</button>
        {checkinHistory?.entryId === entryId && <section aria-label={checkinHistorySv.title}>
          <CheckinHistoryTable data={checkinHistory} timeZone={data?.timeZone ?? "UTC"} />
          {checkinHistory.nextCursor && <button type="button" className="secondary" disabled={disabled} onClick={() => void loadCheckinHistory(checkinHistory.nextCursor!)}>{checkinHistorySv.older}</button>}
        </section>}
      </details>
      {(reviewAttempt || reviewCandidate) && <section className={styles.panel} aria-label={reviewText.title}>
        <h2>{reviewText.title}</h2><p>{reviewText.adminHelp}</p>
        <AdministratorConflictEvidence candidate={reviewAttempt?.candidate ?? reviewCandidate!} />
        {(reviewAttempt?.candidate ?? reviewCandidate!).source.conflicts.length > 0 && <>
          <label>{reviewText.reason}<textarea maxLength={500} rows={2} disabled={busy || !!reviewAttempt}
            value={reviewAttempt?.request.reason ?? reviewReason} onChange={event => setReviewReason(event.target.value)} /></label>
          <label><input type="checkbox" disabled={busy || !!reviewAttempt} checked={!!reviewAttempt || reviewConfirmed}
            onChange={event => setReviewConfirmed(event.target.checked)} />{reviewText.confirm}</label>
          <button type="button" disabled={busy || (!reviewAttempt && (!reviewConfirmed || !reviewReason.trim()))}
            onClick={() => void submitConflictReview()}>{reviewAttempt ? reviewText.retry : reviewText.submit}</button>
        </>}
        {!reviewAttempt && <button type="button" className="secondary" disabled={busy} onClick={() => setReviewCandidate(undefined)}>{text.cancel}</button>}
      </section>}
      {startCorrection && <section className={styles.panel} role="alert" aria-label={text.startCorrectionReview}>
        <h3>{text.startCorrectionReview}: {startCorrection.name}</h3>
        <p>{text.startCorrectionConsequence}</p>
        <p>{forestText.reports[startCorrection.request.targetStartState]}</p>
        {unknown && <p>{text.returnUnknown}</p>}
        <button type="button" disabled={busy} onClick={() => void submitStartCorrection(startCorrection)}>{unknown ? text.retry : text.startCorrectionConfirm}</button>
        {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setStartCorrection(undefined); }}>{text.cancel}</button>}
      </section>}
      {returnAttempt && <section className={styles.panel} role="alert" aria-label={returnAttempt.withdraw ? text.returnWithdrawalReview : text.returnReview}>
        <h3>{returnAttempt.withdraw ? text.returnWithdrawalReview : text.returnReview}: {returnAttempt.name}</h3>
        <p>{returnAttempt.withdraw ? text.returnWithdrawalConsequence : text.returnConsequence}</p>
        <p>{forestText.reports[returnAttempt.request.expectedStartState]}</p>
        {unknown && <p>{text.returnUnknown}</p>}
        <button type="button" disabled={busy} onClick={() => void submitReturn(returnAttempt)}>{unknown ? text.retry : returnAttempt.withdraw ? text.returnWithdrawalConfirm : text.returnConfirm}</button>
        {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setReturnAttempt(undefined); }}>{text.cancel}</button>}
      </section>}
      </section>
      <section className={styles.workflowGroup} aria-label={navigationText.during.CORRECTIONS} hidden={workflowMode !== "DURING" || duringArea !== "CORRECTIONS"}>
      {data && <section className={styles.correctionTools} aria-label={text.correctionTools}>
        <h2>{text.correctionTools}</h2><p className={styles.workflowHelp}>{text.correctionToolsHelp}</p>
        <ClassControlNeutralization raceId={raceId} classes={data.classes} onCommitted={() => window.location.reload()} onPendingChange={setNeutralizationPending} />
        <ManualFinishTimeCorrection raceId={raceId} entries={data.entries} timeZone={data.timeZone} onPendingChange={setFinishCorrectionPending} />
        <ManualPunchStartTimeCorrection raceId={raceId} entries={data.entries} timeZone={data.timeZone} onPendingChange={setStartCorrectionPending} />
        <ManualPunchStartTimeCorrectionWithdrawal raceId={raceId} entries={data.entries} timeZone={data.timeZone} onPendingChange={setStartWithdrawalPending} />
        <ManualFinishTimeCorrectionWithdrawal raceId={raceId} entries={data.entries} timeZone={data.timeZone} onPendingChange={setFinishWithdrawalPending} />
      </section>}
      </section>
      <section className={styles.workflowGroup} aria-label={navigationText.preparation.STAFF} hidden={workflowMode !== "BEFORE" || preparationArea !== "STAFF"}>
      <RaceOperatorAccess raceId={raceId} onPendingChange={setOperatorAccessPending} />
      </section>
      <section className={styles.workflowGroup} aria-label={navigationText.preparation.PUBLICATION} hidden={workflowMode !== "BEFORE" || preparationArea !== "PUBLICATION"}>
      {data && <RacePreparationStartList data={data} disabled={disabled} onSelectEntry={id => select(id)} />}
      <details>
        <summary>{publicationText.title}</summary>
        <p>{publicationText.help}</p>
        <Link href={`/starts/${raceId}`}>{publicationText.publicLink}</Link>
        <button type="button" className="secondary" disabled={disabled} onClick={() => void loadPublication()}>{publicationText.refresh}</button>
        {publicationPreview && <>
          <p>{publicationPreview.latestDecision ? `${publicationText.currentRevision}: ${publicationPreview.latestDecision.revision} · ${publicationPreview.latestDecision.action === "PUBLISH" ? publicationText.published : publicationText.withdrawn}` : publicationText.noPublication}</p>
          {publicationPreview.latestDecision?.action === "PUBLISH" && publicationPreview.latestDecision.sourceHash !== publicationPreview.sourceHash && <p>{publicationText.changed}</p>}
          {publicationPreview.content?.classes.some(row => row.entries.length > 0)
            ? <button type="button" disabled={disabled} onClick={() => preparePublication("PUBLISH")}>{publicationText.inspectPublish}</button>
            : <p>{publicationPreview.content ? publicationText.empty : publicationText.invalidContent}</p>}
          {publicationPreview.latestDecision?.action === "PUBLISH" && <button type="button" className="secondary" disabled={disabled} onClick={() => preparePublication("WITHDRAW")}>{publicationText.inspectWithdraw}</button>}
        </>}
      </details>
      {publicationAttempt && <section className={styles.panel} role="alert" aria-label={publicationText.preview}>
        <h3>{publicationAttempt.request.action === "PUBLISH" ? publicationText.pendingPublish : publicationText.pendingWithdraw}</h3>
        <p>{publicationText.help}</p><p>{publicationText.privacy}</p>
        <p>{publicationText.currentRevision}: {publicationAttempt.request.expectedRevision} → {publicationAttempt.request.expectedRevision + 1}</p>
        {publicationAttempt.content && <div className={styles.tableScroll} style={{ maxHeight: "22rem" }}>
          <p>{publicationAttempt.content.eventName} · {publicationAttempt.content.raceName} · {publicationAttempt.content.raceDate} · {publicationAttempt.content.timeZone}</p>
          <table className={styles.table}><thead><tr><th>{text.name}</th><th>{text.raceClass}</th><th>{text.publicationStartTime}</th></tr></thead>
            <tbody>{publicationAttempt.content.classes.flatMap((row, classIndex) => row.entries.length === 0
              ? [<tr key={`${classIndex}-empty`}><td>{text.publicationEmptyClass}</td><td>{row.name}</td><td>{row.startRule === "PUNCH" ? text.publicationFreeStart : text.publicationFixedStart}</td></tr>]
              : row.entries.map((entry, entryIndex) => <tr key={`${classIndex}-${entryIndex}`}>
              <td>{entry.displayName}<br />{entry.organisationName ?? text.none}</td><td>{row.name}</td>
              <td>{row.startRule === "PUNCH" ? text.publicationFreeStart : entry.fixedStartTime ? formatStartListTime(entry.fixedStartTime, publicationAttempt.content!.timeZone) : drawText.missing}</td>
            </tr>))}</tbody></table>
        </div>}
        {unknown && <p>{publicationText.unknown}</p>}
        <button type="button" disabled={busy} onClick={() => void submitPublication(publicationAttempt)}>{unknown ? publicationText.retry : publicationAttempt.request.action === "PUBLISH" ? publicationText.confirmPublish : publicationText.confirmWithdraw}</button>
        {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => {
          pending.current = undefined; sent.current = false; setPublicationAttempt(undefined);
        }}>{publicationText.cancel}</button>}
      </section>}
      </section>
      <section className={styles.workflowGroup} aria-label={navigationText.preparation.DRAW} hidden={workflowMode !== "BEFORE" || preparationArea !== "DRAW"}>
      <details ref={drawPanel}>
        <summary>{drawText.title}</summary>
        <p>{drawText.help}</p>
        <button type="button" className="secondary" disabled={disabled} onClick={() => void loadDrawClasses()}>{drawText.refresh}</button>
        {drawClasses && <form onSubmit={event => void previewDraw(event)}>
          <p>{drawText.timezone}: {drawClasses.timeZone}</p>
          <label>{drawText.class}<select value={drawClassId} disabled={disabled} onChange={event => setDrawClassId(event.target.value)}>
            <option value="">—</option>{drawClasses.classes.map(row => <option key={row.id} value={row.id} disabled={row.entryCount === 0}>{row.name} ({row.entryCount})</option>)}
          </select></label>
          <label>{drawText.first}<input value={drawFirst} disabled={disabled} placeholder={drawText.firstExample} onChange={event => setDrawFirst(event.target.value)} /></label>
          <label>{drawText.interval}<input type="number" min="1" max="3600" step="1" value={drawInterval} disabled={disabled} onChange={event => setDrawInterval(event.target.value)} /></label>
          <button disabled={disabled || !drawClassId}>{drawText.inspect}</button>
        </form>}
      </details>
      {drawAttempt && <section className={styles.panel} role="alert" aria-label={drawText.inspect}>
        <h3>{drawText.inspect}: {drawAttempt.preview.className}</h3>
        <p>{drawText.warning}</p>
        <p>{drawText.count}: {drawAttempt.preview.entries.length} · {drawText.changes}: {drawAttempt.preview.entries.filter(row => row.changed).length}</p>
        <div className={styles.tableScroll} style={{ maxHeight: "20rem" }}><table className={styles.table}>
          <thead><tr><th>{text.name}</th><th>{drawText.previous}</th><th>{drawText.next}</th></tr></thead>
          <tbody>{drawAttempt.preview.entries.map(row => <tr key={row.entryId}><td>{row.displayName}</td>
            <td>{row.previousFixedStartTime ? formatStartListTime(row.previousFixedStartTime, drawAttempt.preview.timeZone) : drawText.missing}</td>
            <td>{formatStartListTime(row.fixedStartTime, drawAttempt.preview.timeZone)}</td></tr>)}</tbody>
        </table></div>
        <details key={drawAttempt.id}><summary>{text.finalizationDetails}</summary>
          <p>{drawText.seed}: {drawAttempt.request.parameters.seed} · {drawText.snapshot}: {drawAttempt.request.expectedSnapshotVersion}</p>
        </details>
        {unknown && <p>{drawText.unknown}</p>}
        <button type="button" disabled={busy || !drawAttempt.preview.entries.some(row => row.changed)} onClick={() => void submitDraw(drawAttempt)}>{unknown ? drawText.retry : drawText.confirm}</button>
        {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => {
          pending.current = undefined; sent.current = false; setDrawAttempt(undefined);
        }}>{drawText.cancel}</button>}
      </section>}
      <FixedStartSlotPlans raceId={raceId} disabled={disabled} />
      </section>
      <section className={styles.workflowGroup} aria-label={text.exportHeading} hidden={workflowMode !== "AFTER"}>
      <details className={styles.afterExport}>
        <summary>{text.exportHeading}</summary>
        <p>{text.exportHelp}</p>
        <button type="button" className="secondary" disabled={disabled} onClick={() => void downloadResults()}>{text.exportDownload}</button>
        <h3>{text.exportCompleteHeading}</h3>
        <p>{text.exportCompleteHelp}</p>
        <button type="button" className="secondary" disabled={disabled} onClick={() => void loadFinalizations()}>{text.exportLoadHistory}</button>
        {finalizations?.length === 0 && <p>{text.exportEmptyHistory}</p>}
        {!!finalizations?.length && <>
          <label>{text.exportRevision}<select value={finalizationId} disabled={disabled} onChange={event => setFinalizationId(event.target.value)}>
            {finalizations.map(row => <option key={row.id} value={row.id}>{text.exportRevisionOption(row.scopeRevision, row.finalizedAt, row.entryCount)}</option>)}
          </select></label>
          <button type="button" disabled={disabled || !finalizationId} onClick={() => void downloadFinalization()}>{text.exportDownloadComplete}</button>
        </>}
      </details>
      </section>
      <section className={styles.workflowGroup} id={`workflow-${raceId}-participants`} aria-label={text.workflowParticipants}
        hidden={!participantsVisible}>
      <p className={styles.workflowHelp}>{text.workflowParticipantsHelp}</p>
      <nav className={styles.mobileNavigation} aria-label={text.mobileNavigation}>
        <button type="button" className="secondary" aria-pressed={mobilePanel === "LIST"} disabled={disabled}
          aria-controls={`participant-list-${raceId}`} onClick={() => navigateMobile("LIST")}>{text.mobileList}</button>
        <button type="button" className="secondary" aria-pressed={mobilePanel === "WORK"} disabled={disabled}
          aria-controls={`participant-work-${raceId}`} onClick={() => navigateMobile("WORK")}>{text.mobileWork}</button>
      </nav>
      {selected && (selectedIndex < 0 || selectedPage !== currentPage) && <div className={styles.selectionContext}
        aria-label={navigationText.selectedContext}>
        <span><strong>{navigationText.selected}: {selected.displayName}</strong> · {selectedIndex < 0
          ? navigationText.selectedOutsideFilters : navigationText.selectedOnPage(selectedPage + 1)}</span>
        <button type="button" className="secondary" disabled={workflowLocked} onClick={revealSelected}>{selectedIndex < 0
          ? navigationText.revealFilteredSelected : navigationText.revealSelectedOnPage(selectedPage + 1)}</button>
      </div>}
      <div className={styles.columns} data-mobile-panel={mobilePanel} data-wide-table={wideTable}>
        <section className={styles.panel} aria-label={text.participants} data-panel="LIST" ref={listPanel} tabIndex={-1} id={`participant-list-${raceId}`}>
          <div className={`${styles.toolbar} ${styles.participantToolbar}`}><h2>{text.participants}</h2>
            <button disabled={disabled || !data} onClick={newParticipant}>{text.newParticipant}</button>
            <button type="button" className={`secondary ${styles.wideTableButton}`} disabled={disabled} aria-pressed={wideTable}
              aria-label={wideTable ? navigationText.splitTableAccessible : navigationText.wideTableAccessible}
              onClick={() => setWideTable(!wideTable)}>{wideTable ? navigationText.splitTable : navigationText.wideTable}</button>
            {rentalEntries.length > 0 && <button type="button" className="secondary" disabled={disabled}
              onClick={() => printPrivate("RENTAL")}>{text.rentalPrint}</button>}
            <button className="secondary" disabled={disabled} onClick={() => void refresh()}>{text.refresh}</button></div>
          <div className={styles.rosterSearch}>
          <label>{navigationText.search}<input type="search" autoComplete="off" value={query} disabled={disabled}
            onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label>
          <div className={styles.tableOptions}>
            <label>{navigationText.classFilter}<select value={rosterClassId} disabled={disabled} onChange={event => { setRosterClassId(event.target.value); setPage(0); }}>
              <option value="">{text.rosterAllClasses}</option>
              {data?.classes.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select></label>
            <label>{text.rosterResultStateFilter}<select value={resultState}
              disabled={disabled || !data} onChange={event => {
                const next = event.target.value;
                if (!administratorRosterResultFilters.some(value => value === next)) return;
                setResultState(next as AdministratorRosterResultFilter); setPage(0);
              }}>
              {administratorRosterResultFilters.map(value => <option key={value} value={value}>
                {value === "ALL" ? text.rosterResultStateAll : value === "NO_ACTIVE_RESULT" ? text.rosterNoActiveFilter :
                  value === "NO_PUBLISHED_RESULT" ? text.rosterNoPublishedFilter : sv.publicResultsStatusLabels[value]}
              </option>)}
            </select></label>
            <label>{navigationText.rosterOrder}<select value={rosterOrder} disabled={disabled || !data}
              onChange={event => { setRosterOrder(event.target.value === "FIXED_START" ? "FIXED_START" : "NAME"); setPage(0); }}>
              <option value="NAME">{navigationText.rosterNameOrder}</option>
              <option value="FIXED_START">{navigationText.rosterFixedStartOrder}</option>
            </select></label>
            <label><span className={styles.rowsLabelFull}>{navigationText.rows}</span>
              <span className={styles.rowsLabelCompact} aria-hidden="true">{navigationText.rowsCompact}</span>
              <select aria-label={navigationText.rows} value={pageSize} disabled={disabled}
                onChange={event => { setPageSize(Number(event.target.value)); setPage(0); }}>
              {[25, 100, 250].map(size => <option key={size} value={size}>{size}</option>)}
            </select></label>
          </div>
          </div>
          <div className={styles.rosterFilters}>
            <label className={styles.listFilter}><input type="checkbox" checked={olderResultsOnly} disabled={disabled}
              aria-label={text.rosterOlderResultsOnly(olderResultCount)}
              onChange={(event) => { setOlderResultsOnly(event.target.checked); setPage(0); }} />
              <span className={styles.filterLabelFull}>{text.rosterOlderResultsOnly(olderResultCount)}</span>
              <span className={styles.filterLabelCompact} aria-hidden="true">{text.rosterOlderResultsCompact(olderResultCount)}</span></label>
            <label className={styles.listFilter}><input type="checkbox" checked={rentalCardsOnly} disabled={disabled}
              aria-label={text.rosterRentalCardsOnly(rentalCardCount)}
              onChange={(event) => { setRentalCardsOnly(event.target.checked); setPage(0); }} />
              <span className={styles.filterLabelFull}>{text.rosterRentalCardsOnly(rentalCardCount)}</span>
              <span className={styles.filterLabelCompact} aria-hidden="true">{text.rosterRentalCardsCompact(rentalCardCount)}</span></label>
            <label className={styles.listFilter}><input type="checkbox" checked={paymentAttentionOnly} disabled={disabled}
              aria-label={text.rosterPaymentAttentionOnly(paymentAttentionCount)}
              onChange={(event) => { setPaymentAttentionOnly(event.target.checked); setPage(0); }} />
              <span className={styles.filterLabelFull}>{text.rosterPaymentAttentionOnly(paymentAttentionCount)}</span>
              <span className={styles.filterLabelCompact} aria-hidden="true">{text.rosterPaymentAttentionCompact(paymentAttentionCount)}</span></label>
          </div>
          {missingFixedStartOnly && <div className={styles.activeRosterFilter}>
            <span>{text.rosterMissingFixedStartFilter}</span>
            <button type="button" className="secondary" disabled={disabled} onClick={() => {
              setMissingFixedStartOnly(false); setPage(0);
            }}>{text.rosterShowAllStartTimes}</button>
          </div>}
          {data && <><p>{text.shown} {filtered.length} {text.of} {data.entries.length}
            {rosterOrder === "FIXED_START" && <span className={styles.rosterOrderHint}> · {navigationText.rosterFixedStartOrderHelp}</span>}</p>
            <div className={styles.tableScroll}><table className={`${styles.table} ${styles.rosterTable}`}><thead><tr>
              <th scope="col">{text.name}</th><th scope="col">{text.raceClass}</th>
              <th scope="col">{text.rosterResult}</th><th scope="col">{text.rosterCard}</th><th scope="col">{text.rosterStart}</th>
            </tr></thead>
              <tbody>{visible.map((entry) => {
                const raceClass = classesById.get(entry.classId);
                if (!raceClass) throw new Error("Validated participant class missing");
                return <tr key={entry.id}><td><button className={styles.participant} disabled={disabled}
                  aria-label={`${entry.displayName} ${entry.organisationName ?? text.none}`}
                  aria-pressed={entryId === entry.id} onClick={() => select(entry.id, false, false, paymentAttentionOnly ? "PAYMENT" : undefined)}>{entry.displayName}</button>
                  <div className={styles.rosterMetadata}>
                    <span className={styles.organisation} aria-hidden="true">{entry.organisationName ?? text.none}</span>
                    {entry.resultRevisionMarker === "MANUAL_FINISH_TIME_CORRECTION" && <span className={styles.resultBadge}>{text.rosterFinishCorrection}</span>}
                    {entry.resultRevisionMarker === "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL" && <span className={styles.resultBadge}>{text.rosterFinishCorrectionWithdrawal}</span>}
                    {entry.activeAssignment?.isRental && <span className={`${styles.resultBadge} ${entry.activeAssignment.rentalReturned ? "" : styles.resultBadgeAttention}`}>{text.rentalBadge} · {entry.activeAssignment.cardNumber} · {entry.activeAssignment.rentalReturned ? text.rentalReturned : text.rentalOutstanding}</span>}
                    {entry.paymentStatus !== "UNMARKED" && <span className={`${styles.resultBadge} ${needsPaymentAttention(entry.paymentStatus) ? styles.resultBadgeAttention : ""}`}>{text.paymentStatusBadge} · {text.paymentStatuses[entry.paymentStatus]}</span>}
                  </div>
                </td><td data-label={text.raceClass}>{raceClass.name}</td>
                <td data-label={text.rosterResult} className={styles.rosterResultCell}>
                  {entry.effectiveResult.state === "ACTIVE_RESULT"
                    ? <><span className={styles.rosterResultLine}>
                      <strong className={entry.effectiveResult.result.status === "MP" || entry.effectiveResult.result.status === "DSQ" ? styles.rosterCritical : undefined}>{sv.publicResultsStatusLabels[entry.effectiveResult.result.status]}</strong>
                      {"elapsedMs" in entry.effectiveResult.result && entry.effectiveResult.result.elapsedMs !== undefined &&
                        <span className={styles.rosterResultTime}>{resultDuration(entry.effectiveResult.result.elapsedMs)}</span>}
                    </span>{entry.resultFreshness === "OLDER_SNAPSHOT" &&
                      <span className={styles.rosterStale}>{text.rosterOlderResult}</span>}</>
                    : entry.effectiveResult.state === "NO_ACTIVE_RESULT" ? text.rosterNoActiveResult : text.rosterNoPublishedResult}
                </td>
                <td data-label={text.rosterCard} className={styles.cardCell}>{entry.multipleActiveAssignments
                  ? text.rosterMultipleActiveCards : entry.activeAssignment?.cardNumber ?? text.rosterNoActiveCard}</td>
                <td data-label={text.rosterStart} className={styles.startCell}>{raceClass.startRule === "PUNCH" ? text.rosterFreeStart :
                  <div className={styles.startDetail}><strong>{text.rosterFixedStart}</strong>
                    {entry.fixedStartTime
                      ? <time dateTime={entry.fixedStartTime}>{formatStartListTime(entry.fixedStartTime, data.timeZone)}</time>
                      : <><span className={styles.startMissing}>{text.rosterMissingFixedStart}</span>
                        <button type="button" className={styles.startSetButton} disabled={workflowLocked}
                          aria-label={text.rosterSetStartTimeFor(entry.displayName)}
                          onClick={() => openMissingStartTime(entry.id)}>{text.rosterSetStartTime}</button></>}
                  </div>}</td></tr>;
              })}</tbody>
            </table></div>
            {!filtered.length && <p>{paymentAttentionOnly && paymentAttentionCount === 0 ? text.rosterNoPaymentAttention : text.noMatches}</p>}
            {lastPage > 0 && <div className={styles.toolbar}><button className="secondary" disabled={disabled || currentPage === 0} onClick={() => setPage(currentPage - 1)}>{text.previousPage}</button>
              <span>{currentPage + 1} / {lastPage + 1}</span><button className="secondary" disabled={disabled || currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>{text.nextPage}</button></div>}
          </>}
        </section>
        <section className={styles.panel} aria-label={text.participantAction} data-panel="WORK" ref={workPanel} tabIndex={-1} id={`participant-work-${raceId}`}>
          {selected && selectedClass && action !== "REGISTRATION" && <section className={styles.selectedParticipantContext}
            aria-label={navigationText.selectedParticipantContext}>
            <span className={styles.selectedParticipantLabel}>{navigationText.selectedParticipantContext}</span>
            <strong>{selected.displayName}</strong>
            <span className={styles.selectedParticipantClass}>{selectedClass.name}</span>
          </section>}
          {selected && action !== "REGISTRATION" && <nav className={styles.participantSequence}
            aria-label={navigationText.participantSequence}>
            <button type="button" className="secondary" disabled={workflowLocked || selectedIndex <= 0}
              onClick={() => navigateParticipantSequence(-1)}>{navigationText.previousParticipant}</button>
            <span>{selectedIndex < 0 ? navigationText.participantOutsideSequence
              : navigationText.participantPosition(selectedIndex + 1, filtered.length)}</span>
            <button type="button" className="secondary"
              disabled={workflowLocked || selectedIndex < 0 || selectedIndex >= filtered.length - 1}
              onClick={() => navigateParticipantSequence(1)}>{navigationText.nextParticipant}</button>
          </nav>}
          {selected && data && action !== "REGISTRATION" && <RaceParticipantFacts entry={selected}
            raceClass={classesById.get(selected.classId)!} timeZone={data.timeZone} disabled={disabled} activeAction={action} onEdit={chooseAction} />}
          {!selected && action !== "REGISTRATION" && <p>{navigationText.selectedHelp}</p>}
          {selected && !attempt && !cardAttempt && !rentalAttempt && !rentalReturnAttempt && !rentalReuseAttempt && !paymentStatusAttempt && !timeAttempt && !recalculationAttempt && !capacityAttempt && !identityAttempt && !dnsAttempt && !dnfAttempt && !ntAttempt && !oocAttempt && !dsqAttempt && !approvalAttempt && <section className={styles.resultSummary} aria-label={text.effectiveResult}>
            {effectiveResult?.entryId === selected.id ? <>
              <p><strong className={effectiveResult.state === "ACTIVE_RESULT" && (effectiveResult.result.status === "MP" || effectiveResult.result.status === "DSQ") ? styles.rosterCritical : undefined}>{text.effectiveResult}: {effectiveResult.state === "ACTIVE_RESULT" ? sv.publicResultsStatusLabels[effectiveResult.result.status] : effectiveResult.state === "NO_ACTIVE_RESULT" ? text.noActiveResult : text.noPublishedResult}</strong>
                {effectiveResult.state === "ACTIVE_RESULT" && "elapsedMs" in effectiveResult.result && effectiveResult.result.elapsedMs !== undefined && <> · {resultDuration(effectiveResult.result.elapsedMs)}</>}</p>
              {effectiveResult.state === "ACTIVE_RESULT" && <>
                <p>{sv.publicResultsReasonLabels[effectiveResult.result.reason]}
                  {effectiveResult.governingDecision !== "NONE" && <> · {text.governingDecision}: <strong>{text.governingDecisions[effectiveResult.governingDecision]}</strong></>}</p>
                {selected.resultRevisionMarker !== null && <p><strong>{text.resultFinishCorrection}:</strong> {selected.resultRevisionMarker === "MANUAL_FINISH_TIME_CORRECTION"
                  ? text.rosterFinishCorrection : text.rosterFinishCorrectionWithdrawal}</p>}
                {effectiveResult.resultClass.id !== selected.classId && <p>{text.resultHistoricalClass}: {effectiveResult.resultClass.name}</p>}
                {effectiveResult.resultSnapshotVersion < effectiveResult.snapshotVersion && <>
                  <p className={styles.resultStale}>{text.resultStale}</p>
                  <button type="button" className="secondary" disabled={disabled}
                    aria-label={text.resultStaleOpenFor(selected.displayName)} onClick={() => openRecalculation(selected.id)}>
                    {text.resultStaleOpen}
                  </button>
                </>}
                <p>{text.resultRevision}: {effectiveResult.result.revision} · {text.selectedPublishedRevision}: {effectiveResult.selectedRevision.revision}</p>
              </>}
              <p className={styles.organisation}>{text.resultReadAt}: {formatStartListTime(effectiveResult.generatedAt, effectiveResult.timeZone)}</p>
            </> : <p>{effectiveResultError ? text.effectiveResultError : text.effectiveResultPending}</p>}
          </section>}
          {selected && selectedClass && data && action === "INFO" && <RaceParticipantCourse raceId={raceId}
            snapshotVersion={data.snapshotVersion} raceClass={selectedClass} disabled={workflowLocked}
            onUnauthorized={lock} onOpenCourse={openAssignedCourse} />}
          {action === "TRANSFER" && <><h2>{text.changeClass}</h2>
          <p className={styles.warning}>{text.limitation}</p>
          {attempt ? <div className={styles.review} role="alert"><h2>{text.review}</h2><p>{attempt.displayName}</p>
            <p>{attempt.previousClassName} → <strong>{attempt.className}</strong></p><p>{text.resultImpact}</p>
            <p>{text.previousTime}: {attempt.request.expectedFixedStartTime ?? text.noFixedTime}</p>
            <p>{text.startRule}: {attempt.request.expectedTargetStartRule === "FIXED" ? text.fixed : text.punch}</p>
            <p>{text.newTime}: <strong>{attempt.request.fixedStartTime ?? text.noFixedTime}</strong></p>
            {unknown && <p>{text.unknown}</p>}
            <button disabled={busy} onClick={() => void submit(attempt)}>{unknown ? text.retry : text.confirm}</button>
            {!unknown && <button className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setAttempt(undefined); }}>{text.cancel}</button>}
          </div> : selected ? <form className={styles.workspace} onSubmit={prepare}>
            <p>{text.previousTime}: {selected.fixedStartTime ?? text.noFixedTime}</p>
            <label>{text.targetClass}<select value={classId} disabled={disabled} required onChange={(event) => {
              setClassId(event.target.value); setStartDate(""); setStartClock(""); setStartOffset(""); setMessage("");
              void loadTransferStartSlots(event.target.value);
            }}>
              <option value="">{text.chooseClass}</option>{data?.classes.filter((row) => row.id !== selected.classId).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select></label>
            {target && <p>{text.startRule}: <strong>{target.startRule === "FIXED" ? text.fixed : text.punch}</strong></p>}
            {target && <p>{text.capacityCount}: {target.entryCount} / {target.maxEntries ?? text.unlimited} {targetFull && <strong>— {text.classFull}</strong>}</p>}
            {target?.startRule === "FIXED" && <>
              {transferStartSlots?.targetClassId === target.id && transferStartSlots.plan.status === "AVAILABLE" && <label>{text.transferSlotSelect}
                <select value={selectedTransferStartSlot} disabled={disabled} onChange={(event) => setSelectedTransferStartSlot(event.target.value)}>
                  <option value="">{text.transferSlotManual}</option>
                  {transferStartSlots.plan.slots.map(slot => <option key={slot.fixedStartTime} value={slot.fixedStartTime}>{formatStartListTime(slot.fixedStartTime, data?.timeZone ?? "Europe/Stockholm")}</option>)}
                </select>
              </label>}
              {transferStartSlots?.targetClassId === target.id && transferStartSlots.plan.status === "UNAVAILABLE" && <p className={styles.warning}>{text.transferSlotUnavailable}</p>}
              {data && <TargetClassStartTimes key={`${target.id}:${data.snapshotVersion}`} entries={data.entries} classId={target.id}
                timeZone={data.timeZone} proposedTime={parseStartTimeFields(startDate, startClock, startOffset)} />}
              <p>{text.timeContext}: {data?.raceDate} · {data?.timeZone}. {text.timeHelp}</p>
              <div className={styles.timeFields}>
                <label>{text.startDate}<input type="date" autoComplete="off" value={startDate} required={!selectedTransferStartSlot} disabled={disabled}
                  onChange={(event) => setStartDate(event.target.value)} /></label>
                <label>{text.startClock}<input type="text" autoComplete="off" placeholder="HH:MM:SS" value={startClock} required={!selectedTransferStartSlot} disabled={disabled}
                  onChange={(event) => setStartClock(event.target.value)} /></label>
                <label>{text.startOffset}<input type="text" autoComplete="off" placeholder="+02:00" value={startOffset} required={!selectedTransferStartSlot} disabled={disabled}
                  onChange={(event) => setStartOffset(event.target.value)} /></label>
              </div>
            </>}
            {target?.startRule === "PUNCH" && <p>{text.punchHelp}</p>}
            <p>{text.resultImpact}</p><button disabled={disabled || !classId || targetFull}>{text.inspect}</button>
          </form> : <p>{text.chooseEntry}</p>}</>}
          {action === "CARD" && <section className={styles.workspace} aria-label={text.cardTitle}>
            <h2>{text.cardTitle}</h2>
            {cardAttempt ? <div className={styles.review} role="alert"><h2>{text.cardReview}</h2>
              <p>{cardAttempt.displayName}</p>
              <p>{text.currentCard}: {cardAttempt.request.expectedAssignment?.cardNumber ?? text.noCard} → <strong>{cardAttempt.request.cardNumber}</strong></p>
              <p>{text.resultImpact}</p>{unknown && <p>{text.cardUnknown}</p>}
              <button disabled={busy} onClick={() => void submitCard(cardAttempt)}>{unknown ? text.retry : text.cardConfirm}</button>
              {!unknown && <button className="secondary" disabled={busy} onClick={() => {
                pending.current = undefined; sent.current = false; setCardAttempt(undefined);
              }}>{text.cancel}</button>}
            </div> : rentalAttempt ? <div className={styles.review} role="alert"><h2>{text.rentalReview}</h2>
              <p>{rentalAttempt.displayName} · {rentalAttempt.request.expectedAssignment.cardNumber}</p>
              <p><strong>{rentalAttempt.request.isRental ? text.rentalMarkConsequence : text.rentalUnmarkConsequence}</strong></p>
              {unknown && <p>{text.rentalUnknown}</p>}
              <button disabled={busy} onClick={() => void submitRental(rentalAttempt)}>{unknown ? text.retry : text.rentalConfirm}</button>
              {!unknown && <button className="secondary" disabled={busy} onClick={() => {
                pending.current = undefined; sent.current = false; setRentalAttempt(undefined);
              }}>{text.cancel}</button>}
            </div> : rentalReturnAttempt ? <div className={styles.review} role="alert"><h2>{text.rentalReturnReview}</h2>
              <p>{rentalReturnAttempt.displayName} · {rentalReturnAttempt.request.expectedAssignment.cardNumber}</p>
              <p><strong>{rentalReturnAttempt.request.rentalReturned ? text.rentalReturnConsequence : text.rentalReturnCorrectionConsequence}</strong></p>
              {unknown && <p>{text.rentalReturnUnknown}</p>}
              <button disabled={busy} onClick={() => void submitRentalReturn(rentalReturnAttempt)}>{unknown ? text.retry : text.rentalReturnConfirm}</button>
              {!unknown && <button className="secondary" disabled={busy} onClick={() => {
                pending.current = undefined; sent.current = false; setRentalReturnAttempt(undefined);
              }}>{text.cancel}</button>}
            </div> : rentalReuseAttempt ? <div className={styles.review} role="alert"><h2>{text.rentalReuseReview}</h2>
              <p>{text.rentalReuseSource}: {rentalReuseAttempt.sourceDisplayName} · {rentalReuseAttempt.request.source.assignment.cardNumber}</p>
              <p>{text.rentalReuseTarget}: <strong>{rentalReuseAttempt.displayName}</strong></p>
              <p><strong>{text.rentalReuseConsequence}</strong></p>
              {unknown && <p>{text.rentalReuseUnknown}</p>}
              <button disabled={busy} onClick={() => void submitRentalReuse(rentalReuseAttempt)}>{unknown ? text.retry : text.rentalReuseConfirm}</button>
              {!unknown && <button className="secondary" disabled={busy} onClick={() => {
                pending.current = undefined; sent.current = false; setRentalReuseAttempt(undefined);
              }}>{text.cancel}</button>}
            </div> : selected?.multipleActiveAssignments ? <p role="alert">{text.multipleCards}</p> : selected && <div className={styles.workspace}>
              <p>{text.rentalState}: <strong>{selected.activeAssignment?.isRental ? text.rental : text.notRental}</strong></p>
              <button type="button" className="secondary" disabled={disabled || !selected.activeAssignment} onClick={prepareRental}>
                {selected.activeAssignment?.isRental ? text.rentalUnmark : text.rentalMark}
              </button>
              {selected.activeAssignment?.isRental && <>
                <p>{text.rentalReturnState}: <strong>{selected.activeAssignment.rentalReturned ? text.rentalReturned : text.rentalOutstanding}</strong></p>
                <button type="button" className="secondary" disabled={disabled} onClick={prepareRentalReturn}>
                  {selected.activeAssignment.rentalReturned ? text.rentalReturnCorrect : text.rentalReturnMark}
                </button>
              </>}
              {!selected.activeAssignment && <>
                <p>{text.rentalNeedsCard}</p>
                <form className={styles.workspace} onSubmit={prepareRentalReuse}>
                  <label htmlFor="returned-rental-card">{text.rentalReuseCard}</label>
                  <select id="returned-rental-card" value={rentalReuseSourceId} disabled={disabled}
                    onChange={(event) => setRentalReuseSourceId(event.target.value)}>
                    <option value="">{text.rentalReuseChoose}</option>
                    {returnedRentalSources.map((entry) => <option key={entry.activeAssignment!.id} value={entry.activeAssignment!.id}>
                      {entry.activeAssignment!.cardNumber} · {entry.displayName}
                    </option>)}
                  </select>
                  {returnedRentalSources.length === 0 ? <p>{text.rentalReuseNone}</p> : <>
                    <p>{text.rentalReuseHelp}</p>
                    <button disabled={disabled || !rentalReuseSourceId}>{text.rentalReuseInspect}</button>
                  </>}
                </form>
              </>}
              <form className={styles.workspace} onSubmit={prepareCard}>
              <p>{text.currentCard}: <strong>{selected.activeAssignment?.cardNumber ?? text.noCard}</strong></p>
              <div className={styles.cardFields}>
                <label>{text.newCard}<input type="text" inputMode="numeric" autoComplete="off" spellCheck={false}
                  value={newCard} required disabled={disabled} onChange={(event) => setNewCard(event.target.value)} /></label>
                <button disabled={disabled || !newCard.trim()}>{text.cardInspect}</button>
              </div>
              <p>{text.cardHelp}</p>
              </form>
            </div>}
            {!selected && !cardAttempt && !rentalAttempt && !rentalReturnAttempt && !rentalReuseAttempt && <p>{text.chooseParticipant}</p>}
          </section>}
          {action === "PAYMENT" && <section className={styles.workspace} aria-label={text.paymentStatusAction}>
            <h2>{text.paymentStatusAction}</h2>
            {paymentStatusAttempt ? <div className={styles.review} role="alert"><h2>{text.paymentStatusReview}</h2>
              <p>{paymentStatusAttempt.displayName}</p>
              <p>{text.paymentStatusCurrent}: {text.paymentStatuses[paymentStatusAttempt.request.expectedPaymentStatus]} → <strong>{text.paymentStatuses[paymentStatusAttempt.request.paymentStatus]}</strong></p>
              <p><strong>{text.paymentStatusConsequence}</strong></p>
              {unknown && <p>{text.paymentStatusUnknown}</p>}
              <button disabled={busy} onClick={() => void submitPaymentStatus(paymentStatusAttempt)}>{unknown ? text.retry : text.paymentStatusConfirm}</button>
              {!unknown && <button className="secondary" disabled={busy} onClick={() => {
                pending.current = undefined; sent.current = false; setPaymentStatusAttempt(undefined);
              }}>{text.cancel}</button>}
            </div> : selected ? <form className={styles.workspace} onSubmit={preparePaymentStatus}>
              <p>{text.paymentStatusCurrent}: <strong>{text.paymentStatuses[selected.paymentStatus]}</strong></p>
              <label htmlFor="entry-payment-status">{text.paymentStatusNew}</label><select id="entry-payment-status" value={paymentStatus} disabled={disabled}
                onChange={(event) => setPaymentStatus(event.target.value as EntryPaymentStatus)}>
                <option value="UNMARKED">{text.paymentStatuses.UNMARKED}</option>
                <option value="UNPAID">{text.paymentStatuses.UNPAID}</option>
                <option value="PAID">{text.paymentStatuses.PAID}</option>
                <option value="WAIVED">{text.paymentStatuses.WAIVED}</option>
              </select>
              <p>{text.paymentStatusHelp}</p>
              <button disabled={disabled || paymentStatus === selected.paymentStatus}>{text.paymentStatusInspect}</button>
            </form> : <p>{text.chooseParticipant}</p>}
          </section>}
          {action === "TIME" && <section className={styles.workspace} aria-label={text.timeTitle}>
            <h2>{text.timeTitle}</h2>
            {timeAttempt ? <div className={styles.review} role="alert"><h2>{text.timeReview}</h2>
              <p>{timeAttempt.displayName} · {timeAttempt.timeZone}</p>
              <p>{text.previousTime}: {timeAttempt.request.expectedFixedStartTime === null ? text.noFixedTime : formatStartListTime(timeAttempt.request.expectedFixedStartTime, timeAttempt.timeZone)}</p>
              <p>{text.newTime}: <strong>{formatStartListTime(timeAttempt.request.fixedStartTime, timeAttempt.timeZone)}</strong></p>
              <p>{text.resultImpact}</p>{unknown && <p>{text.timeUnknown}</p>}
              <button disabled={busy} onClick={() => void submitTime(timeAttempt)}>{unknown ? text.retry : text.timeConfirm}</button>
              {!unknown && <button className="secondary" disabled={busy} onClick={() => {
                pending.current = undefined; sent.current = false; setTimeAttempt(undefined);
              }}>{text.cancel}</button>}
            </div> : selected && selectedClass?.startRule === "FIXED" && data ? <form className={styles.workspace} onSubmit={prepareTime}>
              <p>{text.previousTime}: {selected.fixedStartTime === null ? text.noFixedTime : formatStartListTime(selected.fixedStartTime, data.timeZone)}</p>
              <p>{text.timeContext}: {data.raceDate} · {data.timeZone}</p>
              <div className={styles.timeFields}>
                <label>{text.startDate}<input type="date" autoComplete="off" value={startDate} required disabled={disabled} onChange={(event) => setStartDate(event.target.value)} /></label>
                <label>{text.startClock}<input type="text" autoComplete="off" placeholder="HH:MM:SS" value={startClock} required disabled={disabled} onChange={(event) => setStartClock(event.target.value)} /></label>
                <label>{text.startOffset}<input type="text" autoComplete="off" placeholder="+02:00" value={startOffset} required disabled={disabled} onChange={(event) => setStartOffset(event.target.value)} /></label>
              </div>
              <p>{text.timeHelpOnly}</p><p>{text.resultImpact}</p>
              <button disabled={disabled}>{text.timeInspect}</button>
            </form> : <p>{selected ? text.timePunch : text.chooseParticipant}</p>}
          </section>}
          {action === "IDENTITY" && <section className={styles.workspace} aria-label={text.identityAction}>
            <h2>{text.identityAction}</h2>
            {identityAttempt ? <div className={styles.review} role="alert"><h2>{text.identityReview}</h2>
              <p>{text.givenName}: {identityAttempt.request.expectedIdentity.givenName} → <strong>{identityAttempt.request.identity.givenName}</strong></p>
              <p>{text.familyName}: {identityAttempt.request.expectedIdentity.familyName} → <strong>{identityAttempt.request.identity.familyName}</strong></p>
              <p>{text.organisation}: {identityAttempt.request.expectedIdentity.organisationName ?? text.none} → <strong>{identityAttempt.request.identity.organisationName ?? text.none}</strong></p>
              <p>{text.identityHelp}</p>{unknown && <p>{text.identityUnknown}</p>}
              <button disabled={busy} onClick={() => void submitIdentity(identityAttempt)}>{unknown ? text.retry : text.identityConfirm}</button>
              {!unknown && <button className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setIdentityAttempt(undefined); }}>{text.cancel}</button>}
            </div> : <>
              {!identityMatches && <button className="secondary" disabled={disabled} onClick={() => void loadIdentity()}>{text.identityRefresh}</button>}
              {!selected ? <p>{text.chooseParticipant}</p> : !identityMatches ? <p>{text.identityLoadError}</p> : <form className={styles.workspace} onSubmit={prepareIdentity}>
                <div className={styles.identityFields}>
                  <label>{text.givenName}<input autoComplete="off" value={givenName} required maxLength={160} disabled={disabled} onChange={(event) => setGivenName(event.target.value)} /></label>
                  <label>{text.familyName}<input autoComplete="off" value={familyName} required maxLength={160} disabled={disabled} onChange={(event) => setFamilyName(event.target.value)} /></label>
                  <label>{text.organisation}<input autoComplete="off" value={organisationName} list="administrator-clubs" disabled={disabled} onChange={(event) => setOrganisationName(event.target.value)} /></label>
                </div>
                <datalist id="administrator-clubs">{[...new Set(data?.entries.map((row) => row.organisationName).filter((name): name is string => name !== null))].sort().map((name) => <option key={name} value={name} />)}</datalist>
                <p>{text.identityHelp}</p><button disabled={disabled}>{text.identityInspect}</button>
              </form>}
            </>}
          </section>}
          {selected && data && <RaceResultControls result={effectiveResult?.entryId === selected.id ? effectiveResult : undefined}
            resultError={effectiveResultError} timeZone={data.timeZone} />}
          {selected && action !== "REGISTRATION" && <details className={styles.resultActions}
            open={(["RECALCULATION", "HISTORY", "DNS", "DNF", "DSQ", "OOC", "NT", "APPROVAL"] as Action[]).includes(action) || undefined}>
            <summary>{navigationText.resultActions}</summary>
            <div className={styles.actions} aria-label={text.participantAction}>
            <button type="button" className="secondary" aria-pressed={action === "RECALCULATION"} disabled={disabled} onClick={() => chooseAction("RECALCULATION")}>{text.recalculationAction}</button>
            <button type="button" className="secondary" aria-pressed={action === "HISTORY"} disabled={disabled} onClick={() => chooseAction("HISTORY")}>{text.historyAction}</button>
            <button type="button" className="secondary" aria-pressed={action === "DNS"} disabled={disabled} onClick={() => chooseAction("DNS")}>{text.dnsAction}</button>
            <button type="button" className="secondary" aria-pressed={action === "DNF"} disabled={disabled} onClick={() => chooseAction("DNF")}>{text.dnfAction}</button>
            <button type="button" className="secondary" aria-pressed={action === "DSQ"} disabled={disabled} onClick={() => chooseAction("DSQ")}>{text.dsqAction}</button>
            <button type="button" className="secondary" aria-pressed={action === "OOC"} disabled={disabled} onClick={() => chooseAction("OOC")}>{text.oocAction}</button>
            <button type="button" className="secondary" aria-pressed={action === "NT"} disabled={disabled} onClick={() => chooseAction("NT")}>{text.ntAction}</button>
            <button type="button" className="secondary" aria-pressed={action === "APPROVAL"} disabled={disabled} onClick={() => chooseAction("APPROVAL")}>{text.approvalAction}</button>
          </div></details>}
          {action === "APPROVAL" && <section className={styles.workspace} aria-label={text.approvalAction}>
            <h2>{text.approvalAction}</h2>{!approvalAttempt && <p>{text.approvalHelp}</p>}
            {approvalAttempt ? <div className={styles.review} role="alert">
              <h2>{approvalAttempt.kind === "APPROVAL" ? text.approvalReview : text.approvalWithdrawalReview}</h2>
              <p>{approvalAttempt.value.displayName} · {approvalAttempt.value.className}</p>
              <p><strong>{text.decisionStatusChange}: {approvalAttempt.kind === "APPROVAL"
                ? `${sv.publicResultsStatusLabels[approvalAttempt.value.request.expectedResultRevision.status]} → ${sv.publicResultsStatusLabels.OK}`
                : `${sv.publicResultsStatusLabels.OK} → ${sv.publicResultsStatusLabels[approvalAttempt.value.request.expectedRestorationSourceResultRevision.status]}`}</strong></p>
              {approvalAttempt.kind === "APPROVAL" ? <p>{sv.publicResultsReasonLabels[approvalAttempt.value.request.expectedResultRevision.reason]} → {sv.publicResultsReasonLabels.MANUAL_APPROVAL}</p> : <p>{sv.publicResultsReasonLabels[approvalAttempt.value.request.expectedRestorationSourceResultRevision.reason]}</p>}
              <p>{approvalAttempt.kind === "APPROVAL" || approvalAttempt.value.request.expectedRestorationSourceResultRevision.status === "OK" ? text.approvalRanked : text.approvalUnranked}</p>
              <p>{approvalAttempt.kind === "APPROVAL" ? text.approvalCompactConsequence : text.decisionWithdrawalConsequence}</p>
              <details key={approvalAttempt.value.requestId}>
                <summary>{text.decisionRevisionDetails}</summary>
                {approvalAttempt.kind === "APPROVAL" ? <>
                  <p>{text.approvalTarget}: {approvalAttempt.value.request.expectedResultRevision.revision}</p>
                  <p>{text.approvalDecisionWarning}</p>
                </> : <>
                  <p>{text.approvalTarget}: {approvalAttempt.value.request.expectedTargetResultRevision.revision} · {text.approvalDecisionRevision}: {approvalAttempt.value.request.expectedApprovedResultRevision.revision}</p>
                  <p>{text.approvalAbsolute}: {approvalAttempt.value.request.expectedAbsoluteResultRevision.revision}</p>
                  <p>{text.approvalSource}: {approvalAttempt.value.request.expectedRestorationSourceResultRevision.revision}</p>
                  <p>{text.approvalWithdrawalWarning}</p>
                </>}
              </details>
              {unknown && <p>{text.approvalUnknown}</p>}
              <button disabled={busy} onClick={() => void submitApproval(approvalAttempt)}>{unknown ? text.retry : approvalAttempt.kind === "APPROVAL" ? text.approvalConfirm : text.approvalWithdrawalConfirm}</button>
              {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setApprovalAttempt(undefined); }}>{text.cancel}</button>}
            </div> : <>
              <button type="button" className="secondary" disabled={disabled || !selected} onClick={() => void loadApproval()}>{text.approvalRefresh}</button>
              {!selected ? <p>{text.chooseParticipant}</p> : !approvalMatches ? <p>{text.approvalLoadError}</p> : <>
                {approvalCandidate && <p>{text.approvalReadiness[approvalCandidate.readiness]}</p>}
                {approvalCandidate?.targetResultRevision && <p>{text.approvalTarget}: {approvalCandidate.targetResultRevision.revision} · {sv.publicResultsStatusLabels[approvalCandidate.targetResultRevision.status]}</p>}
                {approvalCandidate?.readiness === "READY" && <button disabled={disabled} onClick={() => prepareApproval(false)}>{text.approvalInspect}</button>}
                {approvalWithdrawal ? <>
                  <p>{text.approvalWithdrawalReady}</p>
                  <p>{text.approvalSource}: {approvalWithdrawal.restorationSourceResultRevision.revision} · {sv.publicResultsStatusLabels[approvalWithdrawal.restorationSourceResultRevision.status]} · {text.approvalAbsolute}: {approvalWithdrawal.absoluteResultRevision.revision}</p>
                  <button disabled={disabled} onClick={() => prepareApproval(true)}>{text.approvalWithdrawalInspect}</button>
                </> : approvalHistory.some((row) => row.state === "WITHDRAWN") && <p>{text.approvalWithdrawn}</p>}
              </>}
            </>}
          </section>}
          {action === "DSQ" && <section className={styles.workspace} aria-label={text.dsqAction}>
            <h2>{text.dsqAction}</h2>{!dsqAttempt && <p>{text.dsqHelp}</p>}
            {dsqAttempt ? <div className={styles.review} role="alert">
              <h2>{dsqAttempt.kind === "DSQ" ? text.dsqReview : text.dsqWithdrawalReview}</h2>
              <p>{dsqAttempt.value.displayName} · {dsqAttempt.value.className}</p>
              <p><strong>{text.decisionStatusChange}: {dsqAttempt.kind === "DSQ"
                ? `${sv.publicResultsStatusLabels[dsqAttempt.value.request.expectedResultRevision.status]} → ${sv.publicResultsStatusLabels.DSQ}`
                : `${sv.publicResultsStatusLabels.DSQ} → ${sv.publicResultsStatusLabels[dsqAttempt.value.request.expectedRestorationSourceResultRevision.status]}`}</strong></p>
              {dsqAttempt.kind === "DSQ_WITHDRAWAL" && <p>{sv.publicResultsReasonLabels[dsqAttempt.value.request.expectedRestorationSourceResultRevision.reason]}</p>}
              <p>{dsqAttempt.kind === "DSQ" ? text.dsqCompactConsequence : text.decisionWithdrawalConsequence}</p>
              <details key={dsqAttempt.value.requestId}>
                <summary>{text.decisionRevisionDetails}</summary>
                {dsqAttempt.kind === "DSQ" ? <>
                  <p>{text.dsqTarget}: {dsqAttempt.value.request.expectedResultRevision.revision}</p>
                  <p>{text.dsqDecisionWarning}</p>
                </> : <>
                  <p>{text.dsqTarget}: {dsqAttempt.value.request.expectedTargetResultRevision.revision} · {text.dsqDecisionRevision}: {dsqAttempt.value.request.expectedDisqualifiedResultRevision.revision}</p>
                  <p>{text.dsqAbsolute}: {dsqAttempt.value.request.expectedAbsoluteResultRevision.revision}</p>
                  <p>{text.dsqSource}: {dsqAttempt.value.request.expectedRestorationSourceResultRevision.revision}</p>
                  <p>{text.dsqWithdrawalWarning}</p>
                </>}
              </details>
              {unknown && <p>{text.dsqUnknown}</p>}
              <button disabled={busy} onClick={() => void submitDsq(dsqAttempt)}>{unknown ? text.retry : dsqAttempt.kind === "DSQ" ? text.dsqConfirm : text.dsqWithdrawalConfirm}</button>
              {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setDsqAttempt(undefined); }}>{text.cancel}</button>}
            </div> : <>
              <button type="button" className="secondary" disabled={disabled || !selected} onClick={() => void loadDsq()}>{text.dsqRefresh}</button>
              {!selected ? <p>{text.chooseParticipant}</p> : !dsqMatches ? <p>{text.dsqLoadError}</p> : <>
                {dsqCandidate && <p>{text.dsqReadiness[dsqCandidate.readiness]}</p>}
                {dsqCandidate?.targetResultRevision && <p>{text.dsqTarget}: {dsqCandidate.targetResultRevision.revision} · {sv.publicResultsStatusLabels[dsqCandidate.targetResultRevision.status]}</p>}
                {dsqCandidate?.readiness === "READY" && <button disabled={disabled} onClick={() => prepareDsq(false)}>{text.dsqInspect}</button>}
                {dsqWithdrawal ? <>
                  <p>{text.dsqWithdrawalReady}</p>
                  <p>{text.dsqSource}: {dsqWithdrawal.restorationSourceResultRevision.revision} · {sv.publicResultsStatusLabels[dsqWithdrawal.restorationSourceResultRevision.status]} · {text.dsqAbsolute}: {dsqWithdrawal.absoluteResultRevision.revision}</p>
                  <button disabled={disabled} onClick={() => prepareDsq(true)}>{text.dsqWithdrawalInspect}</button>
                </> : dsqHistory.some((row) => row.state === "WITHDRAWN") && <p>{text.dsqWithdrawn}</p>}
              </>}
            </>}
          </section>}
          {action === "NT" && <section className={styles.workspace} aria-label={text.ntAction}>
            <h2>{text.ntAction}</h2>{!ntAttempt && <p>{text.ntHelp}</p>}
            {ntAttempt ? <div className={styles.review} role="alert">
              <h2>{ntAttempt.kind === "NT" ? text.ntReview : text.ntWithdrawalReview}</h2>
              <p>{ntAttempt.value.displayName} · {ntAttempt.value.className}</p>
              <p><strong>{text.decisionStatusChange}: {ntAttempt.kind === "NT"
                ? `${sv.publicResultsStatusLabels[ntAttempt.value.request.expectedResultRevision.status]} → ${sv.publicResultsStatusLabels.NT}`
                : `${sv.publicResultsStatusLabels.NT} → ${sv.publicResultsStatusLabels[ntAttempt.value.request.expectedRestorationSourceResultRevision.status]}`}</strong></p>
              {ntAttempt.kind === "NT_WITHDRAWAL" && <p>{sv.publicResultsReasonLabels[ntAttempt.value.request.expectedRestorationSourceResultRevision.reason]}</p>}
              <p>{ntAttempt.kind === "NT" ? text.ntCompactConsequence : text.decisionWithdrawalConsequence}</p>
              <details key={ntAttempt.value.requestId}>
                <summary>{text.decisionRevisionDetails}</summary>
                {ntAttempt.kind === "NT" ? <>
                  <p>{text.ntTarget}: {ntAttempt.value.request.expectedResultRevision.revision}</p>
                  <p>{text.ntDecisionWarning}</p>
                </> : <>
                  <p>{text.ntTarget}: {ntAttempt.value.request.expectedTargetResultRevision.revision} · {text.ntDecisionRevision}: {ntAttempt.value.request.expectedWithoutTimingResultRevision.revision}</p>
                  <p>{text.ntAbsolute}: {ntAttempt.value.request.expectedAbsoluteResultRevision.revision}</p>
                  <p>{text.ntSource}: {ntAttempt.value.request.expectedRestorationSourceResultRevision.revision}</p>
                  <p>{text.ntWithdrawalWarning}</p>
                </>}
              </details>
              {unknown && <p>{text.ntUnknown}</p>}
              <button disabled={busy} onClick={() => void submitNt(ntAttempt)}>{unknown ? text.retry : ntAttempt.kind === "NT" ? text.ntConfirm : text.ntWithdrawalConfirm}</button>
              {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setNtAttempt(undefined); }}>{text.cancel}</button>}
            </div> : <>
              <button type="button" className="secondary" disabled={disabled || !selected} onClick={() => void loadNt()}>{text.ntRefresh}</button>
              {!selected ? <p>{text.chooseParticipant}</p> : !ntMatches ? <p>{text.ntLoadError}</p> : <>
                {ntCandidate && <p>{text.ntReadiness[ntCandidate.readiness]}</p>}
                {ntCandidate?.targetResultRevision && <p>{text.ntTarget}: {ntCandidate.targetResultRevision.revision} · {sv.publicResultsStatusLabels[ntCandidate.targetResultRevision.status]}</p>}
                {ntCandidate?.readiness === "READY" && <button disabled={disabled} onClick={() => prepareNt(false)}>{text.ntInspect}</button>}
                {ntWithdrawal ? <>
                  <p>{text.ntWithdrawalReady}</p>
                  <p>{text.ntSource}: {ntWithdrawal.restorationSourceResultRevision.revision} · {sv.publicResultsStatusLabels[ntWithdrawal.restorationSourceResultRevision.status]} · {text.ntAbsolute}: {ntWithdrawal.absoluteResultRevision.revision}</p>
                  <button disabled={disabled} onClick={() => prepareNt(true)}>{text.ntWithdrawalInspect}</button>
                </> : ntHistory.some((row) => row.state === "WITHDRAWN") && <p>{text.ntWithdrawn}</p>}
              </>}
            </>}
          </section>}
          {action === "OOC" && <section className={styles.workspace} aria-label={text.oocAction}>
            <h2>{text.oocAction}</h2>{!oocAttempt && <p>{text.oocHelp}</p>}
            {oocAttempt ? <div className={styles.review} role="alert">
              <h2>{oocAttempt.kind === "OOC" ? text.oocReview : text.oocWithdrawalReview}</h2>
              <p>{oocAttempt.value.displayName} · {oocAttempt.value.className}</p>
              <p><strong>{text.decisionStatusChange}: {oocAttempt.kind === "OOC"
                ? `${sv.publicResultsStatusLabels[oocAttempt.value.request.expectedResultRevision.status]} → ${sv.publicResultsStatusLabels.OOC}`
                : `${sv.publicResultsStatusLabels.OOC} → ${sv.publicResultsStatusLabels[oocAttempt.value.request.expectedRestorationSourceResultRevision.status]}`}</strong></p>
              {oocAttempt.kind === "OOC_WITHDRAWAL" && <p>{sv.publicResultsReasonLabels[oocAttempt.value.request.expectedRestorationSourceResultRevision.reason]}</p>}
              <p>{oocAttempt.kind === "OOC" ? text.oocCompactConsequence : text.decisionWithdrawalConsequence}</p>
              <details key={oocAttempt.value.requestId}>
                <summary>{text.decisionRevisionDetails}</summary>
                {oocAttempt.kind === "OOC" ? <>
                  <p>{text.oocTarget}: {oocAttempt.value.request.expectedResultRevision.revision}</p>
                  <p>{text.oocDecisionWarning}</p>
                </> : <>
                  <p>{text.oocTarget}: {oocAttempt.value.request.expectedTargetResultRevision.revision} · {text.oocDecisionRevision}: {oocAttempt.value.request.expectedOutOfCompetitionResultRevision.revision}</p>
                  <p>{text.oocAbsolute}: {oocAttempt.value.request.expectedAbsoluteResultRevision.revision}</p>
                  <p>{text.oocSource}: {oocAttempt.value.request.expectedRestorationSourceResultRevision.revision}</p>
                  <p>{text.oocWithdrawalWarning}</p>
                </>}
              </details>
              {unknown && <p>{text.oocUnknown}</p>}
              <button disabled={busy} onClick={() => void submitOoc(oocAttempt)}>{unknown ? text.retry : oocAttempt.kind === "OOC" ? text.oocConfirm : text.oocWithdrawalConfirm}</button>
              {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setOocAttempt(undefined); }}>{text.cancel}</button>}
            </div> : <>
              <button type="button" className="secondary" disabled={disabled || !selected} onClick={() => void loadOoc()}>{text.oocRefresh}</button>
              {!selected ? <p>{text.chooseParticipant}</p> : !oocMatches ? <p>{text.oocLoadError}</p> : <>
                {oocCandidate && <p>{text.oocReadiness[oocCandidate.readiness]}</p>}
                {oocCandidate?.targetResultRevision && <p>{text.oocTarget}: {oocCandidate.targetResultRevision.revision} · {sv.publicResultsStatusLabels[oocCandidate.targetResultRevision.status]}</p>}
                {oocCandidate?.readiness === "READY" && <button disabled={disabled} onClick={() => prepareOoc(false)}>{text.oocInspect}</button>}
                {oocWithdrawal ? <>
                  <p>{text.oocWithdrawalReady}</p>
                  <p>{text.oocSource}: {oocWithdrawal.restorationSourceResultRevision.revision} · {sv.publicResultsStatusLabels[oocWithdrawal.restorationSourceResultRevision.status]} · {text.oocAbsolute}: {oocWithdrawal.absoluteResultRevision.revision}</p>
                  <button disabled={disabled} onClick={() => prepareOoc(true)}>{text.oocWithdrawalInspect}</button>
                </> : oocHistory.some((row) => row.state === "WITHDRAWN") && <p>{text.oocWithdrawn}</p>}
              </>}
            </>}
          </section>}
          {action === "DNF" && <section className={styles.workspace} aria-label={text.dnfAction}>
            <h2>{text.dnfAction}</h2>{!dnfAttempt && <p>{text.dnfHelp}</p>}
            {dnfAttempt ? <div className={styles.review} role="alert">
              <h2>{dnfAttempt.kind === "DNF" ? text.dnfReview : text.dnfWithdrawalReview}</h2>
              <p>{dnfAttempt.value.displayName} · {dnfAttempt.value.className}</p>
              <p><strong>{text.decisionStatusChange}: {dnfAttempt.kind === "DNF"
                ? `${sv.publicResultsStatusLabels[dnfAttempt.value.request.expectedResultRevision.status]} → ${sv.publicResultsStatusLabels.DNF}`
                : `${sv.publicResultsStatusLabels.DNF} → ${sv.publicResultsStatusLabels[dnfAttempt.value.request.expectedRestorationSourceResultRevision.status]}`}</strong></p>
              {dnfAttempt.kind === "DNF_WITHDRAWAL" && <p>{sv.publicResultsReasonLabels[dnfAttempt.value.request.expectedRestorationSourceResultRevision.reason]}</p>}
              <p>{dnfAttempt.kind === "DNF" ? text.dnfCompactConsequence : text.decisionWithdrawalConsequence}</p>
              <details key={dnfAttempt.value.requestId}>
                <summary>{text.decisionRevisionDetails}</summary>
                {dnfAttempt.kind === "DNF" ? <>
                  <p>{text.dnfTarget}: {dnfAttempt.value.request.expectedResultRevision.revision}</p>
                  <p>{text.dnfDecisionWarning}</p>
                </> : <>
                  <p>{text.dnfTarget}: {dnfAttempt.value.request.expectedTargetResultRevision.revision} · {text.dnfDecisionRevision}: {dnfAttempt.value.request.expectedDidNotFinishResultRevision.revision}</p>
                  <p>{text.dnfAbsolute}: {dnfAttempt.value.request.expectedAbsoluteResultRevision.revision}</p>
                  <p>{text.dnfSource}: {dnfAttempt.value.request.expectedRestorationSourceResultRevision.revision}</p>
                  <p>{text.dnfWithdrawalWarning}</p>
                </>}
              </details>
              {unknown && <p>{text.dnfUnknown}</p>}
              <button disabled={busy} onClick={() => void submitDnf(dnfAttempt)}>{unknown ? text.retry : dnfAttempt.kind === "DNF" ? text.dnfConfirm : text.dnfWithdrawalConfirm}</button>
              {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setDnfAttempt(undefined); }}>{text.cancel}</button>}
            </div> : <>
              <button type="button" className="secondary" disabled={disabled || !selected} onClick={() => void loadDnf()}>{text.dnfRefresh}</button>
              {!selected ? <p>{text.chooseParticipant}</p> : !dnfMatches ? <p>{text.dnfLoadError}</p> : <>
                {dnfCandidate && <p>{text.dnfReadiness[dnfCandidate.readiness]}</p>}
                {dnfCandidate?.targetResultRevision && <p>{text.dnfTarget}: {dnfCandidate.targetResultRevision.revision} · {sv.publicResultsStatusLabels[dnfCandidate.targetResultRevision.status]}</p>}
                {dnfCandidate?.readiness === "READY" && <button disabled={disabled} onClick={() => prepareDnf(false)}>{text.dnfInspect}</button>}
                {dnfWithdrawal ? <>
                  <p>{text.dnfWithdrawalReady}</p>
                  <p>{text.dnfSource}: {dnfWithdrawal.restorationSourceResultRevision.revision} · {sv.publicResultsStatusLabels[dnfWithdrawal.restorationSourceResultRevision.status]} · {text.dnfAbsolute}: {dnfWithdrawal.absoluteResultRevision.revision}</p>
                  <button disabled={disabled} onClick={() => prepareDnf(true)}>{text.dnfWithdrawalInspect}</button>
                </> : dnfHistory.some((row) => row.state === "WITHDRAWN") && <p>{text.dnfWithdrawn}</p>}
              </>}
            </>}
          </section>}
          {action === "DNS" && <section className={styles.workspace} aria-label={text.dnsAction}>
            <h2>{text.dnsAction}</h2><p>{text.dnsHelp}</p>
            {dnsAttempt ? <div className={styles.review} role="alert">
              <h2>{dnsAttempt.kind === "DNS" ? text.dnsReview : text.dnsWithdrawalReview}</h2>
              <p>{dnsAttempt.value.displayName} · {dnsAttempt.value.className}</p>
              <p>{dnsAttempt.kind === "DNS" ? text.dnsDecisionWarning : text.dnsWithdrawalWarning}</p>
              {unknown && <p>{text.dnsUnknown}</p>}
              <button disabled={busy} onClick={() => void submitDns(dnsAttempt)}>{unknown ? text.retry : dnsAttempt.kind === "DNS" ? text.dnsConfirm : text.dnsWithdrawalConfirm}</button>
              {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setDnsAttempt(undefined); }}>{text.cancel}</button>}
            </div> : <>
              <button type="button" className="secondary" disabled={disabled || !selected} onClick={() => void loadDns()}>{text.dnsRefresh}</button>
              {!selected ? <p>{text.chooseParticipant}</p> : !dnsMatches ? <p>{text.dnsLoadError}</p> : <>
                <p>{dnsCandidate?.readiness === "READY" ? text.dnsReady : text.dnsHasResult}</p>
                {dnsCandidate?.readiness === "READY" && <button disabled={disabled} onClick={() => prepareDns(false)}>{text.dnsInspect}</button>}
                {dnsWithdrawal && <p>{text.dnsWithdrawalStates[dnsWithdrawal.state]}</p>}
                {dnsWithdrawal?.state === "WITHDRAWABLE" && <button disabled={disabled} onClick={() => prepareDns(true)}>{text.dnsWithdrawalInspect}</button>}
              </>}
            </>}
          </section>}
          {action === "HISTORY" && <section className={styles.workspace} aria-label={text.historyAction}>
            <h2>{text.historyAction}</h2><p>{text.historyHelp}</p>
            <button type="button" className="secondary" disabled={disabled || !selected} onClick={() => void loadHistory()}>{text.historyRefresh}</button>
            {!selected ? <p>{text.chooseParticipant}</p> : entryChanges?.entryId === selected.id ? <>
              <AdministratorEntryChanges data={entryChanges} />
              {entryChanges.nextBeforeVersion !== null && <button type="button" className="secondary" disabled={disabled}
                onClick={() => void loadHistory(selected.id, entryChanges.nextBeforeVersion ?? undefined)}>{text.historyOlder}</button>}
            </> : <p>{text.historyNotLoaded}</p>}
          </section>}
          {action === "REGISTRATION" && <section className={styles.workspace} aria-label={text.registrationTitle}>
            <h2>{text.registrationTitle}</h2>
            {registrationAttempt ? <div className={styles.review} role="alert"><h2>{text.registrationReview}</h2>
              <p>{registrationAttempt.request.givenName} {registrationAttempt.request.familyName} · {registrationAttempt.className}</p>
              <p>{text.organisation}: {registrationAttempt.request.organisationName ?? text.none} · {text.registrationCard}: {registrationAttempt.request.cardNumber ?? text.noCard}</p>
              <p>{text.startRule}: {registrationAttempt.request.expectedStartRule === "FIXED" ? text.fixed : text.punch}</p>
              <p>{text.newTime}: {registrationAttempt.request.fixedStartTime === null ? text.noFixedTime : formatStartListTime(registrationAttempt.request.fixedStartTime, registrationAttempt.timeZone)}</p>
              <p>{text.registrationHelp}</p>{unknown && <p>{text.registrationUnknown}</p>}
              {!unknown && !sent.current && <div className={styles.workspace}>
                <p>{text.registrationMatches}: {registrationAttempt.candidates.totalMatches} · {text.shown}: {registrationAttempt.candidates.candidates.length}</p>
                {registrationAttempt.candidates.candidates.length > 0 && <ul className={styles.duplicateList}>{registrationAttempt.candidates.candidates.map((row) => <li key={row.entryId}>
                  <p><strong>{row.givenName} {row.familyName}</strong> · {row.className} · {row.organisationName ?? text.none}</p>
                  <p>{row.reasons.map((reason) => text.registrationReasons[reason]).join(" · ")}</p>
                  <button type="button" className="secondary" disabled={busy} onClick={() => selectRegistrationCandidate(row.entryId)}>{text.registrationSelectExisting}: {row.givenName} {row.familyName}</button>
                </li>)}</ul>}
                {registrationAttempt.candidates.candidates.some((row) => row.reasons.includes("CARD_ALREADY_ASSIGNED")) ? <p className={styles.warning}>{text.registrationCardConflict}</p> :
                  registrationAttempt.candidates.candidates.some((row) => row.reasons.includes("SAME_NAME")) && <label className={styles.confirmPerson}>
                    <input type="checkbox" checked={confirmDistinctPerson} disabled={busy} onChange={(event) => setConfirmDistinctPerson(event.target.checked)} />{text.registrationDistinctPerson}
                  </label>}
              </div>}
              <button disabled={busy || (!sent.current && (registrationAttempt.candidates.candidates.some((row) => row.reasons.includes("CARD_ALREADY_ASSIGNED")) ||
                (registrationAttempt.candidates.candidates.some((row) => row.reasons.includes("SAME_NAME")) && !confirmDistinctPerson)))} onClick={() => void submitRegistration(registrationAttempt)}>{unknown ? text.retry : text.registrationConfirm}</button>
              {!unknown && <button className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setRegistrationAttempt(undefined); }}>{text.cancel}</button>}
            </div> : data ? <form className={styles.workspace} onSubmit={(event) => void prepareRegistration(event)}>
              <label>{text.registrationClass}<select value={classId} required disabled={disabled} onChange={(event) => {
                const value = event.target.value; setClassId(value); setStartDate(""); setStartClock(""); setStartOffset(""); void loadRegistrationStartSlots(value);
              }}><option value="">{text.chooseClass}</option>{data.classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
              {target && <p>{text.capacityCount}: {target.entryCount} / {target.maxEntries ?? text.unlimited} {targetFull && <strong>— {text.classFull}</strong>}</p>}
              <div className={styles.identityFields}>
                <label>{text.givenName}<input value={givenName} required maxLength={160} autoComplete="off" disabled={disabled} onChange={(event) => setGivenName(event.target.value)} /></label>
                <label>{text.familyName}<input value={familyName} required maxLength={160} autoComplete="off" disabled={disabled} onChange={(event) => setFamilyName(event.target.value)} /></label>
                <label>{text.organisation}<input value={organisationName} maxLength={200} autoComplete="off" disabled={disabled} onChange={(event) => setOrganisationName(event.target.value)} /></label>
              </div>
              <label>{text.registrationCard}<input value={newCard} inputMode="numeric" maxLength={32} autoComplete="off" disabled={disabled} onChange={(event) => setNewCard(event.target.value)} /></label>
              {target && <p>{text.startRule}: {target.startRule === "FIXED" ? text.fixed : text.punch}</p>}
              {target?.startRule === "FIXED" && <>
                <p>{text.timeContext}: {data.raceDate} · {data.timeZone}</p>
                {registrationStartSlots?.targetClassId === target.id && registrationStartSlots.plan.status === "AVAILABLE" && <label>{text.registrationLottedSlot}
                  <select value={selectedRegistrationStartSlot} disabled={disabled} onChange={(event) => setSelectedRegistrationStartSlot(event.target.value)}>
                    <option value="">{text.registrationManualTime}</option>
                    {registrationStartSlots.plan.slots.map(slot => <option key={slot.fixedStartTime} value={slot.fixedStartTime}>{formatStartListTime(slot.fixedStartTime, data.timeZone)}</option>)}
                  </select>
                </label>}
                {registrationStartSlots?.targetClassId === target.id && registrationStartSlots.plan.status === "UNAVAILABLE" && <p className={styles.warning}>{text.registrationSlotUnavailable}</p>}
                {!selectedRegistrationStartSlot && <div className={styles.timeFields}>
                  <label>{text.startDate}<input type="date" value={startDate} required autoComplete="off" disabled={disabled} onChange={(event) => setStartDate(event.target.value)} /></label>
                  <label>{text.startClock}<input value={startClock} required placeholder="HH:MM:SS" autoComplete="off" disabled={disabled} onChange={(event) => setStartClock(event.target.value)} /></label>
                  <label>{text.startOffset}<input value={startOffset} required placeholder="+02:00" autoComplete="off" disabled={disabled} onChange={(event) => setStartOffset(event.target.value)} /></label>
                </div>}
              </>}
              <p>{text.registrationHelp}</p><button disabled={disabled || !target || targetFull}>{text.registrationInspect}</button>
            </form> : <p>{text.error}</p>}
          </section>}
          {action === "RECALCULATION" && <section className={styles.workspace} aria-label={text.recalculationAction}>
            <h2>{text.recalculationAction}</h2><p className={styles.warning}>{text.recalculationWarning}</p>
            {recalculationAttempt ? <div className={styles.review} role="alert"><h2>{text.recalculationReview}</h2>
              <p>{recalculationAttempt.value.displayName} · {recalculationAttempt.value.className}</p>
              <p>{text.latestReadout}: {formatStartListTime(recalculationAttempt.value.readAt, recalculationAttempt.timeZone)}</p>
              <p>{text.snapshot}: {recalculationAttempt.value.expectedSnapshotVersion} · {text.engine}: {recalculationAttempt.value.expectedEngineVersion}</p>
              <p>{text.latestRevision}: {recalculationAttempt.value.expectedLatestResultRevision?.revision ?? text.noRevision}</p>
              {unknown && <p>{text.recalculationUnknown}</p>}
              <button disabled={busy} onClick={() => void submitRecalculation(recalculationAttempt)}>{unknown ? text.retry : text.recalculationConfirm}</button>
              {!unknown && <button className="secondary" disabled={busy} onClick={() => {
                pending.current = undefined; sent.current = false; setRecalculationAttempt(undefined);
              }}>{text.cancel}</button>}
            </div> : <>
              <button className="secondary" disabled={disabled} onClick={() => void loadRecalculation()}>{text.recalculationRefresh}</button>
              {!selected ? <p>{text.chooseParticipant}</p> : !recalculationMatches || !recalculationCandidate || !data ? <p>{text.recalculationLoadError}</p> : <>
                <p>{text.snapshot}: {recalculationCandidates?.snapshotVersion} · {text.engine}: {recalculationCandidates?.engineVersion}</p>
                <p>{text.latestRevision}: {recalculationCandidate.latestResultRevision ? `${recalculationCandidate.latestResultRevision.revision} · ${recalculationCandidate.latestResultRevision.status}/${recalculationCandidate.latestResultRevision.reason}` : text.noRevision}</p>
                {recalculationCandidate.latestReadout && <p>{text.latestReadout}: {formatStartListTime(recalculationCandidate.latestReadout.readAt, data.timeZone)}</p>}
                {recalculationCandidate.readiness === "READY" ? <button disabled={disabled} onClick={prepareRecalculation}>{text.recalculationInspect}</button> : <p>{text.recalculationReadiness[recalculationCandidate.readiness]}</p>}
              </>}
            </>}
          </section>}
          {authenticated && selected && <details className={styles.claimPanel} open={participantActionPending || undefined}
            onToggle={event => { if (participantActionPending && !event.currentTarget.open) event.currentTarget.open = true; }}>
            <summary>{text.claimOptionalSummary}</summary>
            <ParticipantEntryClaimAdmin key={`${raceId}:${selected.id}`} raceId={raceId} entryId={selected.id}
              displayName={selected.displayName} onPendingChange={setParticipantActionPending} />
          </details>}
        </section>
      </div>
      </section>
      <section className={styles.workflowGroup} aria-label={navigationText.preparation.CLASSES} hidden={workflowMode !== "BEFORE" || preparationArea !== "CLASSES"}>
      {workflowMode === "BEFORE" && preparationArea === "CLASSES" && data &&
        <RaceClassOverview data={data} disabled={workflowLocked} onMissingFixedStart={openMissingFixedStart}
          onReturnToCourses={returnToCourses} onOpenCourse={openClassCourse} onOpenClass={openClassSetup}
          onOpenParticipants={openClassParticipants}
          selectedClassId={courseWarningClassId}
          selectionReason={courseSelectionReason} />}
      <details className={styles.manualClassPanel} open={manualClassReview || manualClassAttempt ? true : undefined}
        onToggle={event => { if ((manualClassReview || manualClassAttempt) && !event.currentTarget.open) event.currentTarget.open = true; }}>
        <summary>{text.manualClassTitle}</summary>
        <div className={styles.manualClassBody}>
          <p>{text.manualClassHelp}</p>
          {manualClassTargets.length === 0 ? <p>{text.manualClassNoTargets}{" "}
            <button type="button" className="secondary" disabled={workflowLocked} onClick={() => setPreparationArea("COURSES")}>{text.manualClassGoCourses}</button>
          </p> : <form onSubmit={inspectManualClass}>
            <div className={styles.manualClassFields}>
              <label>{text.manualClassName}<input value={manualClassName} maxLength={160} required autoComplete="off"
                disabled={workflowLocked}
                onChange={event => setManualClassName(event.target.value)} /></label>
              <label>{text.manualClassTarget}<select value={manualClassCourseVersionId} required
                disabled={workflowLocked}
                onChange={event => setManualClassCourseVersionId(event.target.value)}>
                <option value="">{text.manualClassChooseTarget}</option>
                {manualClassTargets.map(target => <option key={target.courseVersionId} value={target.courseVersionId}>
                  {text.manualClassTargetLabel(target.courseName, target.courseVersion,
                    data!.classes.findIndex(row => row.courseVersionId === target.courseVersionId) + 1)}
                </option>)}
              </select></label>
              <label>{text.manualClassStartRule}<select value={manualClassStartRule}
                disabled={workflowLocked}
                onChange={event => setManualClassStartRule(event.target.value as ManualClassCreateRequest["startRule"])}>
                <option value="PUNCH">{text.courseFreeStart}</option><option value="FIXED">{text.courseFixedStart}</option>
              </select></label>
            </div>
            {manualClassError && <p className={styles.warning} role="alert">{manualClassError}</p>}
            {!manualClassReview && !manualClassAttempt && <button type="submit" disabled={workflowLocked}>{text.manualClassInspect}</button>}
          </form>}
          {manualClassReview && !manualClassAttempt && <section className={styles.review} role="alert" aria-live="polite">
            <h2>{text.manualClassReview}</h2>
            <p><strong>{text.manualClassName}:</strong> {manualClassReview.request.className}</p>
            <p><strong>{text.manualClassTarget}:</strong> {manualClassReview.targetLabel}</p>
            <p><strong>{text.manualClassStartRule}:</strong> {manualClassReview.request.startRule === "PUNCH" ? text.courseFreeStart : text.courseFixedStart}</p>
            {manualClassReview.request.startRule === "FIXED" && <p>{text.courseFixedStartHelp}</p>}
            <p>{text.courseClassNotSaved}</p>
            <div className={styles.actions}>
              <button type="button" disabled={busy} onClick={() => {
                pending.current = manualClassReview; sent.current = false; setManualClassAttempt(manualClassReview);
                void submitManualClass(manualClassReview);
              }}>{text.manualClassConfirm}</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => setManualClassReview(undefined)}>{text.courseClassEdit}</button>
            </div>
          </section>}
          {manualClassAttempt && <section className={styles.review} role="alert" aria-live="polite">
            <h2>{text.manualClassRetryTitle}</h2>
            <p><strong>{text.manualClassName}:</strong> {manualClassAttempt.request.className}</p>
            <p><strong>{text.manualClassTarget}:</strong> {manualClassAttempt.targetLabel}</p>
            <p><strong>{text.manualClassStartRule}:</strong> {manualClassAttempt.request.startRule === "PUNCH" ? text.courseFreeStart : text.courseFixedStart}</p>
            <button type="button" disabled={busy} onClick={() => void submitManualClass(manualClassAttempt)}>{text.retry}</button>
          </section>}
        </div>
      </details>
      <details ref={classNamePanel} className={styles.classNamePanel}
        open={classNameReview || classNameAttempt ? true : undefined}
        onToggle={event => {
          if (!event.currentTarget.open) {
            if (classNameReview || classNameAttempt) event.currentTarget.open = true;
            return;
          }
          if (workflowLocked && !classNameReview && !classNameAttempt) { event.currentTarget.open = false; return; }
          if (classNameClassId && !classNameCandidate && !classNameReview && !classNameAttempt) {
            void loadClassNameCandidate(classNameClassId);
          }
        }}>
        <summary>{text.classNameTitle}{classNameSelected ? ` · ${classNameSelected.name}` : ""}</summary>
        <div className={styles.classNameBody}>
          {(!classNameClassId || !classNameSelected) && !classNameAttempt && !classNameReview ? <p>{text.classNameChooseClass}</p> : <>
            <p>{text.classNameHelp}</p>
            {classNameError && <p className={styles.warning} role="alert">{classNameError}</p>}
            {classNameAttempt ? <section className={styles.review} role="alert" aria-live="polite">
              <h2>{text.classNameRetryTitle}</h2>
              <p>{classNameAttempt.request.expectedClassName} → <strong>{classNameAttempt.request.className}</strong></p>
              <button type="button" disabled={busy} onClick={() => void submitClassName(classNameAttempt)}>{text.retry}</button>
            </section> : classNameReview ? <section className={styles.review} role="alert" aria-live="polite">
              <h2>{text.classNameReviewTitle}</h2>
              <p>{classNameReview.request.expectedClassName} → <strong>{classNameReview.request.className}</strong></p>
              <p>{text.courseClassNotSaved}</p>
              <div className={styles.actions}>
                <button type="button" disabled={busy} onClick={() => {
                  pending.current = classNameReview; sent.current = false; setClassNameAttempt(classNameReview);
                  void submitClassName(classNameReview);
                }}>{text.classNameConfirm}</button>
                <button type="button" className="secondary" disabled={busy} onClick={() => setClassNameReview(undefined)}>{text.courseClassEdit}</button>
              </div>
            </section> : classNameCandidate ? classNameCandidate.editable ? <form className={styles.classNameForm} onSubmit={inspectClassName}>
              <p>{text.classNameCurrent}: <strong>{classNameCandidate.className}</strong></p>
              <label>{text.classNameNew}<input value={classNameInput} required maxLength={160} autoComplete="off"
                disabled={workflowLocked} onChange={event => setClassNameInput(event.target.value)} /></label>
              <button type="submit" disabled={workflowLocked}>{text.classNameInspect}</button>
            </form> : <p>{text.classNameNotEditable}</p> :
              <button type="button" className="secondary" disabled={workflowLocked}
                onClick={() => void loadClassNameCandidate(classNameClassId)}>{text.classNameRead}</button>}
          </>}
        </div>
      </details>
      <details className={styles.panel} open={capacityAttempt ? true : undefined}>
        <summary>{text.capacityTitle}{capacityClass && text.classOverviewSelected(capacityClass.name)}</summary>
        <div className={styles.workspace}>
          <p>{text.capacityHelp}</p>
          {capacityAttempt ? <div className={styles.review} role="alert">
            <h2>{text.capacityReview}</h2><p>{capacityAttempt.className}</p>
            <p>{text.capacityCount}: {capacityAttempt.entryCount}</p>
            <p>{text.capacityLimit}: {capacityAttempt.request.expectedMaxEntries ?? text.unlimited} → <strong>{capacityAttempt.request.maxEntries ?? text.unlimited}</strong></p>
            {unknown && <p>{text.capacityUnknown}</p>}
            <button disabled={busy} onClick={() => void submitCapacity(capacityAttempt)}>{unknown ? text.retry : text.capacityConfirm}</button>
            {!unknown && <button className="secondary" disabled={busy} onClick={() => {
              pending.current = undefined; sent.current = false; setCapacityAttempt(undefined);
            }}>{text.cancel}</button>}
          </div> : <form className={styles.workspace} onSubmit={prepareCapacity}>
            <div className={styles.capacityFields}>
              <label>{text.capacityClass}<select required value={capacityClassId} disabled={disabled || !data} onChange={(event) => {
                if (courseSelectionReason === "DIRECT" && event.target.value !== courseWarningClassId) setCourseWarningClassId("");
                setCapacityClassId(event.target.value);
                const row = data?.classes.find((item) => item.id === event.target.value);
                setCapacityInput(row?.maxEntries === null || row?.maxEntries === undefined ? "" : String(row.maxEntries)); setMessage("");
              }}><option value="">{text.chooseClass}</option>{data?.classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
              <label>{text.capacityLimit}<input type="text" inputMode="numeric" autoComplete="off" value={capacityInput}
                disabled={disabled || !capacityClass} onChange={(event) => setCapacityInput(event.target.value)} /></label>
              <button disabled={disabled || !capacityClass}>{text.capacityInspect}</button>
            </div>
            {capacityClass && <p>{text.capacityCount}: {capacityClass.entryCount} / {capacityClass.maxEntries ?? text.unlimited}</p>}
          </form>}
        </div>
      </details>
      <details className={styles.panel} open={startRuleOpen || !!startRuleAttempt}
        onToggle={(event) => setStartRuleOpen(event.currentTarget.open)}>
        <summary>{text.startRuleTitle}{startRuleClass && text.classOverviewSelected(startRuleClass.name)}</summary>
        <div className={styles.workspace}>
          <p>{text.startRuleHelp}</p>
          {startRuleAttempt ? <div className={styles.review} role="alert">
            <h2>{text.startRuleReview}</h2><p><strong>{startRuleAttempt.preview.className}</strong></p>
            <p>{text.startRuleCurrent}: {startRuleAttempt.request.expectedStartRule === "FIXED" ? text.fixed : text.punch}
              {" → "}<strong>{startRuleAttempt.request.startRule === "FIXED" ? text.fixed : text.punch}</strong></p>
            <p>{text.participants}: {startRuleAttempt.preview.entryCount} · {text.startRuleTimes}: {startRuleAttempt.preview.fixedStartTimeCount}
              {" · "}{text.startRuleResults}: {startRuleAttempt.preview.entriesWithResults}</p>
            <p>{text.startRuleConsequence}</p><p>{text.startRuleReason}: {startRuleAttempt.request.reason}</p>
            {unknown && <p>{text.startRuleUnknown}</p>}
            <button disabled={busy} onClick={() => void submitStartRule(startRuleAttempt)}>{unknown ? text.retry : text.startRuleConfirm}</button>
            {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => {
              pending.current = undefined; sent.current = false; setStartRuleAttempt(undefined);
            }}>{text.cancel}</button>}
          </div> : <div className={styles.workspace}>
            <label>{text.startRuleClass}<select value={startRuleClassId} disabled={disabled || !data} onChange={(event) => {
              if (courseSelectionReason === "DIRECT" && event.target.value !== courseWarningClassId) setCourseWarningClassId("");
              setStartRuleClassId(event.target.value); setStartRulePreview(undefined); setStartRuleReason(""); setStartRuleConfirmed(false);
              setRecalculationCandidates(undefined); setMessage("");
            }}><option value="">{text.chooseClass}</option>{data?.classes.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <button type="button" className="secondary" disabled={disabled || !startRuleClassId} onClick={() => void loadStartRulePreview()}>{text.startRuleLoad}</button>
            {startRulePreview && <form className={styles.workspace} onSubmit={prepareStartRule}>
              <p><strong>{startRulePreview.className}</strong> · {text.startRuleCurrent}: {startRulePreview.startRule === "FIXED" ? text.fixed : text.punch}
                {" → "}<strong>{startRulePreview.startRule === "FIXED" ? text.punch : text.fixed}</strong></p>
              <p>{text.participants}: {startRulePreview.entryCount} · {text.startRuleTimes}: {startRulePreview.fixedStartTimeCount}
                {" · "}{text.startRuleResults}: {startRulePreview.entriesWithResults}</p>
              <p>{text.startRuleConsequence}</p>
              <label>{text.startRuleReason}<textarea required maxLength={500} rows={2} value={startRuleReason} disabled={disabled}
                onChange={(event) => setStartRuleReason(event.target.value)} /></label>
              <label><input type="checkbox" checked={startRuleConfirmed} disabled={disabled}
                onChange={(event) => setStartRuleConfirmed(event.target.checked)} />{text.startRuleAcknowledge}</label>
              <button disabled={disabled || !startRuleReason.trim() || !startRuleConfirmed}>{text.startRuleInspect}</button>
            </form>}
            {data && startRuleClass?.startRule === "FIXED" && <ClassStartTimeFollowUp
              key={`${startRuleClass.id}:${data.snapshotVersion}`} entries={data.entries} classId={startRuleClass.id}
              disabled={disabled} onSelect={openMissingStartTime} onOpenDraw={openClassDraw} />}
            {data && startRuleClass && <ClassResultRecalculationFollowUp
              key={`results:${startRuleClass.id}:${data.snapshotVersion}`} candidates={recalculationCandidates}
              classId={startRuleClass.id} disabled={disabled} onLoad={() => void loadRecalculation("")}
              onSelect={openRecalculation} />}
          </div>}
        </div>
      </details>
      </section>
    </>}
  </div>;
}
