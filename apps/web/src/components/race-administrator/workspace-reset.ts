import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import type { WorkspaceState } from "./workspace-state";

/**
 * Låser arbetsytan när sessionen saknas eller går ut. Ett försök som redan har skickats behålls
 * (utom när det uttryckligen kastas) så att det kan skickas om efter ny inloggning.
 * Använder bara set-funktioner och refs, så den kan anropas från en stabil callback.
 */
export function resetWorkspaceOnLock(s: WorkspaceState, discard: boolean) {
  const { sent, pending, setAuthenticated, setExpiresAt, setData, setParticipantActionPending, setFinalizations,
    setFinalizationId, setForestData, setForestClass, setForestQuery, setForestStale, setForestAutoRefresh, setForestOpen,
    setForestSortByAge, setCourseName, setCourseClassName, setCourseControls, setCourseStartRule, setCourseClassReview,
    setCourseClassError, setManualClassName, setManualClassCourseVersionId, setManualClassStartRule, setManualClassReview,
    setManualClassError, setClassNameClassId, setClassNameCandidate, setClassNameInput, setClassNameReview, setClassNameError,
    setCourseRelinkClassId, setCourseRelinkPreview, setCourseRelinkControls, setCourseRelinkConfirmed, setCourseRelinkError,
    setCourseResultImpactClassId, setCourseResultImpact, setCourseResultImpactError, setCourseResultBearingClassId,
    setCourseResultBearingCandidate, setCourseResultBearingControls, setCourseResultBearingAcknowledged,
    setCourseResultBearingError, setShortenedCourseClassId, setShortenedCourseCandidate, setShortenedCourseName,
    setShortenedClassName, setShortenedControlCount, setShortenedEntryIds, setShortenedCourseError,
    setUnknownReadoutCandidate, setUnknownReadoutId, setUnknownReadoutTarget, setUnknownReadoutEntryId,
    setUnknownReadoutClassId, setUnknownReadoutGivenName, setUnknownReadoutFamilyName, setUnknownReadoutOrganisationName,
    setUnknownReadoutError, setCourseClassAttempt, setManualClassAttempt, setClassNameAttempt, setPrintTarget,
    setReviewCandidate, setReviewReason, setReviewConfirmed, setReviewAttempt, setCheckinHistory, setReturnAttempt,
    setStartCorrection, setPublicationPreview, setPublicationAttempt, setDrawClasses, setDrawClassId, setDrawFirst,
    setDrawInterval, setDrawAttempt, setFinalizationCandidates, setFinalizationScope, setFinalizationAttempt,
    setOocCandidates, setOocWithdrawals, setNtCandidates, setNtWithdrawals, setEntryId, setClassId, setQuery,
    setOlderResultsOnly, setRentalCardsOnly, setResultState, setPage, setBusy, setMessage, setStartDate, setStartClock,
    setStartOffset, setTransferStartSlots, setSelectedTransferStartSlot, setRegistrationStartSlots,
    setSelectedRegistrationStartSlot, setCapacityClassId, setCapacityInput, setNewCard, setRentalReuseSourceId,
    setPaymentStatus, setStartRuleClassId, setStartRulePreview, setStartRuleReason, setStartRuleConfirmed, setStartRuleOpen,
    setWorkflowMode, setRecalculationCandidates, setEffectiveResult, setEffectiveResultError, setIdentityCandidates,
    setGivenName, setFamilyName, setOrganisationName, setMobilePanel, setEntryChanges, setDnsCandidates, setDnsWithdrawals,
    setDnfCandidates, setDnfWithdrawals, setDnfAttempt, setDsqAttempt, setApprovalAttempt, setApprovalCandidates,
    setApprovalWithdrawals, setDsqCandidates, setDsqWithdrawals, setTransferAttempt, setCapacityAttempt, setStartRuleAttempt,
    setCardAttempt, setRentalAttempt, setRentalReturnAttempt, setRentalReuseAttempt, setPaymentStatusAttempt, setTimeAttempt,
    setRecalculationAttempt, setIdentityAttempt, setRegistrationAttempt, setDnsAttempt, setOocAttempt, setNtAttempt,
    setCourseRelinkAttempt, setCourseResultBearingAttempt, setShortenedCourseAttempt, setUnknownReadoutAttempt, setUnknown,
    setAction } = s;
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
  if (discard || !sent.current) { pending.current = undefined; sent.current = false; setTransferAttempt(undefined); setCapacityAttempt(undefined); setStartRuleAttempt(undefined); setCardAttempt(undefined); setRentalAttempt(undefined); setRentalReturnAttempt(undefined); setRentalReuseAttempt(undefined); setPaymentStatusAttempt(undefined); setTimeAttempt(undefined); setRecalculationAttempt(undefined); setIdentityAttempt(undefined); setRegistrationAttempt(undefined); setDnsAttempt(undefined); setOocAttempt(undefined); setNtAttempt(undefined); setCourseRelinkAttempt(undefined); setCourseResultBearingAttempt(undefined); setShortenedCourseAttempt(undefined); setUnknownReadoutAttempt(undefined); setUnknown(false); setAction("INFO"); }
  else setUnknown(true);
}

/** Underlag som alltid läses om när en ny åtgärd startar (begin). */
export function clearBeforeOperation(s: WorkspaceState) {
  const { setPublicationPreview, setDrawClasses, setFinalizationCandidates, setNtCandidates, setNtWithdrawals,
    setOocCandidates, setOocWithdrawals, setApprovalCandidates, setApprovalWithdrawals, setDsqCandidates, setDsqWithdrawals,
    setDnfCandidates, setDnfWithdrawals, setDnsCandidates, setDnsWithdrawals, setEntryChanges, setIdentityCandidates,
    setEffectiveResult, setEffectiveResultError, setRecalculationCandidates } = s;
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
}

/** Konfliktgranskning och incheckningsjournal stängs vid varje nytt anrop (beginRequest). */
export function clearBeforeRequest(s: WorkspaceState) {
  const { setReviewCandidate, setReviewReason, setReviewConfirmed, setCheckinHistory } = s;
  setReviewCandidate(undefined); setReviewReason(""); setReviewConfirmed(false);
  setCheckinHistory(undefined);
}
