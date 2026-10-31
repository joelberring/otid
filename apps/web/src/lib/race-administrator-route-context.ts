import { loadStartDrawSetupAsAdmin, previewStartDrawAsAdmin, commitStartDrawAsAdmin,
  listResultFinalizationCandidatesAsAdmin, finalizeResultsAsAdmin,
  exportIofResultListAsAdmin, exportFrozenIofResultListAsAdmin, listFrozenRaceFinalizationsAsAdmin,
  requireRaceRole, changeEntryClassAsAdmin, listEntryClassesAsAdmin, logoutUserAccountSession,
  listEntryTransfersAsAdmin, transferEntryAsAdmin,
  changeClassCapacityAsAdmin, editClassAsAdmin, previewClassEditAsAdmin,
  createManualCourseClassAsAdmin, createManualClassAsAdmin, listCoursesForEditAsAdmin, previewCourseEditAsAdmin,
  editCourseAsAdmin,
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
  readMapBundlesAsAdmin, recordMapPrintAsAdmin, saveMapReserveAsAdmin,
  getRelayOverviewAsAdmin, createRelayClassAsAdmin, registerRelayTeamAsAdmin,
  changeRelayLegRunnerAsAdmin, setRelayStartTimesAsAdmin, saveRaceSettingsAsAdmin,
  editRelayClassAsAdmin, editRelayTeamAsAdmin, removeRelayTeamAsAdmin, setRelayTeamDidNotStartAsAdmin, changeRelayLegVariantAsAdmin,
  getEventorSettingsAsAdmin, saveEventorKeyAsAdmin, removeEventorKeyAsAdmin, testEventorConnectionAsAdmin,
  listEventorEventsAsAdmin, chooseEventorEventAsAdmin, previewEventorSyncAsAdmin, previewCourseFileAsAdmin,
  syncConsequenceAsAdmin, applySyncAsAdmin, getSourceSyncStatusAsAdmin,
  previewRogainingChangeAsAdmin, changeRogainingAsAdmin,
  readRaceMapStateAsAdmin, readRaceMapImageAsAdmin, saveRaceMapAsAdmin, georeferenceRaceMapAsAdmin,
  removeRaceMapAsAdmin, saveParticipantRouteAsAdmin, removeParticipantRouteAsAdmin,
  saveRaceMapSourceAsAdmin, readRaceMapSourceFileAsAdmin, removeRaceMapSourceAsAdmin,
  readRouteChoiceAsAdmin, saveRouteChoiceSettingsAsAdmin, publishRouteChoiceAsAdmin, readRouteChoiceCalibrationAsAdmin,
  listRacePeopleAsAdmin, grantRacePersonAsAdmin, revokeRacePersonAsAdmin,
  setRacePublicationAsAdmin, setCoursesPublicAsAdmin, readControlMapAsAdmin, readEntryControlMapAsAdmin, getRadioSettingsAsAdmin, saveRadioSettingsAsAdmin,
  fetchRadioNowAsAdmin, registerReadoutCard, previewRemainingRunnersAsAdmin, markRemainingDidNotStartAsAdmin,
  saveCourseDetailsAsAdmin, removeEntryAsAdmin, removeClassAsAdmin, removeCourseAsAdmin, readResultsOfficialAsAdmin,
  setResultsOfficialAsAdmin, exportRaceAsAdmin, getRunnerDatabaseSettingsAsAdmin, refreshRunnerDatabaseAsAdmin,
  deleteRunnerDatabaseAsAdmin, searchRunnerDatabaseAsAdmin, listRaceCorrectionsAsAdmin, previewRaceCorrectionAsAdmin,
  applyRaceCorrectionAsAdmin, previewReadoutRereadAsAdmin, applyReadoutRereadAsAdmin,
  receiveUninterpretedReadout, listUninterpretedReadoutsAsAdmin, rereadUninterpretedReadoutAsAdmin,
  readPartyAsAdmin, changePartyAsAdmin, setPartyGuestAsAdmin, registerPartyDeskEventAsAdmin, savePartyLogoAsAdmin,
  previewSelfRegistrationCleanupAsAdmin, strikeSelfRegisteredAsAdmin } from "@o-tid/application";
import {
  adminFailure as failure,
  resultExportFailure,
  type sessionProof
} from "./security-policy";
import type { Database } from "@o-tid/database";
import { raceChangeGeneration } from "./race-change-generation";
import { createSharedRead } from "./shared-read";

/**
 * Steg 54: Kvar i skogen delas av speakerskärmarna och arbetsytan i högst 2 s (samma innehåll för alla med behörighet).
 * Nyckeln har tävlingens ändringsgeneration: efter en ändring i arbetsytan räknas listan om vid nästa läsning.
 */
const sharedForestWatch = createSharedRead(2_000);

/** Tjänsterna som administratörsroutes använder. Tester kan ersätta enskilda tjänster. */
export const raceAdministratorServices = { conflictCandidate: readStartCheckinConflictReviewAsAdmin, reviewConflicts: reviewStartCheckinConflictsAsAdmin, checkinHistory: listCheckinHistoryAsAdmin, correctStart: correctAdministratorStart, withdrawReturn: withdrawAdministratorReturn, manualReturn: registerAdministratorReturn, forestWatch: (db: Database, input: Parameters<typeof listAdministratorForestWatch>[1]) =>
    listAdministratorForestWatch(db, input, new Date(), (raceId, compute) =>
      sharedForestWatch(`forest-watch:${raceId}:${raceChangeGeneration(raceId)}`, compute)), publicationPreview: getStartListPublicationPreviewAsAdmin, publication: decideStartListPublicationAsAdmin,
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
  // Steg 61: kartor till starten (tryckantal, kartbuntslistan, baksidorna).
  mapBundles: readMapBundlesAsAdmin, mapPrint: recordMapPrintAsAdmin, mapReserve: saveMapReserveAsAdmin,
  relayOverview: getRelayOverviewAsAdmin, relayClass: createRelayClassAsAdmin, relayTeam: registerRelayTeamAsAdmin,
  relayLegRunner: changeRelayLegRunnerAsAdmin, relayStartTimes: setRelayStartTimesAsAdmin,
  relayClassEdit: editRelayClassAsAdmin, relayTeamEdit: editRelayTeamAsAdmin, relayTeamRemoval: removeRelayTeamAsAdmin,
  relayTeamDns: setRelayTeamDidNotStartAsAdmin, relayLegVariant: changeRelayLegVariantAsAdmin,
  raceSettings: saveRaceSettingsAsAdmin,
  eventorSettings: getEventorSettingsAsAdmin, eventorKey: saveEventorKeyAsAdmin, eventorKeyRemove: removeEventorKeyAsAdmin,
  eventorTest: testEventorConnectionAsAdmin, eventorEvents: listEventorEventsAsAdmin, eventorEvent: chooseEventorEventAsAdmin,
  eventorSyncPreview: previewEventorSyncAsAdmin, courseFilePreview: previewCourseFileAsAdmin,
  syncConsequence: syncConsequenceAsAdmin, syncApply: applySyncAsAdmin, syncStatus: getSourceSyncStatusAsAdmin,
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
  // Steg 59: kartfilen (OCAD eller Mapper).
  raceMapSourceSave: saveRaceMapSourceAsAdmin, raceMapSourceFile: readRaceMapSourceFileAsAdmin, raceMapSourceRemove: removeRaceMapSourceAsAdmin,
  // Steg 60: vägvalsanalysen (inställningar, publicering och rutterna för kalibreringen).
  routeChoice: readRouteChoiceAsAdmin, routeChoiceSettings: saveRouteChoiceSettingsAsAdmin, routeChoicePublish: publishRouteChoiceAsAdmin,
  routeChoiceCalibration: readRouteChoiceCalibrationAsAdmin,
  participantRouteSave: saveParticipantRouteAsAdmin, participantRouteRemove: removeParticipantRouteAsAdmin,
  people: listRacePeopleAsAdmin, grantPerson: grantRacePersonAsAdmin, revokePerson: revokeRacePersonAsAdmin,
  racePublication: setRacePublicationAsAdmin, courseSecrecy: setCoursesPublicAsAdmin,
  // Steg 52: kontrollkartan och löparens bana på kartan.
  controlMap: readControlMapAsAdmin, entryControlMap: readEntryControlMapAsAdmin,
  radioSettings: getRadioSettingsAsAdmin, radioSave: saveRadioSettingsAsAdmin, radioFetch: fetchRadioNowAsAdmin,
  // PLAN.md steg 25: direktanmälan från avläsningssidan, kvar i skogen som ej start och banans längd och stigning.
  readoutRegistration: registerReadoutCard, remainingRunners: previewRemainingRunnersAsAdmin,
  markRemainingDidNotStart: markRemainingDidNotStartAsAdmin, courseDetails: saveCourseDetailsAsAdmin,
  // PLAN.md steg 27: ta bort och stryk, "Resultaten är klara" och export av hela tävlingen.
  removeEntry: removeEntryAsAdmin, removeClass: removeClassAsAdmin, removeCourse: removeCourseAsAdmin,
  resultsOfficial: setResultsOfficialAsAdmin, resultsOfficialState: readResultsOfficialAsAdmin, raceExport: exportRaceAsAdmin,
  // PLAN.md steg 29: löpardatabasen från Eventor.
  runnerDatabase: getRunnerDatabaseSettingsAsAdmin, runnerDatabaseRefresh: refreshRunnerDatabaseAsAdmin,
  runnerDatabaseDelete: deleteRunnerDatabaseAsAdmin, runnerSearch: searchRunnerDatabaseAsAdmin,
  // PLAN.md steg 31: rättningar för hela tävlingen.
  raceCorrections: listRaceCorrectionsAsAdmin, raceCorrectionPreview: previewRaceCorrectionAsAdmin,
  raceCorrectionApply: applyRaceCorrectionAsAdmin,
  // PLAN.md steg 36: läs om avläsningar från rådata.
  readoutRereadPreview: previewReadoutRereadAsAdmin, readoutReread: applyReadoutRereadAsAdmin,
  // Steg 45: avläsningar vars tider inte gick att tolka.
  uninterpretedReceive: receiveUninterpretedReadout, uninterpretedList: listUninterpretedReadoutsAsAdmin,
  uninterpretedReread: rereadUninterpretedReadoutAsAdmin,
  // PLAN.md steg 40: fest med bardisk.
  party: readPartyAsAdmin, partyChange: changePartyAsAdmin, partyGuest: setPartyGuestAsAdmin, partyDeskEvent: registerPartyDeskEventAsAdmin, partyLogo: savePartyLogoAsAdmin,
  // PLAN.md steg 46: stryk självregistrerade som inte läst ut.
  selfRegistrationCleanup: previewSelfRegistrationCleanupAsAdmin, strikeSelfRegistered: strikeSelfRegisteredAsAdmin };
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
  { kind: "map-bundles" } | { kind: "map-print" } | { kind: "map-reserve" } |
  { kind: "relay" } | { kind: "relay-class" } | { kind: "relay-team" } | { kind: "relay-leg-runner" } | { kind: "relay-start-times" } |
  { kind: "relay-class-edit" } | { kind: "relay-team-edit" } | { kind: "relay-team-removal" } | { kind: "relay-team-dns" } |
  { kind: "relay-leg-variant" } |
  { kind: "race-settings" } |
  { kind: "eventor" } | { kind: "eventor-test" } | { kind: "eventor-events" } | { kind: "eventor-event" } | { kind: "eventor-sync-preview" } |
  { kind: "course-file-preview" } | { kind: "source-sync-consequence" } | { kind: "source-sync" } |
  { kind: "entry-status"; entryId: string } |
  { kind: "unknown-readout-resolution" } |
  { kind: "card"; entryId: string } | { kind: "card-rental"; entryId: string } |
  { kind: "card-rental-return"; entryId: string } | { kind: "card-rental-reuse"; entryId: string } |
  { kind: "start-time"; entryId: string } |
  { kind: "recalculation-candidates" } | { kind: "recalculate"; entryId: string } |
  { kind: "class-result-recalculation"; classId: string } | { kind: "effective-result"; entryId: string } | { kind: "speaker-board" } |
  { kind: "identity-candidates" } | { kind: "identity"; entryId: string } | { kind: "registration" } | { kind: "registration-candidates" } |
  { kind: "changes"; entryId: string } |
  { kind: "race-map" } | { kind: "race-map-image" } | { kind: "race-map-georeference" } | { kind: "race-map-source" } | { kind: "participant-route" } |
  { kind: "route-choice" } | { kind: "route-choice-settings" } | { kind: "route-choice-published" } | { kind: "route-choice-calibration"; courseId: string } |
  { kind: "people" } | { kind: "race-publication" } | { kind: "course-secrecy" } | { kind: "control-map" } | { kind: "entry-control-map"; entryId: string } | { kind: "radio" } | { kind: "radio-fetch" } |
  { kind: "readout-registrations" } | { kind: "remaining-runners" } | { kind: "course-details"; courseId: string } |
  { kind: "entry-removal"; entryId: string } | { kind: "class-removal"; classId: string } | { kind: "course-removal"; courseId: string } |
  { kind: "results-official" } | { kind: "race-export" } | { kind: "runner-database" } | { kind: "runner-search" } |
  { kind: "race-corrections" } | { kind: "race-corrections-preview" } | { kind: "readout-reread" } | { kind: "readout-reread-preview" } |
  { kind: "uninterpreted-readouts" } | { kind: "uninterpreted-readouts-reread" } |
  { kind: "party" } | { kind: "party-guests" } | { kind: "party-desk-events" } | { kind: "party-logo" } | { kind: "self-registration-cleanup" };

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
