import { useState } from "react";
import { administratorEntryChangesResponseSchema, type AdministratorEntryChangesResponse } from "@o-tid/contracts";
import { createResultRecalculationAttempt, parseResultRecalculationCandidates, parseResultRecalculationResponse,
  resultRecalculationBody, type ResultRecalculationCandidates } from "../../lib/result-recalculation-admin-client";
import { createDidNotStartAttempt, didNotStartBody, parseDidNotStartCandidates, parseDidNotStartResponse,
  type DidNotStartCandidates } from "../../lib/did-not-start-admin-client";
import { createDidNotStartWithdrawalAttempt, parseDidNotStartWithdrawalResponse, parseDidNotStartWithdrawals,
  type DidNotStartWithdrawals } from "../../lib/did-not-start-withdrawal-admin-client";
import { createDidNotFinishAttempt, parseDidNotFinishCandidates, parseDidNotFinishResponse,
  type DidNotFinishCandidates } from "../../lib/did-not-finish-admin-client";
import { createDidNotFinishWithdrawalAttempt, parseDidNotFinishWithdrawalResponse, parseDidNotFinishWithdrawals,
  type DidNotFinishWithdrawals } from "../../lib/did-not-finish-withdrawal-admin-client";
import { createResultDisqualificationAttempt, parseResultDisqualificationCandidates, parseResultDisqualificationResponse,
  type ResultDisqualificationCandidates } from "../../lib/result-disqualification-admin-client";
import { createResultDisqualificationWithdrawalAttempt, parseResultDisqualificationWithdrawalResponse,
  parseResultDisqualificationWithdrawals, type ResultDisqualificationWithdrawals } from "../../lib/result-disqualification-withdrawal-admin-client";
import { createResultApprovalAttempt, parseResultApprovalCandidates, parseResultApprovalResponse,
  type ResultApprovalCandidates } from "../../lib/result-approval-admin-client";
import { createResultApprovalWithdrawalAttempt, parseResultApprovalWithdrawalResponse, parseResultApprovalWithdrawals,
  type ResultApprovalWithdrawals } from "../../lib/result-approval-withdrawal-admin-client";
import { createOutOfCompetitionAttempt, parseOutOfCompetitionCandidates, parseOutOfCompetitionResponse,
  type OutOfCompetitionCandidates } from "../../lib/out-of-competition-admin-client";
import { createOutOfCompetitionWithdrawalAttempt, parseOutOfCompetitionWithdrawalResponse, parseOutOfCompetitionWithdrawals,
  type OutOfCompetitionWithdrawals } from "../../lib/out-of-competition-withdrawal-admin-client";
import { createWithoutTimingAttempt, parseWithoutTimingCandidates, parseWithoutTimingResponse,
  type WithoutTimingCandidates } from "../../lib/without-timing-admin-client";
import { createWithoutTimingWithdrawalAttempt, parseWithoutTimingWithdrawalResponse, parseWithoutTimingWithdrawals,
  type WithoutTimingWithdrawals } from "../../lib/without-timing-withdrawal-admin-client";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import type { ApprovalAttempt, DnfAttempt, DnsAttempt, DsqAttempt, NtAttempt, OocAttempt, Operation, RecalculationAttempt } from "./types";
import type { Base, WorkspaceState } from "./workspace-state";
import type { RaceDataActions } from "./race-data";
import type { Roster } from "./participant-roster";

/** Underlag och försök för resultatbeslut (DNS, DNF, DSQ, OOC, NT, godkännande), omräkning och ändringshistorik. */
export function useResultDecisionState() {
  const [recalculationCandidates, setRecalculationCandidates] = useState<ResultRecalculationCandidates>();
  const [recalculationAttempt, setRecalculationAttempt] = useState<RecalculationAttempt>();
  const [entryChanges, setEntryChanges] = useState<AdministratorEntryChangesResponse>();
  const [dnsCandidates, setDnsCandidates] = useState<DidNotStartCandidates>();
  const [dnsWithdrawals, setDnsWithdrawals] = useState<DidNotStartWithdrawals>();
  const [dnsAttempt, setDnsAttempt] = useState<DnsAttempt>();
  const [dnfCandidates, setDnfCandidates] = useState<DidNotFinishCandidates>();
  const [dnfWithdrawals, setDnfWithdrawals] = useState<DidNotFinishWithdrawals>();
  const [dnfAttempt, setDnfAttempt] = useState<DnfAttempt>();
  const [dsqCandidates, setDsqCandidates] = useState<ResultDisqualificationCandidates>();
  const [dsqWithdrawals, setDsqWithdrawals] = useState<ResultDisqualificationWithdrawals>();
  const [dsqAttempt, setDsqAttempt] = useState<DsqAttempt>();
  const [approvalCandidates, setApprovalCandidates] = useState<ResultApprovalCandidates>();
  const [approvalWithdrawals, setApprovalWithdrawals] = useState<ResultApprovalWithdrawals>();
  const [approvalAttempt, setApprovalAttempt] = useState<ApprovalAttempt>();
  const [oocCandidates, setOocCandidates] = useState<OutOfCompetitionCandidates>();
  const [oocWithdrawals, setOocWithdrawals] = useState<OutOfCompetitionWithdrawals>();
  const [oocAttempt, setOocAttempt] = useState<OocAttempt>();
  const [ntCandidates, setNtCandidates] = useState<WithoutTimingCandidates>();
  const [ntWithdrawals, setNtWithdrawals] = useState<WithoutTimingWithdrawals>();
  const [ntAttempt, setNtAttempt] = useState<NtAttempt>();
  return { recalculationCandidates, setRecalculationCandidates, recalculationAttempt, setRecalculationAttempt, entryChanges,
    setEntryChanges, dnsCandidates, setDnsCandidates, dnsWithdrawals, setDnsWithdrawals, dnsAttempt, setDnsAttempt,
    dnfCandidates, setDnfCandidates, dnfWithdrawals, setDnfWithdrawals, dnfAttempt, setDnfAttempt, dsqCandidates,
    setDsqCandidates, dsqWithdrawals, setDsqWithdrawals, dsqAttempt, setDsqAttempt, approvalCandidates, setApprovalCandidates,
    approvalWithdrawals, setApprovalWithdrawals, approvalAttempt, setApprovalAttempt, oocCandidates, setOocCandidates,
    oocWithdrawals, setOocWithdrawals, oocAttempt, setOocAttempt, ntCandidates, setNtCandidates, ntWithdrawals,
    setNtWithdrawals, ntAttempt, setNtAttempt };
}

type DecisionRow = { id: string; entryVersion: number; classId: string; courseVersionId: string };
type DecisionList<R extends DecisionRow = DecisionRow> = { snapshotVersion: number; entries: readonly R[] };
type WithdrawalRow = DecisionRow & { state: string };

/** Gemensam bedömning av om ett beslutsunderlag (beslut + återkallelser) hör till vald deltagare och ögonblicksbild. */
function decisionView<R extends DecisionRow, H extends WithdrawalRow>(candidates: DecisionList<R> | undefined,
  withdrawals: DecisionList<H> | undefined, entryId: string, { data, selected, selectedClass }: Pick<WorkspaceState, "data"> &
  Pick<Roster, "selected" | "selectedClass">) {
  const candidate = candidates?.entries.find((row) => row.id === entryId);
  const history = withdrawals?.entries.filter((row) => row.id === entryId) ?? [];
  const active = history.filter((row) => row.state === "WITHDRAWABLE");
  const withdrawal = active.length === 1 ? active[0] : undefined;
  const matches = !!selected && !!selectedClass && !!data && candidates?.snapshotVersion === data.snapshotVersion &&
    withdrawals?.snapshotVersion === data.snapshotVersion && candidate?.entryVersion === selected.version &&
    candidate.classId === selected.classId && candidate.courseVersionId === selectedClass.courseVersionId && active.length <= 1;
  return { candidate, history, withdrawal, matches };
}

export function deriveResultDecisions(s: WorkspaceState, roster: Pick<Roster, "selected" | "selectedClass">) {
  const { data, entryId, recalculationCandidates, dnsCandidates, dnsWithdrawals } = s;
  const { selected, selectedClass } = roster;
  const scope = { data, ...roster };
  const recalculationCandidate = recalculationCandidates?.entries.find((row) => row.id === entryId);
  const recalculationMatches = !!data && !!selected && !!recalculationCandidate &&
    recalculationCandidates?.snapshotVersion === data.snapshotVersion &&
    recalculationCandidate.classId === selected.classId && recalculationCandidate.entryVersion === selected.version &&
    recalculationCandidate.cardAssignmentId === (selected.activeAssignment?.id ?? null) &&
    (recalculationCandidate.readiness === "MULTIPLE_ACTIVE_ASSIGNMENTS") === selected.multipleActiveAssignments;
  const approval = decisionView(s.approvalCandidates, s.approvalWithdrawals, entryId, scope);
  const dsq = decisionView(s.dsqCandidates, s.dsqWithdrawals, entryId, scope);
  const nt = decisionView(s.ntCandidates, s.ntWithdrawals, entryId, scope);
  const ooc = decisionView(s.oocCandidates, s.oocWithdrawals, entryId, scope);
  const dnf = decisionView(s.dnfCandidates, s.dnfWithdrawals, entryId, scope);
  const dnsCandidate = dnsCandidates?.entries.find((row) => row.id === entryId);
  const dnsWithdrawal = dnsWithdrawals?.entries.find((row) => row.id === entryId);
  const dnsMatches = !!selected && !!selectedClass && !!data && dnsCandidates?.snapshotVersion === data.snapshotVersion &&
    dnsWithdrawals?.snapshotVersion === data.snapshotVersion && dnsCandidate?.entryVersion === selected.version &&
    dnsCandidate.classId === selected.classId && dnsCandidate.courseVersionId === selectedClass.courseVersionId;
  return { recalculationCandidate, recalculationMatches,
    approvalCandidate: approval.candidate, approvalHistory: approval.history, approvalWithdrawal: approval.withdrawal, approvalMatches: approval.matches,
    dsqCandidate: dsq.candidate, dsqHistory: dsq.history, dsqWithdrawal: dsq.withdrawal, dsqMatches: dsq.matches,
    ntCandidate: nt.candidate, ntHistory: nt.history, ntWithdrawal: nt.withdrawal, ntMatches: nt.matches,
    oocCandidate: ooc.candidate, oocHistory: ooc.history, oocWithdrawal: ooc.withdrawal, oocMatches: ooc.matches,
    dnfCandidate: dnf.candidate, dnfHistory: dnf.history, dnfWithdrawal: dnf.withdrawal, dnfMatches: dnf.matches,
    dnsCandidate, dnsWithdrawal, dnsMatches };
}

type DecisionBasis<C extends DecisionList, W extends DecisionList<WithdrawalRow>> = {
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

export function createResultDecisionActions(ws: Base & RaceDataActions) {
  const { raceId, data, entryId, recalculationCandidates, recalculationCandidate, recalculationMatches, approvalCandidate,
    approvalCandidates, approvalWithdrawals, approvalWithdrawal, approvalMatches, dsqCandidate, dsqCandidates, dsqWithdrawals,
    dsqWithdrawal, dsqMatches, ntCandidate, ntCandidates, ntWithdrawals, ntWithdrawal, ntMatches, oocCandidate, oocCandidates,
    oocWithdrawals, oocWithdrawal, oocMatches, dnfCandidate, dnfCandidates, dnfWithdrawals, dnfWithdrawal, dnfMatches,
    dnsCandidate, dnsCandidates, dnsWithdrawals, dnsWithdrawal, dnsMatches, busyRef, pending, sent, requireSession, begin,
    finish, current, request, json, csrf, load, setMessage, setUnknown, setEntryId, setEntryChanges, setRecalculationCandidates,
    setRecalculationAttempt, setApprovalCandidates, setApprovalWithdrawals, setApprovalAttempt, setDsqCandidates,
    setDsqWithdrawals, setDsqAttempt, setNtCandidates, setNtWithdrawals, setNtAttempt, setOocCandidates, setOocWithdrawals,
    setOocAttempt, setDnfCandidates, setDnfWithdrawals, setDnfAttempt, setDnsCandidates, setDnsWithdrawals, setDnsAttempt } = ws;
  /** Läser deltagarlistan, beslutsunderlaget och återkallelserna och kontrollerar att de hör ihop. */
  async function readDecisionBasis<C extends DecisionList, W extends DecisionList<WithdrawalRow>>(op: Operation, selectedId: string,
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
    const active = withdrawals.entries.filter((row) => row.id === selectedId && row.state === "WITHDRAWABLE");
    if (active.length > 1 || (selectedId && (!entry || !raceClass || !candidate || [candidate, ...active].some((row) =>
      row.entryVersion !== entry.version || row.classId !== entry.classId || row.courseVersionId !== raceClass.courseVersionId)))) throw new Error(`${basis.label} entry mismatch`);
    return { candidates, withdrawals };
  }
  async function loadApprovalBasis(op: Operation, selectedId: string) {
    const basis = await readDecisionBasis(op, selectedId, approvalBasis);
    setApprovalCandidates(basis.candidates); setApprovalWithdrawals(basis.withdrawals);
  }
  async function loadDsqBasis(op: Operation, selectedId: string) {
    const basis = await readDecisionBasis(op, selectedId, dsqBasis);
    setDsqCandidates(basis.candidates); setDsqWithdrawals(basis.withdrawals);
  }
  async function loadNtBasis(op: Operation, selectedId: string) {
    const basis = await readDecisionBasis(op, selectedId, ntBasis);
    setNtCandidates(basis.candidates); setNtWithdrawals(basis.withdrawals);
  }
  async function loadOocBasis(op: Operation, selectedId: string) {
    const basis = await readDecisionBasis(op, selectedId, oocBasis);
    setOocCandidates(basis.candidates); setOocWithdrawals(basis.withdrawals);
  }
  async function loadDnfBasis(op: Operation, selectedId: string) {
    const basis = await readDecisionBasis(op, selectedId, dnfBasis);
    setDnfCandidates(basis.candidates); setDnfWithdrawals(basis.withdrawals);
  }
  async function loadDnsBasis(op: Operation, selectedId: string) {
    const roster = await load(op, selectedId);
    const decisionResponse = await request("/did-not-start-candidates", op);
    if (!decisionResponse.ok) throw new Error("DNS candidates unavailable");
    const candidates = parseDidNotStartCandidates(await json(decisionResponse, op), raceId);
    const withdrawalResponse = await request("/did-not-start-withdrawals", op);
    if (!withdrawalResponse.ok) throw new Error("DNS withdrawals unavailable");
    const withdrawals = parseDidNotStartWithdrawals(await json(withdrawalResponse, op), raceId);
    if (candidates.snapshotVersion !== roster.snapshotVersion || withdrawals.snapshotVersion !== roster.snapshotVersion) throw new Error("DNS snapshot mismatch");
    const entry = roster.entries.find((row) => row.id === selectedId);
    const raceClass = roster.classes.find((row) => row.id === entry?.classId);
    const candidate = candidates.entries.find((row) => row.id === selectedId);
    const withdrawal = withdrawals.entries.find((row) => row.id === selectedId);
    if (selectedId && (!entry || !raceClass || !candidate || [candidate, ...(withdrawal ? [withdrawal] : [])].some((row) =>
      row.entryVersion !== entry.version || row.classId !== entry.classId || row.courseVersionId !== raceClass.courseVersionId))) throw new Error("DNS entry mismatch");
    setDnsCandidates(candidates); setDnsWithdrawals(withdrawals);
  }
  async function loadDecision(selectedId: string, loadBasis: (op: Operation, selectedId: string) => Promise<void>, error: string) {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = begin();
    try { await loadBasis(op, selectedId); setMessage(""); }
    catch { if (current(op)) setMessage(error); } finally { finish(op); }
  }
  const loadApproval = (selectedId = entryId) => loadDecision(selectedId, loadApprovalBasis, text.approvalLoadError);
  const loadDsq = (selectedId = entryId) => loadDecision(selectedId, loadDsqBasis, text.dsqLoadError);
  const loadNt = (selectedId = entryId) => loadDecision(selectedId, loadNtBasis, text.ntLoadError);
  const loadOoc = (selectedId = entryId) => loadDecision(selectedId, loadOocBasis, text.oocLoadError);
  const loadDnf = (selectedId = entryId) => loadDecision(selectedId, loadDnfBasis, text.dnfLoadError);
  const loadDns = (selectedId = entryId) => loadDecision(selectedId, loadDnsBasis, text.dnsLoadError);
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
  async function loadRecalculation(selectedId = entryId) {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = begin(); setRecalculationCandidates(undefined);
    try {
      const roster = await load(op, selectedId);
      const response = await request("/recalculation-candidates", op);
      if (!response.ok) throw new Error("Recalculation candidates unavailable");
      const candidates = parseResultRecalculationCandidates(await json(response, op), raceId);
      if (candidates.snapshotVersion !== roster.snapshotVersion) throw new Error("Recalculation snapshot mismatch");
      setRecalculationCandidates(candidates); setMessage("");
    } catch { if (current(op)) setMessage(text.recalculationLoadError); }
    finally { finish(op); }
  }
  function prepareRecalculation() {
    if (busyRef.current || pending.current || !requireSession()) return;
    if (!data || !recalculationCandidates || !recalculationMatches || recalculationCandidate?.readiness !== "READY") {
      setMessage(text.recalculationLoadError); return;
    }
    const value: RecalculationAttempt = { kind: "RECALCULATION", timeZone: data.timeZone,
      value: createResultRecalculationAttempt(recalculationCandidate, recalculationCandidates) };
    pending.current = value; sent.current = false; setRecalculationAttempt(value); setUnknown(false); setMessage("");
  }
  async function submitRecalculation(value: RecalculationAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current;
    let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/entries/${value.value.entryId}/recalculate`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `result-recalculation:${value.value.requestId}` },
        body: JSON.stringify(resultRecalculationBody(value.value)) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.recalculationUnknown); return; }
        pending.current = undefined; sent.current = false; setRecalculationAttempt(undefined); setUnknown(false);
        setRecalculationCandidates(undefined); setMessage(text.recalculationConflict); return;
      }
      if (!response.ok) throw new Error("Unknown recalculation outcome");
      const receipt = parseResultRecalculationResponse(await json(response, op), value.value, raceId);
      committed = true; pending.current = undefined; sent.current = false; setRecalculationAttempt(undefined); setUnknown(false);
      setRecalculationCandidates(undefined);
      setMessage(`${text.recalculationSaved} ${text.technicalRevision}: ${receipt.revision} · ${receipt.status}/${receipt.reason}`);
      await load(op, value.value.entryId); setEntryId(value.value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.recalculationSavedLoadError : text.recalculationUnknown); }
    } finally { finish(op); }
  }
  function prepareApproval(withdraw: boolean) {
    if (busyRef.current || pending.current || !requireSession() || !approvalMatches || !approvalCandidate || !approvalCandidates || !approvalWithdrawals) return;
    try {
      let value: ApprovalAttempt;
      if (withdraw) {
        if (!approvalWithdrawal) return;
        value = { kind: "APPROVAL_WITHDRAWAL", value: createResultApprovalWithdrawalAttempt(approvalWithdrawal, approvalWithdrawals) };
      } else value = { kind: "APPROVAL", value: createResultApprovalAttempt(approvalCandidate, approvalCandidates) };
      pending.current = value; sent.current = false; setApprovalAttempt(value); setUnknown(false); setMessage("");
    } catch { setMessage(text.approvalLoadError); }
  }
  async function submitApproval(value: ApprovalAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const wasUnknown = sent.current, op = begin();
    let committed = false;
    const saved = value.kind === "APPROVAL" ? text.approvalSaved : text.approvalWithdrawalSaved;
    try {
      const token = csrf(); sent.current = true;
      const endpoint = value.kind === "APPROVAL" ? "approval" : "approval-withdrawal";
      const response = await request(`/entries/${value.value.entryId}/${endpoint}`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `manual-result-${endpoint}:${value.value.requestId}` },
        body: JSON.stringify(value.value.request) });
      if ([400, 404, 409, 413].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.approvalUnknown); return; }
        pending.current = undefined; sent.current = false; setApprovalAttempt(undefined); setUnknown(false); setMessage(text.approvalConflict); return;
      }
      if (!response.ok) throw new Error("Unknown APPROVAL outcome");
      const payload = await json(response, op);
      if (value.kind === "APPROVAL") parseResultApprovalResponse(payload, value.value, raceId);
      else parseResultApprovalWithdrawalResponse(payload, value.value, raceId);
      committed = true; pending.current = undefined; sent.current = false; setApprovalAttempt(undefined); setUnknown(false);
      setMessage(saved); await loadApprovalBasis(op, value.value.entryId); setEntryId(value.value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? `${saved} ${text.dnsAfterReadError}` : text.approvalUnknown); }
    } finally { finish(op); }
  }
  function prepareDsq(withdraw: boolean) {
    if (busyRef.current || pending.current || !requireSession() || !dsqMatches || !dsqCandidate || !dsqCandidates || !dsqWithdrawals) return;
    try {
      let value: DsqAttempt;
      if (withdraw) {
        if (!dsqWithdrawal) return;
        value = { kind: "DSQ_WITHDRAWAL", value: createResultDisqualificationWithdrawalAttempt(dsqWithdrawal, dsqWithdrawals) };
      } else value = { kind: "DSQ", value: createResultDisqualificationAttempt(dsqCandidate, dsqCandidates) };
      pending.current = value; sent.current = false; setDsqAttempt(value); setUnknown(false); setMessage("");
    } catch { setMessage(text.dsqLoadError); }
  }
  async function submitDsq(value: DsqAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const wasUnknown = sent.current, op = begin();
    let committed = false;
    const saved = value.kind === "DSQ" ? text.dsqSaved : text.dsqWithdrawalSaved;
    try {
      const token = csrf(); sent.current = true;
      const endpoint = value.kind === "DSQ" ? "disqualification" : "disqualification-withdrawal";
      const response = await request(`/entries/${value.value.entryId}/${endpoint}`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `manual-${endpoint}:${value.value.requestId}` },
        body: JSON.stringify(value.value.request) });
      if ([400, 404, 409, 413].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.dsqUnknown); return; }
        pending.current = undefined; sent.current = false; setDsqAttempt(undefined); setUnknown(false); setMessage(text.dsqConflict); return;
      }
      if (!response.ok) throw new Error("Unknown DSQ outcome");
      const payload = await json(response, op);
      if (value.kind === "DSQ") parseResultDisqualificationResponse(payload, value.value, raceId);
      else parseResultDisqualificationWithdrawalResponse(payload, value.value, raceId);
      committed = true; pending.current = undefined; sent.current = false; setDsqAttempt(undefined); setUnknown(false);
      setMessage(saved); await loadDsqBasis(op, value.value.entryId); setEntryId(value.value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? `${saved} ${text.dnsAfterReadError}` : text.dsqUnknown); }
    } finally { finish(op); }
  }
  function prepareNt(withdraw: boolean) {
    if (busyRef.current || pending.current || !requireSession() || !ntMatches || !ntCandidate || !ntCandidates || !ntWithdrawals) return;
    try {
      let value: NtAttempt;
      if (withdraw) {
        if (!ntWithdrawal) return;
        value = { kind: "NT_WITHDRAWAL", value: createWithoutTimingWithdrawalAttempt(ntWithdrawal, ntWithdrawals) };
      } else value = { kind: "NT", value: createWithoutTimingAttempt(ntCandidate, ntCandidates) };
      pending.current = value; sent.current = false; setNtAttempt(value); setUnknown(false); setMessage("");
    } catch { setMessage(text.ntLoadError); }
  }
  async function submitNt(value: NtAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const wasUnknown = sent.current, op = begin();
    let committed = false;
    const saved = value.kind === "NT" ? text.ntSaved : text.ntWithdrawalSaved;
    try {
      const token = csrf(); sent.current = true;
      const endpoint = value.kind === "NT" ? "without-timing" : "without-timing-withdrawal";
      const response = await request(`/entries/${value.value.entryId}/${endpoint}`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `${endpoint}:${value.value.requestId}` },
        body: JSON.stringify(value.value.request) });
      if ([400, 404, 409, 413].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.ntUnknown); return; }
        pending.current = undefined; sent.current = false; setNtAttempt(undefined); setUnknown(false); setMessage(text.ntConflict); return;
      }
      if (!response.ok) throw new Error("Unknown NT outcome");
      const payload = await json(response, op);
      if (value.kind === "NT") parseWithoutTimingResponse(payload, value.value, raceId);
      else parseWithoutTimingWithdrawalResponse(payload, value.value, raceId);
      committed = true; pending.current = undefined; sent.current = false; setNtAttempt(undefined); setUnknown(false);
      setMessage(saved); await loadNtBasis(op, value.value.entryId); setEntryId(value.value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? `${saved} ${text.dnsAfterReadError}` : text.ntUnknown); }
    } finally { finish(op); }
  }
  function prepareOoc(withdraw: boolean) {
    if (busyRef.current || pending.current || !requireSession() || !oocMatches || !oocCandidate || !oocCandidates || !oocWithdrawals) return;
    try {
      let value: OocAttempt;
      if (withdraw) {
        if (!oocWithdrawal) return;
        value = { kind: "OOC_WITHDRAWAL", value: createOutOfCompetitionWithdrawalAttempt(oocWithdrawal, oocWithdrawals) };
      } else value = { kind: "OOC", value: createOutOfCompetitionAttempt(oocCandidate, oocCandidates) };
      pending.current = value; sent.current = false; setOocAttempt(value); setUnknown(false); setMessage("");
    } catch { setMessage(text.oocLoadError); }
  }
  async function submitOoc(value: OocAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const wasUnknown = sent.current, op = begin();
    let committed = false;
    const saved = value.kind === "OOC" ? text.oocSaved : text.oocWithdrawalSaved;
    try {
      const token = csrf(); sent.current = true;
      const endpoint = value.kind === "OOC" ? "out-of-competition" : "out-of-competition-withdrawal";
      const response = await request(`/entries/${value.value.entryId}/${endpoint}`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `${endpoint}:${value.value.requestId}` },
        body: JSON.stringify(value.value.request) });
      if ([400, 404, 409, 413].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.oocUnknown); return; }
        pending.current = undefined; sent.current = false; setOocAttempt(undefined); setUnknown(false); setMessage(text.oocConflict); return;
      }
      if (!response.ok) throw new Error("Unknown OOC outcome");
      const payload = await json(response, op);
      if (value.kind === "OOC") parseOutOfCompetitionResponse(payload, value.value, raceId);
      else parseOutOfCompetitionWithdrawalResponse(payload, value.value, raceId);
      committed = true; pending.current = undefined; sent.current = false; setOocAttempt(undefined); setUnknown(false);
      setMessage(saved); await loadOocBasis(op, value.value.entryId); setEntryId(value.value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? `${saved} ${text.dnsAfterReadError}` : text.oocUnknown); }
    } finally { finish(op); }
  }
  function prepareDnf(withdraw: boolean) {
    if (busyRef.current || pending.current || !requireSession() || !dnfMatches || !dnfCandidate || !dnfCandidates || !dnfWithdrawals) return;
    try {
      let value: DnfAttempt;
      if (withdraw) {
        if (!dnfWithdrawal) return;
        value = { kind: "DNF_WITHDRAWAL", value: createDidNotFinishWithdrawalAttempt(dnfWithdrawal, dnfWithdrawals) };
      } else value = { kind: "DNF", value: createDidNotFinishAttempt(dnfCandidate, dnfCandidates) };
      pending.current = value; sent.current = false; setDnfAttempt(value); setUnknown(false); setMessage("");
    } catch { setMessage(text.dnfLoadError); }
  }
  async function submitDnf(value: DnfAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const wasUnknown = sent.current, op = begin();
    let committed = false;
    const saved = value.kind === "DNF" ? text.dnfSaved : text.dnfWithdrawalSaved;
    try {
      const token = csrf(); sent.current = true;
      const endpoint = value.kind === "DNF" ? "did-not-finish" : "did-not-finish-withdrawal";
      const response = await request(`/entries/${value.value.entryId}/${endpoint}`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `${endpoint}:${value.value.requestId}` },
        body: JSON.stringify(value.value.request) });
      if ([400, 404, 409, 413].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.dnfUnknown); return; }
        pending.current = undefined; sent.current = false; setDnfAttempt(undefined); setUnknown(false); setMessage(text.dnfConflict); return;
      }
      if (!response.ok) throw new Error("Unknown DNF outcome");
      const payload = await json(response, op);
      if (value.kind === "DNF") parseDidNotFinishResponse(payload, value.value, raceId);
      else parseDidNotFinishWithdrawalResponse(payload, value.value, raceId);
      committed = true; pending.current = undefined; sent.current = false; setDnfAttempt(undefined); setUnknown(false);
      setMessage(saved); await loadDnfBasis(op, value.value.entryId); setEntryId(value.value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? `${saved} ${text.dnsAfterReadError}` : text.dnfUnknown); }
    } finally { finish(op); }
  }
  function prepareDns(withdraw: boolean) {
    if (busyRef.current || pending.current || !requireSession() || !dnsMatches || !dnsCandidate || !dnsCandidates || !dnsWithdrawals) return;
    try {
      const value: DnsAttempt = withdraw
        ? { kind: "DNS_WITHDRAWAL", value: createDidNotStartWithdrawalAttempt(dnsWithdrawal!, dnsWithdrawals) }
        : { kind: "DNS", value: createDidNotStartAttempt(dnsCandidate, dnsCandidates) };
      pending.current = value; sent.current = false; setDnsAttempt(value); setUnknown(false); setMessage("");
    } catch { setMessage(text.dnsLoadError); }
  }
  async function submitDns(value: DnsAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current;
    let committed = false;
    const saved = value.kind === "DNS" ? text.dnsSaved : text.dnsWithdrawalSaved;
    try {
      const token = csrf(); sent.current = true;
      const endpoint = value.kind === "DNS" ? "did-not-start" : "did-not-start-withdrawal";
      const response = await request(`/entries/${value.value.entryId}/${endpoint}`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `${endpoint}:${value.value.requestId}` },
        body: JSON.stringify(value.kind === "DNS" ? didNotStartBody(value.value) : value.value.request) });
      if ([400, 404, 409, 413].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.dnsUnknown); return; }
        pending.current = undefined; sent.current = false; setDnsAttempt(undefined); setUnknown(false); setMessage(text.dnsConflict); return;
      }
      if (!response.ok) throw new Error("Unknown DNS outcome");
      const payload = await json(response, op);
      if (value.kind === "DNS") parseDidNotStartResponse(payload, value.value, raceId);
      else parseDidNotStartWithdrawalResponse(payload, value.value, raceId);
      committed = true; pending.current = undefined; sent.current = false; setDnsAttempt(undefined); setUnknown(false);
      setMessage(saved); await loadDnsBasis(op, value.value.entryId); setEntryId(value.value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? `${saved} ${text.dnsAfterReadError}` : text.dnsUnknown); }
    } finally { finish(op); }
  }
  return { loadApproval, loadDsq, loadNt, loadOoc, loadDnf, loadDns, loadHistory, loadRecalculation, prepareRecalculation,
    submitRecalculation, prepareApproval, submitApproval, prepareDsq, submitDsq, prepareNt, submitNt, prepareOoc, submitOoc,
    prepareDnf, submitDnf, prepareDns, submitDns };
}
export type ResultDecisionActions = ReturnType<typeof createResultDecisionActions>;
