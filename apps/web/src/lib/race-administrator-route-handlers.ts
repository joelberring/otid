import { listClassStartDrawClassesAsAdmin, previewClassStartDrawAsAdmin, commitClassStartDrawAsAdmin, listFixedStartSlotPlansAsAdministrator, listResultFinalizationCandidatesAsAdmin, finalizeResultsAsAdmin, exportIofResultListAsAdmin, exportFrozenIofResultListAsAdmin, listFrozenRaceFinalizationsAsAdmin, authenticatePairingAdminSession, changeEntryClassAsAdmin, listEntryClassesAsAdmin,
  loginPairingAdmin, logoutPairingAdminSession, listEntryTransfersAsAdministrator, listEntryTransferStartSlotsAsAdministrator, transferEntryAsAdministrator,
  changeClassCapacityAsAdministrator, changeClassStartRuleAsAdministrator, previewClassStartRuleAsAdministrator,
  createManualCourseClassAsAdministrator, createManualClassAsAdministrator,
  listManualClassNameAsAdministrator, changeManualClassNameAsAdministrator, previewManualCourseVersionClassRelinkAsAdministrator,
  relinkManualCourseVersionClassAsAdministrator, getManualCourseResultImpactAsAdministrator,
  previewManualCourseResultBearingRelinkAsAdministrator, relinkManualCourseResultBearingClassAsAdministrator,
  previewShortenedCourseClassTransferAsAdministrator, transferShortenedCourseClassAsAdministrator,
  previewClassControlNeutralizationAsAdministrator, neutralizeClassControlAsAdministrator,
  previewManualFinishTimeCorrectionAsAdministrator, correctManualFinishTimeAsAdministrator,
  previewManualPunchStartTimeCorrectionAsAdministrator, correctManualPunchStartTimeAsAdministrator,
  previewManualPunchStartTimeCorrectionWithdrawalAsAdministrator, withdrawManualPunchStartTimeCorrectionAsAdministrator,
  previewManualFinishTimeCorrectionWithdrawalAsAdministrator, withdrawManualFinishTimeCorrectionAsAdministrator,
  listUnknownReadoutResolutionCandidatesAsAdministrator, resolveUnknownReadoutAsAdministrator,
  changeEntryCardAsAdmin, changeEntryCardRentalAsAdministrator, changeEntryCardRentalReturnAsAdministrator,
  reuseReturnedRentalCardAsAdministrator,
  changeEntryPaymentStatusAsAdministrator,
  changeEntryStartTimeAsAdmin,
  listResultRecalculationCandidatesAsAdmin, recalculateEntryAsAdmin, getAdministratorEffectiveResult, listSpeakerBoardAsAdministrator,
  listClassResultRecalculationCandidatesAsAdministrator, recalculateClassResultsAsAdministrator,
  listEntryIdentitiesAsAdmin, changeEntryIdentityAsAdmin, registerEntryAsAdmin, listEntryRegistrationStartSlotsAsAdmin,
  listEntryRegistrationCandidatesAsAdmin, listAdministratorEntryChanges,
  listDidNotStartCandidatesAsAdmin, decideDidNotStartAsAdmin,
  listDidNotStartWithdrawalsAsAdmin, withdrawDidNotStartAsAdmin,
  listDidNotFinishCandidatesAsAdmin, decideDidNotFinishAsAdmin,
  listDidNotFinishWithdrawalsAsAdmin, withdrawDidNotFinishAsAdmin,
  listResultDisqualificationCandidatesAsAdmin, disqualifyResultAsAdmin,
  listResultDisqualificationWithdrawalsAsAdmin, withdrawResultDisqualificationAsAdmin,
  listResultApprovalCandidatesAsAdmin, approveResultAsAdmin,
  listResultApprovalWithdrawalsAsAdmin, withdrawResultApprovalAsAdmin,
  listOutOfCompetitionCandidatesAsAdmin, decideOutOfCompetitionAsAdmin,
  listOutOfCompetitionWithdrawalsAsAdmin, withdrawOutOfCompetitionAsAdmin,
  listWithoutTimingCandidatesAsAdmin, decideWithoutTimingAsAdmin, listWithoutTimingWithdrawalsAsAdmin, withdrawWithoutTimingAsAdmin,
  listRaceOperatorAccessAsAdministrator, issueRaceOperatorAccessAsAdministrator, revokeRaceOperatorAccessAsAdministrator } from "@o-tid/application";
import { resultFinalizationRequestSchema, resultFinalizationIdempotencyKeySchema, frozenRaceFinalizationListResponseSchema, raceResultFinalizationMetadataSchema, iofResultListExportMetadataSchema, entryClassAdminListResponseSchema, entryClassChangeIdempotencyKeySchema,
  entryClassChangeRequestSchema, entryClassChangeResponseSchema,
  raceAdministratorLoginRequestSchema, raceAdministratorLoginResponseSchema,
  entryTransferCandidatesSchema, entryTransferStartSlotCandidatesSchema, entryTransferRequestSchema, entryTransferIdempotencyKeySchema, entryTransferResponseSchema,
  classCapacityKeySchema, classCapacityRequestSchema, classCapacityResponseSchema,
  manualCourseClassCreateIdempotencyKeySchema, manualCourseClassCreateRequestSchema, manualCourseClassCreateResponseSchema,
  manualClassCreateIdempotencyKeySchema, manualClassCreateRequestSchema, manualClassCreateResponseSchema,
  manualClassNameCandidateSchema, manualClassNameChangeIdempotencyKeySchema,
  manualClassNameChangeRequestSchema, manualClassNameChangeResponseSchema,
  manualCourseVersionClassRelinkPreviewSchema, manualCourseVersionClassRelinkIdempotencyKeySchema,
  manualCourseVersionClassRelinkRequestSchema, manualCourseVersionClassRelinkResponseSchema,
  manualCourseResultImpactResponseSchema,
  manualCourseResultBearingRelinkCandidateSchema, manualCourseResultBearingRelinkIdempotencyKeySchema,
  manualCourseResultBearingRelinkRequestSchema, manualCourseResultBearingRelinkResponseSchema,
  shortenedCourseClassTransferCandidateSchema, shortenedCourseClassTransferIdempotencyKeySchema,
  shortenedCourseClassTransferRequestSchema, shortenedCourseClassTransferReceiptSchema,
  classControlNeutralizationCandidateSchema, classControlNeutralizationIdempotencyKeySchema,
  classControlNeutralizationRequestSchema, classControlNeutralizationResponseSchema,
  manualFinishTimeCorrectionCandidateSchema, manualFinishTimeCorrectionIdempotencyKeySchema,
  manualFinishTimeCorrectionRequestSchema, manualFinishTimeCorrectionResponseSchema,
  manualPunchStartTimeCorrectionCandidateSchema, manualPunchStartTimeCorrectionIdempotencyKeySchema,
  manualPunchStartTimeCorrectionRequestSchema, manualPunchStartTimeCorrectionResponseSchema,
  manualPunchStartTimeCorrectionWithdrawalCandidateSchema, manualPunchStartTimeCorrectionWithdrawalIdempotencyKeySchema,
  manualPunchStartTimeCorrectionWithdrawalRequestSchema, manualPunchStartTimeCorrectionWithdrawalResponseSchema,
  manualFinishTimeCorrectionWithdrawalCandidateSchema, manualFinishTimeCorrectionWithdrawalIdempotencyKeySchema,
  manualFinishTimeCorrectionWithdrawalRequestSchema, manualFinishTimeCorrectionWithdrawalResponseSchema,
  unknownReadoutResolutionCandidateResponseSchema, unknownReadoutResolutionIdempotencyKeySchema,
  unknownReadoutResolutionRequestSchema, unknownReadoutResolutionResponseSchema,
  classStartRulePreviewSchema, classStartRuleChangeRequestSchema, classStartRuleChangeResponseSchema,
  entryCardChangeIdempotencyKeySchema, entryCardChangeRequestSchema, entryCardChangeResponseSchema,
  entryCardRentalChangeIdempotencyKeySchema, entryCardRentalChangeRequestSchema, entryCardRentalChangeResponseSchema,
  entryCardRentalReturnChangeIdempotencyKeySchema, entryCardRentalReturnChangeRequestSchema,
  entryCardRentalReturnChangeResponseSchema,
  entryCardRentalReuseIdempotencyKeySchema, entryCardRentalReuseRequestSchema,
  entryCardRentalReuseResponseSchema,
  entryPaymentStatusChangeIdempotencyKeySchema, entryPaymentStatusChangeRequestSchema,
  entryPaymentStatusChangeResponseSchema,
  entryStartTimeChangeIdempotencyKeySchema, entryStartTimeChangeRequestSchema, entryStartTimeChangeResponseSchema,
  resultRecalculationCandidateResponseSchema, resultRecalculationIdempotencyKeySchema,
  resultRecalculationRequestSchema, resultRecalculationResponseSchema, administratorEffectiveResultResponseSchema, speakerBoardResponseSchema,
  classResultRecalculationCandidateResponseSchema, classResultRecalculationIdempotencyKeySchema,
  classResultRecalculationRequestSchema, classResultRecalculationResponseSchema,
  entryIdentityAdminListResponseSchema, entryIdentityChangeIdempotencyKeySchema, entryIdentityChangeRequestSchema,
  entryRegistrationIdempotencyKeySchema, entryRegistrationRequestSchema,
  entryRegistrationCandidatesRequestSchema, entryRegistrationCandidatesResponseSchema, entryRegistrationStartSlotCandidatesSchema,
  administratorEntryChangesResponseSchema,
  didNotStartCandidateResponseSchema, didNotStartRequestSchema, didNotStartIdempotencyKeySchema,
  didNotStartWithdrawalListResponseSchema, didNotStartWithdrawalRequestSchema, didNotStartWithdrawalIdempotencyKeySchema,
  didNotFinishCandidateResponseSchema, didNotFinishRequestSchema, didNotFinishIdempotencyKeySchema,
  didNotFinishWithdrawalListResponseSchema, didNotFinishWithdrawalRequestSchema, didNotFinishWithdrawalIdempotencyKeySchema,
  resultDisqualificationCandidateResponseSchema, resultDisqualificationRequestSchema, resultDisqualificationIdempotencyKeySchema,
  resultDisqualificationWithdrawalListResponseSchema, resultDisqualificationWithdrawalRequestSchema,
  resultDisqualificationWithdrawalIdempotencyKeySchema,
  resultApprovalCandidateResponseSchema, resultApprovalRequestSchema, resultApprovalIdempotencyKeySchema,
  resultApprovalWithdrawalListResponseSchema, resultApprovalWithdrawalRequestSchema,
  resultApprovalWithdrawalIdempotencyKeySchema,
  outOfCompetitionCandidateResponseSchema, outOfCompetitionRequestSchema, outOfCompetitionIdempotencyKeySchema,
  outOfCompetitionWithdrawalListResponseSchema, outOfCompetitionWithdrawalRequestSchema, outOfCompetitionWithdrawalIdempotencyKeySchema,
  withoutTimingCandidateResponseSchema, withoutTimingRequestSchema, withoutTimingIdempotencyKeySchema,
  withoutTimingWithdrawalListResponseSchema, withoutTimingWithdrawalRequestSchema, withoutTimingWithdrawalIdempotencyKeySchema,
  raceOperatorAccessIssueRequestSchema, raceOperatorAccessIssueResponseSchema, raceOperatorAccessListResponseSchema,
  raceOperatorAccessRevokeRequestSchema, raceOperatorAccessRevokeResponseSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { clearEntryClassAdminCookies, entryClassAdminFailure as failure,
  entryClassAdminJson as json, entryClassAdminSecurityPolicy, entryClassAdminSessionProof,
  hasExpectedEntryClassAdminOrigin, hasNoEntryClassAdminRequestBody,
  privateEntryClassAdminHeaders, readEntryClassAdminJson, setEntryClassAdminCookies } from "./entry-class-admin-security";
import { RACE_ADMINISTRATOR_LOOPBACK_COOKIES, RACE_ADMINISTRATOR_PRODUCTION_COOKIES } from "./race-administrator-cookies";
import { readEntryIdentityAdminJson } from "./entry-identity-admin-security";
import { parseIdentityReceipt } from "./entry-identity-client";
import { parseRegistrationReceipt } from "./entry-registration-client";
import { parseDidNotStartResponse } from "./did-not-start-admin-client";
import { parseDidNotStartWithdrawalResponse } from "./did-not-start-withdrawal-admin-client";
import { parseDidNotFinishResponse } from "./did-not-finish-admin-client";
import { parseDidNotFinishWithdrawalResponse } from "./did-not-finish-withdrawal-admin-client";
import { parseResultDisqualificationResponse } from "./result-disqualification-admin-client";
import { parseResultDisqualificationWithdrawalResponse } from "./result-disqualification-withdrawal-admin-client";
import { parseResultApprovalResponse } from "./result-approval-admin-client";
import { parseResultApprovalWithdrawalResponse } from "./result-approval-withdrawal-admin-client";
import { parseOutOfCompetitionResponse } from "./out-of-competition-admin-client";
import { parseOutOfCompetitionWithdrawalResponse } from "./out-of-competition-withdrawal-admin-client";
import { parseWithoutTimingResponse } from "./without-timing-admin-client";
import { parseWithoutTimingWithdrawalResponse } from "./without-timing-withdrawal-admin-client";
import { iofResultListExportAdminFailure } from "./iof-result-list-export-admin-security";
import { parseResultFinalizationCandidates, parseResultFinalizationResponse } from "./result-finalization-admin-client";
import { classStartDrawClassesResponseSchema, classStartDrawPreviewRequestSchema, classStartDrawPreviewResponseSchema,
  classStartDrawRequestSchema, classStartDrawIdempotencyKeySchema } from "@o-tid/contracts";
import { fixedStartSlotPlanResponseSchema } from "@o-tid/contracts";
import { parseAdministratorDrawReceipt } from "./administrator-start-draw-client";
import { getStartListPublicationPreviewAsAdmin, decideStartListPublicationAsAdmin } from "@o-tid/application";
import { startListPublicationPreviewResponseSchema, startListPublicationRequestSchema, startListPublicationIdempotencyKeySchema } from "@o-tid/contracts";
import { parseAdministratorPublicationReceipt } from "./administrator-publication-client";
import { listAdministratorForestWatch } from "@o-tid/application";
import { registerAdministratorReturn, withdrawAdministratorReturn, correctAdministratorStart } from "@o-tid/application";
import { listCheckinHistoryAsAdmin } from "@o-tid/application";
import { checkinHistoryResponseSchema } from "@o-tid/contracts";
import { readStartCheckinConflictReviewAsAdmin, reviewStartCheckinConflictsAsAdmin } from "@o-tid/application";
import { StartCheckinConflictReviewCandidateSchema, StartCheckinConflictReviewRequestSchema, StartCheckinConflictReviewResponseSchema } from "@o-tid/contracts";
import { ConflictReviewRequestError, readReviewJson } from "./checkin-conflict-review-route-handlers";
import { administratorForestWatchResponseSchema } from "@o-tid/contracts";
import { administratorStartCorrectionRequestSchema, administratorStartCorrectionResponseSchema, canonicalAdministratorStartCorrectionRequest } from "@o-tid/contracts";
import { administratorReturnRequestSchema, administratorReturnResponseSchema, canonicalAdministratorReturnRequest } from "@o-tid/contracts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
const services = { conflictCandidate: readStartCheckinConflictReviewAsAdmin, reviewConflicts: reviewStartCheckinConflictsAsAdmin, checkinHistory: listCheckinHistoryAsAdmin, correctStart: correctAdministratorStart, withdrawReturn: withdrawAdministratorReturn, manualReturn: registerAdministratorReturn, forestWatch: listAdministratorForestWatch, publicationPreview: getStartListPublicationPreviewAsAdmin, publication: decideStartListPublicationAsAdmin,
  drawClasses: listClassStartDrawClassesAsAdmin, drawPreview: previewClassStartDrawAsAdmin, draw: commitClassStartDrawAsAdmin,
  fixedStartSlotPlans: listFixedStartSlotPlansAsAdministrator,
  finalizationCandidates: listResultFinalizationCandidatesAsAdmin, finalize: finalizeResultsAsAdmin,
  frozenResults: listFrozenRaceFinalizationsAsAdmin, frozenResult: exportFrozenIofResultListAsAdmin,
  resultExport: exportIofResultListAsAdmin, authenticate: authenticatePairingAdminSession, login: loginPairingAdmin,
  logout: logoutPairingAdminSession, participants: listEntryClassesAsAdmin, changeClass: changeEntryClassAsAdmin,
  transferCandidates: listEntryTransfersAsAdministrator, transferStartSlotCandidates: listEntryTransferStartSlotsAsAdministrator,
  transfer: transferEntryAsAdministrator, capacity: changeClassCapacityAsAdministrator,
  manualCourseClass: createManualCourseClassAsAdministrator,
  manualClass: createManualClassAsAdministrator,
  manualClassNameCandidate: listManualClassNameAsAdministrator,
  manualClassName: changeManualClassNameAsAdministrator,
  manualCourseVersionRelinkPreview: previewManualCourseVersionClassRelinkAsAdministrator,
  manualCourseVersionRelink: relinkManualCourseVersionClassAsAdministrator,
  manualCourseResultImpact: getManualCourseResultImpactAsAdministrator,
  manualCourseResultBearingRelinkCandidate: previewManualCourseResultBearingRelinkAsAdministrator,
  manualCourseResultBearingRelink: relinkManualCourseResultBearingClassAsAdministrator,
  shortenedCourseClassTransferPreview: previewShortenedCourseClassTransferAsAdministrator,
  shortenedCourseClassTransfer: transferShortenedCourseClassAsAdministrator,
  classControlNeutralizationCandidate: previewClassControlNeutralizationAsAdministrator,
  classControlNeutralization: neutralizeClassControlAsAdministrator,
  manualFinishTimeCorrectionCandidate: previewManualFinishTimeCorrectionAsAdministrator,
  manualFinishTimeCorrection: correctManualFinishTimeAsAdministrator,
  manualPunchStartTimeCorrectionCandidate: previewManualPunchStartTimeCorrectionAsAdministrator,
  manualPunchStartTimeCorrection: correctManualPunchStartTimeAsAdministrator,
  manualPunchStartTimeCorrectionWithdrawalCandidate: previewManualPunchStartTimeCorrectionWithdrawalAsAdministrator,
  manualPunchStartTimeCorrectionWithdrawal: withdrawManualPunchStartTimeCorrectionAsAdministrator,
  manualFinishTimeCorrectionWithdrawalCandidate: previewManualFinishTimeCorrectionWithdrawalAsAdministrator,
  manualFinishTimeCorrectionWithdrawal: withdrawManualFinishTimeCorrectionAsAdministrator,
  unknownReadoutResolutionCandidates: listUnknownReadoutResolutionCandidatesAsAdministrator,
  unknownReadoutResolution: resolveUnknownReadoutAsAdministrator,
  startRulePreview: previewClassStartRuleAsAdministrator, startRule: changeClassStartRuleAsAdministrator,
  card: changeEntryCardAsAdmin, cardRental: changeEntryCardRentalAsAdministrator,
  cardRentalReturn: changeEntryCardRentalReturnAsAdministrator,
  cardRentalReuse: reuseReturnedRentalCardAsAdministrator,
  paymentStatus: changeEntryPaymentStatusAsAdministrator, startTime: changeEntryStartTimeAsAdmin,
  recalculationCandidates: listResultRecalculationCandidatesAsAdmin, recalculate: recalculateEntryAsAdmin,
  classResultRecalculationCandidates: listClassResultRecalculationCandidatesAsAdministrator,
  classResultRecalculate: recalculateClassResultsAsAdministrator,
  effectiveResult: getAdministratorEffectiveResult, speakerBoard: listSpeakerBoardAsAdministrator,
  identityCandidates: listEntryIdentitiesAsAdmin, identity: changeEntryIdentityAsAdmin,
  registration: registerEntryAsAdmin, registrationCandidates: listEntryRegistrationCandidatesAsAdmin,
  registrationStartSlotCandidates: listEntryRegistrationStartSlotsAsAdmin,
  changes: listAdministratorEntryChanges, dnsCandidates: listDidNotStartCandidatesAsAdmin, dns: decideDidNotStartAsAdmin,
  dnsWithdrawals: listDidNotStartWithdrawalsAsAdmin, dnsWithdrawal: withdrawDidNotStartAsAdmin,
  dnfCandidates: listDidNotFinishCandidatesAsAdmin, dnf: decideDidNotFinishAsAdmin,
  dnfWithdrawals: listDidNotFinishWithdrawalsAsAdmin, dnfWithdrawal: withdrawDidNotFinishAsAdmin,
  dsqCandidates: listResultDisqualificationCandidatesAsAdmin, dsq: disqualifyResultAsAdmin,
  dsqWithdrawals: listResultDisqualificationWithdrawalsAsAdmin, dsqWithdrawal: withdrawResultDisqualificationAsAdmin,
  approvalCandidates: listResultApprovalCandidatesAsAdmin, approval: approveResultAsAdmin,
  approvalWithdrawals: listResultApprovalWithdrawalsAsAdmin, approvalWithdrawal: withdrawResultApprovalAsAdmin,
  oocCandidates: listOutOfCompetitionCandidatesAsAdmin, ooc: decideOutOfCompetitionAsAdmin,
  oocWithdrawals: listOutOfCompetitionWithdrawalsAsAdmin, oocWithdrawal: withdrawOutOfCompetitionAsAdmin,
  ntCandidates: listWithoutTimingCandidatesAsAdmin, nt: decideWithoutTimingAsAdmin,
  ntWithdrawals: listWithoutTimingWithdrawalsAsAdmin, ntWithdrawal: withdrawWithoutTimingAsAdmin,
  operatorAccesses: listRaceOperatorAccessAsAdministrator, issueOperatorAccess: issueRaceOperatorAccessAsAdministrator,
  revokeOperatorAccess: revokeRaceOperatorAccessAsAdministrator };
type Action = { kind: "conflict-candidate"; entryId: string } | { kind: "review-conflicts" } | { kind: "checkin-history"; entryId: string } | { kind: "start-correction" } | { kind: "manual-return-withdrawal" } | { kind: "manual-return" } | { kind: "forest-watch" } | { kind: "publication-preview" } | { kind: "publication" } | { kind: "draw-classes" } | { kind: "draw-preview" } | { kind: "draw" } | { kind: "fixed-start-slot-plans" } |
  { kind: "finalization-candidates" } | { kind: "finalize" } | { kind: "frozen-results" } | { kind: "frozen-result"; finalizationId: string } |
  { kind: "result-export" } | { kind: "session" } | { kind: "participants" } | { kind: "transfer-candidates" } |
  { kind: "transfer-start-slot-candidates"; entryId: string; targetClassId: string } |
  { kind: "registration-start-slot-candidates"; targetClassId: string } |
  { kind: "class"; entryId: string } | { kind: "transfer"; entryId: string } | { kind: "capacity"; classId: string } |
  { kind: "manual-course-class" } | { kind: "manual-class" } | { kind: "manual-class-name"; classId: string } | { kind: "manual-course-version-link"; classId: string } |
  { kind: "manual-course-result-impact"; classId: string } |
  { kind: "manual-course-result-bearing-link"; classId: string } |
  { kind: "shortened-course-class-transfer"; classId: string } |
  { kind: "class-control-neutralization"; classId: string } |
  { kind: "manual-finish-time-correction"; entryId: string } |
  { kind: "manual-punch-start-time-correction"; entryId: string } |
  { kind: "manual-punch-start-time-correction-withdrawal"; entryId: string } |
  { kind: "manual-finish-time-correction-withdrawal"; entryId: string } |
  { kind: "unknown-readout-resolution" } |
  { kind: "start-rule"; classId: string } |
  { kind: "card"; entryId: string } | { kind: "card-rental"; entryId: string } |
  { kind: "card-rental-return"; entryId: string } | { kind: "card-rental-reuse"; entryId: string } |
  { kind: "payment-status"; entryId: string } |
  { kind: "start-time"; entryId: string } |
  { kind: "recalculation-candidates" } | { kind: "recalculate"; entryId: string } |
  { kind: "class-result-recalculation"; classId: string } | { kind: "effective-result"; entryId: string } | { kind: "speaker-board" } |
  { kind: "identity-candidates" } | { kind: "identity"; entryId: string } | { kind: "registration" } | { kind: "registration-candidates" } |
  { kind: "changes"; entryId: string } | { kind: "did-not-start-candidates" } | { kind: "did-not-start-withdrawals" } |
  { kind: "did-not-start"; entryId: string } | { kind: "did-not-start-withdrawal"; entryId: string } |
  { kind: "did-not-finish-candidates" } | { kind: "did-not-finish-withdrawals" } |
  { kind: "did-not-finish"; entryId: string } | { kind: "did-not-finish-withdrawal"; entryId: string } |
  { kind: "disqualification-candidates" } | { kind: "disqualification-withdrawals" } |
  { kind: "disqualification"; entryId: string } | { kind: "disqualification-withdrawal"; entryId: string } |
  { kind: "approval-candidates" } | { kind: "approval-withdrawals" } |
  { kind: "approval"; entryId: string } | { kind: "approval-withdrawal"; entryId: string } |
  { kind: "out-of-competition-candidates" } | { kind: "out-of-competition-withdrawals" } |
  { kind: "out-of-competition"; entryId: string } | { kind: "out-of-competition-withdrawal"; entryId: string } |
  { kind: "without-timing-candidates" } | { kind: "without-timing-withdrawals" } |
  { kind: "without-timing"; entryId: string } | { kind: "without-timing-withdrawal"; entryId: string } |
  { kind: "operator-access" };

function resultFailure(status: string): Response {
  switch (status) {
    case "unauthorized": return failure(401, "UNAUTHORIZED");
    case "forbidden": return failure(403, "FORBIDDEN");
    case "invalid-request": return failure(400, "INVALID_REQUEST");
    case "not-found": return failure(404, "NOT_FOUND");
    case "conflict": return failure(409, "CONFLICT");
    case "too-large": return iofResultListExportAdminFailure(413, "TOO_LARGE");
    default: return failure(500, "INTERNAL_ERROR");
  }
}

/** Dedicated administrator cookie boundary; never falls back to a limited-role cookie. */
export async function raceAdministratorRoute(db: Database, request: Request, raceId: string, action: Action,
  overrides: Partial<typeof services> = services, environment: Environment = process.env): Promise<Response> {
  const dependencies = { ...services, ...overrides };
  const url = new URL(request.url);
  const before = url.searchParams.get("beforeVersion");
  const beforeVersion = before === null ? undefined : Number(before);
  const validHistoryQuery = action.kind === "changes" &&
    [...url.searchParams.keys()].every(key => key === "beforeVersion") &&
    url.searchParams.getAll("beforeVersion").length <= 1 &&
    (before === null || (/^[1-9]\d{0,9}$/.test(before) && Number.isSafeInteger(beforeVersion) && beforeVersion! <= 2_147_483_647));
  const cursor = url.searchParams.get("cursor");
  const validCheckinQuery = action.kind === "checkin-history" &&
    [...url.searchParams.keys()].every(key => key === "cursor") && url.searchParams.getAll("cursor").length <= 1 &&
    (cursor === null || /^[A-Za-z0-9_-]{1,1024}$/.test(cursor));
  if (!uuid.test(raceId) || ("entryId" in action && !uuid.test(action.entryId)) ||
    (action.kind === "manual-class-name" && !uuid.test(action.classId)) ||
    ("targetClassId" in action && !uuid.test(action.targetClassId)) ||
    ("finalizationId" in action && !uuid.test(action.finalizationId)) ||
    ((action.kind === "capacity" || action.kind === "start-rule" || action.kind === "manual-course-version-link" || action.kind === "manual-course-result-impact" || action.kind === "manual-course-result-bearing-link" || action.kind === "shortened-course-class-transfer" || action.kind === "class-control-neutralization" || action.kind === "class-result-recalculation") && !uuid.test(action.classId)) || (url.search && !validHistoryQuery && !validCheckinQuery)) {
    return failure(400, "INVALID_REQUEST");
  }
  const allowed = action.kind === "manual-class-name" ? ["GET", "POST"] : action.kind === "operator-access" ? ["GET", "POST", "DELETE"] : action.kind === "start-rule" ? ["GET", "PATCH"] : action.kind === "manual-course-version-link" || action.kind === "manual-course-result-bearing-link" || action.kind === "shortened-course-class-transfer" || action.kind === "class-control-neutralization" || action.kind === "manual-finish-time-correction" || action.kind === "manual-punch-start-time-correction" || action.kind === "manual-punch-start-time-correction-withdrawal" || action.kind === "manual-finish-time-correction-withdrawal" || action.kind === "unknown-readout-resolution" || action.kind === "class-result-recalculation" ? ["GET", "POST"] : action.kind === "manual-course-result-impact" ? ["GET"] : action.kind === "review-conflicts" ? ["POST"] : action.kind === "conflict-candidate" ? ["GET"] : action.kind === "session" ? ["GET", "POST", "DELETE"] : action.kind === "checkin-history" || action.kind === "effective-result" || action.kind === "changes" || action.kind === "transfer-start-slot-candidates" || action.kind === "registration-start-slot-candidates" ? ["GET"] :
    action.kind === "start-correction" || action.kind === "manual-return-withdrawal" || action.kind === "manual-return" || action.kind === "publication" || action.kind === "draw-preview" || action.kind === "draw" || action.kind === "finalize" || action.kind === "recalculate" || action.kind === "registration" || action.kind === "registration-candidates" ||
    action.kind === "did-not-start" || action.kind === "did-not-start-withdrawal" ||
    action.kind === "did-not-finish" || action.kind === "did-not-finish-withdrawal" ||
    action.kind === "disqualification" || action.kind === "disqualification-withdrawal" ||
    action.kind === "approval" || action.kind === "approval-withdrawal" ||
    action.kind === "out-of-competition" || action.kind === "out-of-competition-withdrawal" ||
    action.kind === "without-timing" || action.kind === "without-timing-withdrawal" || action.kind === "manual-course-class" || action.kind === "manual-class" ? ["POST"] :
    "entryId" in action || action.kind === "capacity" ? ["PATCH"] : ["GET"];
  if (!allowed.includes(request.method)) return new Response(null, { status: 405,
    headers: { ...privateEntryClassAdminHeaders, allow: allowed.join(", ") } });
  let policy;
  try {
    const base = entryClassAdminSecurityPolicy(environment);
    policy = { ...base, cookieNames: base.secureCookies ? RACE_ADMINISTRATOR_PRODUCTION_COOKIES : RACE_ADMINISTRATOR_LOOPBACK_COOKIES };
  } catch { return failure(500, "INTERNAL_ERROR"); }
  const write = request.method !== "GET";
  if (write && !hasExpectedEntryClassAdminOrigin(request, policy)) return failure(403, "FORBIDDEN");
  const proof = entryClassAdminSessionProof(request, policy, write);
  try {
    if (action.kind === "session" && request.method === "POST") {
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = raceAdministratorLoginRequestSchema.safeParse(body);
      if (!parsed.success) return failure(401, "UNAUTHORIZED");
      const result = await dependencies.login(db, parsed.data, { expectedRaceId: raceId, expectedCapability: "MANAGE_RACE" });
      if (result.status !== "authenticated") return resultFailure(result.status);
      const response = raceAdministratorLoginResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return setEntryClassAdminCookies(json(response), policy, { ...result, expiresAt: response.expiresAt });
    }
    if (action.kind === "session" && request.method === "DELETE") {
      const result = await dependencies.logout(db, { ...proof, raceId, capability: "MANAGE_RACE",
        readBodyIsEmpty: () => hasNoEntryClassAdminRequestBody(request) });
      if (result.status === "unauthorized") return clearEntryClassAdminCookies(resultFailure(result.status), policy);
      if (result.status !== "logged-out" && result.status !== "already-logged-out") return resultFailure(result.status);
      return clearEntryClassAdminCookies(new Response(null, { status: 204, headers: privateEntryClassAdminHeaders }), policy);
    }
    // Verify actual administrator role before parsing mutations or reading participant data.
    const auth = await dependencies.authenticate(db, { ...proof, raceId, capability: "MANAGE_RACE", requireCsrf: write });
    if (auth.status !== "authenticated") return resultFailure(auth.status);
    if (auth.principal.raceId !== raceId || auth.principal.capability !== "MANAGE_RACE") return failure(403, "FORBIDDEN");
    if (action.kind === "operator-access" && request.method === "GET") {
      if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.operatorAccesses(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      return json(raceOperatorAccessListResponseSchema.parse(result.response));
    }
    if (action.kind === "operator-access" && request.method === "POST") {
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = raceOperatorAccessIssueRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.issueOperatorAccess(db, { ...proof, raceId, request: parsed.data });
      if (result.status !== "issued") return resultFailure(result.status);
      const response = raceOperatorAccessIssueResponseSchema.parse(result.response);
      if (response.access.raceId !== raceId || response.access.capability !== parsed.data.capability || response.access.label !== parsed.data.label || response.access.expiresAt !== parsed.data.expiresAt) {
        return failure(500, "INTERNAL_ERROR");
      }
      return json(response, 201);
    }
    if (action.kind === "operator-access") {
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = raceOperatorAccessRevokeRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.revokeOperatorAccess(db, { ...proof, raceId, request: parsed.data });
      if (result.status !== "revoked") return resultFailure(result.status);
      const response = raceOperatorAccessRevokeResponseSchema.parse(result.response);
      if (response.access.raceId !== raceId || response.access.credentialId !== parsed.data.credentialId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "start-rule" && request.method === "GET") {
      if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.startRulePreview(db, { ...proof, raceId, classId: action.classId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = classStartRulePreviewSchema.parse(result.response);
      if (response.raceId !== raceId || response.classId !== action.classId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "start-rule") {
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = classStartRuleChangeRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.startRule(db, { ...proof, raceId, classId: action.classId, request: parsed.data });
      if (result.status !== "changed") return resultFailure(result.status);
      const response = classStartRuleChangeResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.classId !== action.classId || response.requestId !== parsed.data.requestId ||
        response.previousStartRule !== parsed.data.expectedStartRule || response.startRule !== parsed.data.startRule ||
        response.snapshotVersionBefore !== parsed.data.expectedSnapshotVersion) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "manual-course-version-link" && request.method === "GET") {
      if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.manualCourseVersionRelinkPreview(db, { ...proof, raceId, classId: action.classId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = manualCourseVersionClassRelinkPreviewSchema.parse(result.response);
      if (response.raceId !== raceId || response.classId !== action.classId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "manual-course-result-impact") {
      if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.manualCourseResultImpact(db, { ...proof, raceId, classId: action.classId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = manualCourseResultImpactResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.classId !== action.classId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "unknown-readout-resolution" && request.method === "GET") {
      if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.unknownReadoutResolutionCandidates(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = unknownReadoutResolutionCandidateResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "unknown-readout-resolution") {
      const key = unknownReadoutResolutionIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = unknownReadoutResolutionRequestSchema.safeParse(body);
      if (!parsed.success || key.data.slice("unknown-readout-resolution:".length) !== parsed.data.requestId) {
        return failure(400, "INVALID_REQUEST");
      }
      const result = await dependencies.unknownReadoutResolution(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "resolved") return resultFailure(result.status);
      const response = unknownReadoutResolutionResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.requestId !== parsed.data.requestId ||
          response.readoutId !== parsed.data.readoutId || response.cardNumber !== parsed.data.cardNumber ||
          response.target !== parsed.data.target || response.snapshotVersionBefore !== parsed.data.expectedSnapshotVersion ||
          response.engineVersion !== parsed.data.expectedEngineVersion) return failure(500, "INTERNAL_ERROR");
      if (parsed.data.target === "EXISTING_ENTRY" && (response.entryId !== parsed.data.entryId || response.classId !== parsed.data.expectedClassId)) {
        return failure(500, "INTERNAL_ERROR");
      }
      if (parsed.data.target === "NEW_ENTRY" && response.classId !== parsed.data.classId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "manual-course-result-bearing-link" && request.method === "GET") {
      if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.manualCourseResultBearingRelinkCandidate(db, { ...proof, raceId, classId: action.classId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = manualCourseResultBearingRelinkCandidateSchema.parse(result.response);
      if (response.raceId !== raceId || response.classId !== action.classId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "manual-course-result-bearing-link") {
      const key = manualCourseResultBearingRelinkIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = manualCourseResultBearingRelinkRequestSchema.safeParse(body);
      if (!parsed.success || parsed.data.classId !== action.classId ||
          key.data.slice("manual-course-result-bearing-link:".length) !== parsed.data.requestId) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.manualCourseResultBearingRelink(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "changed") return resultFailure(result.status);
      const response = manualCourseResultBearingRelinkResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.classId !== action.classId || response.requestId !== parsed.data.requestId ||
          response.courseId !== parsed.data.courseId || response.sourceSnapshotVersion !== parsed.data.expectedSnapshotVersion ||
          response.sourceBasisHash !== parsed.data.expectedBasisHash || response.previousCourseVersionId !== parsed.data.expectedClassCourseVersionId ||
          JSON.stringify(response.request) !== JSON.stringify(parsed.data)) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "shortened-course-class-transfer" && request.method === "GET") {
      if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.shortenedCourseClassTransferPreview(db, { ...proof, raceId,
        request: { formatVersion: 1, sourceClassId: action.classId } });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = shortenedCourseClassTransferCandidateSchema.parse(result.response);
      if (response.raceId !== raceId || response.sourceClassId !== action.classId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "shortened-course-class-transfer") {
      const key = shortenedCourseClassTransferIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = shortenedCourseClassTransferRequestSchema.safeParse(body);
      if (!parsed.success || parsed.data.sourceClassId !== action.classId ||
          key.data !== `shortened-course-class-transfer:${parsed.data.requestId}`) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.shortenedCourseClassTransfer(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "transferred") return resultFailure(result.status);
      const response = shortenedCourseClassTransferReceiptSchema.parse(result.response);
      if (response.raceId !== raceId || response.requestId !== parsed.data.requestId ||
          response.sourceClassId !== action.classId || response.sourceCourseVersionId !== parsed.data.expectedSourceCourseVersionId ||
          response.sourceSnapshotVersion !== parsed.data.expectedSnapshotVersion || response.sourceBasisHash !== parsed.data.expectedBasisHash ||
          JSON.stringify(response.request) !== JSON.stringify(parsed.data)) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "class-control-neutralization" && request.method === "GET") {
      if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.classControlNeutralizationCandidate(db, { ...proof, raceId, classId: action.classId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = classControlNeutralizationCandidateSchema.parse(result.response);
      if (response.raceId !== raceId || response.classId !== action.classId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "class-control-neutralization") {
      const key = classControlNeutralizationIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = classControlNeutralizationRequestSchema.safeParse(body);
      if (!parsed.success || parsed.data.classId !== action.classId || key.data !== `class-control-neutralization:${parsed.data.requestId}`) {
        return failure(400, "INVALID_REQUEST");
      }
      const result = await dependencies.classControlNeutralization(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "changed") return resultFailure(result.status);
      const response = classControlNeutralizationResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.classId !== action.classId || response.requestId !== parsed.data.requestId ||
          response.courseVersionId !== parsed.data.expectedCourseVersionId || response.courseControlId !== parsed.data.courseControlId ||
          response.sequence !== parsed.data.sequence || response.controlCode !== parsed.data.controlCode ||
          response.sourceSnapshotVersion !== parsed.data.expectedSnapshotVersion || response.sourceBasisHash !== parsed.data.expectedBasisHash ||
          JSON.stringify(response.request) !== JSON.stringify(parsed.data)) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "manual-finish-time-correction" && request.method === "GET") {
      if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.manualFinishTimeCorrectionCandidate(db, { ...proof, raceId, entryId: action.entryId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = manualFinishTimeCorrectionCandidateSchema.parse(result.response);
      if (response.raceId !== raceId || response.entryId !== action.entryId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "manual-finish-time-correction") {
      const key = manualFinishTimeCorrectionIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = manualFinishTimeCorrectionRequestSchema.safeParse(body);
      if (!parsed.success || parsed.data.entryId !== action.entryId ||
          key.data !== `manual-finish-time-correction:${parsed.data.requestId}`) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.manualFinishTimeCorrection(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "corrected") return resultFailure(result.status);
      const response = manualFinishTimeCorrectionResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.entryId !== action.entryId || response.requestId !== parsed.data.requestId ||
          response.classId !== parsed.data.expectedClassId || response.courseVersionId !== parsed.data.expectedCourseVersionId ||
          response.sourceSnapshotVersion !== parsed.data.expectedSnapshotVersion || response.sourceBasisHash !== parsed.data.expectedBasisHash ||
          response.source.resultRevisionId !== parsed.data.expectedSourceResultRevisionId ||
          response.source.resultRevision !== parsed.data.expectedSourceResultRevision || response.source.readoutId !== parsed.data.expectedReadoutId ||
          response.previousFinishTime !== parsed.data.expectedSourceFinishTime || response.correctedFinishTime !== parsed.data.correctedFinishTime ||
          JSON.stringify(response.request) !== JSON.stringify(parsed.data)) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "manual-punch-start-time-correction" && request.method === "GET") {
      if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.manualPunchStartTimeCorrectionCandidate(db, { ...proof, raceId, entryId: action.entryId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = manualPunchStartTimeCorrectionCandidateSchema.parse(result.response);
      if (response.raceId !== raceId || response.entryId !== action.entryId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "manual-punch-start-time-correction") {
      const key = manualPunchStartTimeCorrectionIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = manualPunchStartTimeCorrectionRequestSchema.safeParse(body);
      if (!parsed.success || parsed.data.entryId !== action.entryId ||
          key.data !== `manual-punch-start-time-correction:${parsed.data.requestId}`) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.manualPunchStartTimeCorrection(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "corrected") return resultFailure(result.status);
      const response = manualPunchStartTimeCorrectionResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.entryId !== action.entryId || response.requestId !== parsed.data.requestId ||
          response.classId !== parsed.data.expectedClassId || response.courseVersionId !== parsed.data.expectedCourseVersionId ||
          response.sourceSnapshotVersion !== parsed.data.expectedSnapshotVersion || response.sourceBasisHash !== parsed.data.expectedBasisHash ||
          response.source.resultRevisionId !== parsed.data.expectedSourceResultRevisionId ||
          response.source.resultRevision !== parsed.data.expectedSourceResultRevision || response.source.readoutId !== parsed.data.expectedReadoutId ||
          response.previousStartTime !== parsed.data.expectedSourceStartTime || response.correctedStartTime !== parsed.data.correctedStartTime ||
          JSON.stringify(response.request) !== JSON.stringify(parsed.data)) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "manual-punch-start-time-correction-withdrawal" && request.method === "GET") {
      if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.manualPunchStartTimeCorrectionWithdrawalCandidate(db, { ...proof, raceId, entryId: action.entryId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = manualPunchStartTimeCorrectionWithdrawalCandidateSchema.parse(result.response);
      if (response.raceId !== raceId || response.entryId !== action.entryId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "manual-punch-start-time-correction-withdrawal") {
      const key = manualPunchStartTimeCorrectionWithdrawalIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = manualPunchStartTimeCorrectionWithdrawalRequestSchema.safeParse(body);
      if (!parsed.success || parsed.data.entryId !== action.entryId ||
          key.data !== `manual-punch-start-time-correction-withdrawal:${parsed.data.requestId}`) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.manualPunchStartTimeCorrectionWithdrawal(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "withdrawn") return resultFailure(result.status);
      const response = manualPunchStartTimeCorrectionWithdrawalResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.entryId !== action.entryId || response.requestId !== parsed.data.requestId ||
          response.correctionId !== parsed.data.expectedCorrectionId || JSON.stringify(response.request) !== JSON.stringify(parsed.data)) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "manual-finish-time-correction-withdrawal" && request.method === "GET") {
      if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.manualFinishTimeCorrectionWithdrawalCandidate(db, { ...proof, raceId, entryId: action.entryId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = manualFinishTimeCorrectionWithdrawalCandidateSchema.parse(result.response);
      if (response.raceId !== raceId || response.entryId !== action.entryId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "manual-finish-time-correction-withdrawal") {
      const key = manualFinishTimeCorrectionWithdrawalIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = manualFinishTimeCorrectionWithdrawalRequestSchema.safeParse(body);
      if (!parsed.success || parsed.data.entryId !== action.entryId || key.data !== `manual-finish-time-correction-withdrawal:${parsed.data.requestId}`) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.manualFinishTimeCorrectionWithdrawal(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "withdrawn") return resultFailure(result.status);
      const response = manualFinishTimeCorrectionWithdrawalResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.entryId !== action.entryId || response.requestId !== parsed.data.requestId ||
          response.correctionId !== parsed.data.expectedCorrectionId || JSON.stringify(response.request) !== JSON.stringify(parsed.data)) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "manual-course-version-link") {
      const key = manualCourseVersionClassRelinkIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = manualCourseVersionClassRelinkRequestSchema.safeParse(body);
      if (!parsed.success || parsed.data.classId !== action.classId ||
          key.data.slice("manual-course-version-link:".length) !== parsed.data.requestId) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.manualCourseVersionRelink(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
      if (result.status === "results-exist") return failure(409, "CONFLICT");
      if (result.status !== "changed") return resultFailure(result.status);
      const response = manualCourseVersionClassRelinkResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.classId !== action.classId || response.requestId !== parsed.data.requestId ||
          response.courseId !== parsed.data.courseId || response.previousCourseVersionId !== parsed.data.expectedClassCourseVersionId ||
          response.snapshotVersionBefore !== parsed.data.expectedSnapshotVersion ||
          JSON.stringify(response.request) !== JSON.stringify(parsed.data)) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "conflict-candidate") {
      if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.conflictCandidate(db, { ...proof, raceId, entryId: action.entryId, capability: "MANAGE_RACE" });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = StartCheckinConflictReviewCandidateSchema.parse(result.response);
      if (response.source.raceId !== raceId || response.source.entryId !== action.entryId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "review-conflicts") {
      let intent;
      try { intent = StartCheckinConflictReviewRequestSchema.parse(await readReviewJson(request)); }
      catch (error) { return error instanceof ConflictReviewRequestError && error.tooLarge
        ? resultFailure("too-large") : failure(400, "INVALID_REQUEST"); }
      const result = await dependencies.reviewConflicts(db, { ...proof, raceId, capability: "MANAGE_RACE", readBody: async () => intent });
      if (result.status !== "reviewed") return resultFailure(result.status);
      const response = StartCheckinConflictReviewResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.entryId !== intent.entryId || response.requestId !== intent.requestId ||
        response.sourceHash !== intent.sourceHash || response.decision !== intent.decision ||
        response.conflictRequestIds.length !== intent.conflictRequestIds.length ||
        response.conflictRequestIds.some((id, index) => id !== intent.conflictRequestIds[index])) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "checkin-history") {
      const result = await dependencies.checkinHistory(db, { ...proof, raceId, entryId: action.entryId, limit: 25,
        ...(cursor === null ? {} : { cursor }) });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = checkinHistoryResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.entryId !== action.entryId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "start-correction") {
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = administratorStartCorrectionRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.correctStart(db, { ...proof, raceId, request: parsed.data });
      if (result.status !== "stored") return resultFailure(result.status);
      const response = administratorStartCorrectionResponseSchema.parse(result.response);
      if (response.receipt.raceId !== raceId || canonicalAdministratorStartCorrectionRequest(response.request).toString() !== canonicalAdministratorStartCorrectionRequest(parsed.data).toString()) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "manual-return" || action.kind === "manual-return-withdrawal") {
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = administratorReturnRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const service = action.kind === "manual-return" ? dependencies.manualReturn : dependencies.withdrawReturn;
      const result = await service(db, { ...proof, raceId, request: parsed.data });
      if (result.status !== "stored") return resultFailure(result.status);
      const response = administratorReturnResponseSchema.parse(result.response);
      if (response.receipt.raceId !== raceId || canonicalAdministratorReturnRequest(response.request).toString() !== canonicalAdministratorReturnRequest(parsed.data).toString()) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "forest-watch") {
      const result = await dependencies.forestWatch(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = administratorForestWatchResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "publication-preview") {
      const result = await dependencies.publicationPreview(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = startListPublicationPreviewResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "publication") {
      const key = startListPublicationIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = startListPublicationRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.publication(db, { ...proof, raceId, request: parsed.data, idempotencyKey: key.data });
      if (result.status !== "decided") return resultFailure(result.status);
      return json(parseAdministratorPublicationReceipt(result.response, raceId, {
        id: key.data.slice("start-list-publication:".length), request: parsed.data
      }));
    }
    if (action.kind === "draw-classes") {
      const result = await dependencies.drawClasses(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = classStartDrawClassesResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "fixed-start-slot-plans") {
      if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.fixedStartSlotPlans(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = fixedStartSlotPlanResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "draw-preview" || action.kind === "draw") {
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      if (action.kind === "draw-preview") {
        const parsed = classStartDrawPreviewRequestSchema.safeParse(body);
        if (!parsed.success) return failure(400, "INVALID_REQUEST");
        const result = await dependencies.drawPreview(db, { ...proof, raceId, request: parsed.data });
        if (result.status !== "ok") return resultFailure(result.status);
        const response = classStartDrawPreviewResponseSchema.parse(result.response);
        if (response.raceId !== raceId || response.classId !== parsed.data.classId ||
          JSON.stringify(response.parameters) !== JSON.stringify(parsed.data.parameters)) return failure(500, "INTERNAL_ERROR");
        return json(response);
      }
      const parsed = classStartDrawRequestSchema.safeParse(body);
      const key = classStartDrawIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!parsed.success || !key.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.draw(db, { ...proof, raceId, request: parsed.data, idempotencyKey: key.data });
      if (result.status !== "changed") return resultFailure(result.status);
      return json(parseAdministratorDrawReceipt(result.response, raceId, {
        id: key.data.slice("class-start-draw:".length), request: parsed.data
      }));
    }
    if (action.kind === "finalization-candidates") {
      const result = await dependencies.finalizationCandidates(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      return json(parseResultFinalizationCandidates(result.response, raceId));
    }
    if (action.kind === "finalize") {
      const key = resultFinalizationIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = resultFinalizationRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.finalize(db, { ...proof, raceId, request: parsed.data, idempotencyKey: key.data });
      if (result.status !== "finalized") return resultFailure(result.status);
      return json(parseResultFinalizationResponse(result.response, {
        requestId: key.data.slice("result-finalization:".length), request: parsed.data, label: ""
      }, raceId));
    }
    if (action.kind === "frozen-results") {
      const result = await dependencies.frozenResults(db, { sessionToken: proof.sessionToken, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = frozenRaceFinalizationListResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "frozen-result") {
      const result = await dependencies.frozenResult(db, { sessionToken: proof.sessionToken, raceId, finalizationId: action.finalizationId });
      if (result.status !== "ok") return resultFailure(result.status);
      const metadata = raceResultFinalizationMetadataSchema.parse(result.finalization);
      if (metadata.raceId !== raceId || metadata.id !== action.finalizationId) return failure(500, "INTERNAL_ERROR");
      const bytes = Uint8Array.from(result.bytes);
      return new Response(bytes, { headers: { ...privateEntryClassAdminHeaders,
        "content-type": "application/xml; charset=utf-8",
        "content-disposition": `attachment; filename="otid-complete-result-list-${raceId}-r${metadata.scopeRevision}.xml"`,
        "content-length": String(bytes.byteLength), etag: `"sha256-${metadata.completeXmlSha256}"`,
        "x-otid-content-sha256": metadata.completeXmlSha256, "x-otid-race-id": raceId,
        "x-otid-finalization-id": metadata.id, "x-otid-finalization-revision": String(metadata.scopeRevision),
        "x-otid-snapshot-version": String(metadata.sourceSnapshotVersion),
        "x-otid-class-count": String(metadata.classCount), "x-otid-result-count": String(metadata.entryCount)
      } });
    }
    if (action.kind === "result-export") {
      const result = await dependencies.resultExport(db, { sessionToken: proof.sessionToken, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const metadata = iofResultListExportMetadataSchema.parse(result.metadata);
      if (metadata.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      const bytes = Uint8Array.from(result.bytes);
      return new Response(bytes, { headers: { ...privateEntryClassAdminHeaders,
        "content-type": "application/xml; charset=utf-8",
        "content-disposition": `attachment; filename="otid-result-list-${raceId}.xml"`,
        "content-length": String(bytes.byteLength), etag: `"sha256-${metadata.sha256}"`,
        "x-otid-content-sha256": metadata.sha256, "x-otid-race-id": raceId,
        "x-otid-snapshot-version": String(metadata.snapshotVersion),
        "x-otid-class-count": String(metadata.classCount), "x-otid-result-count": String(metadata.resultCount),
        "x-otid-stale-result-count": String(metadata.staleResultCount),
        "x-otid-omitted-entry-count": String(metadata.omittedEntryCount)
      } });
    }
    if (action.kind === "session") return json(raceAdministratorLoginResponseSchema.parse({
      formatVersion: 1, raceId, capability: "MANAGE_RACE", expiresAt: auth.principal.expiresAt }));
    if (action.kind === "participants") {
      const result = await dependencies.participants(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = entryClassAdminListResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "transfer-candidates") {
      const result = await dependencies.transferCandidates(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = entryTransferCandidatesSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "transfer-start-slot-candidates") {
      const result = await dependencies.transferStartSlotCandidates(db, { ...proof, raceId, entryId: action.entryId,
        targetClassId: action.targetClassId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = entryTransferStartSlotCandidatesSchema.parse(result.response);
      if (response.raceId !== raceId || response.entryId !== action.entryId || response.targetClassId !== action.targetClassId) {
        return failure(500, "INTERNAL_ERROR");
      }
      return json(response);
    }
    if (action.kind === "registration-start-slot-candidates") {
      const result = await dependencies.registrationStartSlotCandidates(db, { ...proof, raceId, targetClassId: action.targetClassId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = entryRegistrationStartSlotCandidatesSchema.parse(result.response);
      if (response.raceId !== raceId || response.targetClassId !== action.targetClassId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "registration-candidates") {
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = entryRegistrationCandidatesRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.registrationCandidates(db, { ...proof, raceId, request: parsed.data });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = entryRegistrationCandidatesResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.snapshotVersion !== parsed.data.expectedSnapshotVersion) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "registration") {
      const key = entryRegistrationIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = entryRegistrationRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.registration(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "registered") return resultFailure(result.status);
      return json(parseRegistrationReceipt(result.response, raceId, {
        id: key.data.slice("entry-registration:".length), request: parsed.data
      }));
    }
    if (action.kind === "identity-candidates") {
      const result = await dependencies.identityCandidates(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = entryIdentityAdminListResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "identity") {
      const key = entryIdentityChangeIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryIdentityAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = entryIdentityChangeRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.identity(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "changed") return resultFailure(result.status);
      return json(parseIdentityReceipt(result.response, raceId, {
        id: key.data.slice("entry-identity-change:".length), entryId: action.entryId, request: parsed.data
      }));
    }
    if (action.kind === "approval-candidates") {
      const result = await dependencies.approvalCandidates(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = resultApprovalCandidateResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "approval-withdrawals") {
      const result = await dependencies.approvalWithdrawals(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = resultApprovalWithdrawalListResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "approval") {
      const key = resultApprovalIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = resultApprovalRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.approval(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "approved") return resultFailure(result.status);
      return json(parseResultApprovalResponse(result.response, { request: parsed.data,
        requestId: key.data.slice("manual-result-approval:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
    }
    if (action.kind === "approval-withdrawal") {
      const key = resultApprovalWithdrawalIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = resultApprovalWithdrawalRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.approvalWithdrawal(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "withdrawn") return resultFailure(result.status);
      return json(parseResultApprovalWithdrawalResponse(result.response, { request: parsed.data,
        requestId: key.data.slice("manual-result-approval-withdrawal:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
    }
    if (action.kind === "disqualification-candidates") {
      const result = await dependencies.dsqCandidates(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = resultDisqualificationCandidateResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "disqualification-withdrawals") {
      const result = await dependencies.dsqWithdrawals(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = resultDisqualificationWithdrawalListResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "disqualification") {
      const key = resultDisqualificationIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = resultDisqualificationRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.dsq(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "disqualified") return resultFailure(result.status);
      return json(parseResultDisqualificationResponse(result.response, { request: parsed.data,
        requestId: key.data.slice("manual-disqualification:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
    }
    if (action.kind === "disqualification-withdrawal") {
      const key = resultDisqualificationWithdrawalIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = resultDisqualificationWithdrawalRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.dsqWithdrawal(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "withdrawn") return resultFailure(result.status);
      return json(parseResultDisqualificationWithdrawalResponse(result.response, { request: parsed.data,
        requestId: key.data.slice("manual-disqualification-withdrawal:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
    }
    if (action.kind === "without-timing-candidates") {
      const result = await dependencies.ntCandidates(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = withoutTimingCandidateResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "without-timing-withdrawals") {
      const result = await dependencies.ntWithdrawals(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = withoutTimingWithdrawalListResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "without-timing") {
      const key = withoutTimingIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = withoutTimingRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.nt(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "without-timing") return resultFailure(result.status);
      return json(parseWithoutTimingResponse(result.response, { request: parsed.data,
        requestId: key.data.slice("without-timing:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
    }
    if (action.kind === "without-timing-withdrawal") {
      const key = withoutTimingWithdrawalIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = withoutTimingWithdrawalRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.ntWithdrawal(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "withdrawn") return resultFailure(result.status);
      return json(parseWithoutTimingWithdrawalResponse(result.response, { request: parsed.data,
        requestId: key.data.slice("without-timing-withdrawal:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
    }
    if (action.kind === "out-of-competition-candidates") {
      const result = await dependencies.oocCandidates(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = outOfCompetitionCandidateResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "out-of-competition-withdrawals") {
      const result = await dependencies.oocWithdrawals(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = outOfCompetitionWithdrawalListResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "out-of-competition") {
      const key = outOfCompetitionIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = outOfCompetitionRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.ooc(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "out-of-competition") return resultFailure(result.status);
      return json(parseOutOfCompetitionResponse(result.response, { request: parsed.data,
        requestId: key.data.slice("out-of-competition:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
    }
    if (action.kind === "out-of-competition-withdrawal") {
      const key = outOfCompetitionWithdrawalIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = outOfCompetitionWithdrawalRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.oocWithdrawal(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "withdrawn") return resultFailure(result.status);
      return json(parseOutOfCompetitionWithdrawalResponse(result.response, { request: parsed.data,
        requestId: key.data.slice("out-of-competition-withdrawal:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
    }
    if (action.kind === "did-not-finish-candidates") {
      const result = await dependencies.dnfCandidates(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = didNotFinishCandidateResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "did-not-finish-withdrawals") {
      const result = await dependencies.dnfWithdrawals(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = didNotFinishWithdrawalListResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "did-not-finish") {
      const key = didNotFinishIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = didNotFinishRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.dnf(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "did-not-finish") return resultFailure(result.status);
      return json(parseDidNotFinishResponse(result.response, { request: parsed.data,
        requestId: key.data.slice("did-not-finish:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
    }
    if (action.kind === "did-not-finish-withdrawal") {
      const key = didNotFinishWithdrawalIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = didNotFinishWithdrawalRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.dnfWithdrawal(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "withdrawn") return resultFailure(result.status);
      return json(parseDidNotFinishWithdrawalResponse(result.response, { request: parsed.data,
        requestId: key.data.slice("did-not-finish-withdrawal:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
    }
    if (action.kind === "did-not-start-candidates") {
      const result = await dependencies.dnsCandidates(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = didNotStartCandidateResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "did-not-start-withdrawals") {
      const result = await dependencies.dnsWithdrawals(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = didNotStartWithdrawalListResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "did-not-start") {
      const key = didNotStartIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = didNotStartRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.dns(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "decided") return resultFailure(result.status);
      return json(parseDidNotStartResponse(result.response, { ...parsed.data,
        requestId: key.data.slice("did-not-start:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
    }
    if (action.kind === "did-not-start-withdrawal") {
      const key = didNotStartWithdrawalIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = didNotStartWithdrawalRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.dnsWithdrawal(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "withdrawn") return resultFailure(result.status);
      return json(parseDidNotStartWithdrawalResponse(result.response, { request: parsed.data,
        requestId: key.data.slice("did-not-start-withdrawal:".length), entryId: action.entryId, displayName: "", className: "" }, raceId));
    }
    if (action.kind === "changes") {
      const result = await dependencies.changes(db, { ...proof, raceId, entryId: action.entryId,
        ...(beforeVersion === undefined ? {} : { beforeVersion }) });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = administratorEntryChangesResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.entryId !== action.entryId ||
        (beforeVersion !== undefined && response.items.some(item => item.entryVersionAfter >= beforeVersion))) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "effective-result") {
      const result = await dependencies.effectiveResult(db, { ...proof, raceId, entryId: action.entryId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = administratorEffectiveResultResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.entryId !== action.entryId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "speaker-board") {
      if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.speakerBoard(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = speakerBoardResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "recalculation-candidates") {
      const result = await dependencies.recalculationCandidates(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = resultRecalculationCandidateResponseSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "class-result-recalculation" && request.method === "GET") {
      if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.classResultRecalculationCandidates(db, { ...proof, raceId, classId: action.classId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = classResultRecalculationCandidateResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.classId !== action.classId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "class-result-recalculation") {
      const key = classResultRecalculationIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = classResultRecalculationRequestSchema.safeParse(body);
      if (!parsed.success || parsed.data.classId !== action.classId) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.classResultRecalculate(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "recalculated") return resultFailure(result.status);
      const response = classResultRecalculationResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.classId !== action.classId || response.requestId !== key.data.slice("class-result-recalculation:".length) ||
          response.manifestHash !== parsed.data.manifestHash || response.snapshotVersion !== parsed.data.snapshotVersion ||
          response.engineVersion !== parsed.data.engineVersion || response.items.length !== parsed.data.entryIds.length ||
          new Set(response.items.map((item) => item.entryId)).size !== response.items.length ||
          response.items.some((item) => !parsed.data.entryIds.includes(item.entryId))) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "recalculate") {
      const key = resultRecalculationIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = resultRecalculationRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.recalculate(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "recalculated") return resultFailure(result.status);
      const response = resultRecalculationResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.entryId !== action.entryId || response.readoutId !== parsed.data.expectedReadoutId ||
        response.requestId !== key.data.slice("result-recalculation:".length) ||
        response.revision !== (parsed.data.expectedLatestResultRevision?.revision ?? 0) + 1 ||
        response.engineVersion !== parsed.data.expectedEngineVersion || response.snapshotVersion !== parsed.data.expectedSnapshotVersion) {
        return failure(500, "INTERNAL_ERROR");
      }
      return json(response);
    }
    if (action.kind === "start-time") {
      const key = entryStartTimeChangeIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = entryStartTimeChangeRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.startTime(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "changed") return resultFailure(result.status);
      const response = entryStartTimeChangeResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.entryId !== action.entryId || response.classId !== parsed.data.expectedClassId ||
        response.requestId !== key.data.slice("entry-start-time-change:".length) || response.entryVersionBefore !== parsed.data.expectedEntryVersion ||
        response.snapshotVersionBefore !== parsed.data.expectedSnapshotVersion || response.previousFixedStartTime !== parsed.data.expectedFixedStartTime ||
        response.fixedStartTime !== parsed.data.fixedStartTime) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "card") {
      const key = entryCardChangeIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = entryCardChangeRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.card(db, { ...proof, raceId, entryId: action.entryId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "changed") return resultFailure(result.status);
      const response = entryCardChangeResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.entryId !== action.entryId || response.classId !== parsed.data.expectedClassId ||
        response.requestId !== key.data.slice("entry-card-change:".length) || response.entryVersionBefore !== parsed.data.expectedEntryVersion ||
        response.snapshotVersionBefore !== parsed.data.expectedSnapshotVersion || response.activeAssignment.cardNumber !== parsed.data.cardNumber ||
        (response.previousAssignment?.id ?? null) !== (parsed.data.expectedAssignment?.id ?? null) ||
        (response.previousAssignment?.cardNumber ?? null) !== (parsed.data.expectedAssignment?.cardNumber ?? null)) {
        return failure(500, "INTERNAL_ERROR");
      }
      return json(response);
    }
    if (action.kind === "card-rental") {
      const key = entryCardRentalChangeIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = entryCardRentalChangeRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.cardRental(db, { ...proof, raceId, entryId: action.entryId,
        idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "changed") return resultFailure(result.status);
      const response = entryCardRentalChangeResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.entryId !== action.entryId ||
        response.classId !== parsed.data.expectedClassId ||
        response.requestId !== key.data.slice("entry-card-rental-change:".length) ||
        response.assignment.id !== parsed.data.expectedAssignment.id ||
        response.assignment.cardNumber !== parsed.data.expectedAssignment.cardNumber ||
        response.previousIsRental !== parsed.data.expectedAssignment.isRental || response.isRental !== parsed.data.isRental ||
        response.entryVersionBefore !== parsed.data.expectedEntryVersion ||
        response.snapshotVersionBefore !== parsed.data.expectedSnapshotVersion) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "card-rental-return") {
      const key = entryCardRentalReturnChangeIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = entryCardRentalReturnChangeRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.cardRentalReturn(db, { ...proof, raceId, entryId: action.entryId,
        idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "changed") return resultFailure(result.status);
      const response = entryCardRentalReturnChangeResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.entryId !== action.entryId ||
        response.classId !== parsed.data.expectedClassId ||
        response.requestId !== key.data.slice("entry-card-rental-return-change:".length) ||
        response.assignment.id !== parsed.data.expectedAssignment.id ||
        response.assignment.cardNumber !== parsed.data.expectedAssignment.cardNumber ||
        response.previousRentalReturned !== parsed.data.expectedAssignment.rentalReturned ||
        response.rentalReturned !== parsed.data.rentalReturned ||
        response.entryVersionBefore !== parsed.data.expectedEntryVersion ||
        response.snapshotVersionBefore !== parsed.data.expectedSnapshotVersion) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "card-rental-reuse") {
      const key = entryCardRentalReuseIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = entryCardRentalReuseRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.cardRentalReuse(db, { ...proof, raceId, entryId: action.entryId,
        idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "changed") return resultFailure(result.status);
      const response = entryCardRentalReuseResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.target.entryId !== action.entryId ||
        response.target.classId !== parsed.data.expectedTargetClassId ||
        response.requestId !== key.data.slice("entry-card-rental-reuse:".length) ||
        response.source.entryId !== parsed.data.source.entryId || response.source.classId !== parsed.data.source.classId ||
        response.source.assignment.id !== parsed.data.source.assignment.id ||
        response.source.assignment.cardNumber !== parsed.data.source.assignment.cardNumber ||
        response.sourceEntryVersionBefore !== parsed.data.source.entryVersion ||
        response.targetEntryVersionBefore !== parsed.data.expectedTargetEntryVersion ||
        response.snapshotVersionBefore !== parsed.data.expectedSnapshotVersion) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "payment-status") {
      const key = entryPaymentStatusChangeIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = entryPaymentStatusChangeRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.paymentStatus(db, { ...proof, raceId, entryId: action.entryId,
        idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "changed") return resultFailure(result.status);
      const response = entryPaymentStatusChangeResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.entryId !== action.entryId ||
        response.classId !== parsed.data.expectedClassId ||
        response.requestId !== key.data.slice("entry-payment-status-change:".length) ||
        response.entryVersionAtChange !== parsed.data.expectedEntryVersion ||
        response.previousPaymentStatus !== parsed.data.expectedPaymentStatus ||
        response.paymentStatusVersionBefore !== parsed.data.expectedPaymentStatusVersion ||
        response.paymentStatus !== parsed.data.paymentStatus) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "manual-class-name" && request.method === "GET") {
      if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.manualClassNameCandidate(db, { ...proof, raceId, classId: action.classId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = manualClassNameCandidateSchema.parse(result.response);
      if (response.raceId !== raceId || response.classId !== action.classId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "manual-class-name") {
      const key = manualClassNameChangeIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = manualClassNameChangeRequestSchema.safeParse(body);
      if (!parsed.success || key.data !== `manual-class-name:${parsed.data.requestId}`) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.manualClassName(db, { ...proof, raceId, classId: action.classId,
        idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "changed") return resultFailure(result.status);
      const response = manualClassNameChangeResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.classId !== action.classId || response.requestId !== parsed.data.requestId ||
        JSON.stringify(response.request) !== JSON.stringify(parsed.data)) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "manual-class") {
      const key = manualClassCreateIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = manualClassCreateRequestSchema.safeParse(body);
      if (!parsed.success || key.data !== `manual-class-create:${parsed.data.requestId}`) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.manualClass(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "created") return resultFailure(result.status);
      const response = manualClassCreateResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.requestId !== parsed.data.requestId ||
        JSON.stringify(response.request) !== JSON.stringify(parsed.data)) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    if (action.kind === "manual-course-class") {
      const key = manualCourseClassCreateIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = manualCourseClassCreateRequestSchema.safeParse(body);
      if (!parsed.success || key.data.slice("manual-course-class-create:".length) !== parsed.data.requestId) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.manualCourseClass(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "created") return resultFailure(result.status);
      const response = manualCourseClassCreateResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.requestId !== parsed.data.requestId ||
        JSON.stringify(response.request) !== JSON.stringify(parsed.data) || response.snapshotVersionBefore !== parsed.data.expectedSnapshotVersion) {
        return failure(500, "INTERNAL_ERROR");
      }
      return json(response);
    }
    if (action.kind === "capacity") {
      const key = classCapacityKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = classCapacityRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.capacity(db, { ...proof, raceId, classId: action.classId, idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "changed") return resultFailure(result.status);
      const response = classCapacityResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.classId !== action.classId || response.requestId !== key.data.slice("class-capacity:".length) ||
        response.versionBefore !== parsed.data.expectedCapacityVersion || response.previousMaxEntries !== parsed.data.expectedMaxEntries || response.maxEntries !== parsed.data.maxEntries) {
        return failure(500, "INTERNAL_ERROR");
      }
      return json(response);
    }
    if (action.kind === "transfer") {
      const key = entryTransferIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return failure(400, "INVALID_REQUEST");
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = entryTransferRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.transfer(db, { ...proof, raceId, entryId: action.entryId,
        idempotencyKey: key.data, request: parsed.data });
      if (result.status !== "transferred") return resultFailure(result.status);
      const response = entryTransferResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.entryId !== action.entryId ||
        response.requestId !== key.data.slice("entry-transfer:".length) || JSON.stringify(response.request) !== JSON.stringify(parsed.data)) {
        return failure(500, "INTERNAL_ERROR");
      }
      return json(response);
    }
    const key = entryClassChangeIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = entryClassChangeRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.changeClass(db, { ...proof, raceId, entryId: action.entryId,
      idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "changed") return resultFailure(result.status);
    const response = entryClassChangeResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== action.entryId || response.classId !== parsed.data.classId ||
      response.entryVersionBefore !== parsed.data.expectedEntryVersion || response.requestId !== key.data.slice("entry-class-change:".length)) {
      return failure(500, "INTERNAL_ERROR");
    }
    return json(response);
  } catch { return failure(500, "INTERNAL_ERROR"); }
}
