import { useState } from "react";
import { administratorEntryChangesResponseSchema, type AdministratorEntryChangesResponse } from "@o-tid/contracts";
import { parseResultRecalculationCandidates, parseResultRecalculationResponse,
  resultRecalculationBody } from "../../lib/result-recalculation-admin-client";
import { didNotStartBody, parseDidNotStartCandidates, parseDidNotStartResponse } from "../../lib/did-not-start-admin-client";
import { parseDidNotStartWithdrawalResponse, parseDidNotStartWithdrawals } from "../../lib/did-not-start-withdrawal-admin-client";
import { parseDidNotFinishCandidates, parseDidNotFinishResponse } from "../../lib/did-not-finish-admin-client";
import { parseDidNotFinishWithdrawalResponse, parseDidNotFinishWithdrawals } from "../../lib/did-not-finish-withdrawal-admin-client";
import { parseResultDisqualificationCandidates, parseResultDisqualificationResponse } from "../../lib/result-disqualification-admin-client";
import { parseResultDisqualificationWithdrawalResponse,
  parseResultDisqualificationWithdrawals } from "../../lib/result-disqualification-withdrawal-admin-client";
import { parseResultApprovalCandidates, parseResultApprovalResponse } from "../../lib/result-approval-admin-client";
import { parseResultApprovalWithdrawalResponse, parseResultApprovalWithdrawals } from "../../lib/result-approval-withdrawal-admin-client";
import { parseOutOfCompetitionCandidates, parseOutOfCompetitionResponse } from "../../lib/out-of-competition-admin-client";
import { parseOutOfCompetitionWithdrawalResponse,
  parseOutOfCompetitionWithdrawals } from "../../lib/out-of-competition-withdrawal-admin-client";
import { parseWithoutTimingCandidates, parseWithoutTimingResponse } from "../../lib/without-timing-admin-client";
import { parseWithoutTimingWithdrawalResponse, parseWithoutTimingWithdrawals } from "../../lib/without-timing-withdrawal-admin-client";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import type { ApprovalAttempt, DnfAttempt, DnsAttempt, DsqAttempt, NtAttempt, OocAttempt, Operation, RecalculationAttempt } from "./types";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";

/** Resultatbeslut (DNS, DNF, DSQ, OOC, NT, godkännande), omräkning och ändringshistorik för vald deltagare. */
export function useResultDecisionState() {
  const [recalculationAttempt, setRecalculationAttempt] = useState<RecalculationAttempt>();
  const [entryChanges, setEntryChanges] = useState<AdministratorEntryChangesResponse>();
  const [dnsAttempt, setDnsAttempt] = useState<DnsAttempt>();
  const [dnfAttempt, setDnfAttempt] = useState<DnfAttempt>();
  const [dsqAttempt, setDsqAttempt] = useState<DsqAttempt>();
  const [approvalAttempt, setApprovalAttempt] = useState<ApprovalAttempt>();
  const [oocAttempt, setOocAttempt] = useState<OocAttempt>();
  const [ntAttempt, setNtAttempt] = useState<NtAttempt>();
  return { recalculationAttempt, setRecalculationAttempt, entryChanges, setEntryChanges, dnsAttempt, setDnsAttempt,
    dnfAttempt, setDnfAttempt, dsqAttempt, setDsqAttempt, approvalAttempt, setApprovalAttempt, oocAttempt, setOocAttempt,
    ntAttempt, setNtAttempt };
}

/** Ett resultatbeslut eller en omräkning som väntar på bekräftelse eller kvitto. */
export type StatusAttempt = DnsAttempt | DnfAttempt | DsqAttempt | ApprovalAttempt | OocAttempt | NtAttempt | RecalculationAttempt;

type DecisionRow = { id: string; entryVersion: number; classId: string; courseVersionId: string };
type DecisionList<R extends DecisionRow = DecisionRow> = { snapshotVersion: number; entries: readonly R[] };
type DecisionBasis<C extends DecisionList, W extends DecisionList> = {
  label: string; candidates: string; withdrawals: string;
  parseCandidates: (value: unknown, raceId: string) => C; parseWithdrawals: (value: unknown, raceId: string) => W;
};
const approvalBasis = { label: "APPROVAL", candidates: "/approval-candidates", withdrawals: "/approval-withdrawals",
  parseCandidates: parseResultApprovalCandidates, parseWithdrawals: parseResultApprovalWithdrawals };
const dsqBasis = { label: "DSQ", candidates: "/disqualification-candidates", withdrawals: "/disqualification-withdrawals",
  parseCandidates: parseResultDisqualificationCandidates, parseWithdrawals: parseResultDisqualificationWithdrawals };
const ntBasis = { label: "NT", candidates: "/without-timing-candidates", withdrawals: "/without-timing-withdrawals",
  parseCandidates: parseWithoutTimingCandidates, parseWithdrawals: parseWithoutTimingWithdrawals };
const oocBasis = { label: "OOC", candidates: "/out-of-competition-candidates", withdrawals: "/out-of-competition-withdrawals",
  parseCandidates: parseOutOfCompetitionCandidates, parseWithdrawals: parseOutOfCompetitionWithdrawals };
const dnfBasis = { label: "DNF", candidates: "/did-not-finish-candidates", withdrawals: "/did-not-finish-withdrawals",
  parseCandidates: parseDidNotFinishCandidates, parseWithdrawals: parseDidNotFinishWithdrawals };
const dnsBasis = { label: "DNS", candidates: "/did-not-start-candidates", withdrawals: "/did-not-start-withdrawals",
  parseCandidates: parseDidNotStartCandidates, parseWithdrawals: parseDidNotStartWithdrawals };

/** Hur ett försök skickas: adress, nyckel, kropp, kvittokontroll och besked. */
function submission(value: StatusAttempt, raceId: string) {
  switch (value.kind) {
    case "APPROVAL": case "APPROVAL_WITHDRAWAL": {
      const endpoint = value.kind === "APPROVAL" ? "approval" : "approval-withdrawal";
      return { entryId: value.value.entryId, endpoint, key: `manual-result-${endpoint}:${value.value.requestId}`, body: value.value.request,
        parse: (payload: unknown) => value.kind === "APPROVAL" ? parseResultApprovalResponse(payload, value.value, raceId)
          : parseResultApprovalWithdrawalResponse(payload, value.value, raceId),
        saved: value.kind === "APPROVAL" ? text.approvalSaved : text.approvalWithdrawalSaved,
        unknown: text.unreachable, conflict: text.approvalConflict };
    }
    case "DSQ": case "DSQ_WITHDRAWAL": {
      const endpoint = value.kind === "DSQ" ? "disqualification" : "disqualification-withdrawal";
      return { entryId: value.value.entryId, endpoint, key: `manual-${endpoint}:${value.value.requestId}`, body: value.value.request,
        parse: (payload: unknown) => value.kind === "DSQ" ? parseResultDisqualificationResponse(payload, value.value, raceId)
          : parseResultDisqualificationWithdrawalResponse(payload, value.value, raceId),
        saved: value.kind === "DSQ" ? text.dsqSaved : text.dsqWithdrawalSaved, unknown: text.unreachable, conflict: text.dsqConflict };
    }
    case "NT": case "NT_WITHDRAWAL": {
      const endpoint = value.kind === "NT" ? "without-timing" : "without-timing-withdrawal";
      return { entryId: value.value.entryId, endpoint, key: `${endpoint}:${value.value.requestId}`, body: value.value.request,
        parse: (payload: unknown) => value.kind === "NT" ? parseWithoutTimingResponse(payload, value.value, raceId)
          : parseWithoutTimingWithdrawalResponse(payload, value.value, raceId),
        saved: value.kind === "NT" ? text.ntSaved : text.ntWithdrawalSaved, unknown: text.unreachable, conflict: text.ntConflict };
    }
    case "OOC": case "OOC_WITHDRAWAL": {
      const endpoint = value.kind === "OOC" ? "out-of-competition" : "out-of-competition-withdrawal";
      return { entryId: value.value.entryId, endpoint, key: `${endpoint}:${value.value.requestId}`, body: value.value.request,
        parse: (payload: unknown) => value.kind === "OOC" ? parseOutOfCompetitionResponse(payload, value.value, raceId)
          : parseOutOfCompetitionWithdrawalResponse(payload, value.value, raceId),
        saved: value.kind === "OOC" ? text.oocSaved : text.oocWithdrawalSaved, unknown: text.unreachable, conflict: text.oocConflict };
    }
    case "DNF": case "DNF_WITHDRAWAL": {
      const endpoint = value.kind === "DNF" ? "did-not-finish" : "did-not-finish-withdrawal";
      return { entryId: value.value.entryId, endpoint, key: `${endpoint}:${value.value.requestId}`, body: value.value.request,
        parse: (payload: unknown) => value.kind === "DNF" ? parseDidNotFinishResponse(payload, value.value, raceId)
          : parseDidNotFinishWithdrawalResponse(payload, value.value, raceId),
        saved: value.kind === "DNF" ? text.dnfSaved : text.dnfWithdrawalSaved, unknown: text.unreachable, conflict: text.dnfConflict };
    }
    case "DNS": case "DNS_WITHDRAWAL": {
      const endpoint = value.kind === "DNS" ? "did-not-start" : "did-not-start-withdrawal";
      return { entryId: value.value.entryId, endpoint, key: `${endpoint}:${value.value.requestId}`,
        body: value.kind === "DNS" ? didNotStartBody(value.value) : value.value.request,
        parse: (payload: unknown) => value.kind === "DNS" ? parseDidNotStartResponse(payload, value.value, raceId)
          : parseDidNotStartWithdrawalResponse(payload, value.value, raceId),
        saved: value.kind === "DNS" ? text.dnsSaved : text.dnsWithdrawalSaved, unknown: text.unreachable, conflict: text.dnsConflict };
    }
    case "RECALCULATION":
      return { entryId: value.value.entryId, endpoint: "recalculate", key: `result-recalculation:${value.value.requestId}`,
        body: resultRecalculationBody(value.value),
        parse: (payload: unknown) => parseResultRecalculationResponse(payload, value.value, raceId),
        saved: text.recalculationSaved, unknown: text.unreachable, conflict: text.recalculationConflict };
  }
}

export function createResultDecisionActions(ws: Base & RaceDataActions) {
  const { raceId, entryId, busyRef, pending, sent, requireSession, begin, finish, current, request, json, csrf, load, setMessage,
    setUnknown, setEntryId, setEntryChanges, setRecalculationAttempt, setApprovalAttempt, setDsqAttempt, setNtAttempt,
    setOocAttempt, setDnfAttempt, setDnsAttempt } = ws;
  /** Läser deltagarlistan, beslutsunderlaget och återkallelserna och kontrollerar att de hör ihop. */
  async function readDecisionBasis<C extends DecisionList, W extends DecisionList>(op: Operation, selectedId: string,
    basis: DecisionBasis<C, W>) {
    const roster = await load(op, selectedId);
    const decisionResponse = await request(basis.candidates, op);
    if (!decisionResponse.ok) throw new Error(`${basis.label} candidates unavailable`);
    const candidates = basis.parseCandidates(await json(decisionResponse, op), raceId);
    const withdrawalResponse = await request(basis.withdrawals, op);
    if (!withdrawalResponse.ok) throw new Error(`${basis.label} withdrawals unavailable`);
    const withdrawals = basis.parseWithdrawals(await json(withdrawalResponse, op), raceId);
    if (candidates.snapshotVersion !== roster.snapshotVersion || withdrawals.snapshotVersion !== roster.snapshotVersion) throw new Error(`${basis.label} snapshot mismatch`);
    const entry = roster.entries.find((row) => row.id === selectedId);
    const raceClass = roster.classes.find((row) => row.id === entry?.classId);
    const candidate = candidates.entries.find((row) => row.id === selectedId);
    const rows = [...(candidate ? [candidate] : []), ...withdrawals.entries.filter((row) => row.id === selectedId)];
    if (!entry || !raceClass || !candidate || rows.some((row) =>
      row.entryVersion !== entry.version || row.classId !== entry.classId || row.courseVersionId !== raceClass.courseVersionId)) {
      throw new Error(`${basis.label} entry mismatch`);
    }
    return { roster, candidate: candidate as C["entries"][number], candidates,
      withdrawalRows: withdrawals.entries.filter((row) => row.id === selectedId) as W["entries"][number][], withdrawals };
  }
  const readApprovalBasis = (op: Operation, id: string) => readDecisionBasis(op, id, approvalBasis);
  const readDsqBasis = (op: Operation, id: string) => readDecisionBasis(op, id, dsqBasis);
  const readNtBasis = (op: Operation, id: string) => readDecisionBasis(op, id, ntBasis);
  const readOocBasis = (op: Operation, id: string) => readDecisionBasis(op, id, oocBasis);
  const readDnfBasis = (op: Operation, id: string) => readDecisionBasis(op, id, dnfBasis);
  const readDnsBasis = (op: Operation, id: string) => readDecisionBasis(op, id, dnsBasis);
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
    switch (value.kind) {
      case "APPROVAL": case "APPROVAL_WITHDRAWAL": setApprovalAttempt(undefined); break;
      case "DSQ": case "DSQ_WITHDRAWAL": setDsqAttempt(undefined); break;
      case "NT": case "NT_WITHDRAWAL": setNtAttempt(undefined); break;
      case "OOC": case "OOC_WITHDRAWAL": setOocAttempt(undefined); break;
      case "DNF": case "DNF_WITHDRAWAL": setDnfAttempt(undefined); break;
      case "DNS": case "DNS_WITHDRAWAL": setDnsAttempt(undefined); break;
      case "RECALCULATION": setRecalculationAttempt(undefined); break;
    }
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
  return { readApprovalBasis, readDsqBasis, readNtBasis, readOocBasis, readDnfBasis, readDnsBasis, readRecalculationBasis,
    loadHistory, submitStatusAttempt, cancelStatusAttempt };
}
export type ResultDecisionActions = ReturnType<typeof createResultDecisionActions>;
