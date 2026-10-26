"use client";

import styles from "../race-administrator-workspace.module.css";
import uiStyles from "../ui/ui.module.css";
import relayStyles from "./relay.module.css";
import { relaySv as text } from "../../i18n/relay-sv";
import { relayFormSv as formText } from "../../i18n/relay-form-sv";
import { Button, Notice } from "../ui";
import type { RelayLegForm } from "./relay-actions";
import { RELAY_TEMPLATES } from "./relay-templates";
import type { Workspace } from "./workspace-state";
import { RelayMessages, useRelayLoad } from "./relay-panels";
import { RelayErrorSummary, RelayField } from "./relay-fields";

const METHODS = ["MASS_START", "CHANGEOVER", "RESTART", "FLYING_RESTART"] as const;

const legKeys = (count: number) => Array.from({ length: count }, (_, index) => [`course-${index + 1}`, `time-${index + 1}`,
  `minutes-${index + 1}`]).flat();

/**
 * Sträckorna i stafettklassens formulär (ny och ändrad klass): bana (krävs), startsätt, tid eller minuter efter ledaren,
 * löpare och variant per sträcka. Steg 47: upp till 30 sträckor; på mobil två kolumner per sträcka.
 */
function LegRows({ ws, locked, idPrefix }: { ws: Workspace; locked: boolean; idPrefix: string }) {
  const { changeLeg, courseList, relayClassErrors: errors, relayLegForms } = ws;
  return <div className={relayStyles.legs}>
    {relayLegForms.map((leg: RelayLegForm, index: number) => {
      const method = index === 0 ? "MASS_START" : leg.method;
      const legCourse = courseList?.courses.find(row => row.courseId === leg.course);
      const fieldId = (name: string) => `${idPrefix}-${name}-${index + 1}`;
      const number = index + 1;
      return <div key={index} className={relayStyles.leg}>
        <span className={relayStyles.legName}>{text.leg(number)}</span>
        <RelayField id={fieldId("course")} label={formText.legCourse(number)} error={errors[`course-${number}`]}>
          <select value={leg.course} disabled={locked} onChange={event => changeLeg(index, { course: event.target.value, variant: "" })}>
            <option value="">{formText.chooseLegCourse}</option>
            {courseList?.courses.map(row => <option key={row.courseId} value={row.courseId}>{row.name}</option>)}
          </select></RelayField>
        <RelayField id={fieldId("method")} label={text.legMethod(number)}>
          <select value={method} disabled={locked || index === 0}
            onChange={event => changeLeg(index, { method: event.target.value as RelayLegForm["method"] })}>
            {METHODS.map(value => <option key={value} value={value}>{text.methods[value]}</option>)}
          </select></RelayField>
        {method === "MASS_START" || method === "RESTART"
          ? <RelayField id={fieldId("time")} label={text.legTime(number, method)} error={errors[`time-${number}`]}>
            <input value={leg.time} inputMode="numeric" placeholder={text.timeExample} autoComplete="off" disabled={locked}
              onChange={event => changeLeg(index, { time: event.target.value })} /></RelayField>
          : method === "FLYING_RESTART"
            ? <RelayField id={fieldId("minutes")} label={text.legRestartAfter(number)} error={errors[`minutes-${number}`]}>
              <input value={leg.minutes} inputMode="numeric" placeholder={text.restartAfterExample} autoComplete="off" disabled={locked}
                onChange={event => changeLeg(index, { minutes: event.target.value })} /></RelayField>
            : <span />}
        <RelayField id={fieldId("runners")} label={text.legRunners(number)}>
          <select value={leg.runners} disabled={locked} onChange={event => changeLeg(index, { runners: event.target.value })}>
            {["1", "2", "3", "4"].map(value => <option key={value} value={value}>{value}</option>)}
          </select></RelayField>
        {leg.runners !== "1" && <>
          <RelayField id={fieldId("changeover")} label={text.legChangeoverRule(number)}>
            <select value={leg.changeoverRule} disabled={locked}
              onChange={event => changeLeg(index, { changeoverRule: event.target.value as RelayLegForm["changeoverRule"] })}>
              {(["FIRST", "LAST"] as const).map(value => <option key={value} value={value}>{text.changeoverRules[value]}</option>)}
            </select></RelayField>
          <RelayField id={fieldId("approval")} label={text.legApprovalRule(number)}>
            <select value={leg.approvalRule} disabled={locked}
              onChange={event => changeLeg(index, { approvalRule: event.target.value as RelayLegForm["approvalRule"] })}>
              {(["ALL", "ANY"] as const).map(value => <option key={value} value={value}>{text.approvalRules[value]}</option>)}
            </select></RelayField></>}
        {legCourse && legCourse.variants.length > 0 && <RelayField id={fieldId("variant")} label={text.legVariant(number)}>
          <select value={leg.variant} disabled={locked} onChange={event => changeLeg(index, { variant: event.target.value })}>
            <option value="">{text.forkedVariants}</option>
            {legCourse.variants.map(variant => <option key={variant.code} value={variant.code}>{variant.code}</option>)}
          </select></RelayField>}
      </div>;
    })}
  </div>;
}

/**
 * "Fler inställningar" (steg 56): lag i omstart (bara när någon sträcka har omstart), gaffling (bara när någon vald bana är
 * gafflad), teamsprint och växlingskontroll. Öppnas av sig själv när en mall sätter något här eller ett fält här har fel.
 */
function MoreSettings({ ws, locked, idPrefix }: { ws: Workspace; locked: boolean; idPrefix: string }) {
  const { courseList, relayChangeoverCode, relayClassErrors: errors, relayForking, relayLegForms, relayMoreOpen, relayReadoutMode,
    relayRestartRanking, setRelayChangeoverCode, setRelayForking, setRelayMoreOpen, setRelayReadoutMode, setRelayRestartRanking } = ws;
  const restart = relayLegForms.some((leg, index) => index > 0 && (leg.method === "RESTART" || leg.method === "FLYING_RESTART"));
  const forked = relayLegForms.some(leg => (courseList?.courses.find(row => row.courseId === leg.course)?.variants.length ?? 0) > 0);
  return <details className={styles.disclosure} open={relayMoreOpen} onToggle={event => setRelayMoreOpen(event.currentTarget.open)}>
    <summary>{formText.more}</summary>
    <div className={styles.disclosureBody}>
      <p className={styles.workflowHelp}>{formText.moreHelp}</p>
      <div className={`${styles.fieldRow} ${relayStyles.settings}`}>
        {restart && <RelayField id={`${idPrefix}-ranking`} label={text.restartRanking}>
          <select value={relayRestartRanking} disabled={locked}
            onChange={event => setRelayRestartRanking(event.target.value as typeof relayRestartRanking)}>
            {(["AFTER_NORMAL", "BY_TIME"] as const).map(value => <option key={value} value={value}>{text.restartRankings[value]}</option>)}
          </select></RelayField>}
        {forked && <RelayField id={`${idPrefix}-forking`} label={text.forking}>
          <select value={relayForking} disabled={locked} onChange={event => setRelayForking(event.target.value as typeof relayForking)}>
            {(["EVEN", "UNEVEN"] as const).map(value => <option key={value} value={value}>{text.forkings[value]}</option>)}
          </select></RelayField>}
        <RelayField id={`${idPrefix}-readout-mode`} label={text.readoutMode}>
          <select value={relayReadoutMode} disabled={locked} onChange={event => {
            setRelayReadoutMode(event.target.value as typeof relayReadoutMode); ws.clearRelayClassError("changeoverCode");
          }}>
            {(["", "EACH_LEG", "LAST_LEG"] as const).map(value => <option key={value} value={value}>{text.readoutModes[value || "NONE"]}</option>)}
          </select></RelayField>
        <RelayField id={`${idPrefix}-changeover-code`} label={text.changeoverCode} error={errors.changeoverCode}>
          <input value={relayChangeoverCode} inputMode="numeric" autoComplete="off" disabled={locked} placeholder={text.changeoverCodeExample}
            onChange={event => { setRelayChangeoverCode(event.target.value); ws.clearRelayClassError("changeoverCode"); }} /></RelayField>
      </div>
    </div>
  </details>;
}

/** Klassnamn, antal sträckor och snabbvalet "Samma bana på alla sträckor". */
function ClassFields({ ws, locked, idPrefix }: { ws: Workspace; locked: boolean; idPrefix: string }) {
  const { changeLegCount, chooseSameCourse, courseList, relayClassErrors: errors, relayClassName, relayLegForms, relaySameCourse,
    setRelayClassName } = ws;
  return <div className={styles.fieldRow}>
    <RelayField id={`${idPrefix}-name`} label={text.className} error={errors.name} className={uiStyles.fieldWithHelp}>
      <input value={relayClassName} maxLength={160} autoComplete="off" disabled={locked}
        onChange={event => { setRelayClassName(event.target.value); ws.clearRelayClassError("name"); }} /></RelayField>
    <RelayField id={`${idPrefix}-legs`} label={text.legCount} className={uiStyles.fieldWithHelp}>
      <select value={relayLegForms.length} disabled={locked} onChange={event => changeLegCount(Number(event.target.value))}>
        {Array.from({ length: 29 }, (_, index) => index + 2).map(count => <option key={count} value={count}>{count}</option>)}
      </select></RelayField>
    <RelayField id={`${idPrefix}-same-course`} label={formText.sameCourse} help={formText.sameCourseHelp} className={uiStyles.fieldWithHelp}>
      <select value={relaySameCourse} disabled={locked} onChange={event => chooseSameCourse(event.target.value)}>
        <option value="">{formText.chooseSameCourse}</option>
        {courseList?.courses.map(row => <option key={row.courseId} value={row.courseId}>{row.name}</option>)}
      </select></RelayField>
  </div>;
}

/** Mallarna: en rad med val. Den valda är markerad (aria-pressed) och beskedet säger vad mallen satte. */
function Templates({ ws, locked }: { ws: Workspace; locked: boolean }) {
  const { applyRelayTemplate, relayTemplateId } = ws;
  return <div className={relayStyles.templates}>
    <div role="group" aria-label={formText.templates} className={relayStyles.templateRow}>
      <span className={relayStyles.templateLabel}>{formText.templates}</span>
      {RELAY_TEMPLATES.map(id => <Button key={id} variant="secondary" disabled={locked} aria-pressed={relayTemplateId === id}
        className={relayStyles.template} onClick={() => applyRelayTemplate(id)}>{formText.template[id]}</Button>)}
    </div>
    {relayTemplateId ? <Notice role="status">{formText.templateNote[relayTemplateId]}</Notice>
      : <p className={styles.workflowHelp}>{formText.templatesHelp}</p>}
  </div>;
}

/** Klasser: "Ny stafettklass" med mall, namn, antal sträckor, bana per sträcka och startsätt. */
export function RelayClassForm({ ws, visible }: { ws: Workspace; visible: boolean }) {
  const { createRelayClass, raceId, relayClassAttempt, relayClassError, relayClassErrors, relayClassForm, relayEditClassId, relayLegForms,
    workflowLocked } = ws;
  useRelayLoad(ws, visible);
  const locked = workflowLocked || !!relayClassAttempt;
  const id = `relay-class-${raceId}`;
  return <>{visible && <RelayMessages ws={ws} />}{!relayEditClassId && <details className={styles.disclosure} open={ws.relayNewClassOpen || !!relayClassAttempt}
    onToggle={event => ws.setRelayNewClassOpen(event.currentTarget.open)}>
    <summary>{text.newClass}</summary>
    <form ref={relayClassForm} noValidate className={styles.disclosureBody} aria-label={text.newClass}
      onSubmit={event => { event.preventDefault(); void createRelayClass(); }}>
      <p className={styles.workflowHelp}>{text.newClassHelp}</p>
      <RelayErrorSummary errors={relayClassErrors} order={["name", ...legKeys(relayLegForms.length), "changeoverCode"]} />
      <Templates ws={ws} locked={locked} />
      <ClassFields ws={ws} locked={locked} idPrefix={id} />
      <p className={styles.workflowHelp}>{text.methodHelp}</p>
      <LegRows ws={ws} locked={locked} idPrefix={id} />
      <MoreSettings ws={ws} locked={locked} idPrefix={id} />
      {relayClassError && <Notice tone="error" role="alert">{relayClassError}</Notice>}
      <div className={styles.actions}><Button type="submit" disabled={workflowLocked}>{text.saveClass}</Button></div>
    </form>
  </details>}<RelayClassEdit ws={ws} /></>;
}

/** "Ändra stafettklass": välj klass, ändra och spara; byter resultat status visas beskedet först. */
function RelayClassEdit({ ws }: { ws: Workspace }) {
  const { busy, cancelRelayClassEdit, raceId, relay, relayClassError, relayClassErrors, relayClassForm, relayEditAttempt, relayEditClassId,
    relayEditPreview, relayLegForms, saveRelayClassEdit, startRelayClassEdit, workflowLocked } = ws;
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
      {raceClass && <form ref={relayClassForm} noValidate className={relayStyles.editForm} aria-label={text.editClass}
        onSubmit={event => { event.preventDefault(); void saveRelayClassEdit(false); }}>
        <RelayErrorSummary errors={relayClassErrors} order={["name", ...legKeys(relayLegForms.length), "changeoverCode"]} />
        <ClassFields ws={ws} locked={locked} idPrefix={id} />
        <LegRows ws={ws} locked={locked} idPrefix={id} />
        <MoreSettings ws={ws} locked={locked} idPrefix={id} />
        {relayClassError && <Notice tone="error" role="alert">{relayClassError}</Notice>}
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
