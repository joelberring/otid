import { useState } from "react";
import {
  administratorEntryChangesResponseSchema, entryStatusReceiptSchema, entryStatusResponseSchema,
  type AdministratorEntryChangesResponse
} from "@o-tid/contracts";
import { parseResultRecalculationCandidates, parseResultRecalculationResponse,
  resultRecalculationBody } from "../../lib/result-recalculation-admin-client";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import type { DecisionAttempt, Operation, RecalculationAttempt } from "./types";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";

/** Resultatbeslut (ett statusflöde, ADR-0173), omräkning och ändringshistorik för vald deltagare. */
export function useResultDecisionState() {
  const [recalculationAttempt, setRecalculationAttempt] = useState<RecalculationAttempt>();
  const [entryChanges, setEntryChanges] = useState<AdministratorEntryChangesResponse>();
  const [decisionAttempt, setDecisionAttempt] = useState<DecisionAttempt>();
  return { recalculationAttempt, setRecalculationAttempt, entryChanges, setEntryChanges, decisionAttempt, setDecisionAttempt };
}

/** Ett resultatbeslut eller en omräkning som väntar på bekräftelse eller kvitto. */
export type StatusAttempt = DecisionAttempt | RecalculationAttempt;

/** Besked efter ett sparat eller avvisat beslut, per val i menyn. */
const DECISION_TEXT: Record<DecisionAttempt["choice"], { saved: string; conflict: string }> = {
  APPROVAL: { saved: text.approvalSaved, conflict: text.approvalConflict },
  APPROVAL_WITHDRAWAL: { saved: text.approvalWithdrawalSaved, conflict: text.approvalConflict },
  DSQ: { saved: text.dsqSaved, conflict: text.dsqConflict },
  DSQ_WITHDRAWAL: { saved: text.dsqWithdrawalSaved, conflict: text.dsqConflict },
  NT: { saved: text.ntSaved, conflict: text.ntConflict },
  NT_WITHDRAWAL: { saved: text.ntWithdrawalSaved, conflict: text.ntConflict },
  OOC: { saved: text.oocSaved, conflict: text.oocConflict },
  OOC_WITHDRAWAL: { saved: text.oocWithdrawalSaved, conflict: text.oocConflict },
  DNF: { saved: text.dnfSaved, conflict: text.dnfConflict },
  DNF_WITHDRAWAL: { saved: text.dnfWithdrawalSaved, conflict: text.dnfConflict },
  DNS: { saved: text.dnsSaved, conflict: text.dnsConflict },
  DNS_WITHDRAWAL: { saved: text.dnsWithdrawalSaved, conflict: text.dnsConflict }
};

/** Hur ett försök skickas: adress, nyckel, kropp, kvittokontroll och besked. */
function submission(value: StatusAttempt, raceId: string) {
  if (value.kind === "DECISION") {
    const { request } = value;
    return { entryId: value.entryId, endpoint: "status", key: `entry-status:${request.requestId}`, body: request,
      parse: (payload: unknown) => {
        const receipt = entryStatusReceiptSchema.parse(payload);
        if (receipt.raceId !== raceId || receipt.entryId !== value.entryId || receipt.requestId !== request.requestId) {
          throw new Error("Status receipt mismatch");
        }
        return receipt;
      },
      ...DECISION_TEXT[value.choice], unknown: text.unreachable };
  }
  return { entryId: value.value.entryId, endpoint: "recalculate", key: `result-recalculation:${value.value.requestId}`,
    body: resultRecalculationBody(value.value),
    parse: (payload: unknown) => parseResultRecalculationResponse(payload, value.value, raceId),
    saved: text.recalculationSaved, unknown: text.unreachable, conflict: text.recalculationConflict };
}

export function createResultDecisionActions(ws: Base & RaceDataActions) {
  const { raceId, entryId, busyRef, pending, sent, requireSession, begin, finish, current, request, json, csrf, load, setMessage,
    setUnknown, setEntryId, setEntryChanges, setRecalculationAttempt, setDecisionAttempt } = ws;
  /** Löparens läge (senaste revision, gällande beslut, vilka beslut som går) bundet till deltagarlistan. */
  async function readEntryStatus(op: Operation, selectedId: string) {
    const roster = await load(op, selectedId);
    const response = await request(`/entries/${selectedId}/status`, op);
    if (!response.ok) throw new Error("Entry status unavailable");
    const status = entryStatusResponseSchema.parse(await json(response, op));
    if (status.raceId !== raceId || status.entryId !== selectedId || !roster.entries.some((row) => row.id === selectedId)) {
      throw new Error("Entry status mismatch");
    }
    return status;
  }
  /** Omräkningsunderlaget för en deltagare, bundet till samma ögonblicksbild som deltagarlistan. */
  async function readRecalculationBasis(op: Operation, selectedId: string) {
    const roster = await load(op, selectedId);
    const response = await request("/recalculation-candidates", op);
    if (!response.ok) throw new Error("Recalculation candidates unavailable");
    const candidates = parseResultRecalculationCandidates(await json(response, op), raceId);
    if (candidates.snapshotVersion !== roster.snapshotVersion) throw new Error("Recalculation snapshot mismatch");
    const entry = roster.entries.find((row) => row.id === selectedId);
    const candidate = candidates.entries.find((row) => row.id === selectedId);
    if (!entry || !candidate || candidate.classId !== entry.classId || candidate.entryVersion !== entry.version ||
      candidate.cardAssignmentId !== (entry.activeAssignment?.id ?? null)) throw new Error("Recalculation entry mismatch");
    return { roster, candidate, candidates };
  }
  async function loadHistory(selectedId = entryId, beforeVersion?: number) {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = begin();
    try {
      if (!selectedId) { setMessage(""); return; }
      const roster = await load(op, selectedId);
      const entry = roster.entries.find((row) => row.id === selectedId);
      if (!entry || (beforeVersion !== undefined && (!Number.isInteger(beforeVersion) || beforeVersion <= 0 || beforeVersion > 2_147_483_647))) throw new Error("Invalid history scope");
      const response = await request(`/entries/${selectedId}/changes${beforeVersion === undefined ? "" : `?beforeVersion=${beforeVersion}`}`, op);
      if (!response.ok) throw new Error("History unavailable");
      const value = administratorEntryChangesResponseSchema.parse(await json(response, op));
      if (value.raceId !== raceId || value.entryId !== selectedId || value.entryVersion !== entry.version ||
        value.snapshotVersion !== roster.snapshotVersion || value.timeZone !== roster.timeZone ||
        (beforeVersion !== undefined && (value.items.some((row) => row.entryVersionAfter >= beforeVersion) ||
          (value.nextBeforeVersion !== null && value.nextBeforeVersion >= beforeVersion)))) throw new Error("History response mismatch");
      setEntryChanges(value); setMessage("");
    } catch { if (current(op)) setMessage(text.historyError); }
    finally { finish(op); }
  }
  function clearAttempt(value: StatusAttempt) {
    if (value.kind === "DECISION") setDecisionAttempt(undefined);
    else setRecalculationAttempt(undefined);
  }
  /**
   * Skickar ett bekräftat resultatbeslut eller en omräkning. Ett avvisat försök släpps;
   * ett försök utan svar ligger kvar och kan skickas om med samma nyckel.
   */
  async function submitStatusAttempt(value: StatusAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const wasUnknown = sent.current, op = begin();
    const target = submission(value, raceId);
    let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/entries/${target.entryId}/${target.endpoint}`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": target.key },
        body: JSON.stringify(target.body) });
      if ([400, 404, 409, 413].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(target.unknown); return; }
        pending.current = undefined; sent.current = false; clearAttempt(value); setUnknown(false); setMessage(target.conflict); return;
      }
      if (!response.ok) throw new Error("Unknown decision outcome");
      target.parse(await json(response, op));
      committed = true; pending.current = undefined; sent.current = false; clearAttempt(value); setUnknown(false);
      setMessage(target.saved); await load(op, target.entryId); setEntryId(target.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? `${target.saved} ${text.dnsAfterReadError}` : target.unknown); }
    } finally { finish(op); }
  }
  /** Avbryter ett försök som ännu inte har skickats. */
  function cancelStatusAttempt(value: StatusAttempt) {
    if (pending.current !== value || sent.current) return;
    pending.current = undefined; clearAttempt(value); setUnknown(false);
  }
  return { readEntryStatus, readRecalculationBasis, loadHistory, submitStatusAttempt, cancelStatusAttempt };
}
export type ResultDecisionActions = ReturnType<typeof createResultDecisionActions>;
