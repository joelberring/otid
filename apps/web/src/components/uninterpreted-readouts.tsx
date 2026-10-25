"use client";

import { useState } from "react";
import type { UninterpretedReadoutListResponse } from "@o-tid/contracts";
import { parseRaceClock } from "@o-tid/domain";
import { uninterpretedReadoutsSv as text } from "../i18n/uninterpreted-readouts-sv";
import { formatClockTime, zonedDate } from "../lib/clock-time";
import { listUninterpretedReadouts, rereadUninterpretedReadout } from "../lib/uninterpreted-readouts-client";
import styles from "./race-administrator-workspace.module.css";

type Row = UninterpretedReadoutListResponse["readouts"][number];

/**
 * Steg 45: Avläsning → "Otolkade avläsningar" (bara administratören). Råramarna som avläsningssidan inte kunde tolka
 * läses om med datorns klocka vid avläsningen eller en angiven tid.
 */
export function UninterpretedReadoutsPanel({ raceId, timeZone, onChanged }: { raceId: string; timeZone: string;
  onChanged: () => Promise<void> | void }) {
  const [list, setList] = useState<UninterpretedReadoutListResponse>();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function load() {
    setBusy(true); setError("");
    try { setList(await listUninterpretedReadouts(raceId)); } catch { setError(text.loadError); } finally { setBusy(false); }
  }
  return <div className={styles.disclosureBody} data-testid="uninterpreted-readouts">
    <p className={styles.workflowHelp}>{text.help}</p>
    <div className={styles.actions}><button type="button" disabled={busy} onClick={() => void load()}>{text.load}</button></div>
    {error && <p role="alert" className={styles.warning}>{error}</p>}
    {list && (list.readouts.length === 0 ? <p>{text.none}</p> : <ul className={styles.changeList}>
      {list.readouts.map((row) => <UninterpretedRow key={row.rawMessageId} raceId={raceId} row={row} timeZone={timeZone}
        onRead={async () => { await onChanged(); await load(); }} />)}
    </ul>)}
  </div>;
}

function UninterpretedRow({ raceId, row, timeZone, onRead }: { raceId: string; row: Row; timeZone: string; onRead: () => Promise<void> }) {
  const [date, setDate] = useState(() => zonedDate(row.stationReceivedAt, timeZone));
  const [clock, setClock] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  async function reread(kind: "DEVICE" | "GIVEN") {
    const readAt = kind === "GIVEN" ? parseRaceClock(date, clock, timeZone) : null;
    if (kind === "GIVEN" && !readAt) { setMessage(text.invalidTime); return; }
    setBusy(true); setMessage("");
    try {
      const result = await rereadUninterpretedReadout(raceId, { formatVersion: 1, requestId, rawMessageId: row.rawMessageId,
        reference: kind === "GIVEN" ? { kind, readAt: readAt! } : { kind } });
      if (!result.ok) { setMessage(result.failure === "conflict" ? text.conflict : text.invalid); return; }
      // Ett nytt försök (annan tid) är en ny begäran.
      setRequestId(crypto.randomUUID());
      if (result.response.result === "UNREADABLE") { setMessage(text.unreadable(result.response.detail)); return; }
      setMessage(text.read(text.status[result.response.status], result.response.punchCount));
      await onRead();
    } catch { setMessage(text.unreachable); } finally { setBusy(false); }
  }
  return <li data-raw-message={row.rawMessageId}>
    <p><strong>{text.row(row.cardNumber, formatClockTime(row.stationReceivedAt, timeZone), row.error)}</strong>
      {row.simulated ? ` · ${text.exercise}` : ""}</p>
    {row.reread ? <p role="status">{text.alreadyRead(text.status[row.reread.status])}</p> : <form noValidate
      onSubmit={(event) => { event.preventDefault(); void reread("GIVEN"); }}>
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={() => void reread("DEVICE")}>{text.rereadDevice}</button>
      </div>
      <div className={styles.toolbarRow}>
        <label>{text.givenDate}<input type="date" value={date} disabled={busy} onChange={(event) => setDate(event.target.value)} /></label>
        <label>{text.givenTime}<input type="text" inputMode="numeric" placeholder="18:45" value={clock} disabled={busy}
          onChange={(event) => setClock(event.target.value)} /></label>
        <button type="submit" disabled={busy}>{text.rereadGiven}</button>
      </div>
    </form>}
    {message && <p role="status">{message}</p>}
  </li>;
}
