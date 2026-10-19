import { useState } from "react";
import type { RaceResultFinalizationMetadata } from "@o-tid/contracts";
import { iofResultListExportFilename, parseFrozenRaceFinalizations, parseIofResultListExportMetadata,
  validateFrozenIofResultListResponse } from "../../lib/iof-result-list-export-admin-client";
import { createClassFinalizationAttempt, isDefinitiveResultFinalizationRejection,
  parseResultFinalizationCandidates, parseResultFinalizationResponse,
  type ResultFinalizationCandidates } from "../../lib/result-finalization-admin-client";
import { classResultRecalculationBody, createClassResultRecalculationAttempt, parseClassResultRecalculationCandidates,
  parseClassResultRecalculationResponse, type ClassResultRecalculationAttempt,
  type ClassResultRecalculationCandidates } from "../../lib/class-result-recalculation-admin-client";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import type { FinalizationAttempt, Operation } from "./types";
import type { Base, WorkspaceState } from "./workspace-state";
import type { RaceDataActions } from "./race-data";
import { saveVerifiedDownload } from "../../lib/verified-download";

/** Resultat: omräkning per klass, fastställande och export. */
export function useAfterRaceState() {
  const [classRecalculationCandidates, setClassRecalculationCandidates] = useState<ClassResultRecalculationCandidates>();
  const [classRecalculationAttempt, setClassRecalculationAttempt] = useState<ClassResultRecalculationAttempt>();
  const [classRecalculationUnknown, setClassRecalculationUnknown] = useState(false);
  const [classRecalculationError, setClassRecalculationError] = useState("");
  const [classRecalculationSaved, setClassRecalculationSaved] = useState("");
  const [finalizationCandidates, setFinalizationCandidates] = useState<ResultFinalizationCandidates>();
  /** Klassen som fastställs under Avancerat (PLAN.md steg 27); hela loppet görs med "Resultaten är klara". */
  const [finalizationScope, setFinalizationScope] = useState("");
  const [finalizationAttempt, setFinalizationAttempt] = useState<FinalizationAttempt>();
  const [finalizations, setFinalizations] = useState<RaceResultFinalizationMetadata[]>();
  const [finalizationId, setFinalizationId] = useState("");
  return { classRecalculationCandidates, setClassRecalculationCandidates, classRecalculationAttempt, setClassRecalculationAttempt,
    classRecalculationUnknown, setClassRecalculationUnknown, classRecalculationError, setClassRecalculationError,
    classRecalculationSaved, setClassRecalculationSaved, finalizationCandidates, setFinalizationCandidates, finalizationScope,
    setFinalizationScope, finalizationAttempt, setFinalizationAttempt, finalizations, setFinalizations, finalizationId,
    setFinalizationId };
}

export function deriveAfterRace(s: WorkspaceState) {
  const { finalizationScope, finalizationCandidates } = s;
  const finalizationCandidate = finalizationCandidates?.classes.find(row => row.classId === finalizationScope);
  return { finalizationCandidate };
}

export function createAfterRaceActions(ws: Base & RaceDataActions) {
  const { raceId, classRecalculationCandidates, finalizationCandidates, finalizationScope, finalizations, finalizationId,
    writingRef, pending, sent, requireSession, beginRequest, finish, current, assertCurrent, request,
    json, csrf, load, setMessage, setUnknown, setClassRecalculationCandidates, setClassRecalculationAttempt,
    setClassRecalculationError, setClassRecalculationSaved, setClassRecalculationUnknown, setFinalizationCandidates,
    setFinalizationAttempt, setFinalizations, setFinalizationId } = ws;
  async function loadClassRecalculation(classId: string) {
    if (writingRef.current || pending.current || !requireSession() || !classId) return;
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
    if (writingRef.current || pending.current || !requireSession() || !classRecalculationCandidates) return;
    try {
      const value = createClassResultRecalculationAttempt(classRecalculationCandidates, entryIds);
      pending.current = value; sent.current = false; setClassRecalculationAttempt(value);
      setClassRecalculationUnknown(false); setClassRecalculationError("");
    } catch { setClassRecalculationError(text.recalculationLoadError); }
  }
  async function submitClassRecalculation(value: ClassResultRecalculationAttempt) {
    if (writingRef.current || pending.current !== value || !requireSession()) return;
    const op = beginRequest(); const wasUnknown = sent.current; let committed = false;
    try {
      sent.current = true;
      const response = await request(`/classes/${value.classId}/result-recalculation`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf(), "idempotency-key": `class-result-recalculation:${value.requestId}` },
        body: JSON.stringify(classResultRecalculationBody(value)) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setClassRecalculationUnknown(true); setClassRecalculationError(text.unreachable); return; }
        pending.current = undefined; sent.current = false; setClassRecalculationAttempt(undefined); setClassRecalculationError(text.classRecalculationConflict); return;
      }
      if (!response.ok) throw new Error("Unknown class recalculation outcome");
      const receipt = parseClassResultRecalculationResponse(await json(response, op), value, raceId);
      committed = true; pending.current = undefined; sent.current = false; setClassRecalculationAttempt(undefined); setClassRecalculationUnknown(false);
      setClassRecalculationSaved(text.classRecalculationSaved(receipt.items.length));
      await load(op);
    } catch { if (current(op)) setClassRecalculationError(committed ? text.recalculationSavedLoadError : text.unreachable); }
    finally { finish(op); }
  }
  async function readFinalizationBasis(op: Operation) {
    const response = await request("/finalization-candidates", op);
    if (!response.ok) throw new Error("Finalization basis unavailable");
    const value = parseResultFinalizationCandidates(await json(response, op), raceId);
    setFinalizationCandidates(value);
  }
  async function loadFinalizationBasis() {
    if (writingRef.current || pending.current || !requireSession()) return;
    const op = beginRequest(); setFinalizationCandidates(undefined); setMessage("");
    try { await readFinalizationBasis(op); }
    catch { if (current(op)) setMessage(text.error); } finally { finish(op); }
  }
  function prepareFinalization() {
    if (writingRef.current || pending.current || !requireSession() || !finalizationCandidates || !finalizationScope) return;
    try {
      const value = createClassFinalizationAttempt(finalizationCandidates, finalizationScope);
      const attempt = { kind: "FINALIZATION" as const, value };
      pending.current = attempt; sent.current = false; setUnknown(false); setFinalizationAttempt(attempt); setMessage("");
    } catch { setMessage(text.error); }
  }
  async function submitFinalization(value: FinalizationAttempt) {
    if (writingRef.current || pending.current !== value || !requireSession()) return;
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
    } catch { if (current(op)) { setUnknown(!committed); setMessage(committed ? text.finalizationSavedLoadError : text.unreachable); } }
    finally { finish(op); }
  }
  const saveExport = (response: Response, filename: string, expectedHash: string, op: Operation) =>
    saveVerifiedDownload(response, filename, expectedHash, () => assertCurrent(op));
  async function loadFinalizations() {
    if (writingRef.current || pending.current || !requireSession()) return;
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
    if (writingRef.current || pending.current || !requireSession()) return;
    const selected = finalizations?.find(row => row.id === finalizationId);
    if (!selected) return;
    const op = beginRequest(); setMessage(text.exportDownloading);
    try {
      const response = await request(`/result-finalizations/${selected.id}`, op);
      if (!response.ok) throw new Error("Frozen export unavailable");
      const filename = validateFrozenIofResultListResponse(response, selected);
      await saveExport(response, filename, selected.completeXmlSha256, op);
      assertCurrent(op); setMessage(text.exportCompleteDownloaded);
    } catch { if (current(op)) setMessage(text.exportError); }
    finally { finish(op); }
  }
  async function downloadResults() {
    if (writingRef.current || pending.current || !requireSession()) return;
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
  return { loadClassRecalculation, prepareClassRecalculation, submitClassRecalculation, loadFinalizationBasis, prepareFinalization,
    submitFinalization, loadFinalizations, downloadFinalization, downloadResults };
}
export type AfterRaceActions = ReturnType<typeof createAfterRaceActions>;
