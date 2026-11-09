"use client";

import styles from "../race-administrator-workspace.module.css";
import { decisionReviewEn } from "../../i18n/workspace-small-en";
import { resultsOfficialEn } from "../../i18n/workspace-tools-en";
import { startRuleEn } from "../../i18n/workspace-admin-en";
import { raceAdministratorEn } from "../../i18n/workspace-admin-en";
import { raceWorkspaceNavigationEn } from "../../i18n/workspace-en";
import { useTexts } from "../language-provider";
import { raceAdministratorSv } from "../../i18n/race-administrator-sv";
import Link from "next/link";
import { ClassResultRecalculation } from "../class-result-recalculation";
import { RecalculateRace } from "../race-corrections";
import { sv } from "../../i18n/sv";
import { formatClockTime } from "../../lib/clock-time";
import { raceWorkspaceNavigationSv } from "../../i18n/race-workspace-navigation-sv";
import { Button, Disclosure, Field, Notice, Section } from "../ui";
import { mispunchedEntries } from "../../lib/section-status";
import { MispunchedList } from "./readout-control-view";
import { CorrectionShortcut } from "./correction-shortcut";
import controlStyles from "./readout-control.module.css";
import { ResultLists } from "../lists/result-lists";
import { useResultListData } from "../lists/use-result-list-data";
import { resultListFromPublic } from "../../lib/lists/result-list-model";
import { listsSv as listText } from "../../i18n/lists-sv";
import listStyles from "../lists/lists.module.css";
import { useMemo } from "react";
import { startRuleSv } from "../../i18n/start-rule-sv";
import { startPunchText } from "../../lib/start-punch-text";
import type { ResultRowNote } from "../lists/result-lists";
import type { Workspace } from "./workspace-state";
import { MapRoutesSection } from "./map-routes-section";
import { RemainingRunnersSection } from "./remaining-runners";
import { ResultsOfficialSection } from "./results-official-section";
import { resultsOfficialSv } from "../../i18n/results-official-sv";
import { decisionReviewSv } from "../../i18n/decision-review-sv";
import { DecisionReviewList } from "./decision-review";
import { ClubArchiveReminder } from "./club-archive-section";
import { joinRaceParts, raceTitle } from "@o-tid/domain";

/**
 * Resultatlistorna i arbetsytan (PLAN.md steg 13): samma vyer som den publika sidan, med de publicerade
 * resultaten. Hämtas när Resultat visas och uppdateras sedan av sig själv.
 */
function AdminResultLists({ ws }: { ws: Workspace }) {
  const startRule = useTexts(startRuleSv, startRuleEn);
  const { authenticated, data, disabled, downloadResults, raceId, shows } = ws;
  const { data: lists, failed } = useResultListData(raceId, undefined, authenticated && shows("RESULTS"), 15_000);
  const model = useMemo(() => lists ? resultListFromPublic(lists.results, lists.relay, lists.radio) : undefined, [lists]);
  // PLAN.md steg 25: startstämplingens varning och diskens orsak märks bara i arbetsytans lista.
  const notes = useMemo(() => {
    const map = new Map<string, ResultRowNote>();
    for (const entry of data?.entries ?? []) {
      if (!entry.publicResultId || !entry.notes) continue;
      const punch = entry.notes.startPunch;
      map.set(entry.publicResultId, { ...(punch ? { mark: startRule.startPunch.mark[punch.kind],
        detail: startPunchText(punch, data!.timeZone, startRule), warning: punch.kind !== "FROM_PUNCH" } : {}),
        ...(entry.notes.disqualificationReason ? { disqualificationReason: entry.notes.disqualificationReason } : {}) });
    }
    return map;
  }, [data]);
  if (!model || !data) return <p className={styles.muted} role="status">{failed ? listText.results.refreshFailed : listText.results.loading}</p>;
  return <ResultLists model={model} raceId={raceId} race={joinRaceParts([raceTitle(data.eventName, data.raceName), data.raceDate])} raceDate={data.raceDate}
    links={false} iof={{ onSelect: () => void downloadResults(), disabled }} notes={notes}
    status={failed ? <p className={listStyles.notice} role="alert">{listText.results.refreshFailed}</p> : undefined} />;
}

/**
 * Resultat (PLAN.md steg 13): felstämplade att titta på, resultatlistorna (per klass, med sträcktider, per klubb) och
 * under dem efterarbetet: fastställande (typer som har det) och omräkning. En bana rättas med "Redigera bana" (ADR-0169).
 */
export function AfterRacePanel({ ws }: { ws: Workspace }) {
  const reviewText = useTexts(decisionReviewSv, decisionReviewEn);
  const officialText = useTexts(resultsOfficialSv, resultsOfficialEn);
  const text = useTexts(raceAdministratorSv, raceAdministratorEn);
  const navigationText = useTexts(raceWorkspaceNavigationSv, raceWorkspaceNavigationEn);
  const { busy, classRecalculationAttempt, classRecalculationCandidates, classRecalculationError,
    classRecalculationSaved, classRecalculationUnknown, data, disabled, finalizationAttempt, finalizationCandidate,
    finalizationCandidates, finalizationScope, loadClassRecalculation,
    loadFinalizationBasis, pending, prepareClassRecalculation, prepareFinalization, raceId,
    sent, setClassRecalculationAttempt, setClassRecalculationUnknown, setFinalizationAttempt, setFinalizationScope,
    submitClassRecalculation, profile, shows, submitFinalization, unknown, workflowLocked } = ws;
  return <section className={styles.workflowGroup} id={`workflow-${raceId}-results`} aria-label={navigationText.steps.RESULTS}
      hidden={!shows("RESULTS")}>
    <Section id={`results-${raceId}`} title={navigationText.steps.RESULTS} help={text.resultsHelp}
      actions={!workflowLocked && <nav className={styles.contextLinks} aria-label={text.resultsLinks}>
        <Link href={`/results/${raceId}`}>{text.publicResultsLink}</Link>
      </nav>} />
    {/* ADR-0209: påminnelsen efter tävlingen (bara när det finns en klubbyta där kontot är administratör). */}
    {/* Hämtas när Resultat visas, så att banor som lästs in under tiden räknas. */}
    {shows("RESULTS") && <ClubArchiveReminder raceId={raceId} onOpen={() => ws.navigateStep("SETTINGS")} />}
    {data && mispunchedEntries(data).length > 0 && <section className={controlStyles.controlCard} aria-labelledby={`control-mp-${raceId}`}>
      <MispunchedList ws={ws} />
    </section>}
    <AdminResultLists ws={ws} />
    {profile.features.finalization && <ResultsOfficialSection ws={ws} />}
    <Section id={`results-follow-up-${raceId}`} title={text.followUpHeading} help={text.followUpHelp}>
    {/* ADR-0191 beslut 1: en löpares rättelser görs i deltagarkortet; här finns bara vägen dit. */}
    <CorrectionShortcut ws={ws} />
    <div className={styles.disclosureList}>
    {/* Steg 45: beslut som döljer en senare avläsning. */}
    {data && <Disclosure className={styles.disclosure} open={data.entries.some((entry) => entry.decisionReview) ? true : undefined} summary={<>{reviewText.listTitle} ({data.entries.filter((entry) => entry.decisionReview).length})</>}>
      <div className={styles.disclosureBody}><DecisionReviewList ws={ws} /></div>
    </Disclosure>}
    {/* PLAN.md steg 25: efter tävlingen, alla som är kvar utan tecken på start blir ej start. */}
    <Disclosure className={styles.disclosure} open={ws.remaining || ws.remainingMessage ? true : undefined} summary={text.remainingTitle}>
      <RemainingRunnersSection ws={ws} />
    </Disclosure>
    {/* PLAN.md steg 27: hela loppet fastställs med "Resultaten är klara"; en klass i taget bara här. */}
    {profile.features.finalization && <Disclosure className={styles.disclosure} open={finalizationAttempt ? true : undefined} summary={officialText.advanced}>
      <div className={styles.disclosureBody}>
      <p className={styles.workflowHelp}>{officialText.advancedHelp}</p>
      <div><Button variant="secondary" disabled={disabled} onClick={() => void loadFinalizationBasis()}>{text.finalizationLoad}</Button></div>
      {finalizationCandidates && <>
        <Field label={text.finalizationClass} className={styles.narrowField}><select value={finalizationScope} disabled={disabled}
          onChange={event => setFinalizationScope(event.target.value)}>
          <option value="">{text.finalizationChooseClass}</option>
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
    </Disclosure>}
    <Disclosure className={styles.disclosure} open={classRecalculationAttempt ? true : undefined} summary={text.classRecalculationTitle}>
      {data && <ClassResultRecalculation classes={data.classes.map((item) => ({ id: item.id, name: item.name }))}
        disabled={disabled} candidates={classRecalculationCandidates} attempt={classRecalculationAttempt}
        unknown={classRecalculationUnknown} error={classRecalculationError} saved={classRecalculationSaved}
        onLoad={(id) => void loadClassRecalculation(id)} onPrepare={prepareClassRecalculation}
        onSubmit={(value) => void submitClassRecalculation(value)} onRetry={() => classRecalculationAttempt && void submitClassRecalculation(classRecalculationAttempt)}
        onCancel={() => { pending.current = undefined; sent.current = false; setClassRecalculationAttempt(undefined); setClassRecalculationUnknown(false); }} />}
    </Disclosure>
    {/* PLAN.md steg 31: alla med avläsning på en gång, med förhandsvisning av statusbyten. */}
    <RecalculateRace raceId={raceId} onChanged={ws.reloadQuietly} />
    </div>
    </Section>
    {/* Karta och vägval (PLAN.md steg 16): inte för rogaining (inga sträckor) eller stafett (stöds inte än). */}
    {shows("RESULTS") && !profile.features.rogaining && !profile.features.relay && <MapRoutesSection ws={ws} />}
  </section>;
}

/** Fastställda listor (IOF XML) i fastställandet. Den aktuella resultatlistan exporteras från listornas verktygsrad. */
function FinalizedExports({ ws }: { ws: Workspace }) {
  const text = useTexts(raceAdministratorSv, raceAdministratorEn);
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
