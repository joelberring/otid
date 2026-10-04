"use client";

import styles from "../race-workspace-checklist.module.css";
import workspaceStyles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { sv } from "../../i18n/sv";
import { formatClockTime } from "../../lib/clock-time";
import { inForest, mispunchedEntries } from "../../lib/admin-checklist";
import { resultDuration, unknownReadoutTargetLabel } from "./types";
import type { Workspace } from "./workspace-state";

/**
 * Tävlingsdagens kontrollvy (ADR-0169 beslut 4): öppna avläsningen, kvar i skogen, okända brickor,
 * felstämplade att titta på och senaste avläsningar på en skärm.
 */
export function ReadoutControlView({ ws }: { ws: Workspace }) {
  const { busy, forestData, forestStale, loadRaceDayAttention, raceId, workflowLocked } = ws;
  const remaining = forestData ? inForest(forestData.entries) : undefined;
  const conflicts = forestData?.entries.filter(row => row.forestState === "CONFLICT").length ?? 0;
  return <section className={styles.control} aria-labelledby={`control-${raceId}`}>
    <div className={styles.controlHeader}>
      <h2 id={`control-${raceId}`}>{text.controlTitle}</h2>
      <a className={styles.openReadout} href={`/admin/${raceId}/readout`}>{text.openReadout}</a>
      <p className={workspaceStyles.workflowHelp}>{text.openReadoutHelp}</p>
      <div className={styles.controlRefresh}>
        <button type="button" className="secondary" disabled={busy || workflowLocked} onClick={() => void loadRaceDayAttention()}>
          {text.controlRefresh}</button>
        {forestData && <span>{text.controlReadAt(formatClockTime(forestData.generatedAt, forestData.timeZone))}</span>}
      </div>
    </div>
    <div className={styles.controlGrid}>
      <section className={styles.controlCard} aria-labelledby={`control-forest-${raceId}`}>
        <h3 id={`control-forest-${raceId}`}>{text.controlForest}{" "}
          <strong className={styles.controlCount} data-testid="in-forest-count">{remaining ? remaining.length : "–"}</strong></h3>
        <p className={workspaceStyles.workflowHelp}>{text.controlForestHelp}</p>
        {!remaining ? <p>{text.controlNotLoaded}</p> : <>
          {forestStale && <p className={styles.controlNote} role="status">{text.controlStale}</p>}
          {conflicts > 0 && <p className={styles.controlNote}>{text.controlConflicts(conflicts)}</p>}
          {remaining.length === 0 ? <p>{text.controlForestEmpty}</p> : <ul className={styles.controlList}>
            {remaining.map(row => <li key={row.entryId}>
              <strong>{row.displayName}</strong>
              <span>{[row.organisationName ?? text.none, row.className,
                row.cardNumber ? `${text.rosterCard} ${row.cardNumber}` : text.rosterNoActiveCard].join(" · ")}</span>
            </li>)}
          </ul>}
        </>}
      </section>
      <UnknownCards ws={ws} />
      <section className={styles.controlCard} aria-labelledby={`control-mp-${raceId}`}>
        <MispunchedList ws={ws} />
      </section>
      <section className={styles.controlCard} aria-labelledby={`control-latest-${raceId}`}>
        <h3 id={`control-latest-${raceId}`}>{text.controlLatest}</h3>
        <LatestReadouts ws={ws} />
      </section>
    </div>
  </section>;
}

function MispunchedList({ ws }: { ws: Workspace }) {
  const { classNames, data, disabled, raceId, select } = ws;
  const rows = data ? mispunchedEntries(data) : [];
  return <>
    <h3 id={`control-mp-${raceId}`}>{text.controlMispunched}{" "}<strong className={styles.controlCount}>{rows.length}</strong></h3>
    {rows.length === 0 ? <p>{text.controlMispunchedNone}</p> : <ul className={styles.controlList}>
      {rows.map(entry => <li key={entry.id} className={styles.controlRowAction}>
        <span><strong>{entry.displayName}</strong>
          <span>{[entry.organisationName ?? text.none, classNames.get(entry.classId)].join(" · ")}</span></span>
        <button type="button" className="secondary" disabled={disabled} aria-label={text.controlOpenFor(entry.displayName)}
          onClick={() => select(entry.id)}>{text.controlOpen}</button>
      </li>)}
    </ul>}
  </>;
}

function LatestReadouts({ ws }: { ws: Workspace }) {
  const { latestReadouts } = ws;
  if (!latestReadouts) return <p>{text.controlNotLoaded}</p>;
  if (latestReadouts.rows.length === 0) return <p>{text.controlLatestNone}</p>;
  return <ol className={styles.controlList}>
    {latestReadouts.rows.slice(0, 10).map(row => <li key={`${row.slot}-${row.selectedRevision}`} className={styles.controlLatestRow}>
      <time dateTime={row.registeredAt}>{formatClockTime(row.registeredAt, latestReadouts.timeZone)}</time>
      <span><strong>{row.givenName} {row.familyName}</strong><span>{row.className}</span></span>
      <span className={row.state === "ACTIVE_RESULT" && row.result.status === "MP" ? workspaceStyles.rosterCritical : undefined}>
        {row.state === "ACTIVE_RESULT" ? sv.publicResultsStatusLabels[row.result.status] : text.noActiveResult}
        {row.state === "ACTIVE_RESULT" && "elapsedMs" in row.result && row.result.elapsedMs !== undefined &&
          <> · {resultDuration(row.result.elapsedMs)}</>}
      </span>
    </li>)}
  </ol>;
}

/** Okända brickor: antal och kopplingen till befintlig deltagare eller direktanmälan, direkt i vyn. */
function UnknownCards({ ws }: { ws: Workspace }) {
  const { busy, data, inspectUnknownReadoutResolution, pending, raceId, sent, setUnknownReadoutAttempt,
    setUnknownReadoutClassId, setUnknownReadoutEntryId, setUnknownReadoutFamilyName, setUnknownReadoutGivenName,
    setUnknownReadoutId, setUnknownReadoutOrganisationName, setUnknownReadoutTarget, submitUnknownReadoutResolution,
    unknownReadoutAttempt, unknownReadoutCandidate, unknownReadoutClassId, unknownReadoutEntryId, unknownReadoutError,
    unknownReadoutFamilyName, unknownReadoutGivenName, unknownReadoutId, unknownReadoutOrganisationName,
    unknownReadoutTarget } = ws;
  const timeZone = data?.timeZone ?? "UTC";
  const readoutTime = (value: string | null) => value ? formatClockTime(value, timeZone) : "–";
  return <section className={styles.controlCard} id={`unknown-readout-${raceId}`} aria-labelledby={`control-unknown-${raceId}`}>
    <h3 id={`control-unknown-${raceId}`}>{text.controlUnknown}{" "}
      <strong className={styles.controlCount}>{unknownReadoutCandidate ? unknownReadoutCandidate.readouts.length : "–"}</strong></h3>
    {!unknownReadoutCandidate && !unknownReadoutAttempt && <p>{text.controlNotLoaded}</p>}
    {unknownReadoutCandidate && !unknownReadoutAttempt && (unknownReadoutCandidate.readouts.length === 0
      ? <p>{text.unknownReadoutNone}</p> : <div className={styles.controlForm}>
        <p className={workspaceStyles.workflowHelp}>{text.unknownReadoutHelp}</p>
        <label>{text.unknownReadoutSelect}<select value={unknownReadoutId} disabled={busy}
          onChange={event => setUnknownReadoutId(event.target.value)}>
          {unknownReadoutCandidate.readouts.map(readout => <option key={readout.id} value={readout.id}>
            {text.rosterCard} {readout.cardNumber} · {readoutTime(readout.finishPunchedAt)}
          </option>)}
        </select></label>
        <label>{text.unknownReadoutTarget}<select value={unknownReadoutTarget} disabled={busy}
          onChange={event => setUnknownReadoutTarget(event.target.value === "NEW_ENTRY" ? "NEW_ENTRY" : "EXISTING_ENTRY")}>
          <option value="EXISTING_ENTRY">{text.unknownReadoutExisting}</option><option value="NEW_ENTRY">{text.unknownReadoutNew}</option>
        </select></label>
        {unknownReadoutTarget === "EXISTING_ENTRY" ? <label>{text.unknownReadoutEntry}<select value={unknownReadoutEntryId} disabled={busy}
          onChange={event => setUnknownReadoutEntryId(event.target.value)}>
          <option value="">{text.chooseParticipant}</option>
          {unknownReadoutCandidate.entries.map(entry => <option key={entry.id} value={entry.id}>
            {entry.familyName}, {entry.givenName} · {unknownReadoutCandidate.classes.find(raceClass => raceClass.id === entry.classId)?.name ?? ""}{entry.activeAssignment ? ` · ${text.rosterCard} ${entry.activeAssignment.cardNumber}` : ""}
          </option>)}
        </select></label> : <>
          <label>{text.unknownReadoutNewClass}<select value={unknownReadoutClassId} disabled={busy}
            onChange={event => setUnknownReadoutClassId(event.target.value)}><option value="">{text.chooseClass}</option>
            {unknownReadoutCandidate.classes.map(raceClass => <option key={raceClass.id} value={raceClass.id}>
              {raceClass.name} · {raceClass.entryCount}{raceClass.maxEntries === null ? "" : `/${raceClass.maxEntries}`}
            </option>)}
          </select></label>
          <label>{text.unknownReadoutGivenName}<input value={unknownReadoutGivenName} maxLength={160} disabled={busy}
            onChange={event => setUnknownReadoutGivenName(event.target.value)} required /></label>
          <label>{text.unknownReadoutFamilyName}<input value={unknownReadoutFamilyName} maxLength={160} disabled={busy}
            onChange={event => setUnknownReadoutFamilyName(event.target.value)} required /></label>
          <label>{text.unknownReadoutOrganisation}<input value={unknownReadoutOrganisationName} maxLength={200} disabled={busy}
            onChange={event => setUnknownReadoutOrganisationName(event.target.value)} /></label>
        </>}
        <p>{text.unknownReadoutConsequence}</p>
        <button type="button" disabled={busy || !!unknownReadoutAttempt} onClick={inspectUnknownReadoutResolution}>{text.unknownReadoutInspect}</button>
      </div>)}
    {unknownReadoutAttempt && <div className={workspaceStyles.review} role="alert" aria-live="polite">
      <h4>{text.unknownReadoutReview}</h4>
      <p><strong>{text.rosterCard}:</strong> {unknownReadoutAttempt.request.cardNumber} · {readoutTime(unknownReadoutAttempt.candidate.readouts
        .find(row => row.id === unknownReadoutAttempt.request.readoutId)?.finishPunchedAt ?? null)}</p>
      <p><strong>{text.unknownReadoutTarget}:</strong> {unknownReadoutTargetLabel(unknownReadoutAttempt)}</p>
      <p>{text.unknownReadoutConsequence}</p>
      <div className={workspaceStyles.actions}>
        <button type="button" disabled={busy} onClick={() => void submitUnknownReadoutResolution(unknownReadoutAttempt)}>{text.unknownReadoutConfirm}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setUnknownReadoutAttempt(undefined); }}>{text.unknownReadoutEdit}</button>
      </div>
    </div>}
    {unknownReadoutError && <p className={workspaceStyles.warning} role="alert">{unknownReadoutError}</p>}
  </section>;
}
