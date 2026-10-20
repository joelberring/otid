"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { RaceCorrection, RaceCorrectionAction, RaceCorrectionPreviewResponse } from "@o-tid/contracts";
import { raceCorrectionsSv as text } from "../i18n/race-corrections-sv";
import { applyRaceCorrection, fetchRaceCorrections, previewRaceCorrection, type RaceCorrectionFailure } from "../lib/race-corrections-client";
import styles from "./race-administrator-workspace.module.css";

/**
 * Rättningar för hela tävlingen (PLAN.md steg 31): varje åtgärd visas först ("Visa vad som händer": hur många som
 * läst ut, hur många som får ny tid eller status och vilka som byter status) och sparas sedan. Sparandet räknar om alla
 * avlästa. Bara administratören ser panelen; funktionärens vy har den inte.
 */
type Attempt = { preview: RaceCorrectionPreviewResponse; requestId: string; uncertain: boolean };

function failureText(failure: RaceCorrectionFailure, duplicate = false): string {
  return failure === "conflict" ? (duplicate ? text.duplicate : text.conflict) : failure === "invalid" ? text.invalid : text.unreachable;
}

/** Gemensamt flöde: visa, spara (med samma requestId vid omförsök) och kvitto. */
export function useRaceCorrection(raceId: string, onSaved?: () => Promise<void> | void) {
  const [attempt, setAttempt] = useState<Attempt>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState("");
  async function show(correction: RaceCorrectionAction) {
    if (busy) return;
    setBusy(true); setError(""); setSaved("");
    try {
      const result = await previewRaceCorrection(raceId, correction);
      if (result.ok) setAttempt({ preview: result.preview, requestId: crypto.randomUUID(), uncertain: false });
      else setError(failureText(result.failure, correction.action.startsWith("ADD_")));
    } catch { setError(text.unreachable); } finally { setBusy(false); }
  }
  async function confirm(savedText: (count: number) => string = text.saved) {
    if (!attempt || busy) return;
    setBusy(true); setError("");
    try {
      setAttempt({ ...attempt, uncertain: true });
      const result = await applyRaceCorrection(raceId, attempt.preview, attempt.requestId);
      setAttempt(undefined);
      if (!result.ok) { setError(failureText(result.failure)); return; }
      const notRecalculated = result.receipt.summary.notRecalculatedCount;
      // Listan och arbetsytan läses in på nytt innan beskedet visas, så att deltagarkortet visar de nya resultaten.
      await onSaved?.();
      setSaved([savedText(result.receipt.recalculatedCount), notRecalculated > 0 ? text.notRecalculated(notRecalculated) : ""]
        .filter(Boolean).join(" "));
    } catch { setError(text.unreachable); } finally { setBusy(false); }
  }
  function cancel() { setAttempt(undefined); setError(""); }
  return { attempt, busy, error, saved, show, confirm, cancel };
}

/** Förhandsbeskedet med bekräftelse. `extra` visar åtgärdens egna uppgifter (t.ex. nya starttider). */
export function RaceCorrectionReview({ flow, title, extra, savedText }: { flow: ReturnType<typeof useRaceCorrection>; title: string;
  extra?: ReactNode; savedText?: (count: number) => string }) {
  const { attempt, busy } = flow;
  if (!attempt) return null;
  const summary = attempt.preview.summary;
  return <section className={styles.review} role="alert" aria-live="polite" aria-label={title}>
    <h3>{title}</h3>
    {extra}
    <p>{text.readOut(summary.readOutCount)} {text.affected(summary.affectedCount)}</p>
    {summary.changes.length === 0 ? <p>{text.noStatusChanges}</p> : <>
      <p><strong>{text.statusChanges}:</strong></p>
      <ul className={styles.followUpList}>{summary.changes.map(change => <li key={change.entryId}>
        {change.displayName} ({change.className}): {text.status[change.before]} → {text.status[change.after]}</li>)}</ul>
    </>}
    {summary.notRecalculatedCount > 0 && <p className={styles.warning}>{text.notRecalculated(summary.notRecalculatedCount)}</p>}
    {!attempt.uncertain && <p>{text.notSaved}</p>}
    <div className={styles.actions}>
      <button type="button" disabled={busy} onClick={() => void flow.confirm(savedText)}>{attempt.uncertain ? text.retry : text.confirm}</button>
      {!attempt.uncertain && <button type="button" className="secondary" disabled={busy} onClick={flow.cancel}>{text.cancel}</button>}
    </div>
  </section>;
}

export function RaceCorrectionMessages({ flow }: { flow: ReturnType<typeof useRaceCorrection> }) {
  return <>{flow.error && <p className={styles.warning} role="alert">{flow.error}</p>}{flow.saved && <p role="status">{flow.saved}</p>}</>;
}

function correctionLabel(row: RaceCorrection): string {
  return row.kind === "TIME_ADJUSTMENT" ? text.adjustmentLabel(row.station, row.controlCode, row.offsetMs ?? 0) : text.outLabel(row.controlCode);
}

/** "Justera tid för en station". */
function TimeAdjustmentForm({ raceId, onSaved }: { raceId: string; onSaved: () => Promise<void> }) {
  const flow = useRaceCorrection(raceId, onSaved);
  const [station, setStation] = useState<"START" | "FINISH" | "CONTROL">("FINISH");
  const [code, setCode] = useState(""), [sign, setSign] = useState<"-" | "+">("-");
  const [minutes, setMinutes] = useState(""), [seconds, setSeconds] = useState(""), [reason, setReason] = useState("");
  const offsetSeconds = (sign === "-" ? -1 : 1) * ((Number(minutes) || 0) * 60 + (Number(seconds) || 0));
  const controlCode = Number(code);
  const valid = offsetSeconds !== 0 && Math.abs(offsetSeconds) <= 86_400 && reason.trim().length > 0 &&
    (station !== "CONTROL" || (Number.isInteger(controlCode) && controlCode >= 1 && controlCode <= 9999));
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    void flow.show({ action: "ADD_TIME_ADJUSTMENT", station, ...(station === "CONTROL" ? { controlCode } : {}), offsetSeconds,
      reason: reason.trim() });
  }
  const locked = flow.busy || !!flow.attempt;
  const [open, setOpen] = useState(false);
  return <details className={styles.disclosure} open={open || !!flow.attempt} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{text.timeTitle}</summary>
    <form className={styles.disclosureBody} onSubmit={submit}>
      <p>{text.timeHelp}</p>
      <div className={styles.toolbarRow}>
        <label>{text.station}<select value={station} disabled={locked} onChange={event => setStation(event.target.value as typeof station)}>
          {(["START", "FINISH", "CONTROL"] as const).map(value => <option key={value} value={value}>{text.stations[value]}</option>)}
        </select></label>
        {station === "CONTROL" && <label>{text.controlCode}<input type="text" inputMode="numeric" value={code} disabled={locked}
          onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 4))} required /></label>}
      </div>
      <div className={styles.toolbarRow}>
        <label>{text.direction}<select value={sign} disabled={locked} onChange={event => setSign(event.target.value as "-" | "+")}>
          <option value="-">{text.earlier}</option><option value="+">{text.later}</option>
        </select></label>
        <label>{text.minutes}<input type="text" inputMode="numeric" value={minutes} disabled={locked}
          onChange={event => setMinutes(event.target.value.replace(/\D/g, "").slice(0, 4))} /></label>
        <label>{text.seconds}<input type="text" inputMode="numeric" value={seconds} disabled={locked}
          onChange={event => setSeconds(event.target.value.replace(/\D/g, "").slice(0, 2))} /></label>
      </div>
      <label>{text.reason}<input type="text" maxLength={500} value={reason} placeholder={text.reasonPlaceholder} disabled={locked}
        onChange={event => setReason(event.target.value)} required /></label>
      {!flow.attempt && <button type="submit" disabled={!valid || flow.busy}>{text.show}</button>}
      <RaceCorrectionReview flow={flow} title={`${text.timeTitle}: ${text.adjustmentLabel(station, station === "CONTROL" ? controlCode : null,
        offsetSeconds * 1000)}`} />
      <RaceCorrectionMessages flow={flow} />
    </form>
  </details>;
}

/** "Kontroll ur funktion": koden krävs inte på någon bana. */
function OutOfOrderForm({ raceId, onSaved }: { raceId: string; onSaved: () => Promise<void> }) {
  const flow = useRaceCorrection(raceId, onSaved);
  const [code, setCode] = useState(""), [reason, setReason] = useState(""), [open, setOpen] = useState(false);
  const controlCode = Number(code);
  const valid = Number.isInteger(controlCode) && controlCode >= 1 && controlCode <= 9999 && reason.trim().length > 0;
  const locked = flow.busy || !!flow.attempt;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) void flow.show({ action: "ADD_CONTROL_OUT_OF_ORDER", controlCode, reason: reason.trim() });
  }
  return <details className={styles.disclosure} open={open || !!flow.attempt} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{text.outTitle}</summary>
    <form className={styles.disclosureBody} onSubmit={submit}>
      <p>{text.outHelp}</p>
      <label>{text.controlCode}<input type="text" inputMode="numeric" value={code} disabled={locked}
        onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 4))} required /></label>
      <label>{text.reason}<input type="text" maxLength={500} value={reason} placeholder={text.outReasonPlaceholder} disabled={locked}
        onChange={event => setReason(event.target.value)} required /></label>
      {!flow.attempt && <button type="submit" disabled={!valid || flow.busy}>{text.show}</button>}
      <RaceCorrectionReview flow={flow} title={`${text.outTitle}: ${text.outLabel(controlCode)}`} />
      <RaceCorrectionMessages flow={flow} />
    </form>
  </details>;
}

/** Aktiva rättningar med "Ta bort" (räknar om tillbaka) och de borttagna som historik. */
function CorrectionList({ raceId, corrections, onSaved }: { raceId: string; corrections: readonly RaceCorrection[]; onSaved: () => Promise<void> }) {
  const flow = useRaceCorrection(raceId, onSaved);
  const [removing, setRemoving] = useState<RaceCorrection>();
  const active = corrections.filter(row => row.removedAt === null), removed = corrections.filter(row => row.removedAt !== null);
  return <div className={styles.disclosureBody}>
    <h3>{text.active}</h3>
    {active.length === 0 ? <p>{text.none}</p> : <ul className={styles.followUpList}>{active.map(row => <li key={row.id}>
      <span><strong>{correctionLabel(row)}</strong> · {row.reason}</span>{" "}
      <button type="button" className="secondary" disabled={flow.busy || !!flow.attempt}
        onClick={() => { setRemoving(row); void flow.show({ action: "REMOVE", correctionId: row.id }); }}>{text.remove}</button>
    </li>)}</ul>}
    {removing && <RaceCorrectionReview flow={flow} title={text.removeReview(correctionLabel(removing))} />}
    <RaceCorrectionMessages flow={flow} />
    {removed.length > 0 && <details className={styles.disclosure}><summary>{text.history} ({removed.length})</summary>
      <ul className={styles.followUpList}>{removed.map(row => <li key={row.id}>{correctionLabel(row)} · {row.reason}</li>)}</ul>
    </details>}
  </div>;
}

export function RaceCorrectionsPanel({ raceId, onChanged }: { raceId: string; onChanged?: () => Promise<void> }) {
  const [corrections, setCorrections] = useState<readonly RaceCorrection[]>();
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setCorrections((await fetchRaceCorrections(raceId)).corrections); setError(""); } catch { setError(text.loadError); }
  }, [raceId]);
  useEffect(() => { void load(); }, [load]);
  const onSaved = async () => { await Promise.all([load(), onChanged?.()]); };
  return <div className={styles.disclosureList}>
    <TimeAdjustmentForm raceId={raceId} onSaved={onSaved} />
    <OutOfOrderForm raceId={raceId} onSaved={onSaved} />
    {error && <p className={styles.warning} role="alert">{error}</p>}
    {corrections && <CorrectionList raceId={raceId} corrections={corrections} onSaved={onSaved} />}
  </div>;
}
