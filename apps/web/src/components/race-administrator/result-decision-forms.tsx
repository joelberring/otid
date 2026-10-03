"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { formatStartListTime } from "../../lib/start-list-time";
import { AdministratorEntryChanges } from "../administrator-entry-changes";
import { sv } from "../../i18n/sv";
import type { Workspace } from "./workspace-state";

/** Resultatbeslut för vald deltagare: godkännande, DSQ, NT, OOC, DNF, DNS och ändringshistorik. */
export function ResultDecisionForms({ ws }: { ws: Workspace }) {
  const { action, approvalAttempt, approvalCandidate, approvalHistory, approvalMatches, approvalWithdrawal, busy,
    disabled, dnfAttempt, dnfCandidate, dnfHistory, dnfMatches, dnfWithdrawal, dnsAttempt, dnsCandidate, dnsMatches,
    dnsWithdrawal, dsqAttempt, dsqCandidate, dsqHistory, dsqMatches, dsqWithdrawal, entryChanges, loadApproval,
    loadDnf, loadDns, loadDsq, loadHistory, loadNt, loadOoc, ntAttempt, ntCandidate, ntHistory, ntMatches,
    ntWithdrawal, oocAttempt, oocCandidate, oocHistory, oocMatches, oocWithdrawal, pending, prepareApproval,
    prepareDnf, prepareDns, prepareDsq, prepareNt, prepareOoc, selected, sent, setApprovalAttempt, setDnfAttempt,
    setDnsAttempt, setDsqAttempt, setNtAttempt, setOocAttempt, submitApproval, submitDnf, submitDns, submitDsq,
    submitNt, submitOoc, unknown } = ws;
  return <>
    {action === "APPROVAL" && <section className={styles.workspace} aria-label={text.approvalAction}>
      <h2>{text.approvalAction}</h2>{!approvalAttempt && <p>{text.approvalHelp}</p>}
      {approvalAttempt ? <div className={styles.review} role="alert">
        <h2>{approvalAttempt.kind === "APPROVAL" ? text.approvalReview : text.approvalWithdrawalReview}</h2>
        <p>{approvalAttempt.value.displayName} · {approvalAttempt.value.className}</p>
        <p><strong>{text.decisionStatusChange}: {approvalAttempt.kind === "APPROVAL"
          ? `${sv.publicResultsStatusLabels[approvalAttempt.value.request.expectedResultRevision.status]} → ${sv.publicResultsStatusLabels.OK}`
          : `${sv.publicResultsStatusLabels.OK} → ${sv.publicResultsStatusLabels[approvalAttempt.value.request.expectedRestorationSourceResultRevision.status]}`}</strong></p>
        {approvalAttempt.kind === "APPROVAL" ? <p>{sv.publicResultsReasonLabels[approvalAttempt.value.request.expectedResultRevision.reason]} → {sv.publicResultsReasonLabels.MANUAL_APPROVAL}</p> : <p>{sv.publicResultsReasonLabels[approvalAttempt.value.request.expectedRestorationSourceResultRevision.reason]}</p>}
        <p>{approvalAttempt.kind === "APPROVAL" || approvalAttempt.value.request.expectedRestorationSourceResultRevision.status === "OK" ? text.approvalRanked : text.approvalUnranked}</p>
        <p>{approvalAttempt.kind === "APPROVAL" ? text.approvalCompactConsequence : text.decisionWithdrawalConsequence}</p>
        <details key={approvalAttempt.value.requestId}>
          <summary>{text.decisionRevisionDetails}</summary>
          {approvalAttempt.kind === "APPROVAL" ? <>
            <p>{text.approvalTarget}: {approvalAttempt.value.request.expectedResultRevision.revision}</p>
            <p>{text.approvalDecisionWarning}</p>
          </> : <>
            <p>{text.approvalTarget}: {approvalAttempt.value.request.expectedTargetResultRevision.revision} · {text.approvalDecisionRevision}: {approvalAttempt.value.request.expectedApprovedResultRevision.revision}</p>
            <p>{text.approvalAbsolute}: {approvalAttempt.value.request.expectedAbsoluteResultRevision.revision}</p>
            <p>{text.approvalSource}: {approvalAttempt.value.request.expectedRestorationSourceResultRevision.revision}</p>
            <p>{text.approvalWithdrawalWarning}</p>
          </>}
        </details>
        {unknown && <p>{text.approvalUnknown}</p>}
        <button disabled={busy} onClick={() => void submitApproval(approvalAttempt)}>{unknown ? text.retry : approvalAttempt.kind === "APPROVAL" ? text.approvalConfirm : text.approvalWithdrawalConfirm}</button>
        {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setApprovalAttempt(undefined); }}>{text.cancel}</button>}
      </div> : <>
        <button type="button" className="secondary" disabled={disabled || !selected} onClick={() => void loadApproval()}>{text.approvalRefresh}</button>
        {!selected ? <p>{text.chooseParticipant}</p> : !approvalMatches ? <p>{text.approvalLoadError}</p> : <>
          {approvalCandidate && <p>{text.approvalReadiness[approvalCandidate.readiness]}</p>}
          {approvalCandidate?.targetResultRevision && <p>{text.approvalTarget}: {approvalCandidate.targetResultRevision.revision} · {sv.publicResultsStatusLabels[approvalCandidate.targetResultRevision.status]}</p>}
          {approvalCandidate?.readiness === "READY" && <button disabled={disabled} onClick={() => prepareApproval(false)}>{text.approvalInspect}</button>}
          {approvalWithdrawal ? <>
            <p>{text.approvalWithdrawalReady}</p>
            <p>{text.approvalSource}: {approvalWithdrawal.restorationSourceResultRevision.revision} · {sv.publicResultsStatusLabels[approvalWithdrawal.restorationSourceResultRevision.status]} · {text.approvalAbsolute}: {approvalWithdrawal.absoluteResultRevision.revision}</p>
            <button disabled={disabled} onClick={() => prepareApproval(true)}>{text.approvalWithdrawalInspect}</button>
          </> : approvalHistory.some((row) => row.state === "WITHDRAWN") && <p>{text.approvalWithdrawn}</p>}
        </>}
      </>}
    </section>}
    {action === "DSQ" && <section className={styles.workspace} aria-label={text.dsqAction}>
      <h2>{text.dsqAction}</h2>{!dsqAttempt && <p>{text.dsqHelp}</p>}
      {dsqAttempt ? <div className={styles.review} role="alert">
        <h2>{dsqAttempt.kind === "DSQ" ? text.dsqReview : text.dsqWithdrawalReview}</h2>
        <p>{dsqAttempt.value.displayName} · {dsqAttempt.value.className}</p>
        <p><strong>{text.decisionStatusChange}: {dsqAttempt.kind === "DSQ"
          ? `${sv.publicResultsStatusLabels[dsqAttempt.value.request.expectedResultRevision.status]} → ${sv.publicResultsStatusLabels.DSQ}`
          : `${sv.publicResultsStatusLabels.DSQ} → ${sv.publicResultsStatusLabels[dsqAttempt.value.request.expectedRestorationSourceResultRevision.status]}`}</strong></p>
        {dsqAttempt.kind === "DSQ_WITHDRAWAL" && <p>{sv.publicResultsReasonLabels[dsqAttempt.value.request.expectedRestorationSourceResultRevision.reason]}</p>}
        <p>{dsqAttempt.kind === "DSQ" ? text.dsqCompactConsequence : text.decisionWithdrawalConsequence}</p>
        <details key={dsqAttempt.value.requestId}>
          <summary>{text.decisionRevisionDetails}</summary>
          {dsqAttempt.kind === "DSQ" ? <>
            <p>{text.dsqTarget}: {dsqAttempt.value.request.expectedResultRevision.revision}</p>
            <p>{text.dsqDecisionWarning}</p>
          </> : <>
            <p>{text.dsqTarget}: {dsqAttempt.value.request.expectedTargetResultRevision.revision} · {text.dsqDecisionRevision}: {dsqAttempt.value.request.expectedDisqualifiedResultRevision.revision}</p>
            <p>{text.dsqAbsolute}: {dsqAttempt.value.request.expectedAbsoluteResultRevision.revision}</p>
            <p>{text.dsqSource}: {dsqAttempt.value.request.expectedRestorationSourceResultRevision.revision}</p>
            <p>{text.dsqWithdrawalWarning}</p>
          </>}
        </details>
        {unknown && <p>{text.dsqUnknown}</p>}
        <button disabled={busy} onClick={() => void submitDsq(dsqAttempt)}>{unknown ? text.retry : dsqAttempt.kind === "DSQ" ? text.dsqConfirm : text.dsqWithdrawalConfirm}</button>
        {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setDsqAttempt(undefined); }}>{text.cancel}</button>}
      </div> : <>
        <button type="button" className="secondary" disabled={disabled || !selected} onClick={() => void loadDsq()}>{text.dsqRefresh}</button>
        {!selected ? <p>{text.chooseParticipant}</p> : !dsqMatches ? <p>{text.dsqLoadError}</p> : <>
          {dsqCandidate && <p>{text.dsqReadiness[dsqCandidate.readiness]}</p>}
          {dsqCandidate?.targetResultRevision && <p>{text.dsqTarget}: {dsqCandidate.targetResultRevision.revision} · {sv.publicResultsStatusLabels[dsqCandidate.targetResultRevision.status]}</p>}
          {dsqCandidate?.readiness === "READY" && <button disabled={disabled} onClick={() => prepareDsq(false)}>{text.dsqInspect}</button>}
          {dsqWithdrawal ? <>
            <p>{text.dsqWithdrawalReady}</p>
            <p>{text.dsqSource}: {dsqWithdrawal.restorationSourceResultRevision.revision} · {sv.publicResultsStatusLabels[dsqWithdrawal.restorationSourceResultRevision.status]} · {text.dsqAbsolute}: {dsqWithdrawal.absoluteResultRevision.revision}</p>
            <button disabled={disabled} onClick={() => prepareDsq(true)}>{text.dsqWithdrawalInspect}</button>
          </> : dsqHistory.some((row) => row.state === "WITHDRAWN") && <p>{text.dsqWithdrawn}</p>}
        </>}
      </>}
    </section>}
    {action === "NT" && <section className={styles.workspace} aria-label={text.ntAction}>
      <h2>{text.ntAction}</h2>{!ntAttempt && <p>{text.ntHelp}</p>}
      {ntAttempt ? <div className={styles.review} role="alert">
        <h2>{ntAttempt.kind === "NT" ? text.ntReview : text.ntWithdrawalReview}</h2>
        <p>{ntAttempt.value.displayName} · {ntAttempt.value.className}</p>
        <p><strong>{text.decisionStatusChange}: {ntAttempt.kind === "NT"
          ? `${sv.publicResultsStatusLabels[ntAttempt.value.request.expectedResultRevision.status]} → ${sv.publicResultsStatusLabels.NT}`
          : `${sv.publicResultsStatusLabels.NT} → ${sv.publicResultsStatusLabels[ntAttempt.value.request.expectedRestorationSourceResultRevision.status]}`}</strong></p>
        {ntAttempt.kind === "NT_WITHDRAWAL" && <p>{sv.publicResultsReasonLabels[ntAttempt.value.request.expectedRestorationSourceResultRevision.reason]}</p>}
        <p>{ntAttempt.kind === "NT" ? text.ntCompactConsequence : text.decisionWithdrawalConsequence}</p>
        <details key={ntAttempt.value.requestId}>
          <summary>{text.decisionRevisionDetails}</summary>
          {ntAttempt.kind === "NT" ? <>
            <p>{text.ntTarget}: {ntAttempt.value.request.expectedResultRevision.revision}</p>
            <p>{text.ntDecisionWarning}</p>
          </> : <>
            <p>{text.ntTarget}: {ntAttempt.value.request.expectedTargetResultRevision.revision} · {text.ntDecisionRevision}: {ntAttempt.value.request.expectedWithoutTimingResultRevision.revision}</p>
            <p>{text.ntAbsolute}: {ntAttempt.value.request.expectedAbsoluteResultRevision.revision}</p>
            <p>{text.ntSource}: {ntAttempt.value.request.expectedRestorationSourceResultRevision.revision}</p>
            <p>{text.ntWithdrawalWarning}</p>
          </>}
        </details>
        {unknown && <p>{text.ntUnknown}</p>}
        <button disabled={busy} onClick={() => void submitNt(ntAttempt)}>{unknown ? text.retry : ntAttempt.kind === "NT" ? text.ntConfirm : text.ntWithdrawalConfirm}</button>
        {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setNtAttempt(undefined); }}>{text.cancel}</button>}
      </div> : <>
        <button type="button" className="secondary" disabled={disabled || !selected} onClick={() => void loadNt()}>{text.ntRefresh}</button>
        {!selected ? <p>{text.chooseParticipant}</p> : !ntMatches ? <p>{text.ntLoadError}</p> : <>
          {ntCandidate && <p>{text.ntReadiness[ntCandidate.readiness]}</p>}
          {ntCandidate?.targetResultRevision && <p>{text.ntTarget}: {ntCandidate.targetResultRevision.revision} · {sv.publicResultsStatusLabels[ntCandidate.targetResultRevision.status]}</p>}
          {ntCandidate?.readiness === "READY" && <button disabled={disabled} onClick={() => prepareNt(false)}>{text.ntInspect}</button>}
          {ntWithdrawal ? <>
            <p>{text.ntWithdrawalReady}</p>
            <p>{text.ntSource}: {ntWithdrawal.restorationSourceResultRevision.revision} · {sv.publicResultsStatusLabels[ntWithdrawal.restorationSourceResultRevision.status]} · {text.ntAbsolute}: {ntWithdrawal.absoluteResultRevision.revision}</p>
            <button disabled={disabled} onClick={() => prepareNt(true)}>{text.ntWithdrawalInspect}</button>
          </> : ntHistory.some((row) => row.state === "WITHDRAWN") && <p>{text.ntWithdrawn}</p>}
        </>}
      </>}
    </section>}
    {action === "OOC" && <section className={styles.workspace} aria-label={text.oocAction}>
      <h2>{text.oocAction}</h2>{!oocAttempt && <p>{text.oocHelp}</p>}
      {oocAttempt ? <div className={styles.review} role="alert">
        <h2>{oocAttempt.kind === "OOC" ? text.oocReview : text.oocWithdrawalReview}</h2>
        <p>{oocAttempt.value.displayName} · {oocAttempt.value.className}</p>
        <p><strong>{text.decisionStatusChange}: {oocAttempt.kind === "OOC"
          ? `${sv.publicResultsStatusLabels[oocAttempt.value.request.expectedResultRevision.status]} → ${sv.publicResultsStatusLabels.OOC}`
          : `${sv.publicResultsStatusLabels.OOC} → ${sv.publicResultsStatusLabels[oocAttempt.value.request.expectedRestorationSourceResultRevision.status]}`}</strong></p>
        {oocAttempt.kind === "OOC_WITHDRAWAL" && <p>{sv.publicResultsReasonLabels[oocAttempt.value.request.expectedRestorationSourceResultRevision.reason]}</p>}
        <p>{oocAttempt.kind === "OOC" ? text.oocCompactConsequence : text.decisionWithdrawalConsequence}</p>
        <details key={oocAttempt.value.requestId}>
          <summary>{text.decisionRevisionDetails}</summary>
          {oocAttempt.kind === "OOC" ? <>
            <p>{text.oocTarget}: {oocAttempt.value.request.expectedResultRevision.revision}</p>
            <p>{text.oocDecisionWarning}</p>
          </> : <>
            <p>{text.oocTarget}: {oocAttempt.value.request.expectedTargetResultRevision.revision} · {text.oocDecisionRevision}: {oocAttempt.value.request.expectedOutOfCompetitionResultRevision.revision}</p>
            <p>{text.oocAbsolute}: {oocAttempt.value.request.expectedAbsoluteResultRevision.revision}</p>
            <p>{text.oocSource}: {oocAttempt.value.request.expectedRestorationSourceResultRevision.revision}</p>
            <p>{text.oocWithdrawalWarning}</p>
          </>}
        </details>
        {unknown && <p>{text.oocUnknown}</p>}
        <button disabled={busy} onClick={() => void submitOoc(oocAttempt)}>{unknown ? text.retry : oocAttempt.kind === "OOC" ? text.oocConfirm : text.oocWithdrawalConfirm}</button>
        {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setOocAttempt(undefined); }}>{text.cancel}</button>}
      </div> : <>
        <button type="button" className="secondary" disabled={disabled || !selected} onClick={() => void loadOoc()}>{text.oocRefresh}</button>
        {!selected ? <p>{text.chooseParticipant}</p> : !oocMatches ? <p>{text.oocLoadError}</p> : <>
          {oocCandidate && <p>{text.oocReadiness[oocCandidate.readiness]}</p>}
          {oocCandidate?.targetResultRevision && <p>{text.oocTarget}: {oocCandidate.targetResultRevision.revision} · {sv.publicResultsStatusLabels[oocCandidate.targetResultRevision.status]}</p>}
          {oocCandidate?.readiness === "READY" && <button disabled={disabled} onClick={() => prepareOoc(false)}>{text.oocInspect}</button>}
          {oocWithdrawal ? <>
            <p>{text.oocWithdrawalReady}</p>
            <p>{text.oocSource}: {oocWithdrawal.restorationSourceResultRevision.revision} · {sv.publicResultsStatusLabels[oocWithdrawal.restorationSourceResultRevision.status]} · {text.oocAbsolute}: {oocWithdrawal.absoluteResultRevision.revision}</p>
            <button disabled={disabled} onClick={() => prepareOoc(true)}>{text.oocWithdrawalInspect}</button>
          </> : oocHistory.some((row) => row.state === "WITHDRAWN") && <p>{text.oocWithdrawn}</p>}
        </>}
      </>}
    </section>}
    {action === "DNF" && <section className={styles.workspace} aria-label={text.dnfAction}>
      <h2>{text.dnfAction}</h2>{!dnfAttempt && <p>{text.dnfHelp}</p>}
      {dnfAttempt ? <div className={styles.review} role="alert">
        <h2>{dnfAttempt.kind === "DNF" ? text.dnfReview : text.dnfWithdrawalReview}</h2>
        <p>{dnfAttempt.value.displayName} · {dnfAttempt.value.className}</p>
        <p><strong>{text.decisionStatusChange}: {dnfAttempt.kind === "DNF"
          ? `${sv.publicResultsStatusLabels[dnfAttempt.value.request.expectedResultRevision.status]} → ${sv.publicResultsStatusLabels.DNF}`
          : `${sv.publicResultsStatusLabels.DNF} → ${sv.publicResultsStatusLabels[dnfAttempt.value.request.expectedRestorationSourceResultRevision.status]}`}</strong></p>
        {dnfAttempt.kind === "DNF_WITHDRAWAL" && <p>{sv.publicResultsReasonLabels[dnfAttempt.value.request.expectedRestorationSourceResultRevision.reason]}</p>}
        <p>{dnfAttempt.kind === "DNF" ? text.dnfCompactConsequence : text.decisionWithdrawalConsequence}</p>
        <details key={dnfAttempt.value.requestId}>
          <summary>{text.decisionRevisionDetails}</summary>
          {dnfAttempt.kind === "DNF" ? <>
            <p>{text.dnfTarget}: {dnfAttempt.value.request.expectedResultRevision.revision}</p>
            <p>{text.dnfDecisionWarning}</p>
          </> : <>
            <p>{text.dnfTarget}: {dnfAttempt.value.request.expectedTargetResultRevision.revision} · {text.dnfDecisionRevision}: {dnfAttempt.value.request.expectedDidNotFinishResultRevision.revision}</p>
            <p>{text.dnfAbsolute}: {dnfAttempt.value.request.expectedAbsoluteResultRevision.revision}</p>
            <p>{text.dnfSource}: {dnfAttempt.value.request.expectedRestorationSourceResultRevision.revision}</p>
            <p>{text.dnfWithdrawalWarning}</p>
          </>}
        </details>
        {unknown && <p>{text.dnfUnknown}</p>}
        <button disabled={busy} onClick={() => void submitDnf(dnfAttempt)}>{unknown ? text.retry : dnfAttempt.kind === "DNF" ? text.dnfConfirm : text.dnfWithdrawalConfirm}</button>
        {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setDnfAttempt(undefined); }}>{text.cancel}</button>}
      </div> : <>
        <button type="button" className="secondary" disabled={disabled || !selected} onClick={() => void loadDnf()}>{text.dnfRefresh}</button>
        {!selected ? <p>{text.chooseParticipant}</p> : !dnfMatches ? <p>{text.dnfLoadError}</p> : <>
          {dnfCandidate && <p>{text.dnfReadiness[dnfCandidate.readiness]}</p>}
          {dnfCandidate?.targetResultRevision && <p>{text.dnfTarget}: {dnfCandidate.targetResultRevision.revision} · {sv.publicResultsStatusLabels[dnfCandidate.targetResultRevision.status]}</p>}
          {dnfCandidate?.readiness === "READY" && <button disabled={disabled} onClick={() => prepareDnf(false)}>{text.dnfInspect}</button>}
          {dnfWithdrawal ? <>
            <p>{text.dnfWithdrawalReady}</p>
            <p>{text.dnfSource}: {dnfWithdrawal.restorationSourceResultRevision.revision} · {sv.publicResultsStatusLabels[dnfWithdrawal.restorationSourceResultRevision.status]} · {text.dnfAbsolute}: {dnfWithdrawal.absoluteResultRevision.revision}</p>
            <button disabled={disabled} onClick={() => prepareDnf(true)}>{text.dnfWithdrawalInspect}</button>
          </> : dnfHistory.some((row) => row.state === "WITHDRAWN") && <p>{text.dnfWithdrawn}</p>}
        </>}
      </>}
    </section>}
    {action === "DNS" && <section className={styles.workspace} aria-label={text.dnsAction}>
      <h2>{text.dnsAction}</h2><p>{text.dnsHelp}</p>
      {dnsAttempt ? <div className={styles.review} role="alert">
        <h2>{dnsAttempt.kind === "DNS" ? text.dnsReview : text.dnsWithdrawalReview}</h2>
        <p>{dnsAttempt.value.displayName} · {dnsAttempt.value.className}</p>
        <p>{dnsAttempt.kind === "DNS" ? text.dnsDecisionWarning : text.dnsWithdrawalWarning}</p>
        {unknown && <p>{text.dnsUnknown}</p>}
        <button disabled={busy} onClick={() => void submitDns(dnsAttempt)}>{unknown ? text.retry : dnsAttempt.kind === "DNS" ? text.dnsConfirm : text.dnsWithdrawalConfirm}</button>
        {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setDnsAttempt(undefined); }}>{text.cancel}</button>}
      </div> : <>
        <button type="button" className="secondary" disabled={disabled || !selected} onClick={() => void loadDns()}>{text.dnsRefresh}</button>
        {!selected ? <p>{text.chooseParticipant}</p> : !dnsMatches ? <p>{text.dnsLoadError}</p> : <>
          <p>{dnsCandidate?.readiness === "READY" ? text.dnsReady : text.dnsHasResult}</p>
          {dnsCandidate?.readiness === "READY" && <button disabled={disabled} onClick={() => prepareDns(false)}>{text.dnsInspect}</button>}
          {dnsWithdrawal && <p>{text.dnsWithdrawalStates[dnsWithdrawal.state]}</p>}
          {dnsWithdrawal?.state === "WITHDRAWABLE" && <button disabled={disabled} onClick={() => prepareDns(true)}>{text.dnsWithdrawalInspect}</button>}
        </>}
      </>}
    </section>}
    {action === "HISTORY" && <section className={styles.workspace} aria-label={text.historyAction}>
      <h2>{text.historyAction}</h2><p>{text.historyHelp}</p>
      <button type="button" className="secondary" disabled={disabled || !selected} onClick={() => void loadHistory()}>{text.historyRefresh}</button>
      {!selected ? <p>{text.chooseParticipant}</p> : entryChanges?.entryId === selected.id ? <>
        <AdministratorEntryChanges data={entryChanges} />
        {entryChanges.nextBeforeVersion !== null && <button type="button" className="secondary" disabled={disabled}
          onClick={() => void loadHistory(selected.id, entryChanges.nextBeforeVersion ?? undefined)}>{text.historyOlder}</button>}
      </> : <p>{text.historyNotLoaded}</p>}
    </section>}
  </>;
}

/** Omräkning av vald deltagares resultat. */
export function RecalculationForm({ ws }: { ws: Workspace }) {
  const { action, busy, data, disabled, loadRecalculation, pending, prepareRecalculation, recalculationAttempt,
    recalculationCandidate, recalculationCandidates, recalculationMatches, selected, sent, setRecalculationAttempt,
    submitRecalculation, unknown } = ws;
  return <>
    {action === "RECALCULATION" && <section className={styles.workspace} aria-label={text.recalculationAction}>
      <h2>{text.recalculationAction}</h2><p className={styles.warning}>{text.recalculationWarning}</p>
      {recalculationAttempt ? <div className={styles.review} role="alert"><h2>{text.recalculationReview}</h2>
        <p>{recalculationAttempt.value.displayName} · {recalculationAttempt.value.className}</p>
        <p>{text.latestReadout}: {formatStartListTime(recalculationAttempt.value.readAt, recalculationAttempt.timeZone)}</p>
        <p>{text.snapshot}: {recalculationAttempt.value.expectedSnapshotVersion} · {text.engine}: {recalculationAttempt.value.expectedEngineVersion}</p>
        <p>{text.latestRevision}: {recalculationAttempt.value.expectedLatestResultRevision?.revision ?? text.noRevision}</p>
        {unknown && <p>{text.recalculationUnknown}</p>}
        <button disabled={busy} onClick={() => void submitRecalculation(recalculationAttempt)}>{unknown ? text.retry : text.recalculationConfirm}</button>
        {!unknown && <button className="secondary" disabled={busy} onClick={() => {
          pending.current = undefined; sent.current = false; setRecalculationAttempt(undefined);
        }}>{text.cancel}</button>}
      </div> : <>
        <button className="secondary" disabled={disabled} onClick={() => void loadRecalculation()}>{text.recalculationRefresh}</button>
        {!selected ? <p>{text.chooseParticipant}</p> : !recalculationMatches || !recalculationCandidate || !data ? <p>{text.recalculationLoadError}</p> : <>
          <p>{text.snapshot}: {recalculationCandidates?.snapshotVersion} · {text.engine}: {recalculationCandidates?.engineVersion}</p>
          <p>{text.latestRevision}: {recalculationCandidate.latestResultRevision ? `${recalculationCandidate.latestResultRevision.revision} · ${recalculationCandidate.latestResultRevision.status}/${recalculationCandidate.latestResultRevision.reason}` : text.noRevision}</p>
          {recalculationCandidate.latestReadout && <p>{text.latestReadout}: {formatStartListTime(recalculationCandidate.latestReadout.readAt, data.timeZone)}</p>}
          {recalculationCandidate.readiness === "READY" ? <button disabled={disabled} onClick={prepareRecalculation}>{text.recalculationInspect}</button> : <p>{text.recalculationReadiness[recalculationCandidate.readiness]}</p>}
        </>}
      </>}
    </section>}
  </>;
}
