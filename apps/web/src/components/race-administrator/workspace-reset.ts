import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import type { WorkspaceState } from "./workspace-state";

/**
 * Låser arbetsytan när sessionen saknas eller går ut. Ett försök som redan har skickats behålls
 * (utom när det uttryckligen kastas) så att det kan skickas om efter ny inloggning.
 * Använder bara set-funktioner och refs, så den kan anropas från en stabil callback.
 */
export function resetWorkspaceOnLock(s: WorkspaceState, discard: boolean) {
  const { sent, pending, setClassEditPreview, setClassEditError, setClassEditSaved, setStatusChoice, setStatusBlocked,
    setClassEditAttempt, setEditingClassId, setAuthenticated, setExpiresAt, setData, setParticipantActionPending, setFinalizations,
    setFinalizationId, setForestData, setForestClass, setForestQuery, setForestStale, setForestAutoRefresh, setForestOpen,
    setForestSortByAge, setCourseName, setCourseClassName, setCourseControls, setCourseStartRule,
    setCourseClassError, setManualClassName, setManualClassCourseVersionId, setManualClassStartRule,
    setManualClassError, setCourseList, setCourseListError, setEditingCourseId, setCourseEditControls, setCourseEditPreview, setCourseEditError,
    setCourseEditSaved, setShortenedCourseClassId, setShortenedCourseCandidate, setShortenedCourseName,
    setShortenedClassName, setShortenedControlCount, setShortenedEntryIds, setShortenedCourseError,
    setUnknownReadoutCandidate, setUnknownReadoutId, setUnknownReadoutTarget, setUnknownReadoutEntryId,
    setUnknownReadoutClassId, setUnknownReadoutGivenName, setUnknownReadoutFamilyName, setUnknownReadoutOrganisationName,
    setUnknownReadoutError, setCourseClassAttempt, setManualClassAttempt, setPrintTarget,
    setReviewCandidate, setReviewReason, setReviewConfirmed, setReviewAttempt, setCheckinHistory, setReturnAttempt,
    setStartCorrection, setPublicationPreview, setPublicationAttempt, setDrawSetup, setDrawPreview, setDrawError, setDrawSaved,
    setDrawAttempt, setFinalizationCandidates, setFinalizationScope, setFinalizationAttempt,
    setEntryId, setClassId, setQuery,
    setOlderResultsOnly, setRentalCardsOnly, setResultState, setPage, setBusy, setMessage, setStartClock,
    setCapacityClassId, setCapacityInput, setNewCard, setRentalReuseSourceId,
    setPaymentStatus, setEffectiveResult, setEffectiveResultError, setIdentityCandidates,
    setGivenName, setFamilyName, setOrganisationName, setMobilePanel, setEntryChanges, setDnfAttempt, setDsqAttempt, setApprovalAttempt, setTransferAttempt, setCapacityAttempt, setCardAttempt, setRentalAttempt, setRentalReturnAttempt, setRentalReuseAttempt, setPaymentStatusAttempt, setTimeAttempt,
    setRecalculationAttempt, setIdentityAttempt, setRegistrationAttempt, setDnsAttempt, setOocAttempt, setNtAttempt,
    setCourseEditAttempt, setShortenedCourseAttempt, setUnknownReadoutAttempt, setUnknown,
    setAction, setEntryVariantPreview, setEntryVariantAttempt, setDistributionAttempt, setEditingVariantCode,
    setRelay, setRelayError, setRelayMessage, setSelectedTeamId, setRunnerChange } = s;
  setEntryVariantPreview(undefined); setEntryVariantAttempt(undefined); setDistributionAttempt(undefined);
  setRelay(undefined); setRelayError(""); setRelayMessage(""); setSelectedTeamId(""); setRunnerChange(undefined);
  if (discard || !sent.current) setEditingVariantCode("");
  setAuthenticated(false); setExpiresAt(undefined); setData(undefined);
  setParticipantActionPending(false);
  setFinalizations(undefined); setFinalizationId("");
  setForestData(undefined); setForestClass(""); setForestQuery(""); setForestStale(true);
  setForestAutoRefresh(false); setForestOpen(false);
  setForestSortByAge(false);
  setCourseName(""); setCourseClassName(""); setCourseControls(""); setCourseStartRule("PUNCH"); setCourseClassError("");
  setManualClassName(""); setManualClassCourseVersionId(""); setManualClassStartRule("PUNCH"); setManualClassError("");
  setCourseList(undefined); setCourseListError(""); setCourseEditPreview(undefined); setCourseEditError(""); setCourseEditSaved("");
  if (discard || !sent.current) { setEditingCourseId(""); setCourseEditControls(""); }
  setShortenedCourseClassId(""); setShortenedCourseCandidate(undefined); setShortenedCourseName(""); setShortenedClassName(""); setShortenedControlCount("1"); setShortenedEntryIds([]); setShortenedCourseError("");
  setUnknownReadoutCandidate(undefined); setUnknownReadoutId(""); setUnknownReadoutTarget("EXISTING_ENTRY"); setUnknownReadoutEntryId(""); setUnknownReadoutClassId(""); setUnknownReadoutGivenName(""); setUnknownReadoutFamilyName(""); setUnknownReadoutOrganisationName(""); setUnknownReadoutError("");
  if (discard || !sent.current) setCourseClassAttempt(undefined);
  if (discard || !sent.current) setManualClassAttempt(undefined);
  setClassEditPreview(undefined); setClassEditError(""); setClassEditSaved(""); setStatusChoice(""); setStatusBlocked("");
  if (discard || !sent.current) { setClassEditAttempt(undefined); setEditingClassId(""); }
  setPrintTarget(undefined);
  setReviewCandidate(undefined); setReviewReason(""); setReviewConfirmed(false);
  if (discard || !sent.current) setReviewAttempt(undefined);
  setCheckinHistory(undefined);
  if (discard || !sent.current) setReturnAttempt(undefined);
  if (discard || !sent.current) setStartCorrection(undefined);
  setPublicationPreview(undefined);
  if (discard || !sent.current) setPublicationAttempt(undefined);
  setDrawSetup(undefined); setDrawError(""); setDrawSaved("");
  if (discard || !sent.current) { setDrawAttempt(undefined); setDrawPreview(undefined); }
  setFinalizationCandidates(undefined); setFinalizationScope("RACE");
  if (discard || !sent.current) setFinalizationAttempt(undefined);
  setEntryId(""); setClassId(""); setQuery(""); setOlderResultsOnly(false); setRentalCardsOnly(false);
  setResultState("ALL"); setPage(0); setBusy(false); setMessage(text.denied);
  setStartClock("");
  setCapacityClassId(""); setCapacityInput(""); setNewCard(""); setRentalReuseSourceId(""); setPaymentStatus("PAID");
  setEffectiveResult(undefined); setEffectiveResultError(false);
  setIdentityCandidates(undefined); setGivenName(""); setFamilyName(""); setOrganisationName("");
  setMobilePanel(discard || !sent.current ? "LIST" : "WORK");
  setEntryChanges(undefined);
  if (discard || !sent.current) { setDnfAttempt(undefined); setDsqAttempt(undefined); setApprovalAttempt(undefined); }
  if (discard || !sent.current) { pending.current = undefined; sent.current = false; setTransferAttempt(undefined); setCapacityAttempt(undefined); setCardAttempt(undefined); setRentalAttempt(undefined); setRentalReturnAttempt(undefined); setRentalReuseAttempt(undefined); setPaymentStatusAttempt(undefined); setTimeAttempt(undefined); setRecalculationAttempt(undefined); setIdentityAttempt(undefined); setRegistrationAttempt(undefined); setDnsAttempt(undefined); setOocAttempt(undefined); setNtAttempt(undefined); setCourseEditAttempt(undefined); setShortenedCourseAttempt(undefined); setUnknownReadoutAttempt(undefined); setUnknown(false); setAction("INFO"); }
  else setUnknown(true);
}

/** Underlag som alltid läses om när en ny åtgärd startar (begin). */
export function clearBeforeOperation(s: WorkspaceState) {
  const { setPublicationPreview, setDrawSetup, setDrawPreview, drawAttempt, setFinalizationCandidates, setEntryChanges,
    setIdentityCandidates, setEffectiveResult, setEffectiveResultError, setEntryVariantMessage, setEntryVariantError,
    setDistributionMessage } = s;
  setPublicationPreview(undefined);
  setEntryVariantMessage(""); setEntryVariantError(""); setDistributionMessage("");
  // Andra ändringar gör lottningens underlag inaktuellt; klasserna läses om när Start visas.
  setDrawSetup(undefined);
  if (!drawAttempt) setDrawPreview(undefined);
  setFinalizationCandidates(undefined);
  setEntryChanges(undefined);
  setIdentityCandidates(undefined);
  setEffectiveResult(undefined); setEffectiveResultError(false);
}

/** Konfliktgranskning och incheckningsjournal stängs vid varje nytt anrop (beginRequest). */
export function clearBeforeRequest(s: WorkspaceState) {
  const { setReviewCandidate, setReviewReason, setReviewConfirmed, setCheckinHistory } = s;
  setReviewCandidate(undefined); setReviewReason(""); setReviewConfirmed(false);
  setCheckinHistory(undefined);
}
