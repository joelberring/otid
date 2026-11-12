"use client";

import { publicResultEn, publicResultSv } from "../../i18n/public-en";
import { useEffect, useRef, useState } from "react";
import { raceAdministratorEn } from "../../i18n/workspace-admin-en";
import { useTexts } from "../language-provider";
import styles from "./readout-control.module.css";
import workspaceStyles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv } from "../../i18n/race-administrator-sv";
import { courseVariantsSv } from "../../i18n/course-variants-sv";
import { courseVariantsEn } from "../../i18n/workspace-tools-en";
import { formatClockTime } from "../../lib/clock-time";
import { raceDayStarted } from "@o-tid/domain";
import { awaitingStart, inForest, mispunchedEntries } from "../../lib/section-status";
import { resultDuration } from "./types";
import { entryVariant, fittingVariant, hasResult, linkReview, orderUnknownReadoutEntries, type EntryResult } from "./unknown-readout-choice";
import type { Workspace } from "./workspace-state";
import { RelayControl } from "./relay-panels";
import { Button, Notice } from "../ui";

/**
 * Tävlingsdagens kontrollvy (ADR-0169 beslut 4): öppna avläsningen, kvar i skogen, okända brickor,
 * felstämplade att titta på och senaste avläsningar på en skärm.
 */
export function ReadoutControlView({ ws }: { ws: Workspace }) {
  const text = useTexts(raceAdministratorSv, raceAdministratorEn);
  const { authenticated, busy, data, disabled, forestData, forestStale, functionary, loadRaceDayAttention, operation, pending, profile, raceId,
    openCorrection, shows, workflowLocked } = ws;
  // PLAN.md steg 24: läget läses in av sig självt när steget visas (en gång; sedan finns Uppdatera).
  const attempted = useRef(false);
  const visible = shows("READOUT");
  useEffect(() => {
    if (!visible || !authenticated || !data || busy || operation.current || pending.current || forestData || attempted.current) return;
    attempted.current = true;
    void loadRaceDayAttention();
  }, [visible, authenticated, data, busy, forestData]);
  const notLoaded = busy || !attempted.current ? text.controlNotLoaded : text.controlLoadFailed;
  const remaining = forestData ? inForest(forestData.entries, forestData) : undefined;
  const awaiting = forestData ? awaitingStart(forestData.entries, forestData).length : 0;
  const notStarted = forestData !== undefined && !raceDayStarted(forestData.raceDate, forestData.timeZone, new Date());
  const conflicts = forestData?.entries.filter(row => row.forestState === "CONFLICT").length ?? 0;
  return <section className={styles.control} aria-labelledby={`control-${raceId}`}>
    <div className={styles.controlHeader}>
      <div className={styles.controlTitle}>
        <h2 id={`control-${raceId}`}>{text.controlTitle}</h2>
        <p className={workspaceStyles.workflowHelp}>{text.openReadoutHelp}</p>
      </div>
      <div className={styles.controlActions}>
        <a className={styles.openReadout} href={`/admin/${raceId}/readout`}>{text.openReadout}</a>
        <a href={`/admin/${raceId}/stations`}>{text.openStations}</a>
        <Button variant="secondary" disabled={busy || workflowLocked} onClick={() => void loadRaceDayAttention()}>{text.controlRefresh}</Button>
        {forestData && <span className={styles.readAt}>{text.controlReadAt(formatClockTime(forestData.generatedAt, forestData.timeZone))}</span>}
      </div>
    </div>
    <div className={styles.controlGrid}>
      <section className={styles.controlCard} aria-labelledby={`control-forest-${raceId}`}>
        <h3 id={`control-forest-${raceId}`}>{text.controlForest}{" "}
          <strong className={styles.controlCount} data-testid="in-forest-count">{remaining ? remaining.length : "–"}</strong></h3>
        <p className={workspaceStyles.workflowHelp}>{text.controlForestHelp}</p>
        {!remaining ? <p role="status">{notLoaded}</p> : <>
          {forestStale && <Notice tone="attention" role="status">{text.controlStale}</Notice>}
          {conflicts > 0 && <Notice tone="attention">{text.controlConflicts(conflicts)}</Notice>}
          {notStarted ? <p data-testid="in-forest-not-started">{text.controlForestNotStarted}</p>
            : remaining.length === 0 ? awaiting === 0 && <p>{text.controlForestEmpty}</p> : <ul className={styles.controlList}>
            {remaining.map(row => <li key={row.entryId} className={functionary ? undefined : styles.controlRowAction}>
              <span><strong>{row.displayName}</strong>
                <span>{[row.organisationName ?? text.none, row.className,
                  row.cardNumber ? `${text.rosterCard} ${row.cardNumber}` : text.rosterNoActiveCard].join(" · ")}</span></span>
              {/* Steg 35: deltagarkortet direkt ur kvar i skogen (t.ex. "Deltog utan tid" för den som sprang utan bricka). */}
              {!functionary && <Button variant="secondary" disabled={disabled} aria-label={text.controlOpenFor(row.displayName)}
                onClick={() => openCorrection(row.entryId)}>{text.controlOpen}</Button>}
            </li>)}
          </ul>}
          {!notStarted && awaiting > 0 && <p data-testid="awaiting-start-count">{text.controlAwaitingStart(awaiting)}</p>}
        </>}
      </section>
      {profile.features.relay && <RelayControl ws={ws} />}
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

/** Felstämplade att titta på, med "Öppna" till deltagarkortet. Visas i kontrollvyn och under Resultat. */
export function MispunchedList({ ws }: { ws: Workspace }) {
  const text = useTexts(raceAdministratorSv, raceAdministratorEn);
  const { classNames, data, disabled, functionary, raceId, openCorrection } = ws;
  const rows = data ? mispunchedEntries(data) : [];
  return <>
    <h3 id={`control-mp-${raceId}`}>{text.controlMispunched}{" "}<strong className={styles.controlCount}>{rows.length}</strong></h3>
    {rows.length === 0 ? <p>{text.controlMispunchedNone}</p> : <ul className={styles.controlList}>
      {rows.map(entry => <li key={entry.id} className={styles.controlRowAction}>
        <span><strong>{entry.displayName}</strong>
          <span>{[entry.organisationName ?? text.none, classNames.get(entry.classId)].join(" · ")}</span></span>
        {/* Deltagarkortet är administratörens; funktionären ser bara listan (ADR-0172 beslut 3). */}
        {!functionary && <Button variant="secondary" disabled={disabled} aria-label={text.controlOpenFor(entry.displayName)}
          onClick={() => openCorrection(entry.id)}>{text.controlOpen}</Button>}
      </li>)}
    </ul>}
  </>;
}

function LatestReadouts({ ws }: { ws: Workspace }) {
  const resultText = useTexts(publicResultSv, publicResultEn);
  const text = useTexts(raceAdministratorSv, raceAdministratorEn);
  const { latestReadouts } = ws;
  if (!latestReadouts) return <p>{text.controlNotLoaded}</p>;
  if (latestReadouts.rows.length === 0) return <p>{text.controlLatestNone}</p>;
  return <ol className={styles.controlList}>
    {latestReadouts.rows.slice(0, 10).map(row => <li key={`${row.slot}-${row.selectedRevision}`} className={styles.controlLatestRow}>
      <time dateTime={row.registeredAt}>{formatClockTime(row.registeredAt, latestReadouts.timeZone)}</time>
      <span><strong>{row.givenName} {row.familyName}</strong><span>{row.className}</span></span>
      <span className={styles.latestResult} data-status={row.state === "ACTIVE_RESULT" ? row.result.status : undefined}>
        {row.state === "ACTIVE_RESULT" && <span aria-hidden="true">{row.result.status === "OK" ? "✓ " : row.result.status === "MP" ? "✗ " : ""}</span>}
        {row.state === "ACTIVE_RESULT" ? resultText.statusLabels[row.result.status] : text.noActiveResult}
        {row.state === "ACTIVE_RESULT" && "elapsedMs" in row.result && row.result.elapsedMs !== undefined &&
          <> · {resultDuration(row.result.elapsedMs)}</>}
      </span>
    </li>)}
  </ol>;
}

/**
 * Okända brickor: antal och kopplingen till befintlig deltagare eller direktanmälan, direkt i vyn.
 * Funktionären direktanmäler bara (ADR-0172 beslut 3).
 */
function UnknownCards({ ws }: { ws: Workspace }) {
  const text = useTexts(raceAdministratorSv, raceAdministratorEn);
  const resultText = useTexts(publicResultSv, publicResultEn);
  const variantText = useTexts(courseVariantsSv, courseVariantsEn);
  const resultLabel = (result: EntryResult) => [resultText.statusLabels[result.status],
    result.elapsedMs !== undefined ? resultDuration(result.elapsedMs) : ""].filter(Boolean).join(" ");
  // Användartestet 2026-11-12: att ersätta ett resultat kräver ett eget kryss, som nollställs för varje ny granskning.
  const [replaceConsent, setReplaceConsent] = useState(false);
  const attemptId = ws.unknownReadoutAttempt?.request.requestId;
  useEffect(() => setReplaceConsent(false), [attemptId]);
  const { busy, data, functionary, inspectUnknownReadoutResolution, pending, raceId, sent, setUnknownReadoutAttempt,
    setUnknownReadoutClassId, setUnknownReadoutEntryId, setUnknownReadoutFamilyName, setUnknownReadoutGivenName,
    setUnknownReadoutId, setUnknownReadoutOrganisationName, setUnknownReadoutTarget, submitUnknownReadoutResolution,
    unknownReadoutAttempt, unknownReadoutCandidate, unknownReadoutClassId, unknownReadoutEntryId, unknownReadoutError,
    unknownReadoutFamilyName, unknownReadoutGivenName, unknownReadoutId, unknownReadoutOrganisationName,
    unknownReadoutTarget } = ws;
  const timeZone = data?.timeZone ?? "UTC";
  const readoutTime = (value: string | null) => value ? formatClockTime(value, timeZone) : "–";
  const review = unknownReadoutAttempt ? linkReview(unknownReadoutAttempt.candidate, unknownReadoutAttempt.request) : undefined;
  return <section className={styles.controlCard} id={`unknown-readout-${raceId}`} aria-labelledby={`control-unknown-${raceId}`}>
    <h3 id={`control-unknown-${raceId}`}>{text.controlUnknown}{" "}
      <strong className={styles.controlCount}>{unknownReadoutCandidate ? unknownReadoutCandidate.readouts.length : "–"}</strong></h3>
    {!unknownReadoutCandidate && !unknownReadoutAttempt && <p>{text.controlNotLoaded}</p>}
    {unknownReadoutCandidate && !unknownReadoutAttempt && (unknownReadoutCandidate.readouts.length === 0
      ? <p>{text.unknownReadoutNone}</p> : <div className={styles.controlForm}>
        <p className={workspaceStyles.workflowHelp}>{functionary ? text.unknownReadoutHelpFunctionary : text.unknownReadoutHelp}</p>
        <label>{text.unknownReadoutSelect}<select value={unknownReadoutId} disabled={busy}
          onChange={event => setUnknownReadoutId(event.target.value)}>
          {unknownReadoutCandidate.readouts.map(readout => <option key={readout.id} value={readout.id}>
            {text.rosterCard} {readout.cardNumber} · {readoutTime(readout.finishPunchedAt)}
            {readout.alreadyReadOutBy ? ` · ${text.unknownReadoutAlreadyShort(readout.alreadyReadOutBy.name)}` : ""}
          </option>)}
        </select></label>
        {(() => {
          // Fel D: klassen och varianten som stämplingarna passar, som i avläsningsvyn.
          const fits = (unknownReadoutCandidate.readouts.find(readout => readout.id === unknownReadoutId)?.fits ?? []).filter(fit => fit.ok);
          return fits.length > 0 ? <p data-testid="unknown-readout-fits">{text.unknownReadoutFits(fits.slice(0, 4).map(fit => {
            const name = unknownReadoutCandidate.classes.find(raceClass => raceClass.id === fit.classId)?.name ?? "";
            const code = fittingVariant(unknownReadoutCandidate, unknownReadoutId, fit.classId);
            return code ? text.unknownReadoutFitVariant(name, code) : name;
          }))}</p> : null;
        })()}
        {(() => {
          const already = unknownReadoutCandidate.readouts.find(readout => readout.id === unknownReadoutId)?.alreadyReadOutBy;
          return already ? <p className={workspaceStyles.warning} role="note" data-testid="unknown-already-read">
            {text.unknownReadoutAlready(already.name)}</p> : null;
        })()}
        {!functionary && <label>{text.unknownReadoutTarget}<select value={unknownReadoutTarget} disabled={busy}
          onChange={event => setUnknownReadoutTarget(event.target.value === "NEW_ENTRY" ? "NEW_ENTRY" : "EXISTING_ENTRY")}>
          <option value="EXISTING_ENTRY">{text.unknownReadoutExisting}</option><option value="NEW_ENTRY">{text.unknownReadoutNew}</option>
        </select></label>}
        {unknownReadoutTarget === "EXISTING_ENTRY" && !functionary ? <label>{text.unknownReadoutEntry}<select value={unknownReadoutEntryId} disabled={busy}
          onChange={event => setUnknownReadoutEntryId(event.target.value)}>
          <option value="">{text.chooseParticipant}</option>
          {orderUnknownReadoutEntries(unknownReadoutCandidate, unknownReadoutId).map(entry => {
            const variant = entryVariant(unknownReadoutCandidate, unknownReadoutId, entry);
            return <option key={entry.id} value={entry.id}>
              {entry.familyName}, {entry.givenName} · {unknownReadoutCandidate.classes.find(raceClass => raceClass.id === entry.classId)?.name ?? ""}{entry.activeAssignment ? ` · ${text.rosterCard} ${entry.activeAssignment.cardNumber}` : ""}
              {variant ? ` · ${text.unknownReadoutVariant(variant.code, variant.same)}` : ""}
              {hasResult(entry) ? ` · ${text.unknownReadoutHasResult(entry.latestResult ? resultLabel(entry.latestResult) : "")}` : ""}
            </option>;
          })}
        </select></label> : <>
          <label>{text.unknownReadoutNewClass}<select value={unknownReadoutClassId} disabled={busy}
            onChange={event => setUnknownReadoutClassId(event.target.value)}><option value="">{text.chooseClass}</option>
            {unknownReadoutCandidate.classes.filter(raceClass => !data?.classes.some(row => row.id === raceClass.id &&
              row.relayLegCount !== undefined)).map(raceClass => <option key={raceClass.id} value={raceClass.id}>
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
        <div><Button disabled={busy || !!unknownReadoutAttempt} onClick={inspectUnknownReadoutResolution}>{text.unknownReadoutInspect}</Button></div>
      </div>)}
    {unknownReadoutAttempt && <div className={workspaceStyles.review} role="alert" aria-live="polite">
      <h4>{text.unknownReadoutReview}</h4>
      <p><strong>{text.rosterCard}:</strong> {unknownReadoutAttempt.request.cardNumber} · {readoutTime(unknownReadoutAttempt.candidate.readouts
        .find(row => row.id === unknownReadoutAttempt.request.readoutId)?.finishPunchedAt ?? null)}</p>
      {review ? <>
        <p data-testid="unknown-link-entry"><strong>{text.unknownReadoutTarget}:</strong> {review.name} · {review.className}</p>
        <p><strong>{text.unknownReadoutCurrentCard}:</strong> {review.cardBefore ?? text.unknownReadoutNoCard} · <strong>
          {text.unknownReadoutCurrentResult}:</strong> {review.result ? resultLabel(review.result) : review.replacesResult ? "–" : text.unknownReadoutNoResult}</p>
        {review.replacesResult ? <p className={workspaceStyles.warning} role="note" data-testid="unknown-link-replaces">
          {"! "}{text.unknownReadoutReplaceWarning(review.name, review.result ? resultLabel(review.result) : "–", review.cardBefore, review.cardAfter)}</p>
          : review.changesCard ? <p className={workspaceStyles.warning} role="note" data-testid="unknown-link-card">
            {"! "}{text.unknownReadoutCardWarning(review.name, review.cardBefore!, review.cardAfter)}</p> : null}
        {review.variantChange && <p className={workspaceStyles.warning} role="note" data-testid="unknown-link-variant">
          {"! "}{variantText.linkedVariant(review.variantChange.assignedCode, review.variantChange.fittingCode)}</p>}
        {review.replacesResult && <label><input type="checkbox" checked={replaceConsent} disabled={busy}
          onChange={event => setReplaceConsent(event.target.checked)} /> {text.unknownReadoutReplaceConsent}</label>}
      </> : <p><strong>{text.unknownReadoutTarget}:</strong> {unknownReadoutAttempt.request.target === "NEW_ENTRY"
        ? `${unknownReadoutAttempt.request.familyName}, ${unknownReadoutAttempt.request.givenName}` : text.unknownReadoutExisting}</p>}
      <p>{text.unknownReadoutConsequence}</p>
      <div className={workspaceStyles.actions}>
        <Button disabled={busy || (review?.replacesResult === true && !replaceConsent)}
          onClick={() => void submitUnknownReadoutResolution(unknownReadoutAttempt, review?.replacesResult === true && replaceConsent)}>
          {review?.replacesResult ? text.unknownReadoutConfirmReplace : review?.changesCard ? text.unknownReadoutConfirmCard
            : text.unknownReadoutConfirm}</Button>
        <Button variant="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setUnknownReadoutAttempt(undefined); }}>{text.unknownReadoutEdit}</Button>
      </div>
    </div>}
    {unknownReadoutError && <Notice tone="error" role="alert">{unknownReadoutError}</Notice>}
  </section>;
}
