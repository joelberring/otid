"use client";

import { useEffect, useState, type FormEvent, type SyntheticEvent } from "react";
import type { EntryStatusRequest, EntryStatusResponse } from "@o-tid/contracts";
import { raceAdministratorSv as text } from "../i18n/race-administrator-sv";
import { formatClockTime, parseRaceClockNear, zonedDate } from "../lib/clock-time";
import { entryStatusRequest, fetchEntryStatus, postEntryStatus } from "../lib/entry-status-client";
import { sv } from "../i18n/sv";
import styles from "./race-administrator-workspace.module.css";

/**
 * Ändrad mål- eller starttid och borttagning av ändringen (ADR-0173 beslut 1). Alla fyra går genom löparens
 * statusflöde: läget läses, arbetsytan visar vad som ändras och arrangören bekräftar.
 */
type Entry = { id: string; displayName: string };
type Props = { raceId: string; entries: readonly Entry[]; timeZone: string; onPendingChange?: (pending: boolean) => void };
type Timing = NonNullable<EntryStatusResponse["timing"]>;
type Candidate = { status: EntryStatusResponse; timing: Timing };
type Attempt = { candidate: Candidate; request: EntryStatusRequest; time: string };

function duration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}.${String(milliseconds % 1_000).padStart(3, "0")}`;
}

/**
 * Klockslaget hör till den avlästa tiden, i tävlingens tidszon: samma dag, eller dagen efter när tiden är strax efter
 * midnatt (steg 58, ADR-0178).
 */
function inputInstant(reference: string, clock: string, timeZone: string): string | null {
  return parseRaceClockNear(zonedDate(reference, timeZone), clock, timeZone, reference);
}

/** Gemensamt för alla fyra: vald löpare, läsning, försök, kvitto och att arbetsytan vet att något pågår. */
function useCorrection(props: Props) {
  const [entryId, setEntryId] = useState(""), [candidate, setCandidate] = useState<Candidate>();
  const [acknowledged, setAcknowledged] = useState(false), [attempt, setAttempt] = useState<Attempt>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState("");
  const [outcomeUncertain, setOutcomeUncertain] = useState(false), [isOpen, setIsOpen] = useState(false);
  const pending = busy || Boolean(candidate) || Boolean(attempt);
  const { onPendingChange } = props;
  useEffect(() => { onPendingChange?.(pending); }, [onPendingChange, pending]);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);
  function clear() { setCandidate(undefined); setAttempt(undefined); setAcknowledged(false); }
  async function load(select: (status: EntryStatusResponse) => Timing | null, loadError: string) {
    if (!entryId || busy) return;
    setBusy(true); setError(""); setSaved(""); clear();
    try {
      const status = await fetchEntryStatus(props.raceId, entryId);
      const timing = select(status);
      if (!timing) throw new Error("unavailable");
      setCandidate({ status, timing });
    } catch { setError(loadError); } finally { setBusy(false); }
  }
  async function commit(savedText: string, conflictText: string, onDone: () => void) {
    if (!attempt || busy) return;
    setBusy(true); setError("");
    try {
      setOutcomeUncertain(true);
      const result = await postEntryStatus(props.raceId, attempt.candidate.status.entryId, attempt.request);
      setOutcomeUncertain(false);
      clear(); onDone();
      if (result.status === "conflict") setError(conflictText); else setSaved(savedText);
    } catch { setError(text.unreachable); } finally { setBusy(false); }
  }
  const disclosure = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (pending && !event.currentTarget.open) event.currentTarget.open = true;
    else if (!pending) setIsOpen(event.currentTarget.open);
  };
  const participant = <label>{text.finishTimeCorrectionParticipant}<select value={entryId} disabled={busy || !!attempt}
    onChange={(event) => { setEntryId(event.target.value); clear(); setError(""); setSaved(""); }}>
    <option value="">{text.chooseEntry}</option>{props.entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}
  </select></label>;
  const messages = <>{error && <p className={styles.warning} role="alert">{error}</p>}{saved && <p role="status">{saved}</p>}</>;
  return { entryId, candidate, setCandidate, acknowledged, setAcknowledged, attempt, setAttempt, busy, error, setError, saved,
    setSaved, outcomeUncertain, open: isOpen || pending, disclosure, clear, load, commit, participant, messages };
}

export function ManualFinishTimeCorrection(props: Props) {
  const c = useCorrection(props);
  const [finishLocal, setFinishLocal] = useState("");
  const { timeZone } = props;
  function inspect(event: FormEvent) {
    event.preventDefault();
    if (!c.candidate || c.busy || !c.acknowledged) return;
    const source = c.candidate.timing;
    const finishTime = inputInstant(source.finishTime, finishLocal, timeZone);
    if (!finishTime || Date.parse(finishTime) === Date.parse(source.finishTime) || Date.parse(finishTime) <= Date.parse(source.startTime) ||
        (source.latestMatchedSplitElapsedMs !== null && Date.parse(finishTime) - Date.parse(source.startTime) < source.latestMatchedSplitElapsedMs)) {
      c.setError(text.finishTimeCorrectionInvalid); return;
    }
    c.setAttempt({ candidate: c.candidate, time: finishTime,
      request: entryStatusRequest(c.candidate.status, { kind: "FINISH_TIME", finishTime }) });
    c.setError(""); c.setSaved("");
  }
  const candidate = c.candidate, source = candidate?.timing, attempt = c.attempt;
  const newElapsed = attempt ? Date.parse(attempt.time) - Date.parse(attempt.candidate.timing.startTime) : undefined;
  return <details className={styles.disclosure} open={c.open} onToggle={c.disclosure}>
    <summary>{text.finishTimeCorrectionTitle}</summary>
    <form className={styles.disclosureBody} onSubmit={inspect}>
      <p>{text.finishTimeCorrectionHelp}</p>
      {c.participant}
      {!candidate && !attempt && <button type="button" disabled={!c.entryId || c.busy} onClick={() => {
        setFinishLocal("");
        void c.load((status) => status.readiness.FINISH_TIME === "READY" ? status.timing : null, text.finishTimeCorrectionLoadError);
      }}>{text.finishTimeCorrectionLoad}</button>}
      {candidate && source && !attempt && <>
        <div className={styles.summaryBox}>
          <p><strong>{candidate.status.entryName}</strong> · {candidate.status.className}</p>
          <p><strong>{text.finishTimeCorrectionSource}:</strong> {sv.publicResultsStatusLabels[source.status]}</p>
          <p><strong>{text.finishTimeCorrectionStart}:</strong> {formatClockTime(source.startTime, timeZone)}</p>
          <p><strong>{text.finishTimeCorrectionFinish}:</strong> {formatClockTime(source.finishTime, timeZone)} · <strong>{text.finishTimeCorrectionElapsed}:</strong> {duration(source.elapsedMs)}</p>
          <p><strong>{text.finishTimeCorrectionLastSplit}:</strong> {source.latestMatchedSplitElapsedMs === null ? text.finishTimeCorrectionNoSplit : duration(source.latestMatchedSplitElapsedMs)}</p>
        </div>
        <label>{text.finishTimeCorrectionNewFinish}<input type="text" inputMode="numeric" autoComplete="off" placeholder="19:42:05" value={finishLocal} disabled={c.busy}
          onChange={(event) => setFinishLocal(event.target.value)} required /></label>
        <p>{text.finishTimeCorrectionTimeHelp}</p>
        <label className={styles.confirmPerson}><input type="checkbox" checked={c.acknowledged} disabled={c.busy}
          onChange={(event) => c.setAcknowledged(event.target.checked)} />{text.finishTimeCorrectionAcknowledge}</label>
        <button type="submit" disabled={!finishLocal || !c.acknowledged || c.busy}>{text.finishTimeCorrectionInspect}</button>
        <button type="button" className="secondary" disabled={c.busy} onClick={() => { c.clear(); setFinishLocal(""); c.setError(""); }}>{text.cancel}</button>
      </>}
      {attempt && <section className={styles.review} role="alert" aria-live="polite">
        <h2>{text.finishTimeCorrectionReview}</h2>
        <p><strong>{attempt.candidate.status.entryName}</strong> · {attempt.candidate.status.className}</p>
        <p><strong>{text.finishTimeCorrectionFinish}:</strong> {formatClockTime(attempt.candidate.timing.finishTime, timeZone)} → {formatClockTime(attempt.time, timeZone)}</p>
        <p><strong>{text.finishTimeCorrectionElapsed}:</strong> {duration(attempt.candidate.timing.elapsedMs)} → {newElapsed === undefined ? "–" : duration(newElapsed)}</p>
        {!c.outcomeUncertain && <p>{text.finishTimeCorrectionNotSaved}</p>}
        <div className={styles.actions}><button type="button" disabled={c.busy}
          onClick={() => void c.commit(text.finishTimeCorrectionSaved, text.finishTimeCorrectionConflict, () => setFinishLocal(""))}>{text.finishTimeCorrectionConfirm}</button>
          {!c.outcomeUncertain && <button type="button" className="secondary" disabled={c.busy} onClick={() => c.setAttempt(undefined)}>{text.finishTimeCorrectionCancel}</button>}</div>
      </section>}
      {c.messages}
    </form>
  </details>;
}

export function ManualPunchStartTimeCorrection(props: Props) {
  const c = useCorrection(props);
  const [startLocal, setStartLocal] = useState("");
  const { timeZone } = props;
  function inspect(event: FormEvent) {
    event.preventDefault();
    if (!c.candidate || c.busy || !c.acknowledged) return;
    const source = c.candidate.timing;
    const startTime = inputInstant(source.startTime, startLocal, timeZone);
    const absoluteSplits = source.splits.map((split) => Date.parse(source.startTime) + split.elapsedMs);
    if (!startTime || Date.parse(startTime) === Date.parse(source.startTime) ||
      Date.parse(startTime) >= Date.parse(source.finishTime) || absoluteSplits.some((value) => Date.parse(startTime) > value)) {
      c.setError(text.punchStartTimeCorrectionInvalid); return;
    }
    c.setAttempt({ candidate: c.candidate, time: startTime, request: entryStatusRequest(c.candidate.status, { kind: "START_TIME", startTime }) });
    c.setError(""); c.setSaved("");
  }
  const candidate = c.candidate, source = candidate?.timing, attempt = c.attempt;
  const newElapsed = attempt ? Date.parse(attempt.candidate.timing.finishTime) - Date.parse(attempt.time) : undefined;
  const firstControl = source?.splits[0];
  return <details className={styles.disclosure} open={c.open} onToggle={c.disclosure}>
    <summary>{text.punchStartTimeCorrectionTitle}</summary><form className={styles.disclosureBody} onSubmit={inspect}>
      <p>{text.punchStartTimeCorrectionHelp}</p>{c.participant}
      {!candidate && !attempt && <button type="button" disabled={!c.entryId || c.busy} onClick={() => {
        setStartLocal("");
        void c.load((status) => status.readiness.START_TIME === "READY" ? status.timing : null, text.punchStartTimeCorrectionLoadError);
      }}>{text.punchStartTimeCorrectionLoad}</button>}
      {candidate && source && !attempt && <><div className={styles.summaryBox}><p><strong>{candidate.status.entryName}</strong> · {candidate.status.className}</p>
        <p><strong>{text.finishTimeCorrectionSource}:</strong> {sv.publicResultsStatusLabels[source.status]}</p>
        <p><strong>{text.finishTimeCorrectionStart}:</strong> {formatClockTime(source.startTime, timeZone)} · <strong>{text.finishTimeCorrectionFinish}:</strong> {formatClockTime(source.finishTime, timeZone)}</p>
        <p><strong>{text.finishTimeCorrectionElapsed}:</strong> {duration(source.elapsedMs)} · <strong>{text.punchStartTimeCorrectionFirstControl}:</strong> {firstControl ? `${firstControl.controlCode} · ${duration(firstControl.elapsedMs)}` : text.finishTimeCorrectionNoSplit}</p></div>
        <label>{text.punchStartTimeCorrectionNewStart}<input type="text" inputMode="numeric" autoComplete="off" placeholder="19:42:05" value={startLocal} disabled={c.busy} onChange={(event) => setStartLocal(event.target.value)} required /></label>
        <p>{text.punchStartTimeCorrectionTimeHelp}</p><label className={styles.confirmPerson}><input type="checkbox" checked={c.acknowledged} disabled={c.busy} onChange={(event) => c.setAcknowledged(event.target.checked)} />{text.punchStartTimeCorrectionAcknowledge}</label>
        <button type="submit" disabled={!startLocal || !c.acknowledged || c.busy}>{text.punchStartTimeCorrectionInspect}</button>
        <button type="button" className="secondary" disabled={c.busy} onClick={() => { c.clear(); setStartLocal(""); c.setError(""); }}>{text.cancel}</button></>}
      {attempt && <section className={styles.review} role="alert" aria-live="polite"><h2>{text.punchStartTimeCorrectionReview}</h2><p><strong>{attempt.candidate.status.entryName}</strong> · {attempt.candidate.status.className}</p>
        <p><strong>{text.finishTimeCorrectionStart}:</strong> {formatClockTime(attempt.candidate.timing.startTime, timeZone)} → {formatClockTime(attempt.time, timeZone)}</p>
        <p><strong>{text.finishTimeCorrectionElapsed}:</strong> {duration(attempt.candidate.timing.elapsedMs)} → {newElapsed === undefined ? "–" : duration(newElapsed)}</p>{!c.outcomeUncertain && <p>{text.finishTimeCorrectionNotSaved}</p>}
        <div className={styles.actions}><button type="button" disabled={c.busy}
          onClick={() => void c.commit(text.punchStartTimeCorrectionSaved, text.punchStartTimeCorrectionConflict, () => setStartLocal(""))}>{text.punchStartTimeCorrectionConfirm}</button>
          {!c.outcomeUncertain && <button type="button" className="secondary" disabled={c.busy} onClick={() => c.setAttempt(undefined)}>{text.finishTimeCorrectionCancel}</button>}</div></section>}
      {c.messages}
    </form></details>;
}

type WithdrawalText = { title: string; help: string; load: string; loadError: string; source: string; corrected: string; restored: string;
  acknowledge: string; inspect: string; review: string; confirmText: string; confirm: string; saved: string; conflict: string };

/** Tar bort en ändrad mål- eller starttid: löparen får tillbaka tiden från avläsningen. */
function ManualTimeCorrectionWithdrawal({ field, labels, ...props }: Props & { field: "finishTime" | "startTime"; labels: WithdrawalText }) {
  const c = useCorrection(props);
  const governing = field === "finishTime" ? "FINISH_TIME" : "START_TIME";
  const { timeZone } = props;
  const candidate = c.candidate, attempt = c.attempt;
  const restored = candidate?.status.withdrawTiming;
  function inspect() {
    if (!c.candidate || !c.acknowledged || c.busy || !c.candidate.status.withdrawTiming) return;
    c.setAttempt({ candidate: c.candidate, time: c.candidate.status.withdrawTiming[field],
      request: entryStatusRequest(c.candidate.status, { kind: "WITHDRAW" }) });
    c.setError(""); c.setSaved("");
  }
  return <details className={styles.disclosure} open={c.open} onToggle={c.disclosure}><summary>{labels.title}</summary>
    <section className={styles.disclosureBody}>
      <p>{labels.help}</p>{c.participant}
      {!candidate && !attempt && <button type="button" disabled={!c.entryId || c.busy} onClick={() => void c.load((status) =>
        status.governingDecision === governing && status.readiness.WITHDRAW === "READY" && status.withdrawTiming ? status.timing : null,
        labels.loadError)}>{labels.load}</button>}
      {candidate && restored && !attempt && <><div className={styles.summaryBox}><p><strong>{candidate.status.entryName}</strong> · {candidate.status.className}</p>
        <p><strong>{labels.source}:</strong> {formatClockTime(restored[field], timeZone)}</p>
        <p><strong>{labels.corrected}:</strong> {formatClockTime(candidate.timing[field], timeZone)}</p>
        <p><strong>{labels.restored}:</strong> {formatClockTime(restored[field], timeZone)}</p></div>
        <label className={styles.confirmPerson}><input type="checkbox" checked={c.acknowledged} disabled={c.busy} onChange={(event) => c.setAcknowledged(event.target.checked)} />{labels.acknowledge}</label>
        <button type="button" disabled={!c.acknowledged || c.busy} onClick={inspect}>{labels.inspect}</button>
        <button type="button" className="secondary" disabled={c.busy} onClick={() => { c.clear(); c.setError(""); }}>{text.cancel}</button></>}
      {attempt && <section className={styles.review} role="alert" aria-live="polite"><h2>{labels.review}</h2>
        <p>{labels.confirmText}</p><p><strong>{labels.corrected}:</strong> {formatClockTime(attempt.candidate.timing[field], timeZone)} → {formatClockTime(attempt.time, timeZone)}</p>
        <div className={styles.actions}><button type="button" disabled={c.busy} onClick={() => void c.commit(labels.saved, labels.conflict, () => undefined)}>{labels.confirm}</button>
          {!c.outcomeUncertain && <><button type="button" className="secondary" disabled={c.busy} onClick={() => c.setAttempt(undefined)}>{text.finishTimeCorrectionCancel}</button>
            <button type="button" className="secondary" disabled={c.busy} onClick={() => c.clear()}>{text.cancel}</button></>}</div></section>}
      {c.messages}
    </section></details>;
}

export function ManualFinishTimeCorrectionWithdrawal(props: Props) {
  return <ManualTimeCorrectionWithdrawal {...props} field="finishTime" labels={{ title: text.finishTimeCorrectionWithdrawalTitle,
    help: text.finishTimeCorrectionWithdrawalHelp, load: text.finishTimeCorrectionWithdrawalLoad,
    loadError: text.finishTimeCorrectionWithdrawalLoadError, source: text.finishTimeCorrectionWithdrawalSource,
    corrected: text.finishTimeCorrectionWithdrawalCorrected, restored: text.finishTimeCorrectionWithdrawalRestored,
    acknowledge: text.finishTimeCorrectionWithdrawalAcknowledge, inspect: text.finishTimeCorrectionWithdrawalInspect,
    review: text.finishTimeCorrectionWithdrawalReview, confirmText: text.finishTimeCorrectionWithdrawalConfirmText,
    confirm: text.finishTimeCorrectionWithdrawalConfirm, saved: text.finishTimeCorrectionWithdrawalSaved,
    conflict: text.finishTimeCorrectionWithdrawalConflict }} />;
}

export function ManualPunchStartTimeCorrectionWithdrawal(props: Props) {
  return <ManualTimeCorrectionWithdrawal {...props} field="startTime" labels={{ title: text.punchStartTimeCorrectionWithdrawalTitle,
    help: text.punchStartTimeCorrectionWithdrawalHelp, load: text.punchStartTimeCorrectionWithdrawalLoad,
    loadError: text.punchStartTimeCorrectionWithdrawalLoadError, source: text.punchStartTimeCorrectionWithdrawalSource,
    corrected: text.punchStartTimeCorrectionWithdrawalCorrected, restored: text.punchStartTimeCorrectionWithdrawalRestored,
    acknowledge: text.punchStartTimeCorrectionWithdrawalAcknowledge, inspect: text.punchStartTimeCorrectionWithdrawalInspect,
    review: text.punchStartTimeCorrectionWithdrawalReview, confirmText: text.punchStartTimeCorrectionWithdrawalConfirmText,
    confirm: text.punchStartTimeCorrectionWithdrawalConfirm, saved: text.punchStartTimeCorrectionWithdrawalSaved,
    conflict: text.punchStartTimeCorrectionWithdrawalConflict }} />;
}
