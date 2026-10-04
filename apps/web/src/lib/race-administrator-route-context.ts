import { listClassStartDrawClassesAsAdmin, previewClassStartDrawAsAdmin, commitClassStartDrawAsAdmin,
  listFixedStartSlotPlansAsAdministrator, listResultFinalizationCandidatesAsAdmin, finalizeResultsAsAdmin,
  exportIofResultListAsAdmin, exportFrozenIofResultListAsAdmin, listFrozenRaceFinalizationsAsAdmin,
  authenticatePairingAdminSession, changeEntryClassAsAdmin, listEntryClassesAsAdmin, logoutPairingAdminSession,
  listEntryTransfersAsAdministrator, listEntryTransferStartSlotsAsAdministrator, transferEntryAsAdministrator,
  changeClassCapacityAsAdministrator, editClassAsAdministrator, previewClassEditAsAdministrator,
  createManualCourseClassAsAdministrator, createManualClassAsAdministrator, listCoursesForEditAsAdministrator, previewCourseEditAsAdministrator,
  editCourseAsAdministrator, previewShortenedCourseClassTransferAsAdministrator, transferShortenedCourseClassAsAdministrator,
  previewManualFinishTimeCorrectionAsAdministrator, correctManualFinishTimeAsAdministrator,
  previewManualPunchStartTimeCorrectionAsAdministrator, correctManualPunchStartTimeAsAdministrator,
  previewManualPunchStartTimeCorrectionWithdrawalAsAdministrator,
  withdrawManualPunchStartTimeCorrectionAsAdministrator, previewManualFinishTimeCorrectionWithdrawalAsAdministrator,
  withdrawManualFinishTimeCorrectionAsAdministrator, listUnknownReadoutResolutionCandidatesAsAdministrator,
  resolveUnknownReadoutAsAdministrator, changeEntryCardAsAdmin, changeEntryCardRentalAsAdministrator,
  changeEntryCardRentalReturnAsAdministrator, reuseReturnedRentalCardAsAdministrator,
  changeEntryPaymentStatusAsAdministrator, changeEntryStartTimeAsAdmin, listResultRecalculationCandidatesAsAdmin,
  recalculateEntryAsAdmin, getAdministratorEffectiveResult, listSpeakerBoardAsAdministrator,
  listClassResultRecalculationCandidatesAsAdministrator, recalculateClassResultsAsAdministrator,
  listEntryIdentitiesAsAdmin, changeEntryIdentityAsAdmin, registerEntryAsAdmin, listEntryRegistrationStartSlotsAsAdmin,
  listEntryRegistrationCandidatesAsAdmin, listAdministratorEntryChanges, listDidNotStartCandidatesAsAdmin,
  decideDidNotStartAsAdmin, listDidNotStartWithdrawalsAsAdmin, withdrawDidNotStartAsAdmin,
  listDidNotFinishCandidatesAsAdmin, decideDidNotFinishAsAdmin, listDidNotFinishWithdrawalsAsAdmin,
  withdrawDidNotFinishAsAdmin, listResultDisqualificationCandidatesAsAdmin, disqualifyResultAsAdmin,
  listResultDisqualificationWithdrawalsAsAdmin, withdrawResultDisqualificationAsAdmin,
  listResultApprovalCandidatesAsAdmin, approveResultAsAdmin, listResultApprovalWithdrawalsAsAdmin,
  withdrawResultApprovalAsAdmin, listOutOfCompetitionCandidatesAsAdmin, decideOutOfCompetitionAsAdmin,
  listOutOfCompetitionWithdrawalsAsAdmin, withdrawOutOfCompetitionAsAdmin, listWithoutTimingCandidatesAsAdmin,
  decideWithoutTimingAsAdmin, listWithoutTimingWithdrawalsAsAdmin, withdrawWithoutTimingAsAdmin,
  listRaceOperatorAccessAsAdministrator, issueRaceOperatorAccessAsAdministrator,
  revokeRaceOperatorAccessAsAdministrator, getStartListPublicationPreviewAsAdmin, decideStartListPublicationAsAdmin,
  listAdministratorForestWatch, registerAdministratorReturn, withdrawAdministratorReturn, correctAdministratorStart,
  listCheckinHistoryAsAdmin, readStartCheckinConflictReviewAsAdmin, reviewStartCheckinConflictsAsAdmin } from "@o-tid/application";
import { iofResultListExportAdminFailure } from "./iof-result-list-export-admin-security";
import type { Database } from "@o-tid/database";
import { entryClassAdminFailure as failure, type entryClassAdminSessionProof } from "./entry-class-admin-security";

/** Tjänsterna som administratörsroutes använder. Tester kan ersätta enskilda tjänster. */
export const raceAdministratorServices = { conflictCandidate: readStartCheckinConflictReviewAsAdmin, reviewConflicts: reviewStartCheckinConflictsAsAdmin, checkinHistory: listCheckinHistoryAsAdmin, correctStart: correctAdministratorStart, withdrawReturn: withdrawAdministratorReturn, manualReturn: registerAdministratorReturn, forestWatch: listAdministratorForestWatch, publicationPreview: getStartListPublicationPreviewAsAdmin, publication: decideStartListPublicationAsAdmin,
  drawClasses: listClassStartDrawClassesAsAdmin, drawPreview: previewClassStartDrawAsAdmin, draw: commitClassStartDrawAsAdmin,
  fixedStartSlotPlans: listFixedStartSlotPlansAsAdministrator,
  finalizationCandidates: listResultFinalizationCandidatesAsAdmin, finalize: finalizeResultsAsAdmin,
  frozenResults: listFrozenRaceFinalizationsAsAdmin, frozenResult: exportFrozenIofResultListAsAdmin,
  resultExport: exportIofResultListAsAdmin, authenticate: authenticatePairingAdminSession,
  logout: logoutPairingAdminSession, participants: listEntryClassesAsAdmin, changeClass: changeEntryClassAsAdmin,
  transferCandidates: listEntryTransfersAsAdministrator, transferStartSlotCandidates: listEntryTransferStartSlotsAsAdministrator,
  transfer: transferEntryAsAdministrator, capacity: changeClassCapacityAsAdministrator,
  manualCourseClass: createManualCourseClassAsAdministrator,
  manualClass: createManualClassAsAdministrator,
  courses: listCoursesForEditAsAdministrator, courseEditPreview: previewCourseEditAsAdministrator,
  courseEdit: editCourseAsAdministrator, classEditPreview: previewClassEditAsAdministrator, classEdit: editClassAsAdministrator,
  shortenedCourseClassTransferPreview: previewShortenedCourseClassTransferAsAdministrator,
  shortenedCourseClassTransfer: transferShortenedCourseClassAsAdministrator,
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
export type RaceAdministratorAction = { kind: "conflict-candidate"; entryId: string } | { kind: "review-conflicts" } | { kind: "checkin-history"; entryId: string } | { kind: "start-correction" } | { kind: "manual-return-withdrawal" } | { kind: "manual-return" } | { kind: "forest-watch" } | { kind: "publication-preview" } | { kind: "publication" } | { kind: "draw-classes" } | { kind: "draw-preview" } | { kind: "draw" } | { kind: "fixed-start-slot-plans" } |
  { kind: "finalization-candidates" } | { kind: "finalize" } | { kind: "frozen-results" } | { kind: "frozen-result"; finalizationId: string } |
  { kind: "result-export" } | { kind: "session" } | { kind: "participants" } | { kind: "transfer-candidates" } |
  { kind: "transfer-start-slot-candidates"; entryId: string; targetClassId: string } |
  { kind: "registration-start-slot-candidates"; targetClassId: string } |
  { kind: "class"; entryId: string } | { kind: "transfer"; entryId: string } | { kind: "capacity"; classId: string } |
  { kind: "manual-course-class" } | { kind: "manual-class" } |
  { kind: "courses" } | { kind: "course-edit-preview"; courseId: string } | { kind: "course-edit"; courseId: string } |
  { kind: "class-edit-preview"; classId: string } | { kind: "class-edit"; classId: string } |
  { kind: "shortened-course-class-transfer"; classId: string } |
  { kind: "manual-finish-time-correction"; entryId: string } |
  { kind: "manual-punch-start-time-correction"; entryId: string } |
  { kind: "manual-punch-start-time-correction-withdrawal"; entryId: string } |
  { kind: "manual-finish-time-correction-withdrawal"; entryId: string } |
  { kind: "unknown-readout-resolution" } |
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

export function resultFailure(status: string): Response {
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

export type RaceAdministratorServices = typeof raceAdministratorServices;

/** Det som varje grupp av administratörsroutes får efter att verklig administratörsroll är kontrollerad. */
export type RaceAdministratorRouteContext = {
  db: Database; request: Request; raceId: string; action: RaceAdministratorAction; dependencies: RaceAdministratorServices;
  proof: ReturnType<typeof entryClassAdminSessionProof>; cursor: string | null; beforeVersion: number | undefined;
};
