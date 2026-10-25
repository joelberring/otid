"use client";

import styles from "../race-administrator-workspace.module.css";
import relayStyles from "./relay.module.css";
import { relaySv as text } from "../../i18n/relay-sv";
import { Button, Notice } from "../ui";
import type { RelayLegForm } from "./relay-actions";
import type { Workspace } from "./workspace-state";
import { RelayMessages, useRelayLoad } from "./relay-panels";

const METHODS = ["MASS_START", "CHANGEOVER", "RESTART", "FLYING_RESTART"] as const;

/**
 * Sträckorna i stafettklassens formulär (ny och ändrad klass): startsätt, tid eller minuter efter ledaren, bana och
 * variant per sträcka. Steg 47: upp till 30 sträckor; på mobil två kolumner per sträcka.
 */
function LegRows({ ws, locked, classCourseId, idPrefix }: { ws: Workspace; locked: boolean; classCourseId: string; idPrefix: string }) {
  const { changeLeg, courseList, relayLegForms } = ws;
  return <div className={relayStyles.legs}>
    {relayLegForms.map((leg: RelayLegForm, index: number) => {
      const method = index === 0 ? "MASS_START" : leg.method;
      const legCourse = courseList?.courses.find(row => row.courseId === (leg.course || classCourseId));
      const fieldId = (name: string) => `${idPrefix}-${name}-${index + 1}`;
      // Etiketten står bredvid fältet (htmlFor), så att fältets namn inte får med alternativen i listan.
      return <div key={index} className={relayStyles.leg}>
        <span className={relayStyles.legName}>{text.leg(index + 1)}</span>
        <div className={relayStyles.legField}><label htmlFor={fieldId("method")}>{text.legMethod(index + 1)}</label>
          <select id={fieldId("method")} value={method} disabled={locked || index === 0}
            onChange={event => changeLeg(index, { method: event.target.value as RelayLegForm["method"] })}>
            {METHODS.map(value => <option key={value} value={value}>{text.methods[value]}</option>)}
          </select></div>
        {method === "MASS_START" || method === "RESTART"
          ? <div className={relayStyles.legField}><label htmlFor={fieldId("time")}>{text.legTime(index + 1, method)}</label>
            <input id={fieldId("time")} value={leg.time} inputMode="numeric" placeholder={text.timeExample}
              autoComplete="off" disabled={locked} onChange={event => changeLeg(index, { time: event.target.value })} /></div>
          : method === "FLYING_RESTART"
            ? <div className={relayStyles.legField}><label htmlFor={fieldId("minutes")}>{text.legRestartAfter(index + 1)}</label>
              <input id={fieldId("minutes")} value={leg.minutes} inputMode="numeric" placeholder={text.restartAfterExample}
                autoComplete="off" disabled={locked} onChange={event => changeLeg(index, { minutes: event.target.value })} /></div>
            : <span />}
        <div className={relayStyles.legField}><label htmlFor={fieldId("course")}>{text.legCourse(index + 1)}</label>
          <select id={fieldId("course")} value={leg.course} disabled={locked}
            onChange={event => changeLeg(index, { course: event.target.value, variant: "" })}>
            <option value="">{text.classCourseOption}</option>
            {courseList?.courses.map(row => <option key={row.courseId} value={row.courseId}>{row.name}</option>)}
          </select></div>
        {legCourse && legCourse.variants.length > 0 ? <div className={relayStyles.legField}>
          <label htmlFor={fieldId("variant")}>{text.legVariant(index + 1)}</label>
          <select id={fieldId("variant")} value={leg.variant} disabled={locked} onChange={event => changeLeg(index, { variant: event.target.value })}>
            <option value="">{text.forkedVariants}</option>
            {legCourse.variants.map(variant => <option key={variant.code} value={variant.code}>{variant.code}</option>)}
          </select></div> : <span />}
      </div>;
    })}
  </div>;
}

/** Placering av lag i omstart och gaffling: klassens inställningar. */
function ClassSettings({ ws, locked, idPrefix }: { ws: Workspace; locked: boolean; idPrefix: string }) {
  const { relayForking, relayRestartRanking, setRelayForking, setRelayRestartRanking } = ws;
  return <div className={`${styles.fieldRow} ${relayStyles.settings}`}>
    <label htmlFor={`${idPrefix}-ranking`}>{text.restartRanking}<select id={`${idPrefix}-ranking`} value={relayRestartRanking} disabled={locked}
      onChange={event => setRelayRestartRanking(event.target.value as typeof relayRestartRanking)}>
      {(["AFTER_NORMAL", "BY_TIME"] as const).map(value => <option key={value} value={value}>{text.restartRankings[value]}</option>)}
    </select></label>
    <label htmlFor={`${idPrefix}-forking`}>{text.forking}<select id={`${idPrefix}-forking`} value={relayForking} disabled={locked}
      onChange={event => setRelayForking(event.target.value as typeof relayForking)}>
      {(["EVEN", "UNEVEN"] as const).map(value => <option key={value} value={value}>{text.forkings[value]}</option>)}
    </select></label>
  </div>;
}

/** Klasser: "Ny stafettklass" med bana, antal sträckor och startsätt, bana och variant per sträcka. */
export function RelayClassForm({ ws, visible }: { ws: Workspace; visible: boolean }) {
  const { changeLegCount, courseList, createRelayClass, raceId, relayClassAttempt, relayClassCourseId, relayClassName,
    relayEditClassId, relayLegForms, setRelayClassCourseId, setRelayClassName, workflowLocked } = ws;
  useRelayLoad(ws, visible);
  const locked = workflowLocked || !!relayClassAttempt;
  const id = `relay-class-${raceId}`;
  return <>{visible && <RelayMessages ws={ws} />}{!relayEditClassId && <details className={styles.disclosure} open={relayClassAttempt ? true : undefined}>
    <summary>{text.newClass}</summary>
    <form noValidate className={styles.disclosureBody} aria-label={text.newClass} onSubmit={event => { event.preventDefault(); void createRelayClass(); }}>
      <p className={styles.workflowHelp}>{text.newClassHelp}</p>
      <div className={styles.fieldRow}>
        <label htmlFor={`${id}-name`}>{text.className}<input id={`${id}-name`} value={relayClassName} maxLength={160} required
          autoComplete="off" disabled={locked} onChange={event => setRelayClassName(event.target.value)} /></label>
        <label htmlFor={`${id}-course`}>{text.course}<select id={`${id}-course`} value={relayClassCourseId} required disabled={locked}
          onChange={event => setRelayClassCourseId(event.target.value)}>
          <option value="">{text.chooseCourse}</option>
          {courseList?.courses.map(row => <option key={row.courseId} value={row.courseId}>{row.name}</option>)}
        </select></label>
        <label htmlFor={`${id}-legs`}>{text.legCount}<select id={`${id}-legs`} value={relayLegForms.length} disabled={locked}
          onChange={event => changeLegCount(Number(event.target.value))}>
          {Array.from({ length: 29 }, (_, index) => index + 2).map(count => <option key={count} value={count}>{count}</option>)}
        </select></label>
      </div>
      <ClassSettings ws={ws} locked={locked} idPrefix={id} />
      <p className={styles.workflowHelp}>{text.methodHelp}</p>
      <LegRows ws={ws} locked={locked} classCourseId={relayClassCourseId} idPrefix={id} />
      <div className={styles.actions}><Button type="submit" disabled={workflowLocked}>{text.saveClass}</Button></div>
    </form>
  </details>}<RelayClassEdit ws={ws} /></>;
}

/** "Ändra stafettklass": välj klass, ändra och spara; byter resultat status visas beskedet först. */
function RelayClassEdit({ ws }: { ws: Workspace }) {
  const { busy, cancelRelayClassEdit, changeLegCount, raceId, relay, relayClassName, relayEditAttempt, relayEditClassId, relayEditPreview,
    relayLegForms, saveRelayClassEdit, setRelayClassName, startRelayClassEdit, workflowLocked } = ws;
  if (!relay || relay.classes.length === 0) return null;
  const raceClass = relay.classes.find(row => row.id === relayEditClassId);
  const locked = busy || !!relayEditAttempt || !!relayEditPreview;
  const id = `relay-edit-${raceId}`;
  return <details className={styles.disclosure} open={relayEditClassId ? true : undefined}>
    <summary>{text.editClass}</summary>
    <div className={styles.disclosureBody}>
      <p className={styles.workflowHelp}>{text.editClassHelp}</p>
      <label htmlFor={`${id}-class`}>{text.editChooseClass}<select id={`${id}-class`} value={relayEditClassId} disabled={locked || workflowLocked}
        onChange={event => event.target.value ? startRelayClassEdit(event.target.value) : cancelRelayClassEdit()}>
        <option value="">{text.chooseClass}</option>
        {relay.classes.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>
      {raceClass && <form noValidate aria-label={text.editClass} onSubmit={event => { event.preventDefault(); void saveRelayClassEdit(false); }}>
        <div className={styles.fieldRow}>
          <label htmlFor={`${id}-name`}>{text.className}<input id={`${id}-name`} value={relayClassName} maxLength={160} required
            autoComplete="off" disabled={locked} onChange={event => setRelayClassName(event.target.value)} /></label>
          <label htmlFor={`${id}-legs`}>{text.legCount}<select id={`${id}-legs`} value={relayLegForms.length} disabled={locked}
            onChange={event => changeLegCount(Number(event.target.value))}>
            {Array.from({ length: 29 }, (_, index) => index + 2).map(count => <option key={count} value={count}>{count}</option>)}
          </select></label>
        </div>
        <ClassSettings ws={ws} locked={locked} idPrefix={id} />
        <LegRows ws={ws} locked={locked} classCourseId={raceClass.courseId} idPrefix={id} />
        {relayEditPreview && <Notice tone="attention" role="alert">
          <p><strong>{text.editConfirmTitle}</strong></p>
          {relayEditPreview.changes.length > 0 && <><p>{text.editConfirmChanges(relayEditPreview.changes.length)}</p>
            <ul>{relayEditPreview.changes.map(change => <li key={`${change.teamNumber}:${change.leg}`}>
              {text.editConfirmChange(change.teamNumber, change.leg, change.displayName, text.statusWord[change.before], text.statusWord[change.after])}
            </li>)}</ul></>}
          {relayEditPreview.removedLegs.length > 0 && <p>{text.editConfirmRemoved(relayEditPreview.removedLegs)}</p>}
          <p>{text.editConfirmRecalculated(relayEditPreview.recalculatedCount)}</p>
          <div className={styles.actions}>
            <Button type="button" disabled={busy} onClick={() => void saveRelayClassEdit(true)}>{text.editConfirm}</Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={cancelRelayClassEdit}>{text.cancel}</Button>
          </div>
        </Notice>}
        {!relayEditPreview && <div className={styles.actions}>
          <Button type="submit" disabled={locked}>{text.saveEdit}</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={cancelRelayClassEdit}>{text.cancel}</Button>
        </div>}
      </form>}
    </div>
  </details>;
}
