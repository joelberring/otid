import { useState, type FormEvent } from "react";
import { shortenedCourseClassTransferCandidateSchema,
  shortenedCourseClassTransferReceiptSchema, shortenedCourseClassTransferRequestSchema, type RaceResultFinalizationMetadata,
  type ShortenedCourseClassTransferCandidate } from "@o-tid/contracts";
import { iofResultListExportFilename, parseFrozenRaceFinalizations, parseIofResultListExportMetadata,
  validateFrozenIofResultListResponse } from "../../lib/iof-result-list-export-admin-client";
import { createClassFinalizationAttempt, createRaceFinalizationAttempt, isDefinitiveResultFinalizationRejection,
  parseResultFinalizationCandidates, parseResultFinalizationResponse,
  type ResultFinalizationCandidates } from "../../lib/result-finalization-admin-client";
import { classResultRecalculationBody, createClassResultRecalculationAttempt, parseClassResultRecalculationCandidates,
  parseClassResultRecalculationResponse, type ClassResultRecalculationAttempt,
  type ClassResultRecalculationCandidates } from "../../lib/class-result-recalculation-admin-client";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { type FinalizationAttempt, type Operation, type ShortenedCourseClassTransferAttempt } from "./types";
import type { Base, WorkspaceState } from "./workspace-state";
import type { RaceDataActions } from "./race-data";

/** Resultat: omräkning per klass, fastställande, export och flytt till kortare bana. */
export function useAfterRaceState() {
  const [classRecalculationCandidates, setClassRecalculationCandidates] = useState<ClassResultRecalculationCandidates>();
  const [classRecalculationAttempt, setClassRecalculationAttempt] = useState<ClassResultRecalculationAttempt>();
  const [classRecalculationUnknown, setClassRecalculationUnknown] = useState(false);
  const [classRecalculationError, setClassRecalculationError] = useState("");
  const [classRecalculationSaved, setClassRecalculationSaved] = useState("");
  const [finalizationCandidates, setFinalizationCandidates] = useState<ResultFinalizationCandidates>();
  const [finalizationScope, setFinalizationScope] = useState("RACE");
  const [finalizationAttempt, setFinalizationAttempt] = useState<FinalizationAttempt>();
  const [finalizations, setFinalizations] = useState<RaceResultFinalizationMetadata[]>();
  const [finalizationId, setFinalizationId] = useState("");
  const [shortenedCourseClassId, setShortenedCourseClassId] = useState("");
  const [shortenedCourseCandidate, setShortenedCourseCandidate] = useState<ShortenedCourseClassTransferCandidate>();
  const [shortenedCourseName, setShortenedCourseName] = useState("");
  const [shortenedClassName, setShortenedClassName] = useState("");
  const [shortenedControlCount, setShortenedControlCount] = useState("1");
  const [shortenedEntryIds, setShortenedEntryIds] = useState<string[]>([]);
  const [shortenedCourseAttempt, setShortenedCourseAttempt] = useState<ShortenedCourseClassTransferAttempt>();
  const [shortenedCourseError, setShortenedCourseError] = useState("");
  return { classRecalculationCandidates, setClassRecalculationCandidates, classRecalculationAttempt, setClassRecalculationAttempt,
    classRecalculationUnknown, setClassRecalculationUnknown, classRecalculationError, setClassRecalculationError,
    classRecalculationSaved, setClassRecalculationSaved, finalizationCandidates, setFinalizationCandidates, finalizationScope,
    setFinalizationScope, finalizationAttempt, setFinalizationAttempt, finalizations, setFinalizations, finalizationId,
    setFinalizationId, shortenedCourseClassId,
    setShortenedCourseClassId, shortenedCourseCandidate, setShortenedCourseCandidate, shortenedCourseName,
    setShortenedCourseName, shortenedClassName, setShortenedClassName, shortenedControlCount, setShortenedControlCount,
    shortenedEntryIds, setShortenedEntryIds, shortenedCourseAttempt, setShortenedCourseAttempt, shortenedCourseError,
    setShortenedCourseError };
}

export function deriveAfterRace(s: WorkspaceState) {
  const { finalizationScope, finalizationCandidates } = s;
  const finalizationCandidate = finalizationScope === "RACE" ? finalizationCandidates?.race
    : finalizationCandidates?.classes.find(row => row.classId === finalizationScope);
  return { finalizationCandidate };
}

export function createAfterRaceActions(ws: Base & RaceDataActions) {
  const { raceId, classRecalculationCandidates, finalizationCandidates, finalizationScope, finalizations, finalizationId,
    shortenedCourseClassId, shortenedCourseCandidate, shortenedCourseName, shortenedClassName, shortenedControlCount,
    shortenedEntryIds, busyRef, pending, sent, requireSession, begin, beginRequest, finish, current, assertCurrent, request,
    json, csrf, load, setMessage, setUnknown, setData, setClassRecalculationCandidates, setClassRecalculationAttempt,
    setClassRecalculationError, setClassRecalculationSaved, setClassRecalculationUnknown, setFinalizationCandidates,
    setFinalizationAttempt, setFinalizations, setFinalizationId, setShortenedCourseCandidate, setShortenedCourseError, setShortenedEntryIds, setShortenedControlCount,
    setShortenedCourseName, setShortenedClassName, setShortenedCourseAttempt } = ws;
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
  async function submitFinalization(value: FinalizationAttempt) {
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
    } catch { if (current(op)) { setUnknown(!committed); setMessage(committed ? text.finalizationSavedLoadError : text.unreachable); } }
    finally { finish(op); }
  }
  async function saveExport(response: Response, filename: string, expectedHash: string, op: Operation) {
    // Ingen kontroll av content-length: en proxy med komprimering (Caddy) tar bort
    // eller ändrar den. Hashen över det uppackade innehållet räcker.
    const buffer = await response.arrayBuffer();
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
      assertCurrent(op); setMessage(text.exportCompleteDownloaded);
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
        if (wasUnknown) { setUnknown(true); setShortenedCourseError(text.unreachable); return; }
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
    } catch { if (current(op)) setShortenedCourseError(committed ? text.shortenedCourseSavedLoadError : text.unreachable); }
    finally { finish(op); }
  }
  return { loadClassRecalculation, prepareClassRecalculation, submitClassRecalculation, loadFinalizationBasis, prepareFinalization,
    submitFinalization, loadFinalizations, downloadFinalization, downloadResults, loadShortenedCourseCandidate, toggleShortenedEntry,
    inspectShortenedCourseTransfer, submitShortenedCourseTransfer };
}
export type AfterRaceActions = ReturnType<typeof createAfterRaceActions>;
