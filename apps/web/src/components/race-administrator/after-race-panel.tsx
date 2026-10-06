"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import Link from "next/link";
import { ClassResultRecalculation } from "../class-result-recalculation";
import { sv } from "../../i18n/sv";
import { formatClockTime } from "../../lib/clock-time";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { Button, Field, Notice, Section } from "../ui";
import { mispunchedEntries } from "../../lib/section-status";
import { MispunchedList } from "./readout-control-view";
import controlStyles from "./readout-control.module.css";
import { ResultLists } from "../lists/result-lists";
import { useResultListData } from "../lists/use-result-list-data";
import { resultListFromPublic } from "../../lib/lists/result-list-model";
import { listsSv as listText } from "../../i18n/lists-sv";
import listStyles from "../lists/lists.module.css";
import { useMemo } from "react";
import type { Workspace } from "./workspace-state";
import { MapRoutesSection } from "./map-routes-section";

/**
 * Resultatlistorna i arbetsytan (PLAN.md steg 13): samma vyer som den publika sidan, med de publicerade
 * resultaten. Hämtas när Resultat visas och uppdateras sedan av sig själv.
 */
function AdminResultLists({ ws }: { ws: Workspace }) {
  const { authenticated, data, disabled, downloadResults, raceId, shows } = ws;
  const { data: lists, failed } = useResultListData(raceId, undefined, authenticated && shows("RESULTS"), 15_000);
  const model = useMemo(() => lists ? resultListFromPublic(lists.results, lists.relay, lists.radio) : undefined, [lists]);
  if (!model || !data) return <p className={styles.muted} role="status">{failed ? listText.results.refreshFailed : listText.results.loading}</p>;
  return <ResultLists model={model} raceId={raceId} race={`${data.eventName} · ${data.raceName} · ${data.raceDate}`} raceDate={data.raceDate}
    links={false} iof={{ onSelect: () => void downloadResults(), disabled }}
    status={failed ? <p className={listStyles.notice} role="alert">{listText.results.refreshFailed}</p> : undefined} />;
}

/**
 * Resultat (PLAN.md steg 13): felstämplade att titta på, resultatlistorna (per klass, med sträcktider, per klubb) och
 * under dem efterarbetet: fastställande (typer som har det), omräkning och flytt till kortare bana.
 */
export function AfterRacePanel({ ws }: { ws: Workspace }) {
  const { busy, classRecalculationAttempt, classRecalculationCandidates, classRecalculationError,
    classRecalculationSaved, classRecalculationUnknown, data, disabled, finalizationAttempt, finalizationCandidate,
    finalizationCandidates, finalizationScope, inspectShortenedCourseTransfer, loadClassRecalculation,
    loadFinalizationBasis, loadShortenedCourseCandidate, pending, prepareClassRecalculation, prepareFinalization, raceId,
    sent, setClassRecalculationAttempt, setClassRecalculationUnknown, setFinalizationAttempt, setFinalizationScope, setShortenedClassName,
    setShortenedControlCount, setShortenedCourseAttempt, setShortenedCourseCandidate, setShortenedCourseClassId,
    setShortenedCourseError, setShortenedCourseName, setShortenedEntryIds, shortenedClassName, shortenedControlCount,
    shortenedCourseAttempt, shortenedCourseCandidate, shortenedCourseClassId, shortenedCourseError,
    shortenedCourseName, shortenedEntryIds, submitClassRecalculation,
    profile, shows, submitFinalization, submitShortenedCourseTransfer, toggleShortenedEntry, unknown, workflowLocked } = ws;
  return <section className={styles.workflowGroup} id={`workflow-${raceId}-results`} aria-label={navigationText.steps.RESULTS}
      hidden={!shows("RESULTS")}>
    <Section id={`results-${raceId}`} title={navigationText.steps.RESULTS} help={text.resultsHelp}
      actions={!workflowLocked && <nav className={styles.contextLinks} aria-label={text.resultsLinks}>
        <Link href={`/results/${raceId}`}>{text.publicResultsLink}</Link>
      </nav>} />
    {data && mispunchedEntries(data).length > 0 && <section className={controlStyles.controlCard} aria-labelledby={`control-mp-${raceId}`}>
      <MispunchedList ws={ws} />
    </section>}
    <AdminResultLists ws={ws} />
    <Section id={`results-follow-up-${raceId}`} title={text.followUpHeading} help={text.followUpHelp}>
    <div className={styles.disclosureList}>
    {profile.features.finalization && <details className={styles.disclosure} open={finalizationAttempt ? true : undefined}>
      <summary>{text.finalizationHeading}</summary>
      <div className={styles.disclosureBody}>
      <p className={styles.workflowHelp}>{text.finalizationHelp}</p>
      <div><Button variant="secondary" disabled={disabled} onClick={() => void loadFinalizationBasis()}>{text.finalizationLoad}</Button></div>
      {finalizationCandidates && <>
        <Field label={text.finalizationScope} className={styles.narrowField}><select value={finalizationScope} disabled={disabled}
          onChange={event => setFinalizationScope(event.target.value)}>
          <option value="RACE">{sv.resultFinalizationRaceScope}</option>
          {finalizationCandidates.classes.map(row => <option key={row.classId} value={row.classId}>{row.className}</option>)}
        </select></Field>
        {finalizationCandidate && <>
          <p>{text.participants}: {finalizationCandidate.entryCount}</p>
          <p>{finalizationCandidate.latestFinalization ? text.finalizationDone(formatClockTime(finalizationCandidate.latestFinalization.finalizedAt,
            data?.timeZone ?? "UTC")) : text.finalizationNone}</p>
          {finalizationCandidate.blockerCodes.length > 0 && <Notice tone="attention"><ul className={styles.changeList}>
            {finalizationCandidate.blockerCodes.map(code => <li key={code}>{sv.resultFinalizationBlockers[code]}</li>)}</ul></Notice>}
          <div><Button disabled={disabled || finalizationCandidate.blockerCodes.length > 0} onClick={prepareFinalization}>{text.finalizationReview}</Button></div>
        </>}
      </>}
      {finalizationAttempt && <section className={styles.review} role="alert" aria-label={text.finalizationReview}>
        <h3>{text.finalizationReview}: {finalizationAttempt.value.label}</h3>
        <p>{text.finalizationConsequence}</p>
        {unknown && <p>{text.unreachable}</p>}
        <div className={styles.actions}>
          <Button disabled={busy} onClick={() => void submitFinalization(finalizationAttempt)}>{unknown ? text.retry : text.finalizationConfirm}</Button>
          {!unknown && <Button variant="secondary" disabled={busy} onClick={() => {
            pending.current = undefined; sent.current = false; setFinalizationAttempt(undefined);
          }}>{text.cancel}</Button>}
        </div>
      </section>}
      <FinalizedExports ws={ws} />
      </div>
    </details>}
    <details className={styles.disclosure} open={classRecalculationAttempt ? true : undefined}>
      <summary>{text.classRecalculationTitle}</summary>
      {data && <ClassResultRecalculation classes={data.classes.map((item) => ({ id: item.id, name: item.name }))}
        disabled={disabled} candidates={classRecalculationCandidates} attempt={classRecalculationAttempt}
        unknown={classRecalculationUnknown} error={classRecalculationError} saved={classRecalculationSaved}
        onLoad={(id) => void loadClassRecalculation(id)} onPrepare={prepareClassRecalculation}
        onSubmit={(value) => void submitClassRecalculation(value)} onRetry={() => classRecalculationAttempt && void submitClassRecalculation(classRecalculationAttempt)}
        onCancel={() => { pending.current = undefined; sent.current = false; setClassRecalculationAttempt(undefined); setClassRecalculationUnknown(false); }} />}
    </details>
    <details className={styles.disclosure}>
      <summary>{text.shortenedCourseTitle}</summary>
      <form className={styles.disclosureBody} onSubmit={inspectShortenedCourseTransfer}>
        <p className={styles.workflowHelp}>{text.shortenedCourseHelp}</p>
        <label>{text.shortenedCourseSourceClass}<select value={shortenedCourseClassId} disabled={busy || !!shortenedCourseAttempt}
          onChange={event => { setShortenedCourseClassId(event.target.value); setShortenedCourseCandidate(undefined); setShortenedCourseError(""); setShortenedEntryIds([]); }}>
          <option value="">{text.chooseClass}</option>
          {data?.classes.map(raceClass => <option key={raceClass.id} value={raceClass.id}>{raceClass.name}</option>)}
        </select></label>
        {!shortenedCourseCandidate && !shortenedCourseAttempt && <button type="button" disabled={busy || !shortenedCourseClassId}
          onClick={() => void loadShortenedCourseCandidate()}>{text.shortenedCourseLoad}</button>}
        {shortenedCourseCandidate && !shortenedCourseAttempt && <>
          <div className={styles.summaryBox}>
            <p><strong>{text.shortenedCourseSourceCourse}:</strong> {shortenedCourseCandidate.sourceCourseName} · {text.raceClass}: {shortenedCourseCandidate.sourceClassName}</p>
            <p><strong>{text.courseStartRule}:</strong> {shortenedCourseCandidate.sourceStartRule === "PUNCH" ? text.courseFreeStart : text.courseFixedStart}</p>
            <p><strong>{text.courseControls}:</strong> {shortenedCourseCandidate.sourceControls.map(control => control.controlCode).join(" → ")}</p>
          </div>
          <div className={styles.fieldRow}>
            <label>{text.shortenedCourseName}<input value={shortenedCourseName} maxLength={160} disabled={busy}
              onChange={event => setShortenedCourseName(event.target.value)} required /></label>
            <label>{text.shortenedCourseClassName}<input value={shortenedClassName} maxLength={160} disabled={busy}
              onChange={event => setShortenedClassName(event.target.value)} required /></label>
            <label>{text.shortenedCoursePrefix}<select value={shortenedControlCount} disabled={busy}
              onChange={event => setShortenedControlCount(event.target.value)}>
              {shortenedCourseCandidate.sourceControls.slice(0, -1).map((_, index) => <option key={index + 1} value={index + 1}>
                {shortenedCourseCandidate.sourceControls.slice(0, index + 1).map(control => control.controlCode).join(" → ")}
              </option>)}
            </select></label>
          </div>
          {shortenedCourseCandidate.entries.length === 0 ? <p>{text.shortenedCourseNoEligibleEntries}</p> : <>
            <fieldset className={styles.shortenedEntries} disabled={busy}>
              <legend>{text.shortenedCourseEntries} ({shortenedEntryIds.length}/100)</legend>
              {shortenedCourseCandidate.entries.map(entry => <label key={entry.entryId}>
                <input type="checkbox" checked={shortenedEntryIds.includes(entry.entryId)}
                  disabled={busy || (!shortenedEntryIds.includes(entry.entryId) && shortenedEntryIds.length >= 100)}
                  onChange={event => toggleShortenedEntry(entry.entryId, event.target.checked)} />
                <span>{entry.displayName} · {entry.sourceResult.kind === "NO_RESULT" ? text.shortenedCourseNoResult : text.shortenedCourseMpResult}</span>
              </label>)}
            </fieldset>
            <p>{text.shortenedCourseConsequence}</p>
            {shortenedCourseError && <p className={styles.warning} role="alert">{shortenedCourseError}</p>}
            <button type="submit" disabled={busy || shortenedEntryIds.length === 0}>{text.shortenedCourseInspect}</button>
          </>}
        </>}
        {shortenedCourseError && !shortenedCourseCandidate && !shortenedCourseAttempt && <p className={styles.warning} role="alert">{shortenedCourseError}</p>}
        {shortenedCourseAttempt && <section className={styles.review} role="alert" aria-live="polite">
          <h2>{text.shortenedCourseReview}</h2>
          <p><strong>{text.raceClass}:</strong> {shortenedCourseAttempt.candidate.sourceClassName} → {shortenedCourseAttempt.request.shortClassName}</p>
          <p><strong>{text.shortenedCourseSourceCourse}:</strong> {shortenedCourseAttempt.candidate.sourceCourseName} → {shortenedCourseAttempt.request.shortCourseName}</p>
          <p><strong>{text.shortenedCoursePrefix}:</strong> {shortenedCourseAttempt.request.controlPrefix.map(control => control.controlCode).join(" → ")}</p>
          <ul className={styles.shortenedReviewList}>{shortenedCourseAttempt.request.entryIds.map(entryId => {
            const entry = shortenedCourseAttempt.candidate.entries.find(value => value.entryId === entryId);
            return <li key={entryId}>{entry?.displayName ?? entryId} · {entry?.sourceResult.kind === "NO_RESULT" ? text.shortenedCourseNoResult : text.shortenedCourseMpResult}</li>;
          })}</ul>
          <p>{text.shortenedCourseConsequence}</p><p>{text.shortenedCourseNotSaved}</p>
          <div className={styles.actions}>
            <button type="button" disabled={busy} onClick={() => void submitShortenedCourseTransfer(shortenedCourseAttempt)}>{text.shortenedCourseConfirm}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; setShortenedCourseAttempt(undefined); }}>{text.shortenedCourseEdit}</button>
          </div>
          {shortenedCourseError && <p className={styles.warning} role="alert">{shortenedCourseError}</p>}
        </section>}
      </form>
    </details>
    </div>
    </Section>
    {/* Karta och vägval (PLAN.md steg 16): inte för rogaining (inga sträckor) eller stafett (stöds inte än). */}
    {shows("RESULTS") && !profile.features.rogaining && !profile.features.relay && <MapRoutesSection ws={ws} />}
  </section>;
}

/** Fastställda listor (IOF XML) i fastställandet. Den aktuella resultatlistan exporteras från listornas verktygsrad. */
function FinalizedExports({ ws }: { ws: Workspace }) {
  const { data, disabled, downloadFinalization, finalizationId, finalizations, loadFinalizations, setFinalizationId } = ws;
  const timeZone = data?.timeZone ?? "UTC";
  return <>
    <h3>{text.exportCompleteHeading}</h3>
    <p className={styles.workflowHelp}>{text.exportCompleteHelp}</p>
    <div><Button variant="secondary" disabled={disabled} onClick={() => void loadFinalizations()}>{text.exportLoadHistory}</Button></div>
    {finalizations?.length === 0 && <p>{text.exportEmptyHistory}</p>}
    {!!finalizations?.length && <>
      <Field label={text.exportFinalization} className={styles.narrowField}><select value={finalizationId} disabled={disabled}
        onChange={event => setFinalizationId(event.target.value)}>
        {finalizations.map(row => <option key={row.id} value={row.id}>{text.exportFinalizationOption(formatClockTime(row.finalizedAt, timeZone), row.entryCount)}</option>)}
      </select></Field>
      <div><Button disabled={disabled || !finalizationId} onClick={() => void downloadFinalization()}>{text.exportDownloadComplete}</Button></div>
    </>}
  </>;
}
