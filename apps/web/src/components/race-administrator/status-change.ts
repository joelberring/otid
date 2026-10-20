import { useState } from "react";
import type { EntryStatusDecision, EntryStatusReadiness, EntryStatusResponse } from "@o-tid/contracts";
import { createResultRecalculationAttempt } from "../../lib/result-recalculation-admin-client";
import type { StatusChoice } from "../../lib/participant-status-choices";
import { raceAdministratorSv as adminText } from "../../i18n/race-administrator-sv";
import { participantCardSv as text } from "../../i18n/participant-card-sv";
import type { DecisionAttempt, Operation } from "./types";
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
type DecisionChoice = DecisionAttempt["choice"];

/** Menyvalet som beslut i statusflödet (ADR-0173 beslut 1). */
const DECISIONS: Record<DecisionChoice, { decision: EntryStatusDecision; withdraws?: EntryStatusResponse["governingDecision"] }> = {
  DNS: { decision: { kind: "DID_NOT_START" } }, DNF: { decision: { kind: "DID_NOT_FINISH" } },
  DSQ: { decision: { kind: "DISQUALIFIED" } }, OOC: { decision: { kind: "OUT_OF_COMPETITION" } },
  NT: { decision: { kind: "WITHOUT_TIMING" } }, APPROVAL: { decision: { kind: "APPROVE_MANUALLY" } },
  DNS_WITHDRAWAL: { decision: { kind: "WITHDRAW" }, withdraws: "DNS" },
  DNF_WITHDRAWAL: { decision: { kind: "WITHDRAW" }, withdraws: "DNF" },
  DSQ_WITHDRAWAL: { decision: { kind: "WITHDRAW" }, withdraws: "DSQ" },
  OOC_WITHDRAWAL: { decision: { kind: "WITHDRAW" }, withdraws: "OOC" },
  NT_WITHDRAWAL: { decision: { kind: "WITHDRAW" }, withdraws: "NT" },
  APPROVAL_WITHDRAWAL: { decision: { kind: "WITHDRAW" }, withdraws: "APPROVAL" },
  MANUAL_TIME_WITHDRAWAL: { decision: { kind: "WITHDRAW" } },
  CONTROL_APPROVAL_WITHDRAWAL: { decision: { kind: "WITHDRAW" }, withdraws: "CONTROL_APPROVAL" }
};

/** Beskedet när ett beslut inte går att fatta (samma texter som tidigare per beslut). */
function blocked(choice: DecisionChoice, readiness: EntryStatusReadiness): string {
  const texts: Partial<Record<DecisionChoice, Partial<Record<EntryStatusReadiness, string>>>> = {
    APPROVAL: adminText.approvalReadiness, DSQ: adminText.dsqReadiness, NT: adminText.ntReadiness,
    OOC: adminText.oocReadiness, DNF: adminText.dnfReadiness };
  if (choice === "DNS") return adminText.dnsHasResult;
  const own = texts[choice];
  return own?.[readiness] ?? own?.UNSUPPORTED_RESULT ?? text.notAvailable;
}

export function createStatusChangeActions(ws: Base & RaceDataActions & ResultDecisionActions) {
  const { entryId, data, writingRef, pending, sent, requireSession, begin, finish, current, setMessage, setUnknown,
    setStatusChoice, setStatusBlocked, setDecisionAttempt, setRecalculationAttempt, readEntryStatus,
    readRecalculationBasis, submitStatusAttempt, cancelStatusAttempt } = ws;

  /** Läser löparens läge och skapar försöket, eller ger ett besked om varför det inte går. */
  async function prepare(op: Operation, choice: StatusChoice, id: string): Promise<Prepared> {
    if (choice === "RECALCULATION") {
      const basis = await readRecalculationBasis(op, id);
      if (basis.candidate.readiness !== "READY") return adminText.recalculationReadiness[basis.candidate.readiness];
      const attempt = { kind: "RECALCULATION" as const, timeZone: basis.roster.timeZone,
        value: createResultRecalculationAttempt(basis.candidate, basis.candidates) };
      return { attempt, show: () => setRecalculationAttempt(attempt) };
    }
    const status = await readEntryStatus(op, id);
    const { decision, withdraws } = DECISIONS[choice];
    const readiness = status.readiness[decision.kind];
    if (withdraws !== undefined && (status.governingDecision !== withdraws || readiness !== "READY")) return text.notAvailable;
    // Rättad mål- eller starttid och manuell tid tas bort med samma val (steg 31).
    if (choice === "MANUAL_TIME_WITHDRAWAL" && (!["FINISH_TIME", "START_TIME", "MANUAL_TIME"].includes(status.governingDecision) ||
      readiness !== "READY")) return text.notAvailable;
    if (readiness !== "READY") return blocked(choice, readiness);
    const attempt: DecisionAttempt = { kind: "DECISION", choice, entryId: id, restores: status.withdrawRestores,
      request: { formatVersion: 1, requestId: crypto.randomUUID(), expectedRevision: status.headRevision, decision } };
    return { attempt, show: () => setDecisionAttempt(attempt) };
  }
  /** Ett val i menyn: läs underlaget och visa beskedet med en bekräftelseknapp. */
  async function chooseStatusChange(choice: StatusChoice | "", selectedId = entryId) {
    if (writingRef.current || pending.current || !requireSession()) return;
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
  /**
   * Bekräftar beslutet. Disk (PLAN.md steg 25) kan få en orsak; den läggs i beslutet innan det skickas första gången,
   * så att ett omförsök efter uteblivet svar bär exakt samma begäran.
   */
  async function confirmStatusChange(attempt: StatusAttempt, reason = "") {
    let value = attempt;
    if (attempt.kind === "DECISION" && attempt.choice === "DSQ" && pending.current === attempt && !sent.current) {
      const trimmed = reason.trim();
      value = { ...attempt, request: { ...attempt.request, decision: trimmed ? { kind: "DISQUALIFIED", reason: trimmed }
        : { kind: "DISQUALIFIED" } } };
      pending.current = value; setDecisionAttempt(value);
    }
    // Steg 31: "Godkänn manuellt" kräver orsak.
    if (attempt.kind === "DECISION" && attempt.choice === "APPROVAL" && pending.current === attempt && !sent.current) {
      const trimmed = reason.trim();
      if (!trimmed) { setStatusBlocked(text.reasonRequired); return; }
      value = { ...attempt, request: { ...attempt.request, decision: { kind: "APPROVE_MANUALLY", note: trimmed } } };
      pending.current = value; setDecisionAttempt(value);
    }
    await submitStatusAttempt(value);
    // Sparat eller avvisat: menyn återgår. Ett försök utan svar ligger kvar för ett nytt försök.
    if (pending.current !== value) { setStatusChoice(""); setStatusBlocked(""); }
  }
  function cancelStatusChange(attempt: StatusAttempt | undefined) {
    if (attempt) cancelStatusAttempt(attempt);
    if (!pending.current) { setStatusChoice(""); setStatusBlocked(""); }
  }
  return { chooseStatusChange, confirmStatusChange, cancelStatusChange };
}
export type StatusChangeActions = ReturnType<typeof createStatusChangeActions>;
