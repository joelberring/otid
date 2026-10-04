import { useState } from "react";
import { createResultApprovalAttempt } from "../../lib/result-approval-admin-client";
import { createResultApprovalWithdrawalAttempt } from "../../lib/result-approval-withdrawal-admin-client";
import { createResultDisqualificationAttempt } from "../../lib/result-disqualification-admin-client";
import { createResultDisqualificationWithdrawalAttempt } from "../../lib/result-disqualification-withdrawal-admin-client";
import { createWithoutTimingAttempt } from "../../lib/without-timing-admin-client";
import { createWithoutTimingWithdrawalAttempt } from "../../lib/without-timing-withdrawal-admin-client";
import { createOutOfCompetitionAttempt } from "../../lib/out-of-competition-admin-client";
import { createOutOfCompetitionWithdrawalAttempt } from "../../lib/out-of-competition-withdrawal-admin-client";
import { createDidNotFinishAttempt } from "../../lib/did-not-finish-admin-client";
import { createDidNotFinishWithdrawalAttempt } from "../../lib/did-not-finish-withdrawal-admin-client";
import { createDidNotStartAttempt } from "../../lib/did-not-start-admin-client";
import { createDidNotStartWithdrawalAttempt } from "../../lib/did-not-start-withdrawal-admin-client";
import { createResultRecalculationAttempt } from "../../lib/result-recalculation-admin-client";
import type { StatusChoice } from "../../lib/participant-status-choices";
import { raceAdministratorSv as adminText } from "../../i18n/race-administrator-sv";
import { participantCardSv as text } from "../../i18n/participant-card-sv";
import type { Operation } from "./types";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";
import type { ResultDecisionActions, StatusAttempt } from "./result-decisions";

/** Deltagarkortets meny "Ändra status": ett val, ett besked och en bekräftelse (ADR-0169 beslut 4). */
export function useStatusChangeState() {
  const [statusChoice, setStatusChoice] = useState<StatusChoice | "">("");
  const [statusBlocked, setStatusBlocked] = useState("");
  return { statusChoice, setStatusChoice, statusBlocked, setStatusBlocked };
}

type Prepared = { attempt: StatusAttempt; show: () => void } | string;
const withdrawable = <T extends { state: string }>(rows: readonly T[]) => {
  const active = rows.filter(row => row.state === "WITHDRAWABLE");
  return active.length === 1 ? active[0] : undefined;
};

export function createStatusChangeActions(ws: Base & RaceDataActions & ResultDecisionActions) {
  const { entryId, data, busyRef, pending, sent, requireSession, begin, finish, current, setMessage, setUnknown,
    setStatusChoice, setStatusBlocked, setApprovalAttempt, setDsqAttempt, setNtAttempt, setOocAttempt, setDnfAttempt,
    setDnsAttempt, setRecalculationAttempt, readApprovalBasis, readDsqBasis, readNtBasis, readOocBasis, readDnfBasis,
    readDnsBasis, readRecalculationBasis, submitStatusAttempt, cancelStatusAttempt } = ws;

  /** Läser underlaget för valet och skapar försöket, eller ger ett besked om varför det inte går. */
  async function prepare(op: Operation, choice: StatusChoice, id: string): Promise<Prepared> {
    switch (choice) {
      case "APPROVAL": case "APPROVAL_WITHDRAWAL": {
        const basis = await readApprovalBasis(op, id);
        if (choice === "APPROVAL") {
          if (basis.candidate.readiness !== "READY") return adminText.approvalReadiness[basis.candidate.readiness];
          const attempt = { kind: "APPROVAL" as const, value: createResultApprovalAttempt(basis.candidate, basis.candidates) };
          return { attempt, show: () => setApprovalAttempt(attempt) };
        }
        const row = withdrawable(basis.withdrawalRows);
        if (!row) return text.notAvailable;
        const attempt = { kind: "APPROVAL_WITHDRAWAL" as const, value: createResultApprovalWithdrawalAttempt(row, basis.withdrawals) };
        return { attempt, show: () => setApprovalAttempt(attempt) };
      }
      case "DSQ": case "DSQ_WITHDRAWAL": {
        const basis = await readDsqBasis(op, id);
        if (choice === "DSQ") {
          if (basis.candidate.readiness !== "READY") return adminText.dsqReadiness[basis.candidate.readiness];
          const attempt = { kind: "DSQ" as const, value: createResultDisqualificationAttempt(basis.candidate, basis.candidates) };
          return { attempt, show: () => setDsqAttempt(attempt) };
        }
        const row = withdrawable(basis.withdrawalRows);
        if (!row) return text.notAvailable;
        const attempt = { kind: "DSQ_WITHDRAWAL" as const, value: createResultDisqualificationWithdrawalAttempt(row, basis.withdrawals) };
        return { attempt, show: () => setDsqAttempt(attempt) };
      }
      case "NT": case "NT_WITHDRAWAL": {
        const basis = await readNtBasis(op, id);
        if (choice === "NT") {
          if (basis.candidate.readiness !== "READY") return adminText.ntReadiness[basis.candidate.readiness];
          const attempt = { kind: "NT" as const, value: createWithoutTimingAttempt(basis.candidate, basis.candidates) };
          return { attempt, show: () => setNtAttempt(attempt) };
        }
        const row = withdrawable(basis.withdrawalRows);
        if (!row) return text.notAvailable;
        const attempt = { kind: "NT_WITHDRAWAL" as const, value: createWithoutTimingWithdrawalAttempt(row, basis.withdrawals) };
        return { attempt, show: () => setNtAttempt(attempt) };
      }
      case "OOC": case "OOC_WITHDRAWAL": {
        const basis = await readOocBasis(op, id);
        if (choice === "OOC") {
          if (basis.candidate.readiness !== "READY") return adminText.oocReadiness[basis.candidate.readiness];
          const attempt = { kind: "OOC" as const, value: createOutOfCompetitionAttempt(basis.candidate, basis.candidates) };
          return { attempt, show: () => setOocAttempt(attempt) };
        }
        const row = withdrawable(basis.withdrawalRows);
        if (!row) return text.notAvailable;
        const attempt = { kind: "OOC_WITHDRAWAL" as const, value: createOutOfCompetitionWithdrawalAttempt(row, basis.withdrawals) };
        return { attempt, show: () => setOocAttempt(attempt) };
      }
      case "DNF": case "DNF_WITHDRAWAL": {
        const basis = await readDnfBasis(op, id);
        if (choice === "DNF") {
          if (basis.candidate.readiness !== "READY") return adminText.dnfReadiness[basis.candidate.readiness];
          const attempt = { kind: "DNF" as const, value: createDidNotFinishAttempt(basis.candidate, basis.candidates) };
          return { attempt, show: () => setDnfAttempt(attempt) };
        }
        const row = withdrawable(basis.withdrawalRows);
        if (!row) return text.notAvailable;
        const attempt = { kind: "DNF_WITHDRAWAL" as const, value: createDidNotFinishWithdrawalAttempt(row, basis.withdrawals) };
        return { attempt, show: () => setDnfAttempt(attempt) };
      }
      case "DNS": case "DNS_WITHDRAWAL": {
        const basis = await readDnsBasis(op, id);
        if (choice === "DNS") {
          if (basis.candidate.readiness !== "READY") return adminText.dnsHasResult;
          const attempt = { kind: "DNS" as const, value: createDidNotStartAttempt(basis.candidate, basis.candidates) };
          return { attempt, show: () => setDnsAttempt(attempt) };
        }
        const row = withdrawable(basis.withdrawalRows);
        if (!row) return text.notAvailable;
        const attempt = { kind: "DNS_WITHDRAWAL" as const, value: createDidNotStartWithdrawalAttempt(row, basis.withdrawals) };
        return { attempt, show: () => setDnsAttempt(attempt) };
      }
      case "RECALCULATION": {
        const basis = await readRecalculationBasis(op, id);
        if (basis.candidate.readiness !== "READY") return adminText.recalculationReadiness[basis.candidate.readiness];
        const attempt = { kind: "RECALCULATION" as const, timeZone: basis.roster.timeZone,
          value: createResultRecalculationAttempt(basis.candidate, basis.candidates) };
        return { attempt, show: () => setRecalculationAttempt(attempt) };
      }
    }
  }
  /** Ett val i menyn: läs underlaget och visa beskedet med en bekräftelseknapp. */
  async function chooseStatusChange(choice: StatusChoice | "", selectedId = entryId) {
    if (busyRef.current || pending.current || !requireSession()) return;
    setStatusChoice(choice); setStatusBlocked(""); setMessage("");
    if (!choice || !selectedId || !data) return;
    const op = begin();
    try {
      const prepared = await prepare(op, choice, selectedId);
      if (!current(op)) return;
      if (typeof prepared === "string") { setStatusBlocked(prepared); return; }
      pending.current = prepared.attempt; sent.current = false; prepared.show(); setUnknown(false);
    } catch { if (current(op)) setStatusBlocked(text.loadError); }
    finally { finish(op); }
  }
  async function confirmStatusChange(attempt: StatusAttempt) {
    await submitStatusAttempt(attempt);
    // Sparat eller avvisat: menyn återgår. Ett försök utan svar ligger kvar för ett nytt försök.
    if (pending.current !== attempt) { setStatusChoice(""); setStatusBlocked(""); }
  }
  function cancelStatusChange(attempt: StatusAttempt | undefined) {
    if (attempt) cancelStatusAttempt(attempt);
    if (!pending.current) { setStatusChoice(""); setStatusBlocked(""); }
  }
  return { chooseStatusChange, confirmStatusChange, cancelStatusChange };
}
export type StatusChangeActions = ReturnType<typeof createStatusChangeActions>;
