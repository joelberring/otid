import { useEffect, useRef, useState } from "react";
import { administratorForestWatchResponseSchema, administratorReturnRequestSchema, administratorReturnResponseSchema,
  administratorStartCorrectionRequestSchema, administratorStartCorrectionResponseSchema, canonicalAdministratorReturnRequest,
  canonicalAdministratorStartCorrectionRequest, checkinHistoryResponseSchema, StartCheckinConflictReviewCandidateSchema,
  StartCheckinConflictReviewRequestSchema, StartCheckinConflictReviewResponseSchema, speakerBoardResponseSchema,
  unknownReadoutResolutionCandidateResponseSchema,
  unknownReadoutResolutionRequestSchema, unknownReadoutResolutionResponseSchema, type AdministratorForestWatchResponse,
  type AdministratorStartCorrectionRequest, type CheckinHistoryResponse, type SpeakerBoardResponse, type StartCheckinConflictReviewCandidate,
  type UnknownReadoutResolutionCandidateResponse, type UnknownReadoutResolutionRequest } from "@o-tid/contracts";
import { canRefreshForest } from "../../lib/forest-auto-refresh";
import { inForest } from "../../lib/section-status";
import { checkinHistorySv } from "../../i18n/checkin-history-sv";
import { checkinConflictReviewSv as reviewText } from "../../i18n/checkin-conflict-review-sv";
import { forestWatchSv as forestText } from "../../i18n/forest-watch-sv";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { relaySv as relayText } from "../../i18n/relay-sv";
import type { ConflictReviewAttempt, Operation, ReturnAttempt, StartCorrectionAttempt, UnknownReadoutResolutionAttempt } from "./types";
import type { Base, WorkspaceState } from "./workspace-state";
import type { RelayActions } from "./relay-actions";
import type { RaceDataActions } from "./race-data";

/** Tävlingsdagen: kvar i skogen, okända avläsningar, incheckningsjournal, konfliktgranskning och manuella rättningar. */
export function useDuringRaceState() {
  const [checkinHistory, setCheckinHistory] = useState<CheckinHistoryResponse>();
  const [reviewCandidate, setReviewCandidate] = useState<StartCheckinConflictReviewCandidate>();
  const [reviewAttempt, setReviewAttempt] = useState<ConflictReviewAttempt>();
  const [reviewReason, setReviewReason] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const checkinHistoryPanel = useRef<HTMLDetailsElement>(null);
  const [returnAttempt, setReturnAttempt] = useState<ReturnAttempt>();
  const [startCorrection, setStartCorrection] = useState<StartCorrectionAttempt>();
  const [targetStartState, setTargetStartState] = useState<AdministratorStartCorrectionRequest["targetStartState"]>("UNMARKED");
  const [forestData, setForestData] = useState<AdministratorForestWatchResponse>();
  const [forestClass, setForestClass] = useState("");
  const [forestQuery, setForestQuery] = useState("");
  const [forestSortByAge, setForestSortByAge] = useState(false);
  const [forestStale, setForestStale] = useState(true);
  const [forestAutoRefresh, setForestAutoRefresh] = useState(false);
  const [forestOpen, setForestOpen] = useState(false);
  const [latestReadouts, setLatestReadouts] = useState<SpeakerBoardResponse>();
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
  const [finishCorrectionPending, setFinishCorrectionPending] = useState(false);
  const [startCorrectionPending, setStartCorrectionPending] = useState(false);
  const [startWithdrawalPending, setStartWithdrawalPending] = useState(false);
  const [finishWithdrawalPending, setFinishWithdrawalPending] = useState(false);
  return { checkinHistory, setCheckinHistory, reviewCandidate, setReviewCandidate, reviewAttempt, setReviewAttempt, reviewReason,
    setReviewReason, reviewConfirmed, setReviewConfirmed, checkinHistoryPanel, returnAttempt, setReturnAttempt, startCorrection,
    setStartCorrection, targetStartState, setTargetStartState, forestData, setForestData, forestClass, setForestClass, forestQuery,
    setForestQuery, forestSortByAge, setForestSortByAge, forestStale, setForestStale, forestAutoRefresh, setForestAutoRefresh,
    forestOpen, setForestOpen, latestReadouts, setLatestReadouts, unknownReadoutCandidate, setUnknownReadoutCandidate, unknownReadoutFetchedAt,
    setUnknownReadoutFetchedAt, unknownReadoutAttentionStale, setUnknownReadoutAttentionStale, unknownReadoutId,
    setUnknownReadoutId, unknownReadoutTarget, setUnknownReadoutTarget, unknownReadoutEntryId, setUnknownReadoutEntryId,
    unknownReadoutClassId, setUnknownReadoutClassId, unknownReadoutGivenName, setUnknownReadoutGivenName,
    unknownReadoutFamilyName, setUnknownReadoutFamilyName, unknownReadoutOrganisationName, setUnknownReadoutOrganisationName,
    unknownReadoutAttempt, setUnknownReadoutAttempt, unknownReadoutError, setUnknownReadoutError,
    finishCorrectionPending, setFinishCorrectionPending,
    startCorrectionPending, setStartCorrectionPending, startWithdrawalPending, setStartWithdrawalPending,
    finishWithdrawalPending, setFinishWithdrawalPending };
}

export function deriveDuringRace(s: WorkspaceState) {
  const { forestData, forestStale, unknownReadoutCandidate, unknownReadoutFetchedAt, unknownReadoutAttentionStale } = s;
  const correctionPending = s.finishCorrectionPending || s.startCorrectionPending ||
    s.startWithdrawalPending || s.finishWithdrawalPending;
  const forestAttentionFresh = !!forestData && !forestStale;
  const unknownReadoutAttentionFresh = !!unknownReadoutCandidate && !!unknownReadoutFetchedAt && !unknownReadoutAttentionStale;
  const forestAttentionCounts = forestAttentionFresh ? {
    conflict: forestData.entries.filter(row => row.forestState === "CONFLICT").length,
    startedNoReturn: forestData.entries.filter(row => row.forestState === "STARTED_NO_RETURN").length,
    unconfirmed: forestData.entries.filter(row => row.forestState === "UNCONFIRMED").length,
    inForest: inForest(forestData.entries).length
  } : undefined;
  return { correctionPending, forestAttentionFresh, unknownReadoutAttentionFresh, forestAttentionCounts };
}

export function createDuringRaceActions(ws: Base & RaceDataActions & Pick<RelayActions, "readRelay">) {
  const { raceId, entryId, functionary, reviewAttempt, reviewCandidate, reviewConfirmed, reviewReason, forestData, forestStale,
    targetStartState, unknownReadoutCandidate, unknownReadoutId, unknownReadoutTarget, unknownReadoutEntryId,
    unknownReadoutClassId, unknownReadoutGivenName, unknownReadoutFamilyName, unknownReadoutOrganisationName, busyRef, pending,
    sent, requireSession, begin, beginRequest, finish, current, request, json, csrf, load, setMessage, setUnknown, setData,
    setCheckinHistory, setReviewCandidate, setReviewAttempt, setForestStale, setForestData, setStartCorrection,
    setReturnAttempt, setUnknownReadoutCandidate, setUnknownReadoutId, setUnknownReadoutEntryId, setUnknownReadoutClassId,
    setUnknownReadoutFetchedAt, setUnknownReadoutAttentionStale, setUnknownReadoutError, setUnknownReadoutAttempt,
    setLatestReadouts, readRelay } = ws;
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
    } catch { if (current(op)) { setUnknown(!committed); setForestStale(true); setMessage(committed ? text.returnStoredLoadError : text.unreachable); } }
    finally { finish(op); }
  }
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
  async function submitStartCorrection(value: StartCorrectionAttempt) {
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
    } catch { if (current(op)) { setUnknown(!committed); setForestStale(true); setMessage(committed ? text.returnStoredLoadError : text.unreachable); } }
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
  async function submitReturn(value: ReturnAttempt) {
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
    } catch { if (current(op)) { setUnknown(!committed); setForestStale(true); setMessage(committed ? text.returnStoredLoadError : text.unreachable); } }
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
  async function readUnknownReadoutCandidates(op: Operation) {
    const response = await request("/unknown-readout-resolution", op);
    if (!response.ok) throw new Error("Unknown readout candidates unavailable");
    const value = unknownReadoutResolutionCandidateResponseSchema.parse(await json(response, op));
    if (value.raceId !== raceId) throw new Error("Unknown readout candidate scope mismatch");
    setUnknownReadoutCandidate(value); setUnknownReadoutId(value.readouts[0]?.id ?? "");
    setUnknownReadoutEntryId(value.entries[0]?.id ?? ""); setUnknownReadoutClassId(value.classes[0]?.id ?? "");
    setUnknownReadoutFetchedAt(new Date().toISOString()); setUnknownReadoutAttentionStale(false);
  }
  /** Senaste resultaten (de 25 senast registrerade resultatuppdateringarna) till kontrollvyn. */
  async function readLatestReadouts(op: Operation) {
    const response = await request("/speaker-board", op);
    if (!response.ok) throw new Error("Latest readouts unavailable");
    const value = speakerBoardResponseSchema.parse(await json(response, op));
    if (value.raceId !== raceId) throw new Error("Latest readouts scope mismatch");
    setLatestReadouts(value);
  }
  /** Tävlingsdagens kontrollvy: kvar i skogen, okända brickor och senaste avläsningar. Varje del läses för sig. */
  async function loadRaceDayAttention() {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = beginRequest();
    setForestStale(true); setUnknownReadoutCandidate(undefined); setUnknownReadoutFetchedAt(undefined);
    setUnknownReadoutAttentionStale(true); setUnknownReadoutError(""); setMessage("");
    const failed: string[] = [];
    try {
      for (const [read, label] of [[readForest, text.controlForest], [readUnknownReadoutCandidates, text.controlUnknown],
        [readLatestReadouts, text.controlLatest], [readRelay, relayText.controlTeams]] as const) {
        try { await read(op); }
        catch { if (!current(op)) return; failed.push(label); }
      }
      if (failed.length) setMessage(text.controlPartialError(failed));
    } finally { finish(op); }
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
    // Funktionären direktanmäler bara (ADR-0172 beslut 3); kopplingen till en befintlig deltagare är administratörens.
    const parsed = unknownReadoutTarget === "EXISTING_ENTRY" && !functionary ? (() => {
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
        if (wasUnknown) { setUnknown(true); setUnknownReadoutError(text.unreachable); return; }
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
      // Nästa okända bricka visas direkt utan ett extra klick.
      try { await readUnknownReadoutCandidates(op); }
      catch { if (current(op)) setUnknownReadoutError(text.unknownReadoutLoadError); }
    } catch { if (current(op)) setUnknownReadoutError(committed ? text.unknownReadoutSavedLoadError : text.unreachable); }
    finally { finish(op); }
  }
  return { loadCheckinHistory, loadConflictReview, submitConflictReview, prepareStartCorrection, submitStartCorrection,
    prepareReturn, submitReturn, loadForest, loadRaceDayAttention, loadUnknownReadoutCandidates, inspectUnknownReadoutResolution,
    submitUnknownReadoutResolution };
}
export type DuringRaceActions = ReturnType<typeof createDuringRaceActions>;

/** Markerar underlag som inaktuella efter 30 s och uppdaterar kvar-i-skogen automatiskt när det är påslaget. */
export function useDuringRaceEffects(ws: Base & DuringRaceActions) {
  const { forestData, unknownReadoutFetchedAt, forestAutoRefresh, authenticated, step, forestOpen,
    reviewCandidate, busyRef, pending, checkinHistoryPanel, setForestStale, setUnknownReadoutAttentionStale, loadForest } = ws;
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
  // Restart the idle interval after each render so the callback uses current UI/session state.
  useEffect(() => {
    if (!forestAutoRefresh || !authenticated || step !== "READOUT" || !forestOpen || reviewCandidate) return;
    const timer = setInterval(() => {
      const editing = document.activeElement?.matches("input:not([type='checkbox']):not([type='button']):not([type='submit']), textarea, select, [contenteditable='true']") ?? false;
      if (canRefreshForest({ enabled: forestAutoRefresh, authenticated, reportOpen: forestOpen,
        visible: document.visibilityState === "visible", busy: busyRef.current, pending: !!pending.current,
        journalOpen: checkinHistoryPanel.current?.open ?? false, editing })) void loadForest();
    }, 15_000);
    return () => clearInterval(timer);
  });
}
