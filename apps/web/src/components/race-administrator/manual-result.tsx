"use client";

import { useState } from "react";
import {
  entryStatusReceiptSchema, type AdministratorEffectiveResultResponse, type EntryStatusDecision, type EntryStatusRequest,
  type EntryStatusResponse
} from "@o-tid/contracts";
import styles from "../race-administrator-workspace.module.css";
import { manualResultSv as text } from "../../i18n/manual-result-sv";
import { formatClockTime, formatDuration, parseRaceClock, zonedDate } from "../../lib/clock-time";
import { Button } from "../ui";
import type { Workspace } from "./workspace-state";

/** Löptid "42:10" eller "1:02:10" i millisekunder, eller null. */
export function parseElapsed(value: string): number | null {
  const match = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1] ?? 0), minutes = Number(match[2]), seconds = Number(match[3]);
  if (seconds > 59 || (match[1] !== undefined && minutes > 59)) return null;
  const ms = ((hours * 60 + minutes) * 60 + seconds) * 1_000;
  return ms > 0 ? ms : null;
}

function nextDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
}

/** Klockslaget som ögonblick: på startens (eller tävlingens) dag, och dagen efter om det annars blir före starten. */
export function clockAfter(clock: string, date: string, timeZone: string, after: string | null): string | null {
  const instant = parseRaceClock(date, clock, timeZone);
  if (!instant || !after || Date.parse(instant) > Date.parse(after)) return instant;
  return parseRaceClock(nextDate(date), clock, timeZone);
}

type Form = { finish: string; start: string; elapsed: string; status: "OK" | "MP"; reason: string };
const emptyForm: Form = { finish: "", start: "", elapsed: "", status: "OK", reason: "" };

/** Arrangörens manuella tid som beslut, eller ett fel i ord. */
export function manualTimeDecision(form: Form, status: EntryStatusResponse, raceDate: string, timeZone: string):
  { decision: EntryStatusDecision; elapsedMs: number } | string {
  if (!form.reason.trim()) return text.reasonRequired;
  const known = status.manualTime.knownStartTime;
  const date = zonedDate(known ?? status.manualTime.readoutFinishTime ?? `${raceDate}T12:00:00Z`, timeZone);
  let startTime: string | undefined;
  if (form.start.trim()) {
    const parsed = parseRaceClock(date, form.start, timeZone);
    if (!parsed) return text.badClock;
    startTime = parsed;
  }
  const start = startTime ?? known;
  const elapsed = form.elapsed.trim() ? parseElapsed(form.elapsed) : null;
  if (form.elapsed.trim() && elapsed === null) return text.badElapsed;
  let finishTime: string | undefined;
  if (form.finish.trim()) {
    const parsed = clockAfter(form.finish, date, timeZone, start ?? null);
    if (!parsed) return text.badClock;
    finishTime = parsed;
  }
  if (!finishTime && elapsed === null) return text.needFinish;
  if (!start && !(finishTime && elapsed !== null)) return text.needStart;
  const elapsedMs = finishTime && start ? Date.parse(finishTime) - Date.parse(start) : elapsed!;
  const decision: EntryStatusDecision = { kind: "MANUAL_TIME", status: form.status, note: form.reason.trim(),
    ...(startTime ? { startTime } : {}), ...(finishTime ? { finishTime } : { elapsedMs: elapsed! }),
    ...(finishTime && !start && elapsed !== null ? { elapsedMs: elapsed } : {}) };
  return { decision, elapsedMs };
}

/**
 * Steg 31: "Ange tid manuellt" och "Godkänn saknade kontroller" i deltagarkortet. Läser löparens läge, visar vad som
 * händer och sparar beslutet i statusflödet med orsak. Ett svar som uteblir skickas om med samma begäran.
 */
export function ManualResult({ ws, result }: { ws: Workspace; result: AdministratorEffectiveResultResponse | undefined }) {
  const { data, disabled, busy, selected } = ws;
  const [open, setOpen] = useState<"" | "TIME" | "CONTROLS">("");
  const [status, setStatus] = useState<EntryStatusResponse>();
  const [sending, setSending] = useState<EntryStatusRequest>();
  const [form, setForm] = useState<Form>(emptyForm);
  const [controls, setControls] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  if (!selected || !data || !result) return null;
  const entryId = selected.id;
  const governing = result.state === "ACTIVE_RESULT" ? result.governingDecision : "NONE";
  const canTime = result.state !== "ACTIVE_RESULT" || governing === "NONE";
  const canApprove = result.state === "ACTIVE_RESULT" && result.result.status === "MP" &&
    (result.result.reason === "MISSING_CONTROL" || result.result.reason === "WRONG_ORDER") &&
    (governing === "NONE" || governing === "CONTROL_APPROVAL");
  const id = `manual-result-${entryId}`;

  async function show(kind: "TIME" | "CONTROLS") {
    if (ws.writingRef.current || ws.pending.current || !ws.requireSession()) return;
    setError(""); setSaved(""); setSending(undefined);
    const op = ws.begin(false);
    try {
      const value = await ws.readEntryStatus(op, entryId);
      if (!ws.current(op)) return;
      setStatus(value); setForm(emptyForm); setControls([]); setOpen(kind);
      if (kind === "TIME" && value.readiness.MANUAL_TIME !== "READY") setError(text.notReady);
    } catch { if (ws.current(op)) setError(text.loadError); }
    finally { ws.finish(op); }
  }

  async function send(decision: EntryStatusDecision, savedText: string) {
    if (!status || ws.writingRef.current || ws.pending.current || !ws.requireSession()) return;
    const request: EntryStatusRequest = sending ??
      { formatVersion: 1, requestId: crypto.randomUUID(), expectedRevision: status.headRevision, decision };
    setSending(request); setError("");
    const op = ws.begin(true);
    let committed = false;
    try {
      const token = ws.csrf();
      const response = await ws.request(`/entries/${entryId}/status`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `entry-status:${request.requestId}` },
        body: JSON.stringify(request) });
      if ([400, 404, 409, 413].includes(response.status)) { setSending(undefined); setError(text.conflict); return; }
      if (!response.ok) throw new Error("Unknown outcome");
      const receipt = entryStatusReceiptSchema.parse(await ws.json(response, op));
      if (receipt.entryId !== entryId || receipt.requestId !== request.requestId) throw new Error("Receipt mismatch");
      committed = true; setSending(undefined); setOpen(""); setSaved(savedText);
      await ws.load(op, entryId);
    } catch { if (ws.current(op) && !committed) setError(text.unknown); }
    finally { ws.finish(op); }
  }

  const timeZone = data.timeZone;
  const planned = status && open === "TIME" ? manualTimeDecision(form, status, data.raceDate, timeZone) : undefined;
  const locked = disabled || busy || !!sending && !error;
  const remaining = status ? status.approvableControls.length - controls.length : 0;
  return <section className={styles.workspace} aria-label={text.manualTimeTitle}>
    {saved && <p role="status" className={styles.saved}>{saved}</p>}
    {!open && <div className={styles.actions}>
      {canTime && <Button variant="secondary" disabled={disabled} onClick={() => void show("TIME")}>{text.manualTimeOpen}</Button>}
      {canApprove && <Button variant="secondary" disabled={disabled} onClick={() => void show("CONTROLS")}>{text.approveOpen}</Button>}
    </div>}
    {!open && error && <p role="alert" className={styles.warning}>{error}</p>}
    {open === "TIME" && status && <div className={styles.review}>
      <h3>{text.manualTimeTitle}</h3>
      <p className={styles.workflowHelp}>{text.manualTimeHelp}</p>
      {!status.manualTime.hasReadout && <p><strong>{text.noReadoutHelp}</strong></p>}
      <label className={styles.narrowField} htmlFor={`${id}-finish`}>{text.finishClock}
        <input id={`${id}-finish`} value={form.finish} inputMode="numeric" autoComplete="off" disabled={locked}
          placeholder={status.manualTime.readoutFinishTime ? formatClockTime(status.manualTime.readoutFinishTime, timeZone) : ""}
          onChange={event => setForm({ ...form, finish: event.target.value })} /></label>
      <label className={styles.narrowField} htmlFor={`${id}-start`}>
        {status.manualTime.knownStartTime ? text.startKnown(formatClockTime(status.manualTime.knownStartTime, timeZone)) : text.startClock}
        <input id={`${id}-start`} value={form.start} inputMode="numeric" autoComplete="off" disabled={locked}
          onChange={event => setForm({ ...form, start: event.target.value })} /></label>
      <label className={styles.narrowField} htmlFor={`${id}-elapsed`}>{text.elapsed}
        <input id={`${id}-elapsed`} value={form.elapsed} inputMode="numeric" autoComplete="off" disabled={locked}
          onChange={event => setForm({ ...form, elapsed: event.target.value })} /></label>
      <label className={styles.narrowField} htmlFor={`${id}-status`}>{text.status}
        <select id={`${id}-status`} value={form.status} disabled={locked}
          onChange={event => setForm({ ...form, status: event.target.value === "MP" ? "MP" : "OK" })}>
          <option value="OK">{text.statusOk}</option><option value="MP">{text.statusMp}</option>
        </select></label>
      <label className={styles.narrowField} htmlFor={`${id}-reason`}>{text.reason}
        <input id={`${id}-reason`} value={form.reason} maxLength={240} autoComplete="off" list={`${id}-reasons`} disabled={locked}
          onChange={event => setForm({ ...form, reason: event.target.value })} /></label>
      <datalist id={`${id}-reasons`}>{text.reasonSuggestions.map(value => <option key={value} value={value} />)}</datalist>
      {planned && typeof planned !== "string" && <p role="status" data-testid="manual-time-preview"><strong>
        {text.preview(formatDuration(planned.elapsedMs), form.status === "OK" ? text.statusOk : text.statusMp)}</strong></p>}
      {error && <p role="alert" className={styles.warning}>{error}</p>}
      <div className={styles.actions}>
        <Button disabled={disabled || busy} onClick={() => {
          if (sending) { void send(sending.decision, text.saved); return; }
          if (!planned || typeof planned === "string") { setError(typeof planned === "string" ? planned : text.needFinish); return; }
          void send(planned.decision, text.saved);
        }}>{sending ? text.retry : text.save}</Button>
        {!sending && <Button variant="secondary" disabled={busy} onClick={() => { setOpen(""); setError(""); }}>{text.cancel}</Button>}
      </div>
    </div>}
    {open === "CONTROLS" && status && <div className={styles.review}>
      <h3>{text.approveTitle}</h3>
      <p className={styles.workflowHelp}>{text.approveHelp}</p>
      <fieldset className={styles.narrowField} disabled={locked}>
        {status.approvableControls.map((code, index) => <label key={`${code}-${index}`}>
          <input type="checkbox" checked={controls.includes(index)}
            onChange={event => setControls(event.target.checked ? [...controls, index] : controls.filter(value => value !== index))} />
          {" "}{text.approveControl(code)}</label>)}
      </fieldset>
      <label className={styles.narrowField} htmlFor={`${id}-approve-reason`}>{text.reason}
        <input id={`${id}-approve-reason`} value={form.reason} maxLength={240} autoComplete="off" list={`${id}-approve-reasons`}
          disabled={locked} onChange={event => setForm({ ...form, reason: event.target.value })} /></label>
      <datalist id={`${id}-approve-reasons`}>{text.approveReasonSuggestions.map(value => <option key={value} value={value} />)}</datalist>
      {controls.length > 0 && <p role="status"><strong>{text.approveResult(remaining)}</strong></p>}
      {error && <p role="alert" className={styles.warning}>{error}</p>}
      <div className={styles.actions}>
        <Button disabled={disabled || busy} onClick={() => {
          if (sending) { void send(sending.decision, text.approvalSaved); return; }
          if (controls.length === 0) { setError(text.approveNone); return; }
          if (!form.reason.trim()) { setError(text.reasonRequired); return; }
          void send({ kind: "APPROVE_CONTROLS", controls: controls.map(index => status.approvableControls[index]!),
            note: form.reason.trim() }, text.approvalSaved);
        }}>{sending ? text.retry : text.approveSave}</Button>
        {!sending && <Button variant="secondary" disabled={busy} onClick={() => { setOpen(""); setError(""); }}>{text.cancel}</Button>}
      </div>
    </div>}
  </section>;
}
