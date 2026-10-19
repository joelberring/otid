import { loadStartDrawSetupAsAdmin, previewStartDrawAsAdmin, commitStartDrawAsAdmin,
  listResultFinalizationCandidatesAsAdmin, finalizeResultsAsAdmin,
  exportIofResultListAsAdmin, exportFrozenIofResultListAsAdmin, listFrozenRaceFinalizationsAsAdmin,
  requireRaceRole, changeEntryClassAsAdmin, listEntryClassesAsAdmin, logoutUserAccountSession,
  listEntryTransfersAsAdmin, transferEntryAsAdmin,
  changeClassCapacityAsAdmin, editClassAsAdmin, previewClassEditAsAdmin,
  createManualCourseClassAsAdmin, createManualClassAsAdmin, listCoursesForEditAsAdmin, previewCourseEditAsAdmin,
  editCourseAsAdmin, previewShortenedCourseClassTransferAsAdmin, transferShortenedCourseClassAsAdmin,
  getEntryStatusAsAdmin, setEntryStatus, listUnknownReadoutResolutionCandidatesAsAdmin,
  resolveUnknownReadoutAsAdmin, changeEntryCardAsAdmin, changeEntryCardRentalAsAdmin,
  changeEntryCardRentalReturnAsAdmin, reuseReturnedRentalCardAsAdmin,
  changeEntryStartTimeAsAdmin, listResultRecalculationCandidatesAsAdmin,
  recalculateEntryAsAdmin, getAdministratorEffectiveResult, listSpeakerBoardAsAdmin,
  listClassResultRecalculationCandidatesAsAdmin, recalculateClassResultsAsAdmin,
  listEntryIdentitiesAsAdmin, changeEntryIdentityAsAdmin, registerEntryAsAdmin,
  listEntryRegistrationCandidatesAsAdmin, listAdministratorEntryChanges,
  getStartListPublicationPreviewAsAdmin, decideStartListPublicationAsAdmin,
  exportCurrentStartListXmlAsAdmin,
  listAdministratorForestWatch, registerAdministratorReturn, withdrawAdministratorReturn, correctAdministratorStart,
  listCheckinHistoryAsAdmin, readStartCheckinConflictReviewAsAdmin, reviewStartCheckinConflictsAsAdmin,
  previewEntryVariantAsAdmin, changeEntryVariantAsAdmin, distributeClassVariantsAsAdmin,
  getRelayOverviewAsAdmin, createRelayClassAsAdmin, registerRelayTeamAsAdmin,
  changeRelayLegRunnerAsAdmin, setRelayStartTimesAsAdmin, saveRaceSettingsAsAdmin,
  getEventorSettingsAsAdmin, saveEventorKeyAsAdmin, removeEventorKeyAsAdmin, testEventorConnectionAsAdmin,
  listEventorEventsAsAdmin, chooseEventorEventAsAdmin, previewEventorSyncAsAdmin, previewCourseFileAsAdmin,
  syncConsequenceAsAdmin, applySyncAsAdmin, getSourceSyncStatusAsAdmin,
  previewRogainingChangeAsAdmin, changeRogainingAsAdmin,
  readRaceMapStateAsAdmin, readRaceMapImageAsAdmin, saveRaceMapAsAdmin, georeferenceRaceMapAsAdmin,
  removeRaceMapAsAdmin, saveParticipantRouteAsAdmin, removeParticipantRouteAsAdmin,
  listRacePeopleAsAdmin, grantRacePersonAsAdmin, revokeRacePersonAsAdmin,
  setRacePublicationAsAdmin, getRadioSettingsAsAdmin, saveRadioSettingsAsAdmin,
  fetchRadioNowAsAdmin } from "@o-tid/application";
import {
  adminFailure as failure,
  resultExportFailure,
  type sessionProof
} from "./security-policy";
import type { Database } from "@o-tid/database";

/** Tjänsterna som administratörsroutes använder. Tester kan ersätta enskilda tjänster. */
export const raceAdministratorServices = { conflictCandidate: readStartCheckinConflictReviewAsAdmin, reviewConflicts: reviewStartCheckinConflictsAsAdmin, checkinHistory: listCheckinHistoryAsAdmin, correctStart: correctAdministratorStart, withdrawReturn: withdrawAdministratorReturn, manualReturn: registerAdministratorReturn, forestWatch: listAdministratorForestWatch, publicationPreview: getStartListPublicationPreviewAsAdmin, publication: decideStartListPublicationAsAdmin,
  startListExport: exportCurrentStartListXmlAsAdmin,
  drawSetup: loadStartDrawSetupAsAdmin, drawPreview: previewStartDrawAsAdmin, draw: commitStartDrawAsAdmin,
  finalizationCandidates: listResultFinalizationCandidatesAsAdmin, finalize: finalizeResultsAsAdmin,
  frozenResults: listFrozenRaceFinalizationsAsAdmin, frozenResult: exportFrozenIofResultListAsAdmin,
  resultExport: exportIofResultListAsAdmin, authenticate: requireRaceRole,
  logout: logoutUserAccountSession, participants: listEntryClassesAsAdmin, changeClass: changeEntryClassAsAdmin,
  transferCandidates: listEntryTransfersAsAdmin,
  transfer: transferEntryAsAdmin, capacity: changeClassCapacityAsAdmin,
  manualCourseClass: createManualCourseClassAsAdmin,
  manualClass: createManualClassAsAdmin,
  courses: listCoursesForEditAsAdmin, courseEditPreview: previewCourseEditAsAdmin,
  courseEdit: editCourseAsAdmin, classEditPreview: previewClassEditAsAdmin, classEdit: editClassAsAdmin,
  rogainingPreview: previewRogainingChangeAsAdmin, rogaining: changeRogainingAsAdmin,
  entryVariantPreview: previewEntryVariantAsAdmin, entryVariant: changeEntryVariantAsAdmin,
  classVariantDistribution: distributeClassVariantsAsAdmin,
  relayOverview: getRelayOverviewAsAdmin, relayClass: createRelayClassAsAdmin, relayTeam: registerRelayTeamAsAdmin,
  relayLegRunner: changeRelayLegRunnerAsAdmin, relayStartTimes: setRelayStartTimesAsAdmin,
  raceSettings: saveRaceSettingsAsAdmin,
  eventorSettings: getEventorSettingsAsAdmin, eventorKey: saveEventorKeyAsAdmin, eventorKeyRemove: removeEventorKeyAsAdmin,
  eventorTest: testEventorConnectionAsAdmin, eventorEvents: listEventorEventsAsAdmin, eventorEvent: chooseEventorEventAsAdmin,
  eventorSyncPreview: previewEventorSyncAsAdmin, courseFilePreview: previewCourseFileAsAdmin,
  syncConsequence: syncConsequenceAsAdmin, syncApply: applySyncAsAdmin, syncStatus: getSourceSyncStatusAsAdmin,
  shortenedCourseClassTransferPreview: previewShortenedCourseClassTransferAsAdmin,
  shortenedCourseClassTransfer: transferShortenedCourseClassAsAdmin,
  entryStatus: getEntryStatusAsAdmin, setEntryStatus,
  unknownReadoutResolutionCandidates: listUnknownReadoutResolutionCandidatesAsAdmin,
  unknownReadoutResolution: resolveUnknownReadoutAsAdmin,
  card: changeEntryCardAsAdmin, cardRental: changeEntryCardRentalAsAdmin,
  cardRentalReturn: changeEntryCardRentalReturnAsAdmin,
  cardRentalReuse: reuseReturnedRentalCardAsAdmin,
  startTime: changeEntryStartTimeAsAdmin,
  recalculationCandidates: listResultRecalculationCandidatesAsAdmin, recalculate: recalculateEntryAsAdmin,
  classResultRecalculationCandidates: listClassResultRecalculationCandidatesAsAdmin,
  classResultRecalculate: recalculateClassResultsAsAdmin,
  effectiveResult: getAdministratorEffectiveResult, speakerBoard: listSpeakerBoardAsAdmin,
  identityCandidates: listEntryIdentitiesAsAdmin, identity: changeEntryIdentityAsAdmin,
  registration: registerEntryAsAdmin, registrationCandidates: listEntryRegistrationCandidatesAsAdmin,

  changes: listAdministratorEntryChanges,
  raceMapState: readRaceMapStateAsAdmin, raceMapImage: readRaceMapImageAsAdmin, raceMapSave: saveRaceMapAsAdmin,
  raceMapGeoreference: georeferenceRaceMapAsAdmin, raceMapRemove: removeRaceMapAsAdmin,
  participantRouteSave: saveParticipantRouteAsAdmin, participantRouteRemove: removeParticipantRouteAsAdmin,
  people: listRacePeopleAsAdmin, grantPerson: grantRacePersonAsAdmin, revokePerson: revokeRacePersonAsAdmin,
  racePublication: setRacePublicationAsAdmin,
  radioSettings: getRadioSettingsAsAdmin, radioSave: saveRadioSettingsAsAdmin, radioFetch: fetchRadioNowAsAdmin };
export type RaceAdministratorAction = { kind: "conflict-candidate"; entryId: string } | { kind: "review-conflicts" } | { kind: "checkin-history"; entryId: string } | { kind: "start-correction" } | { kind: "manual-return-withdrawal" } | { kind: "manual-return" } | { kind: "forest-watch" } | { kind: "publication-preview" } | { kind: "publication" } | { kind: "start-list-export" } | { kind: "draw-preview" } | { kind: "draw" } |
  { kind: "finalization-candidates" } | { kind: "finalize" } | { kind: "frozen-results" } | { kind: "frozen-result"; finalizationId: string } |
  { kind: "result-export" } | { kind: "session" } | { kind: "participants" } | { kind: "transfer-candidates" } |
  { kind: "class"; entryId: string } | { kind: "transfer"; entryId: string } | { kind: "capacity"; classId: string } |
  { kind: "manual-course-class" } | { kind: "manual-class" } |
  { kind: "courses" } | { kind: "course-edit-preview"; courseId: string } | { kind: "course-edit"; courseId: string } |
  { kind: "class-edit-preview"; classId: string } | { kind: "class-edit"; classId: string } |
  { kind: "rogaining-preview" } | { kind: "rogaining" } |
  { kind: "entry-variant-preview"; entryId: string } | { kind: "entry-variant"; entryId: string } |
  { kind: "class-variant-distribution"; classId: string } |
  { kind: "relay" } | { kind: "relay-class" } | { kind: "relay-team" } | { kind: "relay-leg-runner" } | { kind: "relay-start-times" } |
  { kind: "race-settings" } |
  { kind: "eventor" } | { kind: "eventor-test" } | { kind: "eventor-events" } | { kind: "eventor-event" } | { kind: "eventor-sync-preview" } |
  { kind: "course-file-preview" } | { kind: "source-sync-consequence" } | { kind: "source-sync" } |
  { kind: "shortened-course-class-transfer"; classId: string } |
  { kind: "entry-status"; entryId: string } |
  { kind: "unknown-readout-resolution" } |
  { kind: "card"; entryId: string } | { kind: "card-rental"; entryId: string } |
  { kind: "card-rental-return"; entryId: string } | { kind: "card-rental-reuse"; entryId: string } |
  { kind: "start-time"; entryId: string } |
  { kind: "recalculation-candidates" } | { kind: "recalculate"; entryId: string } |
  { kind: "class-result-recalculation"; classId: string } | { kind: "effective-result"; entryId: string } | { kind: "speaker-board" } |
  { kind: "identity-candidates" } | { kind: "identity"; entryId: string } | { kind: "registration" } | { kind: "registration-candidates" } |
  { kind: "changes"; entryId: string } |
  { kind: "race-map" } | { kind: "race-map-image" } | { kind: "race-map-georeference" } | { kind: "participant-route" } |
  { kind: "people" } | { kind: "race-publication" } | { kind: "radio" } | { kind: "radio-fetch" };

export function resultFailure(status: string): Response {
  switch (status) {
    case "unauthorized": return failure(401, "UNAUTHORIZED");
    case "forbidden": return failure(403, "FORBIDDEN");
    case "invalid-request": return failure(400, "INVALID_REQUEST");
    case "not-found": return failure(404, "NOT_FOUND");
    case "conflict": return failure(409, "CONFLICT");
    case "duplicate-name": return failure(409, "DUPLICATE_NAME");
    case "too-large": return resultExportFailure(413, "TOO_LARGE");
    default: return failure(500, "INTERNAL_ERROR");
  }
}

export type RaceAdministratorServices = typeof raceAdministratorServices;

/** Det som varje grupp av administratörsroutes får efter att verklig administratörsroll är kontrollerad. */
export type RaceAdministratorRouteContext = {
  db: Database; request: Request; raceId: string; action: RaceAdministratorAction; dependencies: RaceAdministratorServices;
  proof: ReturnType<typeof sessionProof>; cursor: string | null; beforeVersion: number | undefined;
};
