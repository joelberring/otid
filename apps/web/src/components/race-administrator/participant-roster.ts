import { useState } from "react";
import { flushSync } from "react-dom";
import { filterAdministratorRoster, missingFixedStartTime, needsPaymentAttention, orderAdministratorRoster,
  type AdministratorRosterOrder, type AdministratorRosterResultFilter } from "../../lib/administrator-roster-filter";
import type { Action } from "./types";
import type { Base, WorkspaceState } from "./workspace-state";
import type { MobileNavigation } from "./navigation";
import type { RaceDataActions } from "./race-data";
import type { DuringRaceActions } from "./during-race";
import type { ResultDecisionActions } from "./result-decisions";
import type { EntryActions } from "./entry-actions";

/** Deltagarlistans filter, sidindelning och vald deltagare. */
export function useRosterState() {
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
  const [action, setAction] = useState<Action>("INFO");
  const [participantActionPending, setParticipantActionPending] = useState(false);
  return { query, setQuery, olderResultsOnly, setOlderResultsOnly, rentalCardsOnly, setRentalCardsOnly, paymentAttentionOnly,
    setPaymentAttentionOnly, resultState, setResultState, missingFixedStartOnly, setMissingFixedStartOnly, rosterOrder,
    setRosterOrder, page, setPage, pageSize, setPageSize, rosterClassId, setRosterClassId, wideTable, setWideTable,
    entryId, setEntryId, action, setAction, participantActionPending, setParticipantActionPending };
}

export function deriveRoster(s: WorkspaceState) {
  const { data, entryId, workflowMode, preparationArea, duringArea, query, olderResultsOnly, rentalCardsOnly,
    paymentAttentionOnly, resultState, rosterClassId, missingFixedStartOnly, rosterOrder, page, pageSize } = s;
  const participantsVisible = workflowMode === "PARTICIPANTS" ||
    (workflowMode === "BEFORE" && preparationArea === "PARTICIPANTS") ||
    (workflowMode === "DURING" && duringArea === "PARTICIPANTS");
  const selected = data?.entries.find((entry) => entry.id === entryId);
  const returnedRentalSources = data?.entries.filter((entry) => entry.id !== selected?.id &&
    !entry.multipleActiveAssignments && entry.activeAssignment?.isRental && entry.activeAssignment.rentalReturned) ?? [];
  const selectedClass = data?.classes.find((row) => row.id === selected?.classId);
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
  return { participantsVisible, selected, returnedRentalSources, selectedClass, classesById, classNames, olderResultCount,
    rentalEntries, rentalCardCount, paymentAttentionCount, freeStartClassCount, fixedStartClassCount, filtered, lastPage,
    currentPage, visible, selectedIndex, selectedPage };
}

export type Roster = ReturnType<typeof deriveRoster>;

/** Val av deltagare och åtgärd. Laddar det underlag som vald åtgärd behöver. */
export function createParticipantActions(ws: Base & MobileNavigation & RaceDataActions & DuringRaceActions &
  ResultDecisionActions & EntryActions) {
  const { data, entryId, action, workflowMode, participantsVisible, workflowLocked, selected, selectedIndex, filtered,
    classesById, rosterOrder, pageSize, registrationAttempt, unknown, busyRef, pending, sent, checkinHistoryPanel,
    workPanel, listPanel, requireSession, begin, finish, showMobilePanel, loadEffectiveResult, loadConflictReview,
    loadCheckinHistory, loadIdentity, loadHistory, setAction, setStatusChoice, setStatusBlocked, setPreparationArea, setDuringArea, setWorkflowMode, setWideTable,
    setReviewCandidate, setReviewReason, setReviewConfirmed, setEntryId, setClassId, setMessage, setNewCard,
    setRentalReuseSourceId, setPaymentStatus, setCheckinHistory, setGivenName, setFamilyName, setOrganisationName,
    setStartDate, setStartClock, setStartOffset, setIdentityCandidates, setEntryChanges, setEffectiveResult, setEffectiveResultError, setRegistrationAttempt, setConfirmDistinctPerson,
    setQuery, setRosterClassId, setOlderResultsOnly, setRentalCardsOnly, setPaymentAttentionOnly,
    setMissingFixedStartOnly, setResultState, setPage } = ws;
  function select(id: string, openJournal = false, reviewConflict = false, requestedAction?: Action) {
    if (busyRef.current || pending.current || !requireSession()) return;
    const nextAction = requestedAction ?? "INFO";
    setAction(nextAction);
    if (!openJournal) {
      if (!participantsVisible) {
        // Follow-up actions inside preparation must reveal their participant target before focusing it.
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
    setStatusChoice(""); setStatusBlocked("");
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
    if (nextAction === "IDENTITY") void loadIdentity(id);
    else if (nextAction === "HISTORY") void loadHistory(id);
    else if (data) {
      const op = begin(); void loadEffectiveResult(id, data, op).finally(() => finish(op));
    }
  }
  function openMissingStartTime(id: string) {
    if (busyRef.current || pending.current || !requireSession()) return;
    select(id, false, false, "TIME");
    window.requestAnimationFrame(() => workPanel.current?.focus());
  }
  function chooseAction(value: Action) {
    if (busyRef.current || pending.current || !requireSession()) return;
    setAction(value); setClassId(""); setNewCard(""); setStartDate(""); setStartClock(""); setStartOffset(""); setMessage("");
    if (value === "PAYMENT") setPaymentStatus(data?.entries.find((entry) => entry.id === entryId)?.paymentStatus ?? "PAID");
    setIdentityCandidates(undefined); setGivenName(""); setFamilyName(""); setOrganisationName("");
    setEntryChanges(undefined); setStatusChoice(""); setStatusBlocked("");
    if (value === "IDENTITY") void loadIdentity();
    if (value === "HISTORY") void loadHistory();
  }
  function newParticipant() {
    if (busyRef.current || pending.current || !requireSession()) return;
    setWideTable(false);
    chooseAction("REGISTRATION"); setEntryId(""); setEffectiveResult(undefined); setEffectiveResultError(false);
    showMobilePanel("WORK");
  }
  function selectRegistrationCandidate(id: string) {
    if (busyRef.current || sent.current || unknown || !registrationAttempt || pending.current !== registrationAttempt || !requireSession()) return;
    const candidate = registrationAttempt.candidates.candidates.find((row) => row.entryId === id);
    if (!candidate || !data?.entries.some((row) => row.id === id && row.classId === candidate.classId)) return;
    pending.current = undefined; setRegistrationAttempt(undefined); setConfirmDistinctPerson(false);
    select(id);
  }
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
  return { select, openMissingStartTime, chooseAction, newParticipant, selectRegistrationCandidate,
    revealSelected, navigateParticipantSequence };
}
export type ParticipantActions = ReturnType<typeof createParticipantActions>;
