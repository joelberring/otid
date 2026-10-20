"use client";

import { useEffect, useState } from "react";
import type { ReadoutRereadItem, ReadoutRereadPreviewResponse } from "@o-tid/contracts";
import { readoutRereadSv as text } from "../i18n/readout-reread-sv";
import { applyReadoutReread, previewReadoutReread, type ReadoutRereadFailure } from "../lib/readout-reread-client";
import styles from "./race-administrator-workspace.module.css";

/**
 * Läs om avläsningar från rådata (PLAN.md steg 36): "Visa vad som händer" listar avläsningarna som blir andra vid
 * omläsning (och de som inte går att läsa om), "Spara och räkna om" sparar de valda. Samma flöde för hela tävlingen
 * (Avläsning, bara administratören) och för en deltagare (deltagarkortet).
 */
type Attempt = { preview: ReadoutRereadPreviewResponse; chosen: ReadonlySet<string>; requestId: string; uncertain: boolean };
const key = (item: ReadoutRereadItem) => `${item.readoutId}:${item.entryId}`;

function failureText(failure: ReadoutRereadFailure): string {
  return failure === "conflict" ? text.conflict : failure === "invalid" ? text.invalid : text.unreachable;
}

export function useReadoutReread(raceId: string, onSaved?: () => Promise<void> | void) {
  const [attempt, setAttempt] = useState<Attempt>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState("");
  async function show(entryId?: string) {
    if (busy) return;
    setBusy(true); setError(""); setSaved("");
    try {
      const result = await previewReadoutReread(raceId, entryId);
      if (result.ok) setAttempt({ preview: result.preview, chosen: new Set(result.preview.items.map(key)), requestId: crypto.randomUUID(),
        uncertain: false });
      else setError(failureText(result.failure));
    } catch { setError(text.unreachable); } finally { setBusy(false); }
  }
  function toggle(item: ReadoutRereadItem, on: boolean) {
    if (!attempt || attempt.uncertain) return;
    const chosen = new Set(attempt.chosen);
    if (on) chosen.add(key(item)); else chosen.delete(key(item));
    setAttempt({ ...attempt, chosen });
  }
  async function confirm() {
    if (!attempt || busy) return;
    const items = attempt.preview.items.filter((item) => attempt.chosen.has(key(item)));
    if (items.length === 0) { setError(text.noneChosen); return; }
    setBusy(true); setError("");
    try {
      setAttempt({ ...attempt, uncertain: true });
      const result = await applyReadoutReread(raceId, items, attempt.requestId);
      setAttempt(undefined);
      if (!result.ok) { setError(failureText(result.failure)); return; }
      await onSaved?.();
      setSaved(text.saved(result.receipt.saved.length));
    } catch { setError(text.unreachable); } finally { setBusy(false); }
  }
  function cancel() { setAttempt(undefined); setError(""); }
  return { attempt, busy, error, saved, show, toggle, confirm, cancel };
}

type Flow = ReturnType<typeof useReadoutReread>;

function Change({ item }: { item: ReadoutRereadItem }) {
  return <>
    <span>{text.card(item.cardNumber)} · {item.displayName} ({item.className}):{" "}
      {text.side(item.before.punchCount, item.before.status, item.before.elapsedMs)} →{" "}
      <strong>{text.side(item.after.punchCount, item.after.status, item.after.elapsedMs)}</strong></span>
    {item.manualDecision && <span className={styles.warning} role="note">{text.manual(item.manualDecision)}</span>}
  </>;
}

/** Förhandsbeskedet: ändrade avläsningar med val, de som inte går att läsa om, och bekräftelse. */
export function ReadoutRereadReview({ flow, title, single = false }: { flow: Flow; title: string; single?: boolean }) {
  const { attempt, busy } = flow;
  if (!attempt) return null;
  const { preview } = attempt;
  return <section className={styles.review} role="alert" aria-live="polite" aria-label={title}>
    <h3>{title}</h3>
    {!single && <p>{text.checked(preview.checkedCount)}</p>}
    {preview.items.length === 0 ? <p>{text.noChanges}</p> : <>
      {!single && <p><strong>{text.changes(preview.items.length)}</strong></p>}
      <ul className={styles.changeList} data-testid="reread-items">{preview.items.map((item) => <li key={key(item)}>
        {single ? <Change item={item} /> : <label className={styles.check}>
          <input type="checkbox" checked={attempt.chosen.has(key(item))} disabled={busy || attempt.uncertain}
            onChange={(event) => flow.toggle(item, event.target.checked)} />
          <Change item={item} />
        </label>}
      </li>)}</ul>
    </>}
    {preview.unreadable.length > 0 && <>
      <p><strong>{text.unreadableTitle}:</strong></p>
      <ul className={styles.changeList} data-testid="reread-unreadable">{preview.unreadable.map((row) => <li key={`${row.readoutId}:${row.entryId}`}>
        {text.unreadable(row.cardNumber, row.displayName, `${text.unreadableReasons[row.reason]} (${row.detail})`)}</li>)}</ul>
    </>}
    {!attempt.uncertain && preview.items.length > 0 && <p>{text.notSaved}</p>}
    <div className={styles.actions}>
      {preview.items.length > 0 && <button type="button" disabled={busy || attempt.chosen.size === 0} onClick={() => void flow.confirm()}>
        {attempt.uncertain ? text.retry : text.confirm}</button>}
      {!attempt.uncertain && <button type="button" className="secondary" disabled={busy} onClick={flow.cancel}>{text.cancel}</button>}
    </div>
  </section>;
}

function Messages({ flow }: { flow: Flow }) {
  return <>{flow.error && <p className={styles.warning} role="alert">{flow.error}</p>}{flow.saved && <p role="status">{flow.saved}</p>}</>;
}

/** Avläsning → "Läs om avläsningar från rådata" för hela tävlingen. */
export function ReadoutRereadPanel({ raceId, onChanged }: { raceId: string; onChanged: () => Promise<void> | void }) {
  const flow = useReadoutReread(raceId, onChanged);
  return <div className={styles.disclosureBody}>
    <p className={styles.workflowHelp}>{text.help}</p>
    {!flow.attempt && <div className={styles.actions}>
      <button type="button" disabled={flow.busy} onClick={() => void flow.show()}>{text.show}</button>
    </div>}
    <ReadoutRereadReview flow={flow} title={text.title} />
    <Messages flow={flow} />
  </div>;
}

/**
 * Deltagarkortet: blir deltagarens avläsning annorlunda vid omläsning visas en rad med "Läs om" (samma flöde). Prövas när
 * kortet visas och när resultatet ändras (`refreshKey`).
 */
export function ParticipantReadoutReread({ raceId, entryId, active, refreshKey, disabled, onChanged }: { raceId: string;
  entryId: string; active: boolean; refreshKey: string; disabled: boolean; onChanged: () => Promise<void> | void }) {
  const flow = useReadoutReread(raceId, onChanged);
  const [item, setItem] = useState<ReadoutRereadItem>();
  useEffect(() => {
    let current = true;
    setItem(undefined);
    if (!active) return;
    previewReadoutReread(raceId, entryId).then((result) => {
      if (current && result.ok) setItem(result.preview.items.find((row) => row.entryId === entryId));
    }).catch(() => { /* Raden är ett erbjudande; utan svar visas den inte (deltagarkortet fungerar ändå). */ });
    return () => { current = false; };
  }, [raceId, entryId, active, refreshKey]);
  if (!item && !flow.attempt && !flow.error && !flow.saved) return null;
  return <section className={styles.workspace} aria-label={text.cardRow} data-testid="participant-reread">
    {item && !flow.attempt && <div className={styles.toolbarRow}>
      <p><strong>{text.cardRow}</strong></p>
      <button type="button" className="secondary" disabled={disabled || flow.busy} onClick={() => void flow.show(entryId)}>{text.choose}</button>
    </div>}
    <ReadoutRereadReview flow={flow} title={text.cardReview} single />
    <Messages flow={flow} />
  </section>;
}
